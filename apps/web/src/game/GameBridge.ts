import type { DecisionTrace, WorldSnapshot } from '@swarm-script/shared';

export interface SnapshotEnvelope {
  snapshot: WorldSnapshot;
  receivedAt: number;
}

export interface RenderMetrics {
  latestReceivedTick: number;
  latestRenderedTick: number;
  snapshotAge: number;
  droppedSnapshots: number;
  renderFps: number;
}

type TraceListener = (traces: DecisionTrace[]) => void;
type MetricsListener = (metrics: RenderMetrics) => void;

export class GameBridge {
  private pendingSnapshot: SnapshotEnvelope | null = null;
  private latestReceivedTick = 0;
  private droppedSnapshots = 0;
  private traceListeners = new Set<TraceListener>();
  private metricsListeners = new Set<MetricsListener>();

  publishSnapshot(snapshot: WorldSnapshot): void {
    if (this.pendingSnapshot) this.droppedSnapshots += 1;
    this.pendingSnapshot = { snapshot, receivedAt: performance.now() };
    this.latestReceivedTick = snapshot.tick;
  }

  consumeLatestSnapshot(): SnapshotEnvelope | null {
    const latest = this.pendingSnapshot;
    this.pendingSnapshot = null;
    return latest;
  }

  publishTraces(traces: DecisionTrace[]): void {
    for (const listener of this.traceListeners) listener(traces);
  }

  reportRender(metrics: Omit<RenderMetrics, 'latestReceivedTick' | 'droppedSnapshots'>): void {
    const complete: RenderMetrics = {
      ...metrics,
      latestReceivedTick: this.latestReceivedTick,
      droppedSnapshots: this.droppedSnapshots,
    };
    for (const listener of this.metricsListeners) listener(complete);
  }

  onTrace(listener: TraceListener): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  onRenderMetrics(listener: MetricsListener): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  reset(): void {
    this.pendingSnapshot = null;
    this.latestReceivedTick = 0;
    this.droppedSnapshots = 0;
  }

  debugState(): { latestReceivedTick: number; droppedSnapshots: number; hasPending: boolean } {
    return {
      latestReceivedTick: this.latestReceivedTick,
      droppedSnapshots: this.droppedSnapshots,
      hasPending: Boolean(this.pendingSnapshot),
    };
  }
}

export const gameBridge = new GameBridge();
