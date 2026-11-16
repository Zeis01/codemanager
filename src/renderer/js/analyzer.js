// Analizator błędów – wyjaśnienia dla osób, które nie znają się na informatyce
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast } = App;
  let last = { kind: 'game', gameId: null, profileId: null, serverId: null };

  function findingCard(f, target, onFixed) {
    const el = h(`<div class="finding ${f.level}">
      <div class="finding-h">${App.icon({ error: 'error', warn: 'alert', info: 'info', ok: 'ok' }[f.level] || 'info', 'ic')}<div class="finding-t">${esc(f.title)}</div>${f.mod ? `<span class="chip">${esc(f.mod)}</span>` : ''}</div>
      <div class="finding-g">
        <div><div class="finding-l">Dlaczego tak się dzieje</div><div>${esc(f.why || '—')}</div></div>
        <div><div class="finding-l">Co zrobić</div><div>${esc(f.fix || '—')}</div>${f.action && target ? `<button class="btn sm primary" style="margin-top:8px" data-fix>${icon('wrench')}${esc(f.action.label || 'Napraw za mnie')}</button>` : ''}</div>
      </div>
      ${f.evidence ? `<details><summary>Pokaż fragment logu</summary><pre class="evidence">${esc(f.evidence)}</pre></details>` : ''}
    </div>`);
    const b = $('[data-fix]', el);
    if (b) b.onclick = () => App.fix(f.action, target, () => { b.disabled = true; b.innerHTML = icon('check') + 'Zrobione'; onFixed && onFixed(); });
    return el;
  }

  function renderResult(box, r, target) {
    const hl = r.headline;
    box.innerHTML = '';
    box.appendChild(h(`<div class="explain ${hl.tone}"><div class="explain-ic">${icon(hl.tone === 'ok' ? 'ok' : hl.tone === 'warn' ? 'alert' : 'bulb')}</div><div><div class="explain-t">${esc(hl.text)}</div><div class="muted" style="margin-top:4px">${esc(hl.sub)}</div>
      <div class="dim" style="font-size:12px;margin-top:8px">Przeanalizowano ${r.stats.lines.toLocaleString('pl-PL')} wierszy · ${r.stats.errorLines} wierszy z błędami</div></div></div>`));
    for (const f of r.findings) box.appendChild(findingCard(f, target));
  }

  async function analyzeFile(box, file, ctx, target) {
    box.innerHTML = '<div class="panel"><p class="muted" style="margin-top:0">Czytam log i szukam znanych problemów…</p><div class="progress indet"><i></i></div></div>';
    try { const r = await App.apiQuiet('analyzer:analyze', file, ctx); renderResult(box, r, target); }
    catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
  }

  async function render(el, params) {
    if (params.gameId) last = { kind: 'game', gameId: params.gameId, profileId: params.profileId || null };
    if (params.serverId) last = { kind: 'server', serverId: params.serverId };
    const det = App.state.detected;
    const games = det ? App.state.defs.games.filter(g => det.games[g.id] && det.games[g.id].found) : [];
    if (!last.gameId && games[0]) last.gameId = games[0].id;
    el.innerHTML = `
      <div class="head"><div class="grow"><h1>Analizator błędów</h1><p class="lead">Wybierz grę lub serwer, a CodeManager przeczyta logi i raporty awarii, rozpozna znane problemy (${'ponad 50 reguł'}) i wyjaśni je prostym językiem – bez sztucznej inteligencji, na podstawie wzorców błędów.</p></div></div>
      <div class="grid" style="grid-template-columns:320px minmax(0,1fr);align-items:start">
        <div class="panel">
          <div class="seg" style="margin-bottom:14px"><button data-kind="game">Gra</button><button data-kind="server">Serwer</button><button data-kind="file">Plik / tekst</button></div>
          <div data-src></div>
        </div>
        <div data-out><div class="empty"><h2>Wybierz log po lewej</h2><p>Najlepsze wyniki daje raport awarii albo log z ostatniego uruchomienia, w którym gra się wyłączyła.</p></div></div>
      </div>`;
    const src = $('[data-src]', el); const out = $('[data-out]', el);
    const drawSrc = async () => {
      $$('[data-kind]', el).forEach(b => b.classList.toggle('active', b.dataset.kind === last.kind));
      if (last.kind === 'game') {
        if (!games.length) { src.innerHTML = '<p class="muted">Nie wykryto gier.</p>'; return; }
        const g = App.state.defs.games.find(x => x.id === last.gameId) || games[0];
        const profiles = await api('mods:profiles', g.id);
        if (!last.profileId || !profiles.find(p => p.id === last.profileId)) last.profileId = profiles[0] && profiles[0].id;
        src.innerHTML = `<div class="field"><label>Gra</label><select class="input" data-g>${games.map(x => `<option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
          ${profiles.length > 1 ? `<div class="field"><label>${g.id === 'minecraft' ? 'Instancja' : 'Profil'}</label><select class="input" data-p>${profiles.map(p => `<option value="${esc(p.id)}" ${p.id === last.profileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>` : ''}
          <div class="field"><label>Znalezione logi</label><div class="loglist" data-logs><div class="progress indet"><i></i></div></div></div>
          <button class="btn" style="width:100%;justify-content:center" data-compat>${icon('shield')}Sprawdź zgodność modów po ludzku</button>`;
        $('[data-g]', src).onchange = e => { last.gameId = e.target.value; last.profileId = null; drawSrc(); };
        const ps = $('[data-p]', src); if (ps) ps.onchange = e => { last.profileId = e.target.value; drawSrc(); };
        const target = { gameId: g.id, profileId: last.profileId };
        $('[data-compat]', src).onclick = async () => {
          out.innerHTML = '<div class="progress indet"><i></i></div>';
          const rep = await api('mods:check', g.id, last.profileId); App.state.reports[g.id] = rep;
          const sum = await api('analyzer:summary', rep);
          out.innerHTML = '';
          out.appendChild(h(`<div class="explain ${sum.tone}"><div class="explain-ic">${icon(sum.tone === 'ok' ? 'ok' : 'bulb')}</div><div><div class="explain-t">${esc(sum.text)}</div>${sum.steps.length ? `<ol class="explain-steps">${sum.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}</div></div>`));
          for (const i of rep.issues.filter(x => x.level !== 'ok')) out.appendChild(findingCard({ level: i.level, title: i.title, why: i.detail || (i.level === 'error' ? 'Ten problem może uniemożliwić uruchomienie gry lub powodować awarie.' : 'To nie musi psuć gry, ale warto to sprawdzić.'), fix: i.fix, mod: null, action: i.action }, target));
        };
        const logs = await api('analyzer:candidates', g.id, last.profileId);
        drawLogs($('[data-logs]', src), logs, f => analyzeFile(out, f, { gameId: g.id, profileId: last.profileId }, target));
      } else if (last.kind === 'server') {
        const list = App.state.servers;
        if (!list.length) { src.innerHTML = '<p class="muted">Nie masz serwerów.</p>'; return; }
        if (!last.serverId || !list.find(s => s.id === last.serverId)) last.serverId = list[0].id;
        src.innerHTML = `<div class="field"><label>Serwer</label><select class="input" data-s>${list.map(s => `<option value="${s.id}" ${s.id === last.serverId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Znalezione logi</label><div class="loglist" data-logs></div></div>`;
        $('[data-s]', src).onchange = e => { last.serverId = e.target.value; drawSrc(); };
        const logs = await api('analyzer:serverCandidates', last.serverId);
        drawLogs($('[data-logs]', src), logs, f => analyzeFile(out, f, { serverId: last.serverId }, { serverId: last.serverId }));
      } else {
        src.innerHTML = `<button class="btn" style="width:100%;justify-content:center" data-file>${icon('file')}Wybierz plik logu…</button><p class="muted" style="text-align:center;margin:10px 0">albo wklej treść</p><textarea class="input mono" rows="10" placeholder="Wklej log lub raport awarii…" data-t></textarea><button class="btn primary" style="margin-top:8px;width:100%;justify-content:center" data-go>${icon('search')}Analizuj</button>
          <div class="drop-hint" data-drop>Możesz też przeciągnąć plik tutaj</div>`;
        $('[data-file]', src).onclick = async () => { const f = (await api('dialog:files', 'Wybierz log', [{ name: 'Logi', extensions: ['log', 'txt', 'json', 'rpt', 'adm'] }, { name: 'Wszystkie', extensions: ['*'] }]))[0]; if (f) analyzeFile(out, f, {}, null); };
        $('[data-go]', src).onclick = async () => { const t = $('[data-t]', src).value; if (!t.trim()) return; out.innerHTML = '<div class="progress indet"><i></i></div>'; renderResult(out, await api('analyzer:text', t), null); };
        const drop = $('[data-drop]', src);
        drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
        drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) analyzeFile(out, window.cm.pathForFile(f), {}, null); };
      }
    };
    $$('[data-kind]', el).forEach(b => b.onclick = () => { last.kind = b.dataset.kind; drawSrc(); });
    drawSrc();
  }

  function drawLogs(box, logs, onPick) {
    box.innerHTML = '';
    if (!logs.length) { box.innerHTML = '<p class="dim" style="font-size:12.5px;margin:0">Nie znaleziono logów. Uruchom grę/serwer, aż wystąpi problem, albo wybierz plik ręcznie (zakładka Plik).</p>'; return; }
    logs.sort((a, b) => b.mtime - a.mtime);
    for (const l of logs) {
      const b = h(`<button class="logitem"><span>${icon('file')}</span><span style="flex:1;min-width:0"><span style="display:block">${esc(l.label)}</span><span class="dim" style="font-size:11.5px">${esc(l.path.startsWith('console:') ? 'pamięć programu' : window.cm.path.basename(l.path))} · ${App.timeAgo(l.mtime)}</span></span></button>`);
      b.onclick = () => { $$('.logitem', box).forEach(x => x.classList.remove('sel')); b.classList.add('sel'); onPick(l.path); };
      box.appendChild(b);
    }
  }

  App.views.analyzer = { crumb: () => '<b>Analizator błędów</b>', render };
})();
