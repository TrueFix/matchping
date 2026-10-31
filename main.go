//go:build desktop || bindings

package main

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"os"

	"github.com/TrueFix/matchping/frontend"
	"github.com/TrueFix/matchping/internal/picker"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	*picker.Service
	ctx context.Context
}

//go:embed build/appicon.png
var appIcon []byte

func (a *App) OpenRelease() error {
	url, err := a.ReleaseURL()
	if err != nil {
		return err
	}
	wailsruntime.BrowserOpenURL(a.ctx, url)
	return nil
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println(picker.Version)
		return
	}
	app := &App{Service: picker.NewService("")}
	err := wails.Run(&options.App{
		Title: "MatchPing", Width: 1280, Height: 820, MinWidth: 760, MinHeight: 600,
		Linux:            &linux.Options{Icon: appIcon, ProgramName: "matchping", WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand},
		BackgroundColour: &options.RGBA{R: 15, G: 20, B: 23, A: 255},
		AssetServer:      &assetserver.Options{Assets: frontend.Assets()},
		OnStartup:        func(ctx context.Context) { app.ctx = ctx },
		OnShutdown:       func(context.Context) { app.CancelScan() },
		Bind:             []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
