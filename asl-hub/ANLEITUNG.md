# ASL-Hub auf willybelate.de/asl

Die Seite selbst liegt kostenlos auf GitHub Pages (`docs/asl/`). Gespeichert und angemeldet wird über einen
kostenlosen **Cloudflare Worker** mit **D1-Datenbank** (`asl-hub/worker/`). Ohne Anmeldung sieht jeder den Live-Stand,
mit Konto kann man bearbeiten.

```
asl-hub/
├─ hub.html          Quelle: komplette App inkl. Daten (läuft auch als Claude-Artifact)
├─ build.py          baut daraus docs/asl/index.html
├─ config.json       Adresse des Workers ("api")
├─ fonts.css         Schriften (selbst gehostet, keine Google-Fonts)
└─ worker/
   ├─ worker.js      Server: Speichern, Login, Konten, Verlauf
   └─ wrangler.toml  nur nötig, wenn du per Kommandozeile deployst
docs/asl/            ← das wird veröffentlicht (Seite, Logo, Schriften)
```

**Wichtig:** Das Repo ist öffentlich. Passwörter und Secrets gehören nur in Cloudflare, nie in eine Datei hier.

## Einmalig einrichten (ca. 15 Minuten, alles im Browser)

### 1. Cloudflare-Konto
<https://dash.cloudflare.com/sign-up> – kostenlos, keine Kreditkarte nötig.

### 2. Datenbank anlegen
Links **Storage & Databases → D1 SQL Database → Create Database**
- Name: `asl`
- Location: *Western Europe* (falls gefragt)
- Tabellen musst du nicht anlegen, das macht der Worker beim ersten Aufruf selbst.

### 3. Worker anlegen
Links **Compute (Workers) → Workers & Pages → Create → Start with Hello World**
- Name: `asl-api` → **Deploy**
- Dann **Edit code**, den kompletten Inhalt von `asl-hub/worker/worker.js` hineinkopieren (alles ersetzen) → **Deploy**.

### 4. Datenbank verbinden
Im Worker `asl-api` → **Bindings → Add binding → D1 database**
- Variable name: `DB`
- Database: `asl` → speichern.

### 5. Einstellungen setzen
Im Worker → **Settings → Variables and Secrets → Add**

| Name | Typ | Wert |
|---|---|---|
| `SESSION_SECRET` | Secret | lange Zufallszeichenkette (mind. 32 Zeichen, siehe unten) |
| `ADMIN_USER` | Text | `Willy` (dein Anmeldename) |
| `ADMIN_PASSWORD` | Secret | dein erstes Passwort (mind. 8 Zeichen) |
| `ALLOWED_ORIGINS` | Text | `https://willybelate.de,https://www.willybelate.de` |

Zufallswert für `SESSION_SECRET` in PowerShell erzeugen:
```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```
Danach **Deploy** (bzw. Änderungen speichern).

Test: Die Worker-Adresse (z. B. `https://asl-api.DEINNAME.workers.dev/state`) im Browser öffnen →
es sollte etwas wie `{"v":0,...,"state":null}` erscheinen.

### 6. Adresse eintragen
Die Worker-Adresse (ohne `/state`) an Claude schicken – oder selbst in `asl-hub/config.json` eintragen:
```json
{"api": "https://asl-api.DEINNAME.workers.dev"}
```
und im Ordner `willybelate-website` ausführen:
```powershell
py asl-hub/build.py
```

### 7. Veröffentlichen
Mit GitHub Desktop committen und pushen. Nach ca. 1 Minute: **https://willybelate.de/asl/**

### 8. Erste Anmeldung
Auf der Seite oben rechts **Anmelden** mit `ADMIN_USER` / `ADMIN_PASSWORD`. Dabei wird dein Admin-Konto angelegt.
Danach: Menü (dein Name) → **Konten & Verlauf** → Kollegen anlegen und Name + Startpasswort weitergeben.
`ADMIN_PASSWORD` kannst du nach dem ersten Login in Cloudflare löschen und dein Passwort im Hub ändern.

## Im Alltag
- **Lesen:** jeder, ohne Anmeldung. Die Seite aktualisiert sich alle 20 Sekunden selbst.
- **Bearbeiten:** angemeldete Konten. Speichert automatisch nach ein paar Sekunden.
- **Gleichzeitig bearbeiten:** Speichern zwei Leute fast gleichzeitig, werden beide Änderungen zusammengeführt.
  Nur wenn beide *dasselbe Feld* ändern, gilt die zuletzt gespeicherte Eingabe.
- **Konten (Admin):** anlegen, Rolle ändern, Passwort neu setzen, sperren, löschen. Sperren/neues Passwort meldet überall ab.
- **Verlauf (Admin):** die letzten 300 Speicherstände bleiben erhalten; die letzten 60 lassen sich im Hub zurückholen.
- **Gesamtsicherung (Admin):** alles als JSON herunterladen bzw. wieder laden.
- Anmeldung bleibt 30 Tage gültig. Nach 6 falschen Passwörtern ist der Name 10 Minuten gesperrt.

## Kostenlos-Grenzen (Cloudflare Free)
100.000 Aufrufe und 100.000 Speichervorgänge in D1 pro Tag – für den Hub um ein Vielfaches mehr als nötig.
Nichts schläft ein, nichts muss „geweckt“ werden.

## Datenschutz
Neu durch den Hub: Kontonamen, Passwort-Hashes und Speicherzeitpunkte liegen bei Cloudflare (Datenbank),
der Anmelde-Schlüssel im Browser (localStorage). Das gehört in die Datenschutzerklärung (Auftragsverarbeiter Cloudflare).
Die Hub-Seite lädt nichts von fremden Servern außer dem eigenen Worker; Schriften sind selbst gehostet.
