#!/usr/bin/env bash
set -euo pipefail

# Explicit, per-user installation. Never use sudo or modify system directories.
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
case "$data_dir" in
  /*) ;;
  *) echo 'XDG_DATA_HOME must be an absolute path.' >&2; exit 1 ;;
esac
case "$data_dir" in
  *$'\n'*|*$'\r'*) echo 'Installation paths must not contain newlines.' >&2; exit 1 ;;
esac
app_dir="$data_dir/matchping"
mkdir -p -- "$app_dir" "$data_dir/applications" "$data_dir/icons/hicolor/256x256/apps"
install -m 755 -- "$source_dir/matchping" "$app_dir/matchping"
install -m 644 -- "$source_dir/matchping.png" "$data_dir/icons/hicolor/256x256/apps/matchping.png"
install -m 644 -- "$source_dir/LICENSE" "$source_dir/THIRD_PARTY_NOTICES.md" "$app_dir/"
cp -R -- "$source_dir/licenses" "$app_dir/"

# Desktop Entry Exec has its own quoting rules, including literal percent signs.
executable="$app_dir/matchping"
executable="${executable//\\/\\\\}"
executable="${executable//\"/\\\"}"
executable="${executable//\`/\\\`}"
executable="${executable//\$/\\\$}"
executable="${executable//%/%%}"
{
  printf '[Desktop Entry]\nType=Application\nName=MatchPing\n'
  printf 'Comment=Explore Steam relays and compare real connection latency\n'
  printf 'Exec="%s"\n' "$executable"
  printf 'Icon=matchping\nTerminal=false\nCategories=Game;Network;\nStartupWMClass=matchping\n'
} > "$data_dir/applications/matchping.desktop"
chmod 644 "$data_dir/applications/matchping.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$data_dir/applications" || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -f -t "$data_dir/icons/hicolor" >/dev/null 2>&1 || true; fi
printf 'Installed MatchPing. Open it from your application launcher.\nBinary: %s/matchping\n' "$app_dir"
