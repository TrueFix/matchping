// Generate MatchPing's original icon without external image tooling.
// Run from the repository root: go run ./scripts/icon
package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
)

func distance(x, y, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	t := math.Max(0, math.Min(1, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
	return math.Hypot(x-ax-t*dx, y-ay-t*dy)
}

func sample(x, y float64) color.NRGBA {
	cx := math.Max(256, math.Min(768, x))
	cy := math.Max(256, math.Min(768, y))
	if math.Hypot(x-cx, y-cy) > 224 {
		return color.NRGBA{}
	}
	c := color.NRGBA{24, 35, 41, 255}
	points := [][2]float64{{272, 704}, {272, 320}, {512, 552}, {752, 320}, {752, 704}}
	for i := 1; i < len(points); i++ {
		if distance(x, y, points[i-1][0], points[i-1][1], points[i][0], points[i][1]) <= 34 {
			c = color.NRGBA{237, 189, 103, 255}
		}
	}
	if math.Hypot(x-752, y-704) <= 44 {
		c = color.NRGBA{142, 198, 170, 255}
	}
	return c
}

func render(size int) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	const supersample = 4
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var r, g, b, a uint32
			for sy := 0; sy < supersample; sy++ {
				for sx := 0; sx < supersample; sx++ {
					c := sample((float64(x)+(float64(sx)+.5)/supersample)*1024/float64(size), (float64(y)+(float64(sy)+.5)/supersample)*1024/float64(size))
					r += uint32(c.R) * uint32(c.A)
					g += uint32(c.G) * uint32(c.A)
					b += uint32(c.B) * uint32(c.A)
					a += uint32(c.A)
				}
			}
			if a > 0 {
				img.SetNRGBA(x, y, color.NRGBA{uint8(r / a), uint8(g / a), uint8(b / a), uint8(a / (supersample * supersample))})
			}
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		log.Fatal(err)
	}
	return out.Bytes()
}

func write(path string, data []byte) {
	if err := os.WriteFile(path, data, 0644); err != nil {
		log.Fatal(err)
	}
}

func main() {
	write("build/appicon.png", render(1024))
	write("build/linux/matchping.png", render(256))
	sizes := []int{16, 24, 32, 48, 64, 128, 256}
	var ico bytes.Buffer
	for _, n := range []uint16{0, 1, uint16(len(sizes))} {
		_ = binary.Write(&ico, binary.LittleEndian, n)
	}
	images := make([][]byte, len(sizes))
	offset := 6 + 16*len(sizes)
	for i, size := range sizes {
		images[i] = render(size)
		ico.Write([]byte{byte(size % 256), byte(size % 256), 0, 0})
		_ = binary.Write(&ico, binary.LittleEndian, uint16(1))
		_ = binary.Write(&ico, binary.LittleEndian, uint16(32))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(len(images[i])))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(offset))
		offset += len(images[i])
	}
	for _, img := range images {
		ico.Write(img)
	}
	write("build/windows/icon.ico", ico.Bytes())
}
