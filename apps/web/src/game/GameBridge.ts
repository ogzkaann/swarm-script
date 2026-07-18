import type { DecisionTrace, WorldSnapshot } from '@swarm-script/shared';

type SnapshotListener = (snapshot: WorldSnapshot, receivedAt: number) => void;
type TraceListener = (traces: DecisionTrace[]) => void;

export class GameBridge {
  private snapshotListeners = new Set<SnapshotListener>();
  private traceListeners = new Set<TraceListener>();

  publishSnapshot(snapshot: WorldSnapshot): void {
    const receivedAt = performance.now();
    for (const listener of this.snapshotListeners) listener(snapshot, receivedAt);
  }

  publishTraces(traces: DecisionTrace[]): void {
    for (const listener of this.traceListeners) listener(traces);
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onTrace(listener: TraceListener): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }
}

export const gameBridge = new GameBridge();
