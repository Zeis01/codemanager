// Edytor: debugowanie Pythona i Lua – punkty zatrzymania na marginesie, kroki, zmienne, stos, konsola
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast } = App;
  const P = () => window.cm.path;
  const ed = () => App.ed;
  const D = { bps: new Map(), decos: new Map(), session: null, frames: [], frameId: null, out: [], side: null, cur: null, curModel: null, expanded: new Set() };
  try { for (const [f, lines] of JSON.parse(localStorage.getItem('cm.dbg.bps') || '[]')) D.bps.set(f, new Set(lines)); } catch { /* */ }
  const saveBps = () => { try { localStorage.setItem('cm.dbg.bps', JSON.stringify([...D.bps].map(([f, s]) => [f, [...s]]))); } catch { /* */ } };
  const debuggable = p => /\.(py|lua)$/i.test(p || '');
  const tabOf = m => ed().S.tabs.find(t => t.model === m);

  // ---------- punkty zatrzymania ----------
  function syncDecos(t) {
    const mon = window.monaco; if (!mon || !t || t.untitled || !debuggable(t.path)) return;
    const lines = [...(D.bps.get(t.path) || [])];
    const old = D.decos.get(t.model) || [];
    D.decos.set(t.model, t.model.deltaDecorations(old, lines.map(l => ({ range: new mon.Range(l, 1, l, 1), options: { isWholeLine: false, glyphMarginClassName: 'dbg-bp', glyphMarginHoverMessage: { value: 'Punkt zatrzymania (kliknij, aby usunąć)' }, stickiness: 1 } }))));
  }
  function linesFromDecos(t) { const ids = D.decos.get(t.model) || []; return [...new Set(ids.map(id => t.model.getDecorationRange(id)).filter(Boolean).map(r => r.startLineNumber))]; }
  function toggleBp(t, line) {
    if (!t || t.untitled || !debuggable(t.path)) { toast('Punkty zatrzymania działają w plikach .py i .lua', 'warn'); return; }
    const set = D.bps.get(t.path) || new Set();
    if (set.has(line)) set.delete(line); else set.add(line);
    if (set.size) D.bps.set(t.path, set); else D.bps.delete(t.path);
    saveBps(); syncDecos(t); api('debug:breakpoints', t.path, [...set]); drawSide();
  }
  function setCurrent(file, line) {
    const mon = window.monaco; if (!mon) return;
    if (D.curModel && !D.curModel.isDisposed()) D.cur = D.curModel.deltaDecorations(D.cur || [], []);
    D.cur = null; D.curModel = null;
    if (!file) return;
    const t = ed().S.tabs.find(x => x.path === file); if (!t) return;
    D.curModel = t.model;
    D.cur = t.model.deltaDecorations([], [{ range: new mon.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'dbg-line', glyphMarginClassName: 'dbg-arrow' } }]);
  }

  // ---------- sterowanie ----------
  async function start(stopOnEntry) {
    const S = ed().S; const t = S.tabs.find(x => x.path === S.active);
    if (!t || t.untitled || !debuggable(t.path)) { toast('Otwórz plik .py albo .lua do debugowania', 'warn'); return; }
    if (t.model.getAlternativeVersionId() !== t.saved && !(await ed().save(t))) return;
    for (const tab of S.tabs) if (debuggable(tab.path) && D.bps.has(tab.path)) await api('debug:breakpoints', tab.path, linesFromDecos(tab));
    D.out = []; D.frames = []; D.program = t.path;
    S.side = 'debug'; S.sideOpen = true; ed().renderSide();
    try { D.session = await window.cm.call('debug:start', { program: t.path, cwd: S.root && t.path.startsWith(S.root) ? undefined : undefined, stopOnEntry: !!stopOnEntry }); }
    catch (e) {
      const msg = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (/NO_DEBUGPY/.test(msg)) { if (await App.confirmBox('Brakuje debugpy', 'Do debugowania Pythona potrzebny jest pakiet <b>debugpy</b>. Zainstalować go teraz (pip install --user debugpy)?', 'Zainstaluj')) { const ok = await App.runJob('Instalacja debugpy', jobId => window.cm.call('debug:installDebugpy', jobId), { doneMsg: 'Zainstalowano. Uruchom debugowanie ponownie (F5).' }); if (ok !== null) setTimeout(() => start(stopOnEntry), 300); } }
      else toast(msg, 'error', 9000);
      D.session = null; drawSide();
    }
  }
  const cmd = a => window.cm.call('debug:cmd', a).catch(e => toast(e.message, 'warn'));
  const stop = () => api('debug:stop');

  window.cm.on('debug:event', async e => {
    if (e.type === 'started') { D.session = { running: true, lang: e.lang, state: 'running' }; D.out.push({ c: 'console', t: `▶ Debugowanie: ${P().basename(e.program)}\n` }); }
    if (e.type === 'output') { D.out.push({ c: e.category, t: e.output }); if (D.out.length > 2000) D.out.splice(0, 500); drawConsole(); return; }
    if (e.type === 'continued') { if (D.session) D.session.state = 'running'; setCurrent(null); }
    if (e.type === 'stopped') {
      if (D.session) D.session.state = 'stopped';
      D.frames = e.frames || []; D.frameId = D.frames[0] && D.frames[0].id; D.reason = e.reason; D.expanded.clear();
      const f = D.frames.find(x => x.file) ;
      if (f) { await ed().openFile(f.file, f.line); setCurrent(f.file, f.line); }
      const S = ed().S; if (S.side !== 'debug' || !S.sideOpen) { S.side = 'debug'; S.sideOpen = true; ed().renderSide(); }
    }
    if (e.type === 'terminated') { D.session = null; D.frames = []; setCurrent(null); D.out.push({ c: 'console', t: '■ Koniec debugowania\n' }); }
    drawSide();
  });

  // ---------- panel boczny ----------
  function drawSide() { if (D.side && D.side.isConnected) side(D.side); }
  async function side(box) {
    D.side = box;
    const s = D.session; const stopped = s && s.state === 'stopped';
    const S = ed().S; const t = S.tabs.find(x => x.path === S.active);
    box.innerHTML = `<div class="side-head"><span>Debugowanie</span></div>
      <div class="dbg-side">
        ${s ? `<div class="dbg-bar">
            <button class="btn sm ghost icon" data-c="continue" title="Kontynuuj (F5)" ${stopped ? '' : 'disabled'}>${icon('play')}</button>
            <button class="btn sm ghost icon" data-c="pause" title="Wstrzymaj" ${stopped ? 'disabled' : ''}>${icon('pause')}</button>
            <button class="btn sm ghost icon" data-c="next" title="Przejdź dalej (F10)" ${stopped ? '' : 'disabled'}>${icon('stepover')}</button>
            <button class="btn sm ghost icon" data-c="stepIn" title="Wejdź do funkcji (F11)" ${stopped ? '' : 'disabled'}>${icon('stepin')}</button>
            <button class="btn sm ghost icon" data-c="stepOut" title="Wyjdź z funkcji (Shift+F11)" ${stopped ? '' : 'disabled'}>${icon('stepout')}</button>
            <button class="btn sm ghost icon danger" data-c="stop" title="Zatrzymaj (Shift+F5)">${icon('stop')}</button>
            <span class="dim dbg-state">${stopped ? ({ breakpoint: 'punkt zatrzymania', step: 'krok', pause: 'wstrzymano', exception: 'wyjątek', entry: 'start' }[D.reason] || D.reason || 'zatrzymano') : 'działa…'}</span></div>`
        : `<div class="dbg-start"><button class="btn primary" data-start ${t && debuggable(t.path) ? '' : 'disabled'}>${icon('play')}Debuguj ${t && debuggable(t.path) ? esc(t.name) : 'plik'}</button><label class="check"><input type="checkbox" data-entry><span>Zatrzymaj na pierwszym wierszu</span></label>
            <p class="dim">Kliknij na lewym marginesie obok numeru wiersza (albo F9), aby dodać punkt zatrzymania. Python wymaga pakietu debugpy, Lua działa od razu (Lua 5.3, bez API gier – debuguj logikę, którą da się uruchomić poza grą).</p></div>`}
        ${stopped ? `<div class="dbg-sec"><div class="dbg-h">Zmienne</div><div class="dbg-vars" data-vars><div class="dim" style="padding:4px 10px">…</div></div></div>
          <div class="dbg-sec"><div class="dbg-h">Stos wywołań</div><div class="dbg-stack">${D.frames.map(f => `<button class="${f.id === D.frameId ? 'on' : ''}" data-f="${f.id}"><span>${esc(f.name)}</span><span class="dim">${f.file ? esc(P().basename(f.file)) + ':' + f.line : ''}</span></button>`).join('')}</div></div>` : ''}
        <div class="dbg-sec"><div class="dbg-h">Punkty zatrzymania <span class="dim">${[...D.bps.values()].reduce((a, x) => a + x.size, 0)}</span>${D.bps.size ? '<button class="btn ghost sm" data-clear>Usuń wszystkie</button>' : ''}</div><div class="dbg-bps">${[...D.bps].flatMap(([f, set]) => [...set].sort((a, b) => a - b).map(l => `<button data-bp="${esc(f)}|${l}"><i class="dot"></i><span>${esc(P().basename(f))}</span><span class="dim">:${l}</span></button>`)).join('') || '<div class="dim" style="padding:4px 10px">Brak.</div>'}</div></div>
        <div class="dbg-sec grow"><div class="dbg-h">Konsola</div><div class="dbg-console"></div>${s ? `<input class="input mono dbg-eval" placeholder="${stopped ? 'Wyrażenie do obliczenia (Enter)' : 'Zatrzymaj program, aby obliczać wyrażenia'}" ${stopped ? '' : 'disabled'}>` : ''}</div>
      </div>`;
    drawConsole();
    const st = $('[data-start]', box); if (st) st.onclick = () => start($('[data-entry]', box).checked);
    $$('[data-c]', box).forEach(b => b.onclick = () => (b.dataset.c === 'stop' ? stop() : cmd(b.dataset.c)));
    $$('[data-f]', box).forEach(b => b.onclick = async () => { D.frameId = +b.dataset.f; const f = D.frames.find(x => x.id === D.frameId); if (f && f.file) { await ed().openFile(f.file, f.line); } D.expanded.clear(); side(box); });
    $$('[data-bp]', box).forEach(b => b.onclick = () => { const [f, l] = b.dataset.bp.split(/\|(?=\d+$)/); ed().openFile(f, +l); });
    const cl = $('[data-clear]', box); if (cl) cl.onclick = () => { for (const f of D.bps.keys()) api('debug:breakpoints', f, []); D.bps.clear(); saveBps(); for (const tab of ed().S.tabs) syncDecos(tab); side(box); };
    const ev = $('.dbg-eval', box);
    if (ev) ev.onkeydown = async e => { if (e.key !== 'Enter' || !ev.value.trim()) return; const x = ev.value.trim(); ev.value = ''; D.out.push({ c: 'input', t: '› ' + x + '\n' }); try { const r = await window.cm.call('debug:evaluate', x, D.frameId); D.out.push({ c: 'result', t: r.result + '\n' }); } catch (er) { D.out.push({ c: 'stderr', t: er.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') + '\n' }); } drawConsole(); };
    if (stopped) drawVars($('[data-vars]', box));
  }
  async function drawVars(box) {
    const scopes = await App.apiQuiet('debug:scopes', D.frameId).catch(() => []);
    box.innerHTML = '';
    for (const sc of scopes) box.appendChild(await varNode({ name: sc.name, value: '', ref: sc.ref, scope: true }, 0, !sc.expensive));
  }
  async function varNode(v, depth, open) {
    const key = depth + ':' + v.name + ':' + v.ref;
    const isOpen = open || D.expanded.has(key);
    const el = h(`<div class="dbg-var"><div class="row1" style="padding-left:${8 + depth * 12}px">${v.ref ? `<span class="tw">${isOpen ? '▾' : '▸'}</span>` : '<span class="tw"></span>'}<span class="${v.scope ? 'sc' : 'nm'}">${esc(v.name)}</span>${v.scope ? '' : `<span class="val t-${esc(v.type)}" title="${esc(v.value)}">${esc(v.value)}</span>`}</div><div class="kids"></div></div>`);
    const kids = $('.kids', el);
    const load = async () => { kids.innerHTML = ''; const list = await App.apiQuiet('debug:variables', v.ref).catch(() => []); for (const c of list.filter(x => !/^(__\w+__|special variables|function variables)$/.test(x.name) || depth > 0).slice(0, 300)) kids.appendChild(await varNode(c, depth + 1, false)); };
    if (v.ref) {
      $('.row1', el).onclick = async () => { if (D.expanded.has(key)) { D.expanded.delete(key); kids.innerHTML = ''; $('.tw', el).textContent = '▸'; } else { D.expanded.add(key); $('.tw', el).textContent = '▾'; await load(); } };
      if (isOpen) await load();
    }
    return el;
  }
  function drawConsole() {
    const c = D.side && $('.dbg-console', D.side); if (!c) return;
    c.innerHTML = D.out.slice(-600).map(o => `<span class="o-${esc(o.c)}">${esc(o.t)}</span>`).join('');
    c.scrollTop = c.scrollHeight;
  }

  // ---------- podpięcie do edytora ----------
  const ext = App.edExt; ext.sides.debug = side;
  const prevReady = ext.editorReady, prevOpened = ext.opened, prevChanged = ext.changed;
  ext.editorReady = (m, editor) => {
    prevReady(m, editor);
    editor.updateOptions({ glyphMargin: true });
    editor.onMouseDown(e => { if (e.target.type === m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || (e.target.type === m.editor.MouseTargetType.GUTTER_LINE_NUMBERS && e.event.altKey)) { const t = tabOf(editor.getModel()); if (t && e.target.position) toggleBp(t, e.target.position.lineNumber); } });
    editor.addCommand(m.KeyCode.F9, () => { const t = tabOf(editor.getModel()); const p = editor.getPosition(); if (t && p) toggleBp(t, p.lineNumber); });
    editor.addCommand(m.KeyCode.F5, () => (D.session ? cmd('continue') : start(false)));
    editor.addCommand(m.KeyMod.Shift | m.KeyCode.F5, () => D.session && stop());
    editor.addCommand(m.KeyCode.F10, () => D.session && cmd('next'));
    editor.addCommand(m.KeyCode.F11, () => D.session && cmd('stepIn'));
    editor.addCommand(m.KeyMod.Shift | m.KeyCode.F11, () => D.session && cmd('stepOut'));
  };
  ext.opened = t => { prevOpened(t); setTimeout(() => syncDecos(t), 0); };
  ext.changed = t => {
    prevChanged(t);
    if (!debuggable(t.path) || !D.bps.has(t.path)) return;
    clearTimeout(t._bpT); t._bpT = setTimeout(() => { const lines = linesFromDecos(t); D.bps.set(t.path, new Set(lines)); saveBps(); if (D.session) api('debug:breakpoints', t.path, lines); }, 400);
  };
  document.addEventListener('keydown', e => {
    if (App.current() !== 'editor' || !D.session || document.querySelector('.modal-back')) return;
    if (e.target.closest && e.target.closest('.monaco-editor')) return; // Monaco ma własne skróty
    if (e.key === 'F5' && !e.shiftKey) { e.preventDefault(); cmd('continue'); } else if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); stop(); }
    else if (e.key === 'F10') { e.preventDefault(); cmd('next'); } else if (e.key === 'F11') { e.preventDefault(); cmd(e.shiftKey ? 'stepOut' : 'stepIn'); }
  });
})();
