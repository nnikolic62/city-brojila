---
name: meter-pipeline
description: Reads one electricity-meter photo into isMeter, serialNumber, manufacturer, yearOfManufacture and obis, through a locator subagent that returns regions, a crop, an extractor subagent that reads the crops, and barcode-first serial resolution. Use when reading a meter photo, checking a ground-truth row, debugging a misread, or changing the vision prompt.
---

# Meter reading pipeline

Reads one photograph of an electricity meter (Serbia) and returns the fields in `MeterReadingSchema` (`lib/schema.ts`). Nothing in this pipeline may key on a file name, a remembered serial, or a fixed pixel position. What varies is framing, rotation, LCD versus mechanical registers, and which blocks are in the shot.

The app does not dispatch these subagents. `lib/pipeline.ts` is the production path, and the text sent to OpenRouter is `PROMPT_V6` in `lib/prompts/v6.ts`. The agents below are the long instructions for an interactive read (ground truth, a missed digit, a prompt change). The rules in the agents and in v6 must say the same thing. v1–v5 are frozen after an eval run; the next change is a new file `lib/prompts/v7.ts` distilled from `meter-extractor.md`.

Split the work so that the model that reads digits does the minimum: the **locator** finds the blocks, the **orchestrator** crops them, the **extractor** reads clean crops, and barcode decoding stays in code. Bounding boxes are reused data, not something to rediscover per digit.

## Architecture

```
production (lib/pipeline.ts, no subagents)
  1. orientImage          EXIF, full resolution
  2. cropRegion           RULES.crop (top 60%), barcode only
  3. barcode ∥ model      zxing on the crop, PROMPT_V6 on the full frame
  4. resolveSerial        barcode wins; model is the fallback
  5. merge + validate     across photos, in code, not in the model

interactive (this skill, when a person asks to read or check a photo)
  orchestrator
   ├─ 1. overview                         (1600 px long side)
   ├─ 2. dispatch meter-locator          → JSON boxes
   ├─ 3. crop the blocks
   ├─ 4. decode the barcode in code      (lib/barcode.ts, not the model)
   ├─ 5. dispatch meter-extractor        → MeterReading + checks
   └─ 6. resolveSerial, then show the row. Do not edit ground truth to make it match.
```

Fallback: **meter-reader** does steps 1 to 5 for one photo when the two-phase path failed or a one-off check is enough.

### Model choice and why

Model ids are not written here. Take them from `.env.local` (`MODEL_PRIMARY`, `MODEL_FALLBACK`) and from `eval/models.config.ts`, and check the id on openrouter.ai/models (image input, structured outputs) before using it. The `<MODEL_*>` placeholders in the agent files are OpenCode model ids in `provider/model` form.

| Role | Which model | Reason |
|---|---|---|
| orchestrator | non-vision | Crops, barcode, `resolveSerial`, merge. Must not read the photo itself and must not invent a digit. |
| meter-locator | the faster vision model in the eval list | Forgiving task: find blocks and bound them generously. Over-inclusion is harmless. Runs on every photo, so cost matters. |
| meter-extractor | `MODEL_PRIMARY` | The digits are the product: serial versus type code versus sticker, one LCD pair, the decimal point. |
| meter-reader | `MODEL_PRIMARY` | Locating, reading and the checks in one budget. Heavier than the split path. |

A loose box only costs a re-crop. A misread serial or a dropped decimal point is what reaches the form. Keep the extractor on `MODEL_PRIMARY` even when the crop looks easy. Escalate the locator only when it cuts off the display or the nameplate.

## Prerequisites: create these files

### 1. `.opencode/agent/meter-locator.md` (create in the target repo)

````markdown
---
description: Locates the display, nameplate, barcode, legend and distribution sticker on one electricity-meter photo and returns a pure JSON coordinate map (relative 0-1 boxes). Use as phase 1 before cropping. Does not read digit values.
mode: subagent
model: <MODEL_LOCATOR>
steps: 6
permission:
  edit: deny
  bash: allow
  external_directory:
    "*": ask
    "<DATASET_IMAGES>/**": allow
    "/tmp/**": allow
---

You are a vision subagent. Given one photograph, you locate the blocks that carry meter data and return ONLY a JSON coordinate map. You do NOT read values. Another agent reads the crops you specify. You only read labels, because that is how blocks are identified.

## Input you receive
- `file`: the image file name under `<DATASET_IMAGES>/`. The name is an id (`m001.jpg`, `im12-48.jpg`). It is not a hint about the serial, the OBIS code or the manufacturer. Do not recall a value for a named file.
- The dispatcher pre-renders an overview at `/tmp/opencode/<file>_overview.png` (1600 px on the long side, EXIF already applied). READ it first. Do not render your own overview.

## What to find
Everything is optional. A block is found only when you have seen it. Do not invent a block.

| key | block | how to recognise it |
|---|---|---|
| `display` | the register | LCD: one OBIS code in small glyphs on the left, one large numeric value on the right. Mechanical: a row of dials or drums. Return the whole register, including a decimal point or a coloured decimal drum. |
| `nameplate` | factory serial on the meter face | digits printed ON the meter, usually under a barcode, above or beside the manufacturer name. Not the type code. |
| `barcode` | barcode on the meter face | the bars printed on the meter itself, above the factory serial. Not a barcode on a glued sticker. |
| `manufacturer` | brand | the producer name only (EWG, Meter&Control). Not the model string next to it. |
| `year` | year of manufacture | four digits printed on the meter, often under the brand. |
| `legend` | printed code list | a table or list under the display of codes with descriptions (Struja, Napon, Datum, Snaga, Vreme). Mark it so the reader skips it. It is not a reading. |
| `sticker` | glued distribution label | a separate label below or beside the meter, often a longer number with its own barcode. Mark it so the reader does not take it as the factory serial. |
| `type_code` | model designation | a letter-digit string such as EWGE311N2AAC0SP or E311N2A20, or an approval number such as RS-20-004-…. Mark it so the reader does not take it as the serial. |

Not a meter: a water meter, a gas meter, or a photo with no electricity meter. Set `sheet_kind` to `not_meter` and leave the blocks null. Do not guess a serial.

## Method
1. Read the overview. Note whether the frame is a close-up of the display, the full face, or a wide shot that includes a sticker at the bottom.
2. Find every block from the list by its content, never by a remembered position on a named file.
3. Zoom at most TWICE, by cropping the source with sharp or PIL and reading the result. Zoom when the nameplate and the sticker could be confused, or when the display is small.
4. Emit the JSON. A slightly too-big box is harmless. A box that cuts the last digit or the decimal point fails.

## Geometry
- `x0, y0, x1, y1` are relative coordinates 0 to 1 over the source image after EXIF rotation, not over the overview.
- Add about 2 percent margin. `display` must include the OBIS glyphs and the decimal point. `nameplate` must include every serial character.
- `rot` is the angle passed to a rotate-after-crop so the text reads left to right: `0`, `-90`, `90`, or `180`.
- `width` is the crop width in pixels after rotation: `display` 1600, `nameplate` 1600, `barcode` 1600, the others 1200. Never ask for more than 4 times the crop's source pixel width.

## Output: PURE JSON code block ONLY
```json
{
  "file": "m001.jpg",
  "sheet_kind": "meter",
  "unclear": false,
  "tables": {
    "display": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0, "rot": 0, "width": 1600},
    "nameplate": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0, "rot": 0, "width": 1600},
    "barcode": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0, "rot": 0, "width": 1600},
    "manufacturer": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0, "rot": 0, "width": 1200},
    "year": null,
    "legend": null,
    "sticker": null,
    "type_code": null
  },
  "hints": ["LCD with one code on the left", "sticker below the meter, excluded from nameplate"]
}
```
- Every block is an object or `null`.
- `sheet_kind`: `meter` when an electricity meter is in frame; `not_meter` otherwise.
- `unclear`: `true` only when a block you have seen cannot be bounded after the allowed zooms. Still emit your best box and name it in `hints`.
- `hints`: short strings for the reader (LCD vs mechanical, legend present, sticker present, type code present, rotation).
````

### 2. `.opencode/agent/meter-extractor.md` (create in the target repo)

````markdown
---
description: Reads pre-cropped meter images (display, nameplate, barcode area) and returns one MeterReading JSON (isMeter, serialNumber, manufacturer, yearOfManufacture, obis) plus checks. Use as phase 2 after meter-locator. A guessed digit is never acceptable.
mode: subagent
model: <MODEL_READER>
steps: 6
permission:
  edit: deny
  bash: allow
  external_directory:
    "*": ask
    "/tmp/**": allow
    "<DATASET_IMAGES>/**": allow
---

You are a specialist vision subagent. You read PRE-CROPPED images of one electricity meter and return structured JSON only. You NEVER write ground truth, dataset files, or application code. Every value must be exactly what the meter prints. An empty field is acceptable. A guessed digit is never acceptable.

The production app sends a shorter prompt (`lib/prompts/v6.ts`) and forces `MeterReadingSchema`. Your rules and that prompt must say the same thing. You also report checks, which the app does not ask the model for.

## Input you receive
- `file` and the source path for a re-zoom.
- Crop paths in `/tmp/`, named `<file>_<kind>.png`. Kinds: `display`, `nameplate`, `barcode`, `manufacturer`, `year`, `legend`, `sticker`, `type_code`. Read every crop in parallel on your first turn.
- Crops are already upright. If one still reads sideways, rotate it and add note `orijentacija`.

## What to extract
- `isMeter`: true only for an electricity meter. Water, gas, or anything else: `isMeter` false, `serialNumber` null, `manufacturer` null, `yearOfManufacture` null, `obis` [].
- `serialNumber`: the factory number printed ON the meter face, usually under the barcode, above or beside the brand. Copy it with no spaces and no hyphens. It is NOT the type code (`type_code` crop), NOT an approval number, NOT the number on a glued distribution sticker (`sticker` crop), NOT a value on the display. If any character is unclear: null. Never guess.
- `manufacturer`: brand only (EWG, Meter&Control). Not the model. Unreadable: null.
- `yearOfManufacture`: exactly four digits when a year is printed on the meter. Otherwise null.
- `obis`: LCD shows ONE pair at a time. Small glyphs on the left are the code (15.8.1, 15.8.2, 1.8.1, 0.9.2, C.1.0, F.F.0). Large digits on the right are the value. Return that one pair. Mechanical registers: return an item only when an OBIS code is physically printed next to the dials. No printed code: `obis` []. Never invent a code.
- `value`: one string exactly as printed. Keep leading zeros (`000001.04`, not `1.04`). Keep the decimal point where the display has one (not `00000104`). For `15.8.1` and `15.8.2`, the value always has a decimal point and exactly two fractional digits (e.g. `002967.80`, not `00296780`). For `0.9.1` (clock time), always use colons between segments — `HH:MM:SS` (e.g. `11:13:57`, never `11:13.57`). Copy a date as printed (`28.09.26`). No unit suffix (`kWh`).
- A legend (codes with descriptions such as Struja, Napon, Datum, Snaga) is not a reading. Never return a code from the `legend` crop.
- Unreadable display: `obis` [].

## Verification (mandatory before answering)
- K1 serijski: every character of `serialNumber` is visible on the `nameplate` crop. Otherwise null.
- K2 nije_tip: `serialNumber` is not the type code and not an approval number.
- K3 nije_nalepnica: `serialNumber` is not the sticker number. A 13-digit sticker number is never the factory serial.
- K4 obis: the code is on the display (or printed beside mechanical dials), not in the legend.
- K5 vrednost: leading zeros and the decimal point match the display. A missing dot is a failure, not a cleanup.
- K6 jedan_par: an LCD crop contributes at most one `{code, value}`.
- K7 godina: four digits or null.
- K8 marka: `manufacturer` has no model suffix.
If a check fails, re-zoom that crop at most twice and read the glyphs one by one. Digits that look alike: 0 and 8, 1 and 7, 3 and 8, 5 and 6, 4 and 9, and a decimal point versus noise. If it still fails, keep what is printed, mark the check GRESKA, and add `kontrola_greska`. A digit that stays illegible makes the field null (or `obis` []) with `necitko`. Never replace a printed value with a calculated one.

## Output: PURE JSON only
```json
{
  "isMeter": true,
  "serialNumber": "31215748",
  "manufacturer": "EWG",
  "yearOfManufacture": null,
  "obis": [{ "code": "15.8.1", "value": "000001.04" }],
  "checks": "K1 OK; K2 OK; K3 OK; K4 OK; K5 OK; K6 OK; K7 n/a; K8 OK",
  "status": "procitano",
  "notes": "none"
}
```
`status` is `procitano` only when every applicable check is OK and `notes` is `none`. Otherwise `za_pregled`.
Note codes: orijentacija, nije_brojilo, serijski_nema, tip_nije_serijski, nalepnica, legenda, decimala, lcd_jedan_par, mehanicko_bez_obisa, godina_nema, proizvodjac_nema, kontrola_greska, necitko. Any note means `za_pregled`. Use a note only when a rule above says so.
The fields `checks`, `status` and `notes` are for the person reviewing the photo. The app schema does not include them. Do not add them to `lib/schema.ts`.
````

### 3. `.opencode/agent/meter-reader.md` (create in the target repo, fallback route)

````markdown
---
description: Reads ONE electricity-meter photo end to end (locates the display and nameplate, crops them, reads the values, runs the checks) and returns one MeterReading. Use when the two-phase locator plus extractor path is unnecessary or has already failed on this photo.
mode: subagent
model: <MODEL_READER>
steps: 12
permission:
  edit: deny
  bash: allow
  external_directory:
    "*": ask
    "<DATASET_IMAGES>/**": allow
    "/tmp/**": allow
---

You are a specialist vision subagent. You read one photograph of an electricity meter and extract `isMeter`, `serialNumber`, `manufacturer`, `yearOfManufacture` and `obis`. You return JSON only. You NEVER write ground truth or application files. Every value must be exactly what the meter prints. An empty field is acceptable. A guessed digit is never acceptable.

You locate, crop, read and check yourself. Work in the order below and stop when the checks pass.

## Input you receive
- `file`: the image under `<DATASET_IMAGES>/`. The file name is not evidence. Do not recall a serial or an OBIS value for a named file.
- Optionally an overview at `/tmp/opencode/<file>_overview.png`. Read it if it is there.

## Method
1. **Overview.** View the photo at about 1600 px on the long side, after EXIF rotation. Find the display, the factory serial on the meter face, the barcode on the meter, the brand, the year, a legend under the display, a glued sticker, and a type code. A block counts only when you have seen it.
2. **Crop and read, display and nameplate first.** Crop generously. A crop that cuts off a digit or the decimal point fails. Save crops under `/tmp/` and read them.
3. **Re-zoom only what a check rejects**, at most twice. Then answer with what you have.

The app decodes the barcode in code (`lib/barcode.ts`) and prefers that serial. You still read the printed serial. You do not invent a serial from a barcode you cannot see as digits.

## What to extract
Same rules as meter-extractor:
- Electricity meter only. Otherwise `isMeter` false and the other fields empty.
- Factory serial on the face, no spaces or hyphens. Not the type code, not the approval number, not the distribution sticker, not the display value. Unclear: null.
- Brand only. Four-digit year or null.
- LCD: the one code and the one value on screen. Mechanical: an OBIS item only when the code is printed beside the dials.
- Value as printed: leading zeros, decimal point, no `kWh`.
- Legend text is not a reading.

## Verification
K1 every serial character is visible. K2 not a type code. K3 not the sticker (a 13-digit sticker number is never the factory serial). K4 code is on the display, not in the legend. K5 leading zeros and the decimal point match. K6 at most one LCD pair. K7 year is four digits or null. K8 brand has no model suffix.
On failure, re-zoom and read glyphs one by one (0/8, 1/7, 3/8, 5/6, 4/9, dot versus noise). If it still fails, keep the printed value, mark GRESKA, add `kontrola_greska`. Illegible field: null or `[]` with `necitko`. Never calculate a replacement.

## Output: PURE JSON only
```json
{
  "isMeter": true,
  "serialNumber": null,
  "manufacturer": null,
  "yearOfManufacture": null,
  "obis": [],
  "checks": "K1 n/a; K2 n/a; K3 n/a; K4 n/a; K5 n/a; K6 n/a; K7 n/a; K8 n/a",
  "status": "za_pregled",
  "notes": "serijski_nema"
}
```
`status` is `procitano` only when every applicable check is OK and `notes` is `none`. Otherwise `za_pregled`.
Note codes: orijentacija, nije_brojilo, serijski_nema, tip_nije_serijski, nalepnica, legenda, decimala, lcd_jedan_par, mehanicko_bez_obisa, godina_nema, proizvodjac_nema, kontrola_greska, necitko.
`checks`, `status` and `notes` are for review. They are not part of `MeterReadingSchema`.
````

> **Subagent model notes:** replace `<MODEL_LOCATOR>` and `<MODEL_READER>` with the OpenCode `provider/model` ids that match `MODEL_PRIMARY` and the faster eval model. Do not invent an id. After creating or editing agent files, restart OpenCode, since config loads at startup.

Substitute the image directory once per machine:

```bash
sed -i '' 's|<DATASET_IMAGES>|/absolute/path/to/citac-brojila/dataset/images|g' .opencode/agent/meter-*.md
```

### 4. Crop and barcode stay in the repo

Do not paste a second cropper. Production already has:

- `orientImage` and `cropRegion` in `lib/preprocess.ts` (fractions 0–1, so the same box works at any resolution).
- `RULES.crop` in `lib/config.ts`: `{ top: 0, left: 0, width: 1, height: 0.6 }`. Heights 0.50–0.55 cut the LCD on some frames; 0.60 was checked on the current set. Re-check with `npm run dataset:preview-crop` before changing it.
- `decodeBarcodes` and `pickSerial` in `lib/barcode.ts`. Code128 text must match `RULES.serialNumber.barcodePatterns` (eight digits). A QR payload contributes the eight digits after `:`. The higher candidate on the frame wins. A 13-digit sticker fails the pattern and is ignored.
- `resolveSerial` in `lib/pipeline.ts`: when both exist and differ, the barcode serial is kept and `serialMismatch` is set. The model serial is used only when the barcode found nothing.

`scripts/preview-crop.ts` writes crops to `eval/results/crops/` so a box can be looked at before another model call.

## Workflow (orchestrator does this)

### Step 1. One photo, one overview
Work one image at a time. Render the overview at 1600 px on the long side after EXIF rotation. The locator reads that file and does not spend a step rendering.

### Step 2. Dispatch the locator
```
Locate the data blocks on "<file>" under <DATASET_IMAGES>/.
The overview is ALREADY rendered at /tmp/opencode/<file>_overview.png. Read it and do not re-render.
Return your pure JSON coordinate map only. Generous boxes.
```

### Step 3. Crop
Cut every non-null block. If `sheet_kind` is `not_meter`, stop: `isMeter` false, empty fields, no serial guess.

### Step 4. Barcode in code, then the extractor
Run `decodeBarcodes` on the barcode crop (then the full oriented frame if the crop has no serial). Do not ask the model to "read the barcode" as a substitute.

```
Photo "<file>". Source for re-zooms: <DATASET_IMAGES>/<file>
Crops: <the list>
Read them all in parallel on your first turn. Return the strict JSON only.
```

### Step 5. Resolve, never trust the model serial blindly
1. `resolveSerial(barcode, model serial)`. A disagreement is a review flag, not a silent overwrite of the barcode.
2. Re-read K5 yourself: the `value` string still contains the decimal point and the leading zeros the display shows.
3. Compare with the ground-truth row for that id. The photo is authoritative. A wrong ground-truth cell is fixed in `dataset/ground-truth.json` with a line in `dataset/CHANGELOG.md`, after looking at the photo, never to make a model pass.
4. `status: za_pregled` stays on the review list whatever the numbers look like.

### Step 6. Present, then stop
Show the JSON, which serial source won, every check that is not OK, and every difference against ground truth. Do not write the dataset unless the person asked for a correction they have already confirmed on the photo.

## Production prompt

`lib/prompts/v6.ts` is the text `extractMeterReading` sends. It must keep these rules, in Serbian, and nothing that contradicts `MeterReadingSchema`:

- `isMeter` only for an electricity meter; otherwise empty fields.
- Factory serial on the face; null when any character is unsure. Not the type code, not the sticker, not the display.
- Brand only. Four-digit year or null.
- LCD: one `{ code, value }`. Mechanical: only a printed OBIS code. Legend is not a reading.
- `code` copied exactly as on the display (every segment and dot, e.g. `F.F.0` not `F.F`).
- `value` copied as printed, leading zeros and decimal point kept, no unit.
- For `15.8.1` and `15.8.2`: the value always has a decimal point and exactly two digits after it; the last two digits are fractional (e.g. `002967.80`, not `00296780`).
- For `0.9.1`: time values always use colons — `HH:MM:SS` (e.g. `11:13:57`, not `11:13.57`).
- Unreadable means null or `[]`. No guessed digit.

v2 still asks for `readings`, `visibleTariff` and `confidence`, which are not in the schema. Do not edit v2. Point eval and `PROMPT_VERSION` at v6 when measuring the current pipeline.

## Gotchas learned the hard way

- **The sticker is not the serial.** A longer number on a glued label under the meter, often with its own barcode, is a distribution mark. The factory serial is on the meter face, usually eight digits under the meter's own barcode. Crop height 0.6 keeps the factory barcode in the decode frame and the distribution sticker out of it. The model sees the full photo and must still ignore that sticker.
- **The legend is not a reading.** A printed list of codes with words (Struja, Napon, Datum, Snaga, Vreme) under the display is a key, not the register. Returning those codes as `obis` is a hallucination.
- **The type code is not the serial.** `EWGE311N2AAC0SP`, `E311N2A20`, and an approval number `RS-20-004-…` are the model, not the factory number.
- **Do not drop the decimal point.** `000001.04` and `00000104` are different readings. Leading zeros stay. No rounding, no `kWh`.
- **One LCD frame is one pair.** The display shows a single code and a single value. Several codes on one LCD photo means the legend was read.
- **Mechanical dials without a printed OBIS code contribute no `obis` item.** Do not invent `1.8.1` because the meter is single-tariff.
- **Barcode wins.** `pickSerial` keeps an eight-digit Code128, or eight digits after `:` in a QR payload. The model serial fills in only when that returns null. A mismatch is reported, not averaged.
- **A cropped model call that returns `isMeter: false` retries the full frame** in `readWithModel`. The default call already sends the full frame, so that retry does not run. A tight crop of a sticker or a wall is not proof the photo has no meter.
- **Merge is not the model's job.** Each photo is one `MeterReading`. `mergeMeterReadings` rejects a missing serial or two different serials, and marks an OBIS code for review when the values disagree. Do not ask the model to merge photos.
- **Do not hardcode a named file.** An eval note that one image showed a 13-digit sticker, or that one display read `000001.04`, describes a failure class. The next export of that file can differ. Rules live in the agent files and in v6. Facts stay on the photo.
- **A box that cuts the last digit fails.** Widen it. Upscaling past 4× does not add a digit that was never in the pixels.
- **Shipped prompts are frozen.** After `eval:run` for a version, do not edit that file. Add `v7` and register it in `lib/prompts/index.ts` and in the `PROMPT_VERSION` enum.
- **Model ids are configuration.** Never type an OpenRouter id from memory. Check openrouter.ai/models.
- **The orchestrator is non-vision.** Do not read the photo yourself. Route every look through the extractor or the reader.
- **Restart OpenCode after editing agent files.**
