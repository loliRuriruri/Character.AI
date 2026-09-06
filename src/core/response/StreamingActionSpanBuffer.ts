import { isLikelyActionProse, NON_ACTION_EMPHASIS_REGEX } from "./ResponseParser";

export interface ActionSpanBufferOptions {
  mode?: "rp" | "chat" | "tutor" | "free";
}

export class StreamingActionSpanBuffer {
  private mode: "rp" | "chat" | "tutor";
  private buffer: string = "";
  private inAction: boolean = false;
  private actionBuffer: string = "";
  private inThink: boolean = false;

  constructor(options?: ActionSpanBufferOptions) {
    const rawMode = options?.mode || "chat";
    this.mode = (rawMode === "free" ? "chat" : rawMode) as "rp" | "chat" | "tutor";
  }

  setMode(mode: "rp" | "chat" | "tutor" | "free"): void {
    this.mode = (mode === "free" ? "chat" : mode) as "rp" | "chat" | "tutor";
  }

  /**
   * Process a streaming text delta.
   * Returns newly completed action spans (if any), clean speech text to feed to the TTS sentence chunker,
   * and clean display delta for chat UI rendering (excluding internal thinking tokens).
   */
  processDelta(delta: string): { completedActions: string[]; speechChunk: string; displayDelta: string } {
    this.buffer += delta;
    const completedActions: string[] = [];
    let speechChunk = "";
    let displayDelta = "";

    let i = 0;
    while (i < this.buffer.length) {
      // 0. Handle <think> / <thought> tags (Qwen / DeepSeek reasoning tokens)
      if (this.inThink) {
        const rest = this.buffer.slice(i);
        const closeThink = rest.indexOf("</think>");
        const closeThought = rest.indexOf("</thought>");
        let closeIdx = -1;
        let closeLen = 0;
        if (closeThink !== -1 && (closeThought === -1 || closeThink < closeThought)) {
          closeIdx = closeThink;
          closeLen = 8;
        } else if (closeThought !== -1) {
          closeIdx = closeThought;
          closeLen = 10;
        }

        if (closeIdx !== -1) {
          this.inThink = false;
          i += closeIdx + closeLen;
          continue;
        } else {
          // Check if buffer ends with partial closing tag like "</th"
          const lastLt = this.buffer.lastIndexOf("<");
          if (lastLt >= i && ("</think>".startsWith(this.buffer.slice(lastLt)) || "</thought>".startsWith(this.buffer.slice(lastLt)))) {
            i = lastLt;
            break;
          }
          i = this.buffer.length;
          break;
        }
      }

      const ch = this.buffer[i];

      if (!this.inAction) {
        // Check for opening <think> or <thought>
        if (this.buffer.startsWith("<think>", i)) {
          this.inThink = true;
          i += 7;
          continue;
        }
        if (this.buffer.startsWith("<thought>", i)) {
          this.inThink = true;
          i += 9;
          continue;
        }
        // If '<' is near buffer end, wait to see if it forms <think> or <thought>
        if (ch === "<") {
          const rest = this.buffer.slice(i);
          if ("<think>".startsWith(rest) || "<thought>".startsWith(rest)) {
            break;
          }
        }

        // Check for escaped asterisk: \*
        if (ch === "\\" && this.buffer[i + 1] === "*") {
          speechChunk += "*";
          displayDelta += "*";
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
              displayDelta += fullBold;
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
            const codeBlock = this.buffer.slice(i, blockEnd + 3);
            speechChunk += codeBlock;
            displayDelta += codeBlock;
            i = blockEnd + 3;
            continue;
          }
          // Inline code (`...`)
          const codeEnd = this.buffer.indexOf("`", i + 1);
          if (codeEnd === -1) {
            break;
          } else {
            const inlineCode = this.buffer.slice(i, codeEnd + 1);
            speechChunk += inlineCode;
            displayDelta += inlineCode;
            i = codeEnd + 1;
            continue;
          }
        } else {
          speechChunk += ch;
          displayDelta += ch;
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
            displayDelta += `*${candidate}*`;
            // Action prose is completely excluded from speechChunk!
          } else {
            // Non-action homonym, math, or emphasis (e.g. *손해*, *눈금*) -> preserved in speech
            speechChunk += ` ${candidate} `;
            displayDelta += ` ${candidate} `;
          }
          this.actionBuffer = "";
        } else {
          this.actionBuffer += ch;
          i++;
        }
      }
    }

    this.buffer = this.buffer.slice(i);
    return { completedActions, speechChunk, displayDelta };
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

    if (this.inThink) {
      this.inThink = false;
      this.buffer = ""; // unclosed thinking tokens are discarded!
    }

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
    this.inThink = false;
  }
}
