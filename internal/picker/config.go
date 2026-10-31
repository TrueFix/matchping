package picker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"time"
)

const configEndpoint = "https://api.steampowered.com/ISteamApps/GetSDRConfig/v1/"

type Relay struct {
	IPv4      string `json:"ipv4"`
	PortRange []int  `json:"port_range"`
}

type POP struct {
	Description string    `json:"desc"`
	Geo         []float64 `json:"geo"`
	Relays      []Relay   `json:"relays"`
	Aliases     []string  `json:"aliases"`
}

type Config struct {
	Revision int64          `json:"revision"`
	POPs     map[string]POP `json:"pops"`
	Success  bool           `json:"success"`
}

type Location struct {
	Code           string   `json:"code"`
	Name           string   `json:"name"`
	Longitude      float64  `json:"longitude"`
	Latitude       float64  `json:"latitude"`
	HasCoordinates bool     `json:"hasCoordinates"`
	Relays         []Relay  `json:"relays"`
	Status         string   `json:"status"`
	Latency        *float64 `json:"latency"`
	Endpoint       string   `json:"endpoint,omitempty"`
	Detail         string   `json:"detail,omitempty"`
}

func fetchConfig(ctx context.Context, client *http.Client, endpoint string, appID uint32) (Config, error) {
	var cfg Config
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s?appid=%d", endpoint, appID), nil)
	if err != nil {
		return cfg, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return cfg, fmt.Errorf("fetch Steam configuration: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return cfg, fmt.Errorf("Steam returned HTTP %d", resp.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("invalid Steam response: %w", err)
	}
	if !cfg.Success || len(cfg.POPs) == 0 {
		return cfg, fmt.Errorf("App ID %d has no public SDR configuration", appID)
	}
	return cfg, nil
}

func locations(cfg Config) []Location {
	out := make([]Location, 0, len(cfg.POPs))
	for code, pop := range cfg.POPs {
		loc := Location{Code: code, Name: pop.Description, Status: "pending", Relays: []Relay{}}
		if len(pop.Geo) == 2 && pop.Geo[0] >= -180 && pop.Geo[0] <= 180 && pop.Geo[1] >= -90 && pop.Geo[1] <= 90 {
			loc.Longitude, loc.Latitude, loc.HasCoordinates = pop.Geo[0], pop.Geo[1], true
		}
		for _, relay := range pop.Relays {
			ip := net.ParseIP(relay.IPv4)
			// Do not let a remote configuration turn this into a local-network scanner.
			if ip == nil || ip.To4() == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			loc.Relays = append(loc.Relays, relay)
		}
		if len(loc.Relays) == 0 {
			loc.Status = "no-endpoint"
			loc.Detail = "No public relay endpoint"
		}
		out = append(out, loc)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

type cachedConfig struct {
	AppID     uint32    `json:"appId"`
	FetchedAt time.Time `json:"fetchedAt"`
	Config    Config    `json:"config"`
}
