# Enjoy Team — webový projekt

Nový statický web pro klienta Enjoy Team. Samostatný projekt, bez vazby na předchozí práce.

**GitHub:** https://github.com/tremilan/EnjoyFit  
**Veřejná URL:** https://tremilan.github.io/EnjoyFit/

## Spuštění náhledu

```bash
cd ~/Desktop/Enjoy\ Team
python3 serve.py
```

→ http://127.0.0.1:8000

Test na telefonu ve stejné Wi‑Fi:

```bash
python3 serve.py --lan
```

## GitHub Pages

Web se publikuje ze složky `docs/` ve větvi `main`.

**Jednorázové nastavení v GitHubu:** [Settings → Pages](https://github.com/tremilan/EnjoyFit/settings/pages) → **Build and deployment → Source:** Deploy from a branch → **Branch:** `main` → **Folder:** `/docs` → Save.

Po uložení může první nasazení trvat 1–2 minuty.

## Struktura

| Složka / soubor | Účel |
|---|---|
| `docs/` | HTML, CSS, JS, assety (zdroj i GitHub Pages) |
| `docs/css/` | Design systém a styly |
| `docs/js/` | Interaktivita |
| `docs/assets/` | Obrázky, ikony, média |
| `serve.py` | Lokální vývojový server |

## Klientské podklady

Složka `fotky/` (archiv FIT CLUB Milan) zůstává **mimo git** — obsahuje velké soubory (fotky, videa). Po rozbalení použijte vybrané assety ve `docs/assets/images/`.

## Git

```bash
git push origin main
```

## Stav

Základ projektu — připraveno k návrhu a implementaci obsahu.
