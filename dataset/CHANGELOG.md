# Izmene ground trutha

| Datum | Slika | Izmena | Razlog |
|---|---|---|---|
| 2026-09-26 | m001 | Dodata (slika sa interneta, isečen okvir pretrage) | Ground truth čitan sa slike, ne sa brojila; VT=T1 je pretpostavka |
| 2026-10-01 | m001 | Prelazak na OBIS šemu: `15.8.1` / `00370386`, `manufacturer` EWG, uklonjeni VT/NT/meterKind | docs/PRD.md — vrednost kao jedan string sa slike |
| 2026-10-01 | m002–m004 | Dodati uzorci (ista tablica serijski); ID `m00x`, `yearOfManufacture` kao string | Šema ground trutha; eval dev set |
| 2026-10-02 | im29-25 | Dodat ground truth: LCD `15.8.2` / `002126.66`, serijski `31205125` (isti brojilo kao im25–im28) | Slika već u gitu; upotpunjavanje dataseta za eval |
