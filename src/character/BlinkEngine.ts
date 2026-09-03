import type { VRM } from "@pixiv/three-vrm";

export class BlinkEngine {
  private cooldown = 2.0;
  private phase: "open" | "closing" | "opening" = "open";
  private weight = 0;
  private pendingDoubleBlink = false;

  constructor(
    private readonly vrm: VRM,
    private readonly onBlink?: () => void
  ) {}

  update(delta: number, isSmiling: boolean = false): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    // Completely suppress blink while smiling to prevent eyelid tearing / double eye glitch
    if (isSmiling) {
      this.weight = 0;
      this.phase = "open";
      this.cooldown = 2.0;
      this.pendingDoubleBlink = false;
      em.setValue("blink", 0);
      return;
    }

    if (this.phase === "open") {
      this.cooldown -= delta;
      if (this.cooldown <= 0) {
        this.phase = "closing";
        this.onBlink?.();
      }
    } else if (this.phase === "closing") {
      // Closing duration: 0.06s (speed = 1 / 0.06 ≈ 16.67)
      this.weight = Math.min(1, this.weight + delta * 16.67);
      if (this.weight >= 1) this.phase = "opening";
    } else {
      // Opening duration: 0.12s (speed = 1 / 0.12 ≈ 8.33)
      this.weight = Math.max(0, this.weight - delta * 8.33);
      if (this.weight <= 0) {
        this.phase = "open";
        if (this.pendingDoubleBlink) {
          this.pendingDoubleBlink = false;
          // Quick second blink (150ms interval)
          this.cooldown = 0.15;
        } else {
          // 20% chance of natural double-blink, standard interval 2.0 ~ 6.0s
          this.pendingDoubleBlink = Math.random() < 0.20;
          this.cooldown = 2.0 + Math.random() * 4.0;
        }
      }
    }
    em.setValue("blink", this.weight);
  }
}
