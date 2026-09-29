import { readFile } from "node:fs/promises";
import path from "node:path";
import { GroundTruthSchema, type GroundTruthEntry } from "../lib/schema";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const DATASET_DIR = path.join(ROOT, "dataset");
export const RESULTS_DIR = path.join(ROOT, "eval", "results");

export async function loadGroundTruth(): Promise<GroundTruthEntry[]> {
  const raw = JSON.parse(await readFile(path.join(DATASET_DIR, "ground-truth.json"), "utf8"));
  return GroundTruthSchema.parse(raw);
}

/** Minimalan parser argumenata: --key value / --flag */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = "true";
  }
  return out;
}

export function safeName(modelId: string) {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Jednostavan pool za ograničenu paralelizaciju. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
