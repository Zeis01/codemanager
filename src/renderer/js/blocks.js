// Edytor bloczkowy (Blueprint / Scratch): łączenie bloczków, sprawdzanie połączeń na żywo, konwersja na kod
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast, modal } = App;
  const B = () => window.BlocksCore;
  const TARGETS = [['lua', 'Lua'], ['python', 'Python'], ['js', 'JavaScript (Node.js)']];
  const PROFILES = [['lua', 'Czysta Lua'], ['fivem', 'FiveM (GTA V)'], ['redm', 'RedM (RDR2)'], ['gmod', "Garry's Mod"], ['beammp', 'BeamMP']];
  const EXT = { lua: 'lua', python: 'py', js: 'js' };
  const S = { g: null, view: { x: 60, y: 40, z: 1 }, sel: new Set(), selLink: null, undo: [], redo: [], file: null, dirty: false, issues: [], tab: 'code', el: null, clip: null };

  function draftLoad() { try { const d = JSON.parse(localStorage.getItem('cm.blocks.draft') || 'null'); if (d && d.g && Array.isArray(d.g.nodes)) { S.g = d.g; S.file = d.file || null; S.view = d.view || S.view; } } catch { /* brak */ } }
  function draftSave() { try { localStorage.setItem('cm.blocks.draft', JSON.stringify({ g: S.g, file: S.file, view: S.view })); } catch { /* */ } }
  function snapshot() { S.undo.push(JSON.stringify(S.g)); if (S.undo.length > 120) S.undo.shift(); S.redo = []; S.dirty = true; }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.g)); S.g = JSON.parse(S.undo.pop()); S.sel.clear(); S.selLink = null; full(); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.g)); S.g = JSON.parse(S.redo.pop()); S.sel.clear(); full(); }
  const def = n => B().BY[n.type];
  const nodeById = id => S.g.nodes.find(n => n.id === id);

  // ---------- układ widoku ----------
  function render(el) {
    if (!S.g) { draftLoad(); if (!S.g) S.g = B().EXAMPLES['fivem-hello'].make(); }
    el.innerHTML = `<div class="bp">
      <div class="bp-bar">
        <input class="input bp-title" data-name placeholder="Nazwa schematu" value="${esc(S.g.name || '')}">
        <label class="bp-sel" title="Język kodu"><select class="input" data-target>${TARGETS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
        <label class="bp-sel" data-profw title="Gra i jej API"><select class="input" data-profile>${PROFILES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
        <label class="bp-sel" data-realmw title="Strona skryptu FiveM/RedM"><select class="input" data-realm><option value="server">strona serwera</option><option value="client">strona klienta</option></select></label>
        <span class="grow"></span>
        <button class="btn sm ghost icon" data-undo title="Cofnij (Ctrl+Z)">↶</button><button class="btn sm ghost icon" data-redo title="Ponów (Ctrl+Y)">↷</button>
        <button class="btn sm" data-ex>${icon('template')}Przykłady</button><button class="btn sm ghost icon" data-new title="Nowy schemat">${icon('newfile')}</button><button class="btn sm ghost icon" data-open title="Otwórz schemat (.cmblocks)">${icon('folderOpen')}</button><button class="btn sm ghost icon" data-save title="Zapisz schemat (Ctrl+S)">${icon('save')}</button>
        <button class="btn sm primary" data-export>${icon('code')}Zapisz jako kod</button>
      </div>
      <div class="bp-body">
        <aside class="bp-pal"><div class="searchbox">${icon('search')}<input class="input" placeholder="Szukaj bloczka" data-q></div><div class="bp-cats"></div><p class="dim bp-tip">Przeciągnij bloczek na planszę albo kliknij prawym przyciskiem na planszy.</p></aside>
        <div class="bp-canvas" tabindex="0"><div class="bp-world"><svg class="bp-wires"><g data-links></g><path class="bp-temp" d=""/></svg><div class="bp-nodes"></div></div>
          <div class="bp-hint hidden"></div>
          <div class="bp-status"><span data-st></span><span class="grow"></span><button class="btn sm ghost" data-fit title="Pokaż wszystko (F)">Dopasuj</button><span data-zoom class="dim"></span></div>
          <div class="bp-empty hidden"><b>Pusta plansza</b><span>Zacznij od zdarzenia (np. „Na starcie”) i podłącz akcje białymi strzałkami.</span></div></div>
        <aside class="bp-right"><div class="tabs"><button data-t="code">Kod</button><button data-t="problems">Problemy <span data-pc></span></button><button data-t="vars">Zmienne</button><button data-t="help">Pomoc</button></div><div class="bp-rb"></div></aside>
      </div></div>`;
    S.el = el;
    $('[data-name]', el).oninput = e => { S.g.name = e.target.value; S.dirty = true; update(); };
    const tg = $('[data-target]', el), pf = $('[data-profile]', el), rl = $('[data-realm]', el);
    tg.onchange = () => { snapshot(); S.g.target = tg.value; if (tg.value !== 'lua') S.g.profile = tg.value; else if (!PROFILES.some(p => p[0] === S.g.profile)) S.g.profile = 'lua'; full(); };
    pf.onchange = () => { snapshot(); S.g.profile = pf.value; full(); };
    rl.onchange = () => { snapshot(); S.g.realm = rl.value; full(); };
    $('[data-undo]', el).onclick = undo; $('[data-redo]', el).onclick = redo;
    $('[data-ex]', el).onclick = examples; $('[data-new]', el).onclick = newGraph; $('[data-open]', el).onclick = openFile; $('[data-save]', el).onclick = () => saveFile(); $('[data-export]', el).onclick = exportCode;
    $('[data-fit]', el).onclick = fit;
    $$('.bp-right [data-t]', el).forEach(b => b.onclick = () => { S.tab = b.dataset.t; drawRight(); });
    $('[data-q]', el).oninput = drawPalette;
    canvasEvents($('.bp-canvas', el));
    full();
    App.leaveGuard = () => { draftSave(); return true; };
  }
  function full() { if (!S.el) return; syncBar(); drawPalette(); drawNodes(); update(); }
  function syncBar() {
    const el = S.el; $('[data-target]', el).value = S.g.target || 'lua';
    $('[data-profile]', el).value = S.g.profile || 'lua';
    $('[data-profw]', el).classList.toggle('hidden', (S.g.target || 'lua') !== 'lua');
    $('[data-realm]', el).value = S.g.realm || 'server';
    $('[data-realmw]', el).classList.toggle('hidden', !['fivem', 'redm'].includes(S.g.profile) || S.g.target !== 'lua');
    $('[data-name]', el).value = S.g.name || '';
  }
  App.setCrumb && setTimeout(() => {}, 0);

  // ---------- paleta ----------
  function drawPalette() {
    const box = $('.bp-cats', S.el); const q = ($('[data-q]', S.el).value || '').toLowerCase();
    const lib = B().library(S.g.target || 'lua', S.g.profile || 'lua').filter(d => !q || (d.title + ' ' + d.cat + ' ' + (d.help || '')).toLowerCase().includes(q));
    const cats = []; for (const d of lib) { let c = cats.find(x => x.name === d.cat); if (!c) cats.push(c = { name: d.cat, items: [] }); c.items.push(d); }
    box.innerHTML = cats.map(c => `<details ${q || ['Zdarzenia', 'FiveM', "Garry's Mod", 'BeamMP', 'Akcje', 'Przepływ'].includes(c.name) ? 'open' : ''}><summary>${esc(c.name)} <span class="dim">${c.items.length}</span></summary>${c.items.map(d => `<div class="bp-pi" draggable="true" data-type="${esc(d.type)}" title="${esc(d.help || d.title)}"><i style="background:${d.color}"></i><span>${esc(d.title)}</span><small>${{ event: 'zdarzenie', action: 'akcja', flow: 'przepływ', pure: 'wartość', note: '' }[d.kind] || ''}</small></div>`).join('')}</details>`).join('') || '<p class="dim" style="padding:8px">Brak pasujących bloczków.</p>';
    $$('.bp-pi', box).forEach(p => {
      p.ondragstart = e => { e.dataTransfer.setData('application/x-cm-block', p.dataset.type); e.dataTransfer.effectAllowed = 'copy'; };
      p.onclick = () => { const c = $('.bp-canvas', S.el).getBoundingClientRect(); const w = toWorld(c.left + c.width / 2 - 90, c.top + c.height / 2 - 40); addBlock(p.dataset.type, w.x, w.y); };
    });
  }
  function addBlock(type, x, y, connectFrom) {
    snapshot();
    const n = B().addNode(S.g, type, x, y);
    if (connectFrom) { const d = def(n); const r = connectFrom.dir === 'out' ? (d.inputs.find(p => B().compatible(connectFrom.type, p.type) && !p.literalOnly)) : d.outputs.find(p => B().compatible(p.type, connectFrom.type)); if (r) B().connect(S.g, connectFrom.dir === 'out' ? { node: connectFrom.node, pin: connectFrom.pin } : { node: n.id, pin: r.id }, connectFrom.dir === 'out' ? { node: n.id, pin: r.id } : { node: connectFrom.node, pin: connectFrom.pin }); }
    S.sel = new Set([n.id]); drawNodes(); update();
    return n;
  }

  // ---------- węzły ----------
  function literalHtml(n, p) {
    const v = n.values && n.values[p.id] !== undefined ? n.values[p.id] : p.value;
    if (p.multiline) return `<textarea class="bp-lit area" data-lit="${p.id}" rows="3">${esc(v == null ? '' : v)}</textarea>`;
    if (p.type === 'boolean') return `<label class="bp-lit chk"><input type="checkbox" data-lit="${p.id}" ${v ? 'checked' : ''}><span>${v ? 'prawda' : 'fałsz'}</span></label>`;
    if (p.type === 'list' || p.type === 'exec') return '';
    const num = p.type === 'number' || p.type === 'player';
    return `<input class="bp-lit ${num ? 'num' : ''}" data-lit="${p.id}" value="${esc(v == null ? '' : v)}" spellcheck="false" ${num ? 'inputmode="decimal"' : ''} placeholder="${p.type === 'player' ? 'podłącz gracza' : ''}">`;
  }
  function nodeHtml(n) {
    const d = def(n);
    if (!d) return `<div class="bp-node bad" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px"><div class="bp-nh" style="--c:#555">Nieznany bloczek: ${esc(n.type)}</div></div>`;
    const linkedIn = new Set(S.g.links.filter(l => l.to.node === n.id).map(l => l.to.pin));
    const linkedOut = new Set(S.g.links.filter(l => l.from.node === n.id).map(l => l.from.pin));
    if (d.kind === 'note') return `<div class="bp-node note ${S.sel.has(n.id) ? 'sel' : ''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px"><div class="bp-nh">${icon('edit')}Komentarz</div>${literalHtml(n, d.inputs[0])}</div>`;
    const pin = (p, dir) => {
      const linked = dir === 'in' ? linkedIn.has(p.id) : linkedOut.has(p.id);
      return `<div class="bp-pin ${dir} t-${p.type} ${linked ? 'linked' : ''}" data-pin="${esc(p.id)}" data-dir="${dir}" title="${esc(B().TYPES[p.type].name)}${p.literalOnly ? ' – tylko wpisana wartość' : ''}">${dir === 'in' && !p.literalOnly ? `<i class="dot" style="--pc:${B().TYPES[p.type].color}"></i>` : dir === 'in' ? '<i class="dot ghost"></i>' : ''}${p.name ? `<span class="pn">${esc(p.name)}</span>` : ''}${dir === 'in' && !linked && p.type !== 'exec' ? literalHtml(n, p) : ''}${dir === 'out' ? `<i class="dot" style="--pc:${B().TYPES[p.type].color}"></i>` : ''}</div>`;
    };
    const execIn = d.inputs.filter(p => p.type === 'exec'), execOut = d.outputs.filter(p => p.type === 'exec');
    const dataIn = d.inputs.filter(p => p.type !== 'exec'), dataOut = d.outputs.filter(p => p.type !== 'exec');
    return `<div class="bp-node k-${d.kind} ${S.sel.has(n.id) ? 'sel' : ''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;--c:${d.color}">
      <div class="bp-nh">${execIn.map(p => pin(p, 'in')).join('')}<span class="bt">${esc(d.title)}</span>${d.realm ? `<span class="realm">${d.realm === 'server' ? 'S' : 'K'}</span>` : ''}<span class="bp-badge"></span>${execOut.length === 1 && !execOut[0].name ? pin(execOut[0], 'out') : ''}</div>
      <div class="bp-nb"><div class="bp-col">${dataIn.map(p => pin(p, 'in')).join('')}</div><div class="bp-col r">${(execOut.length === 1 && !execOut[0].name ? [] : execOut).concat(dataOut).map(p => pin(p, 'out')).join('')}</div></div></div>`;
  }
  function drawNodes() {
    const box = $('.bp-nodes', S.el);
    box.innerHTML = S.g.nodes.map(nodeHtml).join('');
    $('.bp-empty', S.el).classList.toggle('hidden', S.g.nodes.length > 0);
    $$('[data-lit]', box).forEach(inp => {
      const n = nodeById(inp.closest('.bp-node').dataset.id);
      let snapped = false;
      const set = () => {
        if (!snapped) { snapshot(); snapped = true; }
        n.values = n.values || {};
        const p = def(n).inputs.find(x => x.id === inp.dataset.lit);
        if (inp.type === 'checkbox') { n.values[p.id] = inp.checked; inp.nextElementSibling.textContent = inp.checked ? 'prawda' : 'fałsz'; }
        else if (p.type === 'number' || p.type === 'player') n.values[p.id] = inp.value.trim() === '' || inp.value.trim() === '-' ? inp.value.trim() : (isNaN(+inp.value.replace(',', '.')) ? inp.value : +inp.value.replace(',', '.'));
        else n.values[p.id] = inp.value;
        update(true);
      };
      inp.oninput = set; inp.onchange = () => { set(); snapped = false; };
      inp.onblur = () => { snapped = false; };
      inp.onmousedown = e => e.stopPropagation();
      inp.onkeydown = e => e.stopPropagation();
    });
    drawLinks();
  }
  function toWorld(cx, cy) { const r = $('.bp-world', S.el).getBoundingClientRect(); return { x: (cx - r.left) / S.view.z, y: (cy - r.top) / S.view.z }; }
  function pinPos(nodeId, pinId, dir) {
    const el = $(`.bp-node[data-id="${CSS.escape(nodeId)}"] .bp-pin.${dir}[data-pin="${CSS.escape(pinId)}"] .dot`, S.el);
    if (!el) return null; const r = el.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }
  const curve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
  function drawLinks() {
    const g = $('[data-links]', S.el); if (!g) return;
    const errPins = new Set(S.issues.filter(i => i.level === 'error' && i.pin).map(i => i.node + '|' + i.pin));
    g.innerHTML = S.g.links.map((l, i) => {
      const a = pinPos(l.from.node, l.from.pin, 'out'), b = pinPos(l.to.node, l.to.pin, 'in'); if (!a || !b) return '';
      const fn = nodeById(l.from.node); const fp = fn && def(fn) && def(fn).outputs.find(p => p.id === l.from.pin);
      const tn = nodeById(l.to.node); const tp = tn && def(tn) && def(tn).inputs.find(p => p.id === l.to.pin);
      const type = fp ? fp.type : 'any'; const bad = !fp || !tp || !B().compatible(fp.type, tp.type) || errPins.has(l.to.node + '|' + l.to.pin) && type !== 'exec' && false;
      const conv = fp && tp && B().compatible(fp.type, tp.type) === 'convert';
      const d = curve(a, b);
      return `<g class="bp-link ${type === 'exec' ? 'exec' : ''} ${S.selLink === i ? 'sel' : ''} ${bad ? 'bad' : ''}" data-i="${i}"><path class="hit" d="${d}"/><path class="w" d="${d}" style="--wc:${B().TYPES[type].color}"/>${conv ? `<circle cx="${(a.x + b.x) / 2}" cy="${(a.y + b.y) / 2}" r="7" class="conv"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 + 3.5}" class="conv-t">T</text>` : ''}</g>`;
    }).join('');
    $$('.bp-link', g).forEach(x => {
      x.onmousedown = e => { e.stopPropagation(); const i = +x.dataset.i; if (e.altKey) { snapshot(); S.g.links.splice(i, 1); S.selLink = null; drawNodes(); update(); return; } S.selLink = i; S.sel.clear(); $$('.bp-node.sel', S.el).forEach(n => n.classList.remove('sel')); drawLinks(); setStatus('Połączenie zaznaczone – Delete usuwa, Alt+klik usuwa od razu.'); };
    });
  }
  function applyView() { const w = $('.bp-world', S.el); w.style.transform = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.z})`; const c = $('.bp-canvas', S.el); c.style.backgroundPosition = `${S.view.x}px ${S.view.y}px`; c.style.backgroundSize = `${24 * S.view.z}px ${24 * S.view.z}px`; $('[data-zoom]', S.el).textContent = Math.round(S.view.z * 100) + '%'; }
  function fit() {
    if (!S.g.nodes.length) { S.view = { x: 60, y: 40, z: 1 }; applyView(); drawLinks(); return; }
    const els = $$('.bp-node', S.el); const c = $('.bp-canvas', S.el).getBoundingClientRect();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const e of els) { const n = nodeById(e.dataset.id); if (!n) continue; x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + e.offsetWidth); y2 = Math.max(y2, n.y + e.offsetHeight); }
    const z = Math.max(0.3, Math.min(1.2, Math.min((c.width - 80) / (x2 - x1), (c.height - 80) / (y2 - y1))));
    S.view = { z, x: (c.width - (x2 - x1) * z) / 2 - x1 * z, y: (c.height - (y2 - y1) * z) / 2 - y1 * z }; applyView(); drawLinks();
  }
  function setStatus(t) { const s = S.el && $('[data-st]', S.el); if (s) s.textContent = t || ''; }

  // ---------- zdarzenia planszy ----------
  function canvasEvents(cv) {
    applyView();
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z2 = Math.max(0.25, Math.min(2, S.view.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      S.view.x = mx - (mx - S.view.x) * (z2 / S.view.z); S.view.y = my - (my - S.view.y) * (z2 / S.view.z); S.view.z = z2; applyView();
    }, { passive: false });
    cv.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-cm-block')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    cv.addEventListener('drop', e => { const t = e.dataTransfer.getData('application/x-cm-block'); if (!t) return; e.preventDefault(); const w = toWorld(e.clientX, e.clientY); addBlock(t, w.x - 20, w.y - 14); });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      const pinEl = e.target.closest('.bp-pin');
      if (pinEl) { const nid = pinEl.closest('.bp-node').dataset.id; const dir = pinEl.dataset.dir; const before = S.g.links.length; const keep = S.g.links.filter(l => !(dir === 'in' ? l.to.node === nid && l.to.pin === pinEl.dataset.pin : l.from.node === nid && l.from.pin === pinEl.dataset.pin)); if (keep.length !== before) { snapshot(); S.g.links = keep; drawNodes(); update(); setStatus('Rozłączono pin.'); } return; }
      const nodeEl = e.target.closest('.bp-node');
      if (nodeEl) { nodeMenu(e.clientX, e.clientY, nodeEl.dataset.id); return; }
      addMenu(e.clientX, e.clientY);
    });
    cv.addEventListener('mousedown', e => {
      cv.focus({ preventScroll: true });
      closeMenus();
      const dot = e.target.closest('.dot:not(.ghost)'); const pinEl = dot && dot.closest('.bp-pin');
      const nodeEl = e.target.closest('.bp-node');
      if (e.button === 0 && pinEl) return startLink(e, pinEl);
      if ((e.button === 0 && nodeEl && !e.target.closest('[data-lit]'))) return startNodeDrag(e, nodeEl);
      if (e.button === 1 || e.button === 0) return startPan(e);
    });
  }
  function startPan(e) {
    const sx = e.clientX, sy = e.clientY, vx = S.view.x, vy = S.view.y; let moved = false;
    const mv = ev => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; S.view.x = vx + dx; S.view.y = vy + dy; applyView(); };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); $('.bp-canvas', S.el).classList.remove('panning'); if (!moved) { S.sel.clear(); S.selLink = null; $$('.bp-node.sel', S.el).forEach(n => n.classList.remove('sel')); drawLinks(); setStatus(''); } else draftSave(); };
    $('.bp-canvas', S.el).classList.add('panning');
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }
  function startNodeDrag(e, nodeEl) {
    const id = nodeEl.dataset.id;
    if (e.shiftKey || e.ctrlKey) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); } else if (!S.sel.has(id)) S.sel = new Set([id]);
    S.selLink = null;
    $$('.bp-node', S.el).forEach(n => n.classList.toggle('sel', S.sel.has(n.dataset.id)));
    const start = toWorld(e.clientX, e.clientY);
    const orig = [...S.sel].map(i => { const n = nodeById(i); return n && { n, x: n.x, y: n.y, el: $(`.bp-node[data-id="${CSS.escape(i)}"]`, S.el) }; }).filter(Boolean);
    let moved = false; let raf = 0;
    const mv = ev => {
      const p = toWorld(ev.clientX, ev.clientY); const dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) { snapshot(); moved = true; }
      for (const o of orig) { o.n.x = Math.round((o.x + dx) / 8) * 8; o.n.y = Math.round((o.y + dy) / 8) * 8; o.el.style.left = o.n.x + 'px'; o.el.style.top = o.n.y + 'px'; }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawLinks(); });
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) { drawLinks(); update(); } else selectInfo(id); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }
  function selectInfo(id) { const n = nodeById(id); const d = n && def(n); if (!d) return; const iss = S.issues.filter(i => i.node === id); setStatus(iss.length ? iss[0].msg : (d.help || d.title)); }
  function startLink(e, pinEl) {
    e.stopPropagation(); e.preventDefault();
    const nodeId = pinEl.closest('.bp-node').dataset.id; const dir = pinEl.dataset.dir; const pinId = pinEl.dataset.pin;
    const n = nodeById(nodeId); const p = (dir === 'out' ? def(n).outputs : def(n).inputs).find(x => x.id === pinId);
    const origin = pinPos(nodeId, pinId, dir);
    const temp = $('.bp-temp', S.el); const hint = $('.bp-hint', S.el); const cv = $('.bp-canvas', S.el);
    temp.style.setProperty('--wc', B().TYPES[p.type].color); temp.classList.toggle('exec', p.type === 'exec');
    cv.classList.add('linking');
    let over = null; let result = null;
    const check = target => {
      const tn = target.closest('.bp-node').dataset.id; const tdir = target.dataset.dir;
      if (tdir === dir) return { ok: false, reason: dir === 'out' ? 'Połącz wyjście z wejściem (lewa strona innego bloczka).' : 'Połącz wejście z wyjściem (prawa strona innego bloczka).' };
      const from = dir === 'out' ? { node: nodeId, pin: pinId } : { node: tn, pin: target.dataset.pin };
      const to = dir === 'out' ? { node: tn, pin: target.dataset.pin } : { node: nodeId, pin: pinId };
      return { ...B().canConnect(S.g, from, to), from, to };
    };
    // podświetl pasujące piny
    $$('.bp-pin', S.el).forEach(x => { if (x === pinEl || !x.querySelector('.dot:not(.ghost)')) return; const r = check(x); x.classList.add(r.ok ? 'can' : 'cant'); });
    const mv = ev => {
      const m = toWorld(ev.clientX, ev.clientY);
      temp.setAttribute('d', dir === 'out' ? curve(origin, m) : curve(m, origin));
      const t = document.elementFromPoint(ev.clientX, ev.clientY); const pe = t && t.closest && t.closest('.bp-pin');
      if (over && over !== pe) over.classList.remove('hover');
      over = pe && pe !== pinEl && pe.querySelector('.dot:not(.ghost)') ? pe : null;
      const cr = cv.getBoundingClientRect();
      if (over) { over.classList.add('hover'); result = check(over); hint.classList.remove('hidden'); hint.className = 'bp-hint ' + (result.ok ? 'ok' : 'bad'); hint.textContent = result.ok ? (result.convert ? '✓ Połącz (zamiana na tekst)' : '✓ Połącz') : '✕ ' + result.reason; hint.style.left = (ev.clientX - cr.left + 14) + 'px'; hint.style.top = (ev.clientY - cr.top + 14) + 'px'; temp.classList.toggle('bad', !result.ok); }
      else { result = null; hint.classList.add('hidden'); temp.classList.remove('bad'); }
    };
    const up = ev => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      temp.setAttribute('d', ''); hint.classList.add('hidden'); cv.classList.remove('linking');
      $$('.bp-pin.can, .bp-pin.cant, .bp-pin.hover', S.el).forEach(x => x.classList.remove('can', 'cant', 'hover'));
      if (over && result) {
        if (result.ok) { snapshot(); B().connect(S.g, result.from, result.to); drawNodes(); update(); setStatus(result.convert ? 'Połączono – wartość zostanie zamieniona na tekst.' : 'Połączono.'); }
        else toast(result.reason, 'warn', 4500);
        return;
      }
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      if (t && t.closest('.bp-canvas') && !t.closest('.bp-node')) addMenu(ev.clientX, ev.clientY, { node: nodeId, pin: pinId, dir, type: p.type });
    };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }

  // ---------- menu: dodawanie bloczka, operacje na bloczku ----------
  function closeMenus() { $$('.bp-menu').forEach(m => m.remove()); }
  function addMenu(cx, cy, from) {
    closeMenus();
    const cv = $('.bp-canvas', S.el); const cr = cv.getBoundingClientRect(); const pos = toWorld(cx, cy);
    let lib = B().library(S.g.target || 'lua', S.g.profile || 'lua').filter(d => d.kind !== 'note' || !from);
    if (from) lib = lib.filter(d => (from.dir === 'out' ? d.inputs.some(p => B().compatible(from.type, p.type) && !p.literalOnly) : d.outputs.some(p => B().compatible(p.type, from.type))));
    const m = h(`<div class="bp-menu" style="left:${Math.min(cx - cr.left, cr.width - 270)}px;top:${Math.min(cy - cr.top, cr.height - 330)}px"><input class="input" placeholder="${from ? `Bloczki pasujące do: ${esc(B().TYPES[from.type].name)}` : 'Dodaj bloczek…'}"><div class="bp-ml"></div></div>`);
    cv.appendChild(m);
    const list = $('.bp-ml', m); const inp = $('input', m); let idx = 0; let shown = [];
    const draw = () => {
      const q = inp.value.toLowerCase(); shown = lib.filter(d => !q || (d.title + ' ' + d.cat).toLowerCase().includes(q)).slice(0, 60); idx = Math.min(idx, Math.max(0, shown.length - 1));
      let lastCat = null;
      list.innerHTML = shown.map((d, i) => { const head = d.cat !== lastCat ? `<div class="mc">${esc(d.cat)}</div>` : ''; lastCat = d.cat; return `${head}<div class="mi ${i === idx ? 'on' : ''}" data-i="${i}"><i style="background:${d.color}"></i>${esc(d.title)}</div>`; }).join('') || '<div class="dim" style="padding:8px">Nic nie pasuje.</div>';
      $$('.mi', list).forEach(x => { x.onmousedown = ev => { ev.preventDefault(); pick(shown[+x.dataset.i]); }; });
    };
    const pick = d => { if (!d) return; closeMenus(); addBlock(d.type, pos.x, pos.y - 14, from); };
    inp.oninput = () => { idx = 0; draw(); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'ArrowDown') { idx = Math.min(shown.length - 1, idx + 1); draw(); e.preventDefault(); } if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); } if (e.key === 'Enter') pick(shown[idx]); if (e.key === 'Escape') closeMenus(); };
    m.onmousedown = e => e.stopPropagation();
    draw(); setTimeout(() => inp.focus(), 0);
  }
  function nodeMenu(cx, cy, id) {
    closeMenus(); if (!S.sel.has(id)) { S.sel = new Set([id]); $$('.bp-node', S.el).forEach(n => n.classList.toggle('sel', S.sel.has(n.dataset.id))); }
    const cv = $('.bp-canvas', S.el); const cr = cv.getBoundingClientRect();
    const m = h(`<div class="bp-menu small" style="left:${cx - cr.left}px;top:${cy - cr.top}px"><div class="mi" data-a="dup">Duplikuj <span class="kbd">Ctrl+D</span></div><div class="mi" data-a="unlink">Rozłącz wszystko</div><div class="mi" data-a="help">Co robi ten bloczek?</div><div class="mi danger" data-a="del">Usuń <span class="kbd">Del</span></div></div>`);
    cv.appendChild(m); m.onmousedown = e => e.stopPropagation();
    m.onclick = e => { const a = e.target.closest('[data-a]'); if (!a) return; closeMenus(); ({ dup: duplicate, del: removeSel, unlink: () => { snapshot(); S.g.links = S.g.links.filter(l => !S.sel.has(l.from.node) && !S.sel.has(l.to.node)); drawNodes(); update(); }, help: () => { const d = def(nodeById(id)); modal({ title: d.title, body: `<p class="muted" style="margin-top:0">${esc(d.help || 'Brak opisu.')}</p>${d.inputs.filter(p => p.type !== 'exec').length ? `<h3>Wejścia</h3><ul>${d.inputs.filter(p => p.type !== 'exec').map(p => `<li><b>${esc(p.name || p.id)}</b> – ${esc(B().TYPES[p.type].name)}${p.literalOnly ? ' (tylko wpisana wartość)' : ''}</li>`).join('')}</ul>` : ''}${d.outputs.filter(p => p.type !== 'exec').length ? `<h3>Wyjścia</h3><ul>${d.outputs.filter(p => p.type !== 'exec').map(p => `<li><b>${esc(p.name || p.id)}</b> – ${esc(B().TYPES[p.type].name)}</li>`).join('')}</ul>` : ''}` }); } })[a.dataset.a]();
    };
  }
  function removeSel() {
    if (S.selLink != null) { snapshot(); S.g.links.splice(S.selLink, 1); S.selLink = null; drawNodes(); update(); return; }
    if (!S.sel.size) return; snapshot();
    S.g.nodes = S.g.nodes.filter(n => !S.sel.has(n.id)); S.g.links = S.g.links.filter(l => !S.sel.has(l.from.node) && !S.sel.has(l.to.node)); S.sel.clear(); drawNodes(); update();
  }
  function copySel() { if (!S.sel.size) return; const nodes = S.g.nodes.filter(n => S.sel.has(n.id)); S.clip = JSON.stringify({ nodes, links: S.g.links.filter(l => S.sel.has(l.from.node) && S.sel.has(l.to.node)) }); setStatus(`Skopiowano ${App.plural(nodes.length, 'bloczek', 'bloczki', 'bloczków')}.`); }
  function paste(off = 32) {
    if (!S.clip) return; snapshot(); const c = JSON.parse(S.clip); const map = {};
    for (const n of c.nodes) { const id = B().newId(); map[n.id] = id; S.g.nodes.push({ ...n, id, x: n.x + off, y: n.y + off, values: { ...(n.values || {}) } }); }
    for (const l of c.links) S.g.links.push({ from: { node: map[l.from.node], pin: l.from.pin }, to: { node: map[l.to.node], pin: l.to.pin } });
    S.sel = new Set(Object.values(map)); drawNodes(); update();
  }
  function duplicate() { const keep = S.clip; copySel(); paste(); S.clip = keep; }

  // ---------- sprawdzanie i kod na żywo ----------
  let ut = 0;
  function update(light) {
    clearTimeout(ut);
    ut = setTimeout(() => {
      if (!S.el || !S.el.isConnected) return;
      S.issues = B().validate(S.g);
      $$('.bp-node', S.el).forEach(el => {
        const iss = S.issues.filter(i => i.node === el.dataset.id);
        const e = iss.filter(i => i.level === 'error').length, w = iss.length - e;
        el.classList.toggle('has-err', e > 0); el.classList.toggle('has-warn', !e && w > 0);
        const b = $('.bp-badge', el); if (b) { b.textContent = e ? '!' : w ? '?' : ''; b.title = iss.map(i => i.msg).join('\n'); }
        $$('.bp-pin.in', el).forEach(p => p.classList.toggle('err', iss.some(i => i.pin === p.dataset.pin && i.level === 'error')));
      });
      const e = S.issues.filter(i => i.level === 'error').length, w = S.issues.length - e;
      $('[data-pc]', S.el).innerHTML = e ? `<span class="chip error">${e}</span>` : w ? `<span class="chip warn">${w}</span>` : '<span class="chip ok">✓</span>';
      if (!light) drawLinks();
      drawRight(); draftSave();
    }, light ? 180 : 30);
  }
  const KW = { lua: 'local|function|end|if|then|else|elseif|for|in|do|while|repeat|until|return|and|or|not|nil|true|false|break', python: 'def|if|elif|else|for|in|while|return|and|or|not|None|True|False|import|from|global|pass|break|lambda', js: 'const|let|var|function|if|else|for|of|in|while|return|await|async|new|null|true|false|require|break' };
  function highlight(code, t) {
    const kw = new RegExp(`\\b(${KW[t] || KW.lua})\\b`, 'g'); const cm = t === 'python' ? '#' : t === 'js' ? '//' : '--';
    return code.split('\n').map(line => {
      const ci = (() => { let inS = null; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (inS) { if (ch === '\\') i++; else if (ch === inS) inS = null; } else if (ch === '"' || ch === "'" || ch === '`') inS = ch; else if (line.startsWith(cm, i)) return i; } return -1; })();
      const codePart = ci >= 0 ? line.slice(0, ci) : line; const com = ci >= 0 ? line.slice(ci) : '';
      const parts = codePart.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
      return parts.map((s, i) => (i % 2 ? `<span class="s">${esc(s)}</span>` : esc(s).replace(kw, '<span class="k">$1</span>').replace(/\b(\d+(\.\d+)?)\b/g, '<span class="n">$1</span>'))).join('') + (com ? `<span class="c">${esc(com)}</span>` : '');
    }).join('\n');
  }
  function drawRight() {
    const rb = $('.bp-rb', S.el); if (!rb) return;
    $$('.bp-right [data-t]', S.el).forEach(b => b.classList.toggle('active', b.dataset.t === S.tab));
    if (S.tab === 'code') {
      const r = B().generate(S.g);
      rb.innerHTML = `<div class="bp-code-h"><span class="dim">${esc(TARGETS.find(t => t[0] === (S.g.target || 'lua'))[1])}${S.g.target === 'lua' || !S.g.target ? ' · ' + esc(PROFILES.find(p => p[0] === (S.g.profile || 'lua'))[1]) : ''}</span><span class="grow"></span><button class="btn sm ghost" data-copy>Kopiuj</button><button class="btn sm ghost" data-ed title="Otwórz kod w edytorze tekstowym">${icon('code')}W edytorze</button></div>
        ${r.errors ? `<div class="note warn bp-note">Schemat ma ${App.plural(r.errors, 'błąd', 'błędy', 'błędów')} – kod może nie działać. <a href="#" data-goprob>Pokaż problemy</a></div>` : ''}
        <pre class="bp-code">${highlight(r.code, S.g.target || 'lua')}</pre>`;
      $('[data-copy]', rb).onclick = () => navigator.clipboard.writeText(r.code).then(() => toast('Skopiowano kod'));
      $('[data-ed]', rb).onclick = () => { const name = (S.g.name || 'schemat').replace(/[^\wąćęłńóśźż-]+/gi, '_') + '.' + EXT[S.g.target || 'lua']; App.go('editor'); setTimeout(() => App.ed.openUntitled(name, r.code), 50); };
      const gp = $('[data-goprob]', rb); if (gp) gp.onclick = e => { e.preventDefault(); S.tab = 'problems'; drawRight(); };
    } else if (S.tab === 'problems') {
      const list = S.issues.slice().sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
      rb.innerHTML = list.length ? `<div class="bp-probs">${list.map((i, k) => `<button class="bp-prob ${i.level}" data-k="${k}">${icon(i.level === 'error' ? 'error' : 'alert')}<span>${i.node && nodeById(i.node) && def(nodeById(i.node)) ? `<b>${esc(def(nodeById(i.node)).title)}:</b> ` : ''}${esc(i.msg)}</span></button>`).join('')}</div>` : '<div class="bp-ok">' + icon('ok') + '<b>Wszystko połączone poprawnie</b><span>Brak błędów i ostrzeżeń.</span></div>';
      $$('[data-k]', rb).forEach(b => b.onclick = () => { const i = list[+b.dataset.k]; if (i.node) focusNode(i.node); });
    } else if (S.tab === 'vars') {
      const used = [...new Set(S.g.nodes.filter(n => /^var\./.test(n.type)).map(n => String((n.values && n.values.name) || def(n).inputs.find(p => p.id === 'name').value)))];
      S.g.vars = S.g.vars || [];
      for (const u of used) if (!S.g.vars.some(v => v.name === u)) S.g.vars.push({ name: u, value: 0 });
      rb.innerHTML = `<p class="dim" style="margin-top:0;font-size:12.5px">Zmienne tworzą bloczki „Ustaw/Zwiększ/Wartość zmiennej”. Tu ustawisz wartość początkową.</p><table class="table"><thead><tr><th>Nazwa</th><th>Na starcie</th><th></th></tr></thead><tbody>${S.g.vars.map((v, i) => `<tr><td class="mono">${esc(v.name)}${used.includes(v.name) ? '' : ' <span class="dim">(nieużywana)</span>'}</td><td><input class="input" data-v="${i}" value="${esc(v.value)}"></td><td>${used.includes(v.name) ? '' : `<button class="btn sm ghost icon" data-d="${i}">${icon('x')}</button>`}</td></tr>`).join('') || '<tr><td colspan="3" class="dim">Brak zmiennych.</td></tr>'}</tbody></table>
        <button class="btn sm" data-add style="margin-top:8px">${icon('plus')}Dodaj bloczek zmiennej</button>`;
      $$('[data-v]', rb).forEach(inp => inp.oninput = () => { S.g.vars[+inp.dataset.v].value = inp.value; S.dirty = true; clearTimeout(ut); ut = setTimeout(() => { draftSave(); }, 200); });
      $$('[data-d]', rb).forEach(b => b.onclick = () => { S.g.vars.splice(+b.dataset.d, 1); drawRight(); });
      $('[data-add]', rb).onclick = () => { const c = $('.bp-canvas', S.el).getBoundingClientRect(); const w = toWorld(c.left + c.width / 2, c.top + c.height / 2); addBlock('var.set', w.x, w.y); };
    } else {
      rb.innerHTML = `<div class="bp-help"><h3>Jak to działa</h3><p>Każdy skrypt zaczyna się od <b>zdarzenia</b> (czerwony nagłówek). Białe strzałki to <b>przepływ</b> – kolejność wykonywania akcji. Kolorowe kropki to <b>dane</b>: przeciągnij z wyjścia (prawa strona) do wejścia (lewa strona).</p>
        <div class="bp-legend">${Object.entries(B().TYPES).map(([k, t]) => `<span><i style="background:${t.color}"></i>${esc(t.name)}</span>`).join('')}</div>
        <p>Podczas przeciągania pasujące piny świecą na zielono, a niepasujące są przygaszone. Po upuszczeniu na pustym miejscu otworzy się lista bloczków, które pasują do tego pinu.</p>
        <h3>Skróty</h3><dl class="bp-keys"><dt>Prawy przycisk</dt><dd>dodaj bloczek / menu bloczka / rozłącz pin</dd><dt>Kółko myszy</dt><dd>powiększenie</dd><dt>Przeciąganie tła</dt><dd>przesuwanie planszy</dd><dt>Shift+klik</dt><dd>zaznacz kilka</dd><dt>Delete</dt><dd>usuń zaznaczone</dd><dt>Alt+klik na linii</dt><dd>usuń połączenie</dd><dt>Ctrl+C / Ctrl+V / Ctrl+D</dt><dd>kopiuj / wklej / duplikuj</dd><dt>Ctrl+Z / Ctrl+Y</dt><dd>cofnij / ponów</dd><dt>F</dt><dd>pokaż wszystko</dd><dt>Ctrl+S</dt><dd>zapisz schemat</dd></dl></div>`;
    }
  }
  function focusNode(id) {
    const el = $(`.bp-node[data-id="${CSS.escape(id)}"]`, S.el); const n = nodeById(id); if (!el || !n) return;
    const c = $('.bp-canvas', S.el).getBoundingClientRect();
    S.view.x = c.width / 2 - (n.x + el.offsetWidth / 2) * S.view.z; S.view.y = c.height / 2 - (n.y + el.offsetHeight / 2) * S.view.z; applyView(); drawLinks();
    S.sel = new Set([id]); $$('.bp-node', S.el).forEach(x => x.classList.toggle('sel', S.sel.has(x.dataset.id)));
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); selectInfo(id);
  }

  // ---------- pliki ----------
  async function confirmLose() { return !S.dirty || !S.g.nodes.length || App.confirmBox('Porzucić zmiany?', 'Obecny schemat ma niezapisane zmiany.', 'Porzuć', true); }
  async function newGraph() { if (!(await confirmLose())) return; snapshot(); S.g = B().empty(S.g.target || 'lua', S.g.profile || 'lua'); S.file = null; S.dirty = false; S.view = { x: 60, y: 40, z: 1 }; applyView(); full(); }
  function examples() {
    const ex = Object.entries(B().EXAMPLES);
    const body = h(`<div class="pick-list">${ex.map(([k, e]) => `<button class="pick" data-k="${k}">${icon('blocks')}<span>${esc(e.title)}</span></button>`).join('')}</div>`);
    const m = modal({ title: 'Przykładowe schematy', body });
    $$('[data-k]', body).forEach(b => b.onclick = async () => { m.close(); if (!(await confirmLose())) return; snapshot(); S.g = B().EXAMPLES[b.dataset.k].make(); S.file = null; S.dirty = false; full(); setTimeout(fit, 30); });
  }
  async function openFile() {
    if (!(await confirmLose())) return;
    const f = (await api('dialog:files', 'Otwórz schemat', [{ name: 'Schemat bloczkowy', extensions: ['cmblocks', 'json'] }]))[0]; if (!f) return;
    try { const d = await api('fs:readFile', f); const g = JSON.parse(d.content); if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error('To nie jest plik schematu CodeManager.'); snapshot(); S.g = g; S.file = f; S.dirty = false; full(); setTimeout(fit, 30); toast('Otwarto ' + window.cm.path.basename(f)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function saveFile(as) {
    let f = !as && S.file;
    if (!f) f = await api('dialog:saveAs', (S.g.name || 'schemat').replace(/[^\wąćęłńóśźż -]+/gi, '_') + '.cmblocks', [{ name: 'Schemat bloczkowy', extensions: ['cmblocks'] }]);
    if (!f) return false;
    await api('fs:writeFile', f, JSON.stringify(S.g, null, 1), false); S.file = f; S.dirty = false; draftSave(); toast('Zapisano schemat'); return true;
  }
  async function exportCode() {
    const r = B().generate(S.g);
    if (r.errors && !(await App.confirmBox('Schemat ma błędy', `Znaleziono ${App.plural(r.errors, 'błąd', 'błędy', 'błędów')}. Zapisać kod mimo to?`, 'Zapisz mimo to'))) { S.tab = 'problems'; drawRight(); return; }
    const ext = EXT[S.g.target || 'lua'];
    const f = await api('dialog:saveAs', (S.g.name || (S.g.profile === 'fivem' ? 'server' : 'skrypt')).replace(/[^\wąćęłńóśźż-]+/gi, '_') + '.' + ext, [{ name: 'Kod', extensions: [ext] }]); if (!f) return;
    await api('fs:writeFile', f, r.code, false); toast('Zapisano kod: ' + window.cm.path.basename(f));
  }

  document.addEventListener('keydown', e => {
    if (App.current() !== 'blocks' || !S.el || document.querySelector('.modal-back')) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); } return; }
    const k = e.key.toLowerCase();
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSel(); }
    else if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.ctrlKey && k === 'c') copySel();
    else if (e.ctrlKey && k === 'v') { e.preventDefault(); paste(); }
    else if (e.ctrlKey && k === 'd') { e.preventDefault(); duplicate(); }
    else if (e.ctrlKey && k === 'a') { e.preventDefault(); S.sel = new Set(S.g.nodes.map(n => n.id)); $$('.bp-node', S.el).forEach(x => x.classList.add('sel')); }
    else if (e.ctrlKey && k === 's') { e.preventDefault(); saveFile(); }
    else if (k === 'f' && !e.ctrlKey) fit();
    else if (k === 'escape') { closeMenus(); S.sel.clear(); S.selLink = null; $$('.bp-node.sel', S.el).forEach(n => n.classList.remove('sel')); drawLinks(); }
  });
  window.addEventListener('resize', () => { if (App.current() === 'blocks' && S.el) drawLinks(); });

  App.views.blocks = { full: true, crumb: () => '<b>Edytor bloczkowy</b>', render: el => { render(el); setTimeout(() => { drawLinks(); if (!S.fitted) { S.fitted = true; fit(); } }, 30); } };
  App.blocksState = S;
})();
