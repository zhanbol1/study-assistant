import { useEffect, useState } from "react";
import { api } from "./api";
import type { Snapshot } from "./types";
import { AssistantPanel } from "./AssistantPanel";
import { errorMessage } from "./errors";
export function App() {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.snapshot().then(value => { if (active) setState(value); }).catch(cause => { if (active) setError(errorMessage(cause)); });
    const unsubscribe = api.onSnapshot(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  if (error) return <main className="startup" role="alert">{error}<button onClick={() => location.reload()}>Retry</button></main>;
  if (!state) return <main className="startup" role="status">Opening your chat...</main>;
  return <AssistantPanel state={state} onUpdate={setState} />;
}
