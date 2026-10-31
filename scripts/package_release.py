#!/usr/bin/env python3
"""Package native builds with their icon, license notices, and Linux launcher."""
import argparse
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def verify_windows(path):
    data = path.read_bytes()
    pe = struct.unpack_from("<I", data, 0x3c)[0]
    if data[:2] != b"MZ" or data[pe:pe+4] != b"PE\0\0":
        raise ValueError("Not a Windows executable")
    optional = pe + 24
    if struct.unpack_from("<H", data, optional + 68)[0] != 2:
        raise ValueError("Windows build must use the GUI subsystem, not a console")
    directories = optional + (112 if struct.unpack_from("<H", data, optional)[0] == 0x20b else 96)
    resource_rva = struct.unpack_from("<I", data, directories + 16)[0]
    sections = optional + struct.unpack_from("<H", data, pe + 20)[0]
    resource_offset = None
    for index in range(struct.unpack_from("<H", data, pe + 6)[0]):
        section = sections + index * 40
        size, address, raw_size, raw_offset = struct.unpack_from("<IIII", data, section + 8)
        if address <= resource_rva < address + max(size, raw_size):
            resource_offset = raw_offset + resource_rva - address
            break
    if resource_offset is None:
        raise ValueError("Windows icon resources are missing")
    named, ids = struct.unpack_from("<HH", data, resource_offset + 12)
    resource_types = {struct.unpack_from("<I", data, resource_offset + 16 + i * 8)[0] for i in range(named + ids)}
    if not {3, 14}.issubset(resource_types):
        raise ValueError("Windows executable must contain icon and icon-group resources")


def add_notices(destination):
    for filename in ["LICENSE", "THIRD_PARTY_NOTICES.md"]:
        shutil.copyfile(ROOT / filename, destination / filename)
    if not (ROOT / "licenses/inventory.json").is_file():
        raise ValueError("Run scripts/collect_licenses.py before packaging")
    shutil.copytree(ROOT / "licenses", destination / "licenses")


def package(platform, output):
    output.mkdir(parents=True, exist_ok=True)
    basename = "matchping-" + platform.replace("/", "-")
    with tempfile.TemporaryDirectory(prefix=".package-", dir=output) as temporary:
        stage = Path(temporary) / basename
        stage.mkdir()
        if platform == "linux/amd64":
            shutil.copyfile(ROOT / "build/bin/matchping", stage / "matchping")
            (stage / "matchping").chmod(0o755)
            for name in ["matchping.png", "matchping.desktop", "install.sh"]:
                shutil.copyfile(ROOT / "build/linux" / name, stage / name)
            (stage / "install.sh").chmod(0o755)
            add_notices(stage)
            target = output / (basename + ".tar.gz")
            with tarfile.open(target, "w:gz") as archive:
                archive.add(stage, arcname=basename)
        elif platform == "windows/amd64":
            binary = ROOT / "build/bin/matchping.exe"
            verify_windows(binary)
            shutil.copyfile(binary, stage / "matchping.exe")
            add_notices(stage)
            target = output / (basename + ".zip")
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for file in sorted(stage.rglob("*")):
                    if file.is_file():
                        archive.write(file, file.relative_to(stage.parent))
        else:
            apps = list((ROOT / "build/bin").glob("*.app"))
            if len(apps) != 1:
                raise ValueError("Expected exactly one macOS app bundle")
            app = stage / apps[0].name
            shutil.copytree(apps[0], app, symlinks=True)
            resources = app / "Contents/Resources"
            if not list(resources.glob("*.icns")):
                raise ValueError("macOS app icon is missing")
            add_notices(resources)
            target = output / (basename + ".zip")
            subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(target.resolve())], check=True)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=["linux/amd64", "windows/amd64", "darwin/amd64", "darwin/arm64"])
    parser.add_argument("--output", type=Path, default=ROOT / "release")
    args = parser.parse_args()
    print(package(args.platform, args.output))
