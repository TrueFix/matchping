package main

import (
	"bytes"
	"image/png"
	"testing"
)

func TestOriginalIcon(t *testing.T) {
	if sample(0, 0).A != 0 {
		t.Fatal("icon corners should be transparent")
	}
	if c := sample(272, 400); c.R != 237 || c.G != 189 {
		t.Fatal("missing gold M stroke")
	}
	if c := sample(752, 704); c.R != 142 || c.G != 198 {
		t.Fatal("missing mint relay node")
	}
	img, err := png.Decode(bytes.NewReader(render(32)))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 32 || img.Bounds().Dy() != 32 {
		t.Fatal("incorrect icon dimensions")
	}
	if !bytes.Equal(render(16), render(16)) {
		t.Fatal("icon generator must be deterministic")
	}
}
