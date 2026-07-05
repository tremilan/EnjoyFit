# Enjoy team – Web

Jednostránkový web pro fitness tým Enjoy team se dvěma pobočkami a vlastním rezervačním kalendářem.

**GitHub:** https://github.com/tremilan/EnjoyFit  
**Veřejná URL (statický web):** https://tremilan.github.io/EnjoyFit/

## Spuštění lokálně (plná verze včetně rezervací)

```bash
cd ~/Desktop/Enjoy\ Team
python3 server.py
```

Web poběží na **http://localhost:3000**

| Stránka | URL |
|---------|-----|
| Hlavní web | http://localhost:3000 |
| Rezervace Frýdlant | http://localhost:3000/rezervace/frydlant.html |
| Rezervace Krmelín | http://localhost:3000/rezervace/krmelin.html |

> **Poznámka:** Nestačí otevřít `index.html` v prohlížeči ani `python3 -m http.server` — rezervace potřebují `server.py` s databází.

## GitHub Pages

Statický web (design, texty, loga) se publikuje ze složky `docs/` při pushi do `main`.

**Rezervační kalendář na GitHub Pages nefunguje** — vyžaduje běžící `server.py` a SQLite databázi. Pro produkční rezervace je potřeba hosting s backendem (VPS, Railway, Render…).

## Rezervační kalendář

### Pro návštěvníky
1. Otevřete kalendář své pobočky
2. Klikněte na zelený den s lekcí
3. Vyberte volné místo a vyplňte údaje

### Pro admina (trenéry)
1. Klikněte na **Admin** a zadejte PIN (výchozí: `enjoy2026`)
2. Klikněte na den s „+ lekce“ pro přidání termínu
3. V detailu lekce můžete uvolnit místo nebo smazat celou lekci

### Změna admin PIN
```bash
ADMIN_PIN=vase-heslo python3 server.py
```

Data se ukládají do `data/rezervace.db` (SQLite, mimo git).

## Struktura

| Složka / soubor | Účel |
|---|---|
| `docs/` | HTML, CSS, JS, assety (zdroj i GitHub Pages) |
| `server.py` | Lokální web + rezervační API |
| `data/` | SQLite databáze (lokálně, gitignored) |
| `fotky/` | Klientské podklady (lokálně, gitignored) |

## Barvy

- Pozadí: `#bdcfc0` (šalvějová zelená)
- Text: `#2e6348` / `#3d7457` (tmavě zelená)
