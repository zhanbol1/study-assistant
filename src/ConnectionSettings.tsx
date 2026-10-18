import { useEffect, useState } from "react";
import { api, isPreview } from "./api";
import type { AiStatus, Snapshot } from "./types";

export function ConnectionSettings({ state, onUpdate }: { state: Snapshot; onUpdate: (state: Snapshot) => void }) {
  const [status, setStatus] = useState<AiStatus>({ configured: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.aiStatus().then(setStatus).catch(cause => setError(cause.message)); }, []);
  async function act(action: () => Promise<Snapshot>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { onUpdate(await action()); setStatus(await api.aiStatus()); setNotice(message); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save settings."); return false; }
    finally { setBusy(false); }
  }
  return <>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {notice && <p role="status" className="info-banner">{notice}</p>}
    <section className="panel feature-settings">
      <h2>OpenAI connection</h2>
      <p>{status.configured ? "An API key is configured. Access is checked when you send a request." : "No AI provider is connected."} {status.fromEnvironment && "Using OPENAI_API_KEY from your environment."}</p>
      <p>Connect your OpenAI API account. Selected materials and chat history are sent only when you send a message or request a quiz. API billing is separate from a ChatGPT subscription.</p>
      <form onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act(() => api.connectAi({ key: String(data.get("key") || "").trim(), model: String(data.get("model") || "").trim() }), "Connection settings saved. Send a message in Assistant to verify access.").then(ok => { if (ok) { const key = form.elements.namedItem("key") as HTMLInputElement; key.value = ""; } });
      }}>
        <label className="field">API key<input name="key" type="password" autoComplete="off" maxLength={500} required={!status.configured} placeholder={status.configured ? "Leave blank to keep the current key" : "Enter your OpenAI API key"} disabled={isPreview} /></label>
        <label className="field">Model ID<input key={state.settings.model} name="model" defaultValue={state.settings.model} required maxLength={100} /></label>
        <p className="small-note">Saved API keys are encrypted using your operating system’s credential protection. The browser preview cannot store API keys.</p>
        <div className="compose-actions"><button className="button secondary" type="button" disabled={busy || !status.configured || status.fromEnvironment} onClick={() => void act(api.disconnectAi, "Saved API key removed.")}>Disconnect</button><button className="button primary" disabled={busy || isPreview}>Save connection</button></div>
      </form>
    </section>
    <section className="panel feature-settings">
      <h2>Deadlines and reminders</h2>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void act(() => api.saveSettings({ timeZone: String(data.get("timeZone") || ""), remindersEnabled: data.has("remindersEnabled"), reminderMinutes: Number(data.get("reminderMinutes")), backgroundEnabled: data.has("backgroundEnabled") }), "Reminder settings saved.");
      }}>
        <label className="field">Moodle display time zone<input key={state.settings.timeZone} name="timeZone" defaultValue={state.settings.timeZone} required placeholder="Asia/Bishkek" maxLength={100} /></label>
        <p className="small-note">Match the time zone in your Moodle profile. This is used for dates shown without a UTC offset. Imported deadlines are displayed in your device’s local time.</p>
        <label className="check-field"><input name="remindersEnabled" type="checkbox" defaultChecked={state.settings.remindersEnabled} disabled={isPreview} />Remind me about approaching deadlines</label>
        <label className="field">Remind me this many minutes before the deadline<input name="reminderMinutes" type="number" min={1} max={10080} defaultValue={state.settings.reminderMinutes} required /></label>
        <label className="check-field"><input name="backgroundEnabled" type="checkbox" defaultChecked={state.settings.backgroundEnabled} disabled={isPreview} />Keep running in the system tray when I close the window</label>
        <p>Scheduled routines and reminders run while the app is open or in the tray. Quit from the tray menu to stop them. Missed routines run once when the app resumes. This development build does not start at Windows login.</p>
        <button className="button primary" disabled={busy}>Save reminder settings</button>
      </form>
    </section>
  </>;
}
