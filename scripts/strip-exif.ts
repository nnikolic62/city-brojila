/** Skida EXIF (GPS!) sa svih slika u dataset/images, zadržava orijentaciju primenom rotacije. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DATASET_DIR } from "../eval/lib";

const dir = path.join(DATASET_DIR, "images");
const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
for (const f of files) {
  const p = path.join(dir, f);
  const out = await sharp(await readFile(p)).rotate().toBuffer(); // sharp po defaultu ne prepisuje metapodatke
  await writeFile(p, out);
  console.log(`✓ ${f}`);
}
console.log(`Obrađeno: ${files.length}`);
