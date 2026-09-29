import { z } from "zod";

const EnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "Nedostaje OPENROUTER_API_KEY u .env"),
  MODEL_PRIMARY: z.string().min(1, "Nedostaje MODEL_PRIMARY u .env (ID modela sa openrouter.ai/models)"),
  MODEL_FALLBACK: z.string().optional().default(""),
  PROMPT_VERSION: z.enum(["v1"]).default("v1"),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

/** Čita i validira env promenljive (samo na serveru). */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `- ${i.message}`).join("\n");
    throw new Error(`Neispravna konfiguracija:\n${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Poslovni pragovi (faza 6) — konfigurabilni na jednom mestu. */
export const RULES = {
  digitCount: {
    mechanical: { min: 5, max: 6 },
    electronic: { min: 5, max: 8 },
  },
  /** Maksimalan realan skok potrošnje između dva očitavanja (kWh). */
  maxJumpKwh: 3000,
  serialNumber: { pattern: /^[A-Z0-9]{6,16}$/ },
} as const;
