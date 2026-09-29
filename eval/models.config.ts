/**
 * Modeli koji se porede u evalu (PLAN.md, faza 3.1).
 *
 * ID-jeve UZMI SA https://openrouter.ai/models u trenutku rada:
 *   filter → Input modalities: image, Supported parameters: structured_outputs
 * Lista se menja, zato ovde nema hardkodovanih "poznatih" ID-jeva.
 *
 * Predlog kategorija: 1× brzi/jeftin (Gemini Flash), 1× OpenAI mini, 1× Anthropic, 1× open-weight VL (Qwen).
 */
export type EvalModel = { id: string; label: string };

export const EVAL_MODELS: EvalModel[] = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini Flash Lite" },
  { id: "google/gemini-2.5-flash", label: "Gemini Flash" },
  // { id: "<provider>/<model>", label: "Claude" },
  // { id: "<provider>/<model>", label: "Qwen VL" },
];
