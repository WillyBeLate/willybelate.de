# willybelate-website

Eigene Website von WillyBeLate unter **https://willybelate.de**.
Reines HTML/CSS/JS, kein Build-Schritt, keine Datenbank.

- **Domain:** netcup (nur Domain, kein Webhosting)
- **Hosting:** GitHub Pages, kostenlos, HTTPS automatisch

## Aufbau

```
willybelate-website/        ← das ist das GitHub-Repo
├─ README.md                (wird nicht veröffentlicht)
└─ docs/                    ← nur dieser Ordner wird veröffentlicht
   ├─ CNAME                 enthält "willybelate.de"
   ├─ .nojekyll             GitHub soll die Dateien unverändert ausliefern
   ├─ index.html            Startseite (Platzhalter)
   ├─ impressum.html        Pflichtseite, Platzhalter
   ├─ datenschutz.html      Pflichtseite, Platzhalter
   ├─ 404.html              Fehlerseite (GitHub nutzt sie automatisch)
   ├─ robots.txt
   ├─ sitemap.xml
   └─ assets/
      ├─ css/style.css      Design-Tokens (Brand "Late night") + Grundlayout
      ├─ js/main.js         Minimal (Jahreszahl im Footer)
      ├─ img/               Favicon (vorläufig), später Logo & Bilder
      └─ fonts/             Selbst gehostete Schriften (siehe LIES-MICH.txt)
```

## Lokal ansehen

```powershell
cd "W:\Content\Content Creation\willybelate-website\docs"
py -m http.server 8080
```

Dann <http://localhost:8080> öffnen.

## Einrichtung (einmalig)

Reihenfolge einhalten: erst GitHub, dann DNS. So kann niemand die Domain bei GitHub „kapern“.

### 1. Repo auf GitHub
1. Auf github.com (Konto `willybelate`) ein **neues, öffentliches** Repository anlegen,
   z. B. `willybelate.de`. Kostenloses Pages geht nur bei öffentlichen Repos.
2. Den Inhalt dieses Ordners hochladen (GitHub Desktop oder „Add file → Upload files“;
   die Dateien `.nojekyll` und `CNAME` müssen mit hoch).
3. Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch `main`, Ordner **`/docs`** → Save.
4. Unter *Custom domain* `willybelate.de` eintragen → Save.
5. Empfohlen: Profil-Einstellungen → **Pages → Add a domain** → `willybelate.de` verifizieren
   (GitHub nennt dafür einen TXT-Eintrag, den du bei netcup anlegst).

### 2. DNS bei netcup
netcup CCP → **Domains** → Lupe neben `willybelate.de` → Reiter **DNS**.
Vorhandene A-/AAAA-Einträge für `@` und `www` (netcup-Parkseite) entfernen, dann anlegen:

| Host | Typ   | Ziel                    |
|------|-------|-------------------------|
| @    | A     | 185.199.108.153         |
| @    | A     | 185.199.109.153         |
| @    | A     | 185.199.110.153         |
| @    | A     | 185.199.111.153         |
| @    | AAAA  | 2606:50c0:8000::153     |
| @    | AAAA  | 2606:50c0:8001::153     |
| @    | AAAA  | 2606:50c0:8002::153     |
| @    | AAAA  | 2606:50c0:8003::153     |
| www  | CNAME | willybelate.github.io.  |

MX-Einträge (E-Mail) nicht anfassen. Änderungen können einige Stunden dauern.

### 3. HTTPS
Wenn die Domain bei GitHub grün geprüft ist: Settings → Pages → **Enforce HTTPS** anhaken
(kann bis zu 24 h dauern, bis die Option erscheint).

## Änderungen veröffentlichen
Dateien in `docs/` ändern, committen und pushen. Nach ca. 1 Minute ist es live.

## Die TikTok-Seiten
Terms/Privacy bleiben im Repo `willybelate.github.io` und unter der alten Adresse erreichbar.
Dieses Repo hier hat eine eigene Domain und berührt sie nicht.
**Wichtig:** Im Repo `willybelate.github.io` keine eigene Domain eintragen, sonst leiten die
TikTok-Adressen um.

## Vor dem Livegang
- [ ] Impressum (§ 5 DDG) und Datenschutzerklärung ausfüllen (Hoster: GitHub), `.todo`-Hinweise entfernen
- [ ] Schriften selbst hosten (keine Google-Fonts-Einbindung)
- [ ] Favicon durch echtes Logo ersetzen
- [ ] Enforce HTTPS aktiv
