/**
 * Pokreće modele nad datasetom kroz isti pipeline kao API (readMeterImage).
 *
 *   npm run eval:run -- --split dev --prompt v3 --runs 1 --concurrency 4 [--models id1,id2] [--ids im1-48,im8-83] [--no-crop] [--crop-model] [--no-barcode]
 *
 * Izlaz: eval/results/<timestamp>/<model>/<imageId>.run<N>.json  +  run.json (parametri)
 * Skoring se radi posebno (eval:score) nad sačuvanim fajlovima → bez ponovnog trošenja.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMeterImage } from "../lib/pipeline";
import { PROMPTS, type PromptVersion } from "../lib/prompts";
import { EVAL_MODELS } from "./models.config";
import { DATASET_DIR, RESULTS_DIR, loadGroundTruth, mapLimit, parseArgs, safeName } from "./lib";

const args = parseArgs();
if (args["no-preprocess"] === "true") {
  throw new Error("`--no-preprocess` više ne postoji. Eval ide kroz readMeterImage. Za ablaciju: --no-crop i --no-barcode.");
}

const split = args.split ?? "dev";
const promptVersion = (args.prompt ?? "v1") as PromptVersion;
const runs = Number(args.runs ?? 1);
const concurrency = Number(args.concurrency ?? 4);
const useCrop = args["no-crop"] !== "true";
const cropModel = useCrop && args["no-crop-model"] !== "true" && args["crop-model"] === "true";
const useBarcode = args["no-barcode"] !== "true";
const modelIds = args.models ? args.models.split(",") : EVAL_MODELS.map((m) => m.id);

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Nedostaje OPENROUTER_API_KEY (.env)");
if (!(promptVersion in PROMPTS)) throw new Error(`Nepoznata verzija prompta: ${promptVersion}`);
if (modelIds.length === 0) throw new Error("Nema modela. Popuni eval/models.config.ts ili prosledi --models.");

const idFilter = args.ids ? new Set(args.ids.split(",").map((s) => s.trim()).filter(Boolean)) : null;
let entries = (await loadGroundTruth()).filter((e) => split === "all" || e.split === split);
if (idFilter) entries = entries.filter((e) => idFilter.has(e.id));
if (entries.length === 0) throw new Error(`Nema slika za split "${split}" u dataset/ground-truth.json`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(RESULTS_DIR, stamp);
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, "run.json"),
  JSON.stringify(
    {
      stamp,
      split,
      promptVersion,
      runs,
      useCrop,
      cropModel,
      useBarcode,
      models: modelIds,
      images: entries.map((e) => e.id),
    },
    null,
    2,
  ),
);

const images = new Map<string, Buffer>();
for (const e of entries) {
  images.set(e.id, await readFile(path.join(DATASET_DIR, "images", e.file)));
}

console.log(
  `Eval: ${modelIds.length} modela × ${entries.length} slika × ${runs} run · crop bar-kod ${useCrop ? "da" : "ne"} · crop model ${cropModel ? "da" : "ne"} · bar-kod ${useBarcode ? "da" : "ne"} → ${outDir}`,
);

for (const model of modelIds) {
  const modelDir = path.join(outDir, safeName(model));
  await mkdir(modelDir, { recursive: true });
  const jobs = entries.flatMap((e) => Array.from({ length: runs }, (_, r) => ({ e, run: r + 1 })));
  let done = 0;
  await mapLimit(jobs, concurrency, async ({ e, run }) => {
    const res = await readMeterImage(images.get(e.id)!, {
      model,
      promptVersion,
      apiKey,
      useCrop,
      cropModel,
      useBarcode,
    });
    await writeFile(
      path.join(modelDir, `${e.id}.run${run}.json`),
      JSON.stringify({ id: e.id, run, model, ...res }, null, 2),
    );
    done++;
    process.stdout.write(`\r  ${model}: ${done}/${jobs.length}${res.error ? `  (greška na ${e.id})` : ""}   `);
  });
  process.stdout.write("\n");
}

console.log(`Gotovo. Sledeće: npm run eval:score -- --dir ${stamp}`);
