"""Baut aus asl-hub/hub.html (Artifact-Fassung, inkl. Daten) die Website-Fassung docs/asl/index.html.
Aufruf (im Ordner willybelate-website):  py asl-hub/build.py
"""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
hub = (root / 'asl-hub' / 'hub.html').read_text(encoding='utf-8')
cfg = json.loads((root / 'asl-hub' / 'config.json').read_text(encoding='utf-8'))
out_dir = root / 'docs' / 'asl'
fonts_css = (root / 'asl-hub' / 'fonts.css').read_text(encoding='utf-8')
reset = re.search(r'<style>(.*?)</style>', hub, re.S).group(1)
rest = hub[hub.index('<style id="appStyle">'):]
api = cfg.get('api', '').strip()
head = f'''<!DOCTYPE html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Alta Sports League [ASL]</title>
<meta name="description" content="Alta Sports League – Turniere des Alta Police Department.">
<meta name="asl-api" content="{api}">
<meta name="theme-color" content="#16294a">
<link rel="icon" type="image/png" href="apd-logo.png">
<style>{reset}
{fonts_css}</style>
</head><body>
'''
(out_dir).mkdir(parents=True, exist_ok=True)
(out_dir / 'index.html').write_text(head + rest, encoding='utf-8')
print('geschrieben:', out_dir / 'index.html', '| API:', api or '(keine – nur Lese-Ansicht)')
