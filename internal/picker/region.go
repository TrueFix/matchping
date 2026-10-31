package picker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"
)

// Region intentionally excludes the public IP, city, ISP and other identifying fields.
type Region struct {
	Country   string  `json:"country"`
	Continent string  `json:"continent"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// FindRegion runs on startup when automatic region focus is enabled, or on request.
// Cache is memory-only; location is never restored from disk on the next launch.
func (s *Service) FindRegion() (Region, error) {
	s.regionMu.Lock()
	defer s.regionMu.Unlock()
	now := time.Now()
	if now.Before(s.regionExpires) {
		return s.region, nil
	}
	if now.Before(s.regionRetry) {
		return Region{}, fmt.Errorf("Location lookup is cooling down. Please try again later")
	}
	s.regionRetry = now.Add(30 * time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://ipwho.is/?fields=success,message,continent,country,latitude,longitude", nil)
	if err != nil {
		return Region{}, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return Region{}, fmt.Errorf("Could not reach ipwho.is. Check your connection and try again")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		wait := time.Minute
		if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds > 0 {
			wait = time.Duration(min(seconds, 86400)) * time.Second
		} else if until, err := http.ParseTime(resp.Header.Get("Retry-After")); err == nil && until.After(now) {
			wait = min(until.Sub(now), 24*time.Hour)
		}
		s.regionRetry = now.Add(wait)
		return Region{}, fmt.Errorf("ipwho.is is rate-limiting location lookups. Please try again later")
	}
	if resp.StatusCode != http.StatusOK {
		return Region{}, fmt.Errorf("ipwho.is is unavailable (HTTP %d). Please try again later", resp.StatusCode)
	}
	var result struct {
		Success   bool     `json:"success"`
		Country   string   `json:"country"`
		Continent string   `json:"continent"`
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 16*1024)).Decode(&result) != nil || !result.Success ||
		result.Latitude == nil || result.Longitude == nil || math.Abs(*result.Latitude) > 90 || math.Abs(*result.Longitude) > 180 ||
		result.Country == "" || len(result.Country) > 100 || len(result.Continent) > 100 {
		return Region{}, fmt.Errorf("ipwho.is could not determine an approximate region")
	}
	// Broad map focus needs no precise coordinates.
	s.region = Region{Country: result.Country, Continent: result.Continent, Latitude: math.Round(*result.Latitude), Longitude: math.Round(*result.Longitude)}
	s.regionExpires = now.Add(30 * time.Minute)
	return s.region, nil
}
