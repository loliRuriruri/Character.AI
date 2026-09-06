import type { ChatMessage } from "../src/shared/types";

export class LlmError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export async function completeChat(opts: {
  provider: "ollama" | "gemini" | "easyproxy";
  model: string;
  ollamaUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  easyProxyUrl: string;
  messages: ChatMessage[];
  imageBase64?: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  if (opts.provider === "gemini") {
    return completeGemini(opts);
  }
  if (opts.provider === "easyproxy") {
    return completeEasyProxy(opts);
  }
  return completeOllama(opts);
}

async function completeGemini(opts: {
  geminiApiKey: string;
  geminiModel: string;
  messages: ChatMessage[];
  imageBase64?: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const apiKey = opts.geminiApiKey?.trim();
  if (!apiKey) {
    throw new LlmError("Gemini API 키가 입력되지 않았습니다. 설정창에서 API Key를 입력하세요.");
  }

  const model = opts.geminiModel || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemMsg = opts.messages.find((m) => m.role === "system")?.content || "";
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m, idx, arr) => {
      const parts: any[] = [{ text: m.content }];
      // If this is the last user message and we have an image, append inlineData
      if (idx === arr.length - 1 && m.role === "user" && opts.imageBase64) {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: opts.imageBase64,
          },
        });
      }
      return {
        role: m.role === "user" ? "user" : "model",
        parts,
      };
    });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
        generationConfig: {
          temperature: 0.75,
          maxOutputTokens: 1024,
        },
      }),
      signal: opts.signal,
    });
  } catch (err) {
    throw new LlmError("Gemini 서버 연결 실패: " + String(err));
  }

  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as any;
    throw new LlmError(`Gemini HTTP ${res.status}: ${errJson.error?.message || res.statusText}`, res.status);
  }

  const data = (await res.json()) as any;
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").toString();
  if (!text) throw new LlmError("Gemini에서 빈 응답이 반환되었습니다.");
  opts.onDelta(text);
  return text;
}

async function completeOllama(opts: {
  model: string;
  ollamaUrl: string;
  messages: ChatMessage[];
  imageBase64?: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const base = opts.ollamaUrl.replace(/\/$/, "");
  const url = base + "/api/chat";

  // When image is attached, prefer the local vision model huihui_ai/qwen3-vl-abliterated:8b-instruct
  const targetModel = opts.imageBase64 ? "huihui_ai/qwen3-vl-abliterated:8b-instruct" : (opts.model || "gemma4:12b");

  // If analyzing image, prepend strong vision instruction to system message
  const formattedMessages = opts.messages.map((m, idx, arr) => {
    let content = m.content;
    if (m.role === "system" && opts.imageBase64) {
      content = "너는 하츠네 미쿠다. 첨부된 캡처 이미지를 보고, 이미지 정중앙(마우스 커서 위치)에 있는 텍스트, 코드, 내용을 직접 읽어서 무엇인지 구체적으로 설명한다. 이전 대화와 상관없이 오직 이미지 내용에 집중하여 친절하게 설명한다.";
    }
    const item: any = { role: m.role, content };
    if (idx === arr.length - 1 && m.role === "user" && opts.imageBase64) {
      item.images = [opts.imageBase64];
    }
    return item;
  });

  const streamed = await ollamaRequest(url, {
    model: targetModel,
    messages: formattedMessages,
    stream: true,
    options: {
      num_predict: opts.imageBase64 ? 512 : 768,
      num_ctx: 4096,
      temperature: 0.7,
      top_p: 0.9,
    },
  }, opts.onDelta, opts.signal);
  if (streamed.trim().length > 0) return streamed;

  const retried = await ollamaRequest(url, {
    model: targetModel,
    messages: formattedMessages,
    stream: false,
    options: {
      num_predict: opts.imageBase64 ? 512 : 768,
      num_ctx: 4096,
      temperature: 0.7,
      top_p: 0.9,
    },
  }, opts.onDelta, opts.signal);
  if (retried.trim().length > 0) return retried;
  throw new LlmError(`${targetModel} 모델이 생각(Thinking) 단계에서 토큰 제한에 걸렸습니다. 캐릭터 챗에는 생각 지연 없는 Qwen2.5:14B 또는 Qwen3-VL을 권장합니다.`);
}

async function ollamaRequest(
  url: string,
  body: Record<string, unknown>,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new LlmError("Ollama 연결 실패: " + url + " — " + String(err));
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new LlmError("Ollama HTTP " + res.status + " " + t.slice(0, 400), res.status);
  }
  if (body.stream === true) return readOllamaNdjson(res, onDelta, signal);
  const json = (await res.json()) as { message?: { content?: string }; response?: string };
  const text = (json.message?.content ?? json.response ?? "").toString();
  if (text) onDelta(text);
  return text;
}

async function readOllamaNdjson(res: Response, onDelta: (chunk: string) => void, signal?: AbortSignal): Promise<string> {
  if (!res.body) throw new LlmError("Ollama stream had no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  while (true) {
    if (signal?.aborted) {
      try { await reader.cancel(); } catch {}
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) {
      try { await reader.cancel(); } catch {}
      break;
    }
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (signal?.aborted) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: { message?: { content?: string }; response?: string; done?: boolean; done_reason?: string; eval_count?: number };
      try { parsed = JSON.parse(trimmed); } catch { continue; }
      const piece = (parsed.message?.content ?? parsed.response ?? "").toString();
      if (piece.length > 0) { acc += piece; onDelta(piece); }
      if (parsed.done && parsed.done_reason === "length") {
        console.warn(`[Ollama] Generation hit token limit (eval_count=${parsed.eval_count})!`);
      }
    }
  }
  return acc;
}

async function completeEasyProxy(opts: {
  model: string;
  easyProxyUrl: string;
  messages: ChatMessage[];
  onDelta: (chunk: string) => void;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(opts.easyProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true, temperature: 0.8, max_tokens: 1024 }),
    });
  } catch (err) {
    throw new LlmError("EasyProxy 연결 실패: " + opts.easyProxyUrl + " — " + String(err));
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new LlmError("EasyProxy HTTP " + res.status + " " + t.slice(0, 400), res.status);
  }
  if (!res.body) throw new LlmError("EasyProxy stream had no body");
  return readOpenAiSse(res, opts.onDelta);
}

async function readOpenAiSse(res: Response, onDelta: (chunk: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const piece = json.choices?.[0]?.delta?.content ?? "";
        if (piece) { acc += piece; onDelta(piece); }
      } catch { /* ignore keepalives */ }
    }
  }
  if (acc.trim().length === 0) throw new LlmError("EasyProxy stream finished with empty content");
  return acc;
}
