# EduMove

웹캠 기반 운동 동작 인식 학습 데스크톱 앱 (Windows).
학생이 웹캠 앞에서 화면의 운동 동작을 따라 하면, 실시간 포즈 추정으로 기준 동작과 비교해
일치 시 축하 연출(컨페티·효과음·점수)을 제공하는 교육용 앱.

## 아키텍처

- **셸**: Wails v2 (Go 백엔드 + WebView2 프론트)
- **프론트엔드**: React 18 + TypeScript + Vite
- **포즈 추정**: MediaPipe `PoseLandmarker` (WASM, WebView2 내부 실행 — Python/외부 프로세스 없음)
- **동작 비교**: L2 정규화 → 관절 각도 검증 → S-WFDTW 시퀀스 매칭
- **알림**: Sonner 인앱 토스트
- **영속화**: SQLite (Go)
- **데이터**: [AI Hub](https://www.aihub.or.kr/) 피트니스/스포츠 동작 데이터에서 기준 벡터 추출 (개발 단계 한정)

핵심 원칙: 웹캠 프레임은 WebView 밖으로 나가지 않는다. 모든 비전 추론은 프론트엔드 WASM에서
처리하고, Go는 학습 기록 영속화만 담당한다.

## 문서

- [`docs/01-plan/PLAN.md`](docs/01-plan/PLAN.md) — 계획 / 타당성 검토
- [`docs/02-design/DESIGN.md`](docs/02-design/DESIGN.md) — 설계 (현행 아키텍처 단일 출처)

## 현황

- ✅ **M0** — Wails 빌드 체인 검증 완료. *(M0의 Python 사이드카 방식은 WASM 전환으로 폐기됨 —
  `app/sidecar*`는 히스토리 보존용이며 M1 시작 시 제거 예정.)*
- ⏭️ **다음** — M-Spike: Wails v2 WebView2에서 `getUserMedia` 기동 (가상 호스트 매핑 PoC).

## 개발

```bash
cd app
wails dev      # 개발 서버
wails build    # 프로덕션 빌드 → app/build/bin/
```

요구사항: Go 1.22+, Wails v2, Node 18+.
