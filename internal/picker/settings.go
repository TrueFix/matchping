package picker

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Import only the previous development build's app preference and public Steam
// caches. Existing MatchPing files win; unrelated files and symlinks are ignored.
func importLegacySettings(legacy, destination string) {
	entries, err := os.ReadDir(legacy)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		allowed := name == "settings.json"
		if strings.HasPrefix(name, "sdr-") && strings.HasSuffix(name, ".json") {
			id, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimPrefix(name, "sdr-"), ".json"), 10, 32)
			allowed = err == nil && id > 0
		}
		if !allowed || !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.Size() > 8<<20 {
			continue
		}
		data, err := os.ReadFile(filepath.Join(legacy, name))
		if err != nil || os.MkdirAll(destination, 0700) != nil {
			continue
		}
		file, err := os.OpenFile(filepath.Join(destination, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			continue
		}
		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(filepath.Join(destination, name))
		}
	}
}
