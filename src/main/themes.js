// Motywy użytkownika: pliki *.theme.json w folderze danych aplikacji
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const EXAMPLE = {
  name: 'Czerwony (przykład)',
  extends: 'classic',
  type: 'dark',
  colors: { accent: '#e2574c', accentStrong: '#b9372d', onAccent: '#ffffff', folder: '#d9a05b' },
  radius: 4,
};
const README = `Motywy CodeManager
==================

Każdy plik *.theme.json w tym folderze pojawi się w Ustawieniach → Wygląd.
Zmiany w plikach są wczytywane od razu po zapisaniu.

Przykład (red.theme.json):
{
  "name": "Czerwony",
  "extends": "classic",          // motyw bazowy: classic, graphite, light, midnight, forest, contrast
  "type": "dark",                // "dark" albo "light"
  "colors": {
    "bg0": "#1e1f22",            // pasek tytułu i menu boczne
    "bg1": "#26282b",            // tło treści
    "bg2": "#2d2f33",            // panele
    "bg3": "#35373c",            // najechanie kursorem
    "bg4": "#3e4046",            // zaznaczenie
    "line": "#3a3c41",           // obramowania
    "line2": "#4b4e55",          // mocniejsze obramowania
    "input": "#1f2023",          // pola tekstowe, konsola
    "text": "#dfe1e5", "text2": "#a7abb2", "text3": "#7c8189",
    "accent": "#e2574c",         // kolor wyróżnienia (ikony, zaznaczenia)
    "accentStrong": "#b9372d",   // przyciski główne, pasek stanu edytora
    "onAccent": "#ffffff",       // tekst na przyciskach głównych
    "warn": "#d6a443", "error": "#e0645a", "info": "#5ea7d8",
    "sidebar": "#1e1f22", "titlebar": "#1e1f22", "folder": "#c9a75d"
  },
  "fonts": { "ui": "Segoe UI", "mono": "Cascadia Mono" },
  "radius": 4,                   // zaokrąglenie rogów w pikselach (0–16)
  "editor": { "background": "#202225", "syntax": { "keyword": "#ff8a7a", "string": "#e6c07b" } }
}

Wystarczy podać tylko kolory, które chcesz zmienić – reszta pochodzi z motywu bazowego.
Komentarze (//) są dozwolone.
`;

class ThemeStore {
  constructor(userData, emit) {
    this.dir = path.join(userData, 'themes');
    this.emit = emit;
    fs.mkdirSync(this.dir, { recursive: true });
    if (!U.exists(path.join(this.dir, 'czerwony.theme.json'))) U.writeJSON(path.join(this.dir, 'czerwony.theme.json'), EXAMPLE);
    if (!U.exists(path.join(this.dir, 'README.txt'))) fs.writeFileSync(path.join(this.dir, 'README.txt'), README);
    try {
      let t;
      fs.watch(this.dir, () => { clearTimeout(t); t = setTimeout(() => this.emit('themes:changed', this.list()), 250); });
    } catch { /* obserwowanie folderu niedostępne */ }
  }
  list() {
    return U.listFiles(this.dir).filter(f => /\.theme\.json$/i.test(f)).map(f => {
      const file = path.basename(f);
      const raw = U.readText(f);
      let theme = null, error = null;
      try {
        theme = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/([^:"'])\/\/[^\n"]*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1'));
        if (!theme || typeof theme !== 'object' || Array.isArray(theme)) throw new Error('plik musi zawierać obiekt JSON');
        if (theme.colors && typeof theme.colors !== 'object') throw new Error('"colors" musi być obiektem');
      } catch (e) { error = 'Błąd w pliku: ' + e.message; theme = null; }
      return { id: 'file:' + file, file, path: f, theme, error };
    });
  }
  import(src) {
    const name = path.basename(src).replace(/(\.theme)?\.json$/i, '') + '.theme.json';
    fs.copyFileSync(src, path.join(this.dir, name));
    return 'file:' + name;
  }
  save(name, theme) {
    const safe = U.safeName(name).replace(/\s+/g, '-').toLowerCase() || 'motyw';
    let f = path.join(this.dir, `${safe}.theme.json`);
    for (let i = 2; U.exists(f); i++) f = path.join(this.dir, `${safe}-${i}.theme.json`);
    U.writeJSON(f, theme);
    return { id: 'file:' + path.basename(f), path: f };
  }
}

module.exports = { ThemeStore, EXAMPLE };
