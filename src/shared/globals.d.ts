export type MikuBridge = {
  send(channel: string, ...args: unknown[]): void;
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  on(channel: string, handler: (...args: unknown[]) => void): () => void;
};

declare global {
  interface Window {
    miku: MikuBridge;
  }
}

export {};
