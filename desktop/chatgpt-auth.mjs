import fs from "node:fs";
import http from "node:http";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const random = () => randomBytes(32).toString("base64url");
const same = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function subscriptionError(status, body = {}, requestId = "") {
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  const messages = {
    subscription_sharing_user_not_eligible: "This ChatGPT account or workspace is not eligible to use its plan in this app.",
    subscription_sharing_usage_limit_exceeded: "This app has reached a ChatGPT plan usage limit. Review your limits in ChatGPT Settings → Usage.",
    subscription_sharing_usage_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again later.",
    subscription_sharing_unsupported_capability: "This model or request feature is unavailable with your ChatGPT plan. Try another listed model.",
    subscription_sharing_route_not_supported: "ChatGPT plan access is unavailable on this API route.",
    subscription_sharing_invalid_user: "ChatGPT could not validate this account. Sign in again.",
    chatpass_v2_scope_not_authorized: "This connection does not have permission to use your ChatGPT plan. Enable plan usage in Settings.",
    chatpass_v2_invalid_authorization_context: "ChatGPT did not accept this connection's plan authorization. Sign in again.",
  };
  const fallback = { 401: "ChatGPT authorization was not accepted. Sign in again.", 403: "Your account, workspace, policy, or serving region does not permit this request.", 429: "ChatGPT usage is limited. Review ChatGPT Settings → Usage and try later.", 503: "ChatGPT plan access is temporarily unavailable. Try again later." };
  const error = new Error(messages[code] || fallback[status] || `ChatGPT request failed (HTTP ${status}).`);
  // Keep structured diagnostics without including tokens or untrusted response text.
  error.status = status;
  error.code = code;
  error.param = typeof body?.error?.param === "string" ? body.error.param : "";
  error.requestId = requestId;
  return error;
}

export async function verifyOpenAiIdentity(token, { clientId, nonce, discovery, fetchImpl = fetch }) {
  if (typeof token !== "string" || token.length > 30000) throw new Error("ChatGPT did not return a valid identity token.");
  const keys = createRemoteJWKSet(new URL(discovery.jwks_uri), { [customFetch]: fetchImpl });
  const { payload } = await jwtVerify(token, keys, { issuer, audience: clientId, algorithms: ["RS256", "ES256"], clockTolerance: 5, requiredClaims: ["exp", "iat", "sub", "nonce"] });
  if (!same(payload.nonce, nonce) || typeof payload.sub !== "string" || !payload.sub || payload.iat > Date.now() / 1000 + 60) throw new Error("ChatGPT identity validation failed. Start sign-in again.");
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw new Error("ChatGPT returned an unexpected identity audience.");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email.slice(0, 254) : "", name: typeof payload.name === "string" ? payload.name.slice(0, 200) : "" };
}

export function createChatGptAuth({ filename, encryption, openBrowser, fetchImpl = (url, options) => fetch(url, options), verifyIdentity = verifyOpenAiIdentity, now = Date.now, timeoutMs = 300000, onChange = () => {} }) {
  let state;
  let pending;
  let revision = 0;
  let refreshing;
  let discoveryPromise;
  let signingOut = false;
  const secure = () => encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== "basic_text";
  function load() {
    if (state) return state;
    if (fs.existsSync(filename)) {
      try {
        if (!secure()) throw new Error();
        state = JSON.parse(encryption.decryptString(fs.readFileSync(filename)));
        if (typeof state.hostId !== "string" || !state.hostId.startsWith("urn:uuid:")) throw new Error();
      } catch { throw new Error("The saved ChatGPT connection could not be unlocked. Restore operating-system credential access before signing in again."); }
    } else state = { hostId: `urn:uuid:${randomUUID()}`, registration: null, session: null, models: [], model: "" };
    return state;
  }
  function save(next) {
    if (!secure()) throw new Error("Secure credential storage is unavailable on this device. ChatGPT sign-in requires operating-system credential protection.");
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, encryption.encryptString(JSON.stringify(next)), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, filename);
      state = next;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  async function jsonRequest(url, options = {}) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(20000) }); }
    catch { throw new Error("ChatGPT sign-in could not reach OpenAI. Check your connection and try again."); }
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const code = typeof body.error === "string" ? body.error : body.error?.code;
      const terminal = ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(code);
      const error = subscriptionError(response.status, typeof body.error === "string" ? { error: { code: body.error } } : body, response.headers?.get("x-request-id") || "");
      error.terminalRefresh = terminal;
      throw error;
    }
    return body;
  }
  async function discovery() {
    if (!discoveryPromise) discoveryPromise = jsonRequest(`${issuer}/.well-known/openid-configuration`).then(value => {
      for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "revocation_endpoint"]) {
        const url = new URL(value[key]);
        if (url.origin !== issuer || url.username || url.password || url.hash) throw new Error("OpenAI returned an unexpected sign-in endpoint.");
      }
      if (value.issuer !== issuer) throw new Error("OpenAI returned an unexpected identity issuer.");
      return value;
    }).catch(error => { discoveryPromise = null; throw error; });
    return discoveryPromise;
  }
  function tokens(body, previous = null) {
    const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : previous?.scopes || [];
    const planEnabled = scopes.includes("chatgpt.tokens.use.direct");
    if (planEnabled && (typeof body.access_token !== "string" || !body.access_token || body.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86400)) throw new Error("ChatGPT returned an invalid token response.");
    const refreshToken = body.refresh_token || previous?.refreshToken;
    if (planEnabled && (typeof refreshToken !== "string" || !refreshToken)) throw new Error("ChatGPT did not return a renewable session. Sign in again.");
    return { accessToken: typeof body.access_token === "string" ? body.access_token : "", refreshToken: refreshToken || "", idToken: previous?.idToken || body.id_token || "", scopes,
      expiresAt: now() + (body.expires_in || 0) * 1000, earliestRefreshAt: Number.isFinite(body.earliest_refresh_at) ? body.earliest_refresh_at * 1000 : 0 };
  }
  function status() {
    const saved = load();
    return { signedIn: Boolean(saved.session), planEnabled: Boolean(saved.session?.scopes.includes("chatgpt.tokens.use.direct")),
      account: saved.registration?.email || saved.registration?.name || "ChatGPT account", model: saved.model || "",
      models: saved.models || [], pending: Boolean(pending), welcomeRequired: Boolean(saved.session?.scopes.includes("chatgpt.tokens.use.direct") && !saved.welcomeShown) };
  }
  async function accessToken() {
    if (signingOut) throw new Error("ChatGPT sign-out is in progress. Wait before starting another AI request.");
    const saved = load();
    if (!saved.session) throw new Error("Continue with ChatGPT in Settings to connect your plan.");
    if (!saved.session.scopes.includes("chatgpt.tokens.use.direct")) throw new Error("Your ChatGPT account is signed in, but plan usage is not enabled. Enable it in Settings.");
    if (saved.session.expiresAt > now() + 60000) return saved.session.accessToken;
    if (saved.session.earliestRefreshAt > now()) throw new Error("ChatGPT cannot renew this session yet. Try again shortly.");
    if (refreshing) return refreshing;
    const version = revision;
    refreshing = (async () => {
      try {
        const config = await discovery();
        const body = await jsonRequest(config.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", client_id: saved.registration.clientId, refresh_token: saved.session.refreshToken, resource }) });
        if (version !== revision) throw new Error("The ChatGPT connection changed. Try again.");
        const session = tokens(body, saved.session);
        save({ ...load(), session });
        if (!session.scopes.includes("chatgpt.tokens.use.direct")) throw new Error("ChatGPT plan usage is no longer enabled. Authorize it again in Settings.");
        return session.accessToken;
      } catch (error) {
        if (error.terminalRefresh && version === revision) {
          revision++; save({ ...load(), session: null, models: [], model: "" }); onChange();
          throw new Error("The ChatGPT session expired or was revoked. Continue with ChatGPT again in Settings.");
        }
        throw error;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function listModels() {
    const version = revision;
    const token = await accessToken();
    const body = await jsonRequest(`${resource}/models`, { headers: { Authorization: `Bearer ${token}` } });
    if (version !== revision) throw new Error("The ChatGPT account changed. Refresh models again.");
    if (!Array.isArray(body.models)) throw new Error("ChatGPT returned an unreadable model catalog.");
    const models = body.models.filter(item => item.visibility === "list" && typeof item.slug === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(item.slug)).slice(0, 200).map(item => ({ id: item.slug, name: typeof item.display_name === "string" ? item.display_name.slice(0, 200) : item.slug }));
    if (!models.length) throw new Error("No models are currently available to this ChatGPT account.");
    const saved = load();
    save({ ...saved, models, model: models.some(item => item.id === saved.model) ? saved.model : models[0].id });
    onChange();
    return status();
  }
  function cancelSignIn() {
    if (pending) pending.cancel();
    else revision++;
  }
  async function signIn(options = {}) {
    if (signingOut) throw new Error("Wait for ChatGPT sign-out to finish.");
    if (pending) throw new Error("A ChatGPT sign-in is already open. Complete or cancel it first.");
    const saved = load();
    save(saved); // Persist the host ID before registering this installation.
    const version = revision;
    const config = await discovery();
    if (version !== revision) throw new Error("The ChatGPT connection changed. Start sign-in again.");
    if (pending) throw new Error("A ChatGPT sign-in is already open.");
    const registration = options.newAccount ? null : saved.registration;
    const verifier = random();
    const stateValue = random();
    const nonce = random();
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let finished = false;
      let consumed = false;
      let timer;
      const server = http.createServer();
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        controller.abort();
        server.close();
        const cleanup = setTimeout(() => server.closeAllConnections(), 300);
        cleanup.unref();
        pending = null;
        onChange();
        if (error) reject(error); else resolve(result);
      };
      const cancel = () => { revision++; finish(new Error("ChatGPT sign-in cancelled.")); };
      pending = { cancel };
      timer = setTimeout(() => cancel(), timeoutMs);
      server.on("error", () => finish(new Error("Could not start the local ChatGPT sign-in callback.")));
      server.on("request", async (request, response) => {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        const address = server.address();
        if (request.method !== "GET" || request.socket.remoteAddress !== "127.0.0.1" || request.headers.host !== `127.0.0.1:${address?.port}` || (request.url || "").length > 8192) {
          response.writeHead(400); response.end("Invalid callback."); return;
        }
        const callback = new URL(request.url, `http://127.0.0.1:${address.port}`);
        if (callback.pathname !== "/auth/callback") { response.writeHead(404); response.end("Not found."); return; }
        if (consumed || !same(callback.searchParams.get("state"), stateValue) || ["code", "state", "client_id", "error"].some(key => callback.searchParams.getAll(key).length > 1)) {
          response.writeHead(400); response.end("Invalid or expired sign-in. Return to Study Assistant."); return;
        }
        consumed = true;
        if (callback.searchParams.has("error")) {
          response.end("Sign-in was not completed. Return to Study Assistant.");
          finish(new Error("ChatGPT sign-in was declined or could not complete. Your existing connection is unchanged.")); return;
        }
        const clientId = callback.searchParams.get("client_id") || registration?.clientId;
        const code = callback.searchParams.get("code");
        if (!code || code.length > 4000 || !clientId || clientId === "dynamic_agent_client" || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) || (registration && clientId !== registration.clientId)) {
          response.writeHead(400); response.end("Registration was incomplete. Return to Study Assistant.");
          finish(new Error("ChatGPT did not return the expected client registration. Start sign-in again.")); return;
        }
        try {
          const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
          const body = await jsonRequest(config.token_endpoint, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource }) });
          const identity = await verifyIdentity(body.id_token, { clientId, nonce, discovery: config, fetchImpl });
          if (registration && identity.subject !== registration.subject) throw new Error("The returned ChatGPT account does not match this registration. Choose a different account explicitly.");
          if (version !== revision || finished) throw new Error("ChatGPT sign-in was cancelled.");
          const session = tokens(body);
          save({ ...saved, registration: { ...identity, clientId }, session, models: [], model: "", welcomeShown: registration?.subject === identity.subject ? saved.welcomeShown : false });
          revision++;
          response.end("Connected to Study Assistant. You can close this tab and return to the app.");
          finish(null, status());
        } catch {
          response.writeHead(400); response.end("Sign-in could not be verified. Return to Study Assistant and try again.");
          finish(new Error("ChatGPT sign-in could not be verified. Check your connection and try again. Your earlier connection is unchanged."));
        }
      });
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        const url = new URL(config.authorization_endpoint);
        url.search = new URLSearchParams({ client_id: registration?.clientId || "dynamic_agent_client", ext_agent_host_id: saved.hostId,
          redirect_uri: `http://127.0.0.1:${address.port}/auth/callback`, response_type: "code", scope, resource, state: stateValue, nonce,
          code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
        if (!registration) url.searchParams.set("agent_name_hint", "Study Assistant");
        if (registration && saved.session?.idToken) url.searchParams.set("id_token_hint", saved.session.idToken);
        if (options.consent) url.searchParams.set("prompt", "consent");
        try { await openBrowser(url.toString()); onChange(); }
        catch { finish(new Error("Could not open the browser for ChatGPT sign-in.")); }
      });
    });
  }
  async function signOut() {
    if (signingOut) throw new Error("ChatGPT sign-out is already running.");
    const saved = load();
    signingOut = true;
    cancelSignIn();
    revision++;
    let revoked = !saved.session?.refreshToken;
    try {
      if (!revoked) {
        const config = await discovery();
        for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
          try {
            const response = await fetchImpl(config.revocation_endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: saved.session.refreshToken, token_type_hint: "refresh_token", client_id: saved.registration.clientId }) });
            revoked = response.status === 200;
          } catch { /* Clear locally and report unconfirmed remote revocation. */ }
          if (!revoked && attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } catch { /* The user can revoke access in ChatGPT settings. */ }
    try { save({ ...saved, session: null, models: [], model: "" }); }
    finally { signingOut = false; }
    onChange();
    return { ...status(), warning: revoked ? "" : "Signed out locally. Remote revocation could not be confirmed; disconnect Study Assistant in ChatGPT Settings → Security and login → Sign in with ChatGPT." };
  }
  return {
    status, signIn, cancelSignIn, signOut, listModels,
    acknowledgeWelcome() { save({ ...load(), welcomeShown: true }); return status(); },
    selectModel(id) {
      const saved = load();
      if (!saved.models.some(model => model.id === id)) throw new Error("Choose a model from your ChatGPT account's list.");
      save({ ...saved, model: id }); return status();
    },
    async credentials() {
      const token = await accessToken();
      if (!load().models.length) await listModels();
      return { key: token, model: load().model, subscription: true };
    },
  };
}
