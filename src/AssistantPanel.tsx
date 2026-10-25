import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, ChevronDown, LoaderCircle, Paperclip, Plus, Square, Trash2 } from "lucide-react";
import { api, isPreview } from "./api";
import type { AiStatus, ChatMessage, Snapshot } from "./types";
import { errorMessage } from "./errors";
import { ConnectionSettings } from "./ConnectionSettings";
import { RichText } from "./RichText";

export function AssistantPanel({ state, onUpdate }: { state: Snapshot; onUpdate: (state: Snapshot) => void }) {
  const [status, setStatus] = useState<AiStatus>({ configured: false });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [connections, setConnections] = useState(location.hash === "#connections");
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { let active = true; api.aiStatus().then(value => { if (active) setStatus(value); }).catch(cause => { if (active) setError(errorMessage(cause)); }); return () => { active = false; }; }, [state]);
  useEffect(() => api.onProgress(setProgress), []);
  useEffect(() => api.onOpenSettings(() => setConnections(true)), []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [state.messages.length, busy]);
  async function act(action: () => Promise<Snapshot>) {
    setError("");
    try { onUpdate(await action()); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }
  async function send() {
    if (busy || !prompt.trim()) return;
    if (!status.configured) { setConnections(true); setError(isPreview ? "Open the desktop app to connect ChatGPT or an API key." : "Connect ChatGPT or an API key below to start chatting."); return; }
    const message = prompt.trim();
    setBusy(true); setProgress("Thinking"); setPendingPrompt(message);
    try {
      const ok = await act(() => api.sendMessage({ prompt: message, mode: "chat", documentIds: selected.filter(id => state.documents.some(doc => doc.id === id)), includeTasks: false }));
      if (ok) setPrompt("");
    } finally { setBusy(false); setProgress(""); setPendingPrompt(""); textarea.current?.focus(); }
  }
  const connection = status.configured ? status.mode === "chatgpt" ? `ChatGPT plan · ${status.chatgpt?.model || "Choose a model"}` : status.mode === "claude" ? `Claude API · ${state.settings.claudeModel}` : `OpenAI API · ${state.settings.model}` : "Connect ChatGPT, OpenAI or Claude";
  return <div className="chat-app">
    <header className="app-header"><a className="brand" href="#" aria-label="Study Assistant"><span className="brand-mark"><BookOpen size={19} /></span>Study<span>Assistant</span></a>
      <button className="button secondary new-chat" disabled={busy || !state.messages.length} onClick={() => void act(api.clearChat)}><Plus size={16} />New chat</button></header>
    <main className="chat-main">
      <section className={`conversation ${!state.messages.length && !busy ? "empty" : ""}`} aria-label="Study chat">
        {!state.messages.length && !busy && <div className="chat-welcome"><span className="welcome-mark"><BookOpen size={28} /></span><p className="eyebrow">YOUR STUDY COMPANION</p><h1>What’s on your mind?</h1><p>Ask a question. Check your homework.<br />Make a little more sense of your study day.</p>
          <div className="suggestions">{["What is my homework?", "Do I have any quizzes?", "Help me plan my study week"].map(text => <button key={text} onClick={() => { setPrompt(text); textarea.current?.focus(); }}>{text}<span aria-hidden="true">↗</span></button>)}</div></div>}
        <div className="messages" role="log" aria-label="Conversation">
          {state.messages.map(message => <article key={message.id} className={`chat-message ${message.role}`}><div className="message-author">{message.role === "user" ? "You" : "Study Assistant"}</div><div className="message-text">{message.role === "assistant" ? <RichText text={message.content} /> : message.content}</div>
            {!!message.sources.length && <div className="chat-sources" aria-label="Answer sources">{message.sources.map(source => <details key={source.reference}><summary>[{source.reference}] {source.title}</summary><p>{source.excerpt}</p>{source.sourceUrl && <button className="text-button" onClick={() => void api.openSource(source.sourceUrl!).catch(cause => setError(errorMessage(cause)))}>Open in Moodle ↗</button>}</details>)}</div>}
            {!!message.questions.length && <PracticeQuiz message={message} />}
          </article>)}
          {busy && <><article className="chat-message user"><div className="message-author">You</div><div className="message-text">{pendingPrompt}</div></article><p className="progress" role="status"><LoaderCircle size={16} className="spin" />{progress || "Working"}…</p></>}
          <div ref={bottom} />
        </div>
      </section>
      <div className="chat-bottom">
        {error && <p role="alert" className="error-banner">{error}</p>}
        <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <textarea aria-label="Message" ref={textarea} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} rows={2} maxLength={6000} placeholder="Ask anything about your studies…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
          <div className="composer-toolbar"><details className="attachment-menu"><summary><Paperclip size={16} />Materials{selected.length ? ` (${selected.length})` : ""}</summary><div className="attachment-content"><p>Select notes to share with your next message.</p>{state.documents.map(doc => <div className="material-row" key={doc.id}><label className="check-field"><input type="checkbox" disabled={busy} checked={selected.includes(doc.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, doc.id] : previous.filter(id => id !== doc.id))} />{doc.title}</label><button type="button" aria-label={`Remove ${doc.title}`} disabled={busy} onClick={() => void act(() => api.deleteDocument(doc.id))}><Trash2 size={14} /></button></div>)}<button className="button secondary" type="button" disabled={busy || isPreview} onClick={() => void act(() => api.importDocument(""))}>Attach .txt / .md</button></div></details><span className="keyboard-hint">Enter to send</span>
            {busy ? <button type="button" className="send-button" aria-label="Stop response" onClick={() => void api.cancelMessage().catch(cause => setError(errorMessage(cause)))}><Square size={16} /></button> : <button className="send-button" aria-label="Send message" disabled={!prompt.trim()}><ArrowUp size={20} /></button>}
          </div>
        </form>
        <p className="sharing-note">Chat, saved Memory and requested Moodle information are shared with your selected AI connection. Check important dates in Moodle.</p>
        <details className="connections" open={connections} onToggle={event => setConnections(event.currentTarget.open)}><summary><span className={`connection-dot ${status.configured ? "connected" : ""}`} /><span>{connection}</span><ChevronDown size={14} /><span className="connection-label">Connections</span></summary><div className="connection-content">{isPreview && <p className="info-banner">Browser preview. Connect accounts and use Moodle tools in the desktop app.</p>}<ConnectionSettings state={state} onUpdate={onUpdate} /></div></details>
      </div>
    </main>
  </div>;
}

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
