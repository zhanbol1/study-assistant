import { useEffect, useState, useRef } from "react";
import { api, isPreview } from "./api";
import type { AiStatus, Snapshot } from "./types";
import { errorMessage } from "./errors";

export function ConnectionSettings({ state, onUpdate }: { state: Snapshot; onUpdate: (state: Snapshot) => void }) {
  const [status, setStatus] = useState<AiStatus>({ configured: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const welcome = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    api.aiStatus().then(value => { if (active) setStatus(value); }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [state]);
  useEffect(() => {
    const dialog = welcome.current;
    if (status.chatgpt?.welcomeRequired) dialog?.showModal();
    return () => dialog?.close();
  }, [status.chatgpt?.welcomeRequired]);
  async function act(action: () => Promise<Snapshot>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { onUpdate(await action()); setStatus(await api.aiStatus()); setNotice(message); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { setBusy(false); }
  }
  function signIn(options?: { newAccount?: boolean; consent?: boolean }) {
    setSigningIn(true);
    void act(() => api.signInChatGpt(options), "ChatGPT sign-in completed. Review plan access and choose an available model below.").finally(() => setSigningIn(false));
  }
  return <>
    {status.chatgpt?.welcomeRequired && <dialog ref={welcome} className="modal" aria-labelledby="chatgpt-welcome" onCancel={event => { event.preventDefault(); void act(api.acknowledgeChatGptWelcome, "ChatGPT plan connected."); }}>
      <h2 id="chatgpt-welcome">You’re using your ChatGPT plan</h2>
      <p>Eligible AI requests in Study Assistant use your existing ChatGPT plan allowance. Manage this app’s access and limits in ChatGPT Settings → Usage.</p>
      <button className="button primary" disabled={busy} onClick={() => void act(api.acknowledgeChatGptWelcome, "ChatGPT plan connected.")}>Got it</button>
    </dialog>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {notice && <p role="status" className="info-banner">{notice}</p>}
    <section className="panel feature-settings chatgpt-settings">
      <h2>Use your ChatGPT subscription</h2>
      <p>Connect an eligible ChatGPT plan for AI chat and practice quizzes. You’ll sign in and authorize this app in your browser. Usage counts toward your existing plan limits.</p>
      {status.chatgpt?.signedIn && <p><strong>{status.chatgpt.account}</strong> · {status.chatgpt.planEnabled ? "Plan usage authorized" : "Signed in; plan usage is not enabled"}</p>}
      {status.chatgpt?.error && <p className="form-error" role="alert">{status.chatgpt.error}</p>}
      <div className="compose-actions">
        <button className="button chatgpt-button" disabled={busy || isPreview || status.chatgpt?.pending} onClick={() => signIn({ consent: Boolean(status.chatgpt?.signedIn && !status.chatgpt?.planEnabled) })}>Continue with ChatGPT</button>
        {(signingIn || status.chatgpt?.pending) && <button className="button secondary" onClick={() => { void api.cancelChatGptSignIn().then(onUpdate).catch(cause => setError(cause.message)); }}>Cancel sign-in</button>}
        {status.chatgpt?.signedIn && <button className="button secondary" disabled={busy} onClick={() => signIn({ newAccount: true })}>Use another account</button>}
        {status.chatgpt?.signedIn && <button className="button secondary" disabled={busy} onClick={() => void act(async () => { const result = await api.signOutChatGpt(); if (result.warning) setError(result.warning); return result.snapshot; }, "Signed out of ChatGPT on this device.")}>Sign out of ChatGPT</button>}
      </div>
      {(signingIn || status.chatgpt?.pending) && <p role="status">Complete sign-in and plan authorization in the browser. This attempt expires in five minutes.</p>}
      {status.chatgpt?.planEnabled && <>
        <label className="field">ChatGPT model<select aria-label="ChatGPT model" value={status.chatgpt.model} disabled={busy} onChange={event => void act(() => api.selectChatGptModel(event.target.value), "ChatGPT model selected.")}>
          {!status.chatgpt.models.length && <option value="">Refresh models to continue</option>}
          {status.chatgpt.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select></label>
        <div className="compose-actions"><button className="button secondary" disabled={busy} onClick={() => void act(api.refreshChatGptModels, "Available ChatGPT models refreshed.")}>Refresh models</button>
          <button className="button primary" disabled={busy || state.settings.aiMode === "chatgpt"} onClick={() => void act(() => api.saveSettings({ aiMode: "chatgpt" }), "Using your ChatGPT plan for AI requests.")}>Use ChatGPT plan</button></div>
      </>}
      <p className="small-note">{state.settings.aiMode === "chatgpt" ? "Using ChatGPT plan. Requests will not switch to API billing if your plan reaches a limit." : state.settings.aiMode === "claude" ? "AI requests currently use Claude." : "AI requests currently use the API-key connection when configured."}</p>
      <button className="text-button" onClick={() => void api.openChatGptUsage().catch(cause => setError(cause.message))}>Manage ChatGPT usage</button>
    </section>
    <section className="panel feature-settings">
      <h2>OpenAI connection</h2>
      <p>{status.apiKeyConfigured ?"An API key is configured. Access is checked when you send a request." : "No API key is configured."} {status.fromEnvironment && "Using OPENAI_API_KEY from your environment."}</p>
      <p>Connect your OpenAI API account. Selected materials and chat history are sent only when you send a message or request a quiz. API billing is separate from a ChatGPT subscription.</p>
      <form onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act(() => api.connectAi({ key: String(data.get("key") || "").trim(), model: String(data.get("model") || "").trim() }), "Connection settings saved. Send a message in chat to verify access.").then(ok => { if (ok) { const key = form.elements.namedItem("key") as HTMLInputElement; key.value = ""; } });
      }}>
        <label className="field">API key<input name="key" type="password" autoComplete="off" maxLength={500} required={!status.apiKeyConfigured} placeholder={status.apiKeyConfigured ? "Leave blank to keep the current key" : "Enter your OpenAI API key"} disabled={isPreview} /></label>
        <label className="field">Model ID<input key={state.settings.model} name="model" defaultValue={state.settings.model} required maxLength={100} /></label>
        <p className="small-note">Saved API keys are encrypted using your operating system’s credential protection. The browser preview cannot store API keys.</p>
        <div className="compose-actions"><button className="button secondary" type="button" disabled={busy || !status.apiKeyConfigured || status.fromEnvironment} onClick={() => void act(api.disconnectAi, "Saved API key removed.")}>Disconnect</button><button className="button primary" disabled={busy || isPreview}>Save connection</button></div>
      </form>
      {state.settings.aiMode !== "api-key" && status.apiKeyConfigured && <button className="text-button" disabled={busy} onClick={() => void act(() => api.saveSettings({ aiMode: "api-key" }), "Using the OpenAI API key for AI requests.")}>Use OpenAI API key</button>}
    </section>
    <section className="panel feature-settings">
      <h2>Claude (Anthropic API)</h2>
      <p>{status.claude?.configured ? "An Anthropic API key is configured. Access is checked when you send a request." : "No Anthropic API key is configured."} {status.claude?.fromEnvironment && "Using ANTHROPIC_API_KEY from your environment."}</p>
      <p>Connect an Anthropic API key from console.anthropic.com. API usage is billed separately from a Claude Pro or Max subscription, which cannot be used by this app.</p>
      <form onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act(() => api.connectClaude({ key: String(data.get("key") || "").trim(), model: String(data.get("model") || "").trim() }), "Using Claude for AI requests. Send a message in chat to verify access.").then(ok => { if (ok) { const key = form.elements.namedItem("key") as HTMLInputElement; key.value = ""; } });
      }}>
        <label className="field">Anthropic API key<input name="key" type="password" autoComplete="off" maxLength={500} required={!status.claude?.configured} placeholder={status.claude?.configured ? "Leave blank to keep the current key" : "Enter your Anthropic API key"} disabled={isPreview} /></label>
        <label className="field">Claude model ID<input key={state.settings.claudeModel} name="model" defaultValue={state.settings.claudeModel} required maxLength={100} /></label>
        <p className="small-note">For example claude-opus-5-5 (default), claude-sonnet-5-5 or claude-haiku-5-5 (cheaper). The key is encrypted with your operating system’s credential protection.</p>
        <div className="compose-actions"><button className="button secondary" type="button" disabled={busy || !status.claude?.configured || status.claude?.fromEnvironment} onClick={() => void act(api.disconnectClaude, "Saved Anthropic API key removed.")}>Disconnect</button><button className="button primary" disabled={busy || isPreview}>{state.settings.aiMode === "claude" ? "Save Claude connection" : "Use Claude"}</button></div>
      </form>
    </section>
    <section className="panel feature-settings">
      <h2>Moodle</h2>
      <p>Ask about your homework, quizzes or exams. The assistant checks Moodle automatically using credentials stored in Windows Credential Manager.</p>
      <p className="small-note">To connect or update Moodle, run <code>npm --prefix lms-agent run credentials:set</code> in the project terminal. Enter credentials only in that local prompt.</p>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void act(() => api.saveSettings({ timeZone: String(data.get("timeZone") || "") }), "Moodle time zone saved.");
      }}>
        <label className="field">Moodle display time zone<input key={state.settings.timeZone} name="timeZone" defaultValue={state.settings.timeZone} required placeholder="Asia/Bishkek" maxLength={100} /></label>
        <p className="small-note">Match your Moodle profile so deadlines without a UTC offset are interpreted correctly. Only visible courses and activities can be checked.</p>
        <button className="button secondary" disabled={busy}>Save time zone</button>
      </form>
    </section>
  </>;
}
