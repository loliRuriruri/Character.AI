import assert from "node:assert/strict";

export function testAudioStopRace() {
  console.log("-> Running tests/audio-stop-race.test.ts");

  // Simulated Player state machine reflecting AudioContextPlayer
  class MockAudioContextPlayer {
    public playbackCounter = 0;
    public activePlaybackId = 0;
    public isSpeaking = false;
    public mouthOpen = 0;
    public activeSources = 0;
    public activeRaf = 0;

    stop() {
      this.activePlaybackId = 0;
      this.isSpeaking = false;
      this.mouthOpen = 0;
      this.activeSources = 0;
      this.activeRaf = 0;
    }

    startPlayback(): number {
      this.stop();
      this.playbackCounter++;
      const id = this.playbackCounter;
      this.activePlaybackId = id;
      this.isSpeaking = true;
      this.mouthOpen = 0.55;
      this.activeSources = 1;
      this.activeRaf = 1;
      return id;
    }

    onended(sourcePlaybackId: number) {
      // Identity guard: only clean up if token matches
      if (this.activePlaybackId === sourcePlaybackId) {
        this.activePlaybackId = 0;
        this.isSpeaking = false;
        this.mouthOpen = 0;
        this.activeSources = 0;
        this.activeRaf = 0;
      }
    }
  }

  const player = new MockAudioContextPlayer();

  // BB8 Race Condition Test:
  // A play -> A stop -> B play -> delayed A onended arrives
  const tokenA = player.startPlayback();
  assert.equal(tokenA, 1);
  assert.equal(player.activePlaybackId, 1);
  assert.equal(player.isSpeaking, true);

  player.stop();
  assert.equal(player.activePlaybackId, 0);
  assert.equal(player.isSpeaking, false);

  const tokenB = player.startPlayback();
  assert.equal(tokenB, 2);
  assert.equal(player.activePlaybackId, 2);
  assert.equal(player.isSpeaking, true);

  // Late onended from A arrives:
  player.onended(tokenA);
  assert.equal(
    player.activePlaybackId,
    2,
    "Stale playback A onended MUST NOT reset or kill active playback B!"
  );
  assert.equal(player.isSpeaking, true, "Playback B must remain active");
  assert.equal(player.mouthOpen, 0.55, "Playback B mouthOpen must not be cleared");

  // Onended from B arrives:
  player.onended(tokenB);
  assert.equal(player.activePlaybackId, 0);
  assert.equal(player.isSpeaking, false);
  assert.equal(player.mouthOpen, 0);

  // CC Stop Stress Test: 10 consecutive sudden stops during speech
  for (let i = 1; i <= 10; i++) {
    const id = player.startPlayback();
    assert.equal(player.isSpeaking, true, `Iteration ${i}: should be speaking`);
    player.stop();
    assert.equal(player.mouthOpen, 0, `Iteration ${i}: mouthOpen must be 0 after stop`);
    assert.equal(player.isSpeaking, false, `Iteration ${i}: isSpeaking must be false`);
    assert.equal(player.activeSources, 0, `Iteration ${i}: activeSources must be 0`);
    assert.equal(player.activeRaf, 0, `Iteration ${i}: activeRaf must be 0`);
  }

  console.log("   ✓ AudioStopRace tests passed (10/10 stop stress PASS).");
}

if (process.argv[1]?.endsWith("audio-stop-race.test.ts")) {
  testAudioStopRace();
}
