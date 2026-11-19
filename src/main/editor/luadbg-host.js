// Proces debugera Lua (uruchamiany przez CodeManager z ELECTRON_RUN_AS_NODE=1).
// Wykonuje skrypt w maszynie Lua 5.3 (fengari) i mówi uproszczonym DAP przez wiersze JSON:
//   stdout: {"type":"event"|"response",...}   stdin: {"seq":1,"command":"continue","arguments":{}}
// Gdy skrypt działa, polecenia (pauza, punkty zatrzymania) przychodzą przez plik sterujący.
'use strict';
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

const [, , program, ctlFile, cwdArg, ...scriptArgs] = process.argv;
const isWin = process.platform === 'win32';
if (cwdArg) try { process.chdir(cwdArg); } catch { /* */ }

// ---------- wymiana komunikatów ----------
const send = obj => { try { fs.writeSync(1, JSON.stringify(obj) + '\n'); } catch { /* */ } };
let inBuf = '';
function recvSync() {
  const b = Buffer.alloc(65536);
  for (;;) {
    const i = inBuf.indexOf('\n');
    if (i >= 0) { const line = inBuf.slice(0, i); inBuf = inBuf.slice(i + 1); if (line.trim()) { try { return JSON.parse(line); } catch { continue; } } continue; }
    let n = 0;
    try { n = fs.readSync(0, b, 0, b.length, null); } catch (e) { if (e.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); continue; } if (e.code === 'EOF') n = 0; else throw e; }
    if (!n) return { command: 'disconnect' };
    inBuf += b.toString('utf8', 0, n);
  }
}
let ctlStamp = 0;
function pollCtl() {
  try { const st = fs.statSync(ctlFile); if (st.mtimeMs === ctlStamp) return null; ctlStamp = st.mtimeMs; return JSON.parse(fs.readFileSync(ctlFile, 'utf8')); } catch { return null; }
}

// ---------- JS <-> Lua ----------
function push(L, v) {
  if (v === null || v === undefined) lua.lua_pushnil(L);
  else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
  else if (typeof v === 'number') { if (Number.isInteger(v)) lua.lua_pushinteger(L, v); else lua.lua_pushnumber(L, v); }
  else if (typeof v === 'string') lua.lua_pushstring(L, to_luastring(v));
  else if (Array.isArray(v)) { lua.lua_createtable(L, v.length, 0); v.forEach((x, i) => { push(L, x); lua.lua_rawseti(L, -2, i + 1); }); }
  else { lua.lua_createtable(L, 0, 0); for (const [k, x] of Object.entries(v)) { push(L, x); lua.lua_setfield(L, -2, to_luastring(k)); } }
}
function pull(L, idx, depth = 0) {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, idx));
  if (t === lua.LUA_TTABLE && depth < 8) {
    idx = lua.lua_absindex(L, idx); const entries = [];
    lua.lua_pushnil(L);
    while (lua.lua_next(L, idx)) { const k = lua.lua_type(L, -2) === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : to_jsstring(lua.lua_tostring(L, -2)); entries.push([k, pull(L, -1, depth + 1)]); lua.lua_pop(L, 1); }
    const isArr = entries.length && entries.every(([k]) => typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= entries.length);
    if (isArr) { const out = new Array(entries.length); for (const [k, v] of entries) out[k - 1] = v; return out; }
    return Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
  }
  return null;
}

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const reg = (name, fn) => { lua.lua_pushcfunction(L, fn); lua.lua_setglobal(L, to_luastring(name)); };
reg('__cm_send', L2 => { send(pull(L2, 1)); return 0; });
reg('__cm_recv', L2 => { push(L2, recvSync()); return 1; });
reg('__cm_ctl', L2 => { const c = pollCtl(); push(L2, c); return 1; });
reg('__cm_write', L2 => { const n = lua.lua_gettop(L2); const out = []; for (let i = 1; i <= n; i++) out.push(to_jsstring(lauxlib.luaL_tolstring(L2, i))); lua.lua_settop(L2, n); send({ type: 'event', event: 'output', body: { category: 'stdout', output: out.join('') } }); return 0; });

const DBG = String.raw`
local send, recv, ctl, write = __cm_send, __cm_recv, __cm_ctl, __cm_write
__cm_send, __cm_recv, __cm_ctl, __cm_write = nil, nil, nil, nil
local IS_WIN = ...
local function norm(p) p = tostring(p):gsub('\\', '/') if IS_WIN then p = p:lower() end return p end
local bps = {}            -- [plik][wiersz] = true
local mode, target, pauseReq = 'run', 0, false
local counter = 0
local refs, nextRef = {}, 1
local frames = {}
local sethook, getinfo, getlocal, getupvalue = debug.sethook, debug.getinfo, debug.getlocal, debug.getupvalue

print = function(...) local t = table.pack(...) for i = 1, t.n do t[i] = tostring(t[i]) end write(table.concat(t, '\t', 1, t.n) .. '\n') end
io.write = function(...) write(...) return io end

local function setBps(list) bps = {} for f, lines in pairs(list or {}) do local s = {} for _, l in ipairs(lines) do s[l] = true end bps[norm(f)] = s end end
local function applyCtl(c) if not c then return end if c.breakpoints then setBps(c.breakpoints) end if c.pause then pauseReq = true end end

local function depth() local d = 0 while getinfo(d + 4, 'S') do d = d + 1 end return d end

local function short(v)
  local t = type(v)
  if t == 'string' then return string.format('%q', #v > 200 and v:sub(1, 200) .. '…' or v) end
  if t == 'table' then local n = 0 for _ in pairs(v) do n = n + 1 if n > 999 then break end end return 'table (' .. n .. (n > 999 and '+' or '') .. ')' end
  return tostring(v)
end
local function ref(v) if type(v) ~= 'table' then return 0 end refs[nextRef] = v nextRef = nextRef + 1 return nextRef - 1 end
local function var(name, v) return { name = tostring(name), value = short(v), type = type(v), variablesReference = ref(v) } end

local function collect()
  frames = {}
  local lvl = 4
  while true do
    local i = getinfo(lvl, 'nSl')
    if not i then break end
    if i.what ~= 'C' and i.source:sub(1, 1) == '@' then frames[#frames + 1] = { level = lvl, info = i } end
    lvl = lvl + 1
  end
end

local function localsOf(fr, extra)
  local out, lvl = {}, fr.level + (extra or 0)
  local i = 1
  while true do local n, v = getlocal(lvl, i) if not n then break end if n:sub(1, 1) ~= '(' then out[#out + 1] = { n, v } end i = i + 1 end
  return out
end
local function upvaluesOf(fr, extra)
  local f = getinfo(fr.level + (extra or 0), 'f').func
  local out, i = {}, 1
  while f do local n, v = getupvalue(f, i) if not n then break end if n ~= '_ENV' then out[#out + 1] = { n, v } end i = i + 1 end
  return out
end

local function respond(req, body, ok, msg) send({ type = 'response', request_seq = req.seq, command = req.command, success = ok ~= false, message = msg, body = body or {} }) end

local function evaluate(fr, expr)
  local env = setmetatable({}, { __index = _G, __newindex = _G })
  if fr then for _, p in ipairs(upvaluesOf(fr, 1)) do rawset(env, p[1], p[2]) end for _, p in ipairs(localsOf(fr, 1)) do rawset(env, p[1], p[2]) end end
  local f, err = load('return ' .. expr, '=konsola', 't', env)
  if not f then f, err = load(expr, '=konsola', 't', env) end
  if not f then return nil, err end
  local res = table.pack(pcall(f))
  if not res[1] then return nil, tostring(res[2]) end
  if res.n < 2 then return var('wynik', nil) end
  return var('wynik', res[2])
end

local function paused(reason, line)
  refs, nextRef = {}, 1
  -- poziomy stosu liczone od funkcji paused (hook = 2, paused = 1)
  collect()
  send({ type = 'event', event = 'stopped', body = { reason = reason, threadId = 1, allThreadsStopped = true } })
  while true do
    local req = recv()
    local cmd, a = req.command, req.arguments or {}
    if cmd == 'continue' then mode = 'run' respond(req, { allThreadsContinued = true }) break
    elseif cmd == 'next' then mode, target = 'next', depth() - 1 respond(req) break
    elseif cmd == 'stepIn' then mode = 'step' respond(req) break
    elseif cmd == 'stepOut' then mode, target = 'out', depth() - 1 respond(req) break
    elseif cmd == 'disconnect' or cmd == 'terminate' then respond(req) os.exit(0)
    elseif cmd == 'threads' then respond(req, { threads = { { id = 1, name = 'Lua' } } })
    elseif cmd == 'stackTrace' then
      local sf = {}
      for i, fr in ipairs(frames) do local inf = fr.info sf[#sf + 1] = { id = i, name = inf.name or (i == #frames and 'główny fragment' or 'funkcja'), line = inf.currentline, column = 1, source = { path = inf.source:sub(2), name = inf.short_src } } end
      respond(req, { stackFrames = sf, totalFrames = #sf })
    elseif cmd == 'scopes' then
      local id = a.frameId or 1
      respond(req, { scopes = { { name = 'Zmienne lokalne', variablesReference = -(id * 2), expensive = false }, { name = 'Zmienne zewnętrzne (upvalue)', variablesReference = -(id * 2 + 1), expensive = false }, { name = 'Globalne', variablesReference = ref(_G), expensive = true } } })
    elseif cmd == 'variables' then
      local r, out = a.variablesReference, {}
      if r < 0 then
        local fid = math.floor(-r / 2) local fr = frames[fid]
        if fr then for _, p in ipairs((-r) % 2 == 0 and localsOf(fr) or upvaluesOf(fr)) do out[#out + 1] = var(p[1], p[2]) end end
      elseif refs[r] then
        local keys = {}
        for k in pairs(refs[r]) do keys[#keys + 1] = k if #keys >= 500 then break end end
        table.sort(keys, function(x, y) if type(x) == type(y) and (type(x) == 'number' or type(x) == 'string') then return x < y end return type(x) < type(y) end)
        for _, k in ipairs(keys) do out[#out + 1] = var(type(k) == 'string' and k or '[' .. tostring(k) .. ']', refs[r][k]) end
      end
      respond(req, { variables = out })
    elseif cmd == 'evaluate' then
      local v, err = evaluate(frames[a.frameId or 1], a.expression or '')
      if v then respond(req, { result = v.value, type = v.type, variablesReference = v.variablesReference }) else respond(req, nil, false, err) end
    elseif cmd == 'setBreakpoints' then
      local lines = {} for _, b in ipairs(a.breakpoints or {}) do lines[#lines + 1] = b.line end
      local s = {} for _, l in ipairs(lines) do s[l] = true end bps[norm(a.source.path)] = s
      local res = {} for _, l in ipairs(lines) do res[#res + 1] = { verified = true, line = l } end
      respond(req, { breakpoints = res })
    else respond(req, nil, false, 'nieobsługiwane: ' .. tostring(cmd)) end
  end
  send({ type = 'event', event = 'continued', body = { threadId = 1, allThreadsContinued = true } })
end

local function hook(ev, line)
  counter = counter + 1
  if counter % 2000 == 0 then applyCtl(ctl()) end
  local src = getinfo(2, 'S').source
  if src:sub(1, 1) ~= '@' then return end
  local stop
  local bl = bps[norm(src:sub(2))]
  if bl and bl[line] then stop = 'breakpoint'
  elseif mode == 'step' then stop = 'step'
  elseif mode == 'next' and depth() <= target then stop = 'step'
  elseif mode == 'out' and depth() < target then stop = 'step'
  elseif pauseReq then stop = 'pause' end
  if stop then pauseReq = false mode = 'run' paused(stop, line) end
end

-- korutyny dziedziczą hak
local cocreate, cowrap = coroutine.create, coroutine.wrap
coroutine.create = function(f) local co = cocreate(f) sethook(co, hook, 'l') return co end
coroutine.wrap = function(f) local co = coroutine.create(f) return function(...) local r = table.pack(coroutine.resume(co, ...)) if not r[1] then error(r[2], 0) end return table.unpack(r, 2, r.n) end end

return function(program, args, init)
  applyCtl(init)
  if init and init.stopOnEntry then mode = 'step' end
  local chunk, err = loadfile(program)
  if not chunk then return false, err end
  arg = args
  sethook(hook, 'l')
  local ok, e = xpcall(chunk, function(m) return debug.traceback(tostring(m), 2) end, table.unpack(args))
  sethook()
  return ok, e
end
`;

// ---------- start ----------
const init = (() => { try { return JSON.parse(fs.readFileSync(ctlFile, 'utf8')); } catch { return {}; } })();
try { ctlStamp = fs.statSync(ctlFile).mtimeMs; } catch { /* */ }
lua.lua_settop(L, 0);
if (lauxlib.luaL_loadbuffer(L, to_luastring(DBG), null, to_luastring('=cm-debugger')) !== lua.LUA_OK) { send({ type: 'event', event: 'output', body: { category: 'stderr', output: to_jsstring(lua.lua_tostring(L, -1)) } }); process.exit(1); }
lua.lua_pushboolean(L, isWin);
lua.lua_call(L, 1, 1); // funkcja uruchamiająca
// package.path: folder skryptu
lauxlib.luaL_dostring(L, to_luastring(`package.path = ${JSON.stringify(path.dirname(path.resolve(program)).replace(/\\/g, '/') + '/?.lua;')} .. ${JSON.stringify(path.dirname(path.resolve(program)).replace(/\\/g, '/') + '/?/init.lua;')} .. package.path`));
send({ type: 'event', event: 'initialized', body: {} });
push(L, path.resolve(program));
push(L, scriptArgs);
push(L, init);
lua.lua_call(L, 3, 2);
const ok = lua.lua_toboolean(L, -2);
if (!ok) send({ type: 'event', event: 'output', body: { category: 'stderr', output: String(to_jsstring(lua.lua_tostring(L, -1)) || 'błąd') + '\n' } });
send({ type: 'event', event: 'exited', body: { exitCode: ok ? 0 : 1 } });
send({ type: 'event', event: 'terminated', body: {} });
process.exit(ok ? 0 : 1);
