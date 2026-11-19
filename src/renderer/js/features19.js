// Wersja 1.9.0: tunel bez przekierowania portów, hot reload (interfejs serwera)
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast } = App;
  const st = App.st;
  const copy = t => navigator.clipboard.writeText(t).then(() => toast('Skopiowano adres'));

  // ---------- tunel w zakładce Sieć ----------
  const origNet = st.networkTab;
  st.networkTab = async (c, s) => {
    await origNet(c, s);
    const box = h('<div class="panel tunnel-panel" style="margin-top:14px"><div class="progress indet"><i></i></div></div>');
    c.insertBefore(box, c.children[1] || null);
    tunnelPanel(box, s);
  };
  let tunnelBox = null;
  window.cm.on('tunnel:status', d => { if (tunnelBox && tunnelBox.isConnected && tunnelBox._sid === d.id) tunnelPanel(tunnelBox, tunnelBox._srv); });
  window.cm.on('tunnel:claim', d => toast('Zaloguj się na playit.gg w przeglądarce i potwierdź agenta – CodeManager poczeka.', 'ok', 9000) && d);
  async function tunnelPanel(box, s) {
    tunnelBox = box; box._sid = s.id; box._srv = s;
    const [stt, vpn] = await Promise.all([api('tunnel:status'), App.apiQuiet('tunnel:vpn').catch(() => [])]);
    const srv = App.state.servers.find(x => x.id === s.id) || s;
    const running = srv.status === 'running';
    const act = stt.active[s.id];
    const P = stt.providers;
    const ports = await App.apiQuiet('ports:list', s.id).then(r => r.ports).catch(() => null);
    const hasUdp = ports ? ports.some(p => /UDP/i.test(p.proto)) : !['minecraft', 'terraria'].includes(s.type);
    const tcpOnlyOk = ports ? ports.some(p => /TCP/i.test(p.proto)) : true;
    const rec = s.type === 'minecraft' || s.type === 'terraria' || !hasUdp ? 'bore' : 'playit';
    box.innerHTML = `<div class="panel-head"><h2>${icon('globe')}Tunel – bez przekierowania portów</h2>${act ? `<span class="chip ${act.status === 'online' ? 'ok' : act.status === 'error' ? 'error' : 'warn'}">${{ online: 'działa', starting: 'łączenie…', error: 'błąd', stopped: 'zatrzymany' }[act.status] || act.status}</span>` : ''}</div>
      <p class="muted" style="margin-top:0">Znajomi wchodzą na serwer przez publiczny adres tunelu – bez logowania do routera i bez publicznego IP. Ruch idzie przez serwer pośredniczący, więc ping może być nieco wyższy.</p>
      ${act ? `<div class="tun-active">${act.addresses.length ? act.addresses.map(a => `<div class="tun-addr"><span class="dim">${esc(a.label || '')}</span><b class="mono">${esc(a.address)}</b><button class="btn sm" data-cp="${esc(a.address)}">Kopiuj</button></div>`).join('') : `<p class="dim" style="margin:0">${act.status === 'error' ? esc(act.error || 'Tunel nie działa.') : 'Czekam na adres tunelu…'}</p>`}
          ${(act.warnings || []).map(w => `<div class="note warn" style="margin-top:8px">${esc(w)}</div>`).join('')}
          <div class="row" style="margin-top:10px"><button class="btn primary" data-inv>${icon('link')}Zaproś znajomych z tym adresem</button><button class="btn danger" data-stop>${icon('stop')}Zatrzymaj tunel</button></div></div>`
        : `<div class="tun-providers">
          <label class="tun-prov ${rec === 'bore' ? 'rec' : ''}"><input type="radio" name="tp" value="bore" ${rec === 'bore' ? 'checked' : ''} ${tcpOnlyOk ? '' : 'disabled'}><div><b>bore.pub${rec === 'bore' ? ' <span class="chip ok">polecany</span>' : ''}</b><span>Bez konta, działa od razu. Tylko TCP – wystarczy dla Minecrafta Java, Terrarii i paneli WWW.</span><small>${P.bore.installed ? 'zainstalowany' : 'pobierze się przy pierwszym użyciu (≈ 2 MB)'}</small></div></label>
          <label class="tun-prov ${rec === 'playit' ? 'rec' : ''}"><input type="radio" name="tp" value="playit" ${rec === 'playit' ? 'checked' : ''} ${P.playit.supported ? '' : 'disabled'}><div><b>playit.gg${rec === 'playit' ? ' <span class="chip ok">polecany</span>' : ''}</b><span>TCP i UDP – dla gier Steam, FiveM, Valheim, Rust i innych. Darmowe konto, łączone raz przez przeglądarkę.</span><small>${!P.playit.supported ? 'niedostępny na tym systemie' : P.playit.linked ? 'konto połączone · <a href="#" data-unlink>rozłącz</a>' : P.playit.installed ? 'zainstalowany, konto niepołączone' : 'pobierze się przy pierwszym użyciu (≈ 6 MB)'}</small></div></label></div>
          ${hasUdp ? '<p class="dim" style="font-size:12.5px;margin:8px 0 0">Ten serwer używa portów UDP – przez bore przejdzie tylko TCP.</p>' : ''}
          <div class="row" style="margin-top:12px"><button class="btn primary" data-start ${running ? '' : 'disabled'}>${icon('play')}Uruchom tunel</button>${running ? '' : '<span class="dim">Najpierw uruchom serwer.</span>'}<span class="grow"></span><span class="dim" style="font-size:12px">Po włączeniu tunel startuje razem z serwerem.</span></div>`}
      ${vpn.length ? `<div class="tun-vpn">${icon('shield')}<span>${vpn.map(v => `${esc(v.name)}: <b class="mono">${esc(v.ip)}${s.port ? ':' + s.port : ''}</b>`).join(' · ')} <span class="dim">– adres dla znajomych w tej samej sieci ${vpn.map(v => esc(v.name)).join('/')}</span></span></div>` : ''}`;
    $$('[data-cp]', box).forEach(b => b.onclick = () => copy(b.dataset.cp));
    const stop = $('[data-stop]', box); if (stop) stop.onclick = async () => { await api('tunnel:stop', s.id); tunnelPanel(box, s); };
    const inv = $('[data-inv]', box); if (inv) inv.onclick = () => App.inviteCreate({ server: s, noMods: !['fivem', 'redm', 'mta', 'minecraft'].includes(s.type), address: act.addresses[0] && act.addresses[0].address });
    const un = $('[data-unlink]', box); if (un) un.onclick = async e => { e.preventDefault(); await api('tunnel:unlink'); tunnelPanel(box, s); };
    const start = $('[data-start]', box);
    if (start) start.onclick = async () => {
      const prov = ($('input[name=tp]:checked', box) || {}).value; if (!prov) return;
      const fresh = await api('tunnel:status');
      if (!fresh.providers[prov].installed) { const ok = await App.runJob(`Pobieranie ${prov === 'bore' ? 'bore' : 'playit.gg'}`, jobId => window.cm.call('tunnel:install', jobId, prov), { doneMsg: 'Zainstalowano.' }); if (ok === null) return; document.querySelectorAll('.modal-back').forEach(x => x.remove()); }
      if (prov === 'playit' && !(await api('tunnel:status')).providers.playit.linked) {
        start.disabled = true; start.textContent = 'Czekam na potwierdzenie w przeglądarce…';
        try { await window.cm.call('tunnel:link'); toast('Połączono konto playit.gg'); } catch (e) { toast(e.message, 'error', 9000); tunnelPanel(box, s); return; }
      }
      try { await window.cm.call('tunnel:start', s.id, prov); } catch (e) { toast(e.message, 'error', 9000); }
      tunnelPanel(box, s);
    };
  }

  // ---------- hot reload w ustawieniach serwera ----------
  const HR_INFO = {
    fivem: 'Zapis pliku w resources/… → ensure nazwa_zasobu', redm: 'Zapis pliku w resources/… → ensure nazwa_zasobu', mta: 'Zapis pliku zasobu → restart nazwa_zasobu',
    minecraft: 'Paczki danych → /reload; nowy .jar pluginu → plugman reload (wymaga PlugManX)', cs2: 'SourceMod: .smx → sm plugins reload; CounterStrikeSharp przeładowuje się sam',
    tf2: 'SourceMod: .smx → sm plugins reload', l4d2: 'SourceMod: .smx → sm plugins reload', rust: 'Oxide/Carbon przeładowują pluginy .cs same; zmiana configu → oxide.reload', beammp: 'BeamMP przeładowuje pluginy Lua sam',
  };
  st.extraSettings = (c, s) => {
    const info = HR_INFO[s.type]; if (!info) return;
    const box = h(`<div class="panel" style="margin-top:12px;max-width:760px"><h2 style="margin-bottom:8px">${icon('bolt')}Gorące przeładowanie skryptów</h2>
      <label class="check"><input type="checkbox" data-hr ${s.hotReload !== false ? 'checked' : ''}><span>Po zapisaniu pliku przeładuj go na działającym serwerze (bez restartu)</span></label>
      <p class="dim" style="font-size:12.5px;margin:8px 0 0">${esc(info)}. Działa przy zapisie w edytorze CodeManager i przy zmianie pliku innym programem.</p></div>`);
    $('[data-hr]', box).onchange = async e => { s.hotReload = await api('servers:hotReload', s.id, e.target.checked); toast(s.hotReload ? 'Gorące przeładowanie włączone' : 'Gorące przeładowanie wyłączone'); };
    c.appendChild(box);
  };
  window.cm.on('hotreload', d => toast(d.cmd ? `${d.server}: przeładowano ${d.label || ''} (${d.cmd})` : `${d.server}: ${d.note}`, d.cmd ? 'ok' : 'warn', d.cmd ? 3500 : 7000));
})();
