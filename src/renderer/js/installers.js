// Instalatory modloaderów i plików serwerowych
'use strict';
App.views = App.views || {};
App.views.installers = {
  async render(el) {
    const { h, $, icon, esc, api, toast } = App;
    const loaders = await api('loaders:list');
    const types = await api('servers:types');
    const det = App.state.detected;
    const defs = App.state.defs.games;
    el.innerHTML = `<div class="head"><div class="grow"><h1>Instalatory</h1><p class="lead">Modloadery dla gier i pliki serwerów. Wszystko pobierane jest z oficjalnych źródeł (GitHub, API Fabric/Forge/NeoForge/Quilt, SteamCMD); nadpisane pliki trafiają do kopii zapasowej.</p></div></div>
      <h2 style="margin-bottom:12px">Modloadery</h2><div class="grid three" data-l></div>
      <div class="section-title"><h2>Pliki serwerów</h2><span class="dim">Instalacja tworzy serwer w zakładce Serwery</span></div><div class="grid three" data-s></div>`;
    const lw = $('[data-l]', el);
    for (const l of loaders) {
      const targets = l.games.map(id => defs.find(g => g.id === id)).filter(Boolean);
      const options = [];
      for (const g of targets) {
        const info = det && det.games[g.id];
        if (!info || !info.found) continue;
        if (g.id === 'minecraft') info.instances.forEach(i => options.push({ label: `${i.name}`, root: i.path, mc: i.mcVersion }));
        else options.push({ label: g.name, root: info.path });
      }
      const card = h(`<div class="loader-card">
        <h2>${esc(l.name)}</h2>
        <div class="for">${targets.map(g => `<span class="chip">${esc(g.name)}</span>`).join('')}</div>
        <p>${esc(l.desc)}</p>
        ${l.kind !== 'link' ? `<select class="input" data-t>${options.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join('')}<option value="custom">Inny folder…</option></select>` : ''}
        ${l.kind === 'minecraft' ? `<input class="input" data-mc placeholder="Wersja Minecraft, np. 1.21.1" value="${esc((options[0] && options[0].mc) || '')}">` : ''}
        <button class="btn ${l.kind === 'link' ? '' : 'primary'}" data-go>${icon(l.kind === 'link' ? 'link' : 'download')}${l.kind === 'link' ? 'Otwórz' : 'Zainstaluj'}</button></div>`);
      const sel = $('[data-t]', card);
      if (sel) sel.onchange = () => { const o = options[sel.value]; const mc = $('[data-mc]', card); if (o && mc && o.mc) mc.value = o.mc; };
      $('[data-go]', card).onclick = async () => {
        if (l.kind === 'link') return api('shell:external', l.url);
        let root;
        if (!sel || sel.value === 'custom') root = await api('dialog:folder', `Folder docelowy dla ${l.name}`);
        else root = options[sel.value] && options[sel.value].root;
        if (!root) return;
        App.installLoader(l, { root, mcVersion: $('[data-mc]', card) ? $('[data-mc]', card).value.trim() : null }, () => {});
      };
      lw.appendChild(card);
    }
    const SHORT = App.SRV_SHORT || {};
    const SRC = { minecraft: 'Mojang / PaperMC / Purpur / Fabric / Forge / NeoForge / Quilt', terraria: 'GitHub: Pryaxis/TShock', fivem: 'Artefakty FXServer + cfx-server-data', mta: 'Instalacja MTA:SA (Windows) / linux.multitheftauto.com', beammp: 'GitHub: BeamMP/BeamMP-Server', mcproxy: 'PaperMC (Velocity) / md-5 CI (BungeeCord)', ark: 'SteamCMD: ASA 2430930 / ASE 376030' };
    const sw = $('[data-s]', el);
    for (const t of types) {
      const card = h(`<div class="loader-card"><div class="row">${App.gameBadge({ color: t.color, short: SHORT[t.id], name: t.name }, 34)}<h2 style="flex:1">${esc(t.name)}</h2></div>
        <p>${esc(t.steamApp ? `SteamCMD, aplikacja ${t.steamApp}${t.needsLogin ? ' (wymaga konta z grą)' : ' (anonimowo)'}` : SRC[t.id] || '')}${t.frameworks.length ? `. Frameworki: ${t.frameworks.map(f => f.name).join(', ')}.` : ''}</p>
        <button class="btn">${icon('server')}Utwórz serwer</button></div>`);
      $('button', card).onclick = () => { App.go('servers'); setTimeout(() => { const b = document.querySelector('[data-new]'); if (b) { b.click(); setTimeout(() => { const o = document.querySelector(`.type-opt[data-t="${t.id}"]`); if (o) o.click(); }, 60); } }, 120); };
      sw.appendChild(card);
    }
  },
};
