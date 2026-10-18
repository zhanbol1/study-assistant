import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createChatGptAuth, verifyOpenAiIdentity } from "../desktop/chatgpt-auth.mjs";
import { generateOpenAI, createAssistant } from "../desktop/ai.mjs";
import { createStore } from "../desktop/store.mjs";

const discovery = { issuer: "https://auth.openai.com", authorization_endpoint: "https://auth.openai.com/api/accounts/authorize", token_endpoint: "https://auth.openai.com/api/accounts/oauth/token", jwks_uri: "https://auth.openai.com/.well-known/jwks.json", revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" };
const grant = { access_token: "fixture-access", refresh_token: "fixture-refresh", id_token: "fixture-id", expires_in: 3600, token_type: "Bearer", scope: "openid email profile offline_access resource.invoke chatgpt.tokens.use.direct" };
const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(byte => byte ^ 42), decryptString: value => Buffer.from(value).map(byte => byte ^ 42).toString() };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "study-chatgpt-"));
  const filename = path.join(folder, "session.bin");
  const requests = [];
  let clock = Date.now();
  let open;
  let currentUrl;
  let tokenReply = () => json(grant);
  let revokeReply = () => new Response(null, { status: 200 });
  let identitySubject = "fixture-subject";
  const options = { filename, encryption, now: () => clock, timeoutMs: 10000,
    openBrowser: async url => { currentUrl = new URL(url); open?.(currentUrl); },
    verifyIdentity: async (token, options) => {
      assert.equal(token, "fixture-id");
      assert.equal(options.nonce, currentUrl.searchParams.get("nonce"));
      return { subject: identitySubject, email: "fixture@example.test", name: "Fixture" };
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, ...options });
      if (url.endsWith("openid-configuration")) return json(discovery);
      if (url === discovery.token_endpoint) return tokenReply(options);
      if (url === discovery.revocation_endpoint) return revokeReply(options);
      if (url === "https://api.openai.com/v1/models") return json({ models: [{ slug: "hidden", visibility: "hidden" }, { slug: "account-model", display_name: "Account model", visibility: "list" }] });
      throw new Error("Unexpected fixture URL");
    },
  };
  const auth = createChatGptAuth(options);
  return { auth, options, filename, requests,
    setTokenReply: reply => { tokenReply = reply; }, setRevokeReply: reply => { revokeReply = reply; },
    setSubject: value => { identitySubject = value; }, advance: millis => { clock += millis; },
    async begin(input) {
      const opened = new Promise(resolve => { open = resolve; });
      const result = auth.signIn(input).then(value => ({ value }), error => ({ error }));
      const url = await opened;
      return { url, result, callback: async (changes = {}) => {
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.search = new URLSearchParams({ state: url.searchParams.get("state"), code: "fixture-code", client_id: "oaiapp_fixture", ...changes });
        return fetch(callback);
      } };
    },
    cleanup() { auth.cancelSignIn(); fs.rmSync(folder, { recursive: true, force: true }); },
  };
}

test("ChatGPT loopback sign-in binds state, nonce, PKCE, callback and issued client ID", async () => {
  const f = fixture();
  try {
    const attempt = await f.begin();
    assert.equal(attempt.url.origin, "https://auth.openai.com");
    assert.equal(attempt.url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(attempt.url.searchParams.get("agent_name_hint"), "Study Assistant");
    assert.match(attempt.url.searchParams.get("ext_agent_host_id"), /^urn:uuid:/);
    assert.equal((await attempt.callback({ state: "wrong-state" })).status, 400);
    assert.equal(f.requests.filter(request => request.url === discovery.token_endpoint).length, 0);
    assert.equal((await attempt.callback()).status, 200);
    assert.ok((await attempt.result).value.planEnabled);
    const exchange = f.requests.find(request => request.url === discovery.token_endpoint);
    assert.equal(exchange.body.get("client_id"), "oaiapp_fixture");
    assert.equal(exchange.body.get("redirect_uri"), attempt.url.searchParams.get("redirect_uri"));
    assert.equal(exchange.body.get("resource"), "https://api.openai.com/v1");
    assert.equal(createHash("sha256").update(exchange.body.get("code_verifier")).digest("base64url"), attempt.url.searchParams.get("code_challenge"));
    assert.ok(!fs.readFileSync(f.filename).toString().includes(grant.refresh_token));
    assert.ok(!JSON.stringify(f.auth.status()).includes(grant.access_token));
    assert.equal(f.auth.status().welcomeRequired, true);
    f.auth.acknowledgeWelcome(); assert.equal(f.auth.status().welcomeRequired, false);
    await f.auth.listModels();
    assert.deepEqual(f.auth.status().models, [{ id: "account-model", name: "Account model" }]);
    assert.throws(() => f.auth.selectModel("arbitrary-model"));
    const credentials = await f.auth.credentials();
    assert.equal(credentials.subscription, true);
    assert.equal(credentials.model, "account-model");
    const reopened = createChatGptAuth(f.options);
    assert.equal(reopened.status().signedIn, true);
    assert.equal(reopened.status().welcomeRequired, false);
    await f.auth.signOut();
    const returning = await f.begin();
    assert.equal(returning.url.searchParams.get("client_id"), "oaiapp_fixture");
    assert.equal(returning.url.searchParams.get("ext_agent_host_id"), attempt.url.searchParams.get("ext_agent_host_id"));
    assert.equal(returning.url.searchParams.has("id_token_hint"), false);
    f.auth.cancelSignIn(); assert.ok((await returning.result).error);
  } finally { f.cleanup(); }
});

test("unexpected returning clients, declined consent, and mismatched accounts preserve the active connection", async () => {
  const f = fixture();
  try {
    const first = await f.begin(); await first.callback(); await first.result;
    const wrongClient = await f.begin();
    await wrongClient.callback({ client_id: "oaiapp_other" });
    assert.ok((await wrongClient.result).error);
    assert.equal(f.auth.status().signedIn, true);
    const declined = await f.begin();
    await declined.callback({ error: "access_denied" });
    assert.ok((await declined.result).error);
    assert.equal(f.auth.status().signedIn, true);
    f.setSubject("other-subject");
    const mismatch = await f.begin(); await mismatch.callback();
    assert.ok((await mismatch.result).error);
    assert.equal(f.auth.status().account, "fixture@example.test");
    assert.equal(f.auth.status().signedIn, true);
  } finally { f.cleanup(); }
});

test("identity-only consent stays signed in with plan usage disabled and never permits inference", async () => {
  const f = fixture();
  try {
    f.setTokenReply(() => json({ id_token: "fixture-id", scope: "openid profile email" }));
    const attempt = await f.begin(); await attempt.callback();
    assert.ok((await attempt.result).value.signedIn);
    assert.equal(f.auth.status().planEnabled, false);
    await assert.rejects(f.auth.credentials(), /not enabled/);
    assert.equal(f.requests.filter(request => request.url.endsWith("/models")).length, 0);
    const consent = await f.begin({ consent: true });
    assert.equal(consent.url.searchParams.get("prompt"), "consent");
    assert.equal(consent.url.searchParams.get("client_id"), "oaiapp_fixture");
    f.auth.cancelSignIn(); await consent.result;
  } finally { f.cleanup(); }
});

test("signed identity tokens require a trusted signature, issuer, audience, expiry, and nonce", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "fixture-key", alg: "RS256", use: "sig" };
  const verifyOptions = { clientId: "oaiapp_fixture", nonce: "expected-nonce", discovery, fetchImpl: async () => json({ keys: [jwk] }) };
  const sign = (changes = {}, expires = "5m") => new SignJWT({ sub: "subject", nonce: "expected-nonce", email: "person@example.test", ...changes }).setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).setIssuer(discovery.issuer).setAudience("oaiapp_fixture").setIssuedAt().setExpirationTime(expires).sign(privateKey);
  const token = await sign();
  assert.equal((await verifyOpenAiIdentity(token, verifyOptions)).subject, "subject");
  await assert.rejects(verifyOpenAiIdentity(await sign({ nonce: "wrong" }), verifyOptions));
  await assert.rejects(verifyOpenAiIdentity(token, { ...verifyOptions, clientId: "oaiapp_wrong" }));
  await assert.rejects(verifyOpenAiIdentity(await sign({}, "-10m"), verifyOptions));
  const parts = token.split("."); parts[2] = `${parts[2].startsWith("A") ? "B" : "A"}${parts[2].slice(1)}`;
  await assert.rejects(verifyOpenAiIdentity(parts.join("."), verifyOptions));
});

test("refresh rotation is serialized, terminal refresh errors clear tokens, and registration survives", async () => {
  const f = fixture();
  try {
    const attempt = await f.begin(); await attempt.callback(); await attempt.result; await f.auth.listModels();
    f.advance(3590000);
    let refreshes = 0;
    f.setTokenReply(options => {
      assert.equal(options.body.get("grant_type"), "refresh_token");
      assert.equal(options.body.get("client_id"), "oaiapp_fixture");
      assert.equal(options.body.get("refresh_token"), "fixture-refresh");
      refreshes++; return json({ ...grant, access_token: "renewed-access", refresh_token: "rotated-refresh" });
    });
    const result = await Promise.all([f.auth.credentials(), f.auth.credentials(), f.auth.credentials()]);
    assert.equal(refreshes, 1);
    assert.ok(result.every(value => value.key === "renewed-access"));
    f.advance(3590000);
    f.setTokenReply(options => { assert.equal(options.body.get("refresh_token"), "rotated-refresh"); return json({ error: "invalid_grant" }, 400); });
    await assert.rejects(f.auth.credentials());
    assert.equal(f.auth.status().signedIn, false);
    const retry = await f.begin(); assert.equal(retry.url.searchParams.get("client_id"), "oaiapp_fixture");
    f.auth.cancelSignIn(); await retry.result;
  } finally { f.cleanup(); }
});

test("transient renewal failures retain the connection and unconfirmed revocation is disclosed", async () => {
  const f = fixture();
  try {
    const attempt = await f.begin(); await attempt.callback(); await attempt.result; await f.auth.listModels();
    f.advance(3590000);
    f.setTokenReply(() => json({ detail: "temporary unavailable" }, 503));
    await assert.rejects(f.auth.credentials(), /temporarily/);
    assert.equal(f.auth.status().signedIn, true);
    f.setRevokeReply(() => json({}, 503));
    const status = await f.auth.signOut();
    assert.equal(status.signedIn, false);
    assert.match(status.warning, /could not be confirmed/);
    assert.equal(f.requests.filter(request => request.url === discovery.revocation_endpoint).length, 2);
  } finally { f.cleanup(); }
});

test("ChatGPT plan inference uses a completed SSE response and omits API-only fields", async () => {
  const expected = { answer: "Hi", sourceIds: [], questions: [] };
  const event = { type: "response.completed", response: { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(expected) }] }] } };
  const bytes = new TextEncoder().encode(`: heartbeat\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\ndata: [DONE]\r\n\r\n`);
  const response = new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
  const result = await generateOpenAI({ key: "fixture-plan-token", model: "account-model", subscription: true, messages: [], instructions: "Study tutor", fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal(body.max_output_tokens, undefined); assert.equal(body.previous_response_id, undefined);
    return response;
  } });
  assert.deepEqual(result, expected);
  await assert.rejects(generateOpenAI({ subscription: true, fetchImpl: async () => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n') }), /stopped before/);
  await assert.rejects(generateOpenAI({ subscription: true, fetchImpl: async () => new Response('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n') }), /usage limit/);
});

test("changing connections cancels an in-flight answer without saving partial messages", async () => {
  const store = createStore(":memory:");
  let release;
  const assistant = createAssistant({ store, vault: { read: () => "fixture-key" }, generate: () => new Promise(resolve => { release = resolve; }) });
  try {
    const result = assistant.send({ prompt: "Explain calculus", mode: "chat", documentIds: [], includeTasks: false });
    assistant.cancel(); release({ answer: "Should not be saved", sourceIds: [], questions: [] });
    await assert.rejects(result, /cancelled/);
    assert.equal(store.snapshot().messages.length, 0);
  } finally { store.close(); }
});

test("subscription answers survive an empty terminal output array without duplicating streamed text", async () => {
  const answer = { answer: "I can explain concepts and make practice quizzes. 📚", sourceIds: [], questions: [] };
  const text = JSON.stringify(answer);
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { id: "reasoning", type: "reasoning" } },
    { type: "response.output_item.added", output_index: 1, item: { id: "comment", type: "message", role: "assistant", phase: "commentary", content: [] } },
    { type: "response.output_text.done", output_index: 1, content_index: 0, text: "Working on it…" },
    { type: "response.output_item.added", output_index: 2, item: { id: "final", type: "message", role: "assistant", phase: "final_answer", content: [] } },
    { type: "response.content_part.added", output_index: 2, content_index: 0, part: { type: "output_text", text: "" } },
    ...[text.slice(0, 30), text.slice(30)].map(delta => ({ type: "response.output_text.delta", output_index: 2, content_index: 0, delta })),
    { type: "response.output_text.done", output_index: 2, content_index: 0, text },
    { type: "response.output_item.done", output_index: 2, item: { id: "final", type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text }] } },
    { type: "response.completed", response: { status: "completed", output: [] } },
  ];
  const bytes = new TextEncoder().encode(events.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join(""));
  const response = new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7)); controller.close(); } }));
  assert.deepEqual(await generateOpenAI({ subscription: true, fetchImpl: async () => response }), answer);
});

test("text-done events recover sparse terminal responses but never partial or failed requests", async () => {
  const answer = { answer: "A study tip.", sourceIds: [], questions: [] };
  const textDone = `data: ${JSON.stringify({ type: "response.output_text.done", output_index: 0, content_index: 0, text: JSON.stringify(answer) })}\n\n`;
  const generate = tail => generateOpenAI({ subscription: true, fetchImpl: async () => new Response(textDone + tail) });
  assert.deepEqual(await generate('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'), answer);
  await assert.rejects(generate(""), /stopped before/);
  await assert.rejects(generate('data: {"type":"response.incomplete"}\n\n'), /could not complete/);
  await assert.rejects(generate('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n'), /usage limit/);
});

test("refusals and genuinely empty completions have distinct readable errors", async () => {
  const generate = events => generateOpenAI({ subscription: true, fetchImpl: async () => new Response(events.map(value => `data: ${JSON.stringify(value)}\n\n`).join("")) });
  await assert.rejects(generate([
    { type: "response.refusal.done", output_index: 0, content_index: 0, refusal: "Cannot help with this request." },
    { type: "response.completed", response: { status: "completed", output: [] } },
  ]), /declined/);
  await assert.rejects(generate([{ type: "response.completed", response: { status: "completed", output: [] } }]), /without an answer/);
});

test("cancelling during discovery prevents a browser sign-in from opening later", async () => {
  const f = fixture();
  let release;
  let opened = false;
  const auth = createChatGptAuth({ ...f.options, openBrowser: () => { opened = true; },
    fetchImpl: () => new Promise(resolve => { release = () => resolve(json(discovery)); }) });
  try {
    const pending = auth.signIn().then(value => ({ value }), error => ({ error }));
    auth.cancelSignIn(); release();
    assert.ok((await pending).error);
    assert.equal(opened, false);
    assert.equal(auth.status().signedIn, false);
  } finally { auth.cancelSignIn(); f.cleanup(); }
});

test("an in-flight refresh cannot restore credentials after sign-out", async () => {
  const f = fixture();
  let release;
  try {
    const attempt = await f.begin(); await attempt.callback(); await attempt.result; await f.auth.listModels();
    f.advance(3590000);
    f.setTokenReply(() => new Promise(resolve => { release = () => resolve(json({ ...grant, access_token: "late-access" })); }));
    const pending = f.auth.credentials().then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setImmediate(resolve));
    await f.auth.signOut(); release();
    assert.ok((await pending).error);
    assert.equal(f.auth.status().signedIn, false);
  } finally { f.cleanup(); }
});
