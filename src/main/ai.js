// Sztuczna inteligencja (opcjonalnie): klucz API użytkownika i wybrany dostawca.
// Używana tylko na żądanie – do wyjaśniania logów i zgodności modów.
'use strict';

const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'OpenAI (ChatGPT)', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
  mistral: { name: 'Mistral AI', kind: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { name: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  groq: { name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  xai: { name: 'xAI (Grok)', kind: 'openai', base: 'https://api.x.ai/v1', model: 'grok-3-mini', needsKey: true, keyUrl: 'https://console.x.ai' },
  ollama: { name: 'Ollama (lokalnie, bez klucza)', kind: 'openai', base: 'http://localhost:11434/v1', model: 'llama3.1', needsKey: false, keyUrl: 'https://ollama.com/download' },
  lmstudio: { name: 'LM Studio (lokalnie, bez klucza)', kind: 'openai', base: 'http://localhost:1234/v1', model: '', needsKey: false, keyUrl: 'https://lmstudio.ai' },
  custom: { name: 'Własny (zgodny z OpenAI)', kind: 'openai', base: '', model: '', needsKey: false, keyUrl: null },
};

function cfg(settings) {
  const a = (settings && settings.ai) || {};
  const p = PROVIDERS[a.provider] || null;
  return p ? { id: a.provider, ...p, model: a.model || p.model, base: (a.baseUrl || p.base || '').replace(/\/+$/, ''), enabled: a.enabled !== false } : null;
}

async function http(fetchImpl, url, opts, timeout = 120000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetchImpl(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* */ }
    if (!r.ok) {
      const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || text.slice(0, 300) || ('HTTP ' + r.status);
      const hint = r.status === 401 || r.status === 403 ? ' – sprawdź klucz API.' : r.status === 429 ? ' – limit zapytań lub brak środków na koncie.' : r.status === 404 ? ' – sprawdź nazwę modelu.' : '';
      throw new Error(`AI (${r.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`);
    }
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI nie odpowiedziało w ciągu 2 minut.');
    if (/fetch failed|ECONNREFUSED/i.test(e.message) && /localhost|127\.0\.0\.1/.test(url)) throw new Error('Brak połączenia z lokalnym serwerem AI (czy Ollama jest uruchomiona?).');
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(e.message)) { let host = url; try { host = new URL(url).host; } catch { /* */ } throw new Error(`Brak połączenia z ${host} – sprawdź internet, zaporę albo proxy.`); }
    throw e;
  } finally { clearTimeout(t); }
}

/**
 * messages: [{ role: 'user'|'assistant', content }], system: tekst instrukcji
 */
async function chat(c, key, { system, messages, maxTokens = 1800 }, fetchImpl = fetch) {
  if (!c) throw new Error('Wybierz dostawcę AI w Ustawieniach.');
  if (c.needsKey && !key) throw new Error('Brak klucza API – dodaj go w Ustawieniach → Sztuczna inteligencja.');
  if (!c.base) throw new Error('Podaj adres serwera AI w Ustawieniach.');
  if (!c.model) throw new Error('Podaj nazwę modelu w Ustawieniach.');
  if (c.kind === 'anthropic') {
    const j = await http(fetchImpl, `${c.base}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system, messages }) });
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  }
  if (c.kind === 'gemini') {
    const j = await http(fetchImpl, `${c.base}/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens } }) });
    const cand = (j.candidates || [])[0];
    if (!cand) throw new Error('AI nie zwróciło odpowiedzi' + (j.promptFeedback && j.promptFeedback.blockReason ? ` (zablokowano: ${j.promptFeedback.blockReason})` : '.'));
    return ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('').trim();
  }
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (c.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/Zeis01/codemanager'; headers['X-Title'] = 'CodeManager'; }
  const j = await http(fetchImpl, `${c.base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: c.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }) });
  return ((((j.choices || [])[0] || {}).message || {}).content || '').trim();
}

async function models(c, key, fetchImpl = fetch) {
  if (!c) return [];
  if (c.kind === 'anthropic') { const j = await http(fetchImpl, `${c.base}/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }, 20000); return (j.data || []).map(m => m.id); }
  if (c.kind === 'gemini') { const j = await http(fetchImpl, `${c.base}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, 20000); return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, '')); }
  const j = await http(fetchImpl, `${c.base}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} }, 20000);
  return (j.data || []).map(m => m.id).sort();
}

// ---------- treść zapytań ----------
const LANG = { pl: 'Odpowiadaj po polsku.', en: 'Answer in English.' };
function system(lang = 'pl') {
  return `Jesteś pomocnikiem w programie CodeManager – menedżerze modów i serwerów gier. Pomagasz zwykłym graczom, którzy nie znają się na programowaniu.
Zasady:
- Najpierw jednym-dwoma zdaniami powiedz, co jest najbardziej prawdopodobną przyczyną.
- Potem podaj konkretne kroki do wykonania (lista numerowana), od najprostszego.
- Wskazuj mody po nazwie, gdy log lub raport na to pozwala. Nie wymyślaj modów, których nie ma w danych.
- Jeśli danych jest za mało, powiedz, czego brakuje (np. jaki log wkleić).
- Pisz zwięźle, bez wstępów. Używaj Markdown: krótkie nagłówki, listy, \`kod\` dla nazw plików.
${LANG[lang] || LANG.pl}`;
}
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '\n…(skrócono)' : s || '');

// fragment logu: końcówka + wiersze z błędami z całego pliku
function logExcerpt(text, max = 14000) {
  const lines = String(text || '').split(/\r?\n/);
  const errIdx = [];
  lines.forEach((l, i) => { if (/(\bERROR\b|\bFATAL\b|\bSEVERE\b|Exception|Caused by|Error:|\bfailed\b|crash)/i.test(l)) errIdx.push(i); });
  const pick = new Set();
  for (const i of errIdx.slice(0, 40)) for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 6); j++) pick.add(j);
  const head = lines.slice(0, 15).join('\n');
  const errs = [...pick].sort((a, b) => a - b).map(i => lines[i]).join('\n');
  const tail = lines.slice(-120).join('\n');
  return clip(`--- POCZĄTEK ---\n${head}\n--- WIERSZE Z BŁĘDAMI ---\n${errs}\n--- KONIEC LOGU ---\n${tail}`, max);
}
function modsBlock(mods, max = 6000) {
  if (!mods || !mods.length) return '';
  return clip(mods.map(m => `- ${m.enabled ? '' : '[wyłączony] '}${m.name}${m.version && m.version !== '-' ? ' ' + m.version : ''}${m.id && m.id !== m.name ? ` (${m.id})` : ''}`).join('\n'), max);
}
function logPrompt({ target, log, findings, mods, meta }) {
  return `Wyjaśnij, dlaczego ${target || 'gra lub serwer'} się wyłącza lub nie działa, i co zrobić.
${meta ? `\nKontekst:\n${Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n` : ''}
${findings && findings.length ? `Program rozpoznał już (reguły):\n${findings.map(f => `- [${f.level}] ${f.title}${f.mod ? ` (mod: ${f.mod})` : ''}`).join('\n')}\n` : ''}
${mods && mods.length ? `Zainstalowane mody:\n${modsBlock(mods)}\n` : ''}
Log:
\`\`\`
${logExcerpt(log)}
\`\`\``;
}
function modsPrompt({ target, report }) {
  const iss = (report.issues || []).filter(i => i.level !== 'ok').slice(0, 60);
  return `Oceń zestaw modów: ${target}. Powiedz, co może powodować problemy, w jakiej kolejności to naprawić i czy jakieś mody są zbędne lub się dublują.
${report.meta ? `\nKontekst:\n${Object.entries(report.meta).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n` : ''}
Problemy wykryte przez program:
${iss.length ? iss.map(i => `- [${i.level}] ${i.title}${i.fix ? ` – ${i.fix}` : ''}`).join('\n') : '- brak'}

Mody:
${modsBlock(report.mods || [], 9000)}`;
}


// ---------- rozpoznawanie kluczy (wiele naraz: plik .env albo same klucze) ----------
const ENV_NAMES = { ANTHROPIC_API_KEY: 'anthropic', CLAUDE_API_KEY: 'anthropic', OPENAI_API_KEY: 'openai', GEMINI_API_KEY: 'gemini', GOOGLE_API_KEY: 'gemini', GOOGLE_GENERATIVE_AI_API_KEY: 'gemini', OPENROUTER_API_KEY: 'openrouter', MISTRAL_API_KEY: 'mistral', DEEPSEEK_API_KEY: 'deepseek', GROQ_API_KEY: 'groq', XAI_API_KEY: 'xai', GROK_API_KEY: 'xai' };
const ENV_FOR = Object.fromEntries(['anthropic', 'openai', 'gemini', 'openrouter', 'mistral', 'deepseek', 'groq', 'xai'].map(id => [id, Object.keys(ENV_NAMES).find(k => ENV_NAMES[k] === id)]));
function guessProvider(key) {
  if (/^sk-ant-/.test(key)) return 'anthropic';
  if (/^sk-or-/.test(key)) return 'openrouter';
  if (/^AIza[\w-]{30,}$/.test(key)) return 'gemini';
  if (/^gsk_/.test(key)) return 'groq';
  if (/^xai-/.test(key)) return 'xai';
  if (/^sk-[0-9a-f]{32}$/.test(key)) return 'deepseek';
  if (/^sk-(proj-|svcacct-|admin-)?[\w-]{20,}$/.test(key)) return 'openai';
  return null;
}
// zwraca { found: [{ provider, key, source }], unknown: [fragment] }
function detectKeys(text) {
  const found = []; const unknown = [];
  const add = (provider, key, source) => { if (!found.some(f => f.provider === provider)) found.push({ provider, key, source }); else { const f = found.find(x => x.provider === provider); if (f.source === 'prefiks' && source !== 'prefiks') Object.assign(f, { key, source }); } };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+|set\s+|\$env:)?([A-Z][A-Z0-9_]*)\s*[=:]\s*["']?([^"'\s]+)["']?/);
    if (m) { const p = ENV_NAMES[m[1]] || (/KEY|TOKEN/.test(m[1]) ? guessProvider(m[2]) : null); if (p) add(p, m[2], m[1]); else if (/KEY|TOKEN/.test(m[1])) unknown.push(m[1]); continue; }
    for (const tok of line.split(/[\s,;|]+/)) { const k = tok.replace(/^["'`]+|["'`]+$/g, ''); if (k.length < 20) continue; const p = guessProvider(k); if (p) add(p, k, 'prefiks'); else if (/^[\w-]{30,}$/.test(k)) unknown.push(k.slice(0, 6) + '…'); }
  }
  return { found, unknown };
}

module.exports = { detectKeys, guessProvider, ENV_NAMES, ENV_FOR, PROVIDERS, cfg, chat, models, system, logPrompt, modsPrompt, logExcerpt };
