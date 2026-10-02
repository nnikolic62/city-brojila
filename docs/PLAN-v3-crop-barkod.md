# Plan v3: crop → bar-kod → AI → spajanje

> Dopuna za `PLAN.md` i `docs/PRD.md`. Ne zamenjuje ih: šema modela (`MeterReadingSchema`), merge pravila i API ugovor ostaju. Menja se samo **šta se dešava sa jednom slikom pre i posle poziva modela**.
> Radi korak po korak; svaki korak ima DoD i ne prelazi se dalje dok `npm run check` nije zelen.

## Zašto (iz eval izveštaja `eval/results/2026-10-01T08-45-22-008Z`)

| Problem u evalu | Uzrok | Šta ga rešava |
|---|---|---|
| Serijski `2323500008292` umesto `31215748` (flash-lite 3/3, flash 1/3) | Model bira nalepnicu distribucije na dnu slike | **Crop** (nalepnica ispada) + **bar-kod** (serijski čita biblioteka, ne model) |
| flash-lite vraća 20 "OBIS" kodova sa vrednostima `Vreme`, `Snaga`, `31.7.0`… | Čita **legendu ispod displeja** kao očitavanja | **Crop** (legenda ispada) + prompt v3 |
| `00000104` umesto `000001.04` | Gubi decimalnu tačku | Prompt v3 + veća rezolucija displeja (crop pa resize) |
| flash vraća `obis: []` | Prompt v2 je zastareo, vidi ispod | Prompt v3 |

**Prompt v2 ne odgovara šemi:** traži `readings`, `readings.single`, `visibleTariff`, `confidence.serialNumber`, a toga u `MeterReadingSchema` nema od faze 2. Model dobija kontradiktorne instrukcije (prompt kaže jedno, `json_schema` drugo). Takođe kaže „pronađi serijski uz bar kod“, što ga vodi ka nalepnici. v2 se ne menja (pravilo), pravi se v3.

## Ciljni tok jedne slike

```
slika (iz route ili eval)
  1. orient      sharp.rotate() na PUNOJ rezoluciji (bez resize-a, bar-kod treba piksele)
  2. crop        gornji deo (RULES.crop.topRatio) → displej + serijski, bez legende i nalepnice
  3. barcode     zxing-wasm nad crop-om → kandidati → pickSerial() → string | null
                 fallback: ako nema na crop-u, probaj punu sliku
  4. model       crop → resize 1600 → JPEG → extractMeterReading() sa promptom v3
                 fallback: ako model vrati isMeter=false na crop-u, ponovi sa punom slikom
  5. resolve     resolveSerial(barcode, model) → konačan serijski + izvor
  ── po svim slikama ──
  6. merge       mergeMeterReadings() (postojeći, bez izmena pravila)
  7. validate    validateMergedReading() + nova upozorenja
```

Koraci 1–5 žive u **jednoj** funkciji `readMeterImage()` u `lib/pipeline.ts`. Koriste je **i ruta i eval** (isto pravilo kao za `extract.ts`: eval meri ono što ide u produkciju).

---

## Korak 0: priprema

1. Proveri da `npm run check` prolazi na trenutnom stanju (ima necommitovanih izmena, commituj ih prvo kao baseline).
2. Dodaj u `dataset/` sliku drugog brojila (serijski `31217790`, displej `F.F` = `00002000`) i m001 u `ground-truth.json` ako nedostaje. Tri slike istog brojila su premalo da se izmeri bilo šta. Cilj pre koraka 4: bar 10 slika, 3+ različita brojila.
3. Zabeleži u `dataset/CHANGELOG.md`.

**DoD:** baseline commit, `npm run dataset:check` zelen.

**Cursor prompt:**
> Pročitaj AGENTS.md, PLAN.md i docs/PLAN-v3-crop-barkod.md. Radimo korak 0: pokreni `npm run check` i `npm run dataset:check`, prijavi greške, ništa ne menjaj u lib/.

---

## Korak 1: orient + crop (`lib/preprocess.ts`)

Ne diraj postojeći `preprocessImage()` (koristi ga eval sa `--no-preprocess` poređenjem). Dodaj:

```ts
/** EXIF rotacija na punoj rezoluciji, bez resize-a. Vraća i capturedAt. */
export async function orientImage(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number; capturedAt: string | null }>;

/** Isecanje regiona zadatog u procentima (0–1), da radi na svakoj rezoluciji. */
export async function cropRegion(input: Buffer, region: { top: number; left: number; width: number; height: number }): Promise<Buffer>;
```

- `readExifDate` prebaci da ga koriste obe funkcije (bez dupliranja).
- U `lib/config.ts` → `RULES.crop = { top: 0, left: 0, width: 1, height: 0.5 }`. Na EWG slikama (m002–m004, 1500×2000) gornjih ~45–50% sadrži bar-kod sa serijskim, displej i natpisnu pločicu; legenda i nalepnica su ispod. **Proveri na svakoj slici iz dataseta** i podesi broj; ne pogađaj.
- Dodaj skriptu `scripts/preview-crop.ts` (`npm run dataset:preview-crop`) koja snimi crop-ove u `eval/results/crops/` da ih vidiš očima.

**Testovi** (`tests/preprocess.test.ts`): crop vraća očekivane dimenzije za sintetičku sliku (sharp `create`), procenti se zaokružuju i ne izlaze van slike.

**DoD:** crop-ovi m002–m004 vizuelno sadrže displej i broj `31215748`, a ne sadrže legendu ni nalepnicu `2323500008292`.

**Cursor prompt:**
> Korak 1 iz docs/PLAN-v3-crop-barkod.md. Dodaj `orientImage` i `cropRegion` u lib/preprocess.ts bez menjanja `preprocessImage`. Dodaj `RULES.crop` u lib/config.ts, skriptu scripts/preview-crop.ts i npm script `dataset:preview-crop`. Testovi u tests/preprocess.test.ts. Na kraju `npm run check`.

---

## Korak 2: bar-kod (`lib/barcode.ts`)

Biblioteka: `zxing-wasm` (radi u Node-u, `readBarcodes` vraća sve kodove sa pozicijom). Pre instalacije proveri aktuelnu verziju i API na npm-u.

```ts
export type BarcodeCandidate = { text: string; format: string; top: number }; // top: y pozicija 0–1

/** I/O deo: sharp → raw RGBA → zxing. Nikad ne baca; greška → []. */
export async function decodeBarcodes(image: Buffer): Promise<BarcodeCandidate[]>;

/** Čista funkcija: filtrira po RULES.serialNumber.barcodePatterns, bira najviši kandidat. */
export function pickSerial(candidates: BarcodeCandidate[]): string | null;
```

- `RULES.serialNumber.barcodePatterns`: počni samo sa `/^\d{8}$/` (EWG). Dodaj nove proizvođače tek kad imaš njihove slike u datasetu.
- QR kodovi i 13-cifrena nalepnica distribucije moraju da otpadnu na regex-u, ne na poziciji. Pozicija samo bira između više validnih kandidata.
- Next 16: proveri u `node_modules/next/dist/docs/` kako se WASM paket koristi u route handleru (moguće `serverExternalPackages` u `next.config.ts`). Ruta već radi u Node runtime-u zbog sharp-a.

**Testovi:**
- `tests/barcode.test.ts`: `pickSerial` nad ručno napisanim kandidatima (8 cifara + 13 cifara + QR → vraća 8-cifreni; dva validna → viši; nijedan → null).
- Integracioni test nad `dataset/images` (slike nisu u gitu → `describe.skipIf(!existsSync(...))`): m002–m004 → `31215748`.

**DoD:** bar-kod daje tačan serijski na svim slikama u datasetu gde se kod vidi. Ako ne uspeva na crop-u a uspeva na punoj slici, popravi `RULES.crop`, ne logiku.

**Cursor prompt:**
> Korak 2 iz docs/PLAN-v3-crop-barkod.md. Instaliraj zxing-wasm (proveri API na npm), napravi lib/barcode.ts sa `decodeBarcodes` i čistom `pickSerial`, pravila u `RULES.serialNumber.barcodePatterns`. Proveri u node_modules/next/dist/docs da li WASM paket treba u `serverExternalPackages`. Testovi kao u planu. `npm run check`.

---

## Korak 3: prompt v3 (`lib/prompts/v3.ts`)

Novi prompt, usklađen sa **trenutnom** šemom (`isMeter`, `serialNumber`, `manufacturer`, `yearOfManufacture`, `obis[]`). Registruj u `lib/prompts/index.ts`, dozvoli `v3` u `PROMPT_VERSION` enum-u u `lib/config.ts`.

Sadržaj (suština, Cursor neka ga uredi):

```text
Ti očitavaš brojilo električne energije sa JEDNE fotografije (Srbija). Vraćaš isključivo JSON po šemi.

Slika je obično isečen gornji deo brojila: LCD displej, natpisna pločica i bar-kod.

SERIJSKI BROJ
- Fabrički broj odštampan uz bar-kod na licu brojila, obično iznad ili pored naziva proizvođača.
- NIJE serijski: oznaka tipa/modela (npr. EWGE311N2AAC0SP, E311N2A20), broj odobrenja (RS-20-…),
  brojevi na zasebnim nalepnicama ispod brojila, vrednosti sa displeja.
- Ako nisi siguran u svaki znak → null.

OBIS (samo sa LCD displeja)
- Displej prikazuje JEDAN par u trenutku: levo manji tekst je OBIS kod (npr. 15.8.2, 1.8.1, 0.9.2, C.1.0, F.F),
  desno veći tekst je vrednost.
- Vrati najviše jednu stavku — onu koja je trenutno na displeju. Ako displej nije čitljiv → obis: [].
- Tabele i legende odštampane na brojilu (lista kodova sa opisima kao "Struja", "Napon", "Datum")
  NISU očitavanja. Nikad ne vraćaj kod iz legende.
- value: prepiši tačno kako piše, uključujući vodeće nule i decimalnu tačku (npr. "000001.04", "28.09.26").
  Ne briši tačku, ne dodaj jedinicu.

PROIZVOĐAČ I GODINA
- manufacturer: samo marka (npr. EWG). yearOfManufacture: četiri cifre ako su odštampane uz marku.

Ako na slici nije brojilo električne energije: isMeter=false, ostalo null, obis: [].
Nikad ne nagađaj. Nečitljivo = null.
```

Napomena: „najviše jedna stavka“ važi za LCD. Mehanička dvotarifna brojila mogu imati dva brojčanika sa odštampanim kodovima. Kad takve slike uđu u dataset, proveri da prompt ne seče drugi brojčanik.

**DoD:** v1 i v2 netaknuti, `PROMPT_VERSION=v3` radi, `npm run check` zelen.

**Cursor prompt:**
> Korak 3 iz docs/PLAN-v3-crop-barkod.md. Napravi lib/prompts/v3.ts prema planu, usklađen sa MeterReadingSchema u lib/schema.ts. Ne menjaj v1 ni v2. Registruj v3 i dozvoli ga u config.ts. `npm run check`.

---

## Korak 4: pipeline jedne slike (`lib/pipeline.ts`)

```ts
export type SerialSource = "barcode" | "model" | null;

export type ImageReadResult = ExtractResult & {
  barcodeSerial: string | null;
  serialSource: SerialSource;
  usedCrop: boolean;
  serialMismatch: boolean;   // bar-kod i model se ne slažu (posle normalizeSerial)
};

export async function readMeterImage(input: Buffer, opts: {
  model: string; fallbackModels?: string[]; promptVersion: PromptVersion; apiKey: string; timeoutMs?: number;
  useCrop?: boolean;     // default true (eval: --no-crop)
  useBarcode?: boolean;  // default true (eval: --no-barcode)
}): Promise<ImageReadResult & { capturedAt: string | null }>;

/** Čista funkcija. Bar-kod ima prednost; model je rezerva. */
export function resolveSerial(barcode: string | null, model: string | null): { serial: string | null; source: SerialSource; mismatch: boolean };
```

Redosled unutar `readMeterImage`: `orientImage` → `cropRegion` → `decodeBarcodes(crop)` (fallback pun) → `preprocessImage(crop)` → `extractMeterReading` (fallback pun ako `isMeter=false`) → `resolveSerial` → upiši konačan serijski u `parsed.serialNumber`.

Bar-kod i model idu **paralelno** (`Promise.all`), jer ne zavise jedan od drugog; latencija ostaje ≈ latencija modela.

**Testovi** (`tests/pipeline.test.ts`): `resolveSerial` za sve kombinacije (oba isti, samo bar-kod, samo model, različiti → bar-kod pobeđuje + `mismatch: true`, oba null).

**DoD:** `readMeterImage` radi nad m002 iz malog tsx skripta, vraća serijski iz bar-koda.

**Cursor prompt:**
> Korak 4 iz docs/PLAN-v3-crop-barkod.md. Napravi lib/pipeline.ts sa `readMeterImage` i čistom `resolveSerial`. Koristi postojeće extractMeterReading, preprocessImage, normalizeSerial, ne dupliraj logiku. Bar-kod i model paralelno. Testovi za resolveSerial. `npm run check`.

---

## Korak 5: ruta + merge + validacija

`app/api/read-meter/route.ts`:
- Zameni `preprocessImage` + `extractMeterReading` petlju pozivom `readMeterImage` po slici (paralelno, kao sad).
- `mergeMeterReadings` ostaje kakav jeste: dobija `parsed` u kom je serijski već razrešen.
- `readingDate` iz `capturedAt` (sada dolazi iz pipeline-a).
- `meta` proširi sa `serialSource` po slici (za demo i debug).

`lib/schema.ts`: dodaj `WarningCode` `"SERIAL_SOURCE_MISMATCH"` i `meta.serialSources: SerialSource[]`.

`lib/validate.ts`: ako bilo koja slika ima `serialMismatch` → upozorenje (ne blokira, jer bar-kod je pouzdaniji), poruka „Serijski sa bar-koda i sa slike se razlikuju. Proverite.“ Razmisli da li ide u `needs_review`; predlog: da, dok dataset ne pokaže da je bar-kod uvek u pravu.

**Testovi:** proširi `tests/validate.test.ts` za novo upozorenje; `tests/merge.test.ts` ostaje zelen bez izmena.

**DoD:** `curl -F images=@dataset/images/m002.jpg -F images=@dataset/images/m004.jpg localhost:3000/api/read-meter` vraća `serialNumber: "31215748"`, `serialSource: "barcode"`, OBIS `15.8.2` = `000001.04`.

**Cursor prompt:**
> Korak 5 iz docs/PLAN-v3-crop-barkod.md. Prebaci rutu na readMeterImage, dodaj SERIAL_SOURCE_MISMATCH i serialSources u schema.ts, novo pravilo u validate.ts sa testom. merge.ts ne menjaj. `npm run check`, pa probaj curl iz DoD-a.

---

## Korak 6: eval kroz isti pipeline

`eval/run.ts`:
- Umesto `preprocessImage` + `extractMeterReading` zovi `readMeterImage` (inače eval ne meri produkciju).
- Novi flagovi: `--no-crop`, `--no-barcode`; upiši ih u `run.json`.
- Sačuvaj `barcodeSerial`, `serialSource`, `usedCrop` u sirovi rezultat.

`eval/scoring.ts` + `score.ts`:
- Nova metrika: **tačnost serijskog po izvoru** (barcode / model) i **% slika gde je bar-kod pronađen**.
- Report: kolona „Serijski izvor“ i ablacija (sa/bez crop-a, sa/bez bar-koda) u istoj tabeli.

**Pokretanje:**
```
npm run eval:run -- --split dev --prompt v2 --no-crop --no-barcode   # stari baseline
npm run eval:run -- --split dev --prompt v3 --no-crop --no-barcode   # efekat samo prompta
npm run eval:run -- --split dev --prompt v3 --no-barcode             # + crop
npm run eval:run -- --split dev --prompt v3                          # + bar-kod (pun pipeline)
```

**DoD:** report pokazuje sve četiri varijante jednu pored druge; rezultat upisan u PLAN.md „Rezultati“ i odluka u „Dnevnik odluka“.

**Cursor prompt:**
> Korak 6 iz docs/PLAN-v3-crop-barkod.md. Prebaci eval/run.ts na readMeterImage, dodaj --no-crop i --no-barcode, sačuvaj nova polja, dodaj metrike u scoring.ts i report. Testovi za nove scoring funkcije. `npm run check`.

---

## Korak 7: UI (`app/page.tsx`)

Minimalno, ostatak je PLAN.md faza 5:
- Pored serijskog prikaži izvor: „sa bar-koda“ / „pročitao model“.
- Upozorenje `SERIAL_SOURCE_MISMATCH` žutom bojom.
- Uputstvo pri slikanju: „Neka se u kadru vide displej i broj iznad EWG logoa“, plus za LCD: „Pritiskajte LIST dok levo ne piše 15.8.1, slikajte, pa isto za 15.8.2“.

**DoD:** ceo tok radi sa telefona (dve slike, VT i MT) i prikazuje oba OBIS koda + serijski sa bar-koda.

---

## Rizici i otvorena pitanja

1. **Fiksni crop je EWG-specifičan.** Drugi proizvođači imaju drugačiji raspored. Fallback na punu sliku (korak 4) to pokriva dok ne skupiš slike drugih brojila. Tada razmotri crop po poziciji bar-koda ili bounding box od modela.
2. **Bar-kod je mali** na slici iz daljine. Ako zxing ne nađe kod na punoj rezoluciji, crop pa uvećanje (`resize` ×2) pre dekodiranja često pomaže. Meri u koraku 6.
3. **PRD pravilo „serijski na svakoj slici“** sa bar-kodom postaje lakše za ispuniti. Ostaje kako jeste.
4. **Ground truth `value` za LCD** je string sa tačkom (`000001.04`). Proveri da `equalObisValue` ne treba dodatnu normalizaciju; ako treba, beleži odluku, ne menjaj GT.

## Dnevnik odluka (dopisati u PLAN.md)

| Datum | Odluka | Razlog |
|---|---|---|
| 2026-10-01 | Serijski primarno iz bar-koda (zxing-wasm), model kao rezerva | Eval: model bira nalepnicu distribucije umesto serijskog |
| 2026-10-01 | Modelu se šalje crop gornjeg dela, pun kadar kao fallback | Eval: model čita legendu ispod displeja kao OBIS očitavanja |
| 2026-10-01 | Prompt v3 usklađen sa OBIS šemom | v2 referencira polja koja ne postoje u šemi |
