#!/usr/bin/env python3
"""Collect full license/notice texts from locked runtime dependencies, without npm tools."""
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "licenses"


def collect(name, version, directory, kind):
    target = OUTPUT / kind / re.sub(r"[^A-Za-z0-9_.-]", "_", name + "@" + version)
    files = []
    candidates = list(directory.iterdir())
    for candidate in sorted(candidates):
        if candidate.is_file() and candidate.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE", "UNLICENSE")):
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(candidate, target / candidate.name)
            files.append((target / candidate.name).relative_to(OUTPUT).as_posix())
    if not files and name == "murmurhash-js":
        # This published package puts its full MIT license and copyright in README.
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(directory / "README.md", target / "README.md")
        files.append((target / "README.md").relative_to(OUTPUT).as_posix())
    if not files:
        raise ValueError(f"No license text found for {name}@{version}; review before distribution")
    return {"name": name, "version": version, "files": files}


def main():
    inventory = []
    frontend = ROOT / "frontend"
    lock = json.loads((frontend / "package-lock.json").read_text(encoding="utf-8"))
    seen = set()

    def visit(name, parent, optional=False):
        current = parent
        directory = None
        while current.is_relative_to(frontend):
            candidate = current / "node_modules" / name
            if (candidate / "package.json").is_file():
                directory = candidate
                break
            current = current.parent
        if directory is None:
            if optional:
                return
            raise ValueError(f"Missing runtime package: {name}")
        if directory in seen:
            return
        seen.add(directory)
        metadata = json.loads((directory / "package.json").read_text(encoding="utf-8"))
        locked = lock["packages"][directory.relative_to(frontend).as_posix()]
        if metadata["version"] != locked["version"]:
            raise ValueError(f"Installed version does not match lockfile: {name}")
        inventory.append(collect(metadata["name"], metadata["version"], directory, "npm"))
        for dependency in sorted(metadata.get("dependencies", {})):
            visit(dependency, directory)
        for dependency in sorted(metadata.get("optionalDependencies", {})):
            visit(dependency, directory, optional=True)

    for name in sorted(lock["packages"][""]["dependencies"]):
        if name != "@tailwindcss/vite":  # build-time Vite plugin, not shipped in the UI
            visit(name, frontend)

    subprocess.run(["go", "mod", "download", "all"], cwd=ROOT, check=True)
    text = subprocess.check_output(["go", "list", "-m", "-json", "all"], cwd=ROOT, encoding="utf-8")
    decoder = json.JSONDecoder()
    while text.strip():
        module, length = decoder.raw_decode(text.lstrip())
        text = text.lstrip()[length:]
        if module.get("Main"):
            continue
        inventory.append(collect(module["Path"], module["Version"], Path(module["Dir"]), "go"))
    (OUTPUT / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    print(f"Collected notices for {len(inventory)} dependencies")


if __name__ == "__main__":
    main()
