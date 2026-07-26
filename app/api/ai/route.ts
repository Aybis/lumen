import { NextRequest, NextResponse } from "next/server";

type RequestBody = {
  provider?: { kind?: string; baseUrl?: string; apiKey?: string };
  model?: string;
  question?: string;
  context?: unknown;
};

const allowedHosts = new Set(["api.openai.com", "openrouter.ai", "api.anthropic.com"]);

function cleanBaseUrl(value: string, kind: string) {
  const fallback = kind === "anthropic" ? "https://api.anthropic.com/v1" : kind === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
  const url = new URL(value || fallback);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Provider URL must use HTTPS");
  if (kind !== "custom" && !allowedHosts.has(url.hostname)) throw new Error("Provider URL does not match the selected provider");
  return url.toString().replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RequestBody;
    const kind = body.provider?.kind || "openai";
    const apiKey = body.provider?.apiKey?.trim();
    const model = body.model?.trim();
    const question = body.question?.trim();
    if (!apiKey || !model || !question) return NextResponse.json({ error: "Provider, API key, model, and question are required." }, { status: 400 });
    const baseUrl = cleanBaseUrl(body.provider?.baseUrl || "", kind);
    const context = JSON.stringify(body.context ?? {}).slice(0, 50000);
    const system = "You are Lumen, a concise data analyst. Answer only from the supplied dataset profile and sample. Be explicit about uncertainty. Never claim fraud; describe anomalies as investigative leads. Keep the answer under 180 words.";

    if (kind === "anthropic") {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 500, system, messages: [{ role: "user", content: `${question}\n\nDataset context:\n${context}` }] }),
      });
      const data = await response.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `Anthropic returned ${response.status}`);
      return NextResponse.json({ answer: data.content?.map((item) => item.text || "").join("\n").trim() });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...(kind === "openrouter" ? { "HTTP-Referer": request.nextUrl.origin, "X-Title": "Lumen Decision Intelligence" } : {}) },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 500, messages: [{ role: "system", content: system }, { role: "user", content: `${question}\n\nDataset context:\n${context}` }] }),
    });
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || `Provider returned ${response.status}`);
    return NextResponse.json({ answer: data.choices?.[0]?.message?.content?.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
