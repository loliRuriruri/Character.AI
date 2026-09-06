import type { ChatMessage } from "../../shared/types";
import type { ConversationMemory } from "../character/types";
import {
  type ModelCapabilities,
  resolveModelCapabilities,
} from "../model/ModelCapabilities";

export interface MemoryManagerOptions {
  maxContextTokens?: number;
  modelCapabilities?: ModelCapabilities;
  modelName?: string;
  triggerThresholdRatio?: number; // default 0.75 of usableInputBudget
  keepRecentTurns?: number;        // default 8 messages (4 user-assistant pairs)
}

export interface StructuredSummaryPayload {
  summary: string;
  facts?: string[];
  relationship?: string;
  promises?: string[];
  openThreads?: string[];
}

export class MemoryManager {
  private memory: ConversationMemory;
  private recentMessages: ChatMessage[] = [];
  private capabilities: ModelCapabilities;
  private triggerThresholdRatio: number;
  private keepRecentTurns: number;
  private isSummarizing = false;

  constructor(opts?: MemoryManagerOptions) {
    if (opts?.modelCapabilities) {
      this.capabilities = opts.modelCapabilities;
    } else {
      this.capabilities = resolveModelCapabilities({
        modelName: opts?.modelName || "default",
        userContextSetting: opts?.maxContextTokens,
      });
    }

    this.triggerThresholdRatio = opts?.triggerThresholdRatio || 0.75;
    this.keepRecentTurns = opts?.keepRecentTurns || 8;

    this.memory = {
      rollingSummary: "",
      facts: [],
      structuredFacts: [],
      relationshipState: "첫 만남 이후 서로를 알아가며 신뢰를 쌓아가는 중",
      promises: [],
      structuredPromises: [],
      openThreads: [],
      structuredThreads: [],
      summarizedTurnCount: 0,
    };
  }

  /**
   * Update model capabilities dynamically when provider or model changes
   */
  updateCapabilities(caps: ModelCapabilities): void {
    this.capabilities = caps;
  }

  getCapabilities(): ModelCapabilities {
    return { ...this.capabilities };
  }

  getMemory(): ConversationMemory {
    return {
      ...this.memory,
      facts: [...this.memory.facts],
      structuredFacts: this.memory.structuredFacts ? [...this.memory.structuredFacts] : [],
      promises: [...this.memory.promises],
      structuredPromises: this.memory.structuredPromises ? [...this.memory.structuredPromises] : [],
      openThreads: [...this.memory.openThreads],
      structuredThreads: this.memory.structuredThreads ? [...this.memory.structuredThreads] : [],
    };
  }

  getRecentMessages(): ChatMessage[] {
    return [...this.recentMessages];
  }

  setRecentMessages(messages: ChatMessage[]): void {
    this.recentMessages = [...messages];
  }

  addMessage(msg: ChatMessage): void {
    this.recentMessages.push(msg);
  }

  /**
   * Estimate tokens roughly (0.75 tokens / character safe estimate)
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length * 0.75));
  }

  /**
   * Total estimated tokens for system prompt + recent messages
   */
  getTotalEstimatedTokens(systemPrompt: string): number {
    let tokens = this.estimateTokens(systemPrompt);
    for (const m of this.recentMessages) {
      tokens += this.estimateTokens(m.content);
    }
    return tokens;
  }

  /**
   * Determine if summarization should be triggered based on dynamic budget
   */
  shouldSummarize(systemPrompt: string): boolean {
    if (this.isSummarizing) return false;
    if (this.recentMessages.length <= this.keepRecentTurns) return false;

    const currentTokens = this.getTotalEstimatedTokens(systemPrompt);
    // Use dynamic usableInputBudget and threshold from ModelCapabilities
    const threshold = this.capabilities.summarizationThreshold || (this.capabilities.usableInputBudget * this.triggerThresholdRatio);
    return currentTokens >= threshold;
  }

  /**
   * Returns older messages eligible for pruning
   */
  getMessagesToSummarize(): ChatMessage[] {
    if (this.recentMessages.length <= this.keepRecentTurns) return [];
    const cutIndex = this.recentMessages.length - this.keepRecentTurns;
    return this.recentMessages.slice(0, cutIndex);
  }

  /**
   * Safe JSON parse for structured summary outputs
   */
  static parseSummaryJson(rawText: string): StructuredSummaryPayload | null {
    if (!rawText) return null;
    try {
      // 1. Check for json markdown block
      const jsonMatch = rawText.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
      const targetStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

      // 2. Direct parse or extract outermost JSON object
      const firstBrace = targetStr.indexOf("{");
      const lastBrace = targetStr.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const obj = JSON.parse(targetStr.slice(firstBrace, lastBrace + 1));
        if (typeof obj === "object" && obj !== null) {
          return {
            summary: typeof obj.summary === "string" ? obj.summary : "",
            facts: Array.isArray(obj.facts) ? obj.facts.map(String) : undefined,
            relationship: typeof obj.relationship === "string" ? obj.relationship : undefined,
            promises: Array.isArray(obj.promises) ? obj.promises.map(String) : undefined,
            openThreads: Array.isArray(obj.openThreads) ? obj.openThreads.map(String) : undefined,
          };
        }
      }
    } catch (err) {
      // Fallback on JSON parse failure
    }
    return null;
  }

  /**
   * Merge structured summary payload using strict memory merge rules
   */
  applyStructuredSummary(payload: StructuredSummaryPayload): void {
    const toPrune = this.getMessagesToSummarize();
    const prunedCount = toPrune.length;
    const currentTurn = this.memory.summarizedTurnCount + prunedCount;

    // 1. Merge Rolling Summary
    if (payload.summary && payload.summary.trim()) {
      if (this.memory.rollingSummary.trim()) {
        this.memory.rollingSummary = `${this.memory.rollingSummary.trim()}\n\n[대화 경과 요약]:\n${payload.summary.trim()}`;
      } else {
        this.memory.rollingSummary = payload.summary.trim();
      }
    }

    // 2. Merge Facts (Deduplication + Contradiction Resolution + Provenance)
    if (payload.facts && payload.facts.length > 0) {
      for (const rawFact of payload.facts) {
        this.mergeFact(rawFact, currentTurn);
      }
    }

    // 3. Merge Relationship (Latest explicit event priority)
    if (payload.relationship && payload.relationship.trim()) {
      this.memory.relationshipState = payload.relationship.trim();
    }

    // 4. Merge Promises (Active vs Completed resolution)
    if (payload.promises && payload.promises.length > 0) {
      for (const p of payload.promises) {
        this.mergePromise(p);
      }
    }

    // 5. Merge OpenThreads (Active vs Resolved removal)
    if (payload.openThreads && payload.openThreads.length > 0) {
      for (const ot of payload.openThreads) {
        this.mergeOpenThread(ot);
      }
    }

    this.memory.summarizedTurnCount += prunedCount;

    // 6. Sliding window slice
    if (this.recentMessages.length > this.keepRecentTurns) {
      const cutIndex = this.recentMessages.length - this.keepRecentTurns;
      this.recentMessages = this.recentMessages.slice(cutIndex);
    }
  }

  /**
   * Merge a single fact with deduplication and contradiction resolution
   */
  mergeFact(factText: string, currentTurn?: number): void {
    const clean = factText.trim();
    if (!clean || clean.length < 2) return;

    // Determine subject
    let subject: "user" | "character" | "world" = "world";
    if (/^(?:사용자|유저|너|당신|user)/i.test(clean) || clean.includes("사용자는") || clean.includes("유저는")) {
      subject = "user";
    } else if (/^(?:미쿠|캐릭터|나|보컬로이드|miku)/i.test(clean) || clean.includes("미쿠는")) {
      subject = "character";
    }

    // Contradiction detection: check for contrasting keywords on the same topic
    // E.g. "좋아함" vs "싫어함", "거주" vs "이사", "학생" vs "직장인"
    const isContradiction = (existing: string, incoming: string): boolean => {
      const extractKeyWords = (s: string) => {
        return s.replace(/[사용자|미쿠|는|은|을|를|이|가|에|의]/g, " ").trim().split(/\s+/);
      };
      const existKeys = extractKeyWords(existing);
      const incKeys = extractKeyWords(incoming);
      const sharedWords = existKeys.filter(w => incKeys.includes(w) && w.length >= 2);

      if (sharedWords.length > 0) {
        // If they share a main subject/topic keyword but have opposing polarity
        const hasContrast = (
          (existing.includes("좋아") && incoming.includes("싫어")) ||
          (existing.includes("싫어") && incoming.includes("좋아")) ||
          (existing.includes("살고") && incoming.includes("이사")) ||
          (existing.includes("못하") && incoming.includes("잘하"))
        );
        return hasContrast;
      }
      return false;
    };

    // Filter out contradicting old facts
    this.memory.facts = this.memory.facts.filter(oldFact => !isContradiction(oldFact, clean));
    if (this.memory.structuredFacts) {
      this.memory.structuredFacts = this.memory.structuredFacts.filter(sf => !isContradiction(sf.fact, clean));
    }

    // Deduplication check
    const normalized = clean.replace(/[\s.,!?'"]/g, "");
    const exists = this.memory.facts.some(f => f.replace(/[\s.,!?'"]/g, "") === normalized);
    if (!exists) {
      this.memory.facts.push(clean);
      if (!this.memory.structuredFacts) this.memory.structuredFacts = [];
      this.memory.structuredFacts.push({
        subject,
        fact: clean,
        sourceTurn: currentTurn,
        timestamp: Date.now(),
      });
      // Bounded capacity: keep most recent 25 facts
      if (this.memory.facts.length > 25) {
        this.memory.facts.shift();
        this.memory.structuredFacts.shift();
      }
    }
  }

  /**
   * Merge promises with completion handling
   */
  mergePromise(promiseText: string): void {
    const clean = promiseText.trim();
    if (!clean) return;

    const isCompleted = /(?:완료|지킴|달성|끝남|했음|해줌)/.test(clean);
    const extractWords = (s: string) => {
      return s.replace(/[\s.,!?'"완료지킴달성끝남했음해줌에볼을를이가의으로로는은]/g, " ").trim().split(/\s+/).filter(w => w.length >= 2);
    };
    const incomingWords = extractWords(clean);

    // If an existing promise matches this topic and it's completed, remove or update it
    let matched = false;
    if (this.memory.structuredPromises) {
      for (const sp of this.memory.structuredPromises) {
        const existingWords = extractWords(sp.text);
        const sharesTopic = incomingWords.some(w => existingWords.includes(w)) ||
          sp.text.replace(/[\s.,!?'"]/g, "").includes(clean.replace(/[\s.,!?'"완료지킴달성끝남했음해줌]/g, ""));
        if (sharesTopic) {
          if (isCompleted) {
            sp.status = "completed";
          }
          matched = true;
          break;
        }
      }
    }

    if (!matched && !isCompleted) {
      this.memory.promises.push(clean);
      if (!this.memory.structuredPromises) this.memory.structuredPromises = [];
      this.memory.structuredPromises.push({
        text: clean,
        status: "active",
        createdAt: Date.now(),
      });
      if (this.memory.promises.length > 10) {
        this.memory.promises.shift();
        this.memory.structuredPromises.shift();
      }
    }
  }

  /**
   * Merge open threads with resolution handling
   */
  mergeOpenThread(threadText: string): void {
    const clean = threadText.trim();
    if (!clean) return;

    const isResolved = /(?:해결|답변함|결정됨|끝남|완료)/.test(clean);
    const extractWords = (s: string) => {
      return s.replace(/[\s.,!?'"해결답변함결정됨완료에볼을를이가의으로로는은]/g, " ").trim().split(/\s+/).filter(w => w.length >= 2);
    };
    const incomingWords = extractWords(clean);

    if (this.memory.structuredThreads) {
      for (const st of this.memory.structuredThreads) {
        const existingWords = extractWords(st.text);
        const sharesTopic = incomingWords.some(w => existingWords.includes(w)) ||
          st.text.replace(/[\s.,!?'"]/g, "").includes(clean.replace(/[\s.,!?'"해결답변함결정됨완료]/g, ""));
        if (sharesTopic) {
          if (isResolved) {
            st.status = "resolved";
          }
          return;
        }
      }
    }

    if (!isResolved) {
      this.memory.openThreads.push(clean);
      if (!this.memory.structuredThreads) this.memory.structuredThreads = [];
      this.memory.structuredThreads.push({
        text: clean,
        status: "active",
        createdAt: Date.now(),
      });
      if (this.memory.openThreads.length > 10) {
        this.memory.openThreads.shift();
        this.memory.structuredThreads.shift();
      }
    }
  }

  /**
   * Heuristic fallback summarizer that analyzes messages deeply instead of 40-character slicing
   */
  applyFastPruning(): void {
    const toPrune = this.getMessagesToSummarize();
    if (toPrune.length === 0) return;

    // 1. Group turns into conversational narrative
    const topics: string[] = [];
    const extractedFacts: string[] = [];
    const extractedPromises: string[] = [];
    const extractedThreads: string[] = [];

    for (const msg of toPrune) {
      const text = msg.content.trim();
      if (!text) continue;

      // Extract user interests or stated facts
      if (msg.role === "user") {
        if (/(?:좋아해|좋아함|취미는|나는|내가|하고 있어|살아|일해|배우고)/.test(text)) {
          extractedFacts.push(`사용자 발언: ${text.slice(0, 50)}`);
        }
        if (/\?|어때|있을까|알려줘|어떻게/.test(text)) {
          extractedThreads.push(text.slice(0, 45));
        }
      }

      // Extract promises
      if (/(?:약속|다음에|꼭|해줄게|보여줄게|함께하자)/.test(text)) {
        extractedPromises.push(text.slice(0, 45));
      }

      // Narrative snippets (first sentence of each turn)
      const firstSentence = text.split(/[.!?\n]/)[0].trim();
      if (firstSentence.length >= 4) {
        topics.push(`${msg.role === "user" ? "사용자" : "미쿠"}: "${firstSentence}"`);
      }
    }

    const narrativeSummary = `이전 대화 흐름 (${toPrune.length}턴): ${topics.slice(0, 5).join(" -> ")}`;

    this.applyStructuredSummary({
      summary: narrativeSummary,
      facts: extractedFacts.slice(0, 4),
      promises: extractedPromises.slice(0, 3),
      openThreads: extractedThreads.slice(0, 3),
      relationship: this.memory.relationshipState,
    });
  }

  addFact(fact: string): void {
    this.mergeFact(fact);
  }

  addPromise(promise: string): void {
    this.mergePromise(promise);
  }

  addOpenThread(thread: string): void {
    this.mergeOpenThread(thread);
  }

  setSummarizing(val: boolean): void {
    this.isSummarizing = val;
  }

  clear(): void {
    this.recentMessages = [];
    this.memory.rollingSummary = "";
    this.memory.facts = [];
    this.memory.structuredFacts = [];
    this.memory.promises = [];
    this.memory.structuredPromises = [];
    this.memory.openThreads = [];
    this.memory.structuredThreads = [];
    this.memory.summarizedTurnCount = 0;
  }
}
