# Čitač brojila (prototip)

Fotografija brojila → vision model preko OpenRoutera → popunjena forma (serijski broj, VT/NT/JT).
Detaljan plan po fazama: [`PLAN.md`](./PLAN.md).

## Pokretanje
```bash
npm install
cp .env.example .env         # upiši OPENROUTER_API_KEY i MODEL_PRIMARY
npm run dev                  # http://localhost:3000
```
Za slikanje telefonom potreban je HTTPS (deploy na Vercel ili tunel, npr. `npx localtunnel --port 3000`).

## Skripte
| Komanda | Šta radi |
|---|---|
| `npm run dev` | Dev server |
| `npm run check` | typecheck + lint + testovi |
| `npm run dataset:check` | Provera ground trutha, slika i pokrivenosti kategorija |
| `npm run dataset:strip-exif` | Skida EXIF/GPS sa slika u `dataset/images` |
| `npm run eval:run -- --split dev` | Šalje dataset na modele iz `eval/models.config.ts`, čuva sirove odgovore |
| `npm run eval:score` | Računa metrike za poslednji run → `eval/results/<ts>/report.md` |

Opcije za `eval:run`: `--split dev\|holdout\|all`, `--prompt v1`, `--runs 3`, `--concurrency 4`, `--models id1,id2`, `--no-preprocess`.

## API
`POST /api/read-meter` — `multipart/form-data`: `image` (obavezno), `previousReading` (opciono, JSON `{"vt":"045000","nt":"021000"}`).
Odgovor: `{ status: "ok" | "needs_review" | "retake", data, warnings, meta }` ili `{ status: "error", code, message }`.

```bash
curl -F image=@dataset/images/m001.jpg -F 'previousReading={"vt":"045000"}' http://localhost:3000/api/read-meter
```

## Status faza
- [x] 0. Inicijalizacija (struktura, šema v1, extract, ruta, validacija, eval alati, testovi)
- [ ] 1. Dataset (30–50 slika + ground truth)
- [ ] 2. Potvrda šeme sa postojećom aplikacijom
- [ ] 3. Eval 3–4 modela → izbor primarnog/fallback modela
- [ ] 4. Backend: test na pravim slikama
- [ ] 5. Frontend: forma, statusi, potvrda
- [ ] 6. Validacija: kalibracija pragova na datasetu
- [ ] 7. (opciono) Expo mock
- [ ] 8. Demo
