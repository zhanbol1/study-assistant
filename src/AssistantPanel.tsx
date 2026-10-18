import { useEffect, useState } from "react";
import { FileText, LoaderCircle, Plus, Search, Send, Sparkles, Trash2 } from "lucide-react";
import { api, isPreview } from "./api";
import type { AiStatus, ChatMessage, Snapshot } from "./types";

function PracticeQuiz({ message }: { message: ChatMessage }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  return <div className="practice-quiz">
    {message.questions.map((question, index) => <fieldset key={index}>
      <legend>{index + 1}. {question.question}</legend>
      {question.choices.map((choice, choiceIndex) => <label className="check-field" key={choiceIndex}>
        <input type="radio" name={`${message.id}-${index}`} checked={answers[index] === choiceIndex} disabled={checked}
          onChange={() => setAnswers(previous => ({ ...previous, [index]: choiceIndex }))} />
        {choice}
      </label>)}
      {checked && <p className={answers[index] === question.answerIndex ? "quiz-correct" : "quiz-incorrect"}>
        {answers[index] === question.answerIndex ? "Correct. " : `Correct answer: ${question.choices[question.answerIndex]}. `}{question.explanation}
      </p>}
    </fieldset>)}
    {checked ? <p role="status">Score: {message.questions.filter((question, index) => question.answerIndex === answers[index]).length} / {message.questions.length}</p>
      : <button type="button" className="button secondary" disabled={Object.keys(answers).length !== message.questions.length} onClick={() => setChecked(true)}>Check answers</button>}
  </div>;
}

export function AssistantPanel({ state, onUpdate, openSettings }: { state: Snapshot; onUpdate: (state: Snapshot) => void; openSettings: () => void }) {
  const [status, setStatus] = useState<AiStatus>({ configured: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [includeTasks, setIncludeTasks] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; excerpt: string }[]>([]);
  useEffect(() => { api.aiStatus().then(setStatus).catch(cause => setError(cause.message)); }, [state]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      if (!search.trim()) { setResults([]); return; }
      api.searchDocuments(search).then(value => { if (current) setResults(value); }).catch(cause => { if (current) setError(cause.message); });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [search, state.documents]);
  async function act(label: string, action: () => Promise<Snapshot>) {
    setBusy(label); setError("");
    try { onUpdate(await action()); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete this action."); return false; }
    finally { setBusy(""); }
  }
  async function send(mode: "chat" | "quiz") {
    const ok = await act(mode === "quiz" ? "Creating quiz" : "Thinking", () => api.sendMessage({ prompt, mode, documentIds: selected.filter(id => state.documents.some(doc => doc.id === id)), includeTasks }));
    if (ok) setPrompt("");
  }
  return <div className="assistant-layout">
    <section className="panel chat-panel" aria-label="Study chat">
      <div className="panel-heading"><h2><Sparkles size={18} /> Study companion</h2>
        <button className="text-button" disabled={!!busy || !state.messages.length} onClick={() => void act("Clearing chat", api.clearChat)}>Clear chat</button></div>
      {!status.configured && <div className="info-banner"><span>No AI provider is connected. Connect OpenAI in Settings to ask questions or make practice quizzes.</span><button className="text-button" onClick={openSettings}>Connect</button></div>}
      {status.mode === "chatgpt" && status.chatgpt?.planEnabled && <div className="info-banner"><span>Using ChatGPT plan · {status.chatgpt.account}{status.chatgpt.model ? ` · ${status.chatgpt.model}` : ""}</span><button className="text-button" onClick={() => void api.openChatGptUsage().catch(cause => setError(cause.message))}>Manage usage</button></div>}
      {error && <p role="alert" className="error-banner">{error}</p>}
      <div className="chat-messages" aria-live="polite">
        {!state.messages.length && <div className="chat-welcome"><Sparkles size={30} /><h3>What would you like to understand?</h3><p>Add notes or text files, choose what to share, then ask for an explanation or a practice quiz.</p></div>}
        {state.messages.map(message => <article key={message.id} className={`chat-message ${message.role}`}>
          <strong>{message.role === "user" ? "You" : "Study companion"}</strong><p>{message.content}</p>
          {!!message.sources.length && <ul className="chat-sources" aria-label="Answer sources">{message.sources.map(source => <li key={source.reference}><details><summary>[{source.reference}] {source.title}</summary><p>{source.excerpt || "Source passage was not saved in this older message."}</p></details></li>)}</ul>}
          {!!message.questions.length && <PracticeQuiz message={message} />}
        </article>)}
        {busy && <p className="sync-status" role="status"><LoaderCircle className="spin" size={16} />{busy}…</p>}
      </div>
      <form className="chat-compose" onSubmit={event => { event.preventDefault(); void send("chat"); }}>
        <label className="field">Your question<textarea name="prompt" rows={3} value={prompt} onChange={event => setPrompt(event.target.value)} required maxLength={6000} placeholder="Explain the chain rule using my notes…" /></label>
        <label className="check-field"><input type="checkbox" checked={includeTasks} onChange={event => setIncludeTasks(event.target.checked)} />Share my task titles, notes, deadlines, and source links</label>
        <p className="small-note">Sending shares this chat history and relevant excerpts from selected materials with OpenAI. {status.mode === "chatgpt" ? "Usage counts toward your ChatGPT plan limits." : "API usage is billed to your account."} Answers can contain mistakes.</p>
        <div className="compose-actions"><button className="button secondary" type="button" disabled={!!busy || !prompt.trim() || !status.configured} onClick={() => void send("quiz")}>Make practice quiz</button>
          <button className="button primary" disabled={!!busy || !prompt.trim() || !status.configured}><Send size={15} />Send</button></div>
      </form>
    </section>
    <aside className="panel materials-panel" aria-label="Study materials">
      <div className="panel-heading"><h2><FileText size={18} /> Materials</h2><button aria-label="Add study notes" className="icon-button" onClick={() => setAdding(!adding)}><Plus size={18} /></button></div>
      <p>Choose the materials to use in your next answer. Search stays on this device.</p>
      <label className="field"><span><Search size={14} /> Search material text</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a concept…" /></label>
      {search.trim() && <div className="material-results">{results.length ? results.map(result => <div key={result.id}><strong>{result.title}</strong><p>{result.excerpt}</p></div>) : <p>No matching passages.</p>}</div>}
      <div className="material-list">{state.documents.map(doc => <div className="material-row" key={doc.id}>
        <label className="check-field"><input type="checkbox" checked={selected.includes(doc.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, doc.id] : previous.filter(id => id !== doc.id))} /><span>{doc.title}<small>{doc.course || "Study material"}</small></span></label>
        <button className="icon-button" aria-label={`Remove material ${doc.title}`} disabled={!!busy} onClick={() => void act("Removing material", () => api.deleteDocument(doc.id))}><Trash2 size={14} /></button>
      </div>)}</div>
      {!state.documents.length && <p>No materials added yet.</p>}
      <div className="material-buttons"><button type="button" className="button secondary" onClick={() => setAdding(!adding)}>Paste notes</button>
        <button type="button" className="button secondary" disabled={!!busy || isPreview} onClick={() => void act("Importing material", () => api.importDocument(""))}>Import .txt / .md</button></div>
      {adding && <form className="material-form" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act("Saving notes", () => api.addDocument({ title: String(data.get("title") || ""), course: String(data.get("course") || ""), content: String(data.get("content") || "") })).then(ok => { if (ok) { form.reset(); setAdding(false); } });
      }}><label className="field">Material title<input name="title" required maxLength={200} /></label>
        <label className="field">Course (optional)<input name="course" maxLength={200} /></label>
        <label className="field">Study notes<textarea name="content" rows={7} required maxLength={120000} /></label>
        <button className="button primary" disabled={!!busy}>Save material</button></form>}
    </aside>
  </div>;
}
