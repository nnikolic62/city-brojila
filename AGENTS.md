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

## Skill i promptovi za modele

Skill `meter-pipeline` postoji na četiri mesta i mora ostati isti tekst:

- `docs/skills/meter-pipeline/SKILL.md` (izvor)
- `.claude/skills/meter-pipeline/SKILL.md`
- `.cursor/skills/meter-pipeline/SKILL.md`
- `.opencode/skills/meter-pipeline/SKILL.md`

OpenCode subagenti za taj skill: `.opencode/agent/meter-locator.md`, `meter-extractor.md`, `meter-reader.md`.

Kad menjaš skill, ista izmena ide u sve četiri kopije u istom potezu. Pravila čitanja u agentima i u `lib/prompts/v6.ts` moraju da se slažu. v1–v5 se ne menjaju posle eval pokretanja; sledeća izmena prompta je novi fajl.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
