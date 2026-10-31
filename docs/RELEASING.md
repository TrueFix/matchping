# Releasing MatchPing

Repository: **https://github.com/TrueFix/matchping**. The first downloadable public version is **v0.1.1**. The `v0.1.0` tag was retained after its build failed before publication. A successful local Linux build is not verification of the Windows or macOS packages.

## Before publishing

- Push changes to `git@github.com:TrueFix/matchping.git`. Local development builds deliberately omit release-feed configuration; release builds inject the repository.
- Preserve the MIT `LICENSE` and third-party notices. Commercial UI Kit blocks must not be added to this public-source project.
- Confirm `VERSION`, `frontend/package.json`, `frontend/package-lock.json`, and `wails.json` agree. Run `python3 scripts/release.py validate --tag "v$(cat VERSION)"`.
- Complete the checks in [Development](DEVELOPMENT.md) and review the UI at desktop and narrow widths.
- Verify startup scanning, automatic region focus and its off switch, timeouts, cached Steam data, map recovery, and update-check errors.
- Review [Changelog](../CHANGELOG.md), privacy disclosures, dependencies, and distribution rights. Confirm current geolocation-provider terms before distribution.
- Smoke-test the downloaded artifacts on their target operating systems. Check Linux runtime dependencies, Windows WebView2, and OS trust warnings.

## Publish

Push a matching version tag (for example, `v0.1.1`), or manually dispatch the Release workflow with an existing tag. This publishes a release: do not tag until the checklist is complete.

The workflow checks versions, runs tests, verifies regenerated icons, collects dependency license texts, and builds Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon on native runners. Windows packaging verifies the GUI subsystem and embedded icon resources; macOS packaging requires an `.icns` icon. Linux includes a per-user desktop launcher installer. Once every job succeeds, it publishes four native archives, `SHA256SUMS`, and `update-manifest.json`.

Icon verification compares decoded PNG pixels and ICO metadata, not compressed bytes: PNG encoders can change between Go versions without changing the artwork.

Release notes are read from `docs/releases/<tag>.md` when present; otherwise GitHub generates notes. A failed native build or packaging check prevents publication.

## Update behavior

Release builds inject their version and GitHub `owner/repository` through Go linker flags. The checker reads that repository’s latest stable release manifest and accepts only release URLs belonging to the configured repository. Prereleases are not offered on the stable channel.

Users download and replace the app themselves. No executable is silently replaced. Packages are currently unsigned and macOS builds are not notarized; disclose this until signing is configured.
