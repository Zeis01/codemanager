// Gorące przeładowanie: po zapisaniu skryptu CodeManager wysyła do działającego serwera polecenie,
// które wczytuje zmieniony zasób/plugin bez restartu całego serwera.
'use strict';
const fs = require('fs');
const path = require('path');

const parts = (root, file) => path.relative(root, file).split(/[\\/]+/);
const inside = (root, file) => { const r = path.relative(root, file); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

/**
 * Ustala polecenie dla zmienionego pliku. Zwraca { cmd, label } albo { note } (gra przeładowuje sama) albo null.
 * s: serwer { type, variant, path }
 */
function commandFor(s, file) {
  if (!s || !s.path || !inside(s.path, file)) return null;
  const p = parts(s.path, file); const low = p.map(x => x.toLowerCase());
  const base = low[low.length - 1]; const ext = path.extname(base);
  switch (s.type) {
    case 'fivem': case 'redm': {
      // resources/[kategoria]/nazwa/... – zasób to pierwszy folder, który nie jest w nawiasach kwadratowych
      const ri = low.indexOf('resources'); if (ri < 0) return null;
      if (!/\.(lua|js|json|html|css|cfg|ts|yml|ttf|png|ogg)$/i.test(ext) && base !== 'fxmanifest.lua' && base !== '__resource.lua') return null;
      const res = p.slice(ri + 1, -1).find(x => !/^\[.*\]$/.test(x));
      if (!res) return null;
      return { cmd: `ensure ${res}`, label: `zasób ${res}` };
    }
    case 'mta': {
      const ri = low.indexOf('resources'); if (ri < 0) return null;
      const res = p.slice(ri + 1, -1).find(x => !/^\[.*\]$/.test(x)); if (!res) return null;
      if (!/\.(lua|xml|txt|dff|txd|col|png)$/i.test(ext)) return null;
      return { cmd: `restart ${res}`, label: `zasób ${res}` };
    }
    case 'minecraft': {
      if (low.includes('datapacks')) return { cmd: 'reload', label: 'paczki danych (datapacks)' };
      if (low[0] === 'plugins' && low.length === 2 && ext === '.jar') {
        const name = path.basename(p[1], '.jar').replace(/[-_ ]?v?\d[\w.+-]*$/, '');
        return { cmd: `plugman reload ${name}`, label: `plugin ${name}`, note: 'Paper/Spigot nie przeładowuje pluginów bezpiecznie – potrzebny jest plugin PlugManX. Bez niego zrestartuj serwer.' };
      }
      if (low[0] === 'plugins' && low.length >= 3 && /\.(yml|yaml|json|txt|properties)$/i.test(ext)) return { note: `Zmieniono konfigurację pluginu ${p[1]} – większość pluginów ma własne polecenie przeładowania (np. /${p[1].toLowerCase()} reload).` };
      return null;
    }
    case 'cs2': case 'counterstrikesharp': {
      // CounterStrikeSharp przeładowuje pluginy sam po podmianie .dll (hot reload)
      if (low.includes('counterstrikesharp') && low.includes('plugins') && ext === '.dll') return { note: 'CounterStrikeSharp sam przeładuje plugin po podmianie pliku .dll.' };
      if (ext === '.smx' && low.includes('plugins')) return { cmd: `sm plugins reload ${path.basename(p[p.length - 1], '.smx')}`, label: 'plugin SourceMod' };
      return null;
    }
    case 'tf2': case 'sourcemod': case 'garrysmod': case 'l4d2': {
      if (ext === '.smx' && low.includes('plugins')) return { cmd: `sm plugins reload ${path.basename(p[p.length - 1], '.smx')}`, label: 'plugin SourceMod' };
      if (ext === '.lua' && (low.includes('lua') || low.includes('addons') || low.includes('gamemodes'))) return { note: "Garry's Mod sam przeładowuje zmienione pliki Lua (auto-refresh)." };
      return null;
    }
    case 'rust': case 'oxide': case 'carbon': {
      if (ext === '.cs' && low.includes('plugins')) return { note: 'Oxide/Carbon same przeładowują plugin po zapisaniu pliku .cs.' };
      if (ext === '.json' && low.includes('config')) { const name = path.basename(p[p.length - 1], '.json'); return { cmd: `oxide.reload ${name}`, label: `plugin ${name}` }; }
      return null;
    }
    case 'beammp': {
      if (ext === '.lua' && low.includes('resources') && low.includes('server')) return { note: 'Serwer BeamMP sam przeładowuje pluginy Lua po zapisaniu (HotReload).' };
      return null;
    }
    case 'terraria': return null;
    default: return null;
  }
}

// obserwacja folderów działających serwerów (zmiany z zewnątrz, np. zbudowany .jar albo .smx)
class HotReloader {
  constructor({ servers, getServer, isRunning, send, log = () => {}, emit = () => {}, enabled = () => true, debounce = 700, watchImpl = fs.watch }) {
    Object.assign(this, { servers, getServer, isRunning, send, log, emit, enabled, debounce, watchImpl });
    this.watchers = new Map(); this.timers = new Map(); this.recent = new Map();
  }
  // wywoływane po zapisaniu pliku w edytorze i przez obserwatora
  changed(file, { source = 'edytor' } = {}) {
    for (const s of this.servers()) {
      if (!this.isRunning(s.id) || !this.enabled(s)) continue;
      const r = commandFor(s, file); if (!r) continue;
      const key = s.id + '|' + (r.cmd || r.note);
      clearTimeout(this.timers.get(key));
      this.timers.set(key, setTimeout(() => {
        this.timers.delete(key);
        const last = this.recent.get(key) || 0; if (Date.now() - last < 1500) return; this.recent.set(key, Date.now());
        if (r.cmd) { this.log(s.id, `[hot reload] ${path.basename(file)} (${source}) → ${r.cmd}`); try { this.send(s.id, r.cmd); } catch (e) { this.log(s.id, '✖ ' + e.message); } }
        this.emit('hotreload', { id: s.id, server: s.name, file, cmd: r.cmd || null, label: r.label || null, note: r.note || null });
      }, this.debounce));
    }
  }
  watch(id) {
    if (this.watchers.has(id)) return;
    const s = this.getServer(id); if (!s || !s.path || !this.enabled(s)) return;
    try {
      const w = this.watchImpl(s.path, { recursive: true }, (_ev, name) => { if (name && !/(^|[\\/])(logs?|cache|crash-reports|world[^\\/]*|backups?)([\\/]|$)/i.test(name)) this.changed(path.join(s.path, name), { source: 'plik' }); });
      w.on && w.on('error', () => this.unwatch(id));
      this.watchers.set(id, w);
    } catch { /* system bez obserwacji rekurencyjnej */ }
  }
  unwatch(id) { const w = this.watchers.get(id); if (w) { try { w.close(); } catch { /* */ } this.watchers.delete(id); } }
  closeAll() { for (const id of [...this.watchers.keys()]) this.unwatch(id); }
}

module.exports = { commandFor, HotReloader };
