#!/usr/bin/env python3
"""Vérification dans un vrai Chromium : CSP réellement appliquée, aucune requête sortante,
parcours complet avec vrais téléchargements, hors-ligne (service worker), version autonome en file://.
Usage : python3 test/browser_check.py [dossier_captures]
"""
import csv, http.server, io, json, os, re, socketserver, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
os.makedirs(SHOTS, exist_ok=True)

CSV = ('Numéro client;Nom;Prénom;Email;Téléphone;Montant;Commentaire\r\n'
       'C-001;Dupont;Jean;jean.dupont@acme.fr;06 12 34 56 78;120;"Rappeler Jean Dupont; il est d’accord pour le Projet Aurore"\r\n'
       'C-002;Martin;Claire;claire.martin@acme.fr;01 23 45 67 89;80;RAS\r\n'
       'C-003;Bernard;Paul;paul.bernard@acme.fr;07 98 76 54 32;45;"Frère de Claire Martin, voir martin@acme.fr"\r\n'
       'C-004;Petit;Léa;lea.petit@acme.fr;06 11 22 33 44;10;Satisfaite du Projet Aurore\r\n')

def rows(text):
    # comparaison sémantique : les guillemets inutiles ne comptent pas
    return list(csv.reader(io.StringIO(text), delimiter=';'))

def parse_headers():
    out, cur = {}, None
    for line in open(os.path.join(SITE, '_headers'), encoding='utf-8'):
        if not line.strip() or line.startswith('#'):
            continue
        if not line.startswith(' '):
            cur = line.strip(); out[cur] = []
        else:
            k, v = line.strip().split(':', 1); out[cur].append((k.strip(), v.strip()))
    return out
HEADERS = parse_headers()

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        p = self.path.split('?')[0]
        for k, v in HEADERS.get(p, []): self.send_header(k, v)
        super().end_headers()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

srv = Server(('127.0.0.1', 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/'

results = []
def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('  OK   ' if ok else '  ECHEC'), name, ('— ' + str(detail)) if detail and not ok else '')

tmp = tempfile.mkdtemp()
csv_path = os.path.join(tmp, 'clients.csv')
open(csv_path, 'w', encoding='utf-8').write(CSV)

def run_flow(page, label):
    """Masque le CSV, télécharge clé + fichier masqué, restitue. Renvoie (clé, masqué, restitué) en texte."""
    page.set_input_files('#m-file', csv_path)
    page.wait_for_selector('#m2:not([hidden])', timeout=5000)
    page.fill('#m-terms', 'Projet Aurore')
    page.click('#m-run')
    page.wait_for_selector('#m4:not([hidden])', timeout=8000)
    page.click('#m-gen')
    passphrase = page.input_value('#m-pass')
    page.check('#m-ack')
    with page.expect_download() as d:
        page.click('#m-dl-key')
    keyp = os.path.join(tmp, label + '.voile'); d.value.save_as(keyp)
    page.wait_for_function("!document.querySelector('#m-dl-file').disabled")
    with page.expect_download() as d:
        page.click('#m-dl-file')
    maskedp = os.path.join(tmp, label + '-masque.csv'); d.value.save_as(maskedp)
    page.click('#tab-restituer')
    page.set_input_files('#r-key', keyp)
    page.fill('#r-pass', passphrase)
    page.click('#r-unlock')
    page.wait_for_selector('#r2:not([hidden])', timeout=8000)
    page.set_input_files('#r-file', maskedp)
    page.wait_for_selector('#r3:not([hidden])', timeout=5000)
    with page.expect_download() as d:
        page.click('#r3-body .btn:not(.second)')
    restp = os.path.join(tmp, label + '-restitue.csv'); d.value.save_as(restp)
    rd = lambda p: open(p, encoding='utf-8-sig').read()
    return rd(keyp), rd(maskedp), rd(restp)

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------------- 1. Site hébergé (avec les vrais en-têtes de _headers) ----------------
    print('Site hébergé :', BASE)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True, locale='fr-FR')
    page = ctx.new_page()
    console, errors, requests = [], [], []
    page.on('console', lambda m: console.append((m.type, m.text)))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    page.goto(BASE); page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2600)
    page.screenshot(path=os.path.join(SHOTS, '1-accueil.png'))
    check('la démonstration d’accueil atteint l’état « codes »', page.get_attribute('#demo', 'data-etat') == 'jeton')
    check('aucune erreur JavaScript au chargement', not errors, errors)
    bad = [c for c in console if c[0] == 'error']
    check('aucune erreur console (CSP incluse) au chargement', not bad, bad)

    blocked = page.evaluate("""async () => {
      const t = async (u) => { try { await fetch(u); return 'AUTORISE'; } catch (e) { return 'BLOQUE'; } };
      return { externe: await t('https://example.com/'), memeOrigine: await t('/index.html') };
    }""")
    check('la CSP bloque fetch vers un site externe', blocked['externe'] == 'BLOQUE', blocked)
    check('la CSP bloque même fetch vers sa propre origine (connect-src none)', blocked['memeOrigine'] == 'BLOQUE', blocked)
    inline = page.evaluate("""() => { window.__x = 0; const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.append(s); return window.__x; }""")
    check('un script injecté en ligne n’est pas exécuté', inline == 0, inline)

    n_before = len(requests)
    key, masked, restored = run_flow(page, 'heberge')
    new_requests = requests[n_before:]
    check('aucune requête réseau pendant tout le parcours', not new_requests, new_requests)
    leaks = [w for w in ['Dupont', 'Martin', 'Bernard', 'Petit', 'Jean', 'Claire', 'acme.fr', '06 12 34 56 78', 'C-001', 'Aurore'] if w in masked]
    check('le fichier masqué ne contient aucune valeur d’origine', not leaks, leaks)
    check('la clé téléchargée ne contient aucune valeur d’origine', 'Dupont' not in key and 'acme' not in key)
    check('la restitution redonne le fichier d’origine à l’identique', rows(restored) == rows(CSV), restored[:200])
    page.click('#tab-masquer')

    page.set_input_files('#m-file', csv_path)
    page.wait_for_selector('#m2:not([hidden])')
    page.screenshot(path=os.path.join(SHOTS, '2-colonnes.png'), full_page=True)
    page.click('#m-run'); page.wait_for_selector('#m4:not([hidden])')
    page.screenshot(path=os.path.join(SHOTS, '3-resultat.png'), full_page=True)

    # Service worker + hors-ligne
    page.evaluate("navigator.serviceWorker.ready.then(() => 1)")
    page.reload(); page.wait_for_load_state('networkidle')
    ctx.set_offline(True)
    page.reload(); page.wait_for_load_state('domcontentloaded')
    check('hors-ligne : la page se recharge depuis le cache', 'Voile' in page.title() and page.locator('#m-file').count() == 1, page.title())
    n_before = len(requests)
    key2, masked2, restored2 = run_flow(page, 'horsligne')
    check('hors-ligne : parcours complet fonctionnel', rows(restored2) == rows(CSV))
    ctx.set_offline(False)
    ctx.close()

    # ---------------- 2. Mobile ----------------
    mctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='fr-FR')
    mp = mctx.new_page(); mp.goto(BASE); mp.wait_for_timeout(2600)
    mp.screenshot(path=os.path.join(SHOTS, '4-mobile.png'))
    overflow = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check('mobile : pas de défilement horizontal de la page', not overflow)
    mctx.close()

    # ---------------- 3. Version autonome (file://) ----------------
    solo = 'file://' + os.path.join(SITE, 'voile-hors-ligne.html')
    print('Version autonome :', solo)
    sctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True, locale='fr-FR')
    sp = sctx.new_page()
    serr, scons, sreq = [], [], []
    sp.on('pageerror', lambda e: serr.append(str(e)))
    sp.on('console', lambda m: scons.append((m.type, m.text)))
    sp.on('request', lambda r: sreq.append(r.url))
    sp.goto(solo); sp.wait_for_timeout(2600)
    check('autonome : la CSP par empreintes laisse le script s’exécuter', sp.get_attribute('#demo', 'data-etat') == 'jeton', scons)
    check('autonome : aucune erreur', not serr and not [c for c in scons if c[0] == 'error'], (serr, scons))
    check('autonome : aucune requête hors file://', all(u.startswith('file://') or u.startswith('data:') for u in sreq), sreq)
    k3, m3, r3 = run_flow(sp, 'autonome')
    check('autonome : parcours complet et restitution exacte', rows(r3) == rows(CSV))
    sp.screenshot(path=os.path.join(SHOTS, '5-autonome-restitution.png'), full_page=True)
    sctx.close()
    browser.close()

srv.shutdown()
failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} vérifications réussies. Captures : {SHOTS}')
sys.exit(1 if failed else 0)
