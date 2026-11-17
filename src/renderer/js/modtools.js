// Narzędzia modów: konflikty, kolejność ładowania, migawki, zapisy, duplikaty, bisekcja,
// udostępnianie i porównywanie profili, notatki/tagi, kosz, uruchamianie gier
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast, modal, renderIssues, fmtSize } = App;
  const mt = App.mt = {};
  const target = ctx => ({ gameId: ctx.g.id, profileId: ctx.profileId });

  // ---------- czas gry ----------
  App.state.playtime = {};
  mt.fmtDuration = ms => { const m = Math.round((ms || 0) / 60000); if (m < 60) return `${m} min`; const hh = Math.floor(m / 60); return hh < 100 ? `${hh} godz. ${m % 60} min` : `${hh} godz.`; };
  mt.playLine = id => {
    const p = App.state.playtime[id]; if (!p || (!p.total && !p.current)) return '';
    return p.current ? `<span class="playing">${icon('play')}W grze</span> · ${mt.fmtDuration(p.total)}` : `${mt.fmtDuration(p.total)} · ostatnio ${App.timeAgo(p.last)}`;
  };
  mt.loadPlaytime = async () => { try { const r = await App.apiQuiet('playtime:all'); App.state.playtime = r.all || {}; App.state.recent = r.recent || []; } catch { /* */ } };
  mt.launch = async (g, profileId) => {
    try { const r = await window.cm.call('games:launch', g.id, profileId || null); toast(`Uruchamiam ${g.name} (${r.label})…`); }
    catch (e) { toast(e.message, 'error', 7000); }
  };

  // ---------- konflikty plików ----------
  mt.conflictsTab = async (c, ctx) => {
    c.innerHTML = '<div class="panel"><p class="muted" style="margin-top:0">Porównuję pliki modów…</p><div class="progress indet"><i></i></div></div>';
    let r; try { r = await App.apiQuiet('mods:conflicts', ctx.g.id, ctx.profileId); } catch (e) { c.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
    if (!r.supported) { c.innerHTML = `<div class="empty"><h2>Brak danych o plikach modów</h2><p>Dla tej gry konflikty da się wykryć, gdy instalujesz mody z archiwów przez CodeManager (Nexus Mods lub „Zainstaluj z archiwum”) – wtedy program zapamiętuje, który mod dostarczył które pliki.</p></div>`; return; }
    c.innerHTML = `<p class="lead" style="margin:0 0 14px">Gdy dwa mody zawierają ten sam plik, gra użyje tylko jednej wersji. Większość takich nakładek jest zamierzona (łatki, kompatybilności), ale jeśli coś nie działa, zacznij od tej listy.</p><div data-parts></div>`;
    const box = $('[data-parts]', c);
    for (const p of r.parts) {
      const sec = h(`<div class="panel" style="margin-bottom:12px"><div class="panel-head"><h2>${esc(p.source)}</h2><span class="dim">${p.files ? App.plural(p.files, 'wspólny plik', 'wspólne pliki', 'wspólnych plików') : 'brak konfliktów'}</span></div>
        <p class="dim" style="font-size:12.5px;margin:0 0 10px">${esc(p.note)}</p><div data-g></div></div>`);
      const gl = $('[data-g]', sec);
      if (!p.groups.length) gl.innerHTML = `<div class="issue ok">${icon('ok', 'ic')}<div><div class="t">Żaden mod nie nadpisuje plików innego moda</div></div></div>`;
      for (const g of p.groups) {
        const row = h(`<div class="conflict"><div class="cf-head"><div class="cf-mods">${g.mods.map(m => `<span class="${g.winner === m ? 'win' : g.winner ? 'lose' : ''}">${esc(m)}${g.winner === m ? ' <small>wygrywa</small>' : ''}</span>`).join('<i>↔</i>')}</div><span class="chip">${App.plural(g.count, 'plik', 'pliki', 'plików')}</span><button class="btn sm ghost" data-show>Pokaż pliki</button></div><div class="files hidden" data-files>${g.files.map(esc).join('<br>')}${g.count > g.files.length ? `<br>… i ${g.count - g.files.length} więcej` : ''}</div></div>`);
        $('[data-show]', row).onclick = e => { const f = $('[data-files]', row); f.classList.toggle('hidden'); e.currentTarget.textContent = f.classList.contains('hidden') ? 'Pokaż pliki' : 'Ukryj pliki'; };
        gl.appendChild(row);
      }
      box.appendChild(sec);
    }
  };

  // ---------- kolejność ładowania ----------
  mt.loadOrderTab = async (c, ctx) => {
    c.innerHTML = '<div class="progress indet"><i></i></div>';
    let data; try { data = await App.apiQuiet('loadorder:get', ctx.g.id); } catch (e) { c.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
    if (!data) { c.innerHTML = '<div class="empty"><h2>Ta gra nie ma kolejności ładowania</h2></div>'; return; }
    let items = data.items; let dirty = false;
    c.innerHTML = `<div class="row" style="margin-bottom:10px"><p class="lead" style="margin:0;flex:1">${esc(data.hint)}</p>
      <button class="btn" data-sort>${icon('layers')}Sortuj automatycznie</button><button class="btn primary" data-save disabled>${icon('save')}Zapisz kolejność</button></div>
      ${data.exists ? '' : `<div class="note warn" style="margin-bottom:10px">Nie znaleziono pliku ${esc(data.file)} – uruchom grę raz, aby powstał. Zapis utworzy go od nowa.</div>`}
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start"><div class="lo-list" data-list></div>
      <div class="panel"><h3 style="margin-bottom:8px">Problemy</h3><div data-prob></div><p class="dim" style="font-size:12px;margin:12px 0 0">Przeciągaj pozycje myszą albo zaznacz i używaj Alt+↑ / Alt+↓. Przed zapisem CodeManager robi migawkę i kopię pliku (.bak).</p></div></div>`;
    const list = $('[data-list]', c); const prob = $('[data-prob]', c); const saveB = $('[data-save]', c);
    const markDirty = () => { dirty = true; saveB.disabled = false; };
    const check = async () => { const p = await App.apiQuiet('loadorder:check', ctx.g.id, items).catch(() => []); prob.innerHTML = p.length ? p.map(x => `<div class="issue warn" style="padding:8px 10px">${icon('alert', 'ic')}<div class="t" style="font-size:13px">${esc(x)}</div></div>`).join('') : `<div class="issue ok" style="padding:8px 10px">${icon('ok', 'ic')}<div class="t" style="font-size:13px">Kolejność jest poprawna</div></div>`; };
    let dragIdx = null; let sel = null;
    const draw = () => {
      list.innerHTML = '';
      items.forEach((it, i) => {
        const row = h(`<div class="lo-row ${it.locked ? 'locked' : ''} ${it.active ? '' : 'off'} ${sel === i ? 'sel' : ''}" draggable="${it.locked ? 'false' : 'true'}" tabindex="0"><span class="lo-n">${i + 1}</span>
          <label class="switch sm"><input type="checkbox" ${it.active ? 'checked' : ''} ${it.locked ? 'disabled' : ''}><span></span></label>
          <span class="lo-name">${esc(it.name)}</span>${it.kind ? `<span class="chip">${esc(it.kind)}</span>` : ''}${it.missing ? '<span class="chip error">brak</span>' : ''}${it.locked ? `<span class="dim" title="Plik gry">${icon('shield')}</span>` : `<span class="lo-grip">⋮⋮</span>`}</div>`);
        $('input', row).onchange = e => { it.active = e.target.checked; row.classList.toggle('off', !it.active); markDirty(); check(); };
        row.onclick = e => { if (e.target.closest('label')) return; sel = i; $$('.lo-row', list).forEach((r, j) => r.classList.toggle('sel', j === i)); };
        row.onkeydown = e => {
          if (!e.altKey || it.locked || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault(); const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
          if (j < 0 || j >= items.length || items[j].locked) return;
          [items[i], items[j]] = [items[j], items[i]]; sel = j; markDirty(); draw(); check(); $$('.lo-row', list)[j].focus();
        };
        row.addEventListener('dragstart', e => { dragIdx = i; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragend', () => row.classList.remove('drag'));
        row.addEventListener('dragover', e => { if (dragIdx == null || it.locked) return; e.preventDefault(); row.classList.add('over'); });
        row.addEventListener('dragleave', () => row.classList.remove('over'));
        row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('over'); if (dragIdx == null || dragIdx === i || it.locked) return; const [m] = items.splice(dragIdx, 1); items.splice(i, 0, m); dragIdx = null; sel = i; markDirty(); draw(); check(); });
        list.appendChild(row);
      });
    };
    draw(); check();
    $('[data-sort]', c).onclick = async () => { const r = await api('loadorder:sort', ctx.g.id, items); items = r.items; markDirty(); draw(); check(); toast(r.cycles.length ? `Posortowano – uwaga, zależności w pętli: ${r.cycles.join(', ')}` : 'Posortowano. Sprawdź listę i zapisz.', r.cycles.length ? 'warn' : 'ok'); };
    saveB.onclick = async () => { await api('loadorder:save', ctx.g.id, items); dirty = false; saveB.disabled = true; delete App.state.reports[ctx.g.id]; toast('Zapisano kolejność ładowania'); };
    App.leaveGuard = () => !dirty || confirm('Masz niezapisaną kolejność ładowania. Wyjść bez zapisu?');
  };

  // ---------- migawki ----------
  const REASONS = { 'ręczna': 'ręczna', 'przed aktualizacją modów': 'przed aktualizacją', 'przed instalacją moda': 'przed instalacją', 'przed zmianą profilu': 'przed zmianą profilu', 'przed przywróceniem': 'przed przywróceniem', 'przed naprawą': 'przed naprawą', 'przed importem profilu': 'przed importem profilu', 'przed szukaniem winowajcy': 'przed szukaniem winowajcy', 'przed zmianą kolejności': 'przed zmianą kolejności' };
  function backupsList(c, list, { onRestore, onDelete, empty }) {
    if (!list.length) return `<p class="dim" style="font-size:13px">${empty}</p>`;
    return `<div class="backups">${list.map(x => `<div class="bk"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(x.label || new Date(x.createdAt).toLocaleString('pl-PL'))}</div><div class="dim" style="font-size:12px">${x.label ? new Date(x.createdAt).toLocaleString('pl-PL') + ' · ' : ''}${esc(REASONS[x.reason] || x.reason || '')} · ${fmtSize(x.size)}</div></div><button class="btn sm" data-restore="${esc(x.id)}">Przywróć</button><button class="btn sm ghost icon danger" data-del="${esc(x.id)}" title="Usuń">${icon('trash')}</button></div>`).join('')}</div>`;
  }
  mt.snapshotsTab = async (c, ctx) => {
    const list = await api('snapshots:list', ctx.g.id);
    c.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start"><div class="panel"><div class="panel-head"><h2>Migawki modów</h2><button class="btn primary sm" data-new>${icon('archive')}Zrób migawkę teraz</button></div>
      ${backupsList(c, list, { empty: 'Brak migawek. CodeManager robi je automatycznie przed aktualizacją, instalacją, zmianą profilu i naprawami.' })}</div>
      <div class="panel"><h3>Jak to działa</h3><p class="muted" style="font-size:13px">Migawka zapisuje foldery z modami tej gry (i pliki takie jak plugins.txt czy ModsConfig.xml). Przywrócenie przywraca stan sprzed zmiany – a obecny stan zapisuje jako nową migawkę, więc niczego nie stracisz.</p><p class="dim" style="font-size:12.5px">Liczbę migawek i limit rozmiaru zmienisz w Ustawieniach.</p></div></div>`;
    $('[data-new]', c).onclick = async e => { const label = await App.promptBox('Nowa migawka', 'Opis (opcjonalnie)', ''); if (label === null) return; e.target.disabled = true; try { await api('snapshots:create', ctx.g.id, ctx.profileId, label); toast('Zapisano migawkę'); } finally { mt.snapshotsTab(c, ctx); } };
    $$('[data-restore]', c).forEach(b => b.onclick = async () => { if (!(await App.confirmBox('Przywrócić migawkę?', 'Foldery z modami wrócą do stanu z migawki. Obecny stan zostanie zapisany jako nowa migawka. Zamknij grę przed przywróceniem.', 'Przywróć'))) return; await api('snapshots:restore', ctx.g.id, ctx.profileId, b.dataset.restore); delete App.state.reports[ctx.g.id]; toast('Przywrócono migawkę'); mt.snapshotsTab(c, ctx); });
    $$('[data-del]', c).forEach(b => b.onclick = async () => { await api('snapshots:delete', ctx.g.id, b.dataset.del); mt.snapshotsTab(c, ctx); });
  };

  // ---------- zapisy gry ----------
  mt.savesTab = async (c, ctx) => {
    const r = await api('saves:info', ctx.g.id, ctx.profileId);
    c.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start"><div class="panel"><div class="panel-head"><h2>Kopie zapisów gry</h2><button class="btn primary sm" data-new ${r.paths.length ? '' : 'disabled'}>${icon('archive')}Zrób kopię teraz</button></div>
      ${backupsList(c, r.backups, { empty: r.paths.length ? 'Brak kopii zapisów.' : 'Nie znaleziono folderu zapisów tej gry.' })}</div>
      <div class="panel"><h3>Foldery zapisów</h3>${r.paths.length ? r.paths.map(p => `<div class="row" style="gap:6px;margin:6px 0"><span class="path" style="flex:1">${esc(p)}</span><button class="btn sm ghost icon" data-open="${esc(p)}" title="Otwórz">${icon('folder')}</button></div>`).join('') : '<p class="dim" style="font-size:13px">CodeManager nie zna lokalizacji zapisów tej gry albo gra nie zapisała jeszcze stanu.</p>'}
      <p class="dim" style="font-size:12.5px;margin-top:12px">Kopie zapisów są niezależne od modów. Przed przywróceniem zamknij grę – obecne zapisy też trafią do kopii.</p></div></div>`;
    const nb = $('[data-new]', c); if (nb) nb.onclick = async e => { const label = await App.promptBox('Kopia zapisów', 'Opis (opcjonalnie, np. „przed bossem”)', ''); if (label === null) return; e.target.disabled = true; try { await api('saves:backup', ctx.g.id, ctx.profileId, label); toast('Zapisano kopię zapisów'); } finally { mt.savesTab(c, ctx); } };
    $$('[data-open]', c).forEach(b => b.onclick = () => api('shell:open', b.dataset.open));
    $$('[data-restore]', c).forEach(b => b.onclick = async () => { if (!(await App.confirmBox('Przywrócić zapisy?', 'Obecne zapisy zostaną zastąpione kopią (najpierw CodeManager zapisze ich kopię). Zamknij grę.', 'Przywróć'))) return; await api('saves:restore', ctx.g.id, ctx.profileId, b.dataset.restore); toast('Przywrócono zapisy'); mt.savesTab(c, ctx); });
    $$('[data-del]', c).forEach(b => b.onclick = async () => { await api('saves:delete', ctx.g.id, ctx.profileId, b.dataset.del); mt.savesTab(c, ctx); });
  };

  // ---------- brakujące zależności ----------
  const DEP_TYPES = ['modrinth-dep', 'thunderstore', 'loader'];
  mt.depsBanner = (rep, ctx, refresh) => {
    const deps = rep.issues.filter(i => i.action && DEP_TYPES.includes(i.action.type));
    const uniq = []; const seen = new Set(); for (const i of deps) { const k = JSON.stringify(i.action); if (!seen.has(k)) { seen.add(k); uniq.push(i); } }
    if (!uniq.length) return null;
    const el = h(`<div class="note warn deps"><div style="flex:1"><b>Brakujące zależności (${uniq.length}):</b> ${uniq.slice(0, 4).map(i => esc(i.action.label || i.title)).join(', ')}${uniq.length > 4 ? '…' : ''}</div><button class="btn sm primary" data-all>${icon('download')}Zainstaluj brakujące</button></div>`);
    $('[data-all]', el).onclick = async () => {
      await App.runJob('Instalacja brakujących zależności', async jobId => { for (const i of uniq) { try { await window.cm.call('fix:run', jobId, i.action, target(ctx)); } catch { /* zapisane w logu */ } } }, { doneMsg: 'Gotowe. Sprawdzam mody ponownie…' });
      refresh();
    };
    return el;
  };

  // ---------- notatki i tagi ----------
  mt.loadNotes = async gameId => { try { return await App.apiQuiet('notes:get', gameId); } catch { return { notes: {}, tags: [] }; } };
  mt.noteKey = m => String(m.id || window.cm.path.basename(m.file || m.key || m.name || '')).replace(/\.(disabled|old)$/i, '').replace(/^\.+/, '').toLowerCase();
  mt.tagChips = n => (n && n.tags && n.tags.length ? n.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : '') + (n && n.note ? `<span class="tag note" title="${esc(n.note)}">${icon('edit')}</span>` : '');
  mt.editNote = (gameId, m, data, done) => {
    const cur = data.notes[mt.noteKey(m)] || { tags: [], note: '' };
    const sel = new Set(cur.tags);
    const body = h(`<div><div class="field"><label>Tagi</label><div class="tagpick">${data.tags.map(t => `<button class="tag ${sel.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="inline-input" style="margin-top:8px"><input class="input" placeholder="Własny tag…" data-new><button class="btn" data-add>${icon('plus')}</button></div></div>
      <div class="field"><label>Notatka</label><textarea class="input" rows="5" data-note placeholder="Np. „wymaga wersji 1.2 na serwerze”, „psuje zapisy”…">${esc(cur.note || '')}</textarea></div></div>`);
    const pick = $('.tagpick', body);
    pick.onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; const t = b.dataset.t; if (sel.has(t)) sel.delete(t); else sel.add(t); b.classList.toggle('on'); };
    const addT = () => { const v = $('[data-new]', body).value.trim(); if (!v) return; sel.add(v); if (!data.tags.includes(v)) { data.tags.push(v); pick.appendChild(h(`<button class="tag on" data-t="${esc(v)}">${esc(v)}</button>`)); } $('[data-new]', body).value = ''; };
    $('[data-add]', body).onclick = addT; $('[data-new]', body).onkeydown = e => { if (e.key === 'Enter') addT(); };
    modal({ title: `Notatka: ${m.name}`, body, actions: [{ label: 'Anuluj' }, { label: 'Zapisz', primary: true, onClick: async () => { const r = await api('notes:set', gameId, m, { tags: [...sel], note: $('[data-note]', body).value }); if (r) data.notes[mt.noteKey(m)] = r; else delete data.notes[mt.noteKey(m)]; done && done(); } }] });
  };

  // ---------- kosz ----------
  mt.trashModal = async (gameId, after) => {
    const body = h('<div></div>');
    const draw = async () => {
      const list = await api('trash:list', gameId || null);
      const games = Object.fromEntries((App.state.defs ? App.state.defs.games : []).map(g => [g.id, g.name]));
      body.innerHTML = list.length ? `<p class="muted" style="margin-top:0">Usunięte mody są przechowywane przez 30 dni, potem znikają same.</p><div class="backups">${list.map(x => `<div class="bk"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(x.name)}</div><div class="dim" style="font-size:12px">${gameId ? '' : esc(games[x.gameId] || x.gameId || '') + ' · '}usunięto ${App.timeAgo(x.deletedAt)} · ${fmtSize(x.size)} · zniknie ${new Date(x.expiresAt).toLocaleDateString('pl-PL')}</div></div><button class="btn sm" data-r="${x.id}">Przywróć</button><button class="btn sm ghost icon danger" data-d="${x.id}" title="Usuń na zawsze">${icon('trash')}</button></div>`).join('')}</div>` : '<div class="empty" style="padding:30px"><h2>Kosz jest pusty</h2><p>Mody usunięte w CodeManager trafiają tutaj na 30 dni.</p></div>';
      $$('[data-r]', body).forEach(b => b.onclick = async () => { const r = await api('trash:restore', b.dataset.r); toast(`Przywrócono ${window.cm.path.basename(r.restoredTo)}`); draw(); after && after(); });
      $$('[data-d]', body).forEach(b => b.onclick = async () => { await api('trash:delete', b.dataset.d); draw(); });
    };
    await draw();
    modal({ title: gameId ? 'Kosz modów' : 'Kosz CodeManager', wide: true, body, actions: [{ label: 'Opróżnij kosz', danger: true, onClick: async () => { if (!(await App.confirmBox('Opróżnić kosz?', 'Mody zostaną usunięte na zawsze.', 'Opróżnij', true))) return false; await api('trash:empty', gameId || null); await draw(); return false; } }, { label: 'Zamknij' }] });
  };

  // ---------- duplikaty ----------
  mt.dupesModal = async (ctx, refresh) => {
    const groups = await api('mods:dupes', ctx.g.id, ctx.profileId);
    const body = h('<div></div>');
    if (!groups.length) body.innerHTML = '<div class="empty" style="padding:30px"><h2>Nie znaleziono duplikatów</h2><p>Żaden mod nie występuje dwa razy.</p></div>';
    for (const g of groups) {
      const el = h(`<div class="panel" style="margin-bottom:10px"><h3 style="margin-bottom:8px">${esc(g.reason)}</h3>${g.items.map(i => `<div class="bk"><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${esc(i.name)} ${i.file === g.keep || i.name === g.keep ? '<span class="chip ok">najnowszy</span>' : ''}${i.enabled ? '' : ' <span class="chip">wyłączony</span>'}</div><div class="dim mono" style="font-size:11.5px">${esc(i.version || '')} ${esc(i.file ? window.cm.path.basename(i.file) : '')}</div></div>${i.file && i.file !== g.keep && i.toggleable ? `<button class="btn sm danger" data-del="${esc(i.file)}" data-name="${esc(i.name)}">${icon('trash')}Do kosza</button>` : ''}</div>`).join('')}</div>`);
      body.appendChild(el);
    }
    body.onclick = async e => { const b = e.target.closest('[data-del]'); if (!b) return; await api('mods:remove', b.dataset.del, ctx.g.id, b.dataset.name); b.closest('.bk').remove(); toast('Przeniesiono do kosza (30 dni)'); delete App.state.reports[ctx.g.id]; refresh && refresh(); };
    modal({ title: 'Duplikaty modów', wide: true, body });
  };

  // ---------- bisekcja ----------
  mt.bisectBanner = async (c, ctx, refresh) => {
    const s = await App.apiQuiet('bisect:get', ctx.g.id, ctx.profileId).catch(() => null);
    if (!s) return null;
    return bisectPanel(s, ctx, refresh);
  };
  function bisectPanel(s, ctx, refresh) {
    const el = h(`<div class="bisect"></div>`);
    if (s.done) {
      el.innerHTML = `<div class="bisect-h">${icon('ok')}<div style="flex:1"><b>${s.culpritName ? `Winowajca: ${esc(s.culpritName)}` : 'Nie znaleziono winowajcy'}</b><div class="dim" style="font-size:12.5px">${s.culpritName ? `Problem pojawia się tylko z tym modem (sprawdzono w ${s.history.length} rundach). Zaktualizuj go albo zgłoś błąd autorowi.` : 'Problem występował też bez podejrzanych modów – przyczyna jest gdzie indziej (gra, loader, ustawienia).'}</div></div></div>
        <div class="row" style="margin-top:10px">${s.culpritName ? `<button class="btn primary sm" data-fin="off">Przywróć mody, zostaw winowajcę wyłączonego</button>` : ''}<button class="btn sm" data-fin="all">Przywróć wszystkie mody</button></div>`;
    } else {
      el.innerHTML = `<div class="bisect-h">${icon('search')}<div style="flex:1"><b>Szukanie winowajcy – runda ${s.round}</b><div class="dim" style="font-size:12.5px">Podejrzanych: ${s.suspects.length} · zostało ok. ${App.plural(s.roundsLeft, 'runda', 'rundy', 'rund')}. Teraz włączonych z podejrzanych: ${s.on.length}, wyłączonych: ${s.off.length}.</div></div><button class="btn sm ghost" data-list>Lista</button></div>
        <p style="margin:10px 0">Uruchom grę i sprawdź, czy problem nadal występuje.</p>
        <div class="row"><button class="btn danger" data-a="1">${icon('alert')}Problem występuje</button><button class="btn primary" data-a="0">${icon('check')}Działa poprawnie</button><span style="flex:1"></span>${ctx.g.id !== 'minecraft' ? `<button class="btn sm ghost" data-play>${icon('play')}Uruchom grę</button>` : ''}<button class="btn sm ghost" data-fin="all">Przerwij i przywróć</button></div>`;
    }
    el.onclick = async e => {
      const a = e.target.closest('[data-a]'); const f = e.target.closest('[data-fin]');
      if (e.target.closest('[data-play]')) mt.launch(ctx.g, ctx.profileId);
      if (e.target.closest('[data-list]')) modal({ title: 'Bieżąca runda', wide: true, body: `<div class="grid two"><div><h3>Włączone (${s.on.length})</h3><div class="files">${s.on.map(esc).join('<br>')}</div></div><div><h3>Wyłączone (${s.off.length})</h3><div class="files">${s.off.map(esc).join('<br>')}</div></div></div>` });
      if (a) { const r = await api('bisect:answer', ctx.g.id, ctx.profileId, a.dataset.a === '1'); if (r.applied.errors.length) toast(r.applied.errors[0], 'warn'); delete App.state.reports[ctx.g.id]; refresh(); }
      if (f) { await api('bisect:finish', ctx.g.id, ctx.profileId, { keepCulpritOff: f.dataset.fin === 'off' }); delete App.state.reports[ctx.g.id]; toast('Przywrócono mody'); refresh(); }
    };
    return el;
  }
  mt.bisectStart = (ctx, rep, refresh) => {
    const mods = rep.mods.filter(m => m.enabled && m.toggleable);
    if (mods.length < 2) { toast('Potrzeba co najmniej 2 włączonych modów, które można wyłączać.', 'warn'); return; }
    const body = h(`<div><p class="muted" style="margin-top:0">CodeManager wyłączy połowę modów, a Ty sprawdzisz grę. Po każdej odpowiedzi zostaje połowa podejrzanych – przy ${mods.length} modach to ok. ${Math.ceil(Math.log2(mods.length))} uruchomień gry. Na koniec wszystkie mody wrócą do stanu sprzed szukania.</p>
      <p style="margin:0 0 6px;font-weight:600">Zawsze włączone (biblioteki, od których zależą inne mody):</p><div class="files" style="max-height:260px;overflow:auto">${mods.map(m => `<label class="check" style="margin:3px 0"><input type="checkbox" value="${esc(mt.noteKey(m))}" ${/(api|lib|core|library|framework|bepinex|harmony|cloth|architectury|kotlin|forgified)/i.test(m.name + ' ' + (m.id || '')) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div></div>`);
    modal({ title: 'Znajdź winowajcę', wide: true, body, actions: [{ label: 'Anuluj' }, { label: 'Zaczynamy', primary: true, onClick: async () => {
      const keep = $$('input:checked', body).map(i => i.value);
      const r = await api('bisect:start', ctx.g.id, ctx.profileId, keep);
      if (r.applied.errors.length) toast(r.applied.errors[0], 'warn');
      delete App.state.reports[ctx.g.id]; refresh();
    } }] });
  };

  // ---------- udostępnianie profilu ----------
  mt.shareExport = async ctx => {
    const name = await App.promptBox('Udostępnij profil modów', 'Nazwa profilu', `${ctx.g.name}${ctx.prof && ctx.prof.name !== 'Folder gry' ? ' – ' + ctx.prof.name : ''}`); if (name === null) return;
    const r = await api('share:export', ctx.g.id, ctx.profileId, name);
    const body = h(`<div><p class="muted" style="margin-top:0">Wyślij ten kod znajomemu. W CodeManager wybierze „Importuj profil” i dostanie ten sam zestaw modów (${r.profile.mods.length} pozycji). Mody z Modrinth${ctx.g.checker === 'bepinex' ? ', Thunderstore' : ''} i Nexus Mods pobiorą się same.</p><textarea class="input mono" rows="6" readonly data-code>${esc(r.code)}</textarea><p class="dim" style="font-size:12px">${r.code.length.toLocaleString('pl-PL')} znaków</p></div>`);
    modal({ title: 'Kod profilu', wide: true, body, actions: [{ label: 'Zapisz do pliku', icon: 'save', onClick: async () => { const p = await api('share:saveFile', r.code, name); if (p) toast('Zapisano ' + window.cm.path.basename(p)); return false; } }, { label: 'Kopiuj kod', primary: true, icon: 'file', onClick: async () => { await navigator.clipboard.writeText(r.code); toast('Skopiowano kod do schowka'); return false; } }] });
    setTimeout(() => $('[data-code]', body).select(), 50);
  };
  mt.shareImport = (ctx, refresh) => {
    const body = h(`<div><div class="field"><label>Kod profilu (zaczyna się od CM1:)</label><textarea class="input mono" rows="5" data-code placeholder="CM1:…"></textarea></div><button class="btn sm" data-file>${icon('file')}Wczytaj z pliku .cmprofile</button><div data-prev style="margin-top:14px"></div></div>`);
    let ready = null;
    const preview = async () => {
      const v = $('[data-code]', body).value.trim(); const box = $('[data-prev]', body); ready = null;
      if (!v) { box.innerHTML = ''; return; }
      try {
        const p = await App.apiQuiet('share:preview', ctx.g.id, ctx.profileId, v); ready = v;
        box.innerHTML = `<div class="panel"><h3 style="margin-bottom:6px">${esc(p.name)} <span class="dim">· ${p.total} modów${p.mc ? ` · MC ${esc(p.mc.version)} ${esc(p.mc.loader || '')}` : ''}</span></h3><dl class="meta-list"><dt>Bez zmian</dt><dd>${p.same}</dd><dt>Do włączenia/wyłączenia</dt><dd>${p.toggle.length}</dd><dt>Do pobrania</dt><dd>${p.download.length}${p.download.length ? ` (${p.download.filter(d => d.source).length} automatycznie)` : ''}</dd><dt>Masz, a nie ma w profilu</dt><dd>${p.extra.length}</dd></dl>
          ${p.download.length ? `<div class="files" style="margin-top:8px;max-height:140px;overflow:auto">${p.download.map(d => `${esc(d.name)} ${d.version ? esc(d.version) : ''} <span class="dim">– ${esc(d.source || 'ręcznie')}</span>`).join('<br>')}</div>` : ''}
          ${p.extra.length ? `<label class="check" style="margin-top:10px"><input type="checkbox" data-extra><span>Wyłącz moje mody spoza profilu (${p.extra.length})</span></label>` : ''}</div>`;
      } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
    };
    let t; $('[data-code]', body).oninput = () => { clearTimeout(t); t = setTimeout(preview, 300); };
    $('[data-file]', body).onclick = async () => { const f = (await api('dialog:files', 'Plik profilu', [{ name: 'Profil CodeManager', extensions: ['cmprofile', 'json', 'txt'] }]))[0]; if (!f) return; $('[data-code]', body).value = await api('share:readFile', f); preview(); };
    modal({ title: 'Importuj profil modów', wide: true, body, actions: [{ label: 'Anuluj' }, { label: 'Importuj', primary: true, icon: 'import', onClick: () => {
      if (!ready) { toast('Wklej prawidłowy kod profilu', 'warn'); return false; }
      const disableExtra = !!($('[data-extra]', body) || {}).checked; const code = ready;
      setTimeout(async () => {
        const r = await App.runJob('Import profilu', jobId => window.cm.call('share:import', jobId, ctx.g.id, ctx.profileId, code, { disableExtra }), { doneMsg: x => `Zmieniono ${x.toggled}, pobrano ${x.installed.length}${x.manual.length ? `, do pobrania ręcznie: ${x.manual.length}` : ''}.` });
        if (r && r.manual.length) modal({ title: 'Do pobrania ręcznie', body: `<p class="muted" style="margin-top:0">Tych modów nie da się pobrać automatycznie (brak w serwisach albo potrzebne konto Premium):</p><div class="files">${r.manual.map(m => m.url ? `<a href="#" data-url="${esc(m.url)}">${esc(m.name)}</a>` : esc(m.name)).join('<br>')}</div>` });
        $$('[data-url]').forEach(a => a.onclick = e => { e.preventDefault(); api('shell:external', a.dataset.url); });
        delete App.state.reports[ctx.g.id]; refresh();
      }, 0);
    } }] });
  };

  // ---------- porównanie profili ----------
  mt.compareProfiles = async (ctx, rep) => {
    const scope = ctx.profileId || 'game';
    const d = await api('profiles:list', ctx.g.id, scope);
    const cur = { id: '', name: 'Bieżący zestaw', enabled: rep.mods.filter(m => m.enabled && m.toggleable).map(mt.noteKey) };
    const all = [cur, ...d.profiles];
    if (all.length < 2) { toast('Zapisz najpierw profil modów („Nowy z obecnych”), aby było co porównać.', 'warn'); return; }
    const names = Object.fromEntries(rep.mods.map(m => [mt.noteKey(m), m.name]));
    const opt = sel => all.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const body = h(`<div><div class="row" style="margin-bottom:12px"><select class="input" data-a style="flex:1">${opt('')}</select><span class="dim">z</span><select class="input" data-b style="flex:1">${opt(d.profiles[0].id)}</select></div><div data-out></div></div>`);
    const draw = () => {
      const A = all.find(p => p.id === $('[data-a]', body).value), B = all.find(p => p.id === $('[data-b]', body).value);
      const a = new Set(A.enabled), b = new Set(B.enabled);
      const onlyA = [...a].filter(x => !b.has(x)), onlyB = [...b].filter(x => !a.has(x)), both = [...a].filter(x => b.has(x));
      const col = (t, l) => `<div class="panel"><h3 style="margin-bottom:8px">${esc(t)} <span class="dim">(${l.length})</span></h3><div class="files" style="max-height:340px;overflow:auto">${l.map(k => esc(names[k] || k)).sort().join('<br>') || '<span class="dim">—</span>'}</div></div>`;
      $('[data-out]', body).innerHTML = `<div class="grid three">${col('Tylko w „' + A.name + '”', onlyA)}${col('Tylko w „' + B.name + '”', onlyB)}${col('W obu', both)}</div>`;
    };
    $('[data-a]', body).onchange = draw; $('[data-b]', body).onchange = draw; draw();
    modal({ title: 'Porównanie profili', wide: true, body });
  };

  // ---------- ostrzeżenia przed instalacją ----------
  const warnOn = () => App.state.settings.warnBeforeInstall !== false;
  function warnModal(title, html) {
    return new Promise(res => { let ok = false; modal({ title, wide: true, body: html, onClose: () => res(ok), actions: [{ label: 'Anuluj' }, { label: 'Zainstaluj mimo to', primary: true, onClick: () => { ok = true; } }] }); });
  }
  mt.modrinthWarn = async (target, id, title) => {
    if (!warnOn()) return true;
    let r; try { r = await App.apiQuiet('precheck:modrinth', target, id); } catch { return true; }
    const w = r.warnings || []; if (!w.length) return true;
    if (w.every(x => x.level === 'info')) { toast(w.map(x => x.text).join(' ')); return true; }
    return warnModal(`Uwaga przed instalacją: ${title}`, `<div class="issues">${w.map(x => `<div class="issue ${x.level === 'error' ? 'error' : 'info'}">${icon(x.level === 'error' ? 'error' : 'info', 'ic')}<div><div class="t">${esc(x.text)}</div></div></div>`).join('')}</div><p class="dim" style="font-size:12.5px">Ostrzeżenia możesz wyłączyć w Ustawieniach (Mody → Ostrzegaj przed konfliktami).</p>`);
  };
  const overlapHtml = list => `<p class="muted" style="margin-top:0">Te mody mają już pliki w miejscach, do których trafi nowy mod. Po instalacji zostaną nadpisane:</p><div class="issues">${list.map(o => `<div class="issue warn">${icon('alert', 'ic')}<div><div class="t">${o.archive ? esc(o.archive) + ' → ' : ''}${esc(o.mod)} <span class="dim">(${App.plural(o.count, 'plik', 'pliki', 'plików')})</span></div><div class="files">${o.files.map(esc).join('<br>')}</div></div></div>`).join('')}</div>`;
  mt.archiveWarn = async (gameId, files) => {
    if (!warnOn()) return true;
    let r; try { r = await App.apiQuiet('precheck:archives', gameId, files); } catch { return true; }
    return !r.length || warnModal('Mod nadpisze pliki innych modów', overlapHtml(r));
  };
  mt.nexusWarn = async (gameId, modId, fileId) => {
    if (!warnOn()) return true;
    let r; try { r = await App.apiQuiet('precheck:nexus', gameId, modId, fileId); } catch { return true; }
    return !r.length || warnModal('Mod nadpisze pliki innych modów', overlapHtml(r));
  };

  // ---------- polecane mody ----------
  mt.recommendBox = async (res, target, install) => {
    const box = h('<div class="recommend"></div>'); res.parentNode.insertBefore(box, res);
    let list; try { list = await App.apiQuiet('recommend:list', target); } catch { box.remove(); return; }
    if (!list.length || !box.isConnected) { box.remove(); return; }
    box.innerHTML = `<div class="section-title" style="margin-top:0"><h2>Polecane do Twoich modów</h2><span class="dim">na podstawie tego, co masz zainstalowane</span></div><div class="rec-grid"></div>`;
    for (const m of list) {
      const c = h(`<div class="rec">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : `<div class="mcard-ph">${esc(m.title.slice(0, 1))}</div>`}<div style="flex:1;min-width:0"><div class="mcard-t">${esc(m.title)}</div><div class="dim" style="font-size:12px">${esc(m.why)}</div></div><button class="btn sm primary">${icon('download')}</button></div>`);
      $('button', c).title = 'Zainstaluj';
      $('button', c).onclick = async () => { const r = await install(m.id); if (r) c.remove(); };
      c.querySelector('img, .mcard-ph').onclick = () => api('shell:external', m.url);
      $('.rec-grid', box).appendChild(c);
    }
    const old = res.parentNode.querySelectorAll('.recommend'); if (old.length > 1) old[0].remove();
  };

  // ---------- paczki zasobów i shadery (Minecraft) ----------
  mt.packsTab = async (c, ctx) => {
    let d; try { d = await api('mcpacks:list', ctx.profileId); } catch { c.innerHTML = ''; return; }
    c.innerHTML = `<div class="grid two" style="align-items:start">
      <div class="panel"><div class="panel-head"><h2>Paczki zasobów</h2><button class="btn sm" data-add="pack">${icon('plus')}Dodaj</button><button class="btn sm" data-get="resourcepack">${icon('download')}Pobierz</button><button class="btn sm ghost icon" data-open="${esc(d.rpDir)}" title="Otwórz folder">${icon('folder')}</button></div>
        ${d.optionsExists ? '' : '<div class="note warn" style="margin-bottom:10px">Nie ma jeszcze pliku options.txt – uruchom grę raz, żeby włączanie paczek zadziałało.</div>'}
        <div data-packs></div><p class="dim" style="font-size:12px;margin:10px 0 0">Włączone paczki są na górze – wyżej znaczy ważniej. Zamknij grę przed zmianami (gra zapisuje ustawienia przy wyjściu).</p></div>
      <div class="panel"><div class="panel-head"><h2>Shadery</h2><button class="btn sm" data-add="shader">${icon('plus')}Dodaj</button><button class="btn sm" data-get="shader">${icon('download')}Pobierz</button><button class="btn sm ghost icon" data-open="${esc(d.shDir)}" title="Otwórz folder">${icon('folder')}</button></div>
        <p class="dim" style="font-size:12.5px;margin:0 0 10px">${d.shaderEngine === 'iris' ? 'Shadery obsługuje Iris (lub Oculus).' : d.shaderEngine === 'optifine' ? 'Shadery obsługuje OptiFine.' : 'Nie wykryto Iris ani OptiFine – do shaderów zainstaluj Iris (Fabric/NeoForge).'}</p>
        <div data-shaders></div></div></div><div data-get-body style="margin-top:12px"></div>`;
    const packs = $('[data-packs]', c); const sh = $('[data-shaders]', c);
    packs.innerHTML = d.packs.length ? '' : '<p class="dim" style="font-size:13px">Brak paczek zasobów.</p>';
    for (const p of d.packs) {
      const row = h(`<div class="bk ${p.enabled ? '' : 'off'}"><label class="switch sm"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span></span></label><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(p.name.replace(/\.zip$/i, ''))}</div><div class="dim" style="font-size:12px">${esc(p.description || '')}${p.format ? ` · format ${p.format}` : ''}</div></div>
        ${p.enabled ? `<button class="btn sm ghost icon" data-mv="1" title="Wyżej">↑</button><button class="btn sm ghost icon" data-mv="-1" title="Niżej">↓</button>` : ''}<button class="btn sm ghost icon danger" data-del title="Do kosza">${icon('trash')}</button></div>`);
      $('input', row).onchange = async e => { await api('mcpacks:toggle', ctx.profileId, p.name, e.target.checked); mt.packsTab(c, ctx); };
      row.onclick = async e => {
        const mv = e.target.closest('[data-mv]'); if (mv) { await api('mcpacks:move', ctx.profileId, p.name, +mv.dataset.mv); mt.packsTab(c, ctx); }
        if (e.target.closest('[data-del]')) { await api('mcpacks:remove', ctx.profileId, p.path); toast('Przeniesiono do kosza (30 dni)'); mt.packsTab(c, ctx); }
      };
      packs.appendChild(row);
    }
    const none = h(`<label class="bk"><input type="radio" name="shader" ${d.activeShader ? '' : 'checked'}><div style="flex:1">Bez shaderów</div></label>`);
    sh.appendChild(none); none.querySelector('input').onchange = async () => { await api('mcpacks:shader', ctx.profileId, null); toast('Shadery wyłączone'); };
    for (const s2 of d.shaders) {
      const row = h(`<label class="bk"><input type="radio" name="shader" ${s2.active ? 'checked' : ''}><div style="flex:1;min-width:0;font-size:13px;font-weight:600">${esc(s2.name.replace(/\.zip$/i, ''))}</div><button class="btn sm ghost icon danger" data-del title="Do kosza">${icon('trash')}</button></label>`);
      $('input', row).onchange = async () => { await api('mcpacks:shader', ctx.profileId, s2.name); toast(`Aktywny shader: ${s2.name.replace(/\.zip$/i, '')}`); };
      $('[data-del]', row).onclick = async e => { e.preventDefault(); await api('mcpacks:remove', ctx.profileId, s2.path); mt.packsTab(c, ctx); };
      sh.appendChild(row);
    }
    if (!d.shaders.length) sh.appendChild(h('<p class="dim" style="font-size:13px;margin:6px 0 0">Brak shaderów w folderze shaderpacks.</p>'));
    $$('[data-open]', c).forEach(b => b.onclick = async () => { await api('fs:mkdir', b.dataset.open); api('shell:open', b.dataset.open); });
    $$('[data-add]', c).forEach(b => b.onclick = async () => { const f = await api('dialog:files', 'Wybierz paczki (.zip)', [{ name: 'Paczki', extensions: ['zip'] }]); if (!f.length) return; await api('mcpacks:add', ctx.profileId, b.dataset.add === 'shader' ? 'shader' : 'pack', f); mt.packsTab(c, ctx); });
    $$('[data-get]', c).forEach(b => b.onclick = () => {
      const kind = b.dataset.get; const box = $('[data-get-body]', c);
      box.innerHTML = `<div class="panel"><h2 style="margin-bottom:10px">${kind === 'shader' ? 'Shadery' : 'Paczki zasobów'} z Modrinth</h2><div data-mr></div></div>`;
      App.getModrinth($('[data-mr]', box), ctx, { gameId: 'minecraft', profileId: ctx.profileId }, { type: kind, mcVersion: ctx.prof && ctx.prof.mcVersion, installCh: (jobId, id) => window.cm.call('mcpacks:install', jobId, ctx.profileId, kind === 'shader' ? 'shader' : 'pack', id).then(r => { setTimeout(() => mt.packsTab(c, ctx), 300); return r; }) });
      box.scrollIntoView({ behavior: 'smooth' });
    });
  };

  // ---------- pasek narzędzi w zakładce Mody ----------
  mt.toolsRow = (ctx, rep, refresh) => {
    const el = h(`<div class="toolsrow"><span class="dim">${icon('wrench')}Narzędzia</span>
      <button class="btn sm ghost" data-t="dupes">Duplikaty</button>
      <button class="btn sm ghost" data-t="bisect">Znajdź winowajcę</button>
      <button class="btn sm ghost" data-t="share">Udostępnij profil</button>
      <button class="btn sm ghost" data-t="import">Importuj profil</button>
      <button class="btn sm ghost" data-t="compare">Porównaj profile</button>
      <button class="btn sm ghost" data-t="trash">${icon('trash')}Kosz</button></div>`);
    el.onclick = e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      ({ dupes: () => mt.dupesModal(ctx, refresh), bisect: () => mt.bisectStart(ctx, rep, refresh), share: () => mt.shareExport(ctx), import: () => mt.shareImport(ctx, refresh), compare: () => mt.compareProfiles(ctx, rep), trash: () => mt.trashModal(ctx.g.id, refresh) })[b.dataset.t]();
    };
    return el;
  };
})();
