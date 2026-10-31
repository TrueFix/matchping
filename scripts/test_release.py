import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import release

VERSION = (release.ROOT / "VERSION").read_text().strip()
TAG = "v" + VERSION


class ReleaseTests(unittest.TestCase):
    def test_versions(self):
        self.assertEqual(release.validate(TAG), VERSION)
        next_major = int(VERSION.split(".")[0]) + 1
        for tag in [f"v{next_major}.0.0", VERSION, "v01.1.0", TAG + "/bad"]:
            with self.assertRaises(ValueError):
                release.validate(tag)

    def test_manifest_and_checksums(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            names = ["matchping-linux-amd64.tar.gz", "matchping-windows-amd64.zip", "matchping-darwin-amd64.zip", "matchping-darwin-arm64.zip"]
            with self.assertRaises(ValueError):
                release.prepare(TAG, "owner/repository", directory)
            for name in names:
                (directory / name).write_bytes(b"fixture artifact")
            release.prepare(TAG, "owner/repository", directory)
            manifest = json.loads((directory / "update-manifest.json").read_text())
            self.assertEqual(manifest["version"], VERSION)
            self.assertEqual(len(manifest["assets"]), 4)
            self.assertEqual(manifest["releaseUrl"], f"https://github.com/owner/repository/releases/tag/{TAG}")
            for line in (directory / "SHA256SUMS").read_text().splitlines():
                checksum, name = line.split("  ")
                self.assertEqual(hashlib.sha256((directory / name).read_bytes()).hexdigest(), checksum)


if __name__ == "__main__":
    unittest.main()
