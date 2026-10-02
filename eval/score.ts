/**
 * Računa metrike iz sačuvanih odgovora i pravi izveštaj (PLAN.md, faze 3.5–3.6).
 *
 *   npm run eval:score -- --dir <timestamp>                 (bez --dir uzima poslednji)
 *   npm run eval:score -- --dir <ts1>,<ts2>,<ts3>,<ts4>     (ablacija u jednoj tabeli)
 *
 * Izlaz: eval/results/<timestamp>/report.md
 *        eval/results/ablation.md kad je prosleđeno više direktorijuma
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MeterReading, SerialSource } from "../lib/schema";
import { RESULTS_DIR, loadGroundTruth, parseArgs, safeName } from "./lib";
import {
  FIELDS,
  formatSerialSource,
  formatVariant,
  pct,
  percentile,
  scoreSample,
  serialAttribution,
  serialSourceMetrics,
  type SampleScore,
} from "./scoring";

type RunFile = {
  id: string;
  run: number;
  model: string;
  parsed: MeterReading | null;
  latencyMs: number;
  costUsd: number | null;
  error: string | null;
  barcodeSerial?: string | null;
  serialSource?: SerialSource;
  usedCrop?: boolean;
};

type RunMeta = {
  stamp?: string;
  split: string;
  promptVersion: string;
  runs: number;
  usePreprocess?: boolean;
  useCrop?: boolean;
  cropModel?: boolean;
  useBarcode?: boolean;
  models: string[];
  images: string[];
};

type ScoredDirectory = {
  stamp: string;
  meta: RunMeta;
  variant: string;
  summaryRows: string[];
  byTag: string[];
  failures: string[];
};

const SUMMARY_HEAD = [
  "Varijanta",
  "Model",
  "Ceo zapis",
  "OBIS (GT kodovi)",
  ...FIELDS,
  "Validan JSON",
  "Halucinacije",
  "Serijski izvor",
  "Latencija p50/p95",
  "Cena / 1000 slika",
  "Nestabilnih",
];

const args = parseArgs();
const dirs = (await readdir(RESULTS_DIR, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const latest = dirs.at(-1);
const stamps = args.dir
  ? args.dir.split(",").map((s) => s.trim()).filter(Boolean)
  : latest
    ? [latest]
    : [];
if (stamps.length === 0) throw new Error("Nema rezultata. Prvo pokreni npm run eval:run");

const gtById = new Map((await loadGroundTruth()).map((e) => [e.id, e]));
const scoredDirs = await Promise.all(stamps.map((stamp) => scoreDirectory(stamp)));

for (const scored of scoredDirs) {
  const reportPath = path.join(RESULTS_DIR, scored.stamp, "report.md");
  await writeFile(reportPath, renderReport(scored.stamp, [scored]).join("\n"));
  console.log(`Izveštaj: ${reportPath}`);
}

if (scoredDirs.length > 1) {
  const title = scoredDirs.map((s) => s.stamp).join(", ");
  const ablationPath = path.join(RESULTS_DIR, "ablation.md");
  await writeFile(ablationPath, renderReport(title, scoredDirs).join("\n"));
  console.log(`Ablacija: ${ablationPath}`);
}

function formatMetaLine(meta: RunMeta): string {
  const parts = [`Split: **${meta.split}**`, `Prompt: **${meta.promptVersion}**`, `Runs: ${meta.runs}`];
  if (typeof meta.usePreprocess === "boolean") parts.push(`Preprocess: ${meta.usePreprocess}`);
  if (typeof meta.cropModel === "boolean") {
    if (typeof meta.useCrop === "boolean") parts.push(`Crop bar-kod: ${meta.useCrop ? "da" : "ne"}`);
    parts.push(`Crop model: ${meta.cropModel ? "da" : "ne"}`);
  } else if (typeof meta.useCrop === "boolean") {
    parts.push(`Crop: ${meta.useCrop ? "da" : "ne"}`);
  }
  if (typeof meta.useBarcode === "boolean") parts.push(`Bar-kod: ${meta.useBarcode ? "da" : "ne"}`);
  parts.push(`Slika: ${meta.images.length}`);
  return parts.join(" · ");
}

function renderReport(title: string, runs: ScoredDirectory[]): string[] {
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);

  out(`# Eval izveštaj — ${title}`);
  out();
  for (const run of runs) {
    out(formatMetaLine(run.meta));
  }
  out();
  out("## Zbirno");
  out();
  out(`| ${SUMMARY_HEAD.join(" | ")} |`);
  out(`|${SUMMARY_HEAD.map(() => "---").join("|")}|`);
  for (const run of runs) {
    for (const row of run.summaryRows) out(row);
  }
  out();
  out("## Po kategoriji (tag)");
  out();
  for (const run of runs) {
    if (runs.length > 1) {
      out(`**${run.variant}** (\`${run.stamp}\`)`);
      out();
    }
    for (const section of run.byTag) {
      out(section);
      out();
    }
  }
  out("## Promašaji");
  out();
  const anyFails = runs.some((run) => run.failures.length > 0);
  if (!anyFails) {
    out("Nema promašaja.");
    return lines;
  }
  for (const run of runs) {
    if (runs.length > 1 && run.failures.length > 0) {
      out(`**${run.variant}** (\`${run.stamp}\`)`);
      out();
    }
    for (const section of run.failures) {
      out(section);
      out();
    }
  }
  return lines;
}

async function scoreDirectory(stamp: string): Promise<ScoredDirectory> {
  const runDir = path.join(RESULTS_DIR, stamp);
  const meta = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8")) as RunMeta;
  const variant = formatVariant(meta);
  const summaryRows: string[] = [];
  const byTag: string[] = [];
  const failures: string[] = [];

  for (const model of meta.models) {
    const modelDir = path.join(runDir, safeName(model));
    const files = (await readdir(modelDir)).filter((f) => f.endsWith(".json"));
    const runsData: RunFile[] = await Promise.all(
      files.map(async (f) => JSON.parse(await readFile(path.join(modelDir, f), "utf8")) as RunFile),
    );

    const scored: (SampleScore & { run: RunFile })[] = runsData.map((r) => ({
      ...scoreSample(gtById.get(r.id)!, r.parsed),
      run: r,
    }));
    const n = scored.length;
    const count = (fn: (s: (typeof scored)[number]) => boolean) => scored.filter(fn).length;

    const fieldCols = FIELDS.map((f) => pct(count((s) => s.fields[f]), n));
    const latencies = runsData.map((r) => r.latencyMs);
    const costs = runsData.map((r) => r.costUsd).filter((c): c is number => c !== null);
    const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;

    let unstable = 0;
    if (meta.runs > 1) {
      const byId = Map.groupBy(runsData, (r) => r.id);
      for (const rs of byId.values()) if (new Set(rs.map((r) => JSON.stringify(r.parsed))).size > 1) unstable++;
    }

    const obisPct = pct(
      count((s) => {
        const codes = Object.keys(s.obis);
        return codes.length > 0 && codes.every((c) => s.obis[c]);
      }),
      count((s) => Object.keys(s.obis).length > 0),
    );

    const serial = formatSerialSource(
      serialSourceMetrics(
        scored.map((s) => ({
          serialCorrect: s.fields.serialNumber,
          attribution: serialAttribution(s.run),
        })),
      ),
    );

    summaryRows.push(
      `| ${variant} | ${model} | ${pct(count((s) => s.fullRecord), n)} | ${obisPct} | ${fieldCols.join(" | ")} | ${pct(count((s) => s.valid), n)} | ${count((s) => s.hallucinations.length > 0)} | ${serial} | ${percentile(latencies, 50) ?? "—"} / ${percentile(latencies, 95) ?? "—"} ms | ${avgCost === null ? "—" : `$${(avgCost * 1000).toFixed(2)}`} | ${meta.runs > 1 ? unstable : "—"} |`,
    );

    const tags = new Set(scored.flatMap((s) => gtById.get(s.id)!.tags));
    const tagRows = [...tags].sort().map((t) => {
      const sub = scored.filter((s) => gtById.get(s.id)!.tags.includes(t));
      return `| ${t} | ${sub.length} | ${pct(sub.filter((s) => s.fullRecord).length, sub.length)} |`;
    });
    byTag.push(`### ${model}\n\n| Tag | N | Ceo zapis |\n|---|---|---|\n${tagRows.join("\n")}`);

    const fails = scored.filter((s) => !s.fullRecord);
    if (fails.length) {
      const rows = fails.map((s) => {
        const gt = gtById.get(s.id)!;
        const wrong = s.valid
          ? FIELDS.filter((f) => !s.fields[f]).join(", ")
          : `nevalidan odgovor: ${s.run.error ?? "?"}`;
        const exp = JSON.stringify({
          serial: gt.expected.serialNumber,
          obis: gt.expected.obis,
          manufacturer: gt.expected.manufacturer,
        });
        const got = s.run.parsed
          ? JSON.stringify({
              serial: s.run.parsed.serialNumber,
              obis: s.run.parsed.obis,
              manufacturer: s.run.parsed.manufacturer,
              ...(s.run.serialSource !== undefined ? { serialSource: s.run.serialSource } : {}),
              ...(s.run.barcodeSerial !== undefined ? { barcodeSerial: s.run.barcodeSerial } : {}),
            })
          : "—";
        return `| ${s.id} (run ${s.run.run}) | ${wrong} | \`${exp}\` | \`${got}\` |`;
      });
      failures.push(
        `### ${model}\n\n| Slika | Pogrešna polja | Očekivano | Dobijeno |\n|---|---|---|---|\n${rows.join("\n")}`,
      );
    }
  }

  return { stamp, meta, variant, summaryRows, byTag, failures };
}
