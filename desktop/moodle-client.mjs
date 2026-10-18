// One worker for sequential Moodle reads. A stopped/failed request retires it so
// late replies cannot satisfy a later request. No credentials cross this channel.
export function createMoodleClient({ spawn, idleMs = 600_000, timeoutMs = 600_000 }) {
  let worker, pending, idle, backgroundMode, sequence = 0;
  const retiring = new Set();
  function retire() {
    clearTimeout(idle);
    const child = worker;
    worker = undefined;
    if (!child) return;
    try { child.postMessage({ operation: 'shutdown' }); } catch {}
    let complete;
    const closed = new Promise(resolve => { complete = resolve; });
    retiring.add(closed);
    const done = () => { clearTimeout(timer); retiring.delete(closed); complete(); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finally { done(); } }, 2000);
    timer.unref?.();
    child.once('exit', done);
  }
  function finish(error, result, reset = false) {
    const request = pending;
    if (!request) return;
    pending = undefined;
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.abort);
    if (reset) retire();
    else { idle = setTimeout(retire, idleMs); idle.unref?.(); }
    if (error) request.reject(error); else request.resolve(result);
  }
  return {
    read(data, { signal, background = true } = {}) {
      signal?.throwIfAborted();
      if (pending) return Promise.reject(new Error('A Moodle sync is already running.'));
      clearTimeout(idle);
      if (worker && backgroundMode !== background) retire();
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const abort = () => finish(new Error('Moodle lookup stopped.'), undefined, true);
        pending = { id, resolve, reject, signal, abort, timer: setTimeout(() => finish(new Error('Moodle sync timed out. Your saved data is unchanged.'), undefined, true), timeoutMs) };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        const send = child => { if (worker === child && pending?.id === id) child.postMessage({ ...data, id }); };
        try {
          if (worker) { send(worker); return; }
          const child = spawn(background);
          worker = child;
          backgroundMode = background;
          child.once('spawn', () => { try { send(child); } catch { finish(new Error('Moodle worker could not start.'), undefined, true); } });
          child.on('message', message => {
            if (worker !== child || message?.id !== pending?.id) return;
            if (message.ok === true) finish(null, message.result);
            else finish(Object.assign(new Error(message.error || 'Moodle read failed.'), { code: message.errorCode || 'read-failed', retryable: message.retryable === true }), undefined, true);
          });
          const failed = () => { if (worker === child) { if (pending) finish(new Error('Moodle worker stopped before completing. Your saved data is unchanged.'), undefined, true); else retire(); } };
          child.once('error', failed);
          child.once('exit', failed);
        } catch { finish(new Error('Moodle worker could not start.'), undefined, true); }
      });
    },
    close() {
      if (pending) finish(new Error('Moodle lookup stopped.'), undefined, true); else retire();
      return Promise.all([...retiring]);
    },
  };
}
