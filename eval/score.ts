/**
 * Računa metrike iz sačuvanih odgovora i pravi izveštaj (PLAN.md, faze 3.5–3.6).
 *
 *   npm run eval:score -- --dir <timestamp>      (bez --dir uzima poslednji)
 *
 * Izlaz: eval/results/<timestamp>/report.md
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MeterReading } from "../lib/schema";
import { RESULTS_DIR, loadGroundTruth, parseArgs, safeName } from "./lib";
import { FIELDS, pct, percentile, scoreSample, type SampleScore } from "./scoring";

type RunFile = {
  id: string;
  run: number;
  model: string;
  parsed: MeterReading | null;
  latencyMs: number;
  costUsd: number | null;
  error: string | null;
};

const args = parseArgs();
const dirs = (await readdir(RESULTS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const stamp = args.dir ?? dirs.at(-1);
if (!stamp) throw new Error("Nema rezultata. Prvo pokreni npm run eval:run");
const runDir = path.join(RESULTS_DIR, stamp);
const runMeta = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8"));
const gtById = new Map((await loadGroundTruth()).map((e) => [e.id, e]));

const lines: string[] = [];
const out = (s = "") => lines.push(s);

out(`# Eval izveštaj — ${stamp}`);
out();
out(`Split: **${runMeta.split}** · Prompt: **${runMeta.promptVersion}** · Runs: ${runMeta.runs} · Preprocess: ${runMeta.usePreprocess} · Slika: ${runMeta.images.length}`);
out();

const summary: string[] = [];
const byTagSections: string[] = [];
const failureSections: string[] = [];

for (const model of runMeta.models as string[]) {
  const modelDir = path.join(runDir, safeName(model));
  const files = (await readdir(modelDir)).filter((f) => f.endsWith(".json"));
  const runsData: RunFile[] = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(modelDir, f), "utf8"))));

  const scored: (SampleScore & { run: RunFile })[] = runsData.map((r) => ({ ...scoreSample(gtById.get(r.id)!, r.parsed), run: r }));
  const n = scored.length;
  const count = (fn: (s: (typeof scored)[number]) => boolean) => scored.filter(fn).length;

  // Polja koja nisu primenljiva (istina null i tip ne odgovara) i dalje se broje — null==null je tačno.
  const fieldCols = FIELDS.map((f) => pct(count((s) => s.fields[f]), n));
  const latencies = runsData.map((r) => r.latencyMs);
  const costs = runsData.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;

  // Stabilnost: slike gde se odgovori razlikuju između run-ova
  let unstable = 0;
  if (runMeta.runs > 1) {
    const byId = Map.groupBy(runsData, (r) => r.id);
    for (const rs of byId.values()) if (new Set(rs.map((r) => JSON.stringify(r.parsed))).size > 1) unstable++;
  }

  summary.push(
    `| ${model} | ${pct(count((s) => s.fullRecord), n)} | ${pct(count((s) => s.fullRecordWithDecimals), n)} | ${fieldCols.join(" | ")} | ${pct(count((s) => s.valid), n)} | ${count((s) => s.hallucinations.length > 0)} | ${percentile(latencies, 50) ?? "—"} / ${percentile(latencies, 95) ?? "—"} ms | ${avgCost === null ? "—" : `$${(avgCost * 1000).toFixed(2)}`} | ${runMeta.runs > 1 ? unstable : "—"} |`
  );

  // Po tagu
  const tags = new Set(scored.flatMap((s) => gtById.get(s.id)!.tags));
  const tagRows = [...tags].sort().map((t) => {
    const sub = scored.filter((s) => gtById.get(s.id)!.tags.includes(t));
    return `| ${t} | ${sub.length} | ${pct(sub.filter((s) => s.fullRecord).length, sub.length)} |`;
  });
  byTagSections.push(`### ${model}\n\n| Tag | N | Ceo zapis |\n|---|---|---|\n${tagRows.join("\n")}`);

  // Promašaji
  const fails = scored.filter((s) => !s.fullRecord);
  if (fails.length) {
    const rows = fails.map((s) => {
      const gt = gtById.get(s.id)!;
      const wrong = s.valid ? FIELDS.filter((f) => !s.fields[f]).join(", ") : `nevalidan odgovor: ${s.run.error ?? "?"}`;
      const exp = JSON.stringify({ serial: gt.expected.serialNumber, ...gt.expected.readings });
      const got = s.run.parsed ? JSON.stringify({ serial: s.run.parsed.serialNumber, ...s.run.parsed.readings }) : "—";
      return `| ${s.id} (run ${s.run.run}) | ${wrong} | \`${exp}\` | \`${got}\` |`;
    });
    failureSections.push(`### ${model}\n\n| Slika | Pogrešna polja | Očekivano | Dobijeno |\n|---|---|---|---|\n${rows.join("\n")}`);
  }
}

out("## Zbirno");
out();
out(`| Model | Ceo zapis | Ceo zapis + decimale | ${FIELDS.join(" | ")} | Validan JSON | Halucinacije | Latencija p50/p95 | Cena / 1000 slika | Nestabilnih |`);
out(`|---|---|---|${FIELDS.map(() => "---").join("|")}|---|---|---|---|---|`);
summary.forEach((s) => out(s));
out();
out("## Po kategoriji (tag)");
out();
byTagSections.forEach((s) => (out(s), out()));
out("## Promašaji");
out();
if (failureSections.length) failureSections.forEach((s) => (out(s), out()));
else out("Nema promašaja.");

const reportPath = path.join(runDir, "report.md");
await writeFile(reportPath, lines.join("\n"));
console.log(`Izveštaj: ${reportPath}`);
