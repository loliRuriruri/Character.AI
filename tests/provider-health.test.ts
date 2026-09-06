import assert from "node:assert";
import { ProviderHealthMonitor } from "../electron/providerHealth";

export function testProviderHealth() {
  console.log("-> Running tests/provider-health.test.ts");

  const monitor = new ProviderHealthMonitor();

  // 1. Initial state is HEALTHY
  assert.strictEqual(monitor.getStatus(), "HEALTHY");

  // 2. 1 failure -> DEGRADED
  monitor.recordInferenceFailure(new Error("Transient connection timeout"));
  assert.strictEqual(monitor.getStatus(), "DEGRADED");
  assert(monitor.getMessage()?.includes("지연"));

  // 3. 2 failures -> RECONNECTING
  monitor.recordInferenceFailure(new Error("Connection reset by peer"));
  assert.strictEqual(monitor.getStatus(), "RECONNECTING");
  assert(monitor.getMessage()?.includes("다시 확인"));

  // 4. 3 failures -> OFFLINE
  monitor.recordInferenceFailure(new Error("Host unreachable"));
  assert.strictEqual(monitor.getStatus(), "OFFLINE");
  assert(monitor.getMessage()?.includes("Ollama"));

  // 5. Success recovers immediately to HEALTHY
  monitor.recordInferenceSuccess();
  assert.strictEqual(monitor.getStatus(), "HEALTHY");
  assert.strictEqual(monitor.getMessage(), null);

  console.log("   ✓ ProviderHealth tests passed.");
}
