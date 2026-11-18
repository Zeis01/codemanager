// Ustawienia
'use strict';
App.views = App.views || {};
App.views.settings = {
  async render(el, params = {}) {
    const { $, $$, icon, esc, api, toast } = App;
    const s = App.state.settings;
    const info = await api('app:info');
    el.innerHTML = `<div class="head"><div class="grow"><h1>Ustawienia</h1></div></div>
      <div class="panel" style="margin-bottom:12px"><div class="panel-head"><h2>Wygląd</h2><button class="btn sm" data-tedit>${icon('edit')}Edytuj motyw…</button><button class="btn sm" data-timport>${icon('import')}Importuj motyw…</button><button class="btn sm" data-tsave>${icon('save')}Zapisz bieżący jako plik</button><button class="btn sm" data-tdir>${icon('folder')}Folder motywów</button></div>
        <div class="themes" data-themes></div><div data-terr></div>
        <p class="dim" style="font-size:12px;margin:10px 0 0">Własne motywy to pliki <span class="mono">nazwa.theme.json</span> w folderze motywów (opis formatu w pliku README.txt). Zmiany w plikach są widoczne od razu po zapisaniu.</p></div>
      <div class="grid two" style="align-items:start">
        <div class="panel">
          <h2 style="margin-bottom:14px">Ścieżki</h2>
          <div class="field"><label>Folder Steam (opcjonalnie)</label><div class="inline-input"><input class="input mono" data-k="steamPath" value="${esc(s.steamPath || '')}" placeholder="wykrywany automatycznie"><button class="btn" data-b="steamPath">${icon('folder')}</button></div><span class="hint">Podaj, jeśli Steam jest w nietypowym miejscu.</span></div>
          <div class="field"><label>Domyślny folder serwerów</label><div class="inline-input"><input class="input mono" data-k="serversPath" value="${esc(s.serversPath || '')}" placeholder="~/CodeManager-Servers"><button class="btn" data-b="serversPath">${icon('folder')}</button></div></div>
          <div class="field"><label>Java (dla Minecrafta)</label><div class="inline-input"><input class="input mono" data-k="javaPath" value="${esc(s.javaPath || '')}" placeholder="wykrywana automatycznie"><button class="btn" data-java>${icon('search')}Znajdź</button></div><span class="hint" data-javares>MC 1.20.5+ wymaga Javy 21, 1.18–1.20.4 Javy 17.</span></div>
          <div class="field"><label>Folder nowych instancji Minecraft (import .mrpack)</label><div class="inline-input"><input class="input mono" data-k="instancesPath" value="${esc(s.instancesPath || '')}" placeholder="~/CodeManager-Instances"><button class="btn" data-b="instancesPath">${icon('folder')}</button></div></div>
          <button class="btn primary" data-save>${icon('save')}Zapisz</button>
          <h2 style="margin:26px 0 10px">Nexus Mods</h2>
          <div data-nexus></div>
          <h2 style="margin:26px 0 10px" id="set-workshop">Warsztat Steam</h2>
          <div data-ws></div>
        </div>
        <div class="panel">
          <h2 style="margin-bottom:14px">Edytor</h2>
          <div class="field"><label>Rozmiar czcionki</label><input class="input" type="number" data-k="editorFontSize" value="${esc(s.editorFontSize || 14)}" min="10" max="28"></div>
          <label class="check" style="margin-bottom:10px"><input type="checkbox" data-k="editorMinimap" ${s.editorMinimap !== false ? 'checked' : ''}><span>Minimapa</span></label>
          <label class="check" style="margin-bottom:10px"><input type="checkbox" data-k="editorWrap" ${s.editorWrap ? 'checked' : ''}><span>Zawijanie wierszy</span></label>
          <label class="check" style="margin-bottom:10px"><input type="checkbox" data-k="editorSuggest" ${s.editorSuggest !== false ? 'checked' : ''}><span>Podpowiedzi podczas pisania (Python, Lua, JavaScript…)</span></label>
          <div class="field"><label>Python do podpowiedzi (opcjonalnie)</label><div class="inline-input"><input class="input mono" data-k="pythonPath" value="${esc(s.pythonPath || '')}" placeholder="wykrywany automatycznie (py, python)"><button class="btn" data-pycheck>${icon('search')}Sprawdź</button></div><span class="hint" data-pyres>Podpowiedzi modułów (np. time., os.path.) pochodzą z Pythona na tym komputerze – także dla doinstalowanych pakietów. Bez Pythona działa wbudowana baza biblioteki standardowej.</span></div>
          <label class="check"><input type="checkbox" data-k="editorAutosave" ${s.editorAutosave ? 'checked' : ''}><span>Autozapis po 1 s bezczynności</span></label>
          <h2 style="margin:24px 0 10px">Aktualizacje programu</h2>
          <div data-upd></div>
          <h2 style="margin:24px 0 10px">O programie</h2>
          <dl class="meta-list"><dt>Wersja</dt><dd>${esc(info.version)}</dd><dt>Electron</dt><dd>${esc(info.electron)}</dd><dt>Dane aplikacji</dt><dd class="path">${esc(info.userData)}</dd></dl>
          <div class="row" style="margin-top:12px"><button class="btn" data-ud>${icon('folder')}Otwórz dane aplikacji</button></div>
          <p class="dim" style="font-size:12.5px;margin:14px 0 0">Kopie zapasowe plików nadpisanych przez instalatory trafiają do podfolderu <span class="mono">backups</span>.</p>
        </div>
      </div>
      <div class="grid two" style="align-items:start;margin-top:12px">
        <div class="panel">
          <h2 style="margin-bottom:12px">Powiadomienia</h2>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" data-n="enabled" ${(s.notifications || {}).enabled !== false ? 'checked' : ''}><span>Powiadomienia systemowe Windows</span></label>
          <div class="checks-grid" style="margin:0 0 12px 26px">${[['crash', 'Serwer padł', true], ['backup', 'Kopia zapasowa gotowa', true], ['backup-failed', 'Kopia nie powiodła się', true], ['update', 'Nowa wersja programu', true], ['join', 'Gracz dołączył', false], ['start', 'Serwer uruchomiony', false]].map(([k, l, d]) => `<label class="check"><input type="checkbox" data-ne="${k}" ${((s.notifications || {}).events || {})[k] ?? d ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <button class="btn sm ghost" data-ntest>${icon('bulb')}Pokaż testowe powiadomienie</button>
          <h3 style="margin:20px 0 8px">Discord</h3>
          <div class="field"><label>Webhook kanału</label><div class="inline-input"><input class="input mono" data-dc value="${esc((s.discord || {}).url || '')}" placeholder="https://discord.com/api/webhooks/…"><button class="btn" data-dctest>Test</button></div><span class="hint">Ustawienia kanału Discord → Integracje → Webhooki → Nowy webhook → Kopiuj adres. Każdy serwer może mieć własny webhook (zakładka Ustawienia serwera).</span></div>
          <div class="checks-grid" style="margin:0 0 12px">${[['start', 'Start serwera', true], ['stop', 'Zatrzymanie', true], ['crash', 'Awaria', true], ['join', 'Wejście gracza', false], ['leave', 'Wyjście gracza', false], ['backup', 'Kopia zapasowa', true], ['backup-failed', 'Błąd kopii', true]].map(([k, l, d]) => `<label class="check"><input type="checkbox" data-de="${k}" ${((s.discord || {}).events || {})[k] ?? d ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <button class="btn primary" data-nsave>${icon('save')}Zapisz powiadomienia</button>
        </div>
        <div class="panel">
          <h2 style="margin-bottom:12px">Program</h2>
          <div class="field"><label>Język / Language</label><select class="input" data-k="language"><option value="pl">Polski</option><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select><span class="hint">Język interfejsu. Opisy problemów z analizy modów i logów są po polsku.</span></div>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" data-k="tray" ${s.tray ? 'checked' : ''}><span>Ikona w zasobniku systemowym – zamknięcie okna nie wyłącza serwerów</span></label>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" data-k="trackPlaytime" ${s.trackPlaytime !== false ? 'checked' : ''}><span>Licz czas gry (sprawdza co 30 s, czy gra jest uruchomiona)</span></label>
          <h3 style="margin:18px 0 8px">Mody</h3>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" data-k="autoSnapshot" ${s.autoSnapshot !== false ? 'checked' : ''}><span>Migawka przed zmianami (aktualizacja, instalacja, profil, naprawa)</span></label>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px;margin-left:26px"><div class="field"><label>Ile migawek na grę</label><input class="input" type="number" min="2" max="100" data-k="snapshotKeep" value="${esc(s.snapshotKeep || 10)}"></div><div class="field"><label>Limit migawki automatycznej (GB)</label><input class="input" type="number" min="0.1" step="0.5" data-k="autoSnapshotMaxGB" value="${esc(s.autoSnapshotMaxGB || 1)}"></div></div>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" data-k="warnBeforeInstall" ${s.warnBeforeInstall !== false ? 'checked' : ''}><span>Ostrzegaj przed konfliktami przed instalacją moda</span></label>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" data-k="programTrash" ${s.programTrash !== false ? 'checked' : ''}><span>Usunięte mody trzymaj 30 dni w koszu CodeManager</span></label>
          <div class="row" style="margin:0 0 4px 26px"><button class="btn sm" data-trash>${icon('trash')}Otwórz kosz</button></div>
          <div class="field" style="margin-top:10px"><label>Ile kopii zapisów gry trzymać</label><input class="input" type="number" min="3" max="200" data-k="saveKeep" value="${esc(s.saveKeep || 20)}" style="max-width:160px"></div>
          <h3 style="margin:18px 0 8px">Tryb przenośny</h3>
          <div data-portable><span class="dim">…</span></div>
        </div>
      </div>
      <div class="panel" style="margin-top:12px" id="set-ai"><div class="panel-head"><h2>Sztuczna inteligencja (opcjonalnie)</h2><span class="dim" data-aist></span></div>
        <p class="muted" style="font-size:13px;margin:0 0 12px">Z własnym kluczem API możesz poprosić AI o wyjaśnienie logu w Analizatorze („Wyjaśnij z AI”), o ocenę zestawu modów w zakładce Zgodność („Zapytaj AI”) i o opis pojedynczego moda. AI działa tylko po kliknięciu. Do dostawcy trafia fragment logu i lista modów, a ścieżki z nazwą konta są ukrywane.</p>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px">
          <div class="field"><label>Dostawca</label><select class="input" data-aip></select></div>
          <div class="field"><label>Model</label><div class="inline-input"><input class="input mono" data-aim list="ai-models" placeholder="domyślny"><button class="btn" data-aimodels title="Pobierz listę modeli">${icon('refresh')}</button></div><datalist id="ai-models"></datalist></div>
          <div class="field"><label>Klucz API</label><div class="inline-input"><input class="input mono" type="password" data-aik placeholder="wklej klucz"><button class="btn" data-aikurl title="Strona z kluczami">${icon('globe')}</button></div><span class="hint" data-aikh></span></div>
          <div class="field" data-aibasef><label>Adres serwera (zgodny z OpenAI)</label><input class="input mono" data-aib placeholder="http://localhost:11434/v1"></div>
        </div>
        <div class="row"><button class="btn primary" data-aisave>${icon('save')}Zapisz</button><button class="btn" data-aitest>${icon('pulse')}Sprawdź połączenie</button><button class="btn ghost danger" data-aidel>Usuń klucz</button><span class="dim" style="font-size:12.5px" data-aires></span></div>
      </div>`;
    const drawThemes = () => {
      const box = $('[data-themes]', el); box.innerHTML = '';
      const opts = [...Object.entries(Themes.BUILTIN).map(([k, t]) => ({ id: 'builtin:' + k, theme: t, src: 'Wbudowany' })), ...App.themeFiles.map(f => ({ id: f.id, theme: f.theme, src: f.file, error: f.error }))];
      for (const o of opts) {
        const r = o.theme ? Themes.resolve(o.theme, Object.fromEntries(App.themeFiles.filter(f => f.theme).map(f => [f.file.replace(/\.theme\.json$/i, ''), f]))) : null;
        const c = r ? r.colors : null;
        const b = App.h(`<button class="theme-opt ${App.state.themeId === o.id ? 'sel' : ''}" ${o.error ? 'disabled' : ''} title="${esc(o.error || '')}">
          <div class="pv">${c ? `<i style="background:${c.sidebar || c.bg0}"></i><span class="c" style="background:${c.bg1}"><b style="background:${c.bg3};width:70%"></b><b style="background:${c.text3};width:50%;opacity:.6"></b><b style="background:${c.accentStrong};width:34%;margin-top:auto;height:9px"></b></span>` : '<i style="background:var(--error-soft);grid-column:1/3"></i>'}</div>
          <div class="nm">${esc(r ? r.name : o.src)}</div><div class="src">${esc(o.error ? 'Błąd w pliku' : o.src)}</div></button>`);
        b.onclick = async () => { App.applyTheme(o.id); await api('themes:select', o.id); drawThemes(); };
        box.appendChild(b);
      }
      const errs = App.themeFiles.filter(f => f.error).map(f => `${f.file}: ${f.error}`).concat((App.state.themeWarnings || []).map(w => 'Bieżący motyw: ' + w));
      $('[data-terr]', el).innerHTML = errs.map(e => `<div class="theme-err">${esc(e)}</div>`).join('');
    };
    drawThemes();
    App.onThemesChanged = () => { if (App.current() === 'settings') drawThemes(); };
    $('[data-tdir]', el).onclick = () => api('themes:folder');
    $('[data-tedit]', el).onclick = () => themeEditor(drawThemes);
    $('[data-timport]', el).onclick = async () => { const f = (await api('dialog:files', 'Wybierz plik motywu', [{ name: 'Motyw', extensions: ['json'] }]))[0]; if (!f) return; const id = await api('themes:import', f); await App.loadThemes(); App.applyTheme(id); await api('themes:select', id); drawThemes(); toast('Zaimportowano motyw'); };
    $('[data-tsave]', el).onclick = async () => {
      const n = await App.promptBox('Zapisz motyw jako plik', 'Nazwa motywu', 'Mój motyw'); if (!n) return;
      const cur = Themes.current();
      const r = await api('themes:save', n, { name: n, type: cur.type, colors: cur.colors, radius: cur.radius, fonts: cur.fonts });
      await App.loadThemes(); App.applyTheme(r.id); await api('themes:select', r.id); drawThemes();
      toast('Zapisano – plik możesz edytować w folderze motywów'); api('shell:show', r.path);
    };
    $$('[data-b]', el).forEach(b => b.onclick = async () => { const p = await api('dialog:folder'); if (p) $(`[data-k="${b.dataset.b}"]`, el).value = p; });
    $('[data-ud]', el).onclick = () => api('shell:open', info.userData);
    $('[data-pycheck]', el).onclick = async () => {
      const r = $('[data-pyres]', el); r.textContent = 'Sprawdzam…';
      App.state.settings = await api('settings:set', { pythonPath: $('[data-k="pythonPath"]', el).value.trim() });
      const st = await api('py:reset'); if (window.EditorComplete) EditorComplete.reset();
      r.textContent = st.found ? `Znaleziono Python ${st.version} (${st.cmd}) – podpowiedzi obejmą też pakiety zainstalowane przez pip.` : 'Nie znaleziono Pythona. Podpowiedzi korzystają z wbudowanej bazy biblioteki standardowej. Python pobierzesz z python.org.';
    };
    $('[data-java]', el).onclick = async () => {
      const r = $('[data-javares]', el); r.textContent = 'Szukam…';
      const list = await api('java:list');
      r.innerHTML = list.length ? list.map(j => `Java ${j.major} – <span class="mono">${esc(j.path)}</span>`).join('<br>') : 'Nie znaleziono Javy. Pobierz Eclipse Temurin z adoptium.net.';
      if (list.length && !$('[data-k="javaPath"]', el).value) $('[data-k="javaPath"]', el).value = list.sort((a, b) => b.major - a.major)[0].path;
    };
    $('[data-save]', el).onclick = save;
    const nxBox = $('[data-nexus]', el);
    const drawNx = async () => {
      const st = await api('nexus:status');
      nxBox.innerHTML = st.connected
        ? `<p style="margin:0 0 10px">Połączono jako <b>${esc(st.user ? st.user.name : '?')}</b>${st.user && st.user.premium ? ' <span class="chip ok">Premium</span>' : ' <span class="chip">konto darmowe</span>'}</p>
           <p class="dim" style="font-size:12.5px;margin:0 0 10px">${st.user && st.user.premium ? 'Mody pobierają się bezpośrednio z CodeManager.' : 'Na koncie darmowym pobierasz przyciskiem „Mod Manager Download” na stronie moda – link trafi do CodeManager.'}</p>
           <div class="row"><button class="btn" data-nxm>${icon('link')}${st.nxmRegistered ? 'Linki nxm:// obsługuje CodeManager' : 'Obsługuj linki nxm://'}</button><button class="btn danger" data-out>Odłącz</button></div>`
        : `<div class="field"><label>Osobisty klucz API</label><div class="inline-input"><input class="input mono" type="password" data-key placeholder="wklej klucz"><button class="btn primary" data-con>Połącz</button></div><span class="hint">nexusmods.com → Ustawienia konta → API Keys. Klucz jest szyfrowany i nie opuszcza komputera (poza zapytaniami do Nexus Mods).</span></div><button class="btn sm ghost" data-site>${icon('globe')}Otwórz stronę z kluczem</button>`;
      const c = $('[data-con]', nxBox); if (c) c.onclick = async () => { const u = await api('nexus:setKey', $('[data-key]', nxBox).value); toast(`Połączono jako ${u.name}`); drawNx(); };
      const o = $('[data-out]', nxBox); if (o) o.onclick = async () => { await api('nexus:setKey', null); drawNx(); };
      const n = $('[data-nxm]', nxBox); if (n) n.onclick = async () => { await api('nexus:registerNxm'); toast('CodeManager obsługuje linki nxm://'); drawNx(); };
      const si = $('[data-site]', nxBox); if (si) si.onclick = () => api('shell:external', 'https://www.nexusmods.com/users/myaccount?tab=api');
    };
    drawNx();
    const wsBox = $('[data-ws]', el);
    const drawWs = async () => {
      const st = await api('steam:status');
      wsBox.innerHTML = st.hasKey
        ? `<p style="margin:0 0 10px">Klucz Steam Web API zapisany <span class="chip ok">aktywny</span></p><p class="dim" style="font-size:12.5px;margin:0 0 10px">Możesz przeglądać i wyszukiwać mody Warsztatu w zakładce „Pobierz mody”.</p><button class="btn danger" data-wout>Usuń klucz</button>`
        : `<div class="field"><label>Klucz Steam Web API (opcjonalnie)</label><div class="inline-input"><input class="input mono" type="password" data-wkey placeholder="wklej klucz"><button class="btn primary" data-wcon>Zapisz</button></div><span class="hint">Darmowy klucz ze steamcommunity.com/dev/apikey (jako domenę wpisz np. localhost). Potrzebny tylko do przeglądania i wyszukiwania – tytuły, opisy i wykrywanie nieaktualnych modów działają bez niego. Klucz jest szyfrowany na tym komputerze.</span></div><button class="btn sm ghost" data-wsite>${icon('globe')}Otwórz stronę z kluczem</button>`;
      const c = $('[data-wcon]', wsBox); if (c) c.onclick = async () => { await api('steam:setKey', $('[data-wkey]', wsBox).value); toast('Zapisano klucz Steam Web API'); drawWs(); };
      const o = $('[data-wout]', wsBox); if (o) o.onclick = async () => { await api('steam:setKey', null); drawWs(); };
      const si = $('[data-wsite]', wsBox); if (si) si.onclick = () => api('shell:external', 'https://steamcommunity.com/dev/apikey');
    };
    drawWs();
    const upBox = $('[data-upd]', el);
    const drawUp = async () => {
      const c = await api('update:config');
      const st = App.updateStatusText(c);
      upBox.innerHTML = `
        <div class="upd-state ${c.state}"><div style="flex:1"><div style="font-weight:600">${esc(st.title)}</div><div class="dim" style="font-size:12.5px">${esc(st.sub)}</div></div>${st.action ? `<button class="btn ${c.state === 'available' || c.state === 'downloaded' ? 'primary' : ''} sm" data-act>${esc(st.action)}</button>` : ''}</div>
        ${c.state === 'downloading' ? `<div class="progress" style="margin:8px 0"><i style="width:${c.progress || 0}%"></i></div>` : ''}
        ${c.state === 'available' && c.notes ? `<details class="notes" open><summary>Co nowego w ${esc(c.latest)}</summary><pre>${esc(c.notes)}</pre></details>` : ''}
        <label class="check" style="margin:12px 0"><input type="checkbox" data-auto ${c.auto ? 'checked' : ''}><span>Sprawdzaj automatycznie (przy starcie i co 6 godzin)</span></label>
        <div class="row"><button class="btn" data-check>${icon('refresh')}Sprawdź teraz</button><button class="btn ghost sm" data-rel>${icon('globe')}Wszystkie wydania</button></div>`;
      const act = $('[data-act]', upBox); if (act) act.onclick = () => App.updateAction(c);
      $('[data-check]', upBox).onclick = async () => { try { await window.cm.call('update:check'); } catch (e) { toast(e.message, 'warn', 7000); } drawUp(); };
      $('[data-auto]', upBox).onchange = async e => { await api('update:configure', { auto: e.target.checked }); toast(e.target.checked ? 'Automatyczne sprawdzanie włączone' : 'Automatyczne sprawdzanie wyłączone'); };
      $('[data-rel]', upBox).onclick = () => api('shell:external', 'https://github.com/Zeis01/codemanager/releases');
    };
    drawUp();
    let lastShown = '';
    App.onUpdateStatus = u => {
      if (App.current() !== 'settings' || !document.body.contains(upBox)) return;
      const key = `${u.state}|${u.progress}|${u.latest}|${u.error}`;
      if (key !== lastShown) { lastShown = key; drawUp(); }
    };
    $$('input[type=checkbox][data-k], input[type=number][data-k]', el).forEach(i => i.onchange = save);
    $('[data-k="language"]', el).onchange = async e => { await save(); App.setLanguage(e.target.value); };
    $('[data-k="tray"]', el).addEventListener('change', () => setTimeout(() => api('tray:apply'), 100));
    $('[data-trash]', el).onclick = () => App.mt.trashModal(null);
    $('[data-ntest]', el).onclick = () => api('notify:testSystem');
    $('[data-dctest]', el).onclick = async () => { await api('notify:test', $('[data-dc]', el).value.trim()); toast('Wysłano wiadomość testową na Discorda'); };
    $('[data-nsave]', el).onclick = async () => {
      const ev = {}; $$('[data-ne]', el).forEach(i => { ev[i.dataset.ne] = i.checked; });
      const de = {}; $$('[data-de]', el).forEach(i => { de[i.dataset.de] = i.checked; });
      const url = $('[data-dc]', el).value.trim();
      if (url && !/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) { toast('To nie wygląda na adres webhooka Discord.', 'warn'); return; }
      App.state.settings = await api('settings:set', { notifications: { enabled: $('[data-n="enabled"]', el).checked, events: ev }, discord: { url: url || undefined, events: de } });
      toast('Zapisano powiadomienia');
    };
    const pb = $('[data-portable]', el);
    const drawPortable = async () => {
      const p = await api('portable:status');
      pb.innerHTML = p.active
        ? `<p style="margin:0 0 8px">Włączony – dane programu są w folderze obok programu:<br><span class="path">${esc(p.dir)}</span></p><button class="btn sm" data-pdis>Przenieś dane z powrotem do AppData</button>`
        : p.available
          ? `<p class="muted" style="margin:0 0 8px;font-size:13px">Wszystkie dane (ustawienia, profile, migawki, kopie, motywy) będą trzymane w folderze <span class="mono">CodeManager-data</span> obok programu – wygodne na pendrive. Obecne dane zostaną skopiowane, a program uruchomi się ponownie.</p><button class="btn sm primary" data-pen>Włącz tryb przenośny</button>`
          : `<p class="dim" style="margin:0;font-size:12.5px">Dostępny w wersji przenośnej i ZIP. Wersja instalowana trzyma dane w AppData (${esc(p.defaultDir)}).${p.mode !== 'installer' && !p.writable ? ' Folder programu jest tylko do odczytu.' : ''}</p>`;
      const en = $('[data-pen]', pb); if (en) en.onclick = async () => { if (!(await App.confirmBox('Włączyć tryb przenośny?', 'Dane zostaną skopiowane obok programu, a CodeManager uruchomi się ponownie. Działające serwery zostaną zatrzymane.', 'Włącz'))) return; App.runJob('Tryb przenośny', jobId => window.cm.call('portable:enable', jobId), { doneMsg: 'Uruchamiam ponownie…' }); };
      const ds = $('[data-pdis]', pb); if (ds) ds.onclick = async () => { if (!(await App.confirmBox('Wyłączyć tryb przenośny?', 'Dane zostaną skopiowane do AppData, a CodeManager uruchomi się ponownie.', 'Wyłącz'))) return; App.runJob('Tryb przenośny', jobId => window.cm.call('portable:disable', jobId), { doneMsg: 'Uruchamiam ponownie…' }); };
    };
    drawPortable();
    // ---- AI ----
    const provs = await api('ai:providers');
    const aiSel = $('[data-aip]', el);
    aiSel.innerHTML = '<option value="">— wyłączone —</option>' + provs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const drawAi = async () => {
      const st = await api('ai:status'); aiSel.value = st.provider || '';
      const p = provs.find(x => x.id === aiSel.value);
      $('[data-aim]', el).value = st.provider === aiSel.value ? (st.model || '') : (p ? p.model : '');
      $('[data-aim]', el).placeholder = p ? (p.model || 'nazwa modelu') : '';
      $('[data-aib]', el).value = st.baseUrl || '';
      $('[data-aibasef]', el).classList.toggle('hidden', !p || !['ollama', 'custom'].includes(p.id));
      $('[data-aik]', el).value = ''; $('[data-aik]', el).placeholder = p && st.keys[p.id] ? '•••••••• (zapisany – wpisz nowy, aby zmienić)' : p && !p.needsKey ? 'niepotrzebny' : 'wklej klucz';
      $('[data-aikh]', el).textContent = p ? (p.needsKey ? 'Klucz jest szyfrowany i zapisany tylko na tym komputerze.' : 'Ten dostawca nie wymaga klucza.') : '';
      $('[data-aikurl]', el).disabled = !(p && p.keyUrl);
      $('[data-aist]', el).innerHTML = st.ready ? '<span class="chip ok">gotowe</span>' : '<span class="chip">nieaktywne</span>';
    };
    aiSel.onchange = () => { const p = provs.find(x => x.id === aiSel.value); $('[data-aim]', el).value = p ? p.model : ''; $('[data-aibasef]', el).classList.toggle('hidden', !p || !['ollama', 'custom'].includes(p.id)); $('[data-aib]', el).value = p && p.id === 'ollama' ? p.base : ''; };
    const aiSave = async () => {
      const o = { provider: aiSel.value || null, model: $('[data-aim]', el).value.trim() || undefined, baseUrl: $('[data-aib]', el).value.trim() || undefined, enabled: !!aiSel.value };
      const k = $('[data-aik]', el).value.trim(); if (k) o.key = k;
      const ready = await api('ai:configure', o); App.state.settings.ai = o; await drawAi(); return ready;
    };
    $('[data-aisave]', el).onclick = async () => { const r = await aiSave(); toast(r ? 'Zapisano – AI gotowe do użycia' : 'Zapisano. Uzupełnij klucz, aby włączyć AI.', r ? 'ok' : 'warn'); };
    $('[data-aitest]', el).onclick = async e => { const b = e.currentTarget; b.disabled = true; $('[data-aires]', el).textContent = 'Łączenie…'; try { await aiSave(); const r = await window.cm.call('ai:test'); $('[data-aires]', el).textContent = `✔ ${r.model}: „${r.reply.slice(0, 60)}” (${(r.ms / 1000).toFixed(1)} s)`; } catch (err) { $('[data-aires]', el).textContent = '✖ ' + err.message; } finally { b.disabled = false; } };
    $('[data-aidel]', el).onclick = async () => { await api('ai:configure', { provider: aiSel.value || null, key: '' }); toast('Usunięto klucz'); drawAi(); };
    $('[data-aikurl]', el).onclick = () => { const p = provs.find(x => x.id === aiSel.value); if (p && p.keyUrl) api('shell:external', p.keyUrl); };
    $('[data-aimodels]', el).onclick = async () => { try { await aiSave(); const list = await window.cm.call('ai:models'); $('#ai-models').innerHTML = list.map(m => `<option value="${esc(m)}">`).join(''); toast(`Dostępne modele: ${list.length} – wybierz z listy w polu Model`); } catch (err) { toast(err.message, 'warn', 7000); } };
    await drawAi();
    if (params.section === 'workshop') setTimeout(() => $('#set-workshop', el).scrollIntoView({ behavior: 'smooth' }), 100);
    if (params.section === 'ai') setTimeout(() => $('#set-ai', el).scrollIntoView({ behavior: 'smooth' }), 100);
    async function save() {
      const patch = {};
      $$('[data-k]', el).forEach(i => { patch[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value.trim(); });
      if (patch.language) localStorage.setItem('cm-lang', patch.language);
      const pyChanged = (App.state.settings.pythonPath || '') !== (patch.pythonPath || '');
      App.state.settings = await api('settings:set', patch);
      if (pyChanged) { await api('py:reset'); if (window.EditorComplete) EditorComplete.reset(); }
      if (App.applyEditorSettings) App.applyEditorSettings();
      toast('Zapisano ustawienia');
    }
  },
};

// Edytor motywów z podglądem na żywo
const THEME_LABELS = {
  bg0: 'Pasek tytułu i menu', bg1: 'Tło treści', bg2: 'Panele', bg3: 'Najechanie, elementy wypukłe', bg4: 'Zaznaczenie', line: 'Linie', line2: 'Mocniejsze linie, obramowania',
  input: 'Pola tekstowe', text: 'Tekst', text2: 'Tekst drugorzędny', text3: 'Tekst przygaszony', accent: 'Akcent', accentStrong: 'Przyciski główne', onAccent: 'Tekst na przyciskach głównych',
  warn: 'Ostrzeżenia', error: 'Błędy', info: 'Informacje', sidebar: 'Menu boczne', titlebar: 'Pasek tytułu', folder: 'Foldery w edytorze',
};
function themeEditor(redraw) {
  const { h, $, $$, esc, api, toast, modal } = App;
  const startId = App.state.themeId;
  const cur = Themes.current();
  const baseKey = (startId || '').startsWith('builtin:') ? startId.slice(8) : (cur.type === 'light' ? 'light' : 'classic');
  const colors = { ...cur.colors };
  let radius = typeof cur.radius === 'number' ? cur.radius : 4;
  const toHex = c => { const x = String(c || '').trim(); if (/^#[0-9a-f]{6}$/i.test(x)) return x; if (/^#[0-9a-f]{3}$/i.test(x)) return '#' + x.slice(1).split('').map(y => y + y).join(''); const m = x.match(/\d+/g); return m ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('') : '#000000'; };
  const body = h(`<div class="theme-ed"><div class="row" style="margin-bottom:12px;gap:12px"><div class="field" style="flex:1;margin:0"><label>Nazwa</label><input class="input" data-name value="${esc((cur.name || 'Mój motyw') + (startId && startId.startsWith('builtin:') ? ' (mój)' : ''))}"></div>
    <div class="field" style="margin:0"><label>Bazuje na</label><select class="input" data-base>${Object.entries(Themes.BUILTIN).map(([k, t]) => `<option value="${k}" ${k === baseKey ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    <div class="field" style="margin:0;width:140px"><label>Zaokrąglenie: <span data-rv>${radius}</span> px</label><input type="range" min="0" max="10" value="${radius}" data-radius></div></div>
    <div class="theme-grid">${Object.keys(Themes.KEYS).map(k => `<label class="tcol"><input type="color" data-c="${k}" value="${toHex(colors[k] || colors.bg0)}"><span>${esc(THEME_LABELS[k] || k)}</span><input class="input mono" data-t="${k}" value="${esc(colors[k] || '')}"></label>`).join('')}</div>
    <p class="dim" style="font-size:12px;margin:10px 0 0">Zmiany widać od razu w całym programie. „Zapisz” tworzy plik w folderze motywów – możesz go potem edytować albo wysłać komuś.</p></div>`);
  const apply = () => { Themes.apply(Themes.resolve({ name: $('[data-name]', body).value, extends: $('[data-base]', body).value, colors, radius })); };
  body.addEventListener('input', e => {
    const k = e.target.dataset.c || e.target.dataset.t;
    if (e.target.dataset.c) { colors[k] = e.target.value; $(`[data-t="${k}"]`, body).value = e.target.value; }
    else if (e.target.dataset.t) { if (!Themes.validColor(e.target.value)) return; colors[k] = e.target.value.trim(); $(`[data-c="${k}"]`, body).value = toHex(colors[k]); }
    else if (e.target.dataset.radius !== undefined) { radius = +e.target.value; $('[data-rv]', body).textContent = radius; }
    apply();
  });
  $('[data-base]', body).onchange = e => { const b = Themes.BUILTIN[e.target.value]; Object.assign(colors, b.colors); $$('[data-c]', body).forEach(i => { const k = i.dataset.c; if (colors[k]) { i.value = toHex(colors[k]); $(`[data-t="${k}"]`, body).value = colors[k]; } }); apply(); };
  let saved = false;
  modal({ title: 'Edytor motywu', wide: true, body, onClose: () => { if (!saved) App.applyTheme(startId); },
    actions: [{ label: 'Anuluj' }, { label: 'Zapisz jako plik', primary: true, icon: 'save', onClick: async () => {
      const name = $('[data-name]', body).value.trim() || 'Mój motyw';
      const r = await api('themes:save', name, { name, extends: $('[data-base]', body).value, type: Themes.BUILTIN[$('[data-base]', body).value].type, colors, radius });
      saved = true; await App.loadThemes(); App.applyTheme(r.id); await api('themes:select', r.id); redraw && redraw(); toast(`Zapisano motyw „${name}”`);
    } }] });
}

