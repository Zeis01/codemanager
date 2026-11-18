// Kreator botów Discord: komendy (/slash i z prefiksem), zdarzenia i akcje – jak w Discord Bot Maker.
// Boty działają w CodeManagerze i mogą sterować serwerami gier (start, stop, polecenia, status).
'use strict';
const crypto = require('crypto');
const { DiscordClient, INTENTS, PERMS } = require('./discord');

const OPTION_TYPES = { string: 3, integer: 4, boolean: 5, user: 6, channel: 7, role: 8, number: 10 };
const EVENTS = {
  ready: 'Bot uruchomiony', memberJoin: 'Ktoś dołączył do serwera Discord', memberLeave: 'Ktoś opuścił serwer Discord', message: 'Nowa wiadomość (zawiera tekst)',
  'cm:serverStart': 'Serwer gry uruchomiony', 'cm:serverStop': 'Serwer gry zatrzymany', 'cm:serverCrash': 'Serwer gry się wyłączył (crash)', 'cm:playerJoin': 'Gracz wszedł na serwer gry', 'cm:playerLeave': 'Gracz wyszedł z serwera gry', 'cm:backup': 'Kopia zapasowa serwera gry',
};
const ACTIONS = {
  reply: 'Odpowiedz', send: 'Wyślij na kanał', embed: 'Wyślij ramkę (embed)', dm: 'Wyślij prywatną wiadomość', randomReply: 'Losowa odpowiedź', react: 'Dodaj reakcję', deleteMessage: 'Usuń wiadomość',
  addRole: 'Nadaj rolę', removeRole: 'Odbierz rolę', kick: 'Wyrzuć z serwera', ban: 'Zbanuj', timeout: 'Wycisz (timeout)',
  setVar: 'Ustaw zmienną', incVar: 'Zwiększ zmienną', condition: 'Warunek (jeżeli…)', wait: 'Czekaj',
  cmServer: 'Serwer gry: start / stop / restart / polecenie / kopia', cmStatus: 'Status serwerów gry', httpRequest: 'Zapytanie HTTP', log: 'Zapisz w logu',
};

// ---------- szablony tekstu: {user}, {option:nazwa}, {var:x}, {random:1-6}… ----------
function render(tpl, ctx) {
  return String(tpl == null ? '' : tpl).replace(/\{([\w.:-]+)\}/g, (all, key) => {
    const [k, arg] = key.split(/:(.*)/s);
    switch (k) {
      case 'user': return ctx.user ? `<@${ctx.user.id}>` : '';
      case 'user.name': return ctx.user ? (ctx.user.global_name || ctx.user.username) : '';
      case 'user.id': return ctx.user ? ctx.user.id : '';
      case 'user.avatar': return ctx.user && ctx.user.avatar ? `https://cdn.discordapp.com/avatars/${ctx.user.id}/${ctx.user.avatar}.png` : '';
      case 'channel': return ctx.channelId ? `<#${ctx.channelId}>` : '';
      case 'server.name': return ctx.guildName || '';
      case 'member.count': return ctx.memberCount != null ? String(ctx.memberCount) : '';
      case 'option': { const v = (ctx.options || {})[arg]; if (v == null) return ''; return ctx.optionTypes && ctx.optionTypes[arg] === 'user' ? `<@${v}>` : String(v); }
      case 'args': return (ctx.args || []).join(' ');
      case 'arg': return (ctx.args || [])[(+arg || 1) - 1] || '';
      case 'message': return ctx.content || '';
      case 'var': return ctx.vars && ctx.vars[arg] != null ? String(ctx.vars[arg]) : '0';
      case 'random': { const m = String(arg || '1-100').match(/^(-?\d+)-(-?\d+)$/); if (!m) return ''; const a = +m[1], b = +m[2]; return String(a + Math.floor(Math.random() * (b - a + 1))); }
      case 'time': return new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      case 'date': return new Date().toLocaleDateString('pl-PL');
      case 'game.server': return ctx.cm && ctx.cm.server ? ctx.cm.server.name : '';
      case 'game.player': return ctx.cm && ctx.cm.player ? ctx.cm.player : '';
      case 'game.players': return ctx.cm && ctx.cm.count != null ? String(ctx.cm.count) : '';
      case 'result': return ctx.result != null ? String(ctx.result) : '';
      default: return all;
    }
  });
}
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const colorInt = c => { const m = String(c || '').match(/^#?([0-9a-f]{6})$/i); return m ? parseInt(m[1], 16) : 0x2f9e5b; };

class Bot {
  constructor(def, { log, cm, saveVars }) {
    this.def = def; this.log = (m) => log(def.id, m); this.cm = cm || {}; this.saveVars = saveVars || (() => {});
    this.client = null; this.status = 'offline'; this.guildCache = new Map();
  }
  intents() {
    let i = INTENTS.GUILDS;
    const ev = (this.def.events || []).map(e => e.event);
    if (ev.includes('memberJoin') || ev.includes('memberLeave')) i |= INTENTS.GUILD_MEMBERS;
    if ((this.def.commands || []).some(c => c.type === 'prefix') || ev.includes('message')) i |= INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT;
    return i;
  }
  async start(token, ClientImpl = DiscordClient) {
    if (!token) throw new Error('Podaj token bota (Discord Developer Portal → Bot → Reset Token).');
    this.client = new ClientImpl({ token, intents: this.intents(), log: m => this.log(m) });
    this.status = 'connecting';
    this.client.on('READY', d => { this.status = 'online'; this.log(`✔ Zalogowano jako ${d.user.username}`); this.registerCommands().catch(e => this.log('⚠ Rejestracja komend: ' + e.message)); this.trigger('ready', { user: d.user }); });
    this.client.on('INTERACTION_CREATE', d => this.onInteraction(d).catch(e => this.log('✖ ' + e.message)));
    this.client.on('MESSAGE_CREATE', d => this.onMessage(d).catch(e => this.log('✖ ' + e.message)));
    this.client.on('GUILD_MEMBER_ADD', d => this.trigger('memberJoin', { guildId: d.guild_id, user: d.user }));
    this.client.on('GUILD_MEMBER_REMOVE', d => this.trigger('memberLeave', { guildId: d.guild_id, user: d.user }));
    this.client.on('GUILD_CREATE', d => this.guildCache.set(d.id, { name: d.name, owner: d.owner_id, roles: d.roles, memberCount: d.member_count, t: Date.now() }));
    this.client.on('fatal', m => { this.status = 'error'; this.error = m; this.log('✖ ' + m); });
    this.client.connect();
  }
  stop() { if (this.client) this.client.close(); this.client = null; this.status = 'offline'; }
  async registerCommands() {
    const slash = (this.def.commands || []).filter(c => c.type !== 'prefix' && c.name);
    const body = slash.map(c => ({
      name: c.name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32), description: clip(c.description || c.name, 100), type: 1,
      options: (c.options || []).filter(o => o.name).map(o => ({ type: OPTION_TYPES[o.type] || 3, name: o.name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32), description: clip(o.description || o.name, 100), required: !!o.required })),
      default_member_permissions: c.permission === 'admin' ? String(PERMS.MANAGE_GUILD) : undefined,
    }));
    const appId = this.client.appId; if (!appId) return;
    const route = this.def.guildId ? `/applications/${appId}/guilds/${this.def.guildId}/commands` : `/applications/${appId}/commands`;
    await this.client.rest('PUT', route, body);
    this.log(`Zarejestrowano ${body.length} komend /${this.def.guildId ? ' (na wybranym serwerze – od razu)' : ' (globalnie – mogą pojawić się z opóźnieniem do godziny)'}`);
  }
  async guild(id) {
    if (!id) return null;
    const c = this.guildCache.get(id);
    if (c && Date.now() - c.t < 300000 && c.roles) return c;
    const [g, roles] = await Promise.all([this.client.rest('GET', `/guilds/${id}`, undefined, { query: { with_counts: 'true' } }), this.client.rest('GET', `/guilds/${id}/roles`)]);
    const v = { name: g.name, owner: g.owner_id, roles, memberCount: g.approximate_member_count, t: Date.now() };
    this.guildCache.set(id, v); return v;
  }
  async isAdmin(ctx) {
    if (ctx.permissions != null) { const p = BigInt(ctx.permissions); return (p & PERMS.ADMINISTRATOR) === PERMS.ADMINISTRATOR || (p & PERMS.MANAGE_GUILD) === PERMS.MANAGE_GUILD; }
    const g = await this.guild(ctx.guildId).catch(() => null); if (!g) return false;
    if (g.owner === (ctx.user && ctx.user.id)) return true;
    let p = 0n; for (const r of g.roles || []) if (r.id === ctx.guildId || (ctx.roles || []).includes(r.id)) p |= BigInt(r.permissions);
    return (p & PERMS.ADMINISTRATOR) === PERMS.ADMINISTRATOR || (p & PERMS.MANAGE_GUILD) === PERMS.MANAGE_GUILD;
  }
  async allowed(cmd, ctx) {
    if (!cmd.permission || cmd.permission === 'everyone') return true;
    if (cmd.permission === 'admin') return this.isAdmin(ctx);
    return (ctx.roles || []).includes(cmd.permission) || this.isAdmin(ctx);
  }
  async onInteraction(d) {
    if (d.type !== 2) return; // komenda aplikacji
    const name = d.data.name;
    const cmd = (this.def.commands || []).find(c => c.type !== 'prefix' && c.name.toLowerCase().replace(/[^a-z0-9_-]/g, '') === name);
    if (!cmd) return;
    const user = d.member ? d.member.user : d.user;
    const options = {}; const optionTypes = {};
    for (const o of d.data.options || []) { options[o.name] = o.value; const def = (cmd.options || []).find(x => x.name.toLowerCase() === o.name); if (def) optionTypes[o.name] = def.type; }
    const ctx = { kind: 'interaction', interaction: d, guildId: d.guild_id, channelId: d.channel_id, user, roles: d.member ? d.member.roles : [], permissions: d.member ? d.member.permissions : null, options, optionTypes, replied: false };
    if (!(await this.allowed(cmd, ctx))) return this.respond(ctx, { content: '⛔ Nie masz uprawnień do tej komendy.', flags: 64 });
    this.log(`/${name} – ${user.username}`);
    await this.run(cmd.actions || [], ctx);
    if (!ctx.replied) await this.respond(ctx, { content: '✔', flags: 64 }).catch(() => {});
  }
  async onMessage(d) {
    if (!d.guild_id || (d.author && d.author.bot)) return;
    const prefix = this.def.prefix || '!';
    const base = { kind: 'message', message: d, guildId: d.guild_id, channelId: d.channel_id, user: d.author, roles: d.member ? d.member.roles : [], content: d.content };
    if (d.content && d.content.startsWith(prefix)) {
      const [first, ...args] = d.content.slice(prefix.length).trim().split(/\s+/);
      const cmd = (this.def.commands || []).find(c => c.type === 'prefix' && c.name.toLowerCase() === (first || '').toLowerCase());
      if (cmd) {
        const ctx = { ...base, args, options: Object.fromEntries((cmd.options || []).map((o, i) => [o.name, args[i]])) };
        if (!(await this.allowed(cmd, ctx))) return this.respond(ctx, { content: '⛔ Nie masz uprawnień do tej komendy.' });
        this.log(`${prefix}${cmd.name} – ${d.author.username}`);
        return this.run(cmd.actions || [], ctx);
      }
    }
    for (const ev of (this.def.events || []).filter(e => e.event === 'message')) {
      if (ev.contains && !String(d.content || '').toLowerCase().includes(String(ev.contains).toLowerCase())) continue;
      await this.run(ev.actions || [], { ...base });
    }
  }
  // zdarzenia (także z CodeManagera: cm:serverStart, cm:playerJoin…)
  async trigger(event, data = {}) {
    for (const ev of (this.def.events || []).filter(e => e.event === event)) {
      if (event.startsWith('cm:') && ev.serverId && data.server && ev.serverId !== data.server.id) continue;
      const ctx = { kind: 'event', event, guildId: data.guildId || ev.guildId || this.def.guildId, user: data.user, cm: data.server ? { server: data.server, player: data.player, count: data.count } : null };
      try { await this.run(ev.actions || [], ctx); } catch (e) { this.log('✖ ' + e.message); }
    }
  }
  async respond(ctx, msg) {
    if (ctx.kind === 'interaction') {
      if (!ctx.replied) { ctx.replied = true; return this.client.rest('POST', `/interactions/${ctx.interaction.id}/${ctx.interaction.token}/callback`, { type: 4, data: msg }); }
      return this.client.rest('POST', `/webhooks/${this.client.appId}/${ctx.interaction.token}`, msg);
    }
    if (!ctx.channelId) throw new Error('Brak kanału do odpowiedzi – użyj akcji „Wyślij na kanał” z podanym ID kanału.');
    return this.client.rest('POST', `/channels/${ctx.channelId}/messages`, { ...msg, flags: undefined, message_reference: ctx.message ? { message_id: ctx.message.id, fail_if_not_exists: false } : undefined });
  }
  target(ctx, spec) { if (!spec || spec === 'user') return ctx.user && ctx.user.id; const m = String(spec).match(/^option:(.+)$/); if (m) return (ctx.options || {})[m[1]]; return render(spec, ctx).replace(/[<@!>]/g, ''); }
  async run(actions, ctx, depth = 0) {
    if (depth > 8) throw new Error('Za głęboko zagnieżdżone warunki.');
    ctx.vars = this.def.vars = this.def.vars || {};
    if (ctx.guildId && ctx.guildName == null) { const g = this.guildCache.get(ctx.guildId); if (g) { ctx.guildName = g.name; ctx.memberCount = g.memberCount; } }
    for (const a of actions) {
      const R = t => render(t, ctx);
      switch (a.type) {
        case 'reply': await this.respond(ctx, { content: clip(R(a.text), 2000), flags: a.ephemeral ? 64 : undefined }); break;
        case 'randomReply': { const list = String(a.texts || '').split('\n').map(s => s.trim()).filter(Boolean); if (list.length) await this.respond(ctx, { content: clip(R(list[Math.floor(Math.random() * list.length)]), 2000) }); break; }
        case 'send': await this.client.rest('POST', `/channels/${R(a.channelId)}/messages`, { content: clip(R(a.text), 2000) }); break;
        case 'embed': {
          const embed = { title: clip(R(a.title), 256) || undefined, description: clip(R(a.description), 4096) || undefined, color: colorInt(a.color), footer: a.footer ? { text: clip(R(a.footer), 2048) } : undefined, image: a.image ? { url: R(a.image) } : undefined, thumbnail: a.thumbnail ? { url: R(a.thumbnail) } : undefined, fields: (a.fields || []).filter(f => f.name).slice(0, 25).map(f => ({ name: clip(R(f.name), 256), value: clip(R(f.value) || '—', 1024), inline: !!f.inline })), timestamp: a.timestamp ? new Date().toISOString() : undefined };
          if (a.channelId) await this.client.rest('POST', `/channels/${R(a.channelId)}/messages`, { embeds: [embed] }); else await this.respond(ctx, { embeds: [embed] });
          break;
        }
        case 'dm': { const uid = this.target(ctx, a.target); const ch = await this.client.rest('POST', '/users/@me/channels', { recipient_id: uid }); await this.client.rest('POST', `/channels/${ch.id}/messages`, { content: clip(R(a.text), 2000) }); break; }
        case 'react': if (ctx.message) await this.client.rest('PUT', `/channels/${ctx.channelId}/messages/${ctx.message.id}/reactions/${encodeURIComponent(a.emoji || '👍')}/@me`); break;
        case 'deleteMessage': if (ctx.message) await this.client.rest('DELETE', `/channels/${ctx.channelId}/messages/${ctx.message.id}`); break;
        case 'addRole': case 'removeRole': await this.client.rest(a.type === 'addRole' ? 'PUT' : 'DELETE', `/guilds/${ctx.guildId}/members/${this.target(ctx, a.target)}/roles/${R(a.roleId)}`, undefined, { reason: 'CodeManager bot' }); break;
        case 'kick': await this.client.rest('DELETE', `/guilds/${ctx.guildId}/members/${this.target(ctx, a.target)}`, undefined, { reason: R(a.reason) || 'CodeManager bot' }); break;
        case 'ban': await this.client.rest('PUT', `/guilds/${ctx.guildId}/bans/${this.target(ctx, a.target)}`, { delete_message_seconds: Math.min(604800, (+a.deleteDays || 0) * 86400) }, { reason: R(a.reason) || 'CodeManager bot' }); break;
        case 'timeout': await this.client.rest('PATCH', `/guilds/${ctx.guildId}/members/${this.target(ctx, a.target)}`, { communication_disabled_until: new Date(Date.now() + Math.min(40320, +a.minutes || 10) * 60000).toISOString() }, { reason: R(a.reason) || 'CodeManager bot' }); break;
        case 'setVar': ctx.vars[a.name] = isNaN(+R(a.value)) || R(a.value) === '' ? R(a.value) : +R(a.value); this.saveVars(this.def); break;
        case 'incVar': ctx.vars[a.name] = (+ctx.vars[a.name] || 0) + (+R(a.by) || 1); this.saveVars(this.def); break;
        case 'wait': await new Promise(res => setTimeout(res, Math.min(600, +a.seconds || 1) * 1000)); break;
        case 'condition': { const ok = await this.check(a, ctx); await this.run(ok ? a.then || [] : a.else || [], ctx, depth + 1); break; }
        case 'cmServer': {
          if (!this.cm.server) throw new Error('Sterowanie serwerami jest niedostępne.');
          const r = await this.cm.server(a.serverId, a.action, R(a.command));
          ctx.result = r;
          if (a.confirm !== false && ctx.kind !== 'event') await this.respond(ctx, { content: clip(r || '✔ Gotowe', 2000) });
          break;
        }
        case 'cmStatus': {
          const list = this.cm.status ? await this.cm.status() : [];
          const embed = { title: 'Serwery gier', color: 0x2f9e5b, fields: list.slice(0, 25).map(s => ({ name: `${s.status === 'running' ? '🟢' : '🔴'} ${s.name}`, value: `${s.type}${s.status === 'running' ? ` · graczy: ${s.players ?? '?'}` : ' · wyłączony'}`, inline: true })), timestamp: new Date().toISOString() };
          if (!list.length) embed.description = 'Brak serwerów.';
          if (a.channelId) await this.client.rest('POST', `/channels/${R(a.channelId)}/messages`, { embeds: [embed] }); else await this.respond(ctx, { embeds: [embed] });
          break;
        }
        case 'httpRequest': {
          const url = R(a.url); if (!/^https?:\/\//.test(url)) throw new Error('Adres musi zaczynać się od http:// lub https://');
          const r = await fetch(url, { method: a.method || 'GET', headers: a.body ? { 'Content-Type': 'application/json' } : undefined, body: a.body && a.method !== 'GET' ? R(a.body) : undefined });
          const text = (await r.text()).slice(0, 4000);
          let val = text; if (a.path) { try { val = String(a.path).split('.').reduce((o, k) => (o == null ? o : o[k]), JSON.parse(text)); } catch { val = ''; } }
          ctx.result = val; if (a.saveAs) { ctx.vars[a.saveAs] = val; this.saveVars(this.def); }
          break;
        }
        case 'log': this.log(R(a.text)); break;
        default: this.log('Nieznana akcja: ' + a.type);
      }
    }
  }
  async check(a, ctx) {
    const L = render(a.left, ctx); const Rv = render(a.right, ctx);
    switch (a.op) {
      case '==': return L === Rv;
      case '!=': return L !== Rv;
      case '>': return +L > +Rv;
      case '<': return +L < +Rv;
      case 'contains': return L.toLowerCase().includes(Rv.toLowerCase());
      case 'hasRole': return (ctx.roles || []).includes(Rv.replace(/[<@&>]/g, ''));
      case 'isAdmin': return this.isAdmin(ctx);
      case 'chance': return Math.random() * 100 < (+Rv || 50);
      default: return false;
    }
  }
}

class BotManager {
  constructor({ file, store, enc, dec, cm, emit = () => {} }) {
    this.file = file; this.store = store; this.enc = enc; this.dec = dec; this.cm = cm; this.emit = emit;
    this.bots = (store.read(file, null) || []); this.running = new Map(); this.logs = new Map();
  }
  save() { this.store.write(this.file, this.bots); }
  list() { return this.bots.map(b => ({ ...b, tokenEnc: undefined, hasToken: !!b.tokenEnc, status: this.running.get(b.id) ? this.running.get(b.id).status : 'offline', error: this.running.get(b.id) ? this.running.get(b.id).error : null })); }
  get(id) { const b = this.bots.find(x => x.id === id); if (!b) throw new Error('Nie ma takiego bota.'); return b; }
  create(name) { const b = { id: crypto.randomBytes(5).toString('hex'), name: name || 'Mój bot', prefix: '!', guildId: '', commands: [], events: [], vars: {} }; this.bots.push(b); this.save(); return b.id; }
  update(id, patch) { const b = this.get(id); const { token, tokenEnc, id: _i, ...rest } = patch; Object.assign(b, rest); if (token !== undefined) b.tokenEnc = token ? this.enc(token.trim()) : undefined; this.save(); return this.list().find(x => x.id === id); }
  remove(id) { this.stop(id); this.bots = this.bots.filter(b => b.id !== id); this.save(); }
  log(id, m) { const arr = this.logs.get(id) || []; arr.push(`[${new Date().toLocaleTimeString('pl-PL')}] ${m}`); if (arr.length > 500) arr.shift(); this.logs.set(id, arr); this.emit('bot:log', { id, line: arr[arr.length - 1] }); }
  getLog(id) { return this.logs.get(id) || []; }
  async start(id, ClientImpl) {
    this.stop(id);
    const def = this.get(id);
    const bot = new Bot(def, { log: (bid, m) => { this.log(bid, m); this.emit('bot:status', { id: bid, status: bot.status }); }, cm: this.cm, saveVars: () => this.save() });
    this.running.set(id, bot);
    await bot.start(def.tokenEnc ? this.dec(def.tokenEnc) : null, ClientImpl);
    def.autostart = true; this.save();
    return true;
  }
  stop(id, { keepAuto } = {}) { const b = this.running.get(id); if (b) b.stop(); this.running.delete(id); const d = this.bots.find(x => x.id === id); if (d && !keepAuto) { d.autostart = false; this.save(); } this.emit('bot:status', { id, status: 'offline' }); }
  stopAll() { for (const id of [...this.running.keys()]) this.stop(id, { keepAuto: true }); }
  startAuto() { for (const b of this.bots) if (b.autostart && b.tokenEnc) this.start(b.id).catch(e => this.log(b.id, '✖ ' + e.message)); }
  // zdarzenia z CodeManagera trafiają do wszystkich działających botów
  cmEvent(event, data) { for (const b of this.running.values()) b.trigger('cm:' + event, data).catch(() => {}); }
}

module.exports = { Bot, BotManager, render, EVENTS, ACTIONS, OPTION_TYPES };
