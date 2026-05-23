import {useState} from 'react';
import './App.css';
import {ProbeSidecar} from "../wailsjs/go/main/App";
import {main} from "../wailsjs/go/models";

function App() {
    const [result, setResult] = useState<main.ProbeResult | null>(null);
    const [busy, setBusy] = useState(false);

    async function probe() {
        setBusy(true);
        try {
            setResult(await ProbeSidecar());
        } catch (e: any) {
            setResult({ok: false, source: "", error: String(e)} as main.ProbeResult);
        } finally {
            setBusy(false);
        }
    }

    const lm = result?.landmark;

    return (
        <div id="App">
            <h1>EduMove — M0 기술 스파이크</h1>
            <p className="subtitle">Go ↔ Python 사이드카 JSON 왕복 검증</p>

            <button className="btn" onClick={probe} disabled={busy}>
                {busy ? "사이드카 호출 중…" : "랜드마크 1개 받아오기"}
            </button>

            {result && (
                <div className={"result " + (result.ok ? "ok" : "fail")}>
                    {result.ok ? (
                        <>
                            <div className="badge">✅ 왕복 성공 · source: <b>{result.source}</b></div>
                            {lm && (
                                <table className="landmark">
                                    <tbody>
                                        <tr><td>name</td><td>{lm.name}</td></tr>
                                        <tr><td>x</td><td>{lm.x}</td></tr>
                                        <tr><td>y</td><td>{lm.y}</td></tr>
                                        <tr><td>z</td><td>{lm.z}</td></tr>
                                        <tr><td>visibility</td><td>{lm.visibility}</td></tr>
                                    </tbody>
                                </table>
                            )}
                        </>
                    ) : (
                        <div className="badge">❌ 실패: {result.error}</div>
                    )}
                </div>
            )}
        </div>
    );
}

export default App
