import assert from "node:assert";
import { PromptComposer } from "../src/core/prompt/PromptComposer";
import { CharacterCore } from "../src/core/character/CharacterCore";

export function testPromptComposer() {
  console.log("-> Running tests/prompt-composer.test.ts");

  const core = new CharacterCore();

  // 1. System Prompt blocks order: Author's note at bottom (Late guidance)
  const blocks = PromptComposer.composeBlocks({
    character: core.getCharacter(),
    persona: core.getPersona(),
    context: core.getContext(),
    mode: "rp",
    authorNote: "항상 다정하게 눈을 맞추며 대화해줘.",
  });

  assert.strictEqual(blocks[0].id, "base_constraints", "Base constraints must be top priority");
  const lastBlock = blocks[blocks.length - 1];
  assert.strictEqual(lastBlock.id, "author_note", "Author's Note must be last block in system prompt for recency");

  // 2. Chat messages order: Late high-priority guidance right before latest user message
  const chatMessages = PromptComposer.composeChatMessages({
    character: core.getCharacter(),
    persona: core.getPersona(),
    context: core.getContext(),
    mode: "rp",
    authorNote: "오늘 날씨에 맞춰 따뜻하게 인사해줘.",
    recentMessages: [
      { role: "user", content: "안녕 미쿠!" },
      { role: "assistant", content: "안녕! 오늘도 찾아와줘서 기뻐." },
      { role: "user", content: "오늘 하루는 어땠어?" },
    ],
  });

  assert.strictEqual(chatMessages[0].role, "system");
  assert.strictEqual(chatMessages[1].role, "user");
  assert.strictEqual(chatMessages[2].role, "assistant");
  // Late injected author note right before the latest user message
  const secondToLast = chatMessages[chatMessages.length - 2];
  const last = chatMessages[chatMessages.length - 1];
  assert.strictEqual(secondToLast.role, "system");
  assert(secondToLast.content.includes("Author's Note - Late High-Priority Guidance"));
  assert.strictEqual(last.role, "user");
  assert.strictEqual(last.content, "오늘 하루는 어땠어?");

  console.log("   ✓ PromptComposer tests passed.");
}
