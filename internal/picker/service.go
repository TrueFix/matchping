package picker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Set by release builds. Local builds deliberately have no assumed GitHub owner.
var Version = "0.1.0-dev"
var Repository = ""

type State struct {
	ID        uint64     `json:"id"`
	AppID     uint32     `json:"appId"`
	Running   bool       `json:"running"`
	Phase     string     `json:"phase"`
	Locations []Location `json:"locations"`
	Completed int        `json:"completed"`
	Revision  int64      `json:"revision"`
	FetchedAt time.Time  `json:"fetchedAt"`
	Stale     bool       `json:"stale"`
	Warning   string     `json:"warning"`
	Error     string     `json:"error"`
}

type BuildInfo struct {
	Version    string `json:"version"`
	Repository string `json:"repository"`
	AppID      uint32 `json:"appId"`
}

type Service struct {
	regionMu      sync.Mutex
	region        Region
	regionExpires time.Time
	regionRetry   time.Time
	mu            sync.Mutex
	state         State
	cancel        context.CancelFunc
	client        *http.Client
	endpoint      string
	dir           string
	lastAppID     uint32
	probe         func(context.Context, Location) Location
}

func NewService(dir string) *Service {
	legacy := ""
	if dir == "" {
		if base, err := os.UserConfigDir(); err == nil {
			dir = filepath.Join(base, "matchping")
			legacy = filepath.Join(base, "server-picker")
		}
	}
	if legacy != "" {
		importLegacySettings(legacy, dir)
	}
	s := &Service{client: &http.Client{Timeout: 15 * time.Second}, endpoint: configEndpoint, dir: dir, lastAppID: 730, probe: probe}
	s.state = State{AppID: 730, Phase: "idle", Locations: []Location{}}
	var settings struct {
		AppID uint32 `json:"appId"`
	}
	if b, err := os.ReadFile(filepath.Join(dir, "settings.json")); dir != "" && err == nil && json.Unmarshal(b, &settings) == nil && settings.AppID > 0 {
		s.lastAppID = settings.AppID
	}
	return s
}

func (s *Service) Info() BuildInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return BuildInfo{Version: Version, Repository: Repository, AppID: s.lastAppID}
}

func (s *Service) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.state
	state.Locations = append([]Location{}, state.Locations...)
	return state
}

func (s *Service) StartScan(appID uint32) (uint64, error) {
	if appID == 0 {
		return 0, fmt.Errorf("App ID must be a positive 32-bit integer")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	id := s.state.ID + 1
	s.state = State{ID: id, AppID: appID, Running: true, Phase: "loading", Locations: []Location{}}
	go s.run(ctx, id, appID)
	return id, nil
}

func (s *Service) CancelScan() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	s.state.Running = false
	if s.state.Phase == "loading" || s.state.Phase == "probing" {
		s.state.Phase = "cancelled"
	}
	for i := range s.state.Locations {
		if s.state.Locations[i].Status == "pending" {
			s.state.Locations[i].Status = "cancelled"
		}
	}
}

func (s *Service) update(ctx context.Context, id uint64, f func(*State)) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil || s.state.ID != id {
		return false
	}
	f(&s.state)
	return true
}

func (s *Service) run(ctx context.Context, id uint64, appID uint32) {
	cfg, err := fetchConfig(ctx, s.client, s.endpoint, appID)
	cache := cachedConfig{AppID: appID, Config: cfg, FetchedAt: time.Now().UTC()}
	stale, warning := false, ""
	if ctx.Err() != nil {
		return
	}
	if err != nil {
		original := err
		b, readErr := os.ReadFile(s.cachePath(appID))
		if s.dir == "" || readErr != nil || json.Unmarshal(b, &cache) != nil || cache.AppID != appID || !cache.Config.Success || len(cache.Config.POPs) == 0 {
			s.update(ctx, id, func(st *State) { st.Error = original.Error(); st.Running = false; st.Phase = "error" })
			return
		}
		stale, warning = true, "Using cached Steam configuration: "+original.Error()
	} else if err := s.writeJSON(s.cachePath(appID), cache); err != nil {
		warning = "Configuration loaded, but the local cache could not be saved"
	}
	locs := locations(cache.Config)
	if !s.update(ctx, id, func(st *State) {
		st.Locations, st.Revision, st.FetchedAt = locs, cache.Config.Revision, cache.FetchedAt
		st.Stale, st.Warning, st.Phase = stale, warning, "probing"
		s.lastAppID = appID
	}) {
		return
	}
	// Serialize settings writes with scan transitions, so an old scan cannot win.
	s.mu.Lock()
	if s.state.ID == id && ctx.Err() == nil {
		_ = s.writeJSON(filepath.Join(s.dir, "settings.json"), map[string]uint32{"appId": appID})
	}
	s.mu.Unlock()
	jobs := make(chan Location)
	var wg sync.WaitGroup
	for worker := 0; worker < 6; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for loc := range jobs {
				if ctx.Err() != nil {
					return
				}
				if len(loc.Relays) > 0 {
					loc = s.probe(ctx, loc)
				}
				s.update(ctx, id, func(st *State) {
					for i := range st.Locations {
						if st.Locations[i].Code == loc.Code {
							st.Locations[i] = loc
							break
						}
					}
					st.Completed++
				})
			}
		}()
	}
send:
	for _, loc := range locs {
		select {
		case jobs <- loc:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	wg.Wait()
	s.update(ctx, id, func(st *State) { st.Running = false; st.Phase = "done" })
}

func (s *Service) cachePath(appID uint32) string {
	return filepath.Join(s.dir, fmt.Sprintf("sdr-%d.json", appID))
}

func (s *Service) writeJSON(path string, value interface{}) error {
	if s.dir == "" {
		return fmt.Errorf("settings directory unavailable")
	}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, ".picker-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
