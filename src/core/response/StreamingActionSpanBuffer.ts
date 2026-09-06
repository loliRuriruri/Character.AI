import { isLikelyActionProse, NON_ACTION_EMPHASIS_REGEX } from "./ResponseParser";

export interface ActionSpanBufferOptions {
  mode?: "rp" | "chat" | "tutor" | "free";
}

export class StreamingActionSpanBuffer {
  private mode: "rp" | "chat" | "tutor";
  private buffer: string = "";
  private inAction: boolean = false;
  private actionBuffer: string = "";

  constructor(options?: ActionSpanBufferOptions) {
    const rawMode = options?.mode || "chat";
    this.mode = (rawMode === "free" ? "chat" : rawMode) as "rp" | "chat" | "tutor";
  }

  setMode(mode: "rp" | "chat" | "tutor" | "free"): void {
    this.mode = (mode === "free" ? "chat" : mode) as "rp" | "chat" | "tutor";
  }

  /**
   * Process a streaming text delta.
   * Returns newly completed action spans (if any) and clean speech text to feed to the TTS sentence chunker.
   */
  processDelta(delta: string): { completedActions: string[]; speechChunk: string } {
    this.buffer += delta;
    const completedActions: string[] = [];
    let speechChunk = "";

    let i = 0;
    while (i < this.buffer.length) {
      const ch = this.buffer[i];

      if (!this.inAction) {
        // Check for escaped asterisk: \*
        if (ch === "\\" && this.buffer[i + 1] === "*") {
          speechChunk += "*";
          i += 2;
          continue;
        }

        // Check for opening asterisk
        if (ch === "*") {
          // If at the end of the buffer, wait for the next chunk to see if it's ** or ***
          if (i === this.buffer.length - 1) {
            break;
          }

          // Check for bold (**) or bold-italic (***)
          if (this.buffer[i + 1] === "*") {
            const boldEnd = this.buffer.indexOf("**", i + 2);
            if (boldEnd === -1) {
              // Incomplete markdown bold, wait for subsequent deltas
              break;
            } else {
              const fullBold = this.buffer.slice(i, boldEnd + 2);
              speechChunk += fullBold;
              i = boldEnd + 2;
              continue;
            }
          }

          // Action span begins!
          this.inAction = true;
          this.actionBuffer = "";
          i++;
        } else if (ch === "`") {
          // Check for code blocks (```)
          if (this.buffer.slice(i, i + 3) === "```") {
            const blockEnd = this.buffer.indexOf("```", i + 3);
            if (blockEnd === -1) break;
            speechChunk += this.buffer.slice(i, blockEnd + 3);
            i = blockEnd + 3;
            continue;
          }
          // Inline code (`...`)
          const codeEnd = this.buffer.indexOf("`", i + 1);
          if (codeEnd === -1) {
            break;
          } else {
            speechChunk += this.buffer.slice(i, codeEnd + 1);
            i = codeEnd + 1;
            continue;
          }
        } else {
          speechChunk += ch;
          i++;
        }
      } else {
        // Inside action span: wait for closing unescaped asterisk '*'
        if (ch === "*" && this.buffer[i - 1] !== "\\") {
          this.inAction = false;
          i++;
          const candidate = this.actionBuffer.trim();

          const isAction = this.isActionSpan(candidate);
          if (isAction) {
            completedActions.push(candidate);
            // Action prose is completely excluded from speechChunk!
          } else {
            // Non-action homonym, math, or emphasis (e.g. *손해*, *눈금*) -> preserved in speech
            speechChunk += ` ${candidate} `;
          }
          this.actionBuffer = "";
        } else {
          this.actionBuffer += ch;
          i++;
        }
      }
    }

    this.buffer = this.buffer.slice(i);
    return { completedActions, speechChunk };
  }

  /**
   * Determine whether candidate string inside *...* is an action based on mode
   */
  private isActionSpan(text: string): boolean {
    if (!text || text.length < 2 || text.length > 150) return false;
    // Pure numbers or mathematical operators
    if (/^[\d\s+\-*/=.,<>]+$/.test(text)) return false;
    // File wildcard extensions (*.ts, *.json) or pointer identifiers (*ptr)
    if (/^\.[a-zA-Z0-9]+$/.test(text)) return false;
    if (/^[a-zA-Z_]\w*$/.test(text)) return false;
    // Homonym non-action blacklist
    if (NON_ACTION_EMPHASIS_REGEX.test(text)) return false;

    if (this.mode === "rp") {
      // In RP mode, any valid prose inside *...* (excluding code/math/homonyms) is a stage direction
      return true;
    } else {
      // In Chat / Tutor mode, must be likely action prose
      return isLikelyActionProse(text);
    }
  }

  /**
   * Called when the LLM response stream completes.
   * Flushes any unclosed spans safely so no trailing speech is dropped.
   */
  flush(): { remainingActions: string[]; remainingSpeech: string } {
    const remainingActions: string[] = [];
    let remainingSpeech = "";

    if (this.inAction) {
      const candidate = this.actionBuffer.trim();
      if (this.isActionSpan(candidate)) {
        remainingActions.push(candidate);
      } else {
        remainingSpeech += (this.actionBuffer ? `*${this.actionBuffer}` : "*");
      }
      this.inAction = false;
      this.actionBuffer = "";
    }

    if (this.buffer) {
      remainingSpeech += this.buffer;
      this.buffer = "";
    }

    return { remainingActions, remainingSpeech };
  }

  reset(): void {
    this.buffer = "";
    this.inAction = false;
    this.actionBuffer = "";
  }
}
