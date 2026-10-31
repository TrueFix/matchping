package picker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLegacySettingsImport(t *testing.T) {
	old, current := t.TempDir(), t.TempDir()
	for _, name := range []string{"settings.json", "sdr-730.json", "private.txt", "sdr-invalid.json"} {
		if err := os.WriteFile(filepath.Join(old, name), []byte(`{"appId":570}`), 0600); err != nil {
			t.Fatal(err)
		}
	}
	importLegacySettings(old, current)
	if NewService(current).Info().AppID != 570 {
		t.Fatal("previous App ID was not imported")
	}
	if _, err := os.Stat(filepath.Join(current, "sdr-730.json")); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"private.txt", "sdr-invalid.json"} {
		if _, err := os.Stat(filepath.Join(current, name)); !os.IsNotExist(err) {
			t.Fatal("unrelated legacy file imported")
		}
	}
	if err := os.WriteFile(filepath.Join(current, "settings.json"), []byte(`{"appId":730}`), 0600); err != nil {
		t.Fatal(err)
	}
	importLegacySettings(old, current)
	if NewService(current).Info().AppID != 730 {
		t.Fatal("existing MatchPing preference was overwritten")
	}
}
