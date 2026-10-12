/*
 * Voile — repérage automatique des colonnes à pseudonymiser.
 * Double détection : par nom de colonne ET par contenu.
 * Le résultat n'est qu'une proposition : l'utilisateur valide toujours.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  // level : direct (identifie une personne), quasi (réidentifie par croisement), libre (texte libre à balayer)
  // Ordre = priorité : les règles spécifiques passent avant les génériques (« nom société » avant « nom »).
  const RULES = [
    { label: 'IBAN', level: 'direct', words: ['iban', 'rib', 'bic', 'swift'] },
    { label: 'NIR', level: 'direct', words: ['nir', 'secu', 'securite sociale', 'ssn', 'numero secu'] },
    { label: 'SIRET', level: 'direct', words: ['siret', 'siren', 'tva intracommunautaire', 'numero tva'] },
    { label: 'EMAIL', level: 'direct', words: ['email', 'e mail', 'mail', 'courriel', 'adresse mail', 'adresse email'] },
    { label: 'TEL', level: 'direct', words: ['tel', 'telephone', 'tél', 'mobile', 'portable', 'phone', 'fax', 'gsm'] },
    { label: 'SOCIETE', level: 'direct', words: ['societe', 'entreprise', 'company', 'raison sociale', 'organisation', 'organisme', 'fournisseur', 'enseigne', 'etablissement', 'employeur'] },
    { label: 'PRENOM', level: 'direct', words: ['prenom', 'prenoms', 'firstname', 'first name', 'given name', 'forename'] },
    { label: 'NOM', level: 'direct', words: ['nom', 'noms', 'nom de famille', 'nom usuel', 'nom naissance', 'lastname', 'last name', 'surname', 'family name', 'name'] },
    {
      label: 'PERSONNE',
      level: 'direct',
      words: ['nom complet', 'nom prenom', 'prenom nom', 'fullname', 'full name', 'client', 'contact', 'interlocuteur', 'salarie', 'employe', 'patient', 'beneficiaire', 'personne', 'auteur', 'responsable', 'commercial', 'vendeur', 'manager', 'destinataire', 'expediteur', 'titulaire', 'candidat', 'etudiant', 'eleve', 'stagiaire', 'collaborateur', 'utilisateur', 'user', 'customer', 'employee', 'owner', 'proprietaire', 'locataire', 'assure', 'adherent', 'membre', 'signataire', 'representant', 'gerant', 'dirigeant', 'conseiller', 'referent'],
    },
    { label: 'ADRESSE', level: 'direct', words: ['adresse', 'address', 'rue', 'voie', 'domicile', 'adresse postale', 'adresse complete', 'street', 'lieu dit'] },
    { label: 'IP', level: 'direct', words: ['ip', 'adresse ip', 'ip address'] },
    { label: 'ID', level: 'direct', words: ['id', 'identifiant', 'matricule', 'numero client', 'num client', 'code client', 'ref client', 'reference client', 'numero dossier', 'num dossier', 'numero contrat', 'num contrat', 'numero adherent', 'login', 'username', 'pseudo', 'uuid', 'numero salarie', 'numero patient', 'reference', 'ref', 'numero', 'num'] },
    { label: 'NAISSANCE', level: 'quasi', words: ['date naissance', 'date de naissance', 'naissance', 'birth', 'birthdate', 'dob', 'ne le', 'age'] },
    { label: 'CP', level: 'quasi', words: ['code postal', 'cp', 'zip', 'postal', 'zipcode', 'postcode'] },
    { label: 'VILLE', level: 'quasi', words: ['ville', 'city', 'commune', 'localite'] },
    { label: 'SALAIRE', level: 'quasi', words: ['salaire', 'remuneration', 'salary', 'revenu', 'revenus', 'brut annuel', 'net mensuel', 'paie', 'traitement'] },
    { label: 'TEXTE', level: 'libre', words: ['commentaire', 'commentaires', 'comment', 'comments', 'notes', 'note', 'remarque', 'remarques', 'observation', 'observations', 'description', 'message', 'objet', 'libelle', 'detail', 'details', 'memo', 'texte', 'text', 'motif', 'resume', 'contenu', 'body', 'verbatim', 'reponse', 'avis', 'historique', 'echange', 'compte rendu', 'cr'] },
  ];

  const EXPLAIN = {
    NIR: 'numéro de sécurité sociale',
    IBAN: 'coordonnées bancaires',
    SIRET: 'numéro d’entreprise (SIREN/SIRET)',
    EMAIL: 'adresse e-mail',
    TEL: 'numéro de téléphone',
    SOCIETE: 'nom d’organisation',
    PRENOM: 'prénom',
    NOM: 'nom de famille',
    PERSONNE: 'nom de personne',
    ADRESSE: 'adresse postale',
    IP: 'adresse IP',
    ID: 'identifiant',
    NAISSANCE: 'date de naissance / âge (quasi-identifiant)',
    CP: 'code postal (quasi-identifiant)',
    VILLE: 'ville (quasi-identifiant)',
    SALAIRE: 'donnée de rémunération (sensible)',
    TEXTE: 'texte libre (peut contenir des noms, e-mails, téléphones…)',
    URL: 'adresse web',
    CB: 'carte bancaire',
  };

  // "Date de Naissance", "dateNaissance", "NOM_client" -> "date de naissance", "date naissance", "nom client"
  function normalizeName(s) {
    return String(s)
      .replace(/([a-zà-ÿ\d])([A-ZÀ-Ý])/g, '$1 $2')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function matchByName(name) {
    const norm = normalizeName(name);
    if (!norm) return null;
    const tokens = norm.split(' ');
    const padded = ' ' + norm + ' ';
    // Passe 1 : expressions de plusieurs mots (« numéro client » doit l'emporter sur « client »).
    // Passe 2 : mots isolés, dans l'ordre de priorité des règles.
    // Jamais de sous-chaîne : « id » ne doit pas matcher « vidéo ».
    for (const multi of [true, false]) {
      for (const rule of RULES) {
        for (const w of rule.words) {
          const nw = normalizeName(w);
          if (!nw || nw.includes(' ') !== multi) continue;
          if (multi ? padded.includes(' ' + nw + ' ') : tokens.includes(nw)) {
            return { label: rule.label, level: rule.level, word: w };
          }
        }
      }
    }
    return null;
  }

  const NAME_LIKE = /^\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){1,3}$/u;

  function sample(values, max) {
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== '');
    if (nonEmpty.length <= max) return nonEmpty;
    const step = nonEmpty.length / max;
    const out = [];
    for (let i = 0; i < max; i++) out.push(nonEmpty[Math.floor(i * step)]);
    return out;
  }

  function matchByContent(values) {
    const s = sample(values, 300);
    if (s.length < 3) return null;
    const P = V.patterns;
    const counts = {};
    let anywhere = 0;
    let totalLen = 0;
    let nameLike = 0;
    const seen = new Set();
    for (const raw of s) {
      const v = String(raw);
      totalLen += v.length;
      seen.add(v);
      const whole = P.wholeMatch(v);
      if (whole) counts[whole] = (counts[whole] || 0) + 1;
      if (P.findAll(v).length) anywhere++;
      if (NAME_LIKE.test(v.trim())) nameLike++;
    }
    const n = s.length;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] / n >= 0.6) return { label: best[0], level: 'direct', strength: 'forte', ratio: best[1] / n };
    const avg = totalLen / n;
    if (anywhere / n >= 0.05 && avg > 25) return { label: 'TEXTE', level: 'libre', strength: 'forte', ratio: anywhere / n, foundInside: true };
    if (avg > 80) return { label: 'TEXTE', level: 'libre', strength: 'moyenne', ratio: 1 };
    if (nameLike / n >= 0.7 && seen.size / n > 0.3) return { label: 'PERSONNE', level: 'direct', strength: 'faible', ratio: nameLike / n };
    return null;
  }

  /**
   * table : { header: string[], rows: string[][] }
   * Renvoie un descripteur par colonne.
   * mode : 'token' (remplacer chaque valeur par un jeton), 'scan' (texte libre : balayer), 'keep'
   */
  function detectColumns(table) {
    return table.header.map((name, index) => {
      const col = table.rows.map((r) => r[index]);
      const byName = matchByName(name);
      const byContent = matchByContent(col);
      const reasons = [];
      let label = null;
      let level = 'none';
      let confidence = 'aucune';

      if (byName && byContent) {
        if (byName.label === byContent.label || (byContent.label === 'TEXTE' && byName.level === 'libre')) {
          label = byName.label;
          level = byName.level;
          confidence = 'haute';
          reasons.push('le nom de colonne et le contenu concordent');
        } else if (byContent.strength === 'forte') {
          label = byContent.label;
          level = byContent.level;
          confidence = 'haute';
          reasons.push('le contenu ressemble à ' + EXPLAIN[byContent.label]);
        } else {
          label = byName.label;
          level = byName.level;
          confidence = 'moyenne';
          reasons.push('nom de colonne « ' + byName.word + ' »');
        }
      } else if (byName) {
        label = byName.label;
        level = byName.level;
        confidence = 'moyenne';
        reasons.push('nom de colonne « ' + byName.word + ' »');
      } else if (byContent) {
        label = byContent.label;
        level = byContent.level;
        confidence = byContent.strength === 'forte' ? 'haute' : byContent.strength === 'moyenne' ? 'moyenne' : 'faible';
        reasons.push(
          byContent.foundInside
            ? 'le texte contient des données personnelles (e-mails, téléphones…)'
            : byContent.label === 'TEXTE'
            ? 'cellules longues, probablement du texte libre'
            : byContent.label === 'PERSONNE'
            ? 'les valeurs ressemblent à des noms de personnes'
            : 'les valeurs ressemblent à ' + EXPLAIN[byContent.label]
        );
      }

      // Une colonne d'identifiants numériques 1..n sans lien avec une personne reste à la main de l'utilisateur,
      // mais on la propose (un identifiant client est une donnée personnelle indirecte).
      let mode = 'keep';
      if (level === 'direct') mode = 'token';
      else if (level === 'libre') mode = 'scan';
      const checked = (level === 'direct' || level === 'libre') && confidence !== 'faible';
      if (level === 'quasi') reasons.push('à anonymiser seulement si le croisement avec d’autres colonnes peut identifier quelqu’un');
      if (!checked && level === 'none') mode = 'keep';

      return {
        index,
        name,
        label: label || '',
        level,
        confidence,
        reasons,
        explain: label ? EXPLAIN[label] : '',
        mode: checked ? mode : 'keep',
        suggestedMode: mode,
        checked,
      };
    });
  }

  V.detect = { RULES, EXPLAIN, normalizeName, matchByName, matchByContent, detectColumns };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.detect;
})(typeof globalThis !== 'undefined' ? globalThis : this);
