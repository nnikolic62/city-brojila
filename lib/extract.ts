import { MeterReadingSchema, meterReadingJsonSchema, type MeterReading } from "./schema";
import { PROMPTS, type PromptVersion } from "./prompts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Deo OpenRouter odgovora koji nam treba. */
type OpenRouterResponse = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { cost?: number };
  error?: { message?: string };
};

export type ExtractInput = {
  imageDataUrl: string;
  model: string;
  /** OpenRouter fallback modeli (koriste se ako primarni nije dostupan). */
  fallbackModels?: string[];
  promptVersion: PromptVersion;
  apiKey: string;
  timeoutMs?: number;
  /** Broj ponovnih pokušaja kad odgovor ne prođe Zod ili pukne mreža. */
  retries?: number;
};

export type ExtractResult = {
  parsed: MeterReading | null;
  raw: unknown;
  modelUsed: string | null;
  latencyMs: number;
  costUsd: number | null;
  attempts: number;
  error: string | null;
};

/**
 * Deljeni modul: koriste ga i API ruta i eval skripta (PLAN.md, faza 3.2).
 * Nikad ne baca izuzetak — greška ide u `error`, da eval može da nastavi.
 */
export async function extractMeterReading(input: ExtractInput): Promise<ExtractResult> {
  const { retries = 1, timeoutMs = 20000 } = input;
  const started = performance.now();
  let lastError: string | null = null;
  let lastRaw: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Citac brojila (prototip)",
        },
        body: JSON.stringify(buildRequestBody(input)),
      });

      // OpenRouter šalje headere odmah, pa timeout može da pukne tek pri čitanju tela —
      // res.text() tada baca TimeoutError koji hvata catch ispod (ne sme da se proguta).
      const text = await res.text();
      const body = safeJsonParse(text) as OpenRouterResponse | null;
      lastRaw = body ?? text;
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${body?.error?.message ?? "nepoznata greška"}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // nema smisla ponavljati
        continue;
      }
      if (!body) {
        lastError = "OpenRouter vratio odgovor koji nije JSON";
        continue;
      }

      const content = body?.choices?.[0]?.message?.content ?? undefined;
      const json = safeJsonParse(content);
      const parsed = MeterReadingSchema.safeParse(json);
      if (!parsed.success) {
        lastError = `Zod: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
        continue;
      }

      return {
        parsed: parsed.data,
        raw: body,
        modelUsed: body?.model ?? input.model,
        latencyMs: Math.round(performance.now() - started),
        costUsd: typeof body?.usage?.cost === "number" ? body.usage.cost : null,
        attempts: attempt,
        error: null,
      };
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  return {
    parsed: null,
    raw: lastRaw,
    modelUsed: null,
    latencyMs: Math.round(performance.now() - started),
    costUsd: null,
    attempts: retries + 1,
    error: lastError,
  };
}

function buildRequestBody(input: ExtractInput) {
  const models = [input.model, ...(input.fallbackModels ?? [])].filter(Boolean);
  return {
    ...(models.length > 1 ? { models } : { model: input.model }),
    temperature: 0,
    // Bez limita OpenRouter rezerviše kredit za maksimalan izlaz modela (npr. 65k) → HTTP 402.
    // Odgovor je ~200 tokena; rezerva ostaje za modele koji "razmišljaju".
    max_tokens: 2048,
    messages: [
      { role: "system", content: PROMPTS[input.promptVersion] },
      {
        role: "user",
        content: [
          { type: "text", text: "Očitaj brojilo sa slike." },
          { type: "image_url", image_url: { url: input.imageDataUrl } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "meter_reading", strict: true, schema: meterReadingJsonSchema },
    },
    // Rutiraj samo na provajdere koji podržavaju structured output.
    provider: { require_parameters: true },
    usage: { include: true },
  };
}

function safeJsonParse(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Neki modeli umotaju JSON u ```json ... ```
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
