// Asystent AI w edytorze:
// - czat z dowolnym dostawcą (Claude, ChatGPT, Gemini, OpenRouter, Mistral, DeepSeek, Groq, xAI, Ollama, LM Studio…)
// - tryb agenta: model sam czyta pliki projektu, szuka, sprawdza błędy i logi serwera, a zmiany w plikach
//   proponuje do zatwierdzenia (podgląd różnic) albo zapisuje sam, jeśli użytkownik tak ustawi
// - zewnętrzni agenci z wiersza poleceń: Claude Code, OpenAI Codex CLI, Gemini CLI, Aider
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const U = require('../util');

const MAX_STEPS = 16;
const ansi = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]|\r(?!\n)/g, '');

// ---------- narzędzia agenta ----------
const TOOLS = [
  { name: 'list_files', description: 'Lista plików i folderów projektu (rekurencyjnie, do 3 poziomów). Ścieżki względem folderu projektu.', params: { dir: { type: 'string', description: 'Podfolder (domyślnie cały projekt)' } }, required: [] },
  { name: 'read_file', description: 'Czyta plik projektu (z numerami wierszy). Dla dużych plików podaj zakres wierszy.', params: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] },
  { name: 'search', description: 'Szuka tekstu we wszystkich plikach projektu (bez rozróżniania wielkości liter). Zwraca plik:wiersz: treść.', params: { query: { type: 'string' } }, required: ['query'] },
  { name: 'edit_file', description: 'Zmienia fragment pliku: old_text musi występować w pliku dokładnie raz (skopiuj go dosłownie z read_file, bez numerów wierszy). Użytkownik zobaczy różnice przed zapisem.', params: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] },
  { name: 'write_file', description: 'Tworzy nowy plik albo zastępuje całą zawartość pliku. Użytkownik zobaczy różnice przed zapisem.', params: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  { name: 'get_problems', description: 'Błędy i ostrzeżenia edytora (serwer języka, walidacja) dla otwartych plików.', params: {}, required: [] },
  { name: 'server_log', description: 'Ostatnie wiersze konsoli serwera gry uruchomionego w CodeManagerze (do szukania przyczyn błędów skryptów). Bez nazwy – lista serwerów.', params: { server: { type: 'string', description: 'Nazwa serwera' }, lines: { type: 'integer' } }, required: [] },
];
const SKIP = /(^|[\\/])(node_modules|\.git|__pycache__|\.venv|venv|cache|logs?|backups?|world[^\\/]*|crash-reports)([\\/]|$)/i;
const TEXT_EXT = /\.(lua|js|ts|jsx|tsx|json|py|cs|java|kt|md|txt|cfg|ini|toml|ya?ml|xml|html|css|sp|inc|sh|bat|ps1|properties|mcmeta|vdf|gradle|sql|c|h|cpp|hpp|go|rs)$/i;

class ToolBox {
  constructor({ root, problems = {}, servers, approve, autoApply = false, onWrite = () => {} }) { Object.assign(this, { root: path.resolve(root), problems, servers, approve, autoApply, onWrite }); }
  abs(p) {
    const a = path.resolve(this.root, String(p || '.'));
    const rel = path.relative(this.root, a);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Ścieżka poza folderem projektu: ' + p);
    return a;
  }
  rel(a) { return path.relative(this.root, a).split(path.sep).join('/') || '.'; }
  async run(name, input = {}) {
    switch (name) {
      case 'list_files': {
        const base = this.abs(input.dir || '.'); const out = [];
        const walk = (d, depth) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } ents.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name)); for (const e of ents) { if (out.length > 400) return; const f = path.join(d, e.name); if (SKIP.test(this.rel(f)) || e.name.startsWith('.')) continue; out.push(this.rel(f) + (e.isDirectory() ? '/' : '')); if (e.isDirectory() && depth < 3) walk(f, depth + 1); } };
        walk(base, 1); return out.join('\n') + (out.length > 400 ? '\n…(skrócono)' : '') || '(pusto)';
      }
      case 'read_file': {
        const f = this.abs(input.path); if (!U.exists(f)) throw new Error('Nie ma pliku ' + input.path);
        const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
        const a = Math.max(1, input.start_line || 1); const b = Math.min(lines.length, input.end_line || Math.min(lines.length, a + 799));
        const body = lines.slice(a - 1, b).map((l, i) => `${String(a + i).padStart(4)}| ${l}`).join('\n');
        return `${this.rel(f)} (wiersze ${a}-${b} z ${lines.length})\n${body}`;
      }
      case 'search': {
        const q = String(input.query || '').toLowerCase(); if (q.length < 2) throw new Error('Za krótka fraza.');
        const hits = [];
        for (const r of U.walk(this.root, { maxFiles: 8000, maxDepth: 10, filter: r => TEXT_EXT.test(r) && !SKIP.test(r) })) {
          let t; try { t = fs.readFileSync(path.join(this.root, r), 'utf8'); } catch { continue; }
          if (t.length > 2e6 || !t.toLowerCase().includes(q)) continue;
          t.split(/\r?\n/).forEach((l, i) => { if (hits.length < 120 && l.toLowerCase().includes(q)) hits.push(`${r.split(path.sep).join('/')}:${i + 1}: ${l.trim().slice(0, 200)}`); });
          if (hits.length >= 120) break;
        }
        return hits.join('\n') || 'Brak wyników.';
      }
      case 'edit_file': {
        const f = this.abs(input.path); if (!U.exists(f)) throw new Error('Nie ma pliku ' + input.path + ' – do nowych plików użyj write_file.');
        const before = fs.readFileSync(f, 'utf8'); const eol = before.includes('\r\n') ? '\r\n' : '\n';
        const norm = s => String(s).replace(/\r\n/g, '\n');
        const b = norm(before), o = norm(input.old_text), n = norm(input.new_text);
        const count = o ? b.split(o).length - 1 : 0;
        if (count !== 1) throw new Error(count ? `old_text występuje ${count} razy – dodaj więcej otaczających wierszy.` : 'Nie znaleziono old_text w pliku – przeczytaj plik ponownie i skopiuj fragment dosłownie.');
        return this.commit(f, before, b.replace(o, () => n).replace(/\n/g, eol));
      }
      case 'write_file': {
        const f = this.abs(input.path); const before = U.exists(f) ? fs.readFileSync(f, 'utf8') : null;
        return this.commit(f, before, String(input.content));
      }
      case 'get_problems': {
        const out = [];
        for (const [file, list] of Object.entries(this.problems || {})) for (const p of list.slice(0, 60)) out.push(`${this.rel(file)}:${p.line}: [${p.severity}] ${p.message}`);
        return out.join('\n') || 'Brak błędów w otwartych plikach.';
      }
      case 'server_log': {
        const list = this.servers ? this.servers.list() : [];
        if (!input.server) return list.length ? list.map(s => `- ${s.name} (${s.typeName || s.type}, ${s.status})`).join('\n') : 'Brak serwerów.';
        const s = list.find(x => x.name.toLowerCase() === String(input.server).toLowerCase()) || list.find(x => x.name.toLowerCase().includes(String(input.server).toLowerCase()));
        if (!s) throw new Error('Nie ma serwera ' + input.server);
        const lines = this.servers.getLog(s.id) || [];
        return lines.slice(-Math.min(400, input.lines || 150)).join('\n') || '(konsola jest pusta)';
      }
    }
    throw new Error('Nieznane narzędzie ' + name);
  }
  async commit(f, before, after) {
    if (before === after) return 'Plik już ma taką treść.';
    const ok = this.autoApply ? true : await this.approve({ file: f, rel: this.rel(f), before, after });
    if (!ok) return 'Użytkownik odrzucił tę zmianę. Zapytaj, co zrobić inaczej, albo zaproponuj inną zmianę.';
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, after);
    this.onWrite(f);
    return `Zapisano ${this.rel(f)}.`;
  }
}

// ---------- rozmowa z modelem z narzędziami (Anthropic / OpenAI-zgodne / Gemini) ----------
async function http(fetchImpl, url, opts, timeout = 180000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort());
  try {
    const r = await fetchImpl(url, { ...opts, signal: ac.signal });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* */ }
    if (!r.ok) { const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || text.slice(0, 300); const e = new Error(`AI (${r.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`); e.status = r.status; throw e; }
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error(opts.signal && opts.signal.aborted ? 'Przerwano.' : 'AI nie odpowiedziało w ciągu 3 minut.'); throw e; } finally { clearTimeout(t); }
}
const schema = t => ({ type: 'object', properties: t.params, required: t.required });

async function turn(c, key, sess, { system, tools, fetchImpl, signal }) {
  if (c.kind === 'anthropic') {
    const j = await http(fetchImpl, `${c.base}/messages`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: c.model, max_tokens: 8000, system, messages: sess.msgs, ...(tools ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: schema(t) })) } : {}) }) });
    sess.msgs.push({ role: 'assistant', content: j.content });
    return { text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'), calls: (j.content || []).filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input || {} })) };
  }
  if (c.kind === 'gemini') {
    const j = await http(fetchImpl, `${c.base}/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: sess.msgs, ...(tools ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: schema(t) })) }] } : {}) }) });
    const cand = (j.candidates || [])[0]; if (!cand || !cand.content) throw new Error('AI nie zwróciło odpowiedzi.');
    sess.msgs.push({ role: 'model', parts: cand.content.parts || [] });
    const parts = cand.content.parts || [];
    return { text: parts.map(p => p.text || '').join(''), calls: parts.filter(p => p.functionCall).map((p, i) => ({ id: 'g' + i, name: p.functionCall.name, input: p.functionCall.args || {} })) };
  }
  const headers = { 'content-type': 'application/json' }; if (key) headers.authorization = `Bearer ${key}`;
  if (c.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/Zeis01/codemanager'; headers['X-Title'] = 'CodeManager'; }
  const j = await http(fetchImpl, `${c.base}/chat/completions`, { method: 'POST', signal, headers, body: JSON.stringify({ model: c.model, max_tokens: 8000, messages: [{ role: 'system', content: system }, ...sess.msgs], ...(tools ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schema(t) } })) } : {}) }) });
  const m = ((j.choices || [])[0] || {}).message || {};
  sess.msgs.push({ role: 'assistant', content: m.content || '', ...(m.tool_calls && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}) });
  return { text: m.content || '', calls: (m.tool_calls || []).map(t => { let input = {}; try { input = JSON.parse(t.function.arguments || '{}'); } catch { /* */ } return { id: t.id, name: t.function.name, input }; }) };
}
function pushUser(c, sess, text) {
  if (c.kind === 'gemini') sess.msgs.push({ role: 'user', parts: [{ text }] });
  else sess.msgs.push({ role: 'user', content: text });
}
function pushResults(c, sess, results) {
  if (c.kind === 'anthropic') sess.msgs.push({ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, is_error: !!r.error })) });
  else if (c.kind === 'gemini') sess.msgs.push({ role: 'user', parts: results.map(r => ({ functionResponse: { name: r.name, response: { result: r.text } } })) });
  else for (const r of results) sess.msgs.push({ role: 'tool', tool_call_id: r.id, content: r.text });
}

function systemPrompt({ mode, lang = 'pl', profile, cliEdits }) {
  return `Jesteś asystentem programisty w edytorze kodu programu CodeManager (menedżer modów i serwerów gier). Pomagasz pisać i naprawiać skrypty i mody: zasoby FiveM/RedM (Lua, JS), dodatki Garry's Mod, pluginy BeamMP, pluginy Minecrafta (Java), pluginy Oxide/SourceMod, skrypty Pythona i pliki konfiguracyjne.
${profile ? `Bieżący plik Lua jest pisany pod API: ${profile}. Używaj tylko funkcji, które istnieją w tym API.\n` : ''}Zasady:
- Odpowiadaj ${lang === 'en' ? 'po angielsku' : 'po polsku'}, zwięźle i konkretnie. Kod podawaj w blokach \`\`\` z nazwą języka.
- Nie wymyślaj funkcji ani zdarzeń, których nie znasz – powiedz, jeśli nie masz pewności.
${mode === 'agent' ? `- Masz narzędzia do plików projektu. Zanim zmienisz plik, przeczytaj go (read_file). Do zmian używaj edit_file z dokładnie skopiowanym fragmentem; write_file tylko dla nowych plików albo całkowitej podmiany.
- Zmiany ogranicz do tego, o co poproszono. Po skończeniu krótko opisz, co zmieniłeś i dlaczego.
- Przy błędach serwera sprawdź server_log i get_problems.` : '- Gdy proponujesz zmianę w pliku, podaj gotowy fragment do wstawienia.'}${cliEdits ? '' : ''}`;
}
function contextBlock(ctx = {}, mode) {
  const parts = [];
  if (ctx.root) parts.push(`Folder projektu: ${ctx.root}`);
  if (ctx.file) parts.push(`Otwarty plik: ${ctx.rel || ctx.file} (język: ${ctx.language || '?'})`);
  if (ctx.cursorLine) parts.push(`Kursor w wierszu ${ctx.cursorLine}`);
  if (ctx.selection) parts.push(`Zaznaczony fragment (wiersze ${ctx.selStart}-${ctx.selEnd}):\n\`\`\`\n${String(ctx.selection).slice(0, 12000)}\n\`\`\``);
  if (ctx.problems && ctx.problems.length) parts.push(`Problemy w pliku:\n${ctx.problems.slice(0, 40).map(p => `- wiersz ${p.line}: [${p.severity}] ${p.message}`).join('\n')}`);
  if (ctx.content && (mode !== 'agent' || !ctx.root)) parts.push(`Treść pliku:\n\`\`\`${ctx.language || ''}\n${String(ctx.content).slice(0, 40000)}${ctx.content.length > 40000 ? '\n…(skrócono)' : ''}\n\`\`\``);
  return parts.length ? `[Kontekst z edytora]\n${parts.join('\n\n')}\n[Koniec kontekstu]\n\n` : '';
}

// ---------- zewnętrzni agenci CLI ----------
const CLI = {
  'claude-code': { name: 'Claude Code', bin: 'claude', url: 'https://docs.claude.com/en/docs/claude-code/setup', args: (o) => ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', o.allowEdits ? 'acceptEdits' : 'default', ...(o.resume ? ['--resume', o.resume] : [])], stdin: true },
  codex: { name: 'OpenAI Codex CLI', bin: 'codex', url: 'https://github.com/openai/codex', args: (o) => ['exec', '--skip-git-repo-check', ...(o.allowEdits ? ['--full-auto'] : ['--sandbox', 'read-only']), '-'], stdin: true },
  'gemini-cli': { name: 'Gemini CLI', bin: 'gemini', url: 'https://github.com/google-gemini/gemini-cli', args: (o) => (o.allowEdits ? ['--yolo'] : []), stdin: true },
  aider: { name: 'Aider', bin: 'aider', url: 'https://aider.chat', args: (o) => ['--message-file', o.promptFile, '--no-pretty', '--no-auto-commits', '--yes-always', ...(o.allowEdits ? [] : ['--dry-run'])], stdin: false },
};
function which(bin) {
  return new Promise(res => execFile(U.isWin ? 'where' : 'which', [bin], { windowsHide: true, timeout: 5000 }, (e, out) => res(e ? null : String(out).split(/\r?\n/).map(s => s.trim()).filter(Boolean).sort((a, b) => (/\.(cmd|exe)$/i.test(b) - /\.(cmd|exe)$/i.test(a)))[0] || null)));
}
async function detectCli() { const out = {}; for (const [id, a] of Object.entries(CLI)) { const p = await which(a.bin); out[id] = { name: a.name, installed: !!p, path: p, url: a.url }; } return out; }
// wiersz stream-json z Claude Code → tekst / krok
function parseClaudeLine(line) {
  let j; try { j = JSON.parse(line); } catch { return { text: line + '\n' }; }
  if (j.type === 'system' && j.session_id) return { session: j.session_id };
  if (j.type === 'assistant' && j.message) {
    const out = { text: '', tools: [] };
    for (const b of j.message.content || []) { if (b.type === 'text') out.text += b.text + '\n'; if (b.type === 'tool_use') out.tools.push({ name: b.name, summary: b.input && (b.input.file_path || b.input.path || b.input.command || b.input.pattern || '') }); }
    return out;
  }
  if (j.type === 'result') return { done: true, session: j.session_id, error: j.is_error ? (j.result || 'błąd') : null };
  return null;
}

class Assistant {
  constructor({ getProvider, emit = () => {}, approve, servers, fetchImpl = fetch, spawnImpl = spawn, onWrite = () => {}, lang = () => 'pl' }) {
    Object.assign(this, { getProvider, emit, approve, servers, fetchImpl, spawnImpl, onWrite, lang });
    this.sessions = new Map();
  }
  reset(id) { const s = this.sessions.get(id); if (s && s.proc) try { s.proc.kill(); } catch { /* */ } this.sessions.delete(id); }
  cancel(id) { const s = this.sessions.get(id); if (!s) return; if (s.abort) s.abort.abort(); if (s.proc) try { s.proc.kill(); } catch { /* */ } }
  step(id, data) { this.emit('assistant:step', { session: id, ...data }); }

  async send(id, { provider, model, mode = 'chat', text, context = {}, autoApply = false, allowEdits = false }) {
    if (CLI[provider]) return this.sendCli(id, provider, { text, context, allowEdits });
    const { c, key } = this.getProvider(provider, model);
    if (!c) throw new Error('Wybierz dostawcę AI.');
    if (c.needsKey && !key) throw new Error(`Brak klucza API dla ${c.name} – dodaj go w Ustawieniach → Sztuczna inteligencja.`);
    let s = this.sessions.get(id);
    if (!s || s.provider !== provider || s.model !== c.model || s.mode !== mode) { s = { provider, model: c.model, mode, msgs: [] }; this.sessions.set(id, s); }
    s.abort = new AbortController();
    const agent = mode === 'agent' && context.root;
    const box = agent ? new ToolBox({ root: context.root, problems: context.allProblems || {}, servers: this.servers, autoApply, approve: req => this.approve({ session: id, ...req }), onWrite: f => { this.onWrite(f); this.step(id, { kind: 'write', file: f }); } }) : null;
    const system = systemPrompt({ mode: agent ? 'agent' : 'chat', lang: this.lang(), profile: context.luaProfile });
    pushUser(c, s, contextBlock(context, agent ? 'agent' : 'chat') + text);
    const written = [];
    let tools = agent ? TOOLS : null; let finalText = '';
    for (let i = 0; i < MAX_STEPS; i++) {
      let r;
      try { r = await turn(c, key, s, { system, tools, fetchImpl: this.fetchImpl, signal: s.abort.signal }); }
      catch (e) {
        // model bez obsługi narzędzi (np. część modeli Ollama) – rozmowa bez narzędzi
        if (tools && /tool|function/i.test(e.message) && e.status === 400) { tools = null; this.step(id, { kind: 'info', text: 'Ten model nie obsługuje narzędzi – odpowiada bez dostępu do plików.' }); i--; continue; }
        throw e;
      }
      if (r.text && r.text.trim()) { finalText = r.text; if (r.calls.length) this.step(id, { kind: 'thought', text: r.text }); }
      if (!r.calls.length) break;
      const results = [];
      for (const call of r.calls) {
        if (s.abort.signal.aborted) throw new Error('Przerwano.');
        this.step(id, { kind: 'tool', name: call.name, summary: call.input.path || call.input.query || call.input.dir || call.input.server || '' });
        try { const out = await box.run(call.name, call.input); if (/^(edit|write)_file$/.test(call.name) && /^Zapisano/.test(out)) written.push(call.input.path); results.push({ id: call.id, name: call.name, text: String(out).slice(0, 60000) }); }
        catch (e) { results.push({ id: call.id, name: call.name, text: 'Błąd: ' + e.message, error: true }); }
      }
      pushResults(c, s, results);
      if (i === MAX_STEPS - 1) finalText += '\n\n_(Osiągnięto limit kroków – napisz „kontynuuj”, aby agent działał dalej.)_';
    }
    // pamięć rozmowy: najwyżej ~60 wiadomości
    if (s.msgs.length > 60) s.msgs = s.msgs.slice(-60);
    return { text: finalText.trim(), written, model: c.model, provider: c.name };
  }

  sendCli(id, provider, { text, context, allowEdits }) {
    const a = CLI[provider];
    return new Promise(async (resolve, reject) => {
      const bin = await which(a.bin);
      if (!bin) return reject(new Error(`${a.name} nie jest zainstalowany. Instrukcja: ${a.url}`));
      let s = this.sessions.get(id); if (!s || s.provider !== provider) { s = { provider }; this.sessions.set(id, s); }
      const cwd = context.root || (context.file ? path.dirname(context.file) : os.homedir());
      const prompt = `${context.file ? `Pracuję nad plikiem ${context.rel || context.file}${context.cursorLine ? ` (kursor w wierszu ${context.cursorLine})` : ''}.\n` : ''}${context.selection ? `Zaznaczony fragment:\n\`\`\`\n${String(context.selection).slice(0, 8000)}\n\`\`\`\n` : ''}${text}`;
      let promptFile = null;
      if (!a.stdin) { promptFile = path.join(os.tmpdir(), `cm-agent-${Date.now()}.txt`); fs.writeFileSync(promptFile, prompt); }
      const args = a.args({ allowEdits, resume: s.claudeSession, promptFile });
      const isCmd = U.isWin && /\.(cmd|bat)$/i.test(bin);
      const p = this.spawnImpl(isCmd ? 'cmd.exe' : bin, isCmd ? ['/d', '/s', '/c', bin, ...args] : args, { cwd, windowsHide: true, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' } });
      s.proc = p;
      let out = ''; let buf = ''; let err = ''; let errMsg = null;
      const onLine = line => {
        if (provider === 'claude-code') {
          const r = parseClaudeLine(line); if (!r) return;
          if (r.session) s.claudeSession = r.session;
          for (const t of r.tools || []) this.step(id, { kind: 'tool', name: t.name, summary: t.summary });
          if (r.text) { out += r.text; this.step(id, { kind: 'stream', text: r.text }); }
          if (r.error) errMsg = r.error;
        } else { const t = ansi(line) + '\n'; out += t; this.step(id, { kind: 'stream', text: t }); }
      };
      p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } });
      p.stderr.on('data', d => { err += d; if (provider !== 'claude-code') { const t = ansi(String(d)); out += t; this.step(id, { kind: 'stream', text: t }); } });
      p.on('error', e => reject(new Error(`Nie udało się uruchomić ${a.name}: ${e.message}`)));
      p.on('close', code => {
        if (buf) onLine(buf);
        s.proc = null; if (promptFile) fs.rm(promptFile, { force: true }, () => {});
        if (code !== 0 && !out.trim()) return reject(new Error(`${a.name} zakończył się z kodem ${code}. ${ansi(err).trim().split('\n').slice(-3).join(' ') || ''}${/login|auth|api key/i.test(err) ? ' Zaloguj się w nim raz w terminalu.' : ''}`));
        if (errMsg) return reject(new Error(errMsg));
        resolve({ text: out.trim(), written: [], provider: a.name, cli: true });
      });
      if (a.stdin) { p.stdin.write(prompt); p.stdin.end(); }
    });
  }
}

module.exports = { Assistant, ToolBox, TOOLS, CLI, detectCli, parseClaudeLine, contextBlock, systemPrompt };
