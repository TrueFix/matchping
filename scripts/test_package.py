import os
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import package_release


class PackageTests(unittest.TestCase):
    def test_windows_gui_and_embedded_icon_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "matchping.exe"
            data = bytearray(2048)
            data[:2] = b"MZ"
            struct.pack_into("<I", data, 0x3c, 128)
            data[128:132] = b"PE\0\0"
            struct.pack_into("<H", data, 134, 1)  # one section
            struct.pack_into("<H", data, 148, 240)  # PE32+ optional header
            struct.pack_into("<H", data, 152, 0x20b)
            struct.pack_into("<H", data, 220, 2)  # GUI subsystem
            struct.pack_into("<I", data, 280, 0x1000)  # resource RVA
            struct.pack_into("<IIII", data, 400, 512, 0x1000, 512, 512)
            struct.pack_into("<HH", data, 524, 0, 2)
            struct.pack_into("<II", data, 528, 3, 0)
            struct.pack_into("<II", data, 536, 14, 0)
            binary.write_bytes(data)
            package_release.verify_windows(binary)
            struct.pack_into("<H", data, 220, 3)
            binary.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "GUI subsystem"):
                package_release.verify_windows(binary)
            struct.pack_into("<H", data, 220, 2)
            struct.pack_into("<HH", data, 524, 0, 1)
            binary.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "icon-group"):
                package_release.verify_windows(binary)

    @unittest.skipIf(os.name == "nt", "Linux desktop installer requires Bash and Unix tools")
    def test_linux_archive_and_per_user_launcher(self):
        original = package_release.ROOT
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "build/bin").mkdir(parents=True)
            (root / "build/bin/matchping").write_bytes(b"fixture native binary")
            shutil.copytree(original / "build/linux", root / "build/linux")
            for filename in ["LICENSE", "THIRD_PARTY_NOTICES.md"]:
                shutil.copyfile(original / filename, root / filename)
            (root / "licenses").mkdir()
            (root / "licenses/inventory.json").write_text("[]")
            with patch.object(package_release, "ROOT", root):
                archive = package_release.package("linux/amd64", root / "release")
            extracted = root / "extracted"
            with tarfile.open(archive) as bundle:
                self.assertTrue(bundle.getmember("matchping-linux-amd64/install.sh").mode & 0o111)
                bundle.extractall(extracted, filter="data")
            folder = extracted / "matchping-linux-amd64"
            data = root / "user data 100%"
            subprocess.run(["bash", str(folder / "install.sh")], env={**os.environ, "XDG_DATA_HOME": str(data)}, check=True, capture_output=True)
            desktop = (data / "applications/matchping.desktop").read_text()
            self.assertIn('Exec="' + str(data / "matchping/matchping").replace("%", "%%") + '"', desktop)
            self.assertIn("Icon=matchping", desktop)
            self.assertIn("Terminal=false", desktop)
            self.assertTrue((data / "icons/hicolor/256x256/apps/matchping.png").is_file())
            self.assertTrue((data / "matchping/LICENSE").is_file())
            self.assertEqual((data / "matchping/matchping").read_bytes(), b"fixture native binary")


if __name__ == "__main__":
    unittest.main()
