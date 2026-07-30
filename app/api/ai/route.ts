import { NextRequest, NextResponse } from "next/server";
import { getAnalysisSkill } from "@/lib/analysis-skills";

type RequestBody = {
  provider?: { kind?: string; baseUrl?: string; apiKey?: string };
  model?: string;
  question?: string;
  context?: unknown;
  skill?: string;
  task?: "analysis" | "dataset-discovery";
};

const allowedHosts = new Set(["api.openai.com", "openrouter.ai", "api.anthropic.com"]);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
let ollamaQueue: Promise<void> = Promise.resolve();

async function runOllamaSerially<T>(task: () => Promise<T>) {
  const previous = ollamaQueue;
  let release = () => {};
  ollamaQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function cleanBaseUrl(value: string, kind: string) {
  const fallback = kind === "ollama" ? "http://localhost:11434" : kind === "anthropic" ? "https://api.anthropic.com/v1" : kind === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
  const url = new URL(value || fallback);
  const isLoopback = loopbackHosts.has(url.hostname);
  if (url.protocol !== "https:" && !isLoopback) throw new Error("Provider URL must use HTTPS unless it is local");
  if (kind === "ollama" && !isLoopback) throw new Error("Local Ollama must use a loopback address");
  if (kind !== "custom" && kind !== "ollama" && !allowedHosts.has(url.hostname)) throw new Error("Provider URL does not match the selected provider");
  return url.toString().replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RequestBody;
    const kind = body.provider?.kind || "openai";
    const apiKey = body.provider?.apiKey?.trim();
    const model = body.model?.trim();
    const question = body.question?.trim();
    if (!model || !question || (kind !== "ollama" && !apiKey)) return NextResponse.json({ error: kind === "ollama" ? "Model and question are required." : "Provider, API key, model, and question are required." }, { status: 400 });
    const baseUrl = cleanBaseUrl(body.provider?.baseUrl || "", kind);
    const contextObject = typeof body.context === "object" && body.context ? body.context as Record<string, unknown> : {};
    const sourceDataset = typeof contextObject.sourceDataset === "object" && contextObject.sourceDataset ? contextObject.sourceDataset as Record<string, unknown> : {};
    const uploadedFileName = (typeof sourceDataset.uploadedFileName === "string" ? sourceDataset.uploadedFileName : "the uploaded dataset").replace(/[\r\n]/g, " ").slice(0, 160);
    const uploadedFormat = (typeof sourceDataset.uploadedFormat === "string" ? sourceDataset.uploadedFormat : "unknown").replace(/[^a-z0-9]/gi, "").slice(0, 16) || "unknown";
    const sourceBoundary = `Source boundary: the uploaded dataset is ${uploadedFileName} (${uploadedFormat}). FileName, MimeType, extension, storage URL, or similar values inside rows describe referenced record-level attachments and must never be presented as the uploaded dataset's format.`;
    const context = JSON.stringify(contextObject).slice(0, 12000);
    const skill = getAnalysisSkill(body.skill);
    const discovery = body.task === "dataset-discovery";
    const system = discovery
      ? `You are Lumen's dataset discovery engine. Infer what the uploaded data represents from field names, types, profile, and sample only. ${sourceBoundary} Explicitly distinguish the uploaded dataset container from file formats referenced by its rows. Do not treat IDs, UUIDs, row numbers, file sizes, byte counts, timestamps, or other technical metadata as business KPIs unless the dataset's purpose clearly requires it. Return ONLY one valid JSON object with this exact shape: {"name":"short domain-specific dataset name","description":"one sentence describing the record grain","summary":"2-3 evidence-based sentences explaining what matters first","primaryMetric":"exact numeric field name or null","primaryDimension":"exact categorical field name or null","timeField":"exact field name or null","suggestions":[{"title":"specific analysis","description":"why useful","prompt":"complete analysis request","skill":"executive|trend|anomaly|visual"},{"title":"...","description":"...","prompt":"...","skill":"..."},{"title":"...","description":"...","prompt":"...","skill":"..."}]}. Use exact supplied field names. Never invent fields or causal claims.`
      : `You are Lumen, a concise data analyst. Answer only from the supplied dataset profile and sample. ${sourceBoundary} When discussing a PDF, spreadsheet, image, or other file found in a row, call it a referenced attachment or record—never the uploaded dataset. Be explicit about uncertainty. Never claim fraud; describe anomalies as investigative leads. Keep the answer under 180 words. Format every answer as clean GitHub-style Markdown: put each heading on its own line, leave a blank line before lists, and use bullets for supporting evidence. Never place multiple headings or bullets on one line. The client renders charts on its visual canvas, so never draw ASCII, Unicode-block, or Markdown-table charts; explain the selected fields, aggregation, and evidence instead. Active analysis skill: ${skill.name}. ${skill.instruction}`;

    if (kind === "ollama") {
      return runOllamaSerially(async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(discovery ? 45_000 : 90_000),
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: 0,
            ...(discovery ? { format: "json" } : {}),
            options: { num_ctx: 4096, num_predict: discovery ? 420 : 500, temperature: 0.2 },
            messages: [{ role: "system", content: system }, { role: "user", content: `${sourceBoundary}\n\nQuestion:\n${question}\n\nDataset context:\n${context}` }],
          }),
        });
        const data = await response.json() as { message?: { content?: string }; error?: string };
        if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}`);
        return NextResponse.json({ answer: data.message?.content?.trim() });
      });
    }

    if (kind === "anthropic") {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(discovery ? 45_000 : 90_000),
        headers: { "content-type": "application/json", "x-api-key": apiKey!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: discovery ? 700 : 500, system, messages: [{ role: "user", content: `${sourceBoundary}\n\nQuestion:\n${question}\n\nDataset context:\n${context}` }] }),
      });
      const data = await response.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || `Anthropic returned ${response.status}`);
      return NextResponse.json({ answer: data.content?.map((item) => item.text || "").join("\n").trim() });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(discovery ? 45_000 : 90_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...(kind === "openrouter" ? { "HTTP-Referer": request.nextUrl.origin, "X-Title": "Lumen Decision Intelligence" } : {}) },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: discovery ? 700 : 500, ...(discovery && kind !== "custom" ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "system", content: system }, { role: "user", content: `${sourceBoundary}\n\nQuestion:\n${question}\n\nDataset context:\n${context}` }] }),
    });
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || `Provider returned ${response.status}`);
    return NextResponse.json({ answer: data.choices?.[0]?.message?.content?.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
