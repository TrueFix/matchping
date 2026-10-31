# Development

## Requirements

- Go 1.25+, Node.js 22+, npm, and your OS `ping` utility.
- [Wails v2](https://wails.io/) and native webview development libraries.

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
```

### Linux desktop

CachyOS / Arch:

```sh
sudo pacman -S --needed base-devel pkgconf gtk3 webkit2gtk-4.1 iputils
"$(go env GOPATH)/bin/wails" build -tags desktop,webkit2_41
./build/bin/matchping
```

Ubuntu 24.04 dependencies:

```sh
sudo apt-get install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev iputils-ping
```

Use `wails dev -tags desktop,webkit2_41` for native hot reload.

### Windows & macOS

Windows needs GCC/MinGW and WebView2. macOS needs Xcode command-line tools.

```sh
wails dev -tags desktop
wails build -tags desktop
```

### Browser preview

The browser preview is for development; the shipped app opens a native desktop window. Build the frontend first because Go embeds its output:

```sh
cd frontend
npm ci
npm run build
cd ..
go run ./cmd/preview
```

Open `http://127.0.0.1:3415`. For frontend hot reload, also run `npm run dev` in `frontend`. The preview binds to loopback only and uses the same backend as the desktop app.

## Checks

```sh
go test -race ./...
go vet ./...
python3 scripts/release.py validate --tag v0.1.0
cd frontend
npm test
npx playwright install chromium
npm run test:e2e
```

Build `frontend` before Go tests. Browser tests use Steam’s public endpoint for integration coverage, but mock all geolocation requests. Unit tests use HTTP fixtures; tests do not require ICMP to succeed. Playwright uses its own preview port (`3417`, or `PICKER_TEST_PORT`) and never reuses an existing preview.

## Map behavior

The map is bundled and requires no API token or tile service. An interactive SVG renderer automatically handles WebGL/worker failures. Both renderers have bounded Mercator navigation (55°S–75°N), separately clickable labels, and reduced-motion support. Labels retain their screen-space offsets during camera movement and resolve collisions when navigation settles.

Desktop builds use the `desktop` build tag so backend tests and preview builds do not need native webview libraries. `--version` prints the build version without opening a window.

## Icons and local release packaging

The original SVG artwork is `frontend/public/matchping.svg`. The dependency-free Go generator produces matching PNG and multi-resolution ICO assets:

```sh
go run ./scripts/icon
python3 scripts/collect_licenses.py
python3 scripts/package_release.py --platform linux/amd64
```

Wails embeds the icon in Windows resources and macOS app bundles. Linux also receives a window icon and a `.desktop` launcher in its release archive. `install.sh` installs only under the current user’s data directory.
