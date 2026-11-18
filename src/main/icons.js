// Ikony gier: pamięć podręczna biblioteki Steam → ikona pliku .exe → grafika ze Steam CDN (zapisywana lokalnie)
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const U = require('./util');
const N = require('./net');

// AppID gier, z których serwery biorą ikonę
const SERVER_APPS = {
  rust: 252490, cs2: 730, dayz: 221100, valheim: 892970, projectzomboid: 108600, tf2: 440, armareforger: 1874880, terraria: 105600,
  unturned: 304930, l4d2: 550, redm: 1174180, fivem: 271590, mta: 12120, beammp: 284160, palworld: 1623730, ark: 2399830, satisfactory: 526870, enshrouded: 1203620, spaceengineers: 244850,
};
const MINECRAFT_EXES = () => [
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
  'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
  path.join(U.localAppData(), 'Programs', 'PrismLauncher', 'prismlauncher.exe'),
  path.join(U.localAppData(), 'Programs', 'Modrinth App', 'Modrinth App.exe'),
  path.join(U.home(), 'AppData', 'Roaming', '.minecraft', 'launcher', 'MinecraftLauncher.exe'),
];

const url = p => pathToFileURL(p).href + '?v=' + Math.floor(fs.statSync(p).mtimeMs);

class Icons {
  constructor({ app, userData, getSteamRoots }) {
    this.app = app; this.getSteamRoots = getSteamRoots;
    this.dir = path.join(userData, 'icons');
    fs.mkdirSync(this.dir, { recursive: true });
    this.indexFile = path.join(this.dir, 'index.json');
    this.index = U.readJSON(this.indexFile, {});
  }
  saveIndex() { U.writeJSON(this.indexFile, this.index); }

  // Pliki z appcache/librarycache (stary i nowy układ Steam)
  steamLocal(appid) {
    const out = {};
    for (const root of this.getSteamRoots()) {
      const lc = path.join(root, 'appcache', 'librarycache');
      const flat = n => { const f = path.join(lc, `${appid}_${n}`); return U.isFile(f) ? f : null; };
      out.icon = out.icon || flat('icon.jpg');
      out.cover = out.cover || flat('library_600x900.jpg');
      out.header = out.header || flat('header.jpg');
      const dir = path.join(lc, String(appid));
      if (U.isDir(dir)) {
        const files = U.walk(dir, { maxDepth: 2, maxFiles: 200 });
        const pick = re => { const f = files.find(x => re.test(path.basename(x))); return f ? path.join(dir, f) : null; };
        out.icon = out.icon || pick(/^[0-9a-f]{40}\.(jpg|png|ico)$/i);
        out.cover = out.cover || pick(/^library_600x900(_2x)?\.jpg$/i);
        out.header = out.header || pick(/^header\.jpg$/i) || pick(/^library_header\.jpg$/i);
      }
    }
    return out;
  }

  async exeIcon(key, exe) {
    if (!exe || !U.isFile(exe)) return null;
    const dest = path.join(this.dir, `exe-${key}.png`);
    if (U.isFile(dest) && fs.statSync(dest).mtimeMs > fs.statSync(exe).mtimeMs) return dest;
    try {
      const img = await this.app.getFileIcon(exe, { size: 'large' });
      if (!img || img.isEmpty()) return null;
      const png = img.toPNG();
      if (png.length < 200) return null; // ikona zastępcza systemu
      fs.writeFileSync(dest, png);
      return dest;
    } catch { return null; }
  }

  async cdn(appid, kind) {
    const key = `cdn-${appid}-${kind}`;
    const cached = this.index[key];
    if (cached && cached.file && U.isFile(cached.file)) return cached.file;
    if (cached && cached.failed && Date.now() - cached.failed < 7 * 86400000) return null;
    const name = kind === 'cover' ? 'library_600x900.jpg' : 'header.jpg';
    const dest = path.join(this.dir, `${appid}-${name}`);
    for (const host of ['https://cdn.cloudflare.steamstatic.com', 'https://steamcdn-a.akamaihd.net']) {
      try {
        await N.download(`${host}/steam/apps/${appid}/${name}`, dest);
        if (fs.statSync(dest).size > 1000) { this.index[key] = { file: dest }; this.saveIndex(); return dest; }
      } catch { /* następny serwer */ }
    }
    this.index[key] = { failed: Date.now() }; this.saveIndex();
    return null;
  }

  findExe(gameDef, gamePath) {
    if (!gamePath) return null;
    for (const e of gameDef.exe || []) { const f = path.join(gamePath, e); if (/\.exe$/i.test(f) && U.isFile(f)) return f; }
    const any = U.listFiles(gamePath, ['.exe']).filter(f => !/(unins|crash|setup|redist|launcherpatcher|vc_?redist|dxsetup|ue4prereq)/i.test(path.basename(f)));
    return any[0] || null;
  }

  // ikona = mała kwadratowa; cover = pionowa okładka; header = szeroki baner
  async forGame(gameDef, info, { online = true } = {}) {
    const res = {};
    if (gameDef.id === 'minecraft') {
      const exe = MINECRAFT_EXES().find(U.isFile);
      const p = exe && await this.exeIcon('minecraft', exe);
      if (p) res.icon = url(p);
      return res;
    }
    const appid = (info && info.appid) || (gameDef.appIds || [])[0];
    const local = appid ? this.steamLocal(appid) : {};
    if (local.icon) res.icon = url(local.icon);
    if (!res.icon && info && info.found) { const p = await this.exeIcon(gameDef.id, this.findExe(gameDef, info.path)); if (p) res.icon = url(p); }
    const header = local.header || (online && appid ? await this.cdn(appid, 'header') : null);
    if (header) res.header = url(header);
    const cover = local.cover || null;
    if (cover) res.cover = url(cover);
    if (!res.icon && cover) res.iconCover = url(cover);
    if (!res.icon && !cover && header) res.iconCover = url(header);
    return res;
  }

  async forServerType(type, gameIcons, { online = true } = {}) {
    if (type === 'minecraft' || type === 'mcproxy') return gameIcons.minecraft || {};
    const appid = SERVER_APPS[type];
    if (!appid) return {};
    const local = this.steamLocal(appid);
    if (local.icon) return { icon: url(local.icon) };
    const cover = local.cover || local.header || (online ? await this.cdn(appid, 'header') : null);
    return cover ? { iconCover: url(cover) } : {};
  }
}

module.exports = { Icons, SERVER_APPS };
