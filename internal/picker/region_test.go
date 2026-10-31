package picker

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type regionTransport func(*http.Request) (*http.Response, error)

func (f regionTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRegionOptInAndCache(t *testing.T) {
	var calls atomic.Int32
	s := NewService(t.TempDir())
	s.client = &http.Client{Transport: regionTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.Scheme != "https" || r.URL.Host != "ipwho.is" || strings.Contains(r.URL.RawQuery, "ip,") {
			t.Error("unexpected provider request")
		}
		if _, ok := r.Context().Deadline(); !ok {
			t.Error("missing timeout")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"success":true,"country":"India","continent":"Asia","latitude":19.07,"longitude":72.88,"ip":"not-retained"}`))}, nil
	})}
	if calls.Load() != 0 {
		t.Fatal("lookup before opt-in")
	}
	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() {
			region, err := s.FindRegion()
			if err != nil || region.Country != "India" || region.Latitude != 19 || region.Longitude != 73 {
				t.Errorf("unexpected region: %+v, %v", region, err)
			}
		})
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("cache did not coalesce lookups: %d", calls.Load())
	}
}

func TestRegionFailures(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		network    bool
	}{
		{"provider failure", `{"success":false}`, 200, false},
		{"missing coordinates", `{"success":true,"country":"India"}`, 200, false},
		{"invalid coordinates", `{"success":true,"country":"India","latitude":91,"longitude":20}`, 200, false},
		{"invalid json", `<html>no</html>`, 200, false},
		{"unavailable", ``, 503, false},
		{"rate limit", ``, 429, false},
		{"network", ``, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			s := NewService(t.TempDir())
			s.client = &http.Client{Transport: regionTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if tc.network {
					return nil, errors.New("private network detail")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Retry-After": []string{"120"}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}
			_, err := s.FindRegion()
			if err == nil || strings.Contains(err.Error(), "private network detail") {
				t.Fatalf("unsafe or missing error: %v", err)
			}
			if _, err := s.FindRegion(); err == nil || calls != 1 {
				t.Fatal("failure did not throttle retries")
			}
			if tc.status == 429 && time.Until(s.regionRetry) < 119*time.Second {
				t.Fatal("ignored Retry-After")
			}
			if !s.regionExpires.IsZero() {
				t.Fatal("cached failed result")
			}
		})
	}
}
