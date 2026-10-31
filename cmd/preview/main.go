// Preview runs the same backend without native webview development libraries.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/TrueFix/matchping/frontend"
	"github.com/TrueFix/matchping/internal/picker"
)

func main() {
	port := flag.Int("port", 3415, "loopback preview port")
	flag.Parse()
	svc := picker.NewService("")
	defer svc.CancelScan()
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(frontend.Assets())))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		// Reject DNS rebinding and cross-origin requests, including local-network pages.
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || host != "127.0.0.1" {
			http.Error(w, "invalid host", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Scheme != "http" || u.Host != r.Host {
				http.Error(w, "invalid origin", 403)
				return
			}
		}
		if strings.HasPrefix(r.Header.Get("Sec-Fetch-Site"), "cross-") {
			http.Error(w, "cross-origin request", 403)
			return
		}
		var value interface{}
		switch {
		case r.URL.Path == "/api/state" && r.Method == "GET":
			value = svc.State()
		case r.URL.Path == "/api/info" && r.Method == "GET":
			value = svc.Info()
		case r.URL.Path == "/api/scan" && r.Method == "POST":
			var body struct {
				AppID uint32 `json:"appId"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body) != nil {
				http.Error(w, "invalid App ID", 400)
				return
			}
			id, err := svc.StartScan(body.AppID)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			value = id
		case r.URL.Path == "/api/cancel" && r.Method == "POST":
			svc.CancelScan()
			value = true
		case r.URL.Path == "/api/region" && r.Method == "POST":
			region, err := svc.FindRegion()
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			value = region
		case r.URL.Path == "/api/update" && r.Method == "POST":
			u, err := svc.CheckUpdate()
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			value = u
		default:
			http.Error(w, "not found", 404)
			return
		}
		_ = json.NewEncoder(w).Encode(value)
	})
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	log.Printf("MatchPing preview: http://%s", addr)
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(server.ListenAndServe())
}
