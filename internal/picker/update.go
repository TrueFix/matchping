package picker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

var repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type Update struct {
	Version    string `json:"version"`
	ReleaseURL string `json:"releaseUrl"`
	Available  bool   `json:"available"`
}

func validateUpdate(update Update, repository, current string) (Update, error) {
	version := "v" + strings.TrimPrefix(update.Version, "v")
	if !semver.IsValid(version) || semver.Prerelease(version) != "" {
		return Update{}, fmt.Errorf("invalid stable update version")
	}
	expected := "https://github.com/" + repository + "/releases/tag/" + version
	if update.ReleaseURL != expected {
		return Update{}, fmt.Errorf("update release URL does not match the configured repository")
	}
	update.Available = semver.Compare(version, "v"+strings.TrimPrefix(current, "v")) > 0
	return update, nil
}

func (s *Service) CheckUpdate() (Update, error) {
	if !repositoryPattern.MatchString(Repository) {
		return Update{}, fmt.Errorf("Updates are not configured in this local build. Tagged GitHub builds configure the release feed automatically.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://github.com/"+Repository+"/releases/latest/download/update-manifest.json", nil)
	if err != nil {
		return Update{}, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return Update{}, fmt.Errorf("check updates: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return Update{}, fmt.Errorf("No published stable release is available yet")
	}
	if resp.StatusCode != 200 {
		return Update{}, fmt.Errorf("update server returned HTTP %d", resp.StatusCode)
	}
	var update Update
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&update); err != nil {
		return Update{}, fmt.Errorf("invalid update manifest: %w", err)
	}
	return validateUpdate(update, Repository, Version)
}

func (s *Service) ReleaseURL() (string, error) {
	if !repositoryPattern.MatchString(Repository) {
		return "", fmt.Errorf("No release repository is configured")
	}
	return "https://github.com/" + Repository + "/releases/latest", nil
}
