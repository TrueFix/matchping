# MatchPing

A desktop app for comparing your connection to Steam’s relay network. Built for **Counter-Strike 2**, with support for other games that publish Steam Datagram Relay configuration.

**This app measures relay latency. It does not select, block, or force a matchmaking region.**

## What it does

- Measures real ICMP round-trip times from your device—no estimated or sample pings.
- Shows individual relay locations on an interactive world map, with clickable details.
- Focuses on your approximate region at startup. Automatic region lookup can be disabled.
- Finds the lowest measured ping, with search, filters, sorting, and scan cancellation.
- Remembers your last App ID and caches Steam configuration for offline fallback.
- Checks for new GitHub releases when requested. Updates are downloaded and installed manually.

## Get started

Download a native GUI build from **[Releases](https://github.com/TrueFix/matchping/releases/latest)**:

| Platform | Download | Launch |
| --- | --- | --- |
| Linux x64 | `matchping-linux-amd64.tar.gz` | Extract; run `./matchping`, or `./install.sh` for an application-menu entry and icon. |
| Windows x64 | `matchping-windows-amd64.zip` | Extract and open `matchping.exe`. |
| macOS Intel | `matchping-darwin-amd64.zip` | Extract the app and move it to Applications. |
| macOS Apple Silicon | `matchping-darwin-arm64.zip` | Extract the app and move it to Applications. |

On Linux, install GTK3, WebKitGTK 4.1, and `ping`:

```sh
# CachyOS / Arch
sudo pacman -S --needed gtk3 webkit2gtk-4.1 iputils

tar -xzf matchping-linux-amd64.tar.gz
cd matchping-linux-amd64
./matchping
# Optional: install for this user, including the launcher icon (no sudo)
./install.sh
```

Ubuntu 24.04: install `libgtk-3-0t64`, `libwebkit2gtk-4.1-0`, and `iputils-ping` instead. Windows requires the Microsoft WebView2 runtime. Packages are currently unsigned; macOS packages are not notarized.

The app loads and scans automatically. Open **Locations** to search, filter, and view reply counts. Click a map label for its measurement and endpoint, or the **Lowest ping** shortcut in the toolbar to locate the fastest reply. Use **Scan network** to measure again.

The default App ID is **730** (CS2). Other App IDs must expose public SDR data.

## Understand the results

Ping is the median of up to three ICMP replies from a responding relay, **not in-game latency**. A missing reply can mean ICMP is blocked; it does not prove that a relay is offline. Unsupported system ping output or insufficient network permissions are shown as unavailable, never as fabricated results.

Steam relay locations and coordinates may be inaccurate and do not necessarily correspond to matchmaking regions. Cached configuration is clearly marked when Steam cannot be reached.

## Privacy

On startup, the app fetches Steam’s public configuration, sends ICMP probes to relay addresses, and uses **[ipwho.is](https://ipwho.is/)** to approximate your region from your public IP. VPNs and proxies affect the location result.

Open **region settings** in the toolbar and disable **Automatically focus on startup** to prevent future automatic location requests; the preference is saved locally. **Recenter** requests a lookup manually. Only country, continent, and whole-degree coordinates are kept in memory for 30 minutes, not saved or logged.

No analytics, telemetry, or remote map tiles. GitHub is contacted only when you check for updates. Settings and Steam configuration caches are stored in your OS configuration directory under `matchping/`. App ID and cache files from older `server-picker/` development builds are imported without overwriting MatchPing settings.

## Build & contribute

See [Development](docs/DEVELOPMENT.md) for native build instructions and tests, [Releasing](docs/RELEASING.md) for the release checklist, and [Changelog](CHANGELOG.md) for release notes.

## License & credits

MatchPing’s original code and icon are [MIT licensed](LICENSE). Built with Go, Wails, React, open-source shadcn/ui primitives, and MapLibre. The workspace is an original implementation, not a redistributed commercial UI Kit block. Map data: [Natural Earth](https://www.naturalearthdata.com/), public domain. See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency attribution. Not affiliated with Valve.
