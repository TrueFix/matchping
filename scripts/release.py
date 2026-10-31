#!/usr/bin/env python3
"""Validate tracked versions and prepare checksummed GitHub release assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
TAG = re.compile(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?")


def validate(tag):
    if not TAG.fullmatch(tag):
        raise ValueError("Expected a version tag such as v0.1.0 or v0.2.0-beta.1")
    version = tag[1:]
    if (ROOT / "VERSION").read_text().strip() != version:
        raise ValueError("VERSION does not match the release tag")
    package = json.loads((ROOT / "frontend/package.json").read_text())
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    if package["version"] != version or lock["version"] != version or lock["packages"][""]["version"] != version:
        raise ValueError("Frontend package and lockfile versions must match VERSION")
    desktop = json.loads((ROOT / "wails.json").read_text())
    if desktop["info"]["productVersion"] != version.split("-")[0]:
        raise ValueError("Wails productVersion must match the numeric release version")
    return version


def prepare(tag, repository, directory):
    version = validate(tag)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Expected repository in owner/name form")
    assets = []
    for path in sorted(directory.glob("matchping-*")):
        if path.is_file():
            assets.append({"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": path.stat().st_size})
    expected = {"matchping-linux-amd64.tar.gz", "matchping-windows-amd64.zip", "matchping-darwin-amd64.zip", "matchping-darwin-arm64.zip"}
    if {asset["name"] for asset in assets} != expected:
        raise ValueError("Missing or unexpected native release artifacts")
    manifest = {"version": version, "releaseUrl": f"https://github.com/{repository}/releases/tag/{tag}", "assets": assets}
    manifest_path = directory / "update-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    sums = [f'{a["sha256"]}  {a["name"]}' for a in assets]
    sums.append(f"{hashlib.sha256(manifest_path.read_bytes()).hexdigest()}  update-manifest.json")
    (directory / "SHA256SUMS").write_text("\n".join(sums) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["validate", "prepare"])
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repository")
    parser.add_argument("--directory", type=Path, default=ROOT / "release")
    args = parser.parse_args()
    version = validate(args.tag)
    if args.command == "prepare":
        prepare(args.tag, args.repository or "", args.directory)
    output = f"version={version}\nprerelease={'true' if '-' in version else 'false'}\n"
    print(output, end="")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(output)


if __name__ == "__main__":
    main()
