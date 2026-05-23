package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// Landmark is one pose keypoint as emitted by the Python sidecar.
type Landmark struct {
	Name       string  `json:"name"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Z          float64 `json:"z"`
	Visibility float64 `json:"visibility"`
}

// SidecarMessage is one JSON Lines record from the sidecar's stdout.
type SidecarMessage struct {
	Type      string     `json:"type"` // "landmarks" | "done"
	Frame     int        `json:"frame"`
	Source    string     `json:"source"` // "mediapipe" | "stub"
	Landmarks []Landmark `json:"landmarks"`
}

// ProbeResult is returned to the frontend: the outcome of one round trip.
type ProbeResult struct {
	OK       bool      `json:"ok"`
	Source   string    `json:"source"`             // mediapipe | stub
	Landmark *Landmark `json:"landmark,omitempty"` // first landmark of first frame
	Error    string    `json:"error,omitempty"`
}

// M0 spike: we run the sidecar script directly via the `python` on PATH.
// The production design (embed PyInstaller exe via embed.FS, extract, spawn)
// is an M5 packaging concern — see PLAN.md §2.2 and §7. Keeping it simple here
// is deliberate: M0 only proves the Go<->Python JSON round trip.
const (
	sidecarScript = "sidecar/pose_sidecar.py"
	sidecarTimout = 30 * time.Second
)

// ProbeSidecar spawns the Python sidecar, reads the first landmark message it
// emits on stdout, and returns it. This is the M0 round-trip verification the
// frontend triggers with a button click.
func (a *App) ProbeSidecar() ProbeResult {
	ctx, cancel := context.WithTimeout(context.Background(), sidecarTimout)
	defer cancel()

	// Resolved relative to CWD, which is the project root under `wails dev`
	// (the M0 verification vehicle). Built-binary path resolution is M5's job.
	script := filepath.FromSlash(sidecarScript)
	if _, err := os.Stat(script); err != nil {
		return ProbeResult{Error: fmt.Sprintf("sidecar script not found at %q (cwd-relative): %v", script, err)}
	}

	// "1" => emit a single frame, then the sidecar exits.
	cmd := exec.CommandContext(ctx, "python", script, "1")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return ProbeResult{Error: fmt.Sprintf("stdout pipe: %v", err)}
	}
	// Drain stderr in the background so the sidecar can't block on a full pipe;
	// its diagnostics are not part of the protocol.
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return ProbeResult{Error: fmt.Sprintf("stderr pipe: %v", err)}
	}

	if err := cmd.Start(); err != nil {
		return ProbeResult{Error: fmt.Sprintf("start sidecar: %v", err)}
	}
	go drain(stderr)

	result := readFirstLandmark(stdout)

	if err := cmd.Wait(); err != nil && result.OK {
		// Sidecar produced a landmark but exited non-zero — surface it, the
		// landmark is still valid for the round-trip check.
		result.Error = fmt.Sprintf("sidecar exit: %v", err)
	}
	if ctx.Err() == context.DeadlineExceeded {
		return ProbeResult{Error: "sidecar timed out"}
	}
	return result
}

// readFirstLandmark scans stdout JSON Lines until it finds a "landmarks"
// message with at least one landmark, or the stream ends.
func readFirstLandmark(stdout io.Reader) ProbeResult {
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var msg SidecarMessage
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			// Skip non-JSON noise rather than fail the whole probe.
			continue
		}
		if msg.Type == "landmarks" && len(msg.Landmarks) > 0 {
			lm := msg.Landmarks[0]
			return ProbeResult{OK: true, Source: msg.Source, Landmark: &lm}
		}
	}
	if err := scanner.Err(); err != nil {
		return ProbeResult{Error: fmt.Sprintf("read stdout: %v", err)}
	}
	return ProbeResult{Error: "sidecar emitted no landmarks"}
}

func drain(r io.Reader) {
	buf := make([]byte, 4096)
	for {
		if _, err := r.Read(buf); err != nil {
			return
		}
	}
}
