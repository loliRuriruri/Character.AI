export interface RmsLipSyncPayload {
  mouthOpen: number;
  rawRms: number;
  smoothedRms: number;
  speaking: boolean;
}

export type LipSyncEvent =
  | { type: "rms:frame"; payload: RmsLipSyncPayload }
  | { type: "rms:start" }
  | { type: "rms:stop" }
  | { type: "text:start"; payload: { text: string; durationSec: number } }
  | { type: "text:stop" };

export type LipSyncListener = (event: LipSyncEvent) => void;

export class LipSyncBus {
  private listeners: Set<LipSyncListener> = new Set();

  subscribe(listener: LipSyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: LipSyncEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[LipSyncBus Error]", err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const lipSyncBus = new LipSyncBus();
