package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
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

func TestVerificationIgnoresCompressionButDetectsChangedArtwork(t *testing.T) {
	expected := render(32)
	decoded, err := png.Decode(bytes.NewReader(expected))
	if err != nil {
		t.Fatal(err)
	}
	var uncompressed bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&uncompressed, decoded); err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(expected, uncompressed.Bytes()) {
		t.Fatal("test requires different PNG encodings")
	}
	if err := verifyPNG(uncompressed.Bytes(), expected); err != nil {
		t.Fatal(err)
	}
	changed := image.NewNRGBA(decoded.Bounds())
	draw.Draw(changed, changed.Bounds(), decoded, image.Point{}, draw.Src)
	changed.SetNRGBA(16, 16, color.NRGBA{255, 0, 0, 255})
	var output bytes.Buffer
	if err := png.Encode(&output, changed); err != nil {
		t.Fatal(err)
	}
	if err := verifyPNG(output.Bytes(), expected); err == nil {
		t.Fatal("changed artwork passed verification")
	}
}
