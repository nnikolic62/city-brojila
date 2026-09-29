# Dataset (PLAN.md, faza 1)

- Slike: `images/m001.jpg`, `m002.jpg`… (slike NISU u gitu — sadrže serijske brojeve; čuvaj ih lokalno/na drajvu)
- Istina: `ground-truth.json` (format: vidi `ground-truth.example.json`)
- Provera: `npm run dataset:check` (šema, postojanje fajlova, pokrivenost)
- Ispravke ground trutha beleži u `CHANGELOG.md`

## Pravila zapisa
- Vrednosti zapisuj **odmah pored brojila**, ne naknadno sa slike.
- Cifre su stringovi, sa vodećim nulama. Decimala (crvena cifra) posebno, `null` ako je nema.
- Ono što se na slici ne vidi → `null`.
- Negativni primeri: `isMeter: false`, sve ostalo `null`.
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
