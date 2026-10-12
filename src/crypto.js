/*
 * Voile — fichier clé chiffré.
 * PBKDF2-SHA256 (600 000 itérations) -> AES-256-GCM, avec l'en-tête lié au chiffrement (AAD).
 * Tout passe par WebCrypto : aucune bibliothèque tierce.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  const FORMAT = 'voile-cle';
  const VERSION = 1;
  const ITERATIONS = 600000;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  const aad = (h) => enc.encode([h.format, h.v, h.kdf, h.hash, h.iter, h.salt, h.iv].join('|'));

  async function encryptVault(vault, passphrase) {
    if (!passphrase || passphrase.length < 8) throw new Error('Phrase de passe trop courte (8 caractères minimum, 16 recommandés).');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header = { format: FORMAT, v: VERSION, kdf: 'PBKDF2', hash: 'SHA-256', iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv) };
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const plain = enc.encode(JSON.stringify(vault.toJSON()));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header) }, key, plain));
    return JSON.stringify(Object.assign({}, header, { ct: toB64(ct) }));
  }

  async function decryptVault(fileText, passphrase) {
    let h;
    try {
      h = JSON.parse(fileText);
    } catch (e) {
      throw new Error('Ce fichier n’est pas une clé Voile.');
    }
    if (!h || h.format !== FORMAT || h.v !== VERSION || h.kdf !== 'PBKDF2' || h.hash !== 'SHA-256') throw new Error('Format de clé non reconnu.');
    // Garde-fou : on refuse les paramètres anormaux d'un fichier trafiqué (déni de service par itérations).
    if (!Number.isInteger(h.iter) || h.iter < 100000 || h.iter > 5000000) throw new Error('Paramètres de clé invalides.');
    const key = await deriveKey(passphrase, fromB64(h.salt), h.iter);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(h.iv), additionalData: aad(h) }, key, fromB64(h.ct));
    } catch (e) {
      throw new Error('Phrase de passe incorrecte, ou fichier clé altéré.');
    }
    return V.Vault.fromJSON(JSON.parse(dec.decode(plain)));
  }

  // Phrase de passe aléatoire : 5 groupes de 4 caractères d'un alphabet sans ambiguïté (~ 100 bits).
  function generatePassphrase() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symboles = 5 bits chacun
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    let s = '';
    for (let i = 0; i < 20; i++) {
      s += alphabet[bytes[i] & 31];
      if (i % 4 === 3 && i < 19) s += '-';
    }
    return s;
  }

  V.keyfile = { encryptVault, decryptVault, generatePassphrase, ITERATIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.keyfile;
})(typeof globalThis !== 'undefined' ? globalThis : this);
