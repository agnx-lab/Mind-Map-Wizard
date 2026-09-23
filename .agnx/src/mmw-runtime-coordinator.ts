// 场景：Mind Map Wizard 运行时重挂协调 — 详情保存配置后强制 ensure+iframe。
type Listener = (reason: string) => void;
const listeners = new Set<Listener>();

export function requestMmwRuntimeRestart(reason: string): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(reason);
    } catch {
      // ignore
    }
  }
}

export function subscribeMmwRuntimeRestart(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
