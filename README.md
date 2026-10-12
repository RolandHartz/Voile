# Voile

Pseudonymisez un fichier **avant** de le confier à une IA grand public, puis remettez les vraies valeurs dans la réponse. Tout se passe dans le navigateur : aucun serveur, aucun compte, aucune dépendance au runtime.

> Nom de travail : à renommer librement (titre dans `site/index.html`, `src/*.js`).

## Fonctionnement

1. **Masquer** : on dépose un CSV, un TSV, un Excel (.xlsx) ou un texte. Voile propose les colonnes à masquer (par nom de colonne *et* par contenu : e-mails, téléphones, IBAN, SIRET, NIR, cartes, IP validés par leur clé de contrôle). L'utilisateur valide, ajoute ses colonnes et ses mots (noms de clients, de projets).
2. Chaque valeur est remplacée par un code stable (`PERSONNE_001`, `EMAIL_017`…) : même valeur, même code, dans tout le fichier. Les noms des colonnes masquées sont aussi cherchés dans les textes libres.
3. Voile fournit le fichier masqué et un **fichier clé** `.voile` (correspondance codes ↔ valeurs), chiffré en AES-256-GCM avec une phrase de passe (PBKDF2-SHA256, 600 000 itérations).
4. **Restituer** : on ouvre la clé, on dépose le fichier revenu de l'IA, les codes sont remplacés par les vraies valeurs. Un rapport signale les codes inconnus (inventés par l'IA) et les codes absents.

### Pourquoi pas un hachage ?

Un hash est à sens unique : on ne peut pas « désanonymiser » avec l'algorithme, et un SHA-256 de nom, d'e-mail ou de téléphone se retrouve par force brute. Les codes sont donc de simples compteurs ; la réversibilité vient uniquement de la table de correspondance, que l'utilisateur garde chiffrée. Rien n'est stocké dans le navigateur (ni localStorage, ni IndexedDB) : la clé est un fichier que l'utilisateur conserve lui-même.

## Limites à connaître

- **Pseudonymisation, pas anonymisation.** Tant que la clé existe, ce sont des données personnelles au sens du RGPD. Le risque est réduit, pas supprimé. Ne jamais écrire « conforme RGPD » ou « anonymisé » dans la communication.
- Le repérage ne voit que ce qui a une **forme reconnaissable** et les **mots listés** par l'utilisateur. Un nom propre inconnu dans un texte libre passe à travers. D'où l'aperçu avant/après, le contrôle résiduel (colonnes non masquées qui contiennent encore des e-mails, téléphones…) et le message du pied de page.
- Les dates, montants, codes postaux, villes sont des **quasi-identifiants** : proposés mais décochés par défaut.
- Excel : première feuille uniquement, valeurs (les formules ne sont pas conservées), mise en forme non conservée. Les classeurs protégés par mot de passe sont refusés.
- Phrase de passe perdue ou fichier clé perdu : la restitution est impossible. Voile ne peut rien récupérer.
- Un fichier clé dont la phrase de passe est faible ne vaut pas mieux qu'un fichier en clair : le bouton « Générer » produit ~100 bits d'entropie.

## Garanties techniques (vérifiables)

- Aucune requête réseau : la CSP (`default-src 'none'`, donc `connect-src 'none'`) est posée en en-tête HTTP **et** en balise meta. `test/browser_check.py` le vérifie dans un vrai Chromium (fetch externe et même origine bloqués, script injecté non exécuté, zéro requête pendant tout le parcours, parcours complet hors-ligne).
- Aucune dépendance au runtime, aucun CDN, aucune police externe. `voile.js` n'est **pas minifié** : le code servi est lisible tel quel.
- `site/SHA256SUMS` donne l'empreinte de chaque fichier servi.
- `site/voile-hors-ligne.html` : tout le site en un fichier, avec une CSP par empreintes (`script-src 'sha256-…'`). Il fonctionne depuis le disque (`file://`).
- Le nom du fichier d'origine n'est jamais repris dans les fichiers produits (`fichier-masque.csv`, `cle-voile-AAAA-MM-JJ.voile`) : il peut contenir un nom de client.
- Tout contenu affiché passe par `textContent` : jamais d'`innerHTML` avec des données.

## Développement

```bash
node build.mjs            # produit site/voile.js, sw.js, voile-hors-ligne.html, _headers, SHA256SUMS
npm install               # uniquement pour les tests d'interface (jsdom)
npm test                  # cœur (CSV, motifs, détection, jetons, chiffrement) + Excel
npm run test:ui           # parcours complet de l'interface (jsdom)
python3 test/browser_check.py [dossier_captures]   # vrai Chromium via Playwright
```

Structure : `src/csv.js`, `patterns.js`, `detect.js`, `vault.js`, `crypto.js`, `xlsx.js` (cœur, sans DOM) ; `ui.js`, `app-mask.js`, `app-restore.js`, `main.js` (interface) ; `site/` (fichiers servis) ; `src/_headers.tpl` et `src/sw.js` (modèles).

## Déploiement (Netlify ou équivalent)

Dossier publié : `site/`. Commande de build : `node build.mjs`. Le fichier `site/_headers` est généré : il pose la CSP, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, etc. Vérifiez après déploiement avec les outils de développement du navigateur que l'onglet Réseau reste vide pendant un traitement.

## Licence

MIT, voir `LICENSE`. Fourni sans garantie.
