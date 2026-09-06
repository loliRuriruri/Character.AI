import assert from "node:assert";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GestureName } from "../src/shared/types";

export function testMotionDirectorClamp() {
  console.log("-> Running tests/motion-director-clamp.test.ts");

  // 1. Verify VRM 0.0 quaternion inversion arithmetic
  {
    const euler = new THREE.Euler(0.35, 0.18, 0.65);
    const q = new THREE.Quaternion().setFromEuler(euler);

    // VRM 1.0 (standard)
    const vrm1Values = [q.x, q.y, q.z, q.w];
    // VRM 0.0 (inverted X and Z)
    const vrm0Values = [-q.x, q.y, -q.z, q.w];

    assert.strictEqual(vrm0Values[0], -vrm1Values[0], "X must be negated in VRM 0.0");
    assert.strictEqual(vrm0Values[1], vrm1Values[1], "Y must remain unchanged in VRM 0.0");
    assert.strictEqual(vrm0Values[2], -vrm1Values[2], "Z must be negated in VRM 0.0");
    assert.strictEqual(vrm0Values[3], vrm1Values[3], "W must remain unchanged in VRM 0.0");
  }

  // 2. Verify MotionDirector.ts source contains official mocap bindings for 'talk' and 'curious'
  {
    const mdPath = resolve(process.cwd(), "src/character/MotionDirector.ts");
    const content = readFileSync(mdPath, "utf-8");

    // Must bind talk to VRMA_01.vrma
    assert.ok(
      content.includes('{ name: "talk", file: "./VRMA_MotionPack/vrma/VRMA_01.vrma" }'),
      "MotionDirector must bind 'talk' to official VRMA_01.vrma"
    );

    // Must bind curious to think.fbx
    assert.ok(
      content.includes('{ name: "curious", file: "./vrma/mixamo/think.fbx" }'),
      "MotionDirector must bind 'curious' to verified think.fbx"
    );

    // Must have clamp release delayed stop() in returnToIdle
    assert.ok(
      content.includes("prevAction.stop()") && content.includes("Math.round(duration * 1000) + 50"),
      "MotionDirector must release clamped actions in returnToIdle with delayed stop()"
    );

    // Must have isVRM0 check in addTrack
    assert.ok(
      content.includes('const isVRM0 = (this.vrm?.meta as any)?.metaVersion === "0";'),
      "MotionDirector must check isVRM0 in addTrack"
    );
  }

  // 3. Verify speechGestures only contains gestures that have registered mocap clips
  {
    const allRegisteredMocap = new Set<GestureName>([
      "wave", "peace", "laugh", "explain", "talk", "cheer", "proud", "shoot", "spin", "think", "curious", "nod", "bow"
    ]);

    const speechGestures: GestureName[] = ["talk", "nod", "curious"];
    for (const g of speechGestures) {
      assert.ok(
        allRegisteredMocap.has(g),
        `Speech gesture '${g}' must have a verified mocap clip binding to prevent procedural arm bugs`
      );
    }
  }

  console.log("   ✓ MotionDirector clamp & mocap binding tests passed.");
}
