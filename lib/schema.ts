import { z } from "zod";

/**
 * JEDINI IZVOR ISTINE za oblik podataka (vidi PLAN.md, faza 2).
 * Iz ove šeme se izvode: JSON Schema za model, TS tipovi, validacija odgovora i ground trutha.
 *
 * Pravila za strict structured output:
 * - sva polja su obavezna (nema .optional()), a "možda nema" se izražava kroz .nullable()
 * - objekti su strict (additionalProperties: false)
 * - cifre su STRINGOVI (čuvaju vodeće nule i broj cifara)
 */

const digits = z.string().regex(/^\d+$/, "samo cifre");

export const ReadingValueSchema = z
  .strictObject({
    integer: digits.describe(
      "Celobrojni deo stanja u kWh, tačno onako kako piše na brojilu, UKLJUČUJUĆI vodeće nule. Bez razmaka."
    ),
    decimal: digits
      .nullable()
      .describe(
        "Decimalni deo: cifra(e) u crvenom/odvojenom polju ili iza decimalnog zareza. null ako ne postoji."
      ),
  })
  .describe("Jedno stanje brojila");

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export const MeterReadingSchema = z.strictObject({
  isMeter: z
    .boolean()
    .describe("true samo ako je na slici brojilo ELEKTRIČNE energije."),
  meterKind: z
    .enum(["mechanical", "electronic"])
    .nullable()
    .describe("mechanical = valjčići sa ciframa; electronic = LCD ekran. null ako se ne može odrediti."),
  tariffType: z
    .enum(["single", "dual"])
    .nullable()
    .describe("single = jednotarifno; dual = dvotarifno (VT i NT). null ako se ne može odrediti."),
  serialNumber: z
    .string()
    .nullable()
    .describe("Fabrički/serijski broj brojila, bez razmaka i crtica. null ako se ne vidi jasno."),
  readings: z.strictObject({
    single: ReadingValueSchema.nullable().describe("Stanje jednotarifnog brojila. null za dvotarifno."),
    vt: ReadingValueSchema.nullable().describe("Viša tarifa (VT, T1, 1.8.1). null ako se ne vidi."),
    nt: ReadingValueSchema.nullable().describe("Niža tarifa (NT, T2, 1.8.2). null ako se ne vidi."),
  }),
  visibleTariff: z
    .enum(["single", "vt", "nt"])
    .nullable()
    .describe("Samo za LCD: koja tarifa je trenutno prikazana na ekranu. null za mehanička."),
  imageQuality: z.strictObject({
    blur: z.boolean().describe("Slika je zamućena."),
    glare: z.boolean().describe("Odsjaj prekriva deo cifara."),
    partial: z.boolean().describe("Deo brojčanika je odsečen ili zaklonjen."),
  }),
  confidence: z.strictObject({
    serialNumber: ConfidenceSchema,
    readings: ConfidenceSchema,
  }),
});

export type ReadingValue = z.infer<typeof ReadingValueSchema>;
export type MeterReading = z.infer<typeof MeterReadingSchema>;
export type TariffKey = keyof MeterReading["readings"];

/** JSON Schema koja se šalje modelu kao response_format. */
export const meterReadingJsonSchema = z.toJSONSchema(MeterReadingSchema, {
  target: "draft-7",
});

/* ---------- Ground truth (dataset/ground-truth.json) ---------- */

/** Ground truth ne sadrži samoprocenu modela ni kvalitet slike (to nije "istina"). */
export const ExpectedSchema = MeterReadingSchema.omit({
  imageQuality: true,
  confidence: true,
});

export const GroundTruthEntrySchema = z.strictObject({
  id: z.string().regex(/^m\d{3}$/),
  file: z.string(),
  split: z.enum(["dev", "holdout"]),
  tags: z.array(z.string()),
  expected: ExpectedSchema,
  notes: z.string().optional(),
});
export const GroundTruthSchema = z.array(GroundTruthEntrySchema);
export type GroundTruthEntry = z.infer<typeof GroundTruthEntrySchema>;

/* ---------- API ugovor (POST /api/read-meter) ---------- */

export const PreviousReadingSchema = z.strictObject({
  single: digits.optional(),
  vt: digits.optional(),
  nt: digits.optional(),
});
export type PreviousReading = z.infer<typeof PreviousReadingSchema>;

export type WarningCode =
  | "NOT_A_METER"
  | "BAD_IMAGE"
  | "LOWER_THAN_PREVIOUS"
  | "DIGIT_COUNT"
  | "MISSING_TARIFF"
  | "UNEXPECTED_TARIFF"
  | "UNREALISTIC_JUMP"
  | "LOW_CONFIDENCE"
  | "SERIAL_FORMAT";

export type Warning = {
  code: WarningCode;
  field?: TariffKey | "serialNumber";
  message: string;
};

export type ReadStatus = "ok" | "needs_review" | "retake";

export type ReadMeterResponse =
  | {
      status: ReadStatus;
      data: MeterReading & { readingDate: string };
      warnings: Warning[];
      meta: {
        model: string;
        promptVersion: string;
        latencyMs: number;
        costUsd: number | null;
      };
    }
  | { status: "error"; code: string; message: string };
