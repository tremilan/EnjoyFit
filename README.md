# Enjoy Team — webový projekt

Nový statický web pro klienta Enjoy Team. Samostatný projekt, bez vazby na předchozí práce.

**GitHub:** https://github.com/tremilan/EnjoyFit

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

## Struktura

| Složka / soubor | Účel |
|---|---|
| `site/` | HTML, CSS, JS, assety |
| `site/css/` | Design systém a styly |
| `site/js/` | Interaktivita |
| `site/assets/` | Obrázky, ikony, média |
| `serve.py` | Lokální vývojový server |

## Klientské podklady

Složka `fotky/` (archiv FIT CLUB Milan) zůstává **mimo git** — obsahuje velké soubory (fotky, videa). Po rozbalení použijte vybrané assety ve `site/assets/images/`.

## Git

```bash
git remote add origin https://github.com/tremilan/EnjoyFit.git   # jen při prvním nastavení
git push -u origin main
```

## Stav

Základ projektu — připraveno k návrhu a implementaci obsahu.
