package picker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

var replyTime = regexp.MustCompile(`(?i)time\s*([=<])\s*([0-9]+(?:[.,][0-9]+)?)\s*ms`)

func parseRTT(output string) (float64, bool) {
	matches := replyTime.FindAllStringSubmatch(output, -1)
	var samples []float64
	for _, match := range matches {
		n, err := strconv.ParseFloat(strings.ReplaceAll(match[2], ",", "."), 64)
		if err == nil {
			if match[1] == "<" {
				n /= 2
			}
			samples = append(samples, n)
		}
	}
	if len(samples) == 0 {
		return 0, false
	}
	sort.Float64s(samples)
	mid := len(samples) / 2
	if len(samples)%2 == 0 {
		return (samples[mid-1] + samples[mid]) / 2, true
	}
	return samples[mid], true
}

func probe(ctx context.Context, loc Location) Location {
	loc.Status = "timeout"
	loc.Detail = "No ICMP response; the relay may still be reachable in game"
	if _, err := exec.LookPath("ping"); err != nil {
		loc.Status, loc.Detail = "unsupported", "System ping is unavailable. Install your OS ping utility."
		return loc
	}
	for i, relay := range loc.Relays {
		if i >= 2 || ctx.Err() != nil {
			break
		}
		probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		args := []string{"-n", "-c", "3", "-W", "1", relay.IPv4}
		if runtime.GOOS == "windows" {
			args = []string{"-n", "3", "-w", "1000", relay.IPv4}
		}
		if runtime.GOOS == "darwin" {
			args = []string{"-n", "-c", "3", "-W", "1000", relay.IPv4}
		}
		cmd := exec.CommandContext(probeCtx, "ping", args...)
		cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
		output, err := cmd.CombinedOutput()
		cancel()
		if ctx.Err() != nil {
			loc.Status = "cancelled"
			loc.Detail = "Measurement cancelled"
			return loc
		}
		if ms, ok := parseRTT(string(output)); ok {
			loc.Status, loc.Latency, loc.Endpoint = "measured", &ms, relay.IPv4
			loc.Detail = "Median ICMP RTT to a responding relay; not in-game latency"
			return loc
		}
		if err == nil {
			loc.Status, loc.Detail = "unsupported", "System ping completed, but its output format is not supported (possibly a localized Windows installation)"
			return loc
		}
		var exit *exec.ExitError
		if err != nil && !errors.As(err, &exit) && !errors.Is(err, context.DeadlineExceeded) {
			loc.Status, loc.Detail = "unsupported", fmt.Sprintf("Unable to run system ping: %v", err)
			return loc
		}
		lower := strings.ToLower(string(output))
		if strings.Contains(lower, "permitted") || strings.Contains(lower, "permission") || strings.Contains(lower, "privilege") {
			loc.Status, loc.Detail = "unsupported", "System ping needs network permissions; no measurement available"
			return loc
		}
	}
	return loc
}
