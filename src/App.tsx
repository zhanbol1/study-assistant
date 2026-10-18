import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Snapshot } from "./types";
import { AssistantPanel } from "./AssistantPanel";
import { errorMessage } from "./errors";
import { BookOpen, Download, FileText, MessageCircle, Plus } from "lucide-react";
import { DownloadsPage, WorkspacePage } from "./WorkspacePage";
export function App() {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [view, setView] = useState("chat");
  const [dirty, setDirty] = useState(false);
  const [nextView, setNextView] = useState<string>();
  const unsaved = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (nextView) unsaved.current?.showModal(); }, [nextView]);
  function navigate(next: string) {
    if (next === view) return;
    if (dirty) setNextView(next); else setView(next);
  }
  useEffect(() => {
    let active = true;
    api.snapshot().then(value => { if (active) setState(value); }).catch(cause => { if (active) setError(errorMessage(cause)); });
    const unsubscribe = api.onSnapshot(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  if (error) return <main className="startup" role="alert">{error}<button onClick={() => location.reload()}>Retry</button></main>;
  if (!state) return <main className="startup" role="status">Opening your chat...</main>;
  const page = state.pages.find(page => page.id === view);
  return <div className="workspace-shell">
    <aside className="workspace-sidebar" aria-label="Workspace sidebar"><div className="sidebar-heading"><BookOpen size={18} />Your study space</div>
      <nav aria-label="Workspace"><button className={view === "chat" ? "active" : ""} onClick={() => navigate("chat")}><MessageCircle size={17} />Chat</button><button className={view === "memory" ? "active" : ""} onClick={() => navigate("memory")}><BookOpen size={17} />Memory</button><button className={view === "downloads" ? "active" : ""} onClick={() => navigate("downloads")}><Download size={17} />Downloads{state.downloads.length > 0 && <small>{state.downloads.length}</small>}</button>
      <div className="sidebar-section"><span>SAVED PAGES</span><button aria-label="Create page" onClick={() => navigate("new")}><Plus size={15} /></button></div>
      {state.pages.map(item => <button key={item.id} className={view === item.id ? "active" : ""} title={item.title} onClick={() => navigate(item.id)}><FileText size={16} /><span>{item.title}</span></button>)}
      {!state.pages.length && <p className="sidebar-hint">Ask the AI to create and save a Homework or Overview page.</p>}</nav><p className="sidebar-footer">Your instructions. Your pages.<br />One place to study.</p>
    </aside>
    <div className="workspace-content"><div hidden={view !== "chat"}><AssistantPanel state={state} onUpdate={setState} /></div>
      {view === "memory" && <WorkspacePage key="memory" memory state={state} onUpdate={setState} onDirtyChange={setDirty} onDeleted={() => setView("chat")} />}
      {view === "downloads" && <DownloadsPage state={state} />}
      {(view === "new" || page) && <WorkspacePage key={page?.id || "new"} state={state} page={page} onUpdate={setState} onDirtyChange={setDirty} onDeleted={() => setView("chat")} />}
    </div>
    {nextView && <dialog ref={unsaved} className="unsaved-dialog" aria-labelledby="unsaved-heading" onCancel={() => setNextView(undefined)}><h2 id="unsaved-heading">Unsaved edits</h2><p>Save your edits before leaving, or discard this draft.</p><div className="page-actions"><button className="button secondary" onClick={() => setNextView(undefined)}>Keep editing</button><button className="button primary" onClick={() => { setView(nextView); setNextView(undefined); setDirty(false); }}>Discard draft</button></div></dialog>}
  </div>;
}
