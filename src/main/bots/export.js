// Eksport bota z kreatora do samodzielnego projektu Node.js (discord.js v14) – do uruchomienia bez CodeManagera,
// np. na VPS. Akcje serwerów gier działają przez panel webowy CodeManagera (adres + PIN w pliku .env).
'use strict';
const { OPTION_TYPES } = require('./runner');

const J = v => JSON.stringify(v == null ? '' : v);
const cleanName = n => String(n || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);

function actionsJs(actions, ind = '    ') {
  const out = [];
  for (const a of actions || []) {
    const R = t => `R(${J(t)})`;
    switch (a.type) {
      case 'reply': out.push(`await reply({ content: ${R(a.text)}${a.ephemeral ? ', ephemeral: true' : ''} });`); break;
      case 'randomReply': out.push(`{ const list = ${J(String(a.texts || '').split('\n').map(s => s.trim()).filter(Boolean))}; await reply({ content: R(list[Math.floor(Math.random() * list.length)] || '') }); }`); break;
      case 'send': out.push(`await (await client.channels.fetch(${R(a.channelId)})).send({ content: ${R(a.text)} });`); break;
      case 'embed': {
        const e = `new EmbedBuilder().setColor(${J(a.color || '#2f9e5b')})${a.title ? `.setTitle(${R(a.title)})` : ''}${a.description ? `.setDescription(${R(a.description)})` : ''}${a.footer ? `.setFooter({ text: ${R(a.footer)} })` : ''}${a.image ? `.setImage(${R(a.image)})` : ''}${a.thumbnail ? `.setThumbnail(${R(a.thumbnail)})` : ''}${(a.fields || []).filter(f => f.name).map(f => `.addFields({ name: ${R(f.name)}, value: ${R(f.value)} || '—', inline: ${!!f.inline} })`).join('')}${a.timestamp ? '.setTimestamp()' : ''}`;
        out.push(a.channelId ? `await (await client.channels.fetch(${R(a.channelId)})).send({ embeds: [${e}] });` : `await reply({ embeds: [${e}] });`);
        break;
      }
      case 'dm': out.push(`await (await client.users.fetch(target(${J(a.target)}))).send(${R(a.text)});`); break;
      case 'react': out.push(`if (ctx.message) await ctx.message.react(${J(a.emoji || '👍')});`); break;
      case 'deleteMessage': out.push('if (ctx.message) await ctx.message.delete();'); break;
      case 'addRole': out.push(`await (await ctx.guild.members.fetch(target(${J(a.target)}))).roles.add(${R(a.roleId)});`); break;
      case 'removeRole': out.push(`await (await ctx.guild.members.fetch(target(${J(a.target)}))).roles.remove(${R(a.roleId)});`); break;
      case 'kick': out.push(`await (await ctx.guild.members.fetch(target(${J(a.target)}))).kick(${R(a.reason)});`); break;
      case 'ban': out.push(`await ctx.guild.members.ban(target(${J(a.target)}), { reason: ${R(a.reason)}, deleteMessageSeconds: ${Math.min(604800, (+a.deleteDays || 0) * 86400)} });`); break;
      case 'timeout': out.push(`await (await ctx.guild.members.fetch(target(${J(a.target)}))).timeout(${Math.min(40320, +a.minutes || 10)} * 60000, ${R(a.reason)});`); break;
      case 'setVar': out.push(`vars[${J(a.name)}] = num(R(${J(a.value)})); saveVars();`); break;
      case 'incVar': out.push(`vars[${J(a.name)}] = (+vars[${J(a.name)}] || 0) + (+R(${J(a.by)}) || 1); saveVars();`); break;
      case 'wait': out.push(`await new Promise(r => setTimeout(r, ${Math.min(600, +a.seconds || 1) * 1000}));`); break;
      case 'condition': out.push(`if (await check(${J(a.op)}, R(${J(a.left)}), R(${J(a.right)}))) {`, ...actionsJs(a.then, '  ').map(l => '  ' + l.trimStart()), '} else {', ...actionsJs(a.else, '  ').map(l => '  ' + l.trimStart()), '}'); break;
      case 'cmServer': out.push(`ctx.result = await panel(${J(a.serverId)}, ${J(a.action)}, R(${J(a.command)}));`, a.confirm !== false ? `if (ctx.kind !== 'event') await reply({ content: ctx.result || '✔ Gotowe' });` : ''); break;
      case 'cmStatus': out.push('await reply({ embeds: [await statusEmbed()] });'); break;
      case 'httpRequest': out.push(`{ const r = await fetch(R(${J(a.url)}), { method: ${J(a.method || 'GET')}${a.body && a.method !== 'GET' ? `, headers: { 'Content-Type': 'application/json' }, body: R(${J(a.body)})` : ''} }); let v = (await r.text()).slice(0, 4000); ${a.path ? `try { v = ${J(a.path)}.split('.').reduce((o, k) => o == null ? o : o[k], JSON.parse(v)); } catch { v = ''; }` : ''} ctx.result = v; ${a.saveAs ? `vars[${J(a.saveAs)}] = v; saveVars();` : ''} }`); break;
      case 'log': out.push(`console.log(R(${J(a.text)}));`); break;
      default: out.push(`// nieobsługiwana akcja: ${a.type}`);
    }
  }
  return out.filter(Boolean).map(l => ind + l);
}

function build(bot) {
  const slash = (bot.commands || []).filter(c => c.type !== 'prefix' && c.name);
  const prefix = (bot.commands || []).filter(c => c.type === 'prefix' && c.name);
  const usesMembers = (bot.events || []).some(e => ['memberJoin', 'memberLeave'].includes(e.event));
  const usesMessages = prefix.length || (bot.events || []).some(e => e.event === 'message');
  const cmdDefs = slash.map(c => ({ name: cleanName(c.name), description: (c.description || c.name).slice(0, 100), options: (c.options || []).filter(o => o.name).map(o => ({ type: OPTION_TYPES[o.type] || 3, name: cleanName(o.name), description: (o.description || o.name).slice(0, 100), required: !!o.required })), default_member_permissions: c.permission === 'admin' ? '32' : undefined }));
  const perm = c => (c.permission === 'admin' ? `if (!(await isAdmin(ctx))) return reply({ content: '⛔ Nie masz uprawnień do tej komendy.', ephemeral: true });` : c.permission && c.permission !== 'everyone' ? `if (!ctx.member.roles.cache.has(${J(c.permission)}) && !(await isAdmin(ctx))) return reply({ content: '⛔ Nie masz uprawnień do tej komendy.', ephemeral: true });` : '');
  const index = `// Bot „${bot.name}” wygenerowany w CodeManager – discord.js v14
// Uruchomienie: npm install, uzupełnij plik .env (na podstawie .env.example), npm start
require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');

const PREFIX = ${J(bot.prefix || '!')};
const GUILD_ID = process.env.GUILD_ID || ${J(bot.guildId || '')};
const VARS_FILE = __dirname + '/vars.json';
let vars = {}; try { vars = JSON.parse(fs.readFileSync(VARS_FILE, 'utf8')); } catch { vars = ${JSON.stringify(bot.vars || {})}; }
const saveVars = () => fs.writeFileSync(VARS_FILE, JSON.stringify(vars, null, 2));
const num = v => (v !== '' && !isNaN(+v) ? +v : v);

const client = new Client({ intents: [GatewayIntentBits.Guilds${usesMembers ? ', GatewayIntentBits.GuildMembers' : ''}${usesMessages ? ', GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent' : ''}], partials: [Partials.Channel] });

const COMMANDS = ${JSON.stringify(cmdDefs, null, 2)};

// ---- szablony tekstu: {user}, {option:x}, {var:x}, {random:1-6}… ----
function renderer(ctx) {
  return t => String(t == null ? '' : t).replace(/\\{([\\w.:-]+)\\}/g, (all, key) => {
    const [k, arg] = key.split(/:(.*)/s);
    switch (k) {
      case 'user': return ctx.user ? \`<@\${ctx.user.id}>\` : '';
      case 'user.name': return ctx.user ? (ctx.user.globalName || ctx.user.username) : '';
      case 'user.id': return ctx.user ? ctx.user.id : '';
      case 'user.avatar': return ctx.user ? ctx.user.displayAvatarURL() : '';
      case 'channel': return ctx.channelId ? \`<#\${ctx.channelId}>\` : '';
      case 'server.name': return ctx.guild ? ctx.guild.name : '';
      case 'member.count': return ctx.guild ? String(ctx.guild.memberCount) : '';
      case 'option': { const v = (ctx.options || {})[arg]; return v == null ? '' : String(v); }
      case 'args': return (ctx.args || []).join(' ');
      case 'arg': return (ctx.args || [])[(+arg || 1) - 1] || '';
      case 'message': return ctx.content || '';
      case 'var': return vars[arg] != null ? String(vars[arg]) : '0';
      case 'random': { const m = String(arg || '1-100').match(/^(-?\\d+)-(-?\\d+)$/); return m ? String(+m[1] + Math.floor(Math.random() * (+m[2] - +m[1] + 1))) : ''; }
      case 'time': return new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      case 'date': return new Date().toLocaleDateString('pl-PL');
      case 'result': return ctx.result != null ? String(ctx.result) : '';
      default: return all;
    }
  });
}
async function isAdmin(ctx) { return !!(ctx.member && (ctx.member.permissions.has(PermissionFlagsBits.Administrator) || ctx.member.permissions.has(PermissionFlagsBits.ManageGuild))); }
async function checkFor(ctx) { return async (op, L, R) => { switch (op) { case '==': return L === R; case '!=': return L !== R; case '>': return +L > +R; case '<': return +L < +R; case 'contains': return L.toLowerCase().includes(R.toLowerCase()); case 'hasRole': return !!(ctx.member && ctx.member.roles.cache.has(R.replace(/[<@&>]/g, ''))); case 'isAdmin': return isAdmin(ctx); case 'chance': return Math.random() * 100 < (+R || 50); default: return false; } }; }

// ---- serwery gier przez panel webowy CodeManagera (Ustawienia → Panel webowy) ----
let panelToken = null;
async function panelApi(route, body) {
  const base = (process.env.CM_PANEL_URL || '').replace(/\\/$/, ''); if (!base) throw new Error('Ustaw CM_PANEL_URL i CM_PANEL_PIN w pliku .env');
  if (!panelToken) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: process.env.CM_PANEL_PIN }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Logowanie do panelu nie powiodło się'); panelToken = j.token; }
  const r = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + panelToken, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401) { panelToken = null; } const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
}
async function panel(id, action, command) { await panelApi(\`/api/servers/\${id}/\${action}\`, action === 'command' ? { cmd: command } : {}); return { start: '▶ Uruchamiam serwer…', stop: '⏹ Zatrzymuję serwer…', restart: '🔄 Restartuję serwer…', command: '✔ Wysłano polecenie', backup: '💾 Robię kopię zapasową…' }[action]; }
async function statusEmbed() { const l = await panelApi('/api/servers'); return new EmbedBuilder().setTitle('Serwery gier').setColor('#2f9e5b').addFields(l.slice(0, 25).map(s => ({ name: (s.status === 'running' ? '🟢 ' : '🔴 ') + s.name, value: s.type + (s.status === 'running' ? ' · graczy: ' + (s.players ?? '?') : ' · wyłączony'), inline: true }))).setTimestamp(); }

async function runFor(ctx, body) {
  const R = renderer(ctx); const check = await checkFor(ctx);
  const target = spec => { if (!spec || spec === 'user') return ctx.user.id; const m = String(spec).match(/^option:(.+)$/); return m ? ctx.options[m[1]] : R(spec).replace(/[<@!>]/g, ''); };
  const reply = msg => (ctx.interaction ? (ctx.interaction.replied || ctx.interaction.deferred ? ctx.interaction.followUp(msg) : ctx.interaction.reply(msg)) : ctx.channel.send({ ...msg, ephemeral: undefined }));
  try { await body({ ctx, R, check, target, reply }); } catch (e) { console.error(e); }
}

client.once('ready', async () => {
  console.log('Zalogowano jako ' + client.user.tag);
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(GUILD_ID ? Routes.applicationGuildCommands(client.user.id, GUILD_ID) : Routes.applicationCommands(client.user.id), { body: COMMANDS });
${(bot.events || []).filter(e => e.event === 'ready').map(e => `  await runFor({ kind: 'event', guild: GUILD_ID ? await client.guilds.fetch(GUILD_ID) : null }, async ({ ctx, R, check, target, reply }) => {\n${actionsJs(e.actions, '    ').join('\n')}\n  });`).join('\n')}
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const options = Object.fromEntries(interaction.options.data.map(o => [o.name, o.user ? \`<@\${o.user.id}>\` : o.value]));
  const ctx = { kind: 'interaction', interaction, guild: interaction.guild, member: interaction.member, channelId: interaction.channelId, user: interaction.user, options };
  switch (interaction.commandName) {
${slash.map(c => `    case ${J(cleanName(c.name))}: await runFor(ctx, async ({ ctx, R, check, target, reply }) => {\n      ${perm(c)}\n${actionsJs(c.actions, '      ').join('\n')}\n    }); break;`).join('\n')}
  }
  if (!interaction.replied) await interaction.reply({ content: '✔', ephemeral: true }).catch(() => {});
});
${usesMessages ? `
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  const base = { kind: 'message', message, guild: message.guild, member: message.member, channel: message.channel, channelId: message.channelId, user: message.author, content: message.content };
  if (message.content.startsWith(PREFIX)) {
    const [first, ...args] = message.content.slice(PREFIX.length).trim().split(/\\s+/);
    switch ((first || '').toLowerCase()) {
${prefix.map(c => `      case ${J(c.name.toLowerCase())}: return runFor({ ...base, args, options: Object.fromEntries(${JSON.stringify((c.options || []).map((o, i) => [o.name, i]))}.map(([k, i]) => [k, args[i]])) }, async ({ ctx, R, check, target, reply }) => {\n        ${perm(c)}\n${actionsJs(c.actions, '        ').join('\n')}\n      });`).join('\n')}
    }
  }
${(bot.events || []).filter(e => e.event === 'message').map(e => `  if (${J(String(e.contains || '').toLowerCase())} === '' || message.content.toLowerCase().includes(${J(String(e.contains || '').toLowerCase())})) await runFor({ ...base }, async ({ ctx, R, check, target, reply }) => {\n${actionsJs(e.actions, '    ').join('\n')}\n  });`).join('\n')}
});` : ''}
${(bot.events || []).filter(e => ['memberJoin', 'memberLeave'].includes(e.event)).map(e => `
client.on(${J(e.event === 'memberJoin' ? 'guildMemberAdd' : 'guildMemberRemove')}, async member => {
  await runFor({ kind: 'event', guild: member.guild, member, user: member.user }, async ({ ctx, R, check, target, reply }) => {
${actionsJs(e.actions, '    ').join('\n')}
  });
});`).join('\n')}

client.login(process.env.DISCORD_TOKEN);
`;
  const pkg = { name: cleanName(bot.name) || 'bot', version: '1.0.0', private: true, main: 'index.js', scripts: { start: 'node index.js' }, dependencies: { 'discord.js': '^14.16.3', dotenv: '^16.4.5' }, engines: { node: '>=18' } };
  const cmEvents = (bot.events || []).filter(e => e.event.startsWith('cm:')).length;
  return {
    'index.js': index,
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    '.env.example': `DISCORD_TOKEN=wklej_token_bota\nGUILD_ID=${bot.guildId || ''}\n# Sterowanie serwerami gier przez panel webowy CodeManagera (opcjonalnie)\nCM_PANEL_URL=http://192.168.1.10:8790\nCM_PANEL_PIN=123456\n`,
    '.gitignore': 'node_modules\n.env\nvars.json\n',
    'README.md': `# ${bot.name}\n\nBot wygenerowany w CodeManager (discord.js v14).\n\n1. Zainstaluj Node.js 18 lub nowszy.\n2. W tym folderze uruchom \`npm install\`.\n3. Skopiuj \`.env.example\` jako \`.env\` i wpisz token bota.\n4. Uruchom \`npm start\`.\n\nAkcje serwerów gier działają przez panel webowy CodeManagera – włącz go w Ustawieniach i wpisz adres oraz PIN w \`.env\`.${cmEvents ? `\n\nZdarzenia serwerów gier (${cmEvents}) działają tylko w CodeManagerze i nie zostały wyeksportowane.` : ''}\n`,
  };
}

module.exports = { build, actionsJs };
