// Polecane mody na podstawie zainstalowanych (Minecraft: Modrinth). Lista reguł jest ręcznie dobrana.
'use strict';

// gdy masz X → polecamy Y (slug Modrinth) z powodem
const RULES = [
  { if: ['sodium', 'embeddium', 'rubidium'], then: 'iris', why: 'Shadery do Sodium – działa razem z nim.' },
  { if: ['sodium'], then: 'sodium-extra', why: 'Dodatkowe ustawienia grafiki dla Sodium.' },
  { if: ['sodium'], then: 'reeses-sodium-options', why: 'Wygodniejsze menu ustawień grafiki Sodium.' },
  { if: ['iris'], then: 'sodium', why: 'Iris wymaga Sodium do działania.' },
  { if: ['create'], then: 'jei', why: 'Przepisy maszyn Create podejrzysz w JEI.', loaders: ['forge', 'neoforge'] },
  { if: ['create', 'mekanism', 'thermal_expansion', 'immersiveengineering', 'ae2'], then: 'jade', why: 'Pokazuje, na co patrzysz – przydatne przy maszynach.' },
  { if: ['xaerominimap', 'xaeros_minimap'], then: 'xaeros-world-map', why: 'Pełna mapa świata do minimapy Xaero.' },
  { if: ['jei', 'roughlyenoughitems', 'emi'], then: 'appleskin', why: 'Pokazuje wartości jedzenia – częsty dodatek do paczek.' },
  { if: ['waystones'], then: 'balm', why: 'Biblioteka wymagana przez Waystones.' },
  { if: ['modmenu'], then: 'cloth-config', why: 'Większość ustawień modów Fabric korzysta z Cloth Config.', loaders: ['fabric', 'quilt'] },
];
// zestaw podstawowy dla loadera, gdy brakuje go w folderze
const BASE = {
  fabric: [['sodium', 'Znacznie więcej FPS bez zmian w grze.'], ['lithium', 'Szybsza logika gry (moby, redstone).'], ['ferrite-core', 'Mniejsze zużycie pamięci RAM.'], ['modmenu', 'Lista modów i ich ustawień w menu gry.'], ['entityculling', 'Nie rysuje niewidocznych mobów i skrzyń.'], ['immediatelyfast', 'Szybsze rysowanie interfejsu i tekstu.']],
  quilt: [['sodium', 'Znacznie więcej FPS bez zmian w grze.'], ['lithium', 'Szybsza logika gry.'], ['ferrite-core', 'Mniejsze zużycie pamięci RAM.'], ['modmenu', 'Lista modów w menu gry.']],
  neoforge: [['sodium', 'Więcej FPS (Sodium działa też na NeoForge).'], ['ferrite-core', 'Mniejsze zużycie pamięci RAM.'], ['modernfix', 'Szybsze uruchamianie i mniej RAM w dużych paczkach.'], ['entityculling', 'Nie rysuje niewidocznych mobów.']],
  forge: [['embeddium', 'Więcej FPS (odpowiednik Sodium dla Forge).'], ['ferrite-core', 'Mniejsze zużycie pamięci RAM.'], ['modernfix', 'Szybsze uruchamianie dużych paczek.']],
  paper: [['luckperms', 'Uprawnienia graczy i rang.'], ['spark', 'Pomiar wydajności serwera (lagi, TPS).'], ['chunky', 'Pre-generowanie mapy.'], ['coreprotect', 'Cofanie zniszczeń i historia bloków.'], ['viaversion', 'Wejście z nowszych wersji gry.']],
};
BASE.purpur = BASE.paper;

/**
 * installed: zbiór identyfikatorów (id modów, slugi i nazwy plików małymi literami)
 * Zwraca kandydatów { slug, why } bez tych, które już są.
 */
function candidates(installed, loader) {
  const has = s => installed.has(s) || [...installed].some(x => x.startsWith(s + '-') || x.startsWith(s + '_') || x === s.replace(/-/g, '_') || x === s.replace(/-/g, ''));
  const out = []; const seen = new Set();
  const add = (slug, why) => { if (seen.has(slug) || has(slug)) return; seen.add(slug); out.push({ slug, why }); };
  for (const r of RULES) if ((!r.loaders || r.loaders.includes(loader)) && r.if.some(has)) add(r.then, r.why);
  for (const [slug, why] of BASE[loader] || []) add(slug, why);
  return out;
}

module.exports = { candidates, RULES, BASE };
