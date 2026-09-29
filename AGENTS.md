# Čitač brojila — instrukcije za rad

Prototip: slika brojila → OpenRouter vision model → strukturirani JSON → forma.
**Plan i faze: `PLAN.md` — pročitaj ga pre bilo kakve izmene i radi strogo fazu po fazu (DoD pre sledeće faze).**

## Stack
Next.js 16 (App Router) + TypeScript strict, Tailwind v4, Zod v4, sharp, Vitest, tsx. Node ≥ 22. npm.

## Mapa koda
- `lib/schema.ts` — JEDINI izvor istine za oblik podataka (model, API, ground truth). Ne dupliraj tipove.
- `lib/extract.ts` — poziv OpenRoutera + Zod parse. Deli ga API ruta i eval (eval meri ono što ide u produkciju).
- `lib/preprocess.ts` — sharp: EXIF rotacija, resize 1600px, JPEG, bez metapodataka.
- `lib/validate.ts` — poslovna pravila V1–V9 (čiste funkcije, pokrivene testovima).
- `lib/normalize.ts` — normalizacija cifara/serijskog broja.
- `lib/prompts/` — verzionisani promptovi. Postojeću verziju NE menjaj posle eval pokretanja; napravi novu.
- `lib/config.ts` — env + poslovni pragovi (RULES).
- `app/api/read-meter/route.ts` — jedina API ruta. `app/page.tsx` — jedina stranica.
- `eval/` — `run.ts` (sirovi odgovori), `score.ts` (metrike + report.md), `scoring.ts` (čiste funkcije).
- `dataset/` — slike (van gita) + `ground-truth.json`.

## Pravila
- Cifre stanja su stringovi (vodeće nule!), decimala odvojeno.
- Model je konfiguracija (`.env.local`, `eval/models.config.ts`), nikad hardkodovan u kodu.
- Ne hardkoduj ID-jeve OpenRouter modela napamet — proveri na openrouter.ai/models.
- `OPENROUTER_API_KEY` samo na serveru, nikad `NEXT_PUBLIC_`.
- Ground truth se ne menja da bi model "prošao"; ispravke u `dataset/CHANGELOG.md`.
- Pre završetka posla: `npm run check` (typecheck + lint + test) mora biti zeleno.
- UI tekst na srpskom (latinica), kod na engleskom.
