# BUSY Codex

Codex usage on a USB-connected BUSY Bar: a large remaining percentage, a centered local clock, time until the quota resets, and a continuous progress bar.

![BUSY Codex display](docs/display.png)

## Install

Requirements:

- macOS, a BUSY Bar connected over USB, and HTTP API 27.12.0 or newer. Tested on stock firmware 1.3.1 / API 27.14.0.
- Node **24** and npm. Node 26 is not supported by the BUSY toolchain.
- Codex CLI installed, available on `PATH`, and signed in with ChatGPT. API-key-only usage is not supported by the quota endpoint.

```sh
git clone https://github.com/moltar-forge/busy-codex.git
cd busy-codex
nvm install
nvm use
npm ci
npm run setup
```

If you do not use nvm, install Node 24 through your preferred manager before running the npm commands.

Setup checks and builds the app, installs it on the bar, generates a macOS LaunchAgent for your current user, copies a self-contained updater into Application Support, and launches the display. It detects the Node and Codex executable paths; nothing is tied to a particular username or checkout location. The checkout can be moved after installation.

Re-run `npm run setup` after pulling updates. Re-running setup also repairs or replaces an existing installation. If your Node/Codex installation moves, run setup again to refresh the stored paths.

Optional setup arguments:

```sh
npm run setup -- --dry-run
npm run setup -- --codex /absolute/path/to/codex
npm run setup -- --addr 10.0.4.20
npm run setup -- --helper-only
```

`--helper-only` installs just the background updater. The app must already be installed on the device. App settings are accessed over USB; this project does not configure Wi-Fi access.

## Remove

With the BUSY Bar connected:

```sh
npm run teardown
```

This stops the LaunchAgent, removes the installed updater and its local configuration/cache, and uninstalls the device app. It keeps the app's device settings and diagnostic logs. It never changes or deletes your Codex login, source checkout, or system Node installation.

```sh
npm run teardown -- --dry-run
npm run teardown -- --helper-only
```

If the device is disconnected, teardown still removes the Mac updater and reports that device removal is pending. Reconnect and repeat the command; already-removed components are skipped.

## Display and controls

- Large number: percentage of quota remaining. If multiple quota windows are present, use the one with the least remaining allowance.
- Center clock: 12-hour time from the BUSY Bar's configured local time.
- Upper right: time until the selected quota resets, such as `2d23h`.
- Bottom bar: remaining allowance; blue normally, red at 10% or less.
- `STALE` and amber: no fresh usage snapshot for ten minutes. `USB` / `--%`: no valid snapshot yet.
- OK or Start refreshes the on-device snapshot. Back exits the app; long Back remains the firmware's force-quit gesture.

The app respects the device's brightness setting. If automatic brightness fluctuates, choose a fixed level in BUSY Bar settings. Setup does not change brightness.

## How it works

```text
Codex sign-in on the Mac
    │ read-only account/rateLimits/read (Codex app-server)
    ▼
Mac updater, every 60 seconds
    │ tiny settings snapshot over USB HTTP
    ▼
BUSY Bar JavaScript app
    └─ percentage · clock · reset countdown · progress bar
```

The Mac must be awake, signed in, and connected for live usage updates. Credentials stay with Codex on the Mac. The bar receives only remaining percentage, window duration, reset timestamp, and snapshot timestamp. It never receives an access token.

The updater writes immediately when usage changes, or every five minutes as a heartbeat. The bar checks its settings and local clock every 15 seconds, redrawing only when visible pixels change. Network errors leave the app running; stale data is labeled. No firmware modifications or inference/model calls are needed.

## Installed files and troubleshooting

| Location | Purpose |
| --- | --- |
| `~/Library/Application Support/BUSYCodex/` | Installed updater, generated `config.json`, and usage cache |
| `~/Library/LaunchAgents/app.moltar.busy-codex-usage.plist` | Per-user launchd service, runs at login and every minute |
| `~/Library/Logs/BUSYCodex/sync.log` | Diagnostic output retained by teardown |

```sh
# Run one sync from the checkout using Codex on PATH and the USB address.
npm run sync

# Inspect the background service.
launchctl print gui/$(id -u)/app.moltar.busy-codex-usage

# Inspect recent diagnostics.
tail -n 30 ~/Library/Logs/BUSYCodex/sync.log
```

For a one-off sync, `BUSY_BAR_ADDR` and `BUSY_CODEX_PATH` can override the address or executable. Generated configuration, caches, logs, and `.env` files are ignored by Git. No API key is needed.

If usage is stale, check USB connectivity, Mac sleep, and Codex sign-in. If the executable path is missing, activate Node 24 and re-run setup. The companion uses macOS's built-in curl for device requests because native Node networking from LaunchAgents was unreliable on the original Mac.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
```

`npm test` checks quota selection, portable configuration, installer/reinstaller/removal behavior, XML escaping, and the updater against a simulated Codex process and HTTP device. These tests use temporary directories and do not touch real LaunchAgents or account credentials.

The app package is `dist/app.moltar.codex.tgz`. For device-only development:

```sh
npm run app:install
npm run app:run
npm run app:stop
npm run app:uninstall
```

CI runs the tests, type-check, and build. Tags matching the manifest version publish a device archive to a private GitHub release. Both the app package and Mac updater are required for a full installation.

References: [BUSY app instructions](https://go.busy.app/agents), [BUSY tooling](https://github.com/busy-app/busy-tools), [Codex app-server](https://learn.chatgpt.com/docs/app-server).
