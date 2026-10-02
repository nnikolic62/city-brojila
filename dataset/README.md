# Dataset (PLAN.md, faza 1)

- Slike: `images/im*.jpeg` (u gitu radi eval-a na više mašina; repo je private — i dalje bez EXIF/GPS)
- Istina: `ground-truth.json` (format: vidi `ground-truth.example.json`)
- Provera: `npm run dataset:check` (šema, postojanje fajlova, pokrivenost)
- Ispravke ground trutha beleži u `CHANGELOG.md`

## Pravila zapisa (docs/PRD.md)
- Vrednosti zapisuj **odmah pored brojila**, ne naknadno sa slike (izuzetak: tag `internet` — tada beleži u `notes`).
- **Eval = jedna slika po uzorku** — `expected` je ono što model treba da vrati za tu sliku (isti oblik kao `MeterReadingSchema`).
- OBIS: samo kodovi **vidljivo otisnuti** na toj slici; `value` je **jedan string** tačno kako piše na displeju (vodeće nule, decimala uključena ako je tako prikazano).
- `serialNumber`, `manufacturer`, `yearOfManufacture` → `null` ako na slici nije jasno vidljivo (ne izmišljati). Kod tipa/modela (npr. `E311N2A20`) **nije** serijski broj.
- Negativni primeri: `isMeter: false`, `obis: []`, ostala polja `null`.
- Pre ubacivanja skini EXIF/GPS (`npm run dataset:strip-exif`).

## Tagovi (koristi dosledno)
`mechanical`, `electronic`, `single`, `dual`, `good-light`, `low-light`, `glare`, `angle`, `partial`, `negative`, `internet` (slika nije lično slikana — ground truth čitan sa slike)

## Pokrivenost (cilj → trenutno; ažurira `dataset:check`)
| Kategorija | Cilj |
|---|---|
| mechanical + single | 6 |
| mechanical + dual | 6 |
| electronic + single | 6 |
| electronic + dual | 6 |
| low-light | 5 |
| glare | 5 |
| angle / partial | 4 |
| negative | 4–6 |
