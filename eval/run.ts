/**
 * Pokreće modele nad datasetom i čuva SIROVE odgovore (PLAN.md, faza 3.3).
 *
 *   npm run eval:run -- --split dev --prompt v1 --runs 1 --concurrency 4 [--models id1,id2] [--no-preprocess]
 *
 * Izlaz: eval/results/<timestamp>/<model>/<imageId>.run<N>.json  +  run.json (parametri)
 * Skoring se radi posebno (eval:score) nad sačuvanim fajlovima → bez ponovnog trošenja.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractMeterReading } from "../lib/extract";
import { preprocessImage, toDataUrl } from "../lib/preprocess";
import { PROMPTS, type PromptVersion } from "../lib/prompts";
import { EVAL_MODELS } from "./models.config";
import { DATASET_DIR, RESULTS_DIR, loadGroundTruth, mapLimit, parseArgs, safeName } from "./lib";

const args = parseArgs();
const split = args.split ?? "dev";
const promptVersion = (args.prompt ?? "v1") as PromptVersion;
const runs = Number(args.runs ?? 1);
const concurrency = Number(args.concurrency ?? 4);
const usePreprocess = args["no-preprocess"] !== "true";
const modelIds = args.models ? args.models.split(",") : EVAL_MODELS.map((m) => m.id);

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Nedostaje OPENROUTER_API_KEY (.env)");
if (!(promptVersion in PROMPTS)) throw new Error(`Nepoznata verzija prompta: ${promptVersion}`);
if (modelIds.length === 0) throw new Error("Nema modela. Popuni eval/models.config.ts ili prosledi --models.");

const entries = (await loadGroundTruth()).filter((e) => split === "all" || e.split === split);
if (entries.length === 0) throw new Error(`Nema slika za split "${split}" u dataset/ground-truth.json`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(RESULTS_DIR, stamp);
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, "run.json"),
  JSON.stringify({ stamp, split, promptVersion, runs, usePreprocess, models: modelIds, images: entries.map((e) => e.id) }, null, 2)
);

// Slike se pripreme jednom i dele između modela.
const images = new Map<string, string>();
for (const e of entries) {
  const buf = await readFile(path.join(DATASET_DIR, "images", e.file));
  if (usePreprocess) {
    const p = await preprocessImage(buf);
    images.set(e.id, toDataUrl(p.buffer, p.mimeType));
  } else {
    const ext = path.extname(e.file).slice(1).toLowerCase();
    images.set(e.id, toDataUrl(buf, `image/${ext === "jpg" ? "jpeg" : ext}`));
  }
}

console.log(`Eval: ${modelIds.length} modela × ${entries.length} slika × ${runs} run → ${outDir}`);

for (const model of modelIds) {
  const modelDir = path.join(outDir, safeName(model));
  await mkdir(modelDir, { recursive: true });
  const jobs = entries.flatMap((e) => Array.from({ length: runs }, (_, r) => ({ e, run: r + 1 })));
  let done = 0;
  await mapLimit(jobs, concurrency, async ({ e, run }) => {
    const res = await extractMeterReading({ imageDataUrl: images.get(e.id)!, model, promptVersion, apiKey });
    await writeFile(path.join(modelDir, `${e.id}.run${run}.json`), JSON.stringify({ id: e.id, run, model, ...res }, null, 2));
    done++;
    process.stdout.write(`\r  ${model}: ${done}/${jobs.length}${res.error ? `  (greška na ${e.id})` : ""}   `);
  });
  process.stdout.write("\n");
}

console.log(`Gotovo. Sledeće: npm run eval:score -- --dir ${stamp}`);
