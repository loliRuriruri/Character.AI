import assert from "node:assert";
import { resolveModelCapabilities, KNOWN_MODEL_PRESETS } from "../src/core/model/ModelCapabilities";

export function testDynamicContext() {
  console.log("-> Running tests/dynamic-context.test.ts");

  // 1. Provider capability priority
  {
    const caps = resolveModelCapabilities({
      modelName: "custom-local",
      providerReportedContext: 65536,
    });
    assert.strictEqual(caps.contextWindow, 65536);
    assert.strictEqual(caps.source, "provider");
    assert(caps.usableInputBudget > 50000);
    assert.strictEqual(caps.summarizationThreshold, Math.round(caps.usableInputBudget * 0.75));
  }

  // 2. Known model presets
  {
    const gemma = resolveModelCapabilities({ modelName: "gemma4:12b" });
    assert.strictEqual(gemma.contextWindow, 8192);
    assert.strictEqual(gemma.source, "preset");

    const qwen = resolveModelCapabilities({ modelName: "qwen2.5:14b" });
    assert.strictEqual(qwen.contextWindow, 32768);
    assert.strictEqual(qwen.source, "preset");

    const gemini = resolveModelCapabilities({ modelName: "gemini-2.5-flash" });
    assert.strictEqual(gemini.contextWindow, 1048576);
    assert.strictEqual(gemini.source, "preset");
  }

  // 3. User setting fallback
  {
    const userCaps = resolveModelCapabilities({
      modelName: "unknown-model",
      userContextSetting: 16384,
    });
    assert.strictEqual(userCaps.contextWindow, 16384);
    assert.strictEqual(userCaps.source, "user");
  }

  // 4. Conservative fallback
  {
    const fallback = resolveModelCapabilities({ modelName: "unknown-mystery-model" });
    assert.strictEqual(fallback.contextWindow, 4096);
    assert.strictEqual(fallback.source, "fallback");
    assert(fallback.usableInputBudget > 0);
  }

  console.log("   ✓ DynamicContext tests passed.");
}
