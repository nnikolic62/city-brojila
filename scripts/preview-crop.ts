/** Snima crop po RULES.crop za svaku sliku iz dataseta u eval/results/crops/. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATASET_DIR, RESULTS_DIR } from "../eval/lib";
import { RULES } from "../lib/config";
import { cropRegion, orientImage } from "../lib/preprocess";

const imagesDir = path.join(DATASET_DIR, "images");
const outDir = path.join(RESULTS_DIR, "crops");
await mkdir(outDir, { recursive: true });

const files = (await readdir(imagesDir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
for (const f of files) {
  const input = await readFile(path.join(imagesDir, f));
  const oriented = await orientImage(input);
  const cropped = await cropRegion(oriented.buffer, RULES.crop);
  await writeFile(path.join(outDir, f), cropped);
  console.log(`✓ ${f} → ${oriented.width}x${Math.round(oriented.height * RULES.crop.height)}`);
}
console.log(`Snimljeno: ${files.length} → ${outDir}`);
