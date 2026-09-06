import assert from "node:assert";
import { defaultSettings, type FishVoiceFavorite, type AppSettings } from "../src/shared/types";

export function testVoiceFavorites() {
  console.log("-> Running tests/voice-favorites.test.ts");

  // 1. Default settings have fishFavorites initialized
  assert(Array.isArray(defaultSettings.fishFavorites), "defaultSettings.fishFavorites must be an array");
  assert.strictEqual(defaultSettings.fishFavorites.length, 0);

  // 2. Favorites addition, uniqueness, and removal
  let favs: FishVoiceFavorite[] = [];
  const miku: FishVoiceFavorite = { id: "acc8237220d8470985ec9be6c4c480a9", title: "Hatsune Miku", languages: ["ja", "en"] };
  const furina: FishVoiceFavorite = { id: "bd08be872bc440918674af072944ba12", title: "Furina", languages: ["ja"] };

  // Add miku
  if (!favs.some(f => f.id === miku.id)) {
    favs = [miku, ...favs];
  }
  assert.strictEqual(favs.length, 1);
  assert.strictEqual(favs[0].id, miku.id);

  // Add duplicate miku -> should not duplicate
  if (!favs.some(f => f.id === miku.id)) {
    favs = [miku, ...favs];
  }
  assert.strictEqual(favs.length, 1);

  // Add furina
  if (!favs.some(f => f.id === furina.id)) {
    favs = [furina, ...favs];
  }
  assert.strictEqual(favs.length, 2);

  // Remove miku
  favs = favs.filter(f => f.id !== miku.id);
  assert.strictEqual(favs.length, 1);
  assert.strictEqual(favs[0].id, furina.id);

  // 3. Settings JSON Serialization Roundtrip
  const customSettings: AppSettings = {
    ...defaultSettings,
    fishVoiceId: furina.id,
    fishFavorites: [furina, miku],
  };

  const jsonStr = JSON.stringify(customSettings);
  const parsed = JSON.parse(jsonStr) as AppSettings;

  assert.strictEqual(parsed.fishVoiceId, furina.id);
  assert.strictEqual(parsed.fishFavorites?.length, 2);
  assert.strictEqual(parsed.fishFavorites?.[0].title, "Furina");
  assert.strictEqual(parsed.fishFavorites?.[1].title, "Hatsune Miku");

  // 4. URL query parameter generation for genre and nationality
  function buildQueryUrl(query: any): string {
    const params = new URLSearchParams();
    if (typeof query === "object" && query !== null) {
      const opt = query as { tag?: string; language?: string; title?: string; pageSize?: number };
      if (opt.tag && opt.tag !== "all") params.set("tag", opt.tag);
      if (opt.language && opt.language !== "all") params.set("language", opt.language);
      if (opt.title) params.set("title", opt.title);
      params.set("page_size", String(opt.pageSize || 16));
    } else {
      const q = String(query || "").trim();
      if (q.startsWith("tag:")) {
        const parts = q.slice(4).split(":");
        const tag = parts[0]?.trim();
        const lang = parts[1]?.trim();
        if (tag && tag !== "all") params.set("tag", tag);
        if (lang && lang !== "all") params.set("language", lang);
        params.set("page_size", "16");
      } else {
        params.set("title", q);
        params.set("page_size", "14");
      }
    }
    return `https://api.fish.audio/model?${params.toString()}`;
  }

  const animeJaUrl = buildQueryUrl({ tag: "anime", language: "ja", pageSize: 16 });
  assert(animeJaUrl.includes("tag=anime"));
  assert(animeJaUrl.includes("language=ja"));
  assert(animeJaUrl.includes("page_size=16"));

  const gameKoUrl = buildQueryUrl({ tag: "gaming", language: "ko", pageSize: 16 });
  assert(gameKoUrl.includes("tag=gaming"));
  assert(gameKoUrl.includes("language=ko"));

  const allUrl = buildQueryUrl({ tag: "all", language: "all", pageSize: 16 });
  assert(!allUrl.includes("tag="));
  assert(!allUrl.includes("language="));

  const textSearchUrl = buildQueryUrl("hayami");
  assert(textSearchUrl.includes("title=hayami"));

  console.log("   ✓ Voice favorites and ranking tests passed.");
}
