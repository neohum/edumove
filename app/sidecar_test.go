package main

import "testing"

// TestProbeSidecarRoundTrip is the M0 done-criterion check: spawn the real
// Python sidecar, read one landmark over JSON Lines, and confirm the round trip.
// Requires `python` on PATH and sidecar/pose_sidecar.py reachable from CWD.
func TestProbeSidecarRoundTrip(t *testing.T) {
	app := NewApp()
	res := app.ProbeSidecar()

	if !res.OK {
		t.Fatalf("round trip failed: %s", res.Error)
	}
	if res.Source != "mediapipe" && res.Source != "stub" {
		t.Fatalf("unexpected source %q", res.Source)
	}
	if res.Landmark == nil {
		t.Fatal("ok but no landmark returned")
	}
	if res.Landmark.Name == "" {
		t.Fatal("landmark has empty name")
	}
	t.Logf("round trip ok: source=%s landmark=%+v", res.Source, *res.Landmark)
}
