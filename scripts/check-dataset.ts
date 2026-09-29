/** Proverava ground-truth.json: šema, jedinstveni ID-jevi, postojanje slika, pokrivenost. */
import { access } from "node:fs/promises";
import path from "node:path";
import { DATASET_DIR, loadGroundTruth } from "../eval/lib";

const entries = await loadGroundTruth();
const problems: string[] = [];

const ids = new Set<string>();
for (const e of entries) {
  if (ids.has(e.id)) problems.push(`Duplikat ID: ${e.id}`);
  ids.add(e.id);
  try {
    await access(path.join(DATASET_DIR, "images", e.file));
  } catch {
    problems.push(`Nedostaje slika: images/${e.file}`);
  }
  const x = e.expected;
  if (!x.isMeter && (x.readings.single || x.readings.vt || x.readings.nt)) problems.push(`${e.id}: isMeter=false a ima stanja`);
  if (x.tariffType === "single" && (x.readings.vt || x.readings.nt)) problems.push(`${e.id}: jednotarifno a ima VT/NT`);
  if (x.tariffType === "dual" && x.readings.single) problems.push(`${e.id}: dvotarifno a ima single`);
}

const has = (...tags: string[]) => entries.filter((e) => tags.every((t) => e.tags.includes(t))).length;
const coverage: [string, number, number][] = [
  ["mechanical + single", has("mechanical", "single"), 6],
  ["mechanical + dual", has("mechanical", "dual"), 6],
  ["electronic + single", has("electronic", "single"), 6],
  ["electronic + dual", has("electronic", "dual"), 6],
  ["low-light", has("low-light"), 5],
  ["glare", has("glare"), 5],
  ["angle / partial", entries.filter((e) => e.tags.includes("angle") || e.tags.includes("partial")).length, 4],
  ["negative", has("negative"), 4],
];

console.log(`Ukupno slika: ${entries.length} (dev ${entries.filter((e) => e.split === "dev").length}, holdout ${entries.filter((e) => e.split === "holdout").length})\n`);
console.table(coverage.map(([k, n, goal]) => ({ kategorija: k, ima: n, cilj: goal, ok: n >= goal ? "✓" : "✗" })));
if (problems.length) {
  console.error(`\nProblemi (${problems.length}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nGround truth je ispravan.");
