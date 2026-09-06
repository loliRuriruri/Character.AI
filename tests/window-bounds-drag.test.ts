import assert from "node:assert/strict";
import type { ViewMode } from "../src/shared/types";

export function getCharacterWindowTargetDimensions(viewMode?: ViewMode | string): { width: number; height: number } {
  const isPip = viewMode === "pip";
  return {
    width: isPip ? 200 : 440,
    height: isPip ? 300 : 580,
  };
}

export function computeDragBounds(
  currentBounds: { x: number; y: number; width: number; height: number },
  delta: { dx: number; dy: number },
  viewMode: ViewMode
): { x: number; y: number; width: number; height: number } {
  const dx = Math.round(Number(delta.dx) || 0);
  const dy = Math.round(Number(delta.dy) || 0);
  const target = getCharacterWindowTargetDimensions(viewMode);
  return {
    x: Math.round(currentBounds.x + dx),
    y: Math.round(currentBounds.y + dy),
    width: target.width,
    height: target.height,
  };
}

export function testWindowBoundsDrag(): void {
  // Test 1: Canonical dimensions for each view mode
  const fullDim = getCharacterWindowTargetDimensions("full");
  assert.equal(fullDim.width, 440, "Full mode width must be 440");
  assert.equal(fullDim.height, 580, "Full mode height must be 580");

  const upperDim = getCharacterWindowTargetDimensions("upper");
  assert.equal(upperDim.width, 440, "Upper mode width must be 440");
  assert.equal(upperDim.height, 580, "Upper mode height must be 580");

  const pipDim = getCharacterWindowTargetDimensions("pip");
  assert.equal(pipDim.width, 200, "PIP mode width must be 200");
  assert.equal(pipDim.height, 300, "PIP mode height must be 300");

  const defaultDim = getCharacterWindowTargetDimensions(undefined);
  assert.equal(defaultDim.width, 440, "Default fallback width must be 440");
  assert.equal(defaultDim.height, 580, "Default fallback height must be 580");

  // Test 2: Drag bounds update preserves width and height strictly invariant
  let bounds = { x: 1000, y: 400, width: 440, height: 580 };
  const deltas = [
    { dx: 5, dy: -3 },
    { dx: -12, dy: 8 },
    { dx: 25, dy: 15 },
    { dx: 0, dy: -10 },
  ];

  for (const d of deltas) {
    bounds = computeDragBounds(bounds, d, "full");
    assert.equal(bounds.width, 440, "Width must never drift or balloon during drag");
    assert.equal(bounds.height, 580, "Height must never drift or balloon during drag");
  }
  assert.equal(bounds.x, 1018);
  assert.equal(bounds.y, 410);

  // Test 3: Self-healing against corrupted/bloated bounds (e.g. from previous DPI ballooning)
  const bloatedBounds = { x: 500, y: 300, width: 990, height: 1110 };
  const healedBounds = computeDragBounds(bloatedBounds, { dx: 2, dy: 3 }, "full");
  assert.equal(healedBounds.width, 440, "Bloated bounds must be immediately healed to canonical 440");
  assert.equal(healedBounds.height, 580, "Bloated bounds must be immediately healed to canonical 580");

  console.log("   ✓ Window Bounds & Drag Invariant tests passed.");
}
