// Wersja 1.8.0: wirtualny folder modów, „co zepsuło grę?”, skaner bezpieczeństwa, chmura, optymalizator,
// zaproszenia dla znajomych, panel webowy, serwery języka, wtyczki, Docker
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast, modal, fmtSize } = App;
  const mt = App.mt; const st = App.st;
  const fresh = gameId => { delete App.state.reports[gameId]; };
  const copy = (text, what = 'Skopiowano') => { navigator.clipboard.writeText(text).then(() => toast(what)).catch(() => toast('Nie udało się skopiować', 'error')); };

  // ---------- przyciski w pasku „Narzędzia” zakładki Mody ----------
  const origTools = mt.toolsRow;
  mt.toolsRow = (ctx, rep, refresh) => {
    const el = origTools(ctx, rep, refresh);
    const extra = h(`<span class="tools18">
      <button class="btn sm ghost" data-t18="vfs" title="Mody w osobnym magazynie – gra dostaje dowiązania, folder gry zostaje czysty">${icon('layers')}Wirtualny folder</button>
      <button class="btn sm ghost" data-t18="crash" title="Porównuje uruchomienia gry i wskazuje mod, który najpewniej powoduje crash">${icon('bug')}Co zepsuło grę?</button>
      <button class="btn sm ghost" data-t18="scan" title="Szuka w modach kradzieży kont, backdoorów i złośliwego kodu">${icon('shield')}Skanuj bezpieczeństwo</button>
      <button class="btn sm ghost" data-t18="opt" title="Sprawdza sprzęt i ustawienia, podpowiada co poprawić">${icon('bolt')}Optymalizacja</button>
      <button class="btn sm ghost" data-t18="invite" title="Link dla znajomego: mody + adres serwera">${icon('users')}Zaproś znajomych</button></span>`);
    el.appendChild(extra);
    extra.onclick = e => { const b = e.target.closest('[data-t18]'); if (!b) return; e.stopPropagation(); ({ vfs: () => vfsModal(ctx, refresh), crash: () => crashModal(ctx, rep, refresh), scan: () => scanModal(ctx, refresh), opt: () => optimizerModal(ctx, refresh), invite: () => inviteCreate({ gameId: ctx.g.id, profileId: ctx.profileId }) })[b.dataset.t18](); };
    return el;
  };

  // ================= wirtualny folder modów =================
  async function vfsModal(ctx, refresh) {
    const body = h('<div class="vfs"><div class="progress indet"><i></i></div></div>');
    const m = modal({ title: `Wirtualny folder modów – ${ctx.g.name}`, wide: true, body, onClose: () => { fresh(ctx.g.id); refresh(); } });
    const g = ctx.g.id; const p = ctx.profileId;
    const draw = async state => {
      state = state || await api('vfs:status', g);
      if (!state.enabled) {
        const rep = App.state.reports[g] || await api('mods:check', g, p);
        const own = rep.mods.filter(x => x.file && x.toggleable && !x.workshopId);
        body.innerHTML = `<div class="vfs-intro"><div class="vfs-diagram"><div><b>Magazyn</b><small>osobny folder na każdy mod</small></div><span>→</span><div><b>Folder gry</b><small>tylko dowiązania do plików</small></div></div>
          <p>Każdy mod leży w osobnym folderze w magazynie CodeManager, a do gry trafiają jedynie dowiązania (twarde lub symboliczne, a gdy się nie da – kopie). Wyłączenie moda usuwa jego pliki z gry bez kasowania, a oryginalne pliki gry nadpisane przez mod są odkładane i wracają po wyłączeniu. Kolejność na liście decyduje, który mod wygrywa, gdy dwa mają ten sam plik.</p>
          ${own.length ? `<h3>Przenieś obecne mody do magazynu</h3><div class="vfs-adopt">${own.map((x, i) => `<label class="check"><input type="checkbox" data-ad="${i}" checked><span>${esc(x.name)} <span class="dim">${esc(window.cm.path.basename(x.file))}</span></span></label>`).join('')}</div><p class="dim" style="font-size:12.5px">Przed przeniesieniem CodeManager zrobi migawkę profilu.</p>` : ''}
          <button class="btn primary" data-on>${icon('layers')}Włącz wirtualny folder</button></div>`;
        $('[data-on]', body).onclick = async e => {
          e.target.disabled = true;
          try {
            let s2 = await api('vfs:enable', g, true);
            const pick = $$('[data-ad]', body).filter(c => c.checked).map(c => own[+c.dataset.ad].file);
            if (pick.length) s2 = await api('vfs:adopt', g, p, pick);
            toast(pick.length ? `Przeniesiono ${App.plural(pick.length, 'mod', 'mody', 'modów')} do magazynu` : 'Wirtualny folder włączony'); draw(s2);
          } catch { e.target.disabled = false; }
        };
        return;
      }
      const mods = state.mods;
      body.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="chip ok">${icon('check')}włączony</span><span class="dim grow">${App.plural(mods.length, 'mod', 'mody', 'modów')} w magazynie · ${mods.filter(x => x.enabled).length} wdrożonych</span>
          <button class="btn sm" data-inst>${icon('plus')}Zainstaluj z archiwum</button><button class="btn sm" data-dep title="Odtwórz dowiązania w folderze gry">${icon('refresh')}Wdróż ponownie</button><button class="btn sm ghost" data-undep title="Usuń dowiązania z gry (mody zostają w magazynie)">Wycofaj z gry</button><button class="btn sm ghost danger" data-off>Wyłącz</button></div>
        ${state.changed ? `<div class="note warn" style="margin-bottom:10px">${App.plural(state.changed, 'plik został zmieniony', 'pliki zostały zmienione', 'plików zostało zmienionych')} przez grę po wdrożeniu (np. zapis konfiguracji). „Wdróż ponownie” zachowa zmienione pliki.</div>` : ''}
        <div class="vfs-list">${mods.length ? '' : '<div class="empty" style="padding:26px"><h2>Magazyn jest pusty</h2><p>Instalacje z Nexus Mods i archiwów trafiają teraz tutaj.</p></div>'}</div>
        <p class="dim" style="font-size:12.5px;margin:10px 0 0">Niżej na liście = wyższy priorytet. Przeciągnij wiersz albo użyj strzałek.</p>`;
      const list = $('.vfs-list', body);
      mods.forEach((x, i) => {
        const row = h(`<div class="vfs-row ${x.enabled ? '' : 'off'}" draggable="true" data-id="${esc(x.id)}">
          <span class="grip" aria-hidden="true">⋮⋮</span><span class="ord">${i + 1}</span>
          <label class="switch"><input type="checkbox" ${x.enabled ? 'checked' : ''}><span></span></label>
          <div class="grow"><div class="nm">${esc(x.name)}${x.version ? ` <span class="dim mono">${esc(x.version)}</span>` : ''}</div>
            <div class="sub">${App.plural(x.files, 'plik', 'pliki', 'plików')} · ${fmtSize(x.size)}${x.source ? ' · ' + esc(x.source) : ''}${x.overwrites.length ? ` · <span class="win">nadpisuje: ${esc(x.overwrites.join(', '))}</span>` : ''}${x.overwrittenBy.length ? ` · <span class="lose">przegrywa z: ${esc(x.overwrittenBy.join(', '))}</span>` : ''}</div></div>
          <button class="btn sm ghost icon" data-a="up" title="Wyżej (niższy priorytet)" ${i ? '' : 'disabled'}>↑</button><button class="btn sm ghost icon" data-a="down" title="Niżej (wyższy priorytet)" ${i < mods.length - 1 ? '' : 'disabled'}>↓</button>
          <button class="btn sm ghost icon" data-a="ren" title="Zmień nazwę">${icon('edit')}</button><button class="btn sm ghost icon" data-a="open" title="Folder moda w magazynie">${icon('folder')}</button><button class="btn sm ghost icon danger" data-a="del" title="Usuń z magazynu">${icon('trash')}</button></div>`);
        $('input', row).onchange = async ev => { try { const r = await api('vfs:toggle', g, p, x.id, ev.target.checked); draw(r); } catch { ev.target.checked = !ev.target.checked; } };
        row.onclick = async ev => {
          const a = ev.target.closest('[data-a]'); if (!a) return;
          const ids = mods.map(y => y.id);
          if (a.dataset.a === 'up' || a.dataset.a === 'down') { const j = i + (a.dataset.a === 'up' ? -1 : 1); [ids[i], ids[j]] = [ids[j], ids[i]]; draw(await api('vfs:order', g, p, ids)); }
          if (a.dataset.a === 'ren') { const n = await App.promptBox('Nazwa moda', 'Nazwa', x.name); if (n) draw(await api('vfs:rename', g, x.id, n)); }
          if (a.dataset.a === 'open') api('vfs:open', g, x.id);
          if (a.dataset.a === 'del' && await App.confirmBox('Usunąć mod z magazynu?', `<b>${esc(x.name)}</b> zniknie z gry i z magazynu.`, 'Usuń', true)) draw(await api('vfs:remove', g, p, x.id));
        };
        row.ondragstart = ev => { ev.dataTransfer.setData('text/plain', x.id); row.classList.add('drag'); };
        row.ondragend = () => row.classList.remove('drag');
        row.ondragover = ev => { ev.preventDefault(); row.classList.add('over'); };
        row.ondragleave = () => row.classList.remove('over');
        row.ondrop = async ev => { ev.preventDefault(); row.classList.remove('over'); const from = ev.dataTransfer.getData('text/plain'); if (!from || from === x.id) return; const ids = mods.map(y => y.id).filter(id => id !== from); ids.splice(ids.indexOf(x.id) + (mods.findIndex(y => y.id === from) < i ? 1 : 0), 0, from); draw(await api('vfs:order', g, p, ids)); };
        list.appendChild(row);
      });
      $('[data-inst]', body).onclick = async () => { const f = await api('dialog:files', 'Archiwa modów', [{ name: 'Archiwa', extensions: ['zip', '7z', 'rar'] }]); if (!f.length) return; const r = await App.runJob('Instalacja do magazynu', async () => window.cm.call('vfs:install', g, p, f), { doneMsg: x => `Wdrożono ${x.deploy.total} plików.` }); if (r) draw(r); };
      $('[data-dep]', body).onclick = async () => { const r = await api('vfs:deploy', g, p); const mm = r.deploy.methods || {}; toast(`Wdrożono: ${r.deploy.total} plików${mm.copy ? ` (${mm.copy} skopiowanych – inny dysk niż magazyn)` : ''}`); draw(r); };
      $('[data-undep]', body).onclick = async () => { const r = await api('vfs:undeploy', g, p); toast('Usunięto dowiązania z folderu gry'); draw(r); };
      $('[data-off]', body).onclick = async () => { if (!(await App.confirmBox('Wyłączyć wirtualny folder?', 'Dowiązania zostaną usunięte z gry, a mody zostaną w magazynie – możesz go włączyć ponownie w każdej chwili. Nowe instalacje znów trafią prosto do folderu gry.', 'Wyłącz', true))) return; await api('vfs:undeploy', g, p); draw(await api('vfs:enable', g, false)); };
    };
    try { await draw(); } catch (e) { m.close(); toast(e.message, 'error'); }
  }

  // ================= co zepsuło grę? =================
  const STATUS = { crash: ['error', 'crash'], short: ['warn', 'szybko zamknięta'], ok: ['ok', 'w porządku'] };
  const CH = { added: 'dodany', updated: 'zaktualizowany', enabled: 'włączony', removed: 'usunięty', disabled: 'wyłączony' };
  async function crashModal(ctx, rep, refresh) {
    const body = h('<div><div class="progress indet"><i></i></div></div>');
    modal({ title: `Co zepsuło grę? – ${ctx.g.name}`, wide: true, body });
    const draw = async () => {
      const a = await api('history:analyze', ctx.g.id, ctx.profileId);
      if (!a.sessions.length) { body.innerHTML = `<div class="empty" style="padding:24px"><h2>Brak historii uruchomień</h2><p>CodeManager zapisuje listę modów przy każdym uruchomieniu gry (gdy liczenie czasu gry jest włączone). Po pierwszym crashu porówna ją z ostatnim działającym uruchomieniem.</p></div>`; return; }
      body.innerHTML = `${a.bad ? `<div class="crash-head"><div><b>Ostatnie problematyczne uruchomienie:</b> ${new Date(a.bad.start).toLocaleString('pl-PL')} (${STATUS[a.bad.status][1]}, ${mt.fmtDuration(a.bad.duration)})</div>${a.good ? `<div class="dim">Porównanie z działającym: ${new Date(a.good.start).toLocaleString('pl-PL')}</div>` : '<div class="dim">Nie ma jeszcze działającego uruchomienia do porównania.</div>'}</div>` : '<div class="note" style="margin-bottom:12px">Ostatnie uruchomienia przebiegły bez crasha.</div>'}
        ${a.suspects.length ? `<h3>Podejrzane mody</h3><div class="suspects">${a.suspects.slice(0, 8).map((s, i) => `<div class="suspect"><span class="score s${Math.min(3, Math.ceil(s.score / 4))}" title="Punkty podejrzenia">${s.score}</span><div class="grow"><div class="nm">${esc(s.name)}</div><div class="sub">${s.reasons.map(esc).join(' · ')}</div></div>${rep.mods.find(m => (m.key === s.key || m.name === s.name) && m.toggleable && m.enabled) ? `<button class="btn sm" data-off="${i}">Wyłącz</button>` : ''}</div>`).join('')}</div>` : ''}
        ${a.changes.length ? `<h3>Zmiany od działającego uruchomienia</h3><div class="files">${a.changes.map(c => `<span class="chip ${c.type === 'removed' ? '' : 'warn'}">${CH[c.type] || c.type}</span> ${esc(c.name)}${c.from ? ` <span class="dim">${esc(c.from)} → ${esc(c.to)}</span>` : ''}`).join('<br>')}</div>` : ''}
        <div class="row" style="margin:14px 0 6px"><h3 class="grow" style="margin:0">Uruchomienia</h3><button class="btn sm" data-bisect>${icon('search')}Znajdź winowajcę metodą połówkową</button></div>
        <div class="sessions">${a.sessions.slice().reverse().map(s => `<div class="sess"><span class="chip ${STATUS[s.status][0]}">${STATUS[s.status][1]}${s.manual ? ' (ręcznie)' : ''}</span><span>${new Date(s.start).toLocaleString('pl-PL')}</span><span class="dim">${mt.fmtDuration(s.duration)} · ${App.plural(s.mods.length || s.mods, 'mod', 'mody', 'modów')}${s.crashFiles && s.crashFiles.length ? ' · raport crasha' : ''}</span><span class="grow"></span>${s.crashFiles && s.crashFiles.length ? `<button class="btn sm ghost" data-file="${esc(s.crashFiles[0].file || s.crashFiles[0])}">Raport</button>` : ''}<button class="btn sm ghost" data-mark="${s.start}" data-st="${s.status === 'ok' ? 'crash' : 'ok'}">${s.status === 'ok' ? 'To był crash' : 'To nie był crash'}</button></div>`).join('')}</div>`;
      $$('[data-off]', body).forEach(b => b.onclick = async () => { const s = a.suspects[+b.dataset.off]; const mod = rep.mods.find(m => m.key === s.key || m.name === s.name); await api('mods:toggle', mod, ctx.g.id); toast(`Wyłączono ${s.name}. Uruchom grę i sprawdź.`); b.disabled = true; fresh(ctx.g.id); refresh(); });
      $$('[data-mark]', body).forEach(b => b.onclick = async () => { await api('history:mark', ctx.g.id, +b.dataset.mark, b.dataset.st); draw(); });
      $$('[data-file]', body).forEach(b => b.onclick = () => App.go('editor', { file: b.dataset.file }));
      $('[data-bisect]', body).onclick = () => { document.querySelectorAll('.modal-back').forEach(x => x.remove()); mt.bisectStart(ctx, rep, refresh); };
    };
    draw().catch(e => { body.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; });
  }
  window.cm.on('history:crash', d => {
    const g = App.state.defs.games.find(x => x.id === d.gameId); if (!g) return;
    modal({ title: `${g.name} zamknęła się z błędem`, body: `<p class="muted" style="margin-top:0">Gra działała ${mt.fmtDuration(d.session.duration)}${d.session.crashFiles && d.session.crashFiles.length ? ' i zostawiła raport crasha' : ''}. CodeManager może porównać mody z ostatnim działającym uruchomieniem.</p>`,
      actions: [{ label: 'Później' }, { label: 'Sprawdź, co zepsuło grę', primary: true, icon: 'bug', onClick: async () => { const rep = await api('mods:check', g.id, null); crashModal({ g, profileId: null }, rep, () => {}); } }] });
  });

  // ================= skaner bezpieczeństwa =================
  const LVL = { danger: ['error', 'niebezpieczny'], warn: ['warn', 'podejrzany'], info: ['', 'informacja'], ok: ['ok', 'czysty'] };
  function scanResults(r, { onTrash } = {}) {
    const sorted = r.results.slice().sort((a, b) => ['danger', 'warn', 'info', 'ok'].indexOf(a.level) - ['danger', 'warn', 'info', 'ok'].indexOf(b.level));
    const el = h(`<div><div class="scan-sum"><div class="${r.summary.danger ? 'bad' : ''}"><b>${r.summary.danger}</b><span>niebezpieczne</span></div><div class="${r.summary.warn ? 'mid' : ''}"><b>${r.summary.warn}</b><span>podejrzane</span></div><div><b>${r.summary.ok}</b><span>czyste</span></div><div><b>${r.results.length}</b><span>przeskanowane</span></div></div>
      ${!r.summary.danger && !r.summary.warn ? '<div class="note ok-note">Nie znaleziono znanych zagrożeń. Skaner szuka typowych wzorców (kradzież kont Discord/Minecraft, backdoory FiveM, pobieranie i uruchamianie kodu), nie zastąpi antywirusa.</div>' : ''}
      <div class="scan-list"></div></div>`);
    const list = $('.scan-list', el);
    for (const x of sorted.filter(y => y.level !== 'ok')) {
      const row = h(`<div class="scan-item ${x.level}"><div class="row"><span class="chip ${LVL[x.level][0]}">${LVL[x.level][1]}</span><b class="grow">${esc(x.name)}</b>${onTrash && x.level === 'danger' && x.file ? '<button class="btn sm danger" data-del>Przenieś do kosza</button>' : ''}${x.file ? '<button class="btn sm ghost icon" data-show title="Pokaż w folderze">' + icon('folder') + '</button>' : ''}</div>
        <ul>${x.findings.map(f => `<li><span class="lv ${f.level}">${esc(f.title)}</span>${f.detail ? ` <span class="dim">– ${esc(f.detail)}</span>` : ''}${f.where ? ` <span class="mono dim">${esc(f.where)}</span>` : ''}</li>`).join('')}</ul></div>`);
      const del = $('[data-del]', row); if (del) del.onclick = async () => { await onTrash(x); del.disabled = true; del.textContent = 'W koszu'; };
      const sh = $('[data-show]', row); if (sh) sh.onclick = () => api('shell:show', x.file);
      list.appendChild(row);
    }
    return el;
  }
  App.scanResults = scanResults;
  async function scanModal(ctx, refresh) {
    const body = h('<div><p class="muted" style="margin-top:0">Skanowanie plików modów…</p><div class="progress indet"><i></i></div></div>');
    modal({ title: `Skaner bezpieczeństwa – ${ctx.g.name}`, wide: true, body, onClose: () => refresh() });
    try {
      const r = await window.cm.call('security:scan', ctx.g.id, ctx.profileId);
      body.innerHTML = ''; body.appendChild(scanResults(r, { onTrash: async x => { await api('mods:remove', x.file, ctx.g.id, x.name); fresh(ctx.g.id); toast(`${x.name} trafił do kosza`); } }));
    } catch (e) { body.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
  }
  window.cm.on('security:alert', d => {
    const danger = d.results.some(r => r.level === 'danger');
    const body = h(`<div><p class="muted" style="margin-top:0">${danger ? 'Właśnie zainstalowany mod zawiera kod typowy dla złośliwego oprogramowania. <b>Nie uruchamiaj gry</b>, dopóki go nie sprawdzisz.' : 'Właśnie zainstalowany mod robi rzeczy nietypowe dla moda. Upewnij się, że pochodzi z zaufanego źródła.'}</p></div>`);
    body.appendChild(scanResults({ results: d.results, summary: { danger: d.results.filter(r => r.level === 'danger').length, warn: d.results.filter(r => r.level === 'warn').length, ok: 0 } }, { onTrash: async x => { await api('fs:trash', x.file); toast(`${x.name} trafił do kosza`); App.state.reports = {}; } }));
    modal({ title: danger ? 'Wykryto niebezpieczny mod' : 'Podejrzany mod', wide: true, body });
  });

  // ================= kopie w chmurze (zakładka Zapisy gry) =================
  const origSaves = mt.savesTab;
  mt.savesTab = async (c, ctx) => {
    await origSaves(c, ctx);
    const box = h('<div class="panel cloud-panel" style="margin-top:14px"><div class="progress indet"><i></i></div></div>');
    c.appendChild(box);
    cloudPanel(box, ctx).catch(e => { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; });
  };
  async function cloudPanel(box, ctx) {
    const pr = await api('cloud:providers');
    const sel = pr.selected;
    const known = pr.providers.find(p => p.path === sel);
    box.innerHTML = `<div class="panel-head"><h2>${icon('cloud')}Kopie w chmurze</h2><span class="dim grow">${sel ? esc(known ? known.name : 'Własny folder') + ' · <span class="mono">' + esc(sel) + '</span>' : 'nie wybrano folderu'}</span><button class="btn sm" data-pick>${sel ? 'Zmień' : 'Wybierz chmurę'}</button></div>
      ${sel ? `<p class="dim" style="margin:0 0 10px;font-size:12.5px">Kopie trafiają do folderu synchronizowanego przez program chmury (OneDrive, Dropbox, Dysk Google). Na innym komputerze zobaczysz je tutaj i przywrócisz jednym kliknięciem.</p>
      <div class="row" style="margin-bottom:10px"><label class="check"><input type="checkbox" data-auto ${pr.auto ? 'checked' : ''}><span>Automatycznie po każdej sesji gry</span></label><span class="grow"></span><label class="check"><input type="checkbox" data-mods><span>Dołącz pliki modów</span></label><button class="btn sm primary" data-up>${icon('cloud')}Wyślij kopię teraz</button></div>
      <div data-list><div class="progress indet"><i></i></div></div>` : '<p class="muted" style="margin:0">Wybierz folder chmury, a CodeManager będzie tam kopiował zapisy gry i listę modów.</p>'}`;
    $('[data-pick]', box).onclick = () => {
      const b = h(`<div><div class="pick-list">${pr.providers.map((p, i) => `<label class="pick ${p.path === sel ? 'on' : ''}"><input type="radio" name="cl" value="${i}" ${p.path === sel ? 'checked' : ''}><span><b>${esc(p.name)}</b><br><span class="mono dim">${esc(p.path)}</span></span></label>`).join('') || '<p class="muted">Nie wykryto OneDrive, Dropboxa ani Dysku Google. Wskaż dowolny folder synchronizowany z chmurą.</p>'}</div><button class="btn sm" data-custom style="margin-top:10px">${icon('folder')}Inny folder…</button></div>`);
      const m = modal({ title: 'Folder chmury', body: b, actions: [{ label: 'Anuluj' }, { label: 'Wybierz', primary: true, onClick: async () => { const r = $('input[name=cl]:checked', b); if (!r) { toast('Zaznacz folder', 'warn'); return false; } await api('cloud:select', pr.providers[+r.value].path); App.state.settings.cloudProvider = pr.providers[+r.value].path; cloudPanel(box, ctx); } }] });
      $('[data-custom]', b).onclick = async () => { const d = await api('dialog:folder', 'Folder synchronizowany z chmurą'); if (!d) return; await api('settings:set', { cloudCustom: d }); await api('cloud:select', d); m.close(); cloudPanel(box, ctx); };
    };
    if (!sel) return;
    $('[data-auto]', box).onchange = e => api('cloud:select', undefined, e.target.checked);
    $('[data-up]', box).onclick = async e => {
      const label = await App.promptBox('Kopia w chmurze', 'Opis (opcjonalnie)', ''); if (label === null) return;
      e.target.disabled = true;
      try { const r = await window.cm.call('cloud:backup', ctx.g.id, ctx.profileId, { label, mods: $('[data-mods]', box).checked }); toast(`Wysłano kopię (${fmtSize(r.size)})`); } catch (er) { toast(er.message, 'error', 8000); }
      e.target.disabled = false; drawList();
    };
    const drawList = async () => {
      const l = $('[data-list]', box); const list = await api('cloud:list', ctx.g.id, ctx.profileId);
      if (!list.length) { l.innerHTML = '<p class="dim" style="margin:0">Brak kopii w chmurze dla tej gry.</p>'; return; }
      l.innerHTML = `<div class="backups">${list.map((b, i) => `<div class="bk"><div class="grow"><b>${new Date(b.created).toLocaleString('pl-PL')}</b>${b.label ? ` · ${esc(b.label)}` : ''}<div class="sub">${b.own ? 'ten komputer' : `<span class="chip warn">${esc(b.host)}</span>`} · ${b.items.map(it => ({ saves: 'zapisy', mods: 'mody', profile: 'lista modów' }[it.kind] || it.kind)).filter((v, j, a) => a.indexOf(v) === j).join(', ')}${b.size ? ' · ' + fmtSize(b.size) : ''}</div></div><button class="btn sm" data-r="${i}">Przywróć</button></div>`).join('')}</div>`;
      $$('[data-r]', l).forEach(btn => btn.onclick = async () => {
        const b = list[+btn.dataset.r];
        if (!(await App.confirmBox('Przywrócić kopię z chmury?', `Zapisy gry zostaną zastąpione kopią z ${new Date(b.created).toLocaleString('pl-PL')}${b.own ? '' : ` (komputer ${esc(b.host)})`}. Najpierw CodeManager zrobi lokalną kopię obecnych zapisów. Zamknij grę.`, 'Przywróć'))) return;
        const r = await api('cloud:restore', ctx.g.id, ctx.profileId, b.dir);
        toast('Przywrócono kopię z chmury');
        if (r.profileCode && await App.confirmBox('Lista modów w kopii', 'Kopia zawiera też listę modów. Otworzyć import profilu, aby doinstalować brakujące mody?', 'Otwórz import')) { mt.shareImport(ctx, () => {}); setTimeout(() => { const ta = document.querySelector('[data-code]'); if (ta) { ta.value = r.profileCode; ta.dispatchEvent(new Event('input')); } }, 80); }
      });
    };
    drawList();
  }

  // ================= optymalizator =================
  async function optimizerModal(ctx, refresh) {
    const body = h('<div><p class="muted" style="margin-top:0">Sprawdzanie sprzętu i ustawień…</p><div class="progress indet"><i></i></div></div>');
    modal({ title: `Optymalizacja – ${ctx.g.name}`, wide: true, body, onClose: () => refresh() });
    const draw = async () => {
      const r = await api('optimizer:analyze', ctx.g.id, ctx.profileId); const hw = r.hw;
      const target = ctx.g.id === 'minecraft' ? await App.apiQuiet('mods:target', ctx.g.id, ctx.profileId).catch(() => null) : null;
      body.innerHTML = `<div class="hw-grid"><div><span>Procesor</span><b>${esc(hw.cpu)}</b><small>${hw.cores} wątków</small></div><div><span>Pamięć</span><b>${hw.ramGB} GB</b><small>wolne ${hw.freeGB} GB</small></div><div><span>Karta graficzna</span><b>${esc((hw.gpus[0] || {}).name || 'nieznana')}</b><small>${(hw.gpus[0] || {}).vramGB ? hw.gpus[0].vramGB + ' GB VRAM' : ''}</small></div><div><span>Dysk gry</span><b>${hw.disk ? esc(hw.disk.type) : '?'}</b><small>${hw.freeDiskGB != null ? `wolne ${hw.freeDiskGB} GB` : ''}</small></div></div>
        ${r.instance ? `<p class="dim" style="font-size:12.5px">Instancja: <b>${esc(r.instance.name)}</b> (${esc(r.instance.launcher)})${r.instance.memory && r.instance.memory.max ? ` · pamięć ${Math.round(r.instance.memory.max / 102.4) / 10} GB` : ''}</p>` : ''}
        <div class="opt-list"></div>`;
      const list = $('.opt-list', body);
      for (const s of r.suggestions) {
        const row = h(`<div class="opt ${s.level}">${App.renderIssues ? '' : ''}<span class="lv">${icon({ error: 'error', warn: 'alert', info: 'bulb', ok: 'ok' }[s.level] || 'info')}</span><div class="grow"><b>${esc(s.title)}</b><div class="sub">${esc(s.detail || '')}</div></div>${s.action ? `<button class="btn sm ${s.level === 'warn' || s.level === 'error' ? 'primary' : ''}">${esc(s.action.label || 'Zastosuj')}</button>` : ''}</div>`);
        const b = $('button', row);
        if (b) b.onclick = async () => {
          b.disabled = true;
          try {
            if (s.action.type === 'modrinth') { if (!target) throw new Error('Brak folderu modów'); await App.installModrinth(target, s.action.id, s.title.replace(/^Mod wydajnościowy: /, '')); fresh(ctx.g.id); }
            else { const msg = await window.cm.call('optimizer:apply', ctx.g.id, ctx.profileId, s.action); if (msg) toast(msg); }
            b.textContent = 'Zrobione'; b.classList.remove('primary');
          } catch (e) { b.disabled = false; toast(e.message, 'error', 8000); }
        };
        list.appendChild(row);
      }
    };
    draw().catch(e => { body.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; });
  }

  // ================= zaproszenia =================
  const SRV_GAME = { fivem: 'gta5', mta: 'gtasa', beammp: 'beamng', redm: 'redm', oxide: 'rust', carbon: 'rust' };
  App.inviteCreate = inviteCreate;
  async function inviteCreate(opts = {}) {
    const s = opts.server; const gameId = opts.gameId || (s ? SRV_GAME[s.type] || s.type : null);
    const g = App.state.defs.games.find(x => x.id === gameId);
    const body = h(`<div class="invite">
      <div class="tabs" style="margin-bottom:12px"><button class="active" data-it="new">Nowe zaproszenie</button><button data-it="have">Mam kod od znajomego</button></div>
      <div data-pane="new">
        <div class="field"><label>Nazwa serwera lub opis</label><input class="input" data-n value="${esc(s ? s.name : (g ? g.name : ''))}"></div>
        <div class="field"><label>Adres serwera (opcjonalnie)</label><div class="inline-input"><input class="input mono" data-a placeholder="np. 85.12.34.56:25565"><button class="btn" data-ip title="Wstaw mój publiczny adres IP">Mój IP</button></div><span class="hint">Znajomi spoza Twojej sieci potrzebują publicznego IP i przekierowanego portu (zakładka Sieć serwera) albo VPN typu Radmin/ZeroTier.</span></div>
        <div class="field"><label>Hasło serwera (opcjonalnie)</label><input class="input" data-pw></div>
        <div class="field"><label>Wiadomość</label><input class="input" data-m placeholder="Wbijaj wieczorem!"></div>
        ${g && !opts.noMods ? `<label class="check"><input type="checkbox" data-mods checked><span>Dołącz listę modów (${esc(g.name)}) – znajomy zainstaluje brakujące jednym kliknięciem</span></label>` : ''}
        <div data-out></div></div>
      <div data-pane="have" class="hidden"><div class="field"><label>Link codemanager://join/… albo kod CMJ1:…</label><textarea class="input mono" rows="4" data-code></textarea></div></div></div>`);
    let mode = 'new';
    const m = modal({ title: 'Zaproś znajomych', wide: true, body, actions: [{ label: 'Zamknij' }, { label: 'Utwórz zaproszenie', primary: true, icon: 'link', onClick: async ({ button }) => {
      if (mode === 'have') { const v = $('[data-code]', body).value.trim(); if (!v) return false; m.close(); inviteOpen(v); return; }
      const port = s && s.port; let addr = $('[data-a]', body).value.trim(); if (addr && port && !/:\d+$/.test(addr)) addr += ':' + port;
      const r = await api('invite:create', { gameId, profileId: opts.profileId, serverId: s && s.id, serverName: $('[data-n]', body).value.trim(), address: addr, password: $('[data-pw]', body).value, message: $('[data-m]', body).value.trim(), withMods: !!($('[data-mods]', body) || {}).checked, from: App.state.settings.inviteName || '' });
      $('[data-out]', body).innerHTML = `<div class="invite-out"><div class="field"><label>Link (kliknięcie otwiera CodeManager u znajomego)</label><div class="inline-input"><input class="input mono" readonly value="${esc(r.link)}"><button class="btn" data-cp="link">Kopiuj</button></div></div><div class="field"><label>Kod do wklejenia (gdy link się nie otwiera, np. na Discordzie)</label><div class="inline-input"><input class="input mono" readonly value="${esc(r.code)}"><button class="btn" data-cp="code">Kopiuj</button></div></div><p class="dim" style="font-size:12.5px;margin:0">Znajomy potrzebuje CodeManagera. Bez niego niech wejdzie na serwer ręcznie: <span class="mono">${esc(addr || '—')}</span>.</p></div>`;
      $$('[data-cp]', body).forEach(b => b.onclick = () => copy(b.dataset.cp === 'link' ? r.link : r.code, 'Skopiowano zaproszenie'));
      button.textContent = 'Utwórz ponownie';
      return false;
    } }] });
    $$('[data-it]', body).forEach(b => b.onclick = () => { mode = b.dataset.it; $$('[data-it]', body).forEach(x => x.classList.toggle('active', x === b)); $('[data-pane=new]', body).classList.toggle('hidden', mode !== 'new'); $('[data-pane=have]', body).classList.toggle('hidden', mode !== 'have'); $('footer .btn.primary', m.el).lastChild.textContent = mode === 'new' ? 'Utwórz zaproszenie' : 'Otwórz zaproszenie'; });
    $('[data-ip]', body).onclick = async () => { const ip = await App.apiQuiet('net:publicIp').catch(() => null); if (!ip) { toast('Nie udało się ustalić publicznego IP', 'warn'); return; } $('[data-a]', body).value = ip + (s && s.port ? ':' + s.port : ''); };
  }
  async function inviteOpen(link) {
    let inv; try { inv = await window.cm.call('invite:parse', link); } catch (e) { toast(e.message, 'error', 8000); return; }
    const det = App.state.detected; const g = App.state.defs.games.find(x => x.id === inv.gameId);
    const profiles = g && inv.installed ? await App.apiQuiet('mods:profiles', g.id).catch(() => []) : [];
    let preview = null; if (inv.profileCode && profiles.length) preview = await App.apiQuiet('share:preview', g.id, profiles[0].id, inv.profileCode).catch(() => null);
    const body = h(`<div class="invite-in"><div class="row" style="gap:14px;align-items:center;margin-bottom:12px">${g ? App.gameBadge(g, 48) : ''}<div><h2 style="margin:0">${esc(inv.serverName || inv.gameName)}</h2><div class="dim">${esc(inv.gameName)}${inv.from ? ` · od ${esc(inv.from)}` : ''} · ${new Date(inv.created).toLocaleDateString('pl-PL')}</div></div></div>
      ${inv.message ? `<blockquote class="inv-msg">${esc(inv.message)}</blockquote>` : ''}
      ${inv.address ? `<div class="field"><label>Serwer</label><div class="inline-input"><input class="input mono" readonly value="${esc(inv.address)}"><button class="btn" data-cpa>Kopiuj</button></div>${inv.password ? `<span class="hint">Hasło: <span class="mono">${esc(inv.password)}</span></span>` : ''}</div>` : ''}
      ${!inv.installed ? `<div class="note warn">Nie znaleziono gry ${esc(inv.gameName)} na tym komputerze.${det ? '' : ' (wykrywanie gier jeszcze trwa)'}</div>` : ''}
      ${profiles.length > 1 && inv.profileCode ? `<div class="field"><label>Profil, do którego zainstalować mody</label><select class="input" data-prof>${profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>` : ''}
      ${preview ? `<div class="panel"><b>Mody z zaproszenia:</b> ${preview.total} · masz już ${preview.same} · do pobrania ${preview.download.length} · do włączenia ${preview.toggle.length}</div>` : ''}</div>`);
    const steps = [];
    if (inv.profileCode && inv.installed) steps.push({ label: preview && !preview.download.length && !preview.toggle.length ? 'Mody są gotowe' : 'Zainstaluj mody', primary: !inv.address, icon: 'download', onClick: async () => { const pid = ($('[data-prof]', body) || {}).value || (profiles[0] && profiles[0].id); setTimeout(() => App.runJob('Instalacja modów z zaproszenia', jobId => window.cm.call('share:import', jobId, g.id, pid, inv.profileCode, {}), { doneMsg: x => `Zmieniono ${x.toggled}, pobrano ${x.installed.length}${x.manual.length ? `, ręcznie: ${x.manual.length}` : ''}. Możesz dołączyć do serwera.` }), 0); App.state.reports = {}; return false; } });
    if (inv.address && inv.connect) steps.push({ label: inv.connect.label, primary: true, icon: 'play', onClick: async () => { const pid = ($('[data-prof]', body) || {}).value || (profiles[0] && profiles[0].id); const r = await api('invite:connect', inv.gameId, pid, inv.address, inv.serverName, inv.password); if (r.minecraft) toast(r.added ? 'Dodano serwer do listy w Minecrafcie – uruchom grę i wybierz go w trybie wieloosobowym' : 'Ten serwer już jest na liście w Minecrafcie'); else if (r.opened) toast('Uruchamianie gry…'); return false; } });
    modal({ title: 'Zaproszenie od znajomego', wide: true, body, actions: [{ label: 'Zamknij' }, ...steps] });
    const cpa = $('[data-cpa]', body); if (cpa) cpa.onclick = () => copy(inv.address, 'Skopiowano adres');
  }
  App.inviteOpen = inviteOpen;
  window.cm.on('invite:open', d => inviteOpen(d.link));

  // ================= serwery: Docker, zaproszenie, skan =================
  const origNet = st.networkTab;
  st.networkTab = async (c, s) => {
    await origNet(c, s);
    const box = h(`<div class="grid two" style="align-items:start;margin-top:14px"><div class="panel" data-docker><div class="progress indet"><i></i></div></div>
      <div class="panel"><h2 style="margin-bottom:8px">${icon('users')}Znajomi i bezpieczeństwo</h2><p class="muted" style="margin-top:0">Wyślij znajomym link z adresem serwera (i listą modów klienta), a CodeManager u nich sam doda serwer i zainstaluje mody.</p>
        <div class="row"><button class="btn primary" data-inv>${icon('link')}Zaproś znajomych</button><button class="btn" data-scan>${icon('shield')}Skanuj pluginy i mody serwera</button></div><div data-scanres style="margin-top:12px"></div></div></div>`);
    c.appendChild(box);
    $('[data-inv]', box).onclick = () => inviteCreate({ server: s, noMods: !['fivem', 'redm', 'mta'].includes(s.type) && s.type !== 'minecraft' });
    $('[data-scan]', box).onclick = async e => { e.target.disabled = true; const out = $('[data-scanres]', box); out.innerHTML = '<div class="progress indet"><i></i></div>'; try { const r = await window.cm.call('security:scanServer', s.id); out.innerHTML = ''; out.appendChild(scanResults(r, { onTrash: async x => { await api('fs:trash', x.file); toast(`${x.name} trafił do kosza`); } })); } catch (er) { out.innerHTML = `<div class="note warn">${esc(er.message)}</div>`; } e.target.disabled = false; };
    dockerPanel($('[data-docker]', box), s);
  };
  async function dockerPanel(box, s) {
    const [av, d] = await Promise.all([App.apiQuiet('docker:available').catch(() => ({ ok: false })), App.apiQuiet('servers:dockerInfo', s.id).catch(() => ({}))]);
    box.innerHTML = `<div class="panel-head"><h2>${icon('container')}Docker</h2>${av.ok ? `<span class="chip ok">Docker ${esc(av.version || '')}</span>` : '<span class="chip">nie znaleziono</span>'}</div>
      <p class="muted" style="margin-top:0">Serwer działa w kontenerze: nie widzi reszty dysku, ma własne limity pamięci i procesora, a pliki zostają w zwykłym folderze serwera.</p>
      ${av.ok ? '' : `<div class="note" style="margin-bottom:10px">Zainstaluj Docker Desktop (Windows wymaga WSL 2), uruchom go i wróć tutaj. <a href="#" data-dl>Pobierz Docker Desktop</a></div>`}
      <label class="check" style="margin-bottom:10px"><input type="checkbox" data-en ${d.enabled ? 'checked' : ''} ${av.ok ? '' : 'disabled'}><span>Uruchamiaj ten serwer w Dockerze</span></label>
      <div class="field"><label>Obraz</label><input class="input mono" data-img value="${esc(d.image || '')}" placeholder="${esc(d.defaultImage || 'np. ubuntu:24.04 (wymagany dla tej gry)')}"><span class="hint">${d.defaultImage ? `Puste = ${esc(d.defaultImage)}. ` : 'Serwery z plikami Linux potrzebują obrazu z bibliotekami gry (np. steamcmd/steamcmd). '}Pliki serwera są widoczne w kontenerze jako /data.</span></div>
      <div class="row" style="gap:10px"><div class="field grow"><label>Limit pamięci (MB)</label><input class="input" type="number" data-mem value="${d.memory || ''}" placeholder="bez limitu"></div><div class="field grow"><label>Procesory</label><input class="input" type="number" step="0.5" data-cpu value="${d.cpus || ''}" placeholder="bez limitu"></div></div>
      <div class="field"><label>Dodatkowe parametry docker run</label><input class="input mono" data-extra value="${esc(d.extra || '')}" placeholder="np. --restart unless-stopped"></div>
      <button class="btn primary" data-save ${av.ok ? '' : 'disabled'}>${icon('save')}Zapisz</button> <span class="dim" style="font-size:12.5px">Zmiana działa od następnego uruchomienia serwera.</span>`;
    const dl = $('[data-dl]', box); if (dl) dl.onclick = e => { e.preventDefault(); api('shell:external', 'https://www.docker.com/products/docker-desktop/'); };
    $('[data-save]', box).onclick = async () => { await api('servers:docker', s.id, { enabled: $('[data-en]', box).checked, image: $('[data-img]', box).value, memory: $('[data-mem]', box).value, cpus: $('[data-cpu]', box).value, extra: $('[data-extra]', box).value }); toast('Zapisano ustawienia Dockera'); };
  }

  // ================= ustawienia =================
  const origSettings = App.views.settings.render;
  App.views.settings.render = async function (el, params = {}) {
    await origSettings.call(this, el, params);
    const wrap = h(`<div class="grid two settings18" style="align-items:start;margin-top:12px">
      <div class="panel" id="set-web"></div><div class="panel" id="set-lsp"></div>
      <div class="panel" id="set-plugins"></div><div class="panel" id="set-sec"></div></div>`);
    el.appendChild(wrap);
    webPanelSettings($('#set-web', wrap)); lspSettings($('#set-lsp', wrap)); pluginSettings($('#set-plugins', wrap)); securitySettings($('#set-sec', wrap));
    if (params.section && $('#set-' + params.section, wrap)) setTimeout(() => $('#set-' + params.section, wrap).scrollIntoView({ behavior: 'smooth' }), 120);
  };
  async function webPanelSettings(box) {
    const s = await api('webpanel:status');
    box.innerHTML = `<div class="panel-head"><h2>${icon('phone')}Panel webowy i telefon</h2>${s.running ? `<span class="chip ok">działa · port ${s.port}</span>` : '<span class="chip">wyłączony</span>'}</div>
      <p class="muted" style="margin-top:0">Steruj serwerami z telefonu lub innego komputera w tej samej sieci: start, stop, restart, konsola na żywo, polecenia i kopie zapasowe.</p>
      ${s.running ? `<div class="web-urls">${s.urls.map(u => `<div class="inline-input"><input class="input mono" readonly value="${esc(u)}"><button class="btn" data-cp="${esc(u)}">Kopiuj</button></div>`).join('')}</div>
        <div class="pin-box"><span>PIN</span><b class="mono">${esc(s.pin)}</b><button class="btn sm ghost" data-pin>Nowy PIN</button></div>
        <p class="dim" style="font-size:12.5px">Otwórz adres w przeglądarce telefonu (ta sama sieć Wi-Fi) i wpisz PIN. Na Androidzie i iOS możesz dodać panel do ekranu głównego. Dostęp spoza domu: VPN (np. Tailscale) – nie przekierowuj tego portu na routerze.</p>` : ''}
      <div class="row"><div class="field" style="margin:0;width:120px"><label>Port</label><input class="input" type="number" data-port value="${esc(App.state.settings.webPanelPort || 8790)}"></div><span class="grow"></span>${s.running ? `<button class="btn danger" data-stop>${icon('stop')}Wyłącz panel</button>` : `<button class="btn primary" data-start>${icon('play')}Włącz panel</button>`}</div>`;
    $$('[data-cp]', box).forEach(b => b.onclick = () => copy(b.dataset.cp, 'Skopiowano adres'));
    const pin = $('[data-pin]', box); if (pin) pin.onclick = async () => { await api('webpanel:newPin'); webPanelSettings(box); };
    const start = $('[data-start]', box); if (start) start.onclick = async () => { try { await window.cm.call('webpanel:start', +$('[data-port]', box).value); App.state.settings.webPanel = true; toast('Panel webowy działa'); } catch (e) { toast(/EADDRINUSE/.test(e.message) ? 'Ten port jest zajęty – wybierz inny.' : e.message, 'error', 8000); } webPanelSettings(box); };
    const stop = $('[data-stop]', box); if (stop) stop.onclick = async () => { await api('webpanel:stop'); App.state.settings.webPanel = false; webPanelSettings(box); };
  }
  async function lspSettings(box) {
    const s = await App.lspStatus(true);
    box.innerHTML = `<div class="panel-head"><h2>${icon('code')}Serwery języka (edytor)</h2></div>
      <p class="muted" style="margin-top:0">Pełne wsparcie języka jak w VS Code: błędy na bieżąco, przejście do definicji (F12), wszystkie odwołania (Shift+F12), zmiana nazwy w całym projekcie (F2), formatowanie. Dla Lua używane są też funkcje z wybranego API gry (FiveM, Garry's Mod…).</p>
      <label class="check" style="margin-bottom:10px"><input type="checkbox" data-on ${App.state.settings.lspEnabled !== false ? 'checked' : ''}><span>Uruchamiaj serwery języka przy otwieraniu plików</span></label>
      <div class="lsp-list">${Object.entries(s).map(([k, v]) => `<div class="lsp-row"><div class="grow"><b>${esc(v.name)}</b><div class="sub">${v.installed ? (v.running ? 'działa' : 'zainstalowany') : esc(v.size)}</div></div>${v.installed ? '<span class="chip ok">gotowy</span>' : `<button class="btn sm" data-i="${k}">${icon('download')}Zainstaluj</button>`}</div>`).join('')}</div>`;
    $('[data-on]', box).onchange = async e => { App.state.settings.lspEnabled = e.target.checked; await api('settings:set', { lspEnabled: e.target.checked }); };
    $$('[data-i]', box).forEach(b => b.onclick = async () => { if (await App.installLsp(b.dataset.i)) lspSettings(box); });
  }
  async function pluginSettings(box) {
    const r = await api('plugins:list');
    box.innerHTML = `<div class="panel-head"><h2>${icon('plug')}Wtyczki</h2><button class="btn sm" data-ex>${icon('plus')}Przykładowa wtyczka</button><button class="btn sm" data-dir>${icon('folder')}Folder</button></div>
      <p class="muted" style="margin-top:0">Wtyczki dodają obsługę nowych gier, własne sprawdzanie modów, typy serwerów, reguły analizatora logów i polecenia. Wtyczka to folder z plikami <span class="mono">plugin.json</span> i <span class="mono">main.js</span> – działa z pełnymi uprawnieniami programu, więc instaluj tylko zaufane.</p>
      <div class="plugin-list">${r.plugins.length ? r.plugins.map(p => `<div class="plugin-row"><label class="switch"><input type="checkbox" data-p="${esc(p.id)}" ${p.enabled ? 'checked' : ''} ${p.error && !p.name ? 'disabled' : ''}><span></span></label><div class="grow"><b>${esc(p.name || p.id)}</b> <span class="dim">${esc(p.version || '')}${p.author ? ' · ' + esc(p.author) : ''}</span><div class="sub">${esc(p.description || '')}${p.games && p.games.length ? ' · gry: ' + esc(p.games.join(', ')) : ''}</div>${p.error ? `<div class="sub err">${esc(p.error)}</div>` : ''}</div>${(p.commands || []).map(c => `<button class="btn sm ghost" data-run="${esc(p.id)}|${esc(c.id)}">${esc(c.title)}</button>`).join('')}</div>`).join('') : '<p class="dim">Brak wtyczek. Utwórz przykładową, aby zobaczyć, jak działają.</p>'}</div>
      <div data-restart class="hidden note" style="margin-top:10px">Zmiana zadziała po ponownym uruchomieniu. <button class="btn sm primary" data-rs>Uruchom ponownie</button></div>`;
    $('[data-ex]', box).onclick = async () => { await api('plugins:example'); pluginSettings(box); };
    $('[data-dir]', box).onclick = () => api('plugins:folder');
    $$('[data-p]', box).forEach(c => c.onchange = async () => { await api('plugins:enable', c.dataset.p, c.checked); $('[data-restart]', box).classList.remove('hidden'); });
    $$('[data-run]', box).forEach(b => b.onclick = async () => { const [p, c] = b.dataset.run.split('|'); try { const x = await window.cm.call('plugins:run', p, c); if (x != null) toast(String(x)); } catch (e) { toast(e.message, 'error', 8000); } });
    $('[data-rs]', box).onclick = () => api('app:restart');
  }
  function securitySettings(box) {
    const s = App.state.settings;
    box.innerHTML = `<div class="panel-head"><h2>${icon('shield')}Bezpieczeństwo modów</h2></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-k="scanOnInstall" ${s.scanOnInstall !== false ? 'checked' : ''}><span>Skanuj każdy instalowany mod (ostrzeżenie, gdy wygląda na złośliwy)</span></label>
      <p class="dim" style="font-size:12.5px;margin:4px 0 14px">Skaner zna m.in. fractureiser (Minecraft), backdoory zasobów FiveM i typowe sposoby kradzieży tokenów Discord, sesji Minecrafta i haseł przeglądarek. Pełny skan uruchomisz w zakładce Mody → Narzędzia → Skanuj bezpieczeństwo.</p>
      <h3 style="margin:0 0 8px">Zaproszenia</h3>
      <div class="field"><label>Twoja nazwa w zaproszeniach</label><input class="input" data-k="inviteName" value="${esc(s.inviteName || '')}" placeholder="np. nick z Discorda"></div>`;
    $$('[data-k]', box).forEach(i => i.onchange = async () => { const v = i.type === 'checkbox' ? i.checked : i.value.trim(); App.state.settings[i.dataset.k] = v; await api('settings:set', { [i.dataset.k]: v }); toast('Zapisano'); });
  }
})();
