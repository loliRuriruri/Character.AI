/**
 * Motion Event Bus — Decoupled Event Interface
 * 
 * Outside systems (Chat UI, LLM Stream, TTS Audio Queue) ONLY emit these events.
 * They NEVER touch VRM bones, expressions, or renderer internals directly.
 */

export type MotionEventType =
  | "user:submit"
  | "llm:firstToken"
  | "llm:intent"
  | "tts:start"
  | "tts:frame"
  | "tts:end"
  | "llm:done";

export interface MotionIntentData {
  emotion?: "neutral" | "happy" | "relaxed" | "sad" | "angry" | "surprised";
  gesture?: "none" | "nod" | "wave" | "explain" | "laugh" | "think";
  intensity?: number;
}

export type MotionEvent =
  | { type: "user:submit"; payload?: { text?: string } }
  | { type: "llm:firstToken"; payload?: { token?: string } }
  | { type: "llm:intent"; payload: MotionIntentData }
  | { type: "tts:start"; payload?: { text?: string; duration?: number } }
  | { type: "tts:frame"; payload?: { amplitude?: number; syllable?: string } }
  | { type: "tts:end"; payload?: Record<string, unknown> }
  | { type: "llm:done"; payload?: Record<string, unknown> };

export type MotionEventListener = (event: MotionEvent) => void;

class MotionEventBus {
  private listeners: Set<MotionEventListener> = new Set();

  subscribe(listener: MotionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: MotionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[MotionEventBus Error] Failed to handle ${event.type}:`, err);
      }
    }
  }
}

export const motionEventBus = new MotionEventBus();

if (typeof window !== "undefined") {
  (window as any).__motionEventBus = motionEventBus;
}
