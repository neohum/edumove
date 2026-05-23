import {useEffect, useRef, useState} from 'react';
import './App.css';

type CamState = 'idle' | 'requesting' | 'live' | 'error';

// M-Spike: verify getUserMedia works inside Wails v2's WebView2.
// Wails v2 serves assets from http://wails.localhost/, which WebView2 (Chromium)
// treats as a secure context (*.localhost is "potentially trustworthy"). So we
// first test the simplest path — call getUserMedia with NO virtual-host mapping.
// If the diagnostics show secureContext=true and the stream goes live, the
// mapping infrastructure feared in DESIGN.md §3.1 is unnecessary.
function App() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [state, setState] = useState<CamState>('idle');
    const [error, setError] = useState('');
    const [resolution, setResolution] = useState('');

    // Diagnostics that explain *why* getUserMedia would (not) work.
    const diag = {
        origin: window.location.origin,
        secureContext: window.isSecureContext,
        hasMediaDevices: !!navigator.mediaDevices,
        hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
    };

    async function startCamera() {
        setState('requesting');
        setError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {width: {ideal: 1280}, height: {ideal: 720}},
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            const track = stream.getVideoTracks()[0];
            const s = track.getSettings();
            setResolution(`${s.width}×${s.height} @ ${track.label}`);
            setState('live');
        } catch (e: any) {
            setError(`${e.name}: ${e.message}`);
            setState('error');
        }
    }

    function stopCamera() {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setState('idle');
        setResolution('');
    }

    useEffect(() => () => stopCamera(), []); // cleanup on unmount

    return (
        <div id="App">
            <h1>EduMove — M-Spike</h1>
            <p className="subtitle">Wails v2 WebView2 · getUserMedia 웹캠 기동 검증</p>

            <table className="diag">
                <tbody>
                    <tr><td>origin</td><td>{diag.origin}</td></tr>
                    <tr><td>isSecureContext</td><td className={diag.secureContext ? 'yes' : 'no'}>{String(diag.secureContext)}</td></tr>
                    <tr><td>mediaDevices</td><td className={diag.hasMediaDevices ? 'yes' : 'no'}>{String(diag.hasMediaDevices)}</td></tr>
                    <tr><td>getUserMedia</td><td className={diag.hasGetUserMedia ? 'yes' : 'no'}>{String(diag.hasGetUserMedia)}</td></tr>
                </tbody>
            </table>

            <div className="controls">
                {state !== 'live' ? (
                    <button className="btn" onClick={startCamera} disabled={state === 'requesting' || !diag.hasGetUserMedia}>
                        {state === 'requesting' ? '카메라 요청 중…' : '카메라 시작'}
                    </button>
                ) : (
                    <button className="btn" onClick={stopCamera}>카메라 정지</button>
                )}
            </div>

            <div className="stage">
                <video ref={videoRef} className="cam" playsInline muted style={{transform: 'scaleX(-1)'}} />
            </div>

            {state === 'live' && <p className="ok">✅ 스트림 라이브 · {resolution}</p>}
            {state === 'error' && <p className="fail">❌ {error}</p>}
        </div>
    );
}

export default App
