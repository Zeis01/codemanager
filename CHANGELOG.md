# Historia zmian

## CodeManager 1.7.1.5

### Edytor: podpowiedzi Lua dla gier
- **Profile API Lua dla gier:**

  | Gra | Zakres | Źródło |
  |---|---|---|
  | FiveM | ok. 10 000 natywnych funkcji, środowisko CFX (Citizen, eventy, json, msgpack) | docs.fivem.net |
  | RedM | ok. 7 500 natywnych funkcji RDR2 i funkcje serwera CFX | — |
  | BeamMP | API serwera 3.x (MP, Util, FS, zdarzenia) i API klienta (MPVehicleGE, MPGameNetwork…) | — |
  | Garry's Mod | ok. 9 500 funkcji, klasy z dziedziczeniem (Player → Entity), hooki | wiki.facepunch.com |
  | MTA:SA | ok. 1 300 funkcji serwera i klienta, ponad 200 zdarzeń | — |
  | Project Zomboid | API Javy, zdarzenia, Lua gry | Umbrella |
  | Don't Starve Together | — | LuaCATS |
  | Factorio | pełne API, łańcuchy typów (np. game.players[1].) i defines | — |
  | Stormworks | dodatki | — |
  | Teardown | definicje z pliku gry data/script_defs.lua | — |

- **Opisy z dokumentacji:** każda funkcja ma sygnaturę, opis, opisy parametrów i oznaczenie strony (serwer / klient / wspólne). Funkcje drugiej strony są niżej na liście. Przestarzałe funkcje są przekreślone.
- **Rozumienie typów:**
  - wynik funkcji (`local p = LocalPlayer()` → `p:` pokazuje metody gracza);
  - pętle `for _, ply in ipairs(player.GetAll())`;
  - parametry funkcji obsługi zdarzeń (`hook.Add("PlayerSpawn", …, function(ply)`);
  - adnotacje `---@param` i `---@type`.
- **Nazwy zdarzeń w tekście:** `AddEventHandler("…`, `hook.Add("…`, `MP.RegisterEvent("…`, `addEventHandler("…`.
- **Automatyczne wykrywanie gry** po plikach w folderze (fxmanifest.lua – FiveM/RedM, meta.xml – MTA, info.json – Factorio, modinfo.lua – DST, mod.info – Project Zomboid, addon.json – Garry's Mod), po ścieżce (np. Resources/Server dla BeamMP) albo po treści pliku.
- **Przełącznik „API Lua” na pasku stanu edytora:** wybór gry zapamiętywany dla folderu. Domyślne zachowanie ustawisz w Ustawieniach → Edytor.
- Generator baz (tools/lua-api/build.js) pozwala odświeżyć je po aktualizacjach gier.

### Wersja
- Numer 1.7.1.5 jest zapisany w package.json jako 1.7.1-5, bo npm wymaga trzech liczb. CodeManager wyświetla i porównuje go jako 1.7.1.5, a aktualizacja z 1.7.1 działa normalnie.

## CodeManager 1.7.1

### Edytor: podpowiedzi podczas pisania
- **Python, jak w VS Code:** po wpisaniu `time.`, `os.path.` czy `json.` pojawia się lista funkcji, klas, modułów i stałych z ikonami. Przy pozycjach widać:
  - sygnaturę funkcji;
  - opis z dokumentacji;
  - wartość stałej (np. `altzone  int = -7200`).
- **Podpowiedzi z Pythona na komputerze:** CodeManager pyta zainstalowanego Pythona (py / python), więc podpowiedzi obejmują też pakiety z pip (np. requests, discord, pygame). Wyniki trafiają do pamięci podręcznej. Bez Pythona działa wbudowana baza biblioteki standardowej (ok. 90 modułów oraz metody str, list i dict).
- **Rozumienie pliku:**
  - importy z aliasami (`import json as js`, `from os import path`);
  - klasy z metodami i polami `self.`, także dziedziczone;
  - zmienne z typem rozpoznanym z przypisania (tekst, lista, słownik, `open()`, obiekt klasy);
  - podpowiedzi po `import` i `from x import`.
- **Podpowiedź parametrów** po wpisaniu `(` oraz **opis po najechaniu** na funkcję lub moduł.
- **Lua:** biblioteka standardowa (string, table, math, os, io, coroutine, utf8, debug), funkcje globalne, słowa kluczowe, a także tabele, funkcje i metody (`M.`, `M:`) zdefiniowane w pliku. Metody tekstu działają po `s:`.
- Podpowiedzi nie pokazują się w komentarzach, a szablony kodu nie wyskakują po kropce.
- **Ustawienia → Edytor:** podpowiedzi można wyłączyć (Ctrl+Spacja nadal działa) i wskazać własny Python (przycisk „Sprawdź”).

## CodeManager 1.7.0

### Nowe gry ze sprawdzaniem zgodności
- **Left 4 Dead i Left 4 Dead 2:** CodeManager czyta dodatki .vpk bezpośrednio (tytuł i wersja z addoninfo.txt) i wykrywa uszkodzone archiwa oraz konflikty, czyli dodatki zmieniające te same pliki. Konflikt skryptów jest ostrzeżeniem, konflikt modeli i dźwięków tylko informacją. W L4D2 włączanie i wyłączanie działa przez addonlist.txt, tak jak w grze. Dodatki z Warsztatu są widoczne razem z lokalnymi.
- **Farming Simulator 17, 19, 22 i 25:** dla każdego moda sprawdzany jest modDesc.xml. CodeManager wykrywa:
  - mody do innej części gry (po descVersion);
  - brakujące zależności;
  - nazwy plików, które gra pomija (np. „Mod (1).zip”);
  - archiwa bez modDesc.xml (paczki kilku modów) i pliki .rar/.7z;
  - duplikaty i błędy z log.txt.
- **BeamNG.drive:**
  - włączanie i wyłączanie modów przez db.json, tak jak w grze;
  - wykrywanie uszkodzonych archiwów i złej struktury (dodatkowy folder w zipie);
  - dwa mody z tym samym pojazdem lub mapą;
  - mody nadpisujące oficjalne pojazdy.
- **GTA: San Andreas:**
  - rozpoznawanie wersji pliku gry: 1.0 US albo nowa wersja Steam/Rockstar, w której CLEO nie działa;
  - sprawdzanie ASI Loadera, CLEO, Mod Loadera i SilentPatch;
  - duplikaty modów .asi;
  - włączanie i wyłączanie modów z folderu modloader.
- **GTA IV:** rozpoznawanie Complete Edition i wersji 1.0.x; sprawdzanie ASI Loadera, FusionFix, ScriptHook i ScriptHookDotNet; wykrywanie przestarzałego xlive.dll.
- **Hollow Knight:** obecność Modding API, struktura Mods/<mod>/, duplikaty bibliotek między modami, mody wyłączone w Lumafly oraz brakujące zależności i błędy z ModLog.txt.
- **Assetto Corsa:** lista aut i torów z modów (oryginalne treści Kunos są pomijane). Sprawdzane są: data.acd, model .kn5, surfaces.ini, opisy w ui_car.json i ui_track.json oraz to, czy mod wymaga Custom Shaders Patch.
- **American Truck Simulator:** to samo sprawdzanie co w ETS2 (manifest.sii, zgodność z wersją gry) plus Warsztat.
- **Subnautica, Subnautica: Below Zero (BepInEx 5), Among Us (BepInEx 6 IL2CPP), Phasmophobia i Car Mechanic Simulator 2021 (MelonLoader):** sprawdzanie pluginów i loadera jak w innych grach Unity.

### Nowe gry z instalacją ręczną
- Unturned, The Forest, Raft (mody .rmod), Workers & Resources: Soviet Republic, Prison Architect, Wreckfest, My Garage, Car Mechanic Simulator 2018, Stormworks: Build and Rescue, Far Cry 3, 4, 5 i 6, Dying Light i Dying Light 2 (mody .pak bez plików gry).
- Wszystkie nowe gry mają zakładkę „Pobierz mody” z Nexus Mods, a gry z Warsztatem także z Warsztatu Steam.

### Modloadery
- BepInEx 6 dla Among Us (z Thunderstore).
- Ultimate ASI Loader dla GTA SA i GTA IV, FusionFix dla GTA IV (z GitHub).
- Odnośniki do CLEO, Modding API (Lumafly) i Raft Mod Loadera.
- BepInEx 5 dla Subnautiki oraz MelonLoader dla Phasmophobii i CMS 2021.

### Nowe serwery
- **Unturned:**
  - instalacja przez SteamCMD;
  - Commands.dat zapisywany z ustawień serwera: nazwa, mapa, gracze, trudność, widok, hasło, GSLT, właściciel;
  - tryb LAN lub internetowy;
  - frameworki RocketMod (wbudowany) i OpenMod;
  - dodawanie modów z Warsztatu (wpis do WorkshopDownloadConfig.json, serwer pobiera je sam);
  - sprawdzanie pluginów i tokenu GSLT;
  - akcje na graczach.
- **Left 4 Dead 2:** instalacja przez SteamCMD, gotowy server.cfg (tryb gry, trudność, grupa Steam), RCON, Metamod:Source i SourceMod, sprawdzanie pluginów .smx, szablon „L4D2 + Metamod + SourceMod”.
- **RedM:**
  - serwer FXServer dla Red Dead Redemption 2 z gamename rdr3 i sessionmanager-rdr3;
  - sprawdzanie zasobów: brak rdr3_warning i zasoby FiveM wrzucone na serwer RedM.
- Szablony „Unturned + RocketMod” i „Unturned + OpenMod”, porty do przekierowania i ikony dla nowych serwerów.

## CodeManager 1.6.2

### Pobieranie modów
- **Nexus Mods ze stronami:** w zakładce „Pobierz mody” wyniki są podzielone na strony (Poprzednia / Następna, „Strona X z Y”), tak jak w Modrinth. Do wyboru sortowanie: najwięcej polubień, najwięcej pobrań, ostatnio aktualizowane, najnowsze.
- **Przeglądanie Nexus Mods bez konta:** listę i wyszukiwanie zobaczysz bez klucza API. Klucz jest potrzebny dopiero do pobierania i podglądu plików.
- **Strona moda:** kliknięcie nazwy otwiera okno z obrazkiem, statystykami i opisem (Nexus Mods z połączonym kontem, Modrinth z pełnym opisem i galerią).
- **Modrinth:** strony wyników i sortowanie po liczbie obserwujących.

### Warsztat Steam
- **Nowe źródło „Warsztat Steam”** w zakładce „Pobierz mody” dla gier z Warsztatem (Project Zomboid, Garry's Mod, RimWorld, Don't Starve Together, tModLoader, ETS2, Transport Fever 2, Hearts of Iron IV, Teardown i inne).
  - Wklej link lub numer przedmiotu, aby zobaczyć jego kartę.
  - Z darmowym kluczem Steam Web API (Ustawienia → Warsztat Steam) możesz przeglądać i wyszukiwać mody ze stronami i sortowaniem.
- **„Subskrybuj w Steam”** otwiera stronę przedmiotu w kliencie Steam. Steam pobiera mod, a CodeManager go wykrywa.
- **„Pobierz”** ściąga przedmiot przez SteamCMD (konto anonimowe) i kopiuje go do folderu modów gry w formacie, którego gra oczekuje. Przed kopiowaniem robi automatyczną migawkę. Jeśli Steam nie pozwala pobrać bez konta z grą, pojawia się podpowiedź, żeby użyć subskrypcji.
- **Analiza modów z Warsztatu:** w zakładce Mody przy modach z Warsztatu widać tytuł ze Steam, przycisk strony Warsztatu i oznaczenie „nieaktualny”, gdy na Warsztacie jest nowsza wersja niż na dysku. Po dwukrotnym kliknięciu widać opis, liczbę subskrypcji i datę aktualizacji, a „Co robi ten mod? (AI)” korzysta z opisu z Warsztatu.

## CodeManager 1.6.1

### Sztuczna inteligencja (opcjonalnie)
- **Własny klucz API** w Ustawieniach → Sztuczna inteligencja. Do wyboru:
  - Anthropic (Claude), OpenAI (ChatGPT), Google Gemini, OpenRouter, Mistral AI;
  - Ollama na własnym komputerze (bez klucza);
  - dowolny serwer zgodny z API OpenAI.
- **Konfiguracja:** model wpiszesz ręcznie albo wybierzesz z listy pobranej od dostawcy. Przycisk „Sprawdź połączenie” wysyła próbne zapytanie. Klucz jest szyfrowany i zapisany tylko na tym komputerze.
- **Analizator błędów:** przycisk „Wyjaśnij z AI” przy wyniku analizy. AI dostaje fragment logu (wiersze z błędami i końcówkę), wynik reguł i listę modów, a w odpowiedzi podaje przyczynę i kroki do wykonania.
- **Zgodność modów:** przycisk „Zapytaj AI” w zakładce Zgodność gry i w zakładce z pluginami/modami serwera. AI ocenia cały zestaw: co naprawić najpierw i które mody są zbędne lub się dublują.
- **Pojedynczy mod:** „Co robi ten mod? (AI)” po dwukrotnym kliknięciu moda na liście.
- Każdą odpowiedź można dopytać. AI działa tylko po kliknięciu, ścieżki z nazwą konta są ukrywane przed wysłaniem, a odpowiedzi przychodzą w języku interfejsu.

## CodeManager 1.6.0

### Szybkość
- **Osobne wątki:** sprawdzanie zgodności modów, wykrywanie gier, wyszukiwanie w plikach edytora, analiza śladu błędu, synchronizacja z graczem i liczenie rozmiaru migawek działają w wątkach roboczych. Okno nie przycina się podczas wczytywania modów ani po instalacji.
- **Pamięć podręczna plików .jar i sum kontrolnych:** kolejne sprawdzenie czyta tylko nowe lub zmienione mody.
- Wywołania obsługiwane wcześniej synchronicznie w procesie głównym są teraz asynchroniczne. Jeśli wątek roboczy nie wystartuje, program wykonuje pracę po staremu, więc działa dalej.

### Mody
- **Blokada wersji:** przycisk kluczyka przy modzie. Zablokowany mod jest pomijany przy „Aktualizuj wszystko” i w widoku „Aktualizacje modów” (Modrinth, Thunderstore, Nexus Mods).
- **Kolekcje z tagów:** przycisk „Z tagu…” na pasku profili. Kolekcja włącza mody oznaczone wybranym tagiem i przy każdym przełączeniu liczy zestaw od nowa.
- **Polecane mody:** w zakładce „Pobierz mody” (Minecraft i serwery) pojawiają się propozycje pasujące do zainstalowanych modów. Program sprawdza zgodność z wersją gry i loaderem.
- **Ostrzeżenie przed instalacją** (do wyłączenia w Ustawieniach):
  - mody z Modrinth: niezgodności deklarowane przez nowy lub zainstalowany mod oraz zastąpienie istniejącej wersji;
  - archiwa i pliki z Nexus Mods: lista plików innych modów, które zostaną nadpisane.
- **Paczki zasobów i shadery Minecrafta:** nowa zakładka „Zasoby i shadery”:
  - włączanie paczek i ustawianie ich kolejności (options.txt);
  - wybór shadera dla Iris/Oculus albo OptiFine;
  - dodawanie z pliku i pobieranie z Modrinth.

### Serwery
- **Alarm zasobów:** powiadomienie w Windows i na Discordzie, gdy serwer przez zadany czas przekracza limit procesora lub pamięci. Limity ustawiasz w zakładce Ustawienia serwera.
- **Podgląd mapy świata w zakładce „Mapa”:** instalacja BlueMap lub squaremap jednym kliknięciem (wykrywany jest też Dynmap) i mapa wyświetlana w programie. Dla BlueMap jest przycisk zgody na pobranie plików Mojang.

### Wygląd
- **Edytor motywów** z podglądem na żywo. Każdy kolor ustawisz próbnikiem albo kodem, do tego motyw bazowy i zaokrąglenie rogów. Gotowy motyw zapisujesz jako plik w folderze motywów.

## CodeManager 1.5.0

### Mody
- **Konflikty plików:** nowa zakładka „Konflikty” pokazuje, które mody nadpisują te same pliki i który z nich wygrywa. Działa dla Wiedźmina 3, Project Zomboid, gier Paradox, Transport Fever 2, ETS2 i Garry's Mod. W pozostałych grach działa dla modów zainstalowanych z archiwów przez CodeManager, bo program zapamiętuje teraz pełną listę ich plików.
- **Kolejność ładowania:** listę pluginów Skyrim SE / Fallout 4 (plugins.txt) i modów RimWorld (ModsConfig.xml) ustawisz przeciąganiem, Alt+↑/↓ albo przyciskiem „Sortuj automatycznie”. Sortowanie bierze pod uwagę mastery, ESM/ESL, Harmony, Core, DLC, loadAfter/loadBefore i zależności.
- **Aktualizacje wszystkich modów naraz:** nowy widok „Aktualizacje modów” sprawdza w jednym przebiegu Modrinth, Thunderstore, portal Factorio i Nexus Mods dla wszystkich gier i serwerów. Przycisk „Zaktualizuj zaznaczone” aktualizuje wybrane.
- **Brakujące zależności jednym kliknięciem:** zakładka Mody pokazuje pasek „Zainstaluj brakujące” (Fabric API, paczki Thunderstore, BepInEx, loadery). Nowy instalator SKSE64 i F4SE pobiera wersję pasującą do gry, także dla wersji GOG i Skyrim SE 1.5.97.
- **Migawki:** przed aktualizacją, instalacją moda, zmianą profilu, naprawą, importem i zmianą kolejności program zapisuje stan folderów z modami. Przywracasz go jednym kliknięciem w zakładce „Migawki”. Liczbę migawek i limit rozmiaru ustawisz w Ustawieniach.
- **Udostępnianie profilu:** eksport listy modów do kodu `CM1:…` albo pliku `.cmprofile`. Znajomy importuje go i dostaje ten sam zestaw. Mody z Modrinth, Thunderstore i Nexus Mods (konto Premium) pobierają się same, a reszta trafia na listę do pobrania ręcznie.
- **Porównanie profili:** dwa zapisane zestawy (albo zestaw bieżący) obok siebie: co jest tylko w jednym, co tylko w drugim, a co w obu.
- **Duplikaty:** wykrywanie tego samego moda w dwóch wersjach, pod dwiema nazwami albo jako identyczny plik, z przyciskiem przeniesienia starszej kopii do kosza.
- **Notatki i tagi przy modach:** gotowe tagi („wymagane na serwerze”, „tylko klient”, „testowy”…) albo własne, notatki i filtrowanie listy po tagu.
- **Kosz programu:** usunięte mody trafiają na 30 dni do kosza CodeManager, skąd można je przywrócić. Kosz w systemie Windows nadal jest dostępny jako opcja w Ustawieniach.
- **Znajdź winowajcę (bisekcja):** program wyłącza połowę podejrzanych modów, Ty sprawdzasz grę i odpowiadasz „działa” albo „problem występuje”. Po kilku rundach zostaje jeden mod. Biblioteki można oznaczyć jako zawsze włączone, a stan jest zapamiętywany między uruchomieniami programu.

### Serwery
- **Synchronizacja klient–serwer:** porównanie modów serwera Minecraft, Valheim i Project Zomboid z modami gracza na tym komputerze. Brakujące mody można skopiować do gry albo spakować w ZIP dla znajomego.
- **Statystyki:** wykresy CPU, RAM i liczby graczy (15 min – 24 godz.). Pomiar obejmuje proces serwera razem z procesami potomnymi.
- **Gracze:** lista graczy online budowana z konsoli, z akcjami: wyrzuć, zbanuj, odbanuj, operator, biała lista (Minecraft, Project Zomboid, Terraria, Rust, CS2, TF2, MTA).
- **Konfiguracja jako formularz:** opisane po polsku ustawienia server.properties (Minecraft), pliku .ini Project Zomboid, TShock, Enshrouded, Palworld i BeamMP. Reszta pliku zostaje bez zmian, a poprzednia wersja trafia do `.bak`.
- **Powiadomienia Discord:** webhook globalny albo osobny dla serwera. Zdarzenia do wyboru: start, zatrzymanie, awaria, wejście i wyjście gracza, kopia zapasowa, błąd kopii. Przycisk testowy sprawdza połączenie.
- **Kopie zapasowe:** rotacja dzienna, tygodniowa i miesięczna oraz druga lokalizacja (inny dysk albo folder OneDrive, Google Drive lub Dropbox).
- **Sieć:** lista portów serwera, sprawdzenie z internetu, czy port jest otwarty, i otwieranie portów w routerze przez UPnP.
- **Szablony serwerów:** Minecraft Fabric z modami wydajnościowymi, Paper z podstawowymi pluginami, NeoForge, Valheim + BepInEx, Rust + Oxide albo Carbon, CS2 + CounterStrikeSharp, TF2 + SourceMod.
- **Zadania harmonogramu:** polecenia, ogłoszenia, kopie, restarty, start i stop o wybranej godzinie albo co X minut, z wyborem dni tygodnia.
- **Konsola:** filtry (błędy, ostrzeżenia, czat, gracze) i wyszukiwanie z podświetleniem.
- **Mapa (Chunky):** pre-generowanie świata Minecraft z paskiem postępu, pauzą i anulowaniem. Chunky instaluje się z Modrinth jednym kliknięciem.

### Analizator błędów
- Analiza logu z linku (mclo.gs, pastebin, gist, paste.ee, pastes.dev, hastebin) oraz przeciąganie pliku albo linku w dowolne miejsce widoku.
- **Raport do wysłania:** lista modów, wersje, system, problemy zgodności, wynik analizy i końcówka logu w jednym pliku. Można go skopiować albo zapisać. Ścieżki z nazwą konta są ukrywane.

### Gry
- **Uruchamianie gry** z kart i szczegółów gry. Do wyboru: przez Steam albo bezpośrednio z pliku .exe, z parametrami i z automatycznym przełączeniem profilu modów. Skyrim SE i Fallout 4 startują przez loader SKSE/F4SE.
- **Wykrywanie gier z GOG, EA app, Ubisoft Connect i Xbox / Game Pass** (obok Steama, Epic Games i Rockstara).
- **Czas gry i „Ostatnio grane”** na kartach gier i w Przeglądzie.
- **Kopie zapasowe zapisów gier** w nowej zakładce „Zapisy gry”, osobno od modów. Lokalizacje są znane dla większości obsługiwanych gier. Gdy nie ma znanej lokalizacji, kopiowane są zapisy z chmury Steam.

### Edytor
- Walidacja plików TOML i YAML na bieżąco oraz podpowiedzi i walidacja dla znanych plików JSON (fabric.mod.json, manifest Thunderstore, info.json Factorio, manifest SMAPI, enshrouded_server.json, pack.mcmeta).
- Podgląd struktury pliku (JSON, TOML, YAML, INI, LTX).
- Porównywanie plików: z wersją zapisaną na dysku albo z innym plikiem.
- Kolorowanie składni, zwijanie sekcji i konspekt dla plików .ltx STALKER-a.

### Program
- **Ikona w zasobniku systemowym** (do włączenia w Ustawieniach). Po zamknięciu okna serwery działają dalej, a menu ikony pozwala je uruchamiać i zatrzymywać.
- **Powiadomienia systemowe Windows** o awarii serwera, gotowej lub nieudanej kopii, nowej wersji programu i wejściu gracza. Każde zdarzenie włączasz osobno w Ustawieniach.
- **Język angielski** do wyboru w Ustawieniach. Opisy problemów z analizy modów i logów pozostają po polsku.
- **Pełny tryb przenośny:** w wersji przenośnej i ZIP wszystkie dane mogą być trzymane w folderze `CodeManager-data` obok programu zamiast w AppData. Obecne dane zostaną skopiowane.
