// Język interfejsu: polski (domyślnie) lub angielski. Teksty interfejsu są tłumaczone w locie
// na podstawie słownika i18n-en.js (dokładne teksty + wzorce z liczbami i nazwami).
'use strict';
window.I18n = (function () {
  let lang = 'pl';
  try { lang = localStorage.getItem('cm-lang') || 'pl'; } catch { /* */ }
  let exact = null; let pats = [];
  const SKIP = '.console, .joblog, .files, .monaco-editor, .path, .mono, .evidence, .ed-crumbs, .ed-tabs, .tree, .struct, textarea, code, pre, [data-no-i18n]';
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  // odmiana: polskie formy → angielskie (liczba pojedyncza / mnoga)
  const PLURALS = { 'błąd': ['error', 'errors'], 'ostrzeżenie': ['warning', 'warnings'], 'aktualizacja': ['update', 'updates'], 'aktualizację': ['update', 'updates'], 'wspólny plik': ['shared file', 'shared files'], 'plik': ['file', 'files'], 'gracz': ['player', 'players'], 'runda': ['round', 'rounds'], 'zmiana': ['change', 'changes'], 'ustawienie': ['setting', 'settings'], 'instancja': ['instance', 'instances'] };

  function load() {
    if (exact || !window.I18N_EN) return;
    exact = new Map(Object.entries(window.I18N_EN.exact));
    pats = window.I18N_EN.patterns.slice().sort((a, b) => b[0].length - a[0].length).map(([pl, en]) => {
      const re = new RegExp('^' + pl.split('{}').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$', 's');
      return { re, en };
    });
  }
  function tr(text) {
    const t = text.trim(); if (!t || t.length > 600) return null;
    const e = exact.get(t); if (e !== undefined) return e;
    for (const p of pats) {
      const m = t.match(p.re); if (!m) continue;
      let i = 1; return p.en.replace(/\{\}/g, () => { const g = m[i++] || ''; const x = exact.get(g.trim()); return x !== undefined ? x : g; });
    }
    return null;
  }
  function textNode(n) {
    const v = n.nodeValue; if (!v || !/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(v)) return;
    const p = n.parentElement; if (!p || p.closest(SKIP)) return;
    const r = tr(v); if (r == null || r === v.trim()) return;
    const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
    n.nodeValue = lead + r + trail;
  }
  function attrs(el) {
    if (el.closest && el.closest('.monaco-editor')) return;
    for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const r = tr(v); if (r != null && r !== v) el.setAttribute(a, r); } }
  }
  function walk(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('.monaco-editor, .console')) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => (n.nodeType === 1 && n.matches('.monaco-editor, .console, .joblog, textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else attrs(n); }
  }
  let busy = false;
  function start() {
    load(); if (!exact) return;
    document.documentElement.lang = 'en';
    document.title = 'CodeManager';
    walk(document.body);
    new MutationObserver(list => {
      if (busy) return; busy = true;
      try {
        for (const m of list) {
          if (m.type === 'childList') m.addedNodes.forEach(walk);
          else if (m.type === 'characterData') textNode(m.target);
          else if (m.type === 'attributes') attrs(m.target);
        }
      } finally { busy = false; }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // liczebniki i czas względny
    const plural = App.plural;
    App.plural = (n, one, few, many) => { const p = PLURALS[one]; return p ? `${n} ${n === 1 ? p[0] : p[1]}` : plural(n, one, few, many); };
    App.timeAgo = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' hrs ago'; return new Date(t).toLocaleDateString('en-GB'); };
  }
  let started = false;
  function init(l) { lang = l || lang; try { localStorage.setItem('cm-lang', lang); } catch { /* */ } if (lang === 'en' && !started) { started = true; start(); } }
  function set(l) { try { localStorage.setItem('cm-lang', l); } catch { /* */ } location.reload(); }
  return { init, set, tr: s => { load(); return exact ? tr(s) || s : s; }, get lang() { return lang; } };
})();
App.setLanguage = l => I18n.set(l);
