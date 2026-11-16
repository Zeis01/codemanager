// Języki, motyw, snippety i szablony edytora pod gry
'use strict';
window.EditorLangs = (function () {
  const SNIPS = {};
  function languageFor(file) {
    const p = file.replace(/\\/g, '/').toLowerCase();
    const base = p.split('/').pop();
    const ext = base.includes('.') ? base.split('.').pop() : '';
    if (base === 'mod.info') return 'ini';
    if (base === 'fxmanifest.lua' || base === '__resource.lua') return 'lua';
    if (base === 'dockerfile') return 'dockerfile';
    if (/paradox interactive|hearts of iron/.test(p) && (ext === 'txt' || ext === 'mod' || ext === 'gui' || ext === 'gfx' || ext === 'asset')) return 'paradox';
    const map = {
      lua: 'lua', json: 'json', mcmeta: 'json', jsonc: 'json', toml: 'toml', yml: 'yaml', yaml: 'yaml', xml: 'xml', map: 'xml', cs: 'csharp',
      sp: 'sourcepawn', inc: 'sourcepawn', c: 'enforce', sqf: 'sqf', cpp: 'cpp', hpp: 'cpp', h: 'cpp', ext: 'cpp', ini: 'ini', properties: 'ini', conf: 'xml',
      cfg: 'srccfg', gi: 'keyvalues', vdf: 'keyvalues', acf: 'keyvalues', res: 'keyvalues', vmt: 'keyvalues', sii: 'sii', sui: 'sii', mod: 'paradox',
      mcfunction: 'mcfunction', md: 'markdown', js: 'javascript', mjs: 'javascript', ts: 'typescript', bat: 'bat', cmd: 'bat', sh: 'shell', ps1: 'powershell',
      html: 'html', htm: 'html', css: 'css', py: 'python', java: 'java', kt: 'kotlin', sql: 'sql', log: 'log', txt: 'plaintext',
    };
    if (ext === 'conf' && /mtaserver|acl/.test(base)) return 'xml';
    if (ext === 'conf') return 'ini';
    return map[ext] || 'plaintext';
  }

  function register(monaco) {
    // ---- motyw ----
    monaco.editor.defineTheme('codemanager', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: '5f8a72', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7ee2a8' }, { token: 'keyword.control', foreground: '7ee2a8' },
        { token: 'string', foreground: 'e7c27a' }, { token: 'string.key.json', foreground: '9fd3c7' }, { token: 'string.value.json', foreground: 'e7c27a' },
        { token: 'number', foreground: 'f0a17a' }, { token: 'type', foreground: '79c6e8' }, { token: 'type.identifier', foreground: '79c6e8' },
        { token: 'function', foreground: 'b8e3a0' }, { token: 'variable', foreground: 'dce9e0' }, { token: 'constant', foreground: 'f0a17a' },
        { token: 'tag', foreground: '7ee2a8' }, { token: 'attribute.name', foreground: '9fd3c7' }, { token: 'attribute.value', foreground: 'e7c27a' },
        { token: 'key', foreground: '9fd3c7' }, { token: 'operator', foreground: 'a9c4b4' }, { token: 'delimiter', foreground: '8fae9b' },
        { token: 'log.error', foreground: 'ee6c5e' }, { token: 'log.warn', foreground: 'e7b24c' }, { token: 'log.info', foreground: '6cb6d9' }, { token: 'log.date', foreground: '5f8a72' },
      ],
      colors: {
        'editor.background': '#0f1d16', 'editor.foreground': '#dce9e0', 'editorLineNumber.foreground': '#3c5e4b', 'editorLineNumber.activeForeground': '#8fae9b',
        'editor.lineHighlightBackground': '#14261d', 'editor.selectionBackground': '#2a5a40', 'editor.inactiveSelectionBackground': '#1f4030',
        'editorCursor.foreground': '#4fd18b', 'editorIndentGuide.background1': '#1c3327', 'editorIndentGuide.activeBackground1': '#2f553f',
        'editorWidget.background': '#14261d', 'editorWidget.border': '#244131', 'editorSuggestWidget.background': '#14261d', 'editorSuggestWidget.selectedBackground': '#244131',
        'editorHoverWidget.background': '#14261d', 'minimap.background': '#0e1b15', 'scrollbarSlider.background': '#24413180', 'scrollbarSlider.hoverBackground': '#2f553fa0',
        'editorBracketMatch.background': '#2a5a4066', 'editorBracketMatch.border': '#4fd18b', 'editorGutter.background': '#0f1d16', 'input.background': '#0a1510', 'focusBorder': '#4fd18b',
      },
    });

    const reg = (id, def, conf) => { monaco.languages.register({ id }); monaco.languages.setMonarchTokensProvider(id, def); if (conf) monaco.languages.setLanguageConfiguration(id, conf); };
    const cLike = { comments: { lineComment: '//', blockComment: ['/*', '*/'] }, brackets: [['{', '}'], ['[', ']'], ['(', ')']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }] };

    reg('toml', {
      tokenizer: { root: [
        [/#.*$/, 'comment'], [/^\s*\[\[?[^\]]+\]\]?/, 'type'], [/^\s*[\w.-]+(?=\s*=)/, 'key'], [/"""/, 'string', '@ml'], [/"([^"\\]|\\.)*"/, 'string'], [/'[^']*'/, 'string'],
        [/\b(true|false)\b/, 'constant'], [/\d{4}-\d\d-\d\d[T ]?[\d:.Z+-]*/, 'number'], [/[+-]?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?/, 'number'], [/=/, 'operator'],
      ], ml: [[/"""/, 'string', '@pop'], [/./, 'string']] },
    }, { comments: { lineComment: '#' }, brackets: [['[', ']'], ['{', '}']], autoClosingPairs: [{ open: '[', close: ']' }, { open: '{', close: '}' }, { open: '"', close: '"' }] });

    reg('sourcepawn', {
      keywords: ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'break', 'continue', 'new', 'delete', 'public', 'stock', 'static', 'const', 'native', 'forward', 'enum', 'struct', 'methodmap', 'property', 'typedef', 'typeset', 'function', 'view_as', 'sizeof', 'null', 'true', 'false', 'this'],
      types: ['void', 'int', 'float', 'bool', 'char', 'any', 'Handle', 'Action', 'ConVar', 'Plugin', 'StringMap', 'ArrayList', 'KeyValues', 'DataPack', 'Menu', 'Event'],
      tokenizer: { root: [
        [/^\s*#\s*\w+/, 'keyword.control'], [/\/\/.*$/, 'comment'], [/\/\*/, 'comment', '@cm'], [/"([^"\\]|\\.)*"/, 'string'], [/'([^'\\]|\\.)*'/, 'string'],
        [/\b(Plugin_\w+|MAXPLAYERS|INVALID_HANDLE)\b/, 'constant'], [/[A-Za-z_]\w*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@default': 'function' } }],
        [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@types': 'type', '@default': 'variable' } }], [/\d+(\.\d+)?/, 'number'], [/[{}()[\]]/, 'delimiter'], [/[=+\-*/%<>!&|^~?:]/, 'operator'],
      ], cm: [[/\*\//, 'comment', '@pop'], [/./, 'comment']] },
    }, cLike);

    reg('enforce', {
      keywords: ['class', 'extends', 'modded', 'override', 'proto', 'native', 'static', 'protected', 'private', 'sealed', 'event', 'external', 'owned', 'ref', 'autoptr', 'out', 'inout', 'notnull', 'const', 'reference', 'if', 'else', 'for', 'foreach', 'while', 'switch', 'case', 'default', 'break', 'continue', 'return', 'new', 'delete', 'null', 'true', 'false', 'this', 'super', 'typedef', 'enum', 'thread', 'local', 'volatile'],
      types: ['void', 'int', 'float', 'bool', 'string', 'vector', 'auto', 'typename', 'array', 'map', 'set', 'Class', 'Managed', 'IEntity', 'GenericEntity', 'ScriptComponent', 'PlayerBase', 'ItemBase', 'EntityAI', 'Object'],
      tokenizer: { root: [
        [/^\s*#\s*\w+/, 'keyword.control'], [/\/\/.*$/, 'comment'], [/\/\*/, 'comment', '@cm'], [/"([^"\\]|\\.)*"/, 'string'],
        [/[A-Za-z_]\w*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@default': 'function' } }], [/[A-Z]\w*/, { cases: { '@keywords': 'keyword', '@types': 'type', '@default': 'type.identifier' } }],
        [/[a-z_]\w*/, { cases: { '@keywords': 'keyword', '@types': 'type', '@default': 'variable' } }], [/\d+(\.\d+)?/, 'number'], [/[{}()[\]]/, 'delimiter'],
      ], cm: [[/\*\//, 'comment', '@pop'], [/./, 'comment']] },
    }, cLike);

    reg('sqf', {
      keywords: ['if', 'then', 'else', 'exitWith', 'for', 'from', 'to', 'step', 'do', 'while', 'forEach', 'switch', 'case', 'default', 'private', 'params', 'call', 'spawn', 'execVM', 'true', 'false', 'nil', 'and', 'or', 'not', 'waitUntil', 'count', 'select', 'player', 'this'],
      tokenizer: { root: [[/\/\/.*$/, 'comment'], [/\/\*/, 'comment', '@cm'], [/"([^"]|"")*"/, 'string'], [/'[^']*'/, 'string'], [/_\w+/, 'variable'], [/[A-Za-z]\w*/, { cases: { '@keywords': 'keyword', '@default': 'function' } }], [/\d+(\.\d+)?/, 'number']], cm: [[/\*\//, 'comment', '@pop'], [/./, 'comment']] },
    }, cLike);

    reg('paradox', {
      keywords: ['yes', 'no', 'if', 'else', 'else_if', 'limit', 'AND', 'OR', 'NOT', 'NOR', 'NAND', 'trigger', 'effect', 'modifier', 'ai_will_do', 'potential', 'allowed', 'available', 'name', 'path', 'version', 'supported_version', 'dependencies', 'replace_path', 'tags', 'picture', 'remote_file_id'],
      tokenizer: { root: [[/#.*$/, 'comment'], [/"([^"\\]|\\.)*"/, 'string'], [/[A-Za-z_][\w.:@-]*(?=\s*[=<>])/, { cases: { '@keywords': 'keyword', '@default': 'key' } }], [/[A-Za-z_][\w.:@-]*/, { cases: { '@keywords': 'keyword', '@default': 'variable' } }], [/-?\d+(\.\d+)?/, 'number'], [/[{}]/, 'delimiter'], [/[=<>!]+/, 'operator']] },
    }, { comments: { lineComment: '#' }, brackets: [['{', '}']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }] });

    reg('sii', {
      tokenizer: { root: [[/#.*$|\/\/.*$/, 'comment'], [/\b(SiiNunit)\b/, 'keyword'], [/^\s*\w+\s*:\s*\.[\w.]+/, 'type'], [/^\s*[\w]+(\[\d*\])?(?=\s*:)/, 'key'], [/"([^"\\]|\\.)*"/, 'string'], [/\b(true|false)\b/, 'constant'], [/-?\d+(\.\d+)?/, 'number'], [/[{}]/, 'delimiter']] },
    }, { comments: { lineComment: '#' }, brackets: [['{', '}']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }] });

    reg('keyvalues', {
      tokenizer: { root: [[/\/\/.*$/, 'comment'], [/"([^"\\]|\\.)*"(?=\s*["{])/, 'key'], [/"([^"\\]|\\.)*"/, 'string'], [/\[\$[\w!|&]+\]/, 'keyword.control'], [/[A-Za-z_][\w.]*(?=\s+["{\w])/, 'key'], [/[A-Za-z_][\w./]*/, 'string'], [/-?\d+(\.\d+)?/, 'number'], [/[{}]/, 'delimiter']] },
    }, { comments: { lineComment: '//' }, brackets: [['{', '}']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }] });

    reg('srccfg', {
      keywords: ['ensure', 'start', 'stop', 'restart', 'exec', 'set', 'sets', 'setr', 'add_ace', 'add_principal', 'endpoint_add_tcp', 'endpoint_add_udp', 'bind', 'alias', 'echo', 'say', 'map', 'changelevel', 'mp_restartgame', 'sv_cheats', 'hostname', 'rcon_password', 'sv_password'],
      tokenizer: { root: [[/\/\/.*$/, 'comment'], [/#.*$/, 'comment'], [/"([^"\\]|\\.)*"/, 'string'], [/^\s*[\w.+-]+/, { cases: { '@keywords': 'keyword', '@default': 'function' } }], [/\b(true|false|on|off)\b/, 'constant'], [/-?\d+(\.\d+)?/, 'number'], [/[=;{}[\]]/, 'delimiter'], [/[\w.:/@-]+/, 'variable']] },
    }, { comments: { lineComment: '//' }, autoClosingPairs: [{ open: '"', close: '"' }, { open: '{', close: '}' }] });

    reg('mcfunction', {
      tokenizer: { root: [[/^\s*#.*$/, 'comment'], [/^\s*\w+/, 'keyword'], [/@[aeprs](\[[^\]]*\])?/, 'type'], [/"([^"\\]|\\.)*"/, 'string'], [/~-?\d*|\^-?\d*/, 'number'], [/-?\d+(\.\d+)?[bsldf]?/, 'number'], [/minecraft:[\w/.]+/, 'constant'], [/[{}[\]]/, 'delimiter']] },
    });

    reg('log', {
      tokenizer: { root: [[/\b(ERROR|FATAL|SEVERE|Exception|Error|Failed|failed)\b.*$/, 'log.error'], [/\b(WARN|WARNING|Warning)\b.*$/, 'log.warn'], [/\b(INFO|Info)\b/, 'log.info'], [/^\[?\d{1,4}[-:/.]\d{1,2}[-:/.]\d{1,4}[^\]\s]*\]?|\[\d\d:\d\d:\d\d\]/, 'log.date']] },
    });

    // ---- snippety ----
    const S = monaco.languages.CompletionItemKind.Snippet;
    const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    const snip = (lang, items) => { items.forEach(([l, , t]) => { (SNIPS[lang] = SNIPS[lang] || {})[l] = t; }); return monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: (model, pos) => {
        const w = model.getWordUntilPosition(pos);
        const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
        return { suggestions: items.map(([label, detail, text]) => ({ label, detail, documentation: detail, kind: S, insertText: text, insertTextRules: R, range })) };
      },
    }); };
    snip('lua', [
      ['fxmanifest', 'FiveM: szkielet fxmanifest.lua', "fx_version 'cerulean'\ngame 'gta5'\n\nauthor '${1:Autor}'\ndescription '${2:Opis}'\nversion '1.0.0'\n\nclient_script 'client.lua'\nserver_script 'server.lua'\n${0}"],
      ['RegisterNetEvent', 'FiveM: zdarzenie sieciowe', "RegisterNetEvent('${1:zasob:zdarzenie}', function(${2:dane})\n\t${0}\nend)"],
      ['RegisterCommand', 'FiveM: polecenie', "RegisterCommand('${1:komenda}', function(source, args, raw)\n\t${0}\nend, false)"],
      ['Citizen.CreateThread', 'FiveM: wątek', 'CreateThread(function()\n\twhile true do\n\t\tWait(${1:0})\n\t\t${0}\n\tend\nend)'],
      ['hook.Add', "Garry's Mod: hook", "hook.Add('${1:Think}', '${2:MojHook}', function(${3})\n\t${0}\nend)"],
      ['net.Receive', "Garry's Mod: odbiór wiadomości", "util.AddNetworkString('${1:Nazwa}')\nnet.Receive('${1:Nazwa}', function(len, ply)\n\t${0}\nend)"],
      ['modinfo', "DST: modinfo.lua", 'name = "${1:Mój mod}"\ndescription = "${2:Opis}"\nauthor = "${3:Autor}"\nversion = "1.0.0"\napi_version = 10\ndst_compatible = true\nclient_only_mod = false\nall_clients_require_mod = true\nicon_atlas = "modicon.xml"\nicon = "modicon.tex"\nconfiguration_options = {}\n'],
      ['AddPrefabPostInit', 'DST: modyfikacja prefabu', 'AddPrefabPostInit("${1:wilson}", function(inst)\n\tif not GLOBAL.TheWorld.ismastersim then return end\n\t${0}\nend)'],
      ['MP.RegisterEvent', 'BeamMP: zdarzenie serwera', 'function ${1:onPlayerJoin}(player_id)\n\t${0}\nend\nMP.RegisterEvent("${2:onPlayerJoin}", "${1:onPlayerJoin}")'],
      ['addEventHandler', 'MTA: obsługa zdarzenia', 'addEventHandler("${1:onPlayerJoin}", ${2:root}, function()\n\t${0}\nend)'],
      ['addCommandHandler', 'MTA: polecenie', 'addCommandHandler("${1:komenda}", function(player, cmd, ...)\n\t${0}\nend)'],
      ['Events.OnGameStart', 'Project Zomboid: zdarzenie', 'local function ${1:onGameStart}()\n\t${0}\nend\nEvents.${2:OnGameStart}.Add(${1:onGameStart})'],
      ['tf2mod', 'Transport Fever 2: mod.lua', 'function data()\n\treturn {\n\t\tinfo = {\n\t\t\tminorVersion = 0,\n\t\t\tseverityAdd = "NONE",\n\t\t\tseverityRemove = "NONE",\n\t\t\tname = _("${1:Nazwa}"),\n\t\t\tdescription = _("${2:Opis}"),\n\t\t\ttags = { "${3:Misc}" },\n\t\t\tauthors = { { name = "${4:Autor}", role = "CREATOR" } },\n\t\t},\n\t}\nend\n'],
    ]);
    snip('csharp', [
      ['oxideplugin', 'Rust: plugin Oxide/Carbon', 'namespace Oxide.Plugins\n{\n    [Info("${1:NazwaPluginu}", "${2:Autor}", "1.0.0")]\n    [Description("${3:Opis}")]\n    public class ${1:NazwaPluginu} : RustPlugin\n    {\n        private void Init()\n        {\n            ${0}\n        }\n\n        [ChatCommand("${4:komenda}")]\n        private void Cmd(BasePlayer player, string command, string[] args)\n        {\n            SendReply(player, "Działa!");\n        }\n    }\n}\n'],
      ['cssplugin', 'CS2: plugin CounterStrikeSharp', 'using CounterStrikeSharp.API.Core;\nusing CounterStrikeSharp.API.Core.Attributes.Registration;\nusing CounterStrikeSharp.API.Modules.Commands;\n\nnamespace ${1:MojPlugin};\n\npublic class ${1:MojPlugin} : BasePlugin\n{\n    public override string ModuleName => "${2:Mój plugin}";\n    public override string ModuleVersion => "1.0.0";\n\n    public override void Load(bool hotReload)\n    {\n        ${0}\n    }\n\n    [ConsoleCommand("css_${3:komenda}", "Opis")]\n    public void OnCommand(CCSPlayerController? player, CommandInfo info)\n    {\n        info.ReplyToCommand("Działa!");\n    }\n}\n'],
      ['bepinplugin', 'BepInEx: plugin', 'using BepInEx;\nusing HarmonyLib;\n\n[BepInPlugin("${1:autor.mojmod}", "${2:Mój mod}", "1.0.0")]\npublic class Plugin : BaseUnityPlugin\n{\n    private void Awake()\n    {\n        new Harmony("${1:autor.mojmod}").PatchAll();\n        Logger.LogInfo("${2:Mój mod} załadowany");\n        ${0}\n    }\n}\n'],
      ['melonmod', 'MelonLoader: mod', 'using MelonLoader;\n\n[assembly: MelonInfo(typeof(${1:MojMod}.Core), "${2:Mój mod}", "1.0.0", "${3:Autor}")]\n[assembly: MelonGame("${4:TVGS}", "${5:Schedule I}")]\n\nnamespace ${1:MojMod}\n{\n    public class Core : MelonMod\n    {\n        public override void OnInitializeMelon()\n        {\n            LoggerInstance.Msg("Załadowano");\n            ${0}\n        }\n    }\n}\n'],
      ['tshockplugin', 'Terraria: plugin TShock', 'using Terraria;\nusing TerrariaApi.Server;\nusing TShockAPI;\n\n[ApiVersion(2, 1)]\npublic class ${1:MojPlugin} : TerrariaPlugin\n{\n    public override string Name => "${2:Mój plugin}";\n    public override System.Version Version => new System.Version(1, 0);\n    public override string Author => "${3:Autor}";\n    public ${1:MojPlugin}(Main game) : base(game) { }\n    public override void Initialize()\n    {\n        Commands.ChatCommands.Add(new Command("${4:moj.uprawnienie}", Cmd, "${5:komenda}"));\n    }\n    private void Cmd(CommandArgs args) => args.Player.SendSuccessMessage("Działa!");\n}\n'],
      ['valheimharmony', 'Valheim: patch Harmony', '[HarmonyPatch(typeof(${1:Player}), nameof(${1:Player}.${2:Update}))]\npublic static class ${3:MojPatch}\n{\n    private static void Postfix(${1:Player} __instance)\n    {\n        ${0}\n    }\n}\n'],
    ]);
    snip('sourcepawn', [
      ['plugin', 'SourceMod: szkielet pluginu', '#include <sourcemod>\n\n#pragma semicolon 1\n#pragma newdecls required\n\npublic Plugin myinfo =\n{\n\tname = "${1:Mój plugin}",\n\tauthor = "${2:Autor}",\n\tdescription = "${3:Opis}",\n\tversion = "1.0.0",\n\turl = ""\n};\n\npublic void OnPluginStart()\n{\n\tRegConsoleCmd("sm_${4:komenda}", Command_Test);\n\t${0}\n}\n\npublic Action Command_Test(int client, int args)\n{\n\tReplyToCommand(client, "[SM] Działa!");\n\treturn Plugin_Handled;\n}\n'],
      ['HookEvent', 'SourceMod: zdarzenie', 'HookEvent("${1:player_spawn}", Event_${2:PlayerSpawn});\n\npublic void Event_${2:PlayerSpawn}(Event event, const char[] name, bool dontBroadcast)\n{\n\tint client = GetClientOfUserId(event.GetInt("userid"));\n\t${0}\n}'],
    ]);
    snip('json', [
      ['fabric.mod.json', 'Minecraft: Fabric', '{\n  "schemaVersion": 1,\n  "id": "${1:mojmod}",\n  "version": "1.0.0",\n  "name": "${2:Mój mod}",\n  "environment": "*",\n  "entrypoints": { "main": ["${3:pl.autor.MojMod}"] },\n  "depends": {\n    "fabricloader": ">=0.15.0",\n    "minecraft": "~${4:1.21}",\n    "fabric-api": "*"\n  }\n}'],
      ['armamod', 'Arma Reforger: wpis moda w config.json', '{ "modId": "${1:0123456789ABCDEF}", "name": "${2:Nazwa}", "version": "" }'],
      ['thunderstore', 'Thunderstore: manifest.json', '{\n  "name": "${1:MojMod}",\n  "version_number": "1.0.0",\n  "website_url": "",\n  "description": "${2:Opis}",\n  "dependencies": ["BepInEx-BepInExPack-5.4.2100"]\n}'],
    ]);
    snip('yaml', [['plugin.yml', 'Paper/Spigot: plugin.yml', 'name: ${1:MojPlugin}\nversion: 1.0.0\nmain: ${2:pl.autor.MojPlugin}\napi-version: "${3:1.21}"\nauthor: ${4:Autor}\ndepend: []\nsoftdepend: []\ncommands:\n  ${5:komenda}:\n    description: Opis\n']]);
    snip('xml', [['meta.xml', 'MTA: meta.xml', '<meta>\n\t<info author="${1:Autor}" name="${2:Nazwa}" version="1.0.0" type="script" />\n\t<min_mta_version server="1.6.0" client="1.6.0" />\n\t<script src="server.lua" type="server" />\n\t<script src="client.lua" type="client" />\n</meta>']]);
    snip('paradox', [['descriptor', 'HOI4: descriptor.mod', 'version="1.0"\ntags={\n\t"${1:Gameplay}"\n}\nname="${2:Mój mod}"\nsupported_version="${3:1.14.*}"\n'], ['focus', 'HOI4: fokus narodowy', 'focus = {\n\tid = ${1:TAG_moj_fokus}\n\ticon = GFX_goal_generic_construct_civ_factory\n\tx = ${2:0}\n\ty = ${3:0}\n\tcost = 10\n\tcompletion_reward = {\n\t\t${0}\n\t}\n}']]);
    snip('enforce', [['modded', 'DayZ / Reforger: modded class', 'modded class ${1:PlayerBase}\n{\n\toverride void ${2:OnConnect}()\n\t{\n\t\tsuper.${2:OnConnect}();\n\t\t${0}\n\t}\n}']]);
    snip('ini', [['mod.info', 'Project Zomboid: mod.info', 'name=${1:Mój mod}\nid=${2:MojMod}\ndescription=${3:Opis}\nposter=poster.png\nmodversion=1.0\nversionMin=42.0\nrequire=\n']]);

    // ---- walidacja JSON: tolerancja komentarzy dla plików Valve/JSONC ----
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'warning', schemas: [] });
  }

  const TEMPLATES = [
    { game: 'FiveM', name: 'fxmanifest.lua', lang: 'lua', snippet: 'fxmanifest' },
    { game: 'Rust (Oxide/Carbon)', name: 'MojPlugin.cs', lang: 'csharp', snippet: 'oxideplugin' },
    { game: 'CS2 (CounterStrikeSharp)', name: 'MojPlugin.cs', lang: 'csharp', snippet: 'cssplugin' },
    { game: 'TF2 (SourceMod)', name: 'moj_plugin.sp', lang: 'sourcepawn', snippet: 'plugin' },
    { game: 'Minecraft (Paper)', name: 'plugin.yml', lang: 'yaml', snippet: 'plugin.yml' },
    { game: 'Minecraft (Fabric)', name: 'fabric.mod.json', lang: 'json', snippet: 'fabric.mod.json' },
    { game: 'BepInEx (Lethal Company, REPO, Valheim…)', name: 'Plugin.cs', lang: 'csharp', snippet: 'bepinplugin' },
    { game: 'MelonLoader (Schedule I)', name: 'Core.cs', lang: 'csharp', snippet: 'melonmod' },
    { game: 'Terraria (TShock)', name: 'MojPlugin.cs', lang: 'csharp', snippet: 'tshockplugin' },
    { game: "Garry's Mod", name: 'autorun.lua', lang: 'lua', snippet: 'hook.Add' },
    { game: "Don't Starve Together", name: 'modinfo.lua', lang: 'lua', snippet: 'modinfo' },
    { game: 'Project Zomboid', name: 'mod.info', lang: 'ini', snippet: 'mod.info' },
    { game: 'MTA', name: 'meta.xml', lang: 'xml', snippet: 'meta.xml' },
    { game: 'BeamMP', name: 'main.lua', lang: 'lua', snippet: 'MP.RegisterEvent' },
    { game: 'Transport Fever 2', name: 'mod.lua', lang: 'lua', snippet: 'tf2mod' },
    { game: 'Hearts of Iron IV', name: 'descriptor.mod', lang: 'paradox', snippet: 'descriptor' },
    { game: 'DayZ / Arma Reforger', name: 'PlayerBase.c', lang: 'enforce', snippet: 'modded' },
  ];

  return { languageFor, register, TEMPLATES, SNIPS };
})();
