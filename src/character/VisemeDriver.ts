import type { VRM } from "@pixiv/three-vrm";

export type VisemeName = "aa" | "ee" | "ih" | "oh" | "ou";
const ALL_VISEMES: readonly VisemeName[] = ["aa", "ee", "ih", "oh", "ou"] as const;

export class VisemeDriver {
  private chars: string[] = [];
  private t = 0;
  private dur = 0;
  private active = false;
  private fadeOutTimer = 0;
  private readonly fadeOutDuration = 0.15; // 0.15s fade to 0 on stop

  // Current interpolated weights (prevents audio popping/clicking)
  private currentWeights: Record<VisemeName, number> = {
    aa: 0,
    ee: 0,
    ih: 0,
    oh: 0,
    ou: 0,
  };

  private targetWeights: Record<VisemeName, number> = {
    aa: 0,
    ee: 0,
    ih: 0,
    oh: 0,
    ou: 0,
  };

  get isActive(): boolean {
    return this.active || this.fadeOutTimer > 0;
  }

  // Single Arbitration Point guard: when managed by LipSyncController, direct writes to VRM are suppressed.
  public directWriteEnabled = false;

  getWeights(): Record<VisemeName, number> {
    return { ...this.currentWeights };
  }

  constructor(private readonly vrm: VRM) {}

  speak(text: string, durationSec: number): void {
    this.chars = Array.from(text.replace(/\s+/g, ""));
    this.t = 0;
    this.dur = Math.max(0.4, durationSec);
    this.active = this.chars.length > 0;
    this.fadeOutTimer = 0;
  }

  stop(): void {
    if (!this.active && this.fadeOutTimer <= 0) return;
    this.active = false;
    this.fadeOutTimer = this.fadeOutDuration;
    for (const name of ALL_VISEMES) {
      this.targetWeights[name] = 0;
    }
  }

  update(delta: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    if (this.active) {
      this.t += delta;
      if (this.t >= this.dur) {
        this.stop();
      } else {
        const idx = Math.min(
          this.chars.length - 1,
          Math.floor((this.t / this.dur) * this.chars.length)
        );
        const activeVis = visemeForChar(this.chars[idx] ?? "");

        // Set targets: active vowel is 0.4 (when combined with 0.2 emotion, sum <= 0.6)
        for (const name of ALL_VISEMES) {
          this.targetWeights[name] = name === activeVis ? 0.4 : 0;
        }
      }
    } else if (this.fadeOutTimer > 0) {
      this.fadeOutTimer -= delta;
      if (this.fadeOutTimer <= 0) {
        this.fadeOutTimer = 0;
        for (const name of ALL_VISEMES) {
          this.currentWeights[name] = 0;
          this.targetWeights[name] = 0;
          if (this.directWriteEnabled) em.setValue(name, 0);
        }
        return;
      }
    }

    // 8~12ms ramp interpolation rate (tau ~ 0.010s => factor ~ 90 * delta)
    const rampFactor = Math.min(1.0, delta * 90.0);
    let hasNonZero = false;

    for (const name of ALL_VISEMES) {
      const cur = this.currentWeights[name];
      const target = this.targetWeights[name];
      const next = cur + (target - cur) * rampFactor;
      this.currentWeights[name] = Math.abs(next) < 0.001 ? 0 : next;
      if (this.currentWeights[name] > 0) hasNonZero = true;
      if (this.directWriteEnabled) em.setValue(name, this.currentWeights[name]);
    }

    if (!this.active && this.fadeOutTimer <= 0 && !hasNonZero) {
      if (this.directWriteEnabled) {
        for (const name of ALL_VISEMES) em.setValue(name, 0);
      }
    }
  }
}

/**
 * Korean Hangul & Latin Vowel Extraction:
 * Hangul syllables (0xAC00 - 0xD7A3):
 *   jungseongIndex = Math.floor(((code - 0xAC00) / 28) % 21)
 */
function visemeForChar(ch: string): VisemeName {
  const code = ch.charCodeAt(0);

  // Hangul Syllables
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jung = Math.floor(((code - 0xac00) / 28) % 21);
    switch (jung) {
      case 0:  // ㅏ
      case 2:  // ㅑ
      case 4:  // ㅓ
      case 6:  // ㅕ
      case 9:  // ㅘ
        return "aa";
      case 1:  // ㅐ
      case 3:  // ㅒ
      case 5:  // ㅔ
      case 7:  // ㅖ
      case 10: // ㅙ
      case 11: // ㅚ
      case 15: // ㅞ
        return "ee";
      case 16: // ㅟ
      case 19: // ㅢ
      case 20: // ㅣ
        return "ih";
      case 8:  // ㅗ
      case 12: // ㅛ
        return "oh";
      case 13: // ㅜ
      case 14: // ㅝ
      case 17: // ㅠ
      case 18: // ㅡ
        return "ou";
      default:
        return "aa";
    }
  }

  // Latin letters
  const lower = ch.toLowerCase();
  if (lower === "a") return "aa";
  if (lower === "e") return "ee";
  if (lower === "i") return "ih";
  if (lower === "o") return "oh";
  if (lower === "u") return "ou";

  // Default neutral mouth
  return "aa";
}
