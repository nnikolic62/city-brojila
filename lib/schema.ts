import { z } from "zod";

/**
 * JEDINI IZVOR ISTINE za oblik podataka (vidi docs/PRD.md, PLAN.md faza 2).
 * Iz ove šeme se izvode: JSON Schema za model, TS tipovi, validacija odgovora i ground trutha.
 *
 * Pravila za strict structured output:
 * - sva polja su obavezna (nema .optional()), a "možda nema" se izražava kroz .nullable()
 * - objekti su strict (additionalProperties: false)
 * - OBIS vrednosti su stringovi tačno kako pišu na brojilu (vodeće nule, bez jedinice)
 */

const fourDigitYear = z
  .string()
  .regex(/^\d{4}$/, "tačno četiri cifre");

/** Jedna OBIS stavka vidljiva na slici (izlaz modela po slici). */
export const ObisReadingSchema = z
  .strictObject({
    code: z
      .string()
      .min(1)
      .describe(
        "OBIS kod tačno kako je otisnut na brojilu (npr. 1.8.1, 15.8.1). Samo kodovi vidljivi na ovoj slici — ne izmišljati.",
      ),
    value: z
      .string()
      .describe(
        "Stanje kao jedan string tačno kako piše na displeju (vodeće nule, decimala uključena u string ako je tako prikazano). Bez sufiksa jedinice (kWh).",
      ),
  })
  .describe("Očitanje za jedan OBIS kod");

/** Odgovor vision modela za jednu fotografiju. */
export const MeterReadingSchema = z.strictObject({
  isMeter: z
    .boolean()
    .describe("true samo ako je na slici brojilo ELEKTRIČNE energije."),
  serialNumber: z
    .string()
    .nullable()
    .describe(
      "Fabrički/serijski broj sa tablice brojila (ne kod tipa/modela, npr. ne E311N2A20). Bez razmaka i crtica. null ako na slici nije jasno vidljiv i čitljiv — ne nagađati.",
    ),
  manufacturer: z
    .string()
    .nullable()
    .describe(
      "Naziv proizvođača (npr. EWG, Meter&Control). Samo marka — ne model/tip. null ako nečitljivo — ne nagađati.",
    ),
  yearOfManufacture: fourDigitYear
    .nullable()
    .describe("Godina proizvodnje — tačno četiri cifre. null ako nečitljivo — ne nagađati."),
  obis: z
    .array(ObisReadingSchema)
    .describe("Svi OBIS kodovi vidljivo otisnuti na ovoj slici. Prazan niz ako nijedan nije vidljiv."),
});

export type ObisReading = z.infer<typeof ObisReadingSchema>;
export type MeterReading = z.infer<typeof MeterReadingSchema>;

/** JSON Schema koja se šalje modelu kao response_format (jedna slika). */
export const meterReadingJsonSchema = z.toJSONSchema(MeterReadingSchema, {
  target: "draft-7",
});

/* ---------- Spojeni rezultat (server, ne model) ---------- */

export const MergedObisReadingSchema = z.strictObject({
  code: z.string().min(1),
  value: z.string().nullable(),
  review: z.boolean(),
});

export const MergedMeterReadingSchema = z.strictObject({
  serialNumber: z.string(),
  manufacturer: z.string().nullable(),
  yearOfManufacture: fourDigitYear.nullable(),
  obis: z.array(MergedObisReadingSchema),
});

export type MergedObisReading = z.infer<typeof MergedObisReadingSchema>;
export type MergedMeterReading = z.infer<typeof MergedMeterReadingSchema>;

/* ---------- Ground truth (dataset/ground-truth.json) ---------- */

/** Ground truth = očekivani izlaz modela po slici (eval). */
export const ExpectedSchema = MeterReadingSchema;

export const GroundTruthEntrySchema = z.strictObject({
  id: z.string().regex(/^(m\d{3}|im\d+-\d+)$/),
  file: z.string(),
  split: z.enum(["dev", "holdout"]),
  tags: z.array(z.string()),
  expected: ExpectedSchema,
  notes: z.string().optional(),
});
export const GroundTruthSchema = z.array(GroundTruthEntrySchema);
export type GroundTruthEntry = z.infer<typeof GroundTruthEntrySchema>;

/* ---------- API ugovor (POST /api/read-meter) ---------- */

export type MergeRejectCode = "SERIAL_UNREADABLE" | "SERIAL_MISMATCH";

/** Odakle je uzet konačan serijski za jednu sliku. null = nijedan izvor ga nije pročitao. */
export type SerialSource = "barcode" | "model" | null;

export type WarningCode =
  | "NOT_A_METER"
  | "BAD_IMAGE"
  | "LOW_CONFIDENCE"
  | "SERIAL_FORMAT"
  | "SERIAL_SOURCE_MISMATCH"
  | "MANUFACTURER_CONFLICT"
  | "YEAR_CONFLICT"
  | "OBIS_CONFLICT"
  | "EXTRA_OBIS";

export type Warning = {
  code: WarningCode;
  field?: string;
  message: string;
};

export type ReadStatus = "ok" | "needs_review";

export type ReadMeterResponse =
  | {
      status: ReadStatus;
      data: MergedMeterReading & { readingDate: string };
      warnings: Warning[];
      meta: {
        model: string;
        promptVersion: string;
        latencyMs: number;
        costUsd: number | null;
        /** Izvor serijskog po slici, istim redom kao upload. */
        serialSources: SerialSource[];
      };
    }
  | { status: "error"; code: MergeRejectCode | string; message: string };
