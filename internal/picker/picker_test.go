package picker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseRTT(t *testing.T) {
	for _, tc := range []struct {
		text string
		want float64
		ok   bool
	}{
		{"64 bytes: time=12.4 ms\n64 bytes: time=10.2 ms\n64 bytes: time=11.6 ms", 11.6, true},
		{"Reply from 1.1.1.1: bytes=32 time<1ms TTL=50", .5, true},
		{"time=1,5 ms\ntime=2,5 ms", 2, true},
		{"100% packet loss", 0, false},
	} {
		got, ok := parseRTT(tc.text)
		if ok != tc.ok || got != tc.want {
			t.Errorf("parseRTT(%q) = %v, %v", tc.text, got, ok)
		}
	}
}

func testConfig() Config {
	return Config{Success: true, Revision: 42, POPs: map[string]POP{
		"fra":  {Description: "Frankfurt (Germany)", Geo: []float64{8.68, 50.12}, Relays: []Relay{{IPv4: "155.133.226.68", PortRange: []int{27015, 27060}}}},
		"none": {Description: "No relay", Geo: []float64{1, 2}},
	}}
}

func TestLocations(t *testing.T) {
	cfg := testConfig()
	cfg.POPs["private"] = POP{Geo: []float64{500, 100}, Relays: []Relay{{IPv4: "127.0.0.1"}, {IPv4: "10.0.0.1"}, {IPv4: "169.254.1.1"}, {IPv4: "224.0.0.1"}}}
	locs := locations(cfg)
	for _, loc := range locs {
		if loc.Code == "fra" && (!loc.HasCoordinates || loc.Longitude != 8.68 || len(loc.Relays) != 1) {
			t.Errorf("bad Frankfurt: %+v", loc)
		}
		if loc.Code == "private" && (loc.HasCoordinates || len(loc.Relays) != 0 || loc.Status != "no-endpoint") {
			t.Errorf("unsafe relay: %+v", loc)
		}
	}
}

func TestFetchErrors(t *testing.T) {
	for _, body := range []string{`{"success":false}`, `{"success":true,"pops":{}}`, `not json`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
		_, err := fetchConfig(context.Background(), server.Client(), server.URL, 730)
		server.Close()
		if err == nil {
			t.Fatalf("expected error for %s", body)
		}
	}
}

func waitDone(t *testing.T, s *Service) State {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		state := s.State()
		if !state.Running {
			return state
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("scan did not complete")
	return State{}
}

func TestScanAndCacheFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = json.NewEncoder(w).Encode(testConfig()) }))
	s := NewService(t.TempDir())
	s.endpoint, s.client = server.URL, server.Client()
	s.probe = func(ctx context.Context, loc Location) Location {
		n := 25.0
		loc.Latency = &n
		loc.Status = "measured"
		return loc
	}
	if _, err := s.StartScan(730); err != nil {
		t.Fatal(err)
	}
	state := waitDone(t, s)
	if state.Error != "" || state.Completed != 2 || state.Stale || state.Revision != 42 {
		t.Fatalf("bad state: %+v", state)
	}
	server.Close()
	_, _ = s.StartScan(730)
	state = waitDone(t, s)
	if !state.Stale || state.Warning == "" || state.Error != "" {
		t.Fatalf("expected cache: %+v", state)
	}
	_, _ = s.StartScan(440)
	state = waitDone(t, s)
	if state.Error == "" || state.Stale {
		t.Fatal("cache leaked across App IDs")
	}
}

func TestCancellationAndSwitching(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = json.NewEncoder(w).Encode(testConfig()) }))
	defer server.Close()
	s := NewService(t.TempDir())
	s.endpoint = server.URL
	entered := make(chan struct{}, 10)
	s.probe = func(ctx context.Context, loc Location) Location { entered <- struct{}{}; <-ctx.Done(); return loc }
	first, _ := s.StartScan(730)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("probe not started")
	}
	second, _ := s.StartScan(440)
	if second <= first {
		t.Fatal("scan IDs must increase")
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("second probe not started")
	}
	s.CancelScan()
	state := s.State()
	if state.ID != second || state.AppID != 440 || state.Running {
		t.Fatalf("wrong session: %+v", state)
	}
	for _, loc := range state.Locations {
		if loc.Status == "pending" {
			t.Fatal("pending location after cancellation")
		}
	}
}

func TestSettings(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"appId":570}`), 0600); err != nil {
		t.Fatal(err)
	}
	if NewService(dir).Info().AppID != 570 {
		t.Fatal("last App ID not restored")
	}
}

func TestUpdateValidation(t *testing.T) {
	for _, tc := range []struct {
		version, url     string
		available, valid bool
	}{
		{"0.2.0", "https://github.com/owner/picker/releases/tag/v0.2.0", true, true},
		{"0.1.0", "https://github.com/owner/picker/releases/tag/v0.1.0", false, true},
		{"0.0.9", "https://github.com/owner/picker/releases/tag/v0.0.9", false, true},
		{"0.2.0", "https://evil.example/download", false, false},
		{"0.2.0-beta.1", "https://github.com/owner/picker/releases/tag/v0.2.0-beta.1", false, false},
		{"not-version", "", false, false},
	} {
		got, err := validateUpdate(Update{Version: tc.version, ReleaseURL: tc.url}, "owner/picker", "0.1.0")
		if (err == nil) != tc.valid || got.Available != tc.available {
			t.Errorf("update %s: %+v %v", tc.version, got, err)
		}
	}
}
