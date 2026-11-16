// Motywy: wbudowane + pliki *.theme.json z folderu motywów
'use strict';
window.Themes = (function () {
  // Klucze kolorów w pliku motywu → zmienne CSS
  const KEYS = {
    bg0: '--bg0', bg1: '--bg1', bg2: '--bg2', bg3: '--bg3', bg4: '--bg4', line: '--line', line2: '--line2', input: '--input',
    text: '--text', text2: '--text2', text3: '--text3', accent: '--accent', accentStrong: '--accent-strong', onAccent: '--on-accent',
    warn: '--warn', error: '--error', info: '--info', sidebar: '--sidebar', titlebar: '--titlebar', folder: '--folder',
  };
  const BUILTIN = {
    classic: { name: 'Klasyczny', type: 'dark', colors: { bg0: '#1e1f22', bg1: '#26282b', bg2: '#2d2f33', bg3: '#35373c', bg4: '#3e4046', line: '#3a3c41', line2: '#4b4e55', input: '#1f2023', text: '#dfe1e5', text2: '#a7abb2', text3: '#7c8189', accent: '#4cb877', accentStrong: '#2f8f55', onAccent: '#ffffff', warn: '#d6a443', error: '#e0645a', info: '#5ea7d8', folder: '#c9a75d' } },
    graphite: { name: 'Grafit', type: 'dark', colors: { bg0: '#141414', bg1: '#1a1a1a', bg2: '#202020', bg3: '#2a2a2a', bg4: '#333333', line: '#2e2e2e', line2: '#404040', input: '#151515', text: '#e6e6e6', text2: '#a3a3a3', text3: '#737373', accent: '#55c37f', accentStrong: '#2e9157', onAccent: '#ffffff', warn: '#d9a94a', error: '#e5675d', info: '#61a8db', folder: '#c4a35a' } },
    light: { name: 'Jasny', type: 'light', colors: { bg0: '#e9eaec', bg1: '#f5f6f7', bg2: '#ffffff', bg3: '#eceef0', bg4: '#e0e3e7', line: '#d9dce0', line2: '#c3c7cd', input: '#ffffff', text: '#1f2328', text2: '#59606a', text3: '#868d97', accent: '#23874a', accentStrong: '#23874a', onAccent: '#ffffff', warn: '#a86d00', error: '#c4362c', info: '#2a6fb0', folder: '#b8892e' } },
    midnight: { name: 'Nocny', type: 'dark', colors: { bg0: '#171b22', bg1: '#1d222b', bg2: '#232a34', bg3: '#2b333f', bg4: '#343d4b', line: '#2f3743', line2: '#424c5b', input: '#181c23', text: '#dde3ec', text2: '#9ca7b6', text3: '#717d8d', accent: '#4fc285', accentStrong: '#2c905a', onAccent: '#ffffff', warn: '#d9a64a', error: '#e2675e', info: '#62a9e0', folder: '#c7a765' } },
    forest: { name: 'Leśny', type: 'dark', colors: { bg0: '#0e1712', bg1: '#132019', bg2: '#17271e', bg3: '#1e3227', bg4: '#264030', line: '#22382b', line2: '#2f4c3a', input: '#0f1a14', text: '#e2ece5', text2: '#99b2a3', text3: '#6c8a78', accent: '#4fd18b', accentStrong: '#2c9a5f', onAccent: '#ffffff', warn: '#e1b04f', error: '#e8695c', info: '#68b3d8', folder: '#c8aa62' } },
    contrast: { name: 'Wysoki kontrast', type: 'dark', colors: { bg0: '#000000', bg1: '#000000', bg2: '#0a0a0a', bg3: '#1a1a1a', bg4: '#262626', line: '#5c5c5c', line2: '#8a8a8a', input: '#000000', text: '#ffffff', text2: '#e0e0e0', text3: '#bdbdbd', accent: '#5cff9d', accentStrong: '#00a84f', onAccent: '#000000', warn: '#ffd24a', error: '#ff6b5e', info: '#6bc7ff', folder: '#ffd24a' } },
  };

  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i;
  const validColor = c => typeof c === 'string' && (HEX.test(c.trim()) || RGB.test(c.trim()));
  function rgb(c) {
    c = c.trim();
    if (c.startsWith('#')) { let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    return c.match(/\d+/g).slice(0, 3).map(Number);
  }
  const alpha = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r}, ${g}, ${b}, ${a})`; };
  const hex = c => { const [r, g, b] = rgb(c); return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''); };

  // Rozwiązuje motyw (dziedziczenie "extends") → komplet kolorów + ostrzeżenia
  function resolve(theme, customs = {}) {
    const warnings = [];
    let base = BUILTIN.classic;
    if (theme.extends) {
      const b = BUILTIN[theme.extends] || (customs[theme.extends] && customs[theme.extends].theme);
      if (b) base = b; else warnings.push(`Nieznany motyw bazowy "${theme.extends}" – użyto "classic".`);
    } else if (theme.type === 'light') base = BUILTIN.light;
    const colors = { ...(base.colors || {}) };
    for (const [k, v] of Object.entries(theme.colors || {})) {
      if (!KEYS[k]) { warnings.push(`Nieznany klucz koloru "${k}".`); continue; }
      if (!validColor(v)) { warnings.push(`Nieprawidłowy kolor ${k}: "${v}".`); continue; }
      colors[k] = v.trim();
    }
    return { name: theme.name || 'Bez nazwy', type: theme.type || base.type || 'dark', colors, fonts: theme.fonts || {}, radius: theme.radius, editor: theme.editor || {}, warnings };
  }

  function apply(resolved) {
    const s = document.documentElement.style;
    const c = resolved.colors;
    for (const [k, v] of Object.entries(KEYS)) { if (c[k]) s.setProperty(v, c[k]); else if (k === 'sidebar' || k === 'titlebar') s.setProperty(v, c.bg0); }
    s.setProperty('--accent-soft', alpha(c.accent, resolved.type === 'light' ? .12 : .16));
    s.setProperty('--warn-soft', alpha(c.warn, .15));
    s.setProperty('--error-soft', alpha(c.error, .15));
    s.setProperty('--info-soft', alpha(c.info, .14));
    s.setProperty('--shadow', resolved.type === 'light' ? 'rgba(20, 25, 30, .18)' : 'rgba(0, 0, 0, .45)');
    s.setProperty('--scrim', resolved.type === 'light' ? 'rgba(30, 35, 40, .35)' : 'rgba(0, 0, 0, .55)');
    if (resolved.fonts.ui) s.setProperty('--ui', `${resolved.fonts.ui}, 'Segoe UI', system-ui, sans-serif`); else s.removeProperty('--ui');
    if (resolved.fonts.mono) s.setProperty('--mono', `${resolved.fonts.mono}, 'Cascadia Mono', Consolas, monospace`); else s.removeProperty('--mono');
    if (typeof resolved.radius === 'number' && resolved.radius >= 0 && resolved.radius <= 16) { s.setProperty('--r', resolved.radius + 'px'); s.setProperty('--r-lg', Math.round(resolved.radius * 1.5) + 'px'); }
    else { s.removeProperty('--r'); s.removeProperty('--r-lg'); }
    document.documentElement.dataset.themeType = resolved.type;
    try { localStorage.setItem('cm-theme', JSON.stringify(resolved)); } catch { /* */ }
    current = resolved;
    if (window.monaco) applyMonaco(window.monaco);
  }

  // Motyw edytora Monaco wyliczany z kolorów aplikacji
  function applyMonaco(monaco) {
    const r = current || resolve(BUILTIN.classic);
    const c = r.colors; const light = r.type === 'light';
    const e = r.editor || {};
    const syn = light
      ? { comment: '6a737d', keyword: '1a7f45', string: '9a5b00', number: 'b5481b', type: '1f6fb2', fn: '6639ba', key: '0f6e6e' }
      : { comment: '6f7a72', keyword: '6fcf97', string: 'd7b46a', number: 'e59a73', type: '72b7e2', fn: 'b5d99c', key: '8fcfc4' };
    const strip = h => hex(h).slice(1);
    const syntax = { ...syn, ...Object.fromEntries(Object.entries(e.syntax || {}).filter(([, v]) => validColor(v)).map(([k, v]) => [k, strip(v)])) };
    monaco.editor.defineTheme('codemanager', {
      base: light ? 'vs' : 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: syntax.comment, fontStyle: 'italic' },
        { token: 'keyword', foreground: syntax.keyword }, { token: 'keyword.control', foreground: syntax.keyword },
        { token: 'string', foreground: syntax.string }, { token: 'string.key.json', foreground: syntax.key }, { token: 'string.value.json', foreground: syntax.string },
        { token: 'number', foreground: syntax.number }, { token: 'type', foreground: syntax.type }, { token: 'type.identifier', foreground: syntax.type },
        { token: 'function', foreground: syntax.fn }, { token: 'variable', foreground: strip(c.text) }, { token: 'constant', foreground: syntax.number },
        { token: 'tag', foreground: syntax.keyword }, { token: 'attribute.name', foreground: syntax.key }, { token: 'attribute.value', foreground: syntax.string },
        { token: 'key', foreground: syntax.key }, { token: 'operator', foreground: strip(c.text2) }, { token: 'delimiter', foreground: strip(c.text2) },
        { token: 'log.error', foreground: strip(c.error) }, { token: 'log.warn', foreground: strip(c.warn) }, { token: 'log.info', foreground: strip(c.info) }, { token: 'log.date', foreground: syntax.comment },
      ],
      colors: {
        'editor.background': hex(e.background && validColor(e.background) ? e.background : c.bg1), 'editor.foreground': hex(c.text),
        'editorLineNumber.foreground': hex(c.text3), 'editorLineNumber.activeForeground': hex(c.text2),
        'editor.lineHighlightBackground': hex(c.bg2), 'editor.selectionBackground': alpha(c.accent, .3), 'editor.inactiveSelectionBackground': alpha(c.accent, .15),
        'editorCursor.foreground': hex(c.accent), 'editorIndentGuide.background1': hex(c.line), 'editorIndentGuide.activeBackground1': hex(c.line2),
        'editorWidget.background': hex(c.bg2), 'editorWidget.border': hex(c.line2), 'editorSuggestWidget.background': hex(c.bg2), 'editorSuggestWidget.selectedBackground': hex(c.bg4),
        'editorHoverWidget.background': hex(c.bg2), 'minimap.background': hex(c.bg1), 'editorGutter.background': hex(e.background && validColor(e.background) ? e.background : c.bg1),
        'input.background': hex(c.input), 'focusBorder': hex(c.accent), 'editorBracketMatch.border': hex(c.accent),
      },
    });
    monaco.editor.setTheme('codemanager');
  }

  let current = null;
  // szybkie zastosowanie ostatniego motywu przed wczytaniem ustawień (bez mignięcia)
  try { const cached = JSON.parse(localStorage.getItem('cm-theme') || 'null'); if (cached && cached.colors) apply(cached); } catch { /* */ }

  return { BUILTIN, KEYS, resolve, apply, applyMonaco, validColor, current: () => current };
})();
