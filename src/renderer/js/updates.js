// Aktualizacje modów we wszystkich grach i serwerach naraz
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast } = App;
  let last = null; // wynik ostatniego sprawdzenia (do końca sesji)

  async function render(el) {
    const targets = await api('updates:targets');
    el.innerHTML = `<div class="head"><div class="grow"><h1>Aktualizacje modów</h1><p class="lead">Sprawdza naraz wszystkie gry i serwery z modami z Modrinth, Thunderstore, portalu Factorio i Nexus Mods. Przed aktualizacją gry CodeManager robi migawkę, a stare wersje trafiają do kopii.</p></div>
      <div class="row"><button class="btn" data-check>${icon('refresh')}Sprawdź wszystkie</button><button class="btn primary" data-apply disabled>${icon('update')}Zaktualizuj zaznaczone</button></div></div><div data-body></div>`;
    const body = $('[data-body]', el); const apply = $('[data-apply]', el);
    const draw = () => {
      if (!targets.length) { body.innerHTML = '<div class="empty"><h2>Brak gier i serwerów z aktualizacjami</h2><p>Obsługiwane: Minecraft (Modrinth), gry z BepInEx (Thunderstore), Factorio, gry z Nexus Mods (po połączeniu konta) oraz serwery Minecraft z modami/pluginami i Valheim.</p></div>'; return; }
      const res = last ? new Map(last.map(r => [r.key, r])) : new Map();
      body.innerHTML = `<div class="panel flush"><table class="table"><thead><tr><th style="width:44px"></th><th>Gra / serwer</th><th>Serwis</th><th>Aktualizacje</th><th></th></tr></thead><tbody></tbody></table></div>
        ${last ? `<p class="dim" style="font-size:12.5px;margin-top:8px">Sprawdzono ${new Date(last.at || Date.now()).toLocaleTimeString('pl-PL')}. Nexus Mods pokazuje tylko dostępne wersje – pobierasz je z zakładki gry (konto Premium) lub przyciskiem na stronie moda.</p>` : '<p class="dim" style="font-size:12.5px;margin-top:8px">Kliknij „Sprawdź wszystkie”, aby zobaczyć dostępne aktualizacje.</p>'}`;
      const tb = $('tbody', body);
      for (const t of targets) {
        const r = res.get(t.key);
        const n = r ? r.available.length : null;
        const can = r && !r.error && n > 0 && !r.manual;
        const tr = h(`<tr><td>${can ? `<input type="checkbox" data-k="${esc(t.key)}" checked>` : ''}</td><td class="nm">${esc(t.name)}</td><td class="muted">${esc(t.service)}</td>
          <td>${!r ? '<span class="dim">–</span>' : r.error ? `<span class="chip error" title="${esc(r.error)}">błąd</span> <span class="dim" style="font-size:12px">${esc(r.error.slice(0, 80))}</span>` : n ? `<span class="chip warn">${App.plural(n, 'aktualizacja', 'aktualizacje', 'aktualizacji')}</span>` : '<span class="chip ok">wszystko aktualne</span>'}${r && r.locked ? ` <span class="dim" style="font-size:12px">(zablokowane: ${r.locked})</span>` : ''}</td>
          <td style="text-align:right">${n ? `<button class="btn sm ghost" data-show>Pokaż</button>` : ''}</td></tr>`);
        const sb = $('[data-show]', tr);
        if (sb) sb.onclick = () => App.modal({ title: t.name, wide: true, body: `<div class="files" style="max-height:420px;overflow:auto">${r.available.map(a => a.url ? `<a href="#" data-url="${esc(a.url)}">${esc(a.name)}</a>` : `${esc(a.name)}${a.from ? ` <span class="dim">${esc(a.from)} → ${esc(a.to)}</span>` : ''}`).join('<br>')}</div>` }) && setTimeout(() => $$('[data-url]').forEach(a => a.onclick = e => { e.preventDefault(); api('shell:external', a.dataset.url); }), 0);
        tb.appendChild(tr);
      }
      const sync = () => { apply.disabled = !$$('[data-k]:checked', body).length; };
      $$('[data-k]', body).forEach(c => c.onchange = sync); sync();
    };
    draw();
    $('[data-check]', el).onclick = async () => {
      const r = await App.runJob('Sprawdzanie aktualizacji', jobId => window.cm.call('updates:checkAll', jobId), { doneMsg: x => { const n = x.reduce((a, y) => a + y.available.length, 0); return n ? `Znaleziono ${App.plural(n, 'aktualizację', 'aktualizacje', 'aktualizacji')}.` : 'Wszystkie mody są aktualne.'; } });
      if (r) { last = r; last.at = Date.now(); App.state.modUpdates = r.reduce((a, y) => a + (y.manual ? 0 : y.available.length), 0); App.renderRail(); draw(); }
    };
    apply.onclick = async () => {
      const keys = $$('[data-k]:checked', body).map(c => c.dataset.k);
      const r = await App.runJob('Aktualizacja modów', jobId => window.cm.call('updates:applyAll', jobId, keys), { doneMsg: x => `Zaktualizowano ${x.reduce((a, y) => a + (y.updated || 0), 0)} modów${x.some(y => y.error) ? `, błędy: ${x.filter(y => y.error).length}` : ''}.` });
      if (r) { App.state.reports = {}; last = (last || []).map(y => (keys.includes(y.key) ? { ...y, available: [], upToDate: (y.upToDate || 0) + y.available.length } : y)); App.state.modUpdates = 0; App.renderRail(); draw(); }
    };
  }
  App.views.updates = { crumb: () => '<b>Aktualizacje modów</b>', render };
})();
