import { useEffect, useState } from "react";
import { api, isPreview } from "./api";
import { errorMessage } from "./errors";
import type { SavedPage, Snapshot } from "./types";
import { RichText } from "./RichText";

export function WorkspacePage({ state, page, memory = false, onUpdate, onDeleted, onDirtyChange }: { state: Snapshot; page?: SavedPage; memory?: boolean; onUpdate: (state: Snapshot) => void; onDeleted: () => void; onDirtyChange: (value: boolean) => void }) {
  const saved = memory ? state.memory : { content: page?.content || "", revision: page?.revision || "new" };
  const [content, setContent] = useState(saved.content);
  const [title, setTitle] = useState(page?.title || "");
  const [revision, setRevision] = useState(saved.revision);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(memory || !page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const conflict = dirty && saved.revision !== revision;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) { setContent(saved.content); setRevision(saved.revision); setTitle(page?.title || ""); }
  }, [saved.content, saved.revision, page?.title, dirty]);
  async function act(action: () => Promise<Snapshot>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { const updated = await action(); setDirty(false); onUpdate(updated); setNotice(message); return updated; }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="workspace-page">
    <p className="eyebrow">{memory ? "YOUR AI INSTRUCTIONS" : "SAVED PAGE"}</p>
    <div className="page-heading"><h1>{memory ? "Memory" : page?.title || "New page"}</h1>{!memory && page && <button className="button secondary" onClick={() => setEditing(value => !value)}>{editing ? "Read page" : "Edit page"}{dirty ? " · Unsaved" : ""}</button>}</div>
    <p className="page-description">{memory ? "Write how your assistant should find homework, interpret completion, handle past deadlines, and follow your preferences. Saved Memory is included in every AI request." : page ? `Saved ${new Date(page.updatedAt).toLocaleString()}. This page is a snapshot. Ask in chat to refresh or update it.` : "Create a page here, or ask in chat: ‘Create and save a Homework section in my sidebar.’"}</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="info-banner" role="status">{notice}</p>}
    {conflict && <p role="alert" className="error-banner">The saved version changed while you were editing. Copy your draft if needed, then load the saved version.</p>}
    {(editing || memory) ? <form onSubmit={event => {
      event.preventDefault();
      void act(() => memory ? api.saveMemory(content, revision) : api.savePage({ id: page?.id, revision: page?.revision, title, content, sources: page?.sources || [] }), memory ? "Memory saved. Your next message will use these instructions." : "Page saved.").then(updated => { if (updated && !memory && !page) onDeleted(); });
    }}>
      {!memory && <label className="field">Page title<input value={title} required maxLength={100} disabled={busy} onChange={event => { setTitle(event.target.value); setDirty(true); }} /></label>}
      <label className="field">{memory ? "Memory instructions" : "Page content"}<textarea aria-label={memory ? "Memory instructions" : "Page content"} className="page-editor" value={content} rows={20} maxLength={memory ? 20000 : 30000} disabled={busy} onChange={event => { setContent(event.target.value); setDirty(true); setNotice(""); }} /></label>
      <div className="page-actions"><button className="button primary" disabled={busy || conflict || (!memory && !title.trim()) || (!dirty && !!page)}>{busy ? "Saving…" : memory ? "Save memory" : "Save page"}</button><span className="small-note">{content.length.toLocaleString()} / {memory ? "20,000" : "30,000"} characters{dirty ? " · Unsaved changes" : ""}</span></div>
    </form> : <div className="saved-page-text"><RichText text={content || "This page is empty. Choose Edit page to add content."} /></div>}
    <div className="page-actions page-secondary-actions">
      <button className="text-button" disabled={busy} onClick={() => void api.snapshot().then(updated => { onUpdate(updated); setDirty(false); setNotice("Saved version loaded."); }).catch(cause => setError(errorMessage(cause)))}>Load saved version</button>
      {memory && <button className="text-button" disabled={isPreview} onClick={() => void api.revealMemory().catch(cause => setError(errorMessage(cause)))}>Show memory.md in folder</button>}
      {!memory && page && <button className="text-button danger" disabled={busy} onClick={() => setDeleting(true)}>Delete page</button>}
    </div>
    {!memory && page && !!page.sources.length && <div className="page-sources"><h2>Sources when saved</h2>{page.sources.map(source => <p key={source.reference}>[{source.reference}] {source.title}{source.sourceUrl && <button className="text-button" onClick={() => void api.openSource(source.sourceUrl!).catch(cause => setError(errorMessage(cause)))}>Open in Moodle ↗</button>}</p>)}</div>}
    {deleting && page && <div className="delete-confirm" role="alert"><p>Delete “{page.title}” from your sidebar?</p><button className="button secondary" onClick={() => setDeleting(false)}>Keep page</button><button className="button primary" disabled={busy} onClick={() => void act(() => api.deletePage(page.id, page.revision), "Page deleted.").then(updated => { if (updated) onDeleted(); })}>Delete permanently</button></div>}
  </section>;
}

export function DownloadsPage({ state }: { state: Snapshot }) {
  const [error, setError] = useState("");
  return <section className="workspace-page"><p className="eyebrow">YOUR MOODLE FILES</p><h1>Downloads</h1><p className="page-description">Ask in chat to download a course resource, a folder ZIP, or a homework attachment. Files stay on this device. Downloading a file does not mark homework as done.</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {!state.downloads.length ? <div className="page-empty">No downloads yet. Try “Find the files for my homework and download them.”</div> : <div className="download-list">{state.downloads.map(file => <article className="download-card" key={file.id}><h2>{file.filename}</h2><p>{file.course} · {(file.bytes / 1024).toFixed(1)} KB · {new Date(file.createdAt).toLocaleString()}</p><div className="page-actions"><button className="button secondary" disabled={isPreview} onClick={() => void api.revealDownload(file.id).catch(cause => setError(errorMessage(cause)))}>Show in folder</button><button className="text-button" onClick={() => void api.openSource(file.sourceUrl).catch(cause => setError(errorMessage(cause)))}>Moodle source ↗</button></div></article>)}</div>}
  </section>;
}
