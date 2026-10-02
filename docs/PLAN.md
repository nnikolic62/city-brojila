# Čitač brojila — plan implementacije i set instrukcija

> **Namena ovog dokumenta:** jedini izvor istine za prototip. Kad se radi bilo koja faza, Claude (ili bilo ko) prvo čita ovaj dokument i radi strogo fazu po fazu. Svaka faza ima **ulaz**, **zadatke**, **izlaz (artefakte)** i **Definition of Done (DoD)**. Sledeća faza ne počinje dok DoD prethodne nije ispunjen.

---

## 0. Cilj, obim i pravila rada

### Cilj
Prototip koji iz fotografije brojila električne energije izvlači strukturirane podatke (tip brojila, serijski broj, stanja VT/NT/JT) i popunjava formu. Uz prototip ide **merljiva evaluacija više modela** preko OpenRoutera, kako bi odluka o modelu bila zasnovana na brojkama.

### Šta ulazi u prototip
- Next.js aplikacija: **jedna stranica** (upload/slikanje) + **jedna API ruta** (`POST /api/read-meter`).
- **Eval skripta** (Node/TS) koja pokreće dataset kroz 2–4 modela i pravi izveštaj tačnosti.
- Validacija poslovnih pravila i edge case-ova.
- Demo scenario (uživo slikanje telefonom).

### Šta NE ulazi (svesno)
- Baza podataka, autentifikacija, istorija očitavanja (prethodno stanje se unosi ručno ili je mock).
- Native mobilna aplikacija (RN/Expo je **opciona faza 7**; demo uživo radi preko mobilnog browsera sa `capture="environment"`).

### Kriterijumi uspeha (mere se u fazi 3)
| Metrika | Cilj |
|---|---|
| Tačnost stanja (celobrojni deo kWh), po polju | ≥ 95% na "dobrim" slikama, ≥ 85% ukupno |
| Tačnost serijskog broja | ≥ 90% |
| Prepoznavanje "nije brojilo" | 100% na negativnim primerima |
| Validan JSON (prolazi Zod) | ≥ 99% |
| Latencija end-to-end (p50) | ≤ 3 s |

### Pravila rada (konvencije)
1. **TypeScript strict** svuda. Identifikatori u kodu na engleskom, UI tekst na srpskom.
2. **Zod šema je jedini izvor istine** za oblik odgovora — iz nje se generiše JSON Schema za model, TS tipovi i validacija. Nigde se šema ne piše dvaput.
3. **Model je konfiguracija, ne kod** — ID modela dolazi iz env/config fajla; menjanje modela ne zahteva izmenu koda.
4. **Prompt je verzionisan** (`prompts/v1.ts`, `v2.ts`…). Svaki eval izveštaj beleži verziju prompta i model.
5. OpenRouter API ključ postoji **samo na serveru** (nikad `NEXT_PUBLIC_`).
6. Ground truth se nikad ne menja da bi model "prošao". Ako je ground truth pogrešan, ispravka se beleži u `dataset/CHANGELOG.md`.

---

## Arhitektura

```
[Browser / telefon]
   │  <input type="file" accept="image/*" capture="environment">
   │  multipart/form-data (slika + opciono prethodno stanje)
   ▼
[Next.js Route Handler: POST /api/read-meter]
   1. validacija fajla (tip, veličina)
   2. preprocessing (sharp): EXIF rotacija, resize na 1600px, JPEG q85
   3. poziv OpenRoutera (vision model + response_format json_schema)
   4. Zod validacija odgovora (1 retry ako padne)
   5. poslovna validacija (pravila iz faze 6)
   6. response: { status, data, warnings, meta }
   ▼
[OpenRouter] → model (npr. Gemini Flash / GPT mini / Claude / Qwen VL)

[eval/run.ts] ── koristi ISTI extractor modul kao API ruta ──► OpenRouter
```

**Ključna odluka:** logika poziva modela živi u deljenom modulu `lib/extract.ts`. I API ruta i eval skripta ga koriste — tako eval meri tačno ono što ide u produkciju.

### Struktura repozitorijuma
```
citac-brojila/
├─ app/
│  ├─ page.tsx                  # jedina stranica
│  └─ api/read-meter/route.ts   # jedina API ruta
├─ components/                  # UploadField, MeterForm, StatusBanner...
├─ lib/
│  ├─ schema.ts                 # Zod šema (izvor istine)
│  ├─ extract.ts                # poziv OpenRoutera + Zod parse
│  ├─ preprocess.ts             # sharp: rotate/resize/compress
│  ├─ validate.ts               # poslovna pravila
│  ├─ normalize.ts              # normalizacija cifara/serijskog broja
│  └─ prompts/v1.ts
├─ eval/
│  ├─ run.ts                    # pokreće modele nad datasetom
│  ├─ score.ts                  # računa metrike iz sačuvanih odgovora
│  ├─ report.ts                 # pravi markdown/HTML izveštaj
│  ├─ models.config.ts          # lista modela za poređenje
│  └─ results/<timestamp>/      # sirovi odgovori + izveštaj
├─ dataset/
│  ├─ images/                   # m001.jpg, m002.jpg...
│  ├─ ground-truth.json
│  └─ CHANGELOG.md
├─ tests/                       # Vitest: validate.ts, normalize.ts, score.ts
└─ .env.local                   # OPENROUTER_API_KEY, MODEL_PRIMARY, MODEL_FALLBACK
```

### Stack
Next.js (App Router) + TypeScript, Zod v4 (`z.toJSONSchema`), `sharp`, `openai` SDK sa `baseURL: https://openrouter.ai/api/v1` (ili čist `fetch`), `tsx` za skripte, Vitest za testove, Tailwind za UI, deploy na Vercel (HTTPS je obavezan za kameru na telefonu).

---

## Faza 1 — Dataset (najvažniji korak)

**Ulaz:** telefon, pristup brojilima (kuća, zgrada, prijatelji, kolege).
**Cilj:** 30–50 stvarnih fotografija sa tačno zapisanim vrednostima.

### 1.1 Matrica pokrivenosti (minimum po kategoriji)
| Kategorija | Min. slika |
|---|---|
| Mehaničko, jednotarifno | 6 |
| Mehaničko, dvotarifno (dva brojčanika) | 6 |
| Elektronsko LCD, jednotarifno | 6 |
| Elektronsko LCD, dvotarifno (VT/NT se smenjuju na ekranu) | 6 |
| Loše osvetljenje (ormarić, veče, bez blica) | 5 |
| Odsjaj (staklo/plastika, blic) | 5 |
| Ukošen ugao / delimično odsečeno | 4 |
| **Negativni primeri** (vodomer, gasomer, nasumična slika, zamućeno do nečitljivosti) | 4–6 |

Jedna slika može pokrivati više kategorija (npr. LCD + odsjaj) — to se beleži tagovima.

### 1.2 Pravila slikanja
- Slikati **normalno, kao korisnik** — ne namerno savršeno. Dataset mora ličiti na stvarnu upotrebu.
- Za isto brojilo napraviti 2 slike: jednu "dobru" i jednu "lošu" (ugao/odsjaj). Odlično za poređenje.
- Kod LCD dvotarifnih: ekran prikazuje jednu vrednost u trenutku — zabeležiti koja je tarifa prikazana (oznaka T1/T2, 1.8.1/1.8.2 OBIS kod i sl.).

### 1.3 Zapisivanje ground trutha
Odmah pored brojila (ne kasnije iz slike!) zapisati vrednosti. Format `dataset/ground-truth.json` — **po slici**, isti oblik kao izlaz modela (`docs/PRD.md`):

```json
[
  {
    "id": "m001",
    "file": "m001.jpg",
    "split": "dev",
    "tags": ["electronic", "dual", "good-light"],
    "expected": {
      "isMeter": true,
      "serialNumber": "12345678",
      "manufacturer": "EWG",
      "yearOfManufacture": "2020",
      "obis": [
        { "code": "1.8.1", "value": "0452317" },
        { "code": "1.8.2", "value": "0218772" }
      ]
    },
    "notes": "opciono: kontekst, tarifa na LCD-u, zašto je serial null"
  }
]
```

Pravila zapisa:
- **Eval ostaje jedna slika po uzorku** — `expected` opisuje tu sliku. U produkciji više slika spaja `lib/merge.ts`; `serialNumber: null` u ground truthu je validno za eval (API i dalje odbija submit bez serijskog na bilo kojoj slici).
- OBIS samo ako je **štampan na slici**; vrednost jedan string (vodeće nule, bez sufiksa jedinice).
- Polje koje se na slici **ne vidi / nečitljivo** → `null` (model ne sme da izmisli).
- Za negativne primere: `"isMeter": false`, `obis: []`, ostala polja `null`.

### 1.4 Podela
- `dev` (~70%): koristi se za podešavanje prompta.
- `holdout` (~30%): **ne gleda se** tokom podešavanja; finalni brojevi za prezentaciju se računaju samo na njemu (ili na celom setu, ali uz jasnu napomenu).

### 1.5 Privatnost
- Skinuti EXIF (GPS lokacija) sa slika: `sharp` ili `exiftool -all=`.
- Serijski brojevi tuđih brojila — pitati vlasnika ili ih ne prikazivati na slajdovima.

**Izlaz:** `dataset/images/*`, `dataset/ground-truth.json`, tabela pokrivenosti u `dataset/README.md`.
**DoD:** ≥ 30 slika, svaka kategorija iz 1.1 popunjena, JSON prolazi validaciju šemom iz faze 2, split dev/holdout definisan.

---

## Faza 2 — Šema polja

**Ulaz:** `docs/PRD.md` (OBIS, više slika, spajanje). Mapiranje na postojeći sistem: `serialNumber` ↔ `serijskiBroj`, `manufacturer` ↔ `oznakaProizvodjaca`, `yearOfManufacture` ↔ `godinaProizvodnje`.

### 2.1 Polja koja vraća model (po slici)
| Polje | Tip | Opis |
|---|---|---|
| `isMeter` | boolean | Da li je na slici brojilo električne energije |
| `serialNumber` | string \| null | Serijski broj sa tablice; **ne** kod tipa/modela; null ako nečitljivo |
| `manufacturer` | string \| null | Samo naziv proizvođača (EWG, Meter&Control…); null ako nečitljivo |
| `yearOfManufacture` | string \| null | Tačno četiri cifre; null ako nečitljivo |
| `obis` | `{ code, value }[]` | Samo kodovi otisnuti na **ovoj** slici; `value` jedan string kao na displeju |

Uklonjeno iz model šeme (staro): `meterKind`, `tariffType`, `readings`, `visibleTariff`, `imageQuality`, `confidence`. Tarife su OBIS kodovi (npr. `1.8.1` / `1.8.2`, `15.8.1`…).

### 2.2 Spojeni odgovor API-ja (server, ne model)
Nakon `mergeReadings` nad svim slikama: jedan `serialNumber`, `manufacturer`, `yearOfManufacture`, `obis[]` sa `{ code, value, review }` (`value: null`, `review: true` pri konfliktu). Zod: `MergedMeterReadingSchema` u `lib/schema.ts`.

### 2.3 Polja koja NE vraća model
- `readingDate` — postavlja **server** (trenutno vreme ili EXIF).
- `unit` — uvek kWh (fiksno, van JSON-a modela).

### 2.4 Implementacija
- `lib/schema.ts`: Zod šema `MeterReadingSchema`.
- JSON Schema za model: `z.toJSONSchema(MeterReadingSchema)`.
- Za **strict structured output**: sva polja `required`, opciona polja su `nullable`, `additionalProperties: false`.
- Opisi polja (`.describe(...)`) su deo šeme — model ih vidi (npr. ne izmišljati OBIS, tip brojila ≠ serial).
- Prompt **v2** za OBIS (`lib/prompts/v2.ts`); v1 se ne menja posle eval run-a.

**Izlaz:** `lib/schema.ts`, tipovi `MeterReading`, test da `ground-truth.json` prolazi šemu.
**DoD:** šema potvrđena u odnosu na postojeću aplikaciju; jedan izvor istine; ground truth validan.

---

## Faza 3 — Eval (prototip bez aplikacije)

**Ulaz:** dataset (faza 1), šema (faza 2).
**Cilj:** brojke tipa *"Model A 96%, Model B 91%, Model C 88%"* + cena i latencija.

### 3.1 Izbor modela
- 3–4 kandidata sa **image inputom** i podrškom za **structured outputs** na OpenRouteru. Primeri kategorija: brzi/jeftin Google Gemini Flash, OpenAI mini model, Anthropic Claude, open-weight VL model (Qwen VL).
- **Tačne ID-jeve modela proveriti na openrouter.ai/models u trenutku rada** (filter: input modality = image, supported parameters = structured outputs). Ne hardkodovati napamet — lista se menja.
- Upisati ih u `eval/models.config.ts`.

### 3.2 Poziv modela (`lib/extract.ts`)
- Slika kao base64 data URL u `image_url` delu poruke.
- `response_format: { type: "json_schema", json_schema: { name: "meter_reading", strict: true, schema } }`.
- `provider: { require_parameters: true }` — OpenRouter rutira samo na provajdere koji podržavaju structured output.
- `temperature: 0`.
- `usage: { include: true }` — da odgovor sadrži cenu (za kolonu "cena po slici").
- Timeout 20 s, 1 retry na mrežnu grešku ili Zod grešku.
- Vraća: `{ parsed | null, raw, latencyMs, costUsd, error }`.

### 3.3 Eval skripta (`eval/run.ts`)
- Argumenti: `--models`, `--prompt v1`, `--split dev|holdout|all`, `--runs 1..3`, `--concurrency 4`.
- **Svaki sirovi odgovor se čuva** u `eval/results/<timestamp>/<model>/<imageId>.json`. Skoring (`score.ts`) radi nad sačuvanim fajlovima → može se ponavljati bez novog trošenja.
- Varijabla za eksperiment: sa i bez preprocessinga (resize/kompresija) — da se vidi uticaj na tačnost i latenciju.

### 3.4 Normalizacija i poređenje (`lib/normalize.ts`, `eval/scoring.ts`)
- OBIS `value`: ukloniti razmake pre poređenja (`equalObisValue`); inače exact string match sa ground truthom.
- Serijski broj: ukloniti razmake, crtice, tačke; uppercase; exact match posle normalizacije.
- `null` vs vrednost = greška na polju; **halucinacija** ako je GT `serialNumber: null` a model vratio vrednost, ili ako model vrati OBIS kod koji nije u ground truthu.
- `null` vs `null` = tačno.

### 3.5 Metrike (`eval/score.ts`, `eval/scoring.ts`)
Po modelu (jedna slika = jedan uzorak, kao ground truth):
1. **Tačnost po polju**: `isMeter`, `serialNumber`, `manufacturer`, `yearOfManufacture`.
2. **Tačnost po OBIS kodu** iz ground trutha (svaki očekivani `code` posebno).
3. **Tačnost celog zapisa** — sva polja + svi očekivani OBIS kodovi tačni, bez halucinacija.
4. **Tačnost po tagu** (mehaničko/LCD/odsjaj/mrak…) — pokazuje gde model puca.
5. **Validan JSON %**.
6. **Halucinacije**: izmišljen serijski kad je GT `null`; OBIS kodovi van ground trutha.
7. **Latencija** p50/p95, **cena** po slici i po 1000 slika.
8. **Stabilnost** (ako `--runs > 1`): % slika gde se odgovori razlikuju između pokretanja.

### 3.6 Izveštaj (`eval/report.ts`)
- `report.md` + `report.html`: zbirna tabela modela, tabela po tagu, lista promašaja (slika + očekivano + dobijeno) — lista promašaja je glavni materijal za poboljšanje prompta.
- Iteracija: promeni prompt → `v2` → ponovi na `dev` → finalno pokreni na `holdout`.

**Izlaz:** radna eval skripta, izveštaj sa ≥ 3 modela, izabran **primarni** i **fallback** model sa obrazloženjem (tačnost × cena × latencija).
**DoD:** jedna komanda (`npm run eval`) proizvodi izveštaj; rezultati na holdout setu zapisani u ovaj dokument (sekcija "Rezultati").

---

## Faza 4 — Backend endpoint

**Ulaz:** `lib/extract.ts` i izabrani model iz faze 3.

### 4.1 Ugovor rute `POST /api/read-meter`
**Request:** `multipart/form-data`
- `image` (obavezno): jpeg/png/webp, ≤ 10 MB
- `previousReading` (opciono): JSON `{ vt?, nt?, single? }` — za validaciju iz faze 6

**Response 200:**
```json
{
  "status": "ok" | "needs_review" | "retake",
  "data": { "...MeterReading...", "readingDate": "2026-09-26T10:00:00Z" },
  "warnings": [{ "code": "LOW_CONFIDENCE_VT", "message": "Proverite vrednost VT" }],
  "meta": { "model": "…", "promptVersion": "v1", "latencyMs": 1840, "costUsd": 0.0004 }
}
```
- `ok` — sve prošlo, forma se popunjava.
- `needs_review` — podaci postoje, ali neko pravilo/niska sigurnost traži da korisnik proveri označena polja.
- `retake` — nije brojilo ili je slika neupotrebljiva; `warnings` kaže zašto.

**Greške:** 400 (nema slike / pogrešan tip / prevelika), 502 (model nedostupan posle fallbacka), 504 (timeout). Telo greške: `{ status: "error", code, message }`.

### 4.2 Koraci u ruti
1. Parsiranje `formData`, validacija tipa i veličine.
2. `preprocess.ts` (sharp): `rotate()` po EXIF-u, resize na max 1600px dužu stranu, JPEG q85, skidanje metapodataka. (Pre skidanja pročitati EXIF datum ako postoji.)
3. `extract()` sa `MODEL_PRIMARY`; OpenRouter `models: [primary, fallback]` za automatski fallback.
4. Zod parse; ako padne → 1 retry; ako opet padne → 502.
5. `validate.ts` (faza 6) → status + warnings.
6. Logovanje u konzolu: model, latencija, cena, status (bez slike).

### 4.3 Konfiguracija
`.env.local`: `OPENROUTER_API_KEY`, `MODEL_PRIMARY`, `MODEL_FALLBACK`, `PROMPT_VERSION`. Na Vercelu: iste env promenljive; ruta `runtime = "nodejs"` (zbog sharp-a), `maxDuration` ≥ 30.

**Izlaz:** radna ruta, testirana `curl`-om na 5 slika iz dataseta.
**DoD:** isti rezultat kao eval za iste slike; greške vraćaju ispravne kodove; ključ nije vidljiv klijentu.

---

## Faza 5 — Frontend (jedna stranica)

### 5.1 Tok ekrana (state machine)
`idle → preview → uploading → result(ok | needs_review | retake) → confirmed`

### 5.2 Komponente
1. **UploadField** — `<input type="file" accept="image/*" capture="environment">`. Na telefonu direktno otvara zadnju kameru; na desktopu file picker + drag&drop. Uz dugme vizuelni vodič: okvir/ilustracija "Brojilo neka popuni okvir, bez odsjaja".
2. **Preview** — prikaz slike pre slanja, dugmad "Pošalji" / "Slikaj ponovo".
3. **Loading** — skeleton forme + tekst "Čitam brojilo…"; prikaz proteklog vremena (lepo za demo: "1.8 s").
4. **MeterForm** — popunjena, **editabilna** polja (tip, tarifa, serijski broj, VT, NT/JT, datum). Polja sa niskom sigurnošću ili upozorenjem obojena žuto sa porukom. Prikazuju se samo relevantna polja (jednotarifno → samo JT).
5. **Prethodno stanje** — mali opcioni input (ili dugme "Učitaj mock prethodno stanje") da se na demou pokaže pravilo "novo ≥ prethodno".
6. **StatusBanner** — za `retake`: jasna poruka + dugme "Slikaj ponovo".
7. **Potvrda** — dugme "Potvrdi očitavanje" → prikaz finalnog JSON-a (simulacija slanja u postojeći sistem).
8. **Meta traka** (diskretno, za demo): model, latencija, cena.

**Izlaz:** stranica koja radi na desktopu i na telefonu (preko deploya na Vercel).
**DoD:** ceo tok radi na pravom telefonu preko HTTPS-a; svi statusi vizuelno pokriveni.

---

## Faza 6 — Validacija i edge case-ovi

Sva pravila su **čiste funkcije** u `lib/validate.ts`, pokrivene Vitest testovima. Server ih izvršava; klijent samo prikazuje rezultat.

| # | Pravilo | Posledica |
|---|---|---|
| V1 | `isMeter === false` | `retake`, "Na slici nije prepoznato brojilo" |
| V2 | `imageQuality.blur/glare/partial` i nedostaju stanja | `retake` sa konkretnim savetom ("Pomerite telefon da izbegnete odsjaj") |
| V3 | Novo stanje < prethodno (po tarifi) | `needs_review`, polje označeno |
| V4 | Broj cifara ne odgovara tipu brojila (konfigurabilno: npr. mehaničko 5–6 celobrojnih + 1 decimala; LCD 6–8) | `needs_review` |
| V5 | `tariffType === "dual"` a nedostaje VT ili NT | `needs_review` ("Na LCD brojilu slikajte i drugu tarifu") |
| V6 | `tariffType === "single"` a vraćeni VT/NT | normalizacija ili `needs_review` |
| V7 | Nerealan skok potrošnje u odnosu na prethodno (npr. > 100 kWh/dan, konfigurabilno) | `needs_review` |
| V8 | `confidence === "low"` za bilo koje stanje | `needs_review` |
| V9 | Serijski broj ne odgovara očekivanom formatu (samo alfanumerički, dužina u opsegu) | upozorenje |

**Napomena za LCD dvotarifna:** ekran prikazuje jednu tarifu odjednom. Za prototip: korisnik može poslati drugu sliku, a forma spaja vrednosti po `visibleTariff`. (Minimalno: jasno upozorenje V5.)

**Izlaz:** `validate.ts` + testovi; eval izveštaj dopunjen metrikom "koliko pogrešnih očitavanja je validacija uhvatila" (koristi se kao argument: *čak i kad model pogreši, sistem to često uhvati*).
**DoD:** svi testovi zeleni; svako pravilo ima bar jedan test i bar jedan demo primer.

---

## Faza 7 (opciono) — React Native mock (Expo)

Samo ako ostane vremena posle faze 6 — web verzija već pokriva demo uživo.
- Expo + `expo-camera` (`CameraView`) sa overlay okvirom "Postavite brojilo ovde".
- Slikanje → isti `POST /api/read-meter` → loading → ista forma → potvrda.
- Deli tipove sa webom (kopirana `schema.ts` ili zajednički paket).

**DoD:** tok radi preko Expo Go na telefonu protiv deploy-ovanog backenda.

---

## Faza 8 — Demo i prezentacija

### 8.1 Priprema
- Deploy na Vercel; QR kod za otvaranje stranice na telefonu.
- **Warm-up** poziv pre demoa (prvi poziv može biti sporiji).
- Rezervni plan: snimljen video celog toka + 3 slike spremne u galeriji telefona (ako nema brojila u sali ili nema interneta).

### 8.2 Scenario (≈ 7 min)
1. **Problem** (30 s): ručno prepisivanje brojila, greške, vreme.
2. **Eval rezultati** (2 min): tabela modela (tačnost po polju, tačnost celog zapisa, cena/1000 slika, latencija) + tabela po kategoriji (mehaničko/LCD/odsjaj). Obrazloženje izbora modela.
3. **Live demo** (2 min): slikanje brojila → forma popunjena za 2–3 s → potvrda.
4. **Edge case-ovi** (1.5 min): slika koja nije brojilo → "slikaj ponovo"; prethodno stanje veće od novog → označeno polje.
5. **Sledeći koraci** (1 min): veći dataset, integracija u postojeću aplikaciju, native kamera, praćenje tačnosti u produkciji.

**DoD:** demo prođen 3 puta za redom bez greške; rezervni video spreman.

---

## Redosled i procena
| Faza | Procena |
|---|---|
| 1. Dataset | 1–2 dana (zavisi od pristupa brojilima) |
| 2. Šema | 0.5 dana |
| 3. Eval | 1.5–2 dana |
| 4. Backend | 0.5–1 dan |
| 5. Frontend | 1 dan |
| 6. Validacija | 0.5–1 dan |
| 7. Expo (opciono) | 1 dan |
| 8. Demo priprema | 0.5 dana |

Faze 1 i 2 mogu teći paralelno (šema se prvo skicira, pa se potvrdi na prvih 10 slika).

---

## Otvorena pitanja (rešiti pre/tokom faze 2)
1. Tačan spisak i nazivi polja u postojećoj aplikaciji?
2. Da li se u sistemu čuva decimala stanja ili samo celobrojni kWh?
3. Koji tipovi brojila se najčešće javljaju kod korisnika (udeo mehaničkih vs LCD)?
4. Budžet po očitavanju (utiče na izbor modela)?

## Rezultati (popunjava se posle faze 3)
| Model | Tačnost ceo zapis | VT | NT | JT | Serijski | isMeter | p50 latencija | Cena/1000 |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |

## Dnevnik odluka
| Datum | Odluka | Razlog |
|---|---|---|
| 2026-09-26 | Web (Next.js) sa `capture="environment"` kao primarni demo; RN/Expo opciono | Uputstvo projekta: React frontend + jedna Next ruta; web kamera je dovoljna za live demo |
| 2026-09-26 | Cifre kao stringovi, decimala odvojeno | Čuva vodeće nule i omogućava proveru broja cifara |
| 2026-09-26 | Deljeni `lib/extract.ts` za API i eval | Eval meri tačno ono što ide u produkciju |
