import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { SrsCard } from "../src/shared/types";

function storagePath(): string {
  const dir = app.getPath("userData");
  return path.join(dir, "miku_srs_cards.json");
}

export class SrsEngine {
  private cards: SrsCard[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    const p = storagePath();
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (Array.isArray(raw)) this.cards = raw;
      } catch (err) {
        console.warn("Failed to load SRS cards:", err);
      }
    }
  }

  private save(): void {
    const p = storagePath();
    try {
      fs.writeFileSync(p, JSON.stringify(this.cards, null, 2), "utf-8");
    } catch (err) {
      console.warn("Failed to save SRS cards:", err);
    }
  }

  getAllCards(): SrsCard[] {
    return [...this.cards];
  }

  getDueCount(): number {
    const now = Date.now();
    return this.cards.filter((c) => c.nextReviewAt <= now).length;
  }

  getDueCards(): SrsCard[] {
    const now = Date.now();
    return this.cards.filter((c) => c.nextReviewAt <= now);
  }

  addCard(word: string, reading: string, meaning: string, exampleSentence = ""): SrsCard {
    const existing = this.cards.find((c) => c.word.trim() === word.trim());
    if (existing) {
      existing.reading = reading || existing.reading;
      existing.meaning = meaning || existing.meaning;
      existing.exampleSentence = exampleSentence || existing.exampleSentence;
      this.save();
      return existing;
    }

    const card: SrsCard = {
      id: "card_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      word: word.trim(),
      reading: reading.trim(),
      meaning: meaning.trim(),
      exampleSentence: exampleSentence.trim(),
      repetition: 0,
      intervalDays: 1,
      easeFactor: 2.5,
      nextReviewAt: Date.now(), // Due immediately for initial learning
      createdAt: Date.now(),
    };

    this.cards.unshift(card);
    this.save();
    return card;
  }

  reviewCard(cardId: string, grade: 1 | 2 | 3 | 4): SrsCard | null {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return null;

    // SuperMemo-2 (SM-2) Spaced Repetition Algorithm
    // Grade: 1 = Fail (Again), 2 = Hard, 3 = Good, 4 = Easy
    if (grade < 3) {
      card.repetition = 0;
      card.intervalDays = 1;
    } else {
      if (card.repetition === 0) {
        card.intervalDays = 1;
      } else if (card.repetition === 1) {
        card.intervalDays = grade === 4 ? 6 : 3;
      } else {
        card.intervalDays = Math.round(card.intervalDays * card.easeFactor);
      }
      card.repetition += 1;
    }

    // Update Ease Factor
    const q = grade + 1; // map 1..4 to 2..5
    card.easeFactor = Math.max(1.3, card.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

    // Set next review timestamp
    const oneDayMs = 24 * 60 * 60 * 1000;
    card.nextReviewAt = Date.now() + card.intervalDays * oneDayMs;

    this.save();
    return card;
  }

  deleteCard(cardId: string): boolean {
    const initialLen = this.cards.length;
    this.cards = this.cards.filter((c) => c.id !== cardId);
    if (this.cards.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }
}
