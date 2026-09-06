import type { AppSettings, ProviderHealthStatus } from "../src/shared/types";

export type HealthChangeListener = (status: ProviderHealthStatus, message: string | null) => void;

export class ProviderHealthMonitor {
  private status: ProviderHealthStatus = "HEALTHY";
  private message: string | null = null;
  private consecutiveFailures = 0;
  private isInferring = false;
  private timer: NodeJS.Timeout | null = null;
  private getSettings: (() => AppSettings) | null = null;
  private onStateChange: HealthChangeListener | null = null;

  // Bounded exponential backoff configuration (ms)
  private readonly NORMAL_INTERVAL_MS = 15000;
  private readonly BACKOFF_STEPS = [3000, 6000, 12000, 30000];

  public start(getSettings: () => AppSettings, onStateChange: HealthChangeListener): void {
    this.getSettings = getSettings;
    this.onStateChange = onStateChange;
    this.scheduleNextCheck(this.NORMAL_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public setInferring(inferring: boolean): void {
    this.isInferring = inferring;
  }

  public getStatus(): ProviderHealthStatus {
    return this.status;
  }

  public getMessage(): string | null {
    return this.message;
  }

  public recordInferenceSuccess(): void {
    if (this.consecutiveFailures > 0 || this.status !== "HEALTHY") {
      console.log(`[ProviderHealth] Inference succeeded. Restoring status from ${this.status} to HEALTHY.`);
    }
    this.consecutiveFailures = 0;
    this.updateStatus("HEALTHY", null);
  }

  public recordInferenceFailure(err: any): void {
    // Preserve full raw HTTP / wsarecv / ECONNRESET error in developer log
    console.error("[ProviderHealth] Raw inference failure:", {
      message: err?.message,
      code: err?.code,
      cause: err?.cause,
      stack: err?.stack,
      raw: err,
    });

    this.consecutiveFailures++;
    this.evaluateStatus(err);
  }

  public async checkNow(): Promise<ProviderHealthStatus> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.performCheck();
  }

  private scheduleNextCheck(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.performCheck();
    }, delayMs);
  }

  private async performCheck(): Promise<ProviderHealthStatus> {
    if (!this.getSettings) return this.status;
    const settings = this.getSettings();

    // If inference is currently active, avoid penalizing Ollama for slow health responses
    if (this.isInferring) {
      this.scheduleNextCheck(this.NORMAL_INTERVAL_MS);
      return this.status;
    }

    try {
      if (settings.provider === "ollama") {
        await this.pingOllama(settings.ollamaUrl || "http://127.0.0.1:11434");
      } else if (settings.provider === "easyproxy") {
        await this.pingEasyProxy(settings.easyProxyUrl);
      }
      // If ping succeeds:
      this.consecutiveFailures = 0;
      this.updateStatus("HEALTHY", null);
      this.scheduleNextCheck(this.NORMAL_INTERVAL_MS);
    } catch (err: any) {
      // Raw error preserved in developer logs
      console.warn(`[ProviderHealth] Health check probe failed (${this.consecutiveFailures + 1} consecutive):`, {
        message: err?.message,
        code: err?.code,
        errno: err?.errno,
      });

      this.consecutiveFailures++;
      this.evaluateStatus(err);

      // Bounded backoff
      const stepIdx = Math.min(this.consecutiveFailures - 1, this.BACKOFF_STEPS.length - 1);
      const delay = this.BACKOFF_STEPS[Math.max(0, stepIdx)];
      this.scheduleNextCheck(delay);
    }

    return this.status;
  }

  private evaluateStatus(_lastErr?: any): void {
    let nextStatus: ProviderHealthStatus = "HEALTHY";
    let nextMessage: string | null = null;

    if (this.consecutiveFailures === 1) {
      nextStatus = "DEGRADED";
      nextMessage = "로컬 AI 응답이 다소 지연되고 있어요…";
    } else if (this.consecutiveFailures === 2) {
      nextStatus = "RECONNECTING";
      nextMessage = "로컬 AI 연결을 다시 확인하고 있어요…";
    } else if (this.consecutiveFailures >= 3) {
      nextStatus = "OFFLINE";
      nextMessage = "로컬 AI 연결이 원활하지 않습니다. Ollama 실행 상태를 확인해 주세요.";
    }

    this.updateStatus(nextStatus, nextMessage);
  }

  private updateStatus(newStatus: ProviderHealthStatus, newMessage: string | null): void {
    const changed = this.status !== newStatus || this.message !== newMessage;
    this.status = newStatus;
    this.message = newMessage;
    if (changed && this.onStateChange) {
      this.onStateChange(this.status, this.message);
    }
  }

  private async pingOllama(baseUrl: string): Promise<void> {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    // Use /api/version or root / - Ollama does not have /health!
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(`${cleanUrl}/api/version`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!res.ok) {
        // Fallback check on root endpoint
        const rootRes = await fetch(`${cleanUrl}/`, {
          method: "GET",
          signal: controller.signal,
        });
        if (!rootRes.ok) {
          throw new Error(`Ollama HTTP ping failed with status ${res.status}`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingEasyProxy(proxyUrl: string): Promise<void> {
    if (!proxyUrl) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const url = new URL(proxyUrl);
      let res: Response;
      try {
        res = await fetch(`${url.origin}/health`, {
          method: "GET",
          signal: controller.signal,
        });
        // 404 / 405 -> fallback to root /
        if (res.status === 404 || res.status === 405) {
          res = await fetch(`${url.origin}/`, {
            method: "GET",
            signal: controller.signal,
          });
        }
      } catch {
        // Network error on /health probe -> fallback to root /
        res = await fetch(`${url.origin}/`, {
          method: "GET",
          signal: controller.signal,
        });
      }

      if (res.status >= 500) {
        throw new Error(`EasyProxy ping failed with status ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export const providerHealth = new ProviderHealthMonitor();
