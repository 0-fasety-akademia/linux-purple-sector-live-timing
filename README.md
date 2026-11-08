# Purple Sector Live Timing

GNOME Shell extension that shows live motorsport session results in the top bar: practice, qualifying, sprint and race.

Part of **JGu Linux Apps**. Unofficial project, not affiliated with any racing series or its organisers.

## Features

- **Top bar:** by default only the icon, with a red dot while a session is live. Optionally the top 1–3 drivers with team colour and time or gap, e.g. `1 ▌ALV 1:09.470  2 ▌KOW +0.031`.
  - **Race and sprint:** gap to the leader, gap to the car ahead, or both.
  - **Practice and qualifying:** lap times or gap to P1.
  - **Status chips:** Safety Car, VSC, red flag and finish. Lap or remaining time is optional.
- **Menu:**
  - full classification with team colours; best time in purple, retired or knocked-out drivers dimmed, PIT tag,
  - **qualifying sections:** elimination zone (Q1/Q2), knocked out in Q2, knocked out in Q1, each showing the time from the segment the driver was knocked out in,
  - **expandable table** with names, position change, tyre and tyre age, last and best lap, and pit stops (Q1/Q2/Q3 times in qualifying),
  - scrolls when it doesn't fit the screen, follows the system light/dark style.
- **Automatic connection:** connects about 10 minutes before each session (season calendar from the Jolpica API) and is offline otherwise. Without a calendar it checks the feed every 15 minutes.
- **Notifications:** session start, new leader, Safety Car / VSC / red flag, finish with the top three.
- **Delay** of 0–60 s to stay in sync with the TV broadcast.
- **Built-in demo race** with fictional drivers and teams.
- **Translations:** English and Polish.

## Install

From extensions.gnome.org (after review), or from the release files:

```bash
# zip
gnome-extensions install --force purple-sector-live-timing@jgu.shell-extension.zip

# or Debian/Ubuntu package (system-wide; replaces linux-f1-live-timing)
sudo apt install ./linux-purple-sector-live-timing_1.0.0_all.deb
```

Then log out and back in (Wayland loads new extensions at login) and enable it:

```bash
gnome-extensions enable purple-sector-live-timing@jgu
```

Settings: `gnome-extensions prefs purple-sector-live-timing@jgu`, or **Settings** in the menu.

## How it works

Everything runs inside the extension in GJS. There is no helper process or script.

| Module | Purpose |
|---|---|
| `extension.js` | enable/disable, notifications on session events |
| `lib/client.js` | SignalR client over WebSocket (libsoup 3): SignalR Core first, classic SignalR as fallback |
| `lib/state.js` | merges the feed's full state and deltas into one session picture |
| `lib/view.js` | formatting: panel items, columns, Q1/Q2/Q3 sections, notification texts |
| `lib/schedule.js` | season calendar → when to connect |
| `lib/service.js` | connection timing, probing, TV delay, demo playback |
| `lib/indicator.js` | panel button and menu |
| `lib/notifier.js` | GNOME notifications |
| `prefs.js` | preferences (Adwaita) |

**Network access:**
- the public live timing feed: `livetiming.formula1.com`, only around sessions,
- the Jolpica calendar: `api.jolpi.ca`, every 6 hours.

Nothing else is sent anywhere, and there is no telemetry.

## Development

```bash
gjs -m tests/test-core.js                    # logic tests (state, view, calendar, demo replay)
python3 tools/make_demo.py                   # regenerate the demo race
python3 tools/fake_feed_server.py            # local stand-in feed for testing (needs python3-websockets)
./packaging/build.sh                         # → dist/*.shell-extension.zip and dist/*.deb
```

`tools/` and `tests/` are not part of the extension zip.

## Credits and license

**Created by:** JGu
**Supported by** Claude

GPL-2.0-or-later (see `LICENSE`).

---

### Po polsku

Rozszerzenie GNOME pokazuje wyniki sesji na żywo w górnym pasku. Domyślnie w pasku jest tylko ikona, a opcjonalnie 1–3 kierowców. Po kliknięciu widać pełną klasyfikację z sekcjami Q1/Q2/Q3 i rozwijaną tabelą. Interfejs ma polskie tłumaczenie.

Instalacja z paczki: `sudo apt install ./linux-purple-sector-live-timing_1.0.0_all.deb`, potem wyloguj się, zaloguj ponownie i wpisz `gnome-extensions enable purple-sector-live-timing@jgu`.
