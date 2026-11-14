# Purple Sector Live Timing

GNOME Shell extension that shows live motorsport session results in the top bar: practice, qualifying, sprint and race.

**Version 1.0.9** (2026-11-14)

Part of **JGu Linux Apps**. Unofficial project, not affiliated with any racing series or its organisers.

## Features

- **Top bar:** by default only the icon, with a red dot while a session is live. Optionally the top 1–3 drivers with team colour and time or gap, e.g. `1 ▌ALV 1:09.470  2 ▌KOW +0.031`.
  - **Race and sprint:** gap to the leader, gap to the car ahead, or both.
  - **Practice and qualifying:** lap times or gap to P1.
  - **Status chips:** Safety Car, VSC, red flag and finish. Lap or remaining time is optional.
  - **Chequered flag:** after the finish each driver gets a 🏁 icon once he crosses the line (panel and menu).
- **Menu:**
  - full classification with team colours; best time in purple, retired or knocked-out drivers dimmed, PIT tag,
  - **qualifying sections:** elimination zone (Q1/Q2), knocked out in Q2, knocked out in Q1, each showing the time from the segment the driver was knocked out in,
  - **expandable table** with names, position change, tyre and tyre age, last and best lap, and pit stops (Q1/Q2/Q3 times in qualifying),
  - scrolls when it doesn't fit the screen, follows the system light/dark style; optional **Aurora** style
    (the shared look of the JGu Linux Apps series).
- **Automatic connection:** connects about 10 minutes before each session (season calendar from the Jolpica API) and is offline otherwise. Without a calendar it checks the feed every 15 minutes.
- **Notifications:** session start, new leader, Safety Car / VSC / red flag, finish with the top three.
- **Delay** of 0–60 s to stay in sync with the TV broadcast.
- **Built-in demo race** with fictional drivers and teams.
- **Translations:** English and Polish.

## Install

From extensions.gnome.org (after review), or from the files on the [Releases page](https://github.com/jgu-linux-apps/linux-purple-sector-live-timing/releases/latest):

```bash
# zip
gnome-extensions install --force purple-sector-live-timing@jgu.shell-extension.zip

# or Debian/Ubuntu package (system-wide; replaces linux-f1-live-timing)
sudo apt install ./linux-purple-sector-live-timing_<version>_all.deb
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

The source code is in the `src/` folder of this repository; the zip and `.deb` are not kept in git but
attached to [GitHub Releases](https://github.com/jgu-linux-apps/linux-purple-sector-live-timing/releases). The version is set in `packaging/build.sh` (`VERSION`). Pushing a tag
`vX.Y.Z` with the same version makes GitHub Actions (`.github/workflows/release.yml`) build both files and
publish the release. Run the commands below inside `src/` (building needs `gettext`, `gnome-shell` and `fakeroot`):

```bash
gjs -m tests/test-core.js                    # logic tests (state, view, calendar, demo replay)
python3 tools/make_demo.py                   # regenerate the demo race
python3 tools/fake_feed_server.py            # local stand-in feed for testing (needs python3-websockets)
./packaging/build.sh                         # → dist/*.shell-extension.zip and dist/*.deb
```

`tools/` and `tests/` are not part of the extension zip.

## Version history

- **1.0.9** (2026-11-14): new dark-mode app icon in the series style: the app's own symbol on a deep navy tile, the same as the other apps of the series (used in notifications and settings).
- **1.0.7** (2026-11-14): the Aurora menu style has a thin border instead of a wide glow; the menu has **Refresh** (fetches the calendar again and reconnects for a fresh classification) and **Quit** (switches the extension off, like the switch in the Extensions app; switch it on there again). After a package update the menu shows **Version X installed – log out to load it**: GNOME Shell keeps the old code in memory until the next login.
- **1.0.5** (2026-11-14): new **Aurora** menu style (Settings → Appearance → Menu style), the shared look of the JGu Linux Apps series: lavender / deep navy card, violet-to-cyan switches, light or dark following the system. Timing colours (purple fastest sector, green, red) are unchanged.
- **1.0.4** (2026-11-12): project address updated to `github.com/jgu-linux-apps` (extension metadata and package homepage).
- **1.0.3** (2026-11-12): no changes in the extension. The repository now keeps the source code in `src/`, and the zip and `.deb` are published on the GitHub Releases page (built by GitHub Actions for every version tag).
- **1.0.2** and earlier: see the git history.

## Credits and license

**Created by:** JGu
**Supported by** Claude

GPL-2.0-or-later (see `LICENSE`).
