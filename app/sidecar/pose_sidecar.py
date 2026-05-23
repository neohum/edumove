"""EduMove pose sidecar (M0 spike).

Emits one JSON Lines message per webcam frame to stdout:

    {"type": "landmarks", "frame": 0, "source": "mediapipe", "landmarks": [{...}]}

For the M0 milestone we only need to prove the Go <-> Python JSON round trip,
so a single landmark (the nose, index 0) is enough. If MediaPipe / OpenCV / a
webcam are not available, we fall back to a deterministic stub landmark so the
IPC plumbing can still be verified end-to-end (see PLAN.md M0 done-criterion).

Protocol: JSON Lines (one compact JSON object per line) on stdout. Diagnostics
go to stderr only, never stdout, so Go can parse stdout line-by-line.
"""

import json
import sys
import time


def log(msg: str) -> None:
    """Diagnostics to stderr — stdout is reserved for the JSON protocol."""
    print(f"[sidecar] {msg}", file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    """Write one compact JSON line to stdout and flush immediately."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def run_stub(frames: int) -> None:
    """Emit synthetic landmarks when MediaPipe/webcam are unavailable."""
    log("running in STUB mode (no mediapipe/webcam)")
    for frame in range(frames):
        emit(
            {
                "type": "landmarks",
                "frame": frame,
                "source": "stub",
                "landmarks": [
                    {"name": "nose", "x": 0.5, "y": 0.42, "z": -0.1, "visibility": 0.99}
                ],
            }
        )
        time.sleep(0.05)


def run_mediapipe(frames: int) -> bool:
    """Attempt real pose estimation. Returns False if deps/webcam missing."""
    try:
        import cv2  # noqa: WPS433 (import-in-function is intentional for fallback)
        import mediapipe as mp
    except Exception as exc:  # ImportError, or ABI mismatches (e.g. NumPy 1.x/2.x)
        log(f"mediapipe/opencv unavailable: {exc!r}")
        return False

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        log("no webcam available (VideoCapture(0) failed to open)")
        cap.release()
        return False

    log("running in MEDIAPIPE mode")
    pose = mp.solutions.pose.Pose(model_complexity=0)
    try:
        emitted = 0
        attempts = 0
        while emitted < frames and attempts < frames * 10:
            attempts += 1
            ok, frame_bgr = cap.read()
            if not ok:
                continue
            result = pose.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
            if not result.pose_landmarks:
                continue
            nose = result.pose_landmarks.landmark[0]  # NOSE
            emit(
                {
                    "type": "landmarks",
                    "frame": emitted,
                    "source": "mediapipe",
                    "landmarks": [
                        {
                            "name": "nose",
                            "x": round(nose.x, 4),
                            "y": round(nose.y, 4),
                            "z": round(nose.z, 4),
                            "visibility": round(nose.visibility, 4),
                        }
                    ],
                }
            )
            emitted += 1
        if emitted == 0:
            log("webcam opened but no pose detected; falling back to stub")
            return False
    finally:
        pose.close()
        cap.release()
    return True


def main() -> None:
    # First CLI arg = number of frames to emit (default 1 for the M0 round trip).
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    if not run_mediapipe(frames):
        run_stub(frames)
    emit({"type": "done", "frame": frames})


if __name__ == "__main__":
    main()
