# 글로벌 마켓 대시보드

실시간 세계 주요 지수 · 환율 · 원자재와 필승코리아 펀드 편입 종목을 보여주는 대시보드입니다.

- **지수 / 환율 / 원자재** — Yahoo Finance
- **펀드 편입 종목 주가** — 한국투자증권(KIS) OpenAPI, 미설정 시 Yahoo Finance로 자동 대체

프런트엔드는 외부 CDN 의존성이 없고(자체 CSS + 인라인 SVG), 백엔드는 Cloudflare Pages Functions 하나(`functions/api/market.js`)로 되어 있습니다. API 키는 서버 환경변수에만 두며 브라우저로 내려가지 않습니다.

## 실행 방법 1 — 윈도우 바탕화면 앱

PC에서 바로 띄웁니다. Cloudflare 배포 없이 동작하며 **Node.js만 있으면 됩니다**.

```
tools\install-desktop-shortcut.bat     ← 한 번만 실행
```

바탕화면에 "글로벌 마켓 대시보드" 아이콘이 생깁니다. 더블클릭하면 로컬 서버가 뜨고 브라우저가 앱 모드(주소창 없는 창)로 열리며, 창을 닫으면 서버도 자동 종료됩니다.

전용 브라우저 프로필(`%LOCALAPPDATA%\MarketDashboard\browser-profile`)을 쓰므로 평소 쓰는 브라우저 창에는 영향을 주지 않습니다.

KIS 시세를 로컬에서도 쓰려면 실행 전에 환경변수를 지정하세요. 미지정 시 Yahoo Finance로 대체됩니다.

```
set KIS_APP_KEY=...
set KIS_APP_SECRET=...
```

서버만 따로 띄우려면: `node tools\local-server.mjs` (기본 포트 8899, `PORT` 환경변수로 변경 가능)

## 실행 방법 2 — Cloudflare Pages 배포

저장소를 Cloudflare Pages에 연결하면 됩니다. 빌드 과정이 없는 정적 사이트 + Functions 구성입니다.

Settings → Environment Variables 에 아래 두 개를 **Secret** 으로 추가하세요.

| 이름 | 설명 |
|---|---|
| `KIS_APP_KEY` | 한국투자증권 앱 키 |
| `KIS_APP_SECRET` | 한국투자증권 앱 시크릿 |

`functions/api/market.js` 는 **실전투자** 엔드포인트(`openapi.koreainvestment.com:9443`)를 사용합니다. 모의투자 키를 넣으면 토큰 발급부터 실패합니다.

## 알아둘 점

- **펀드 비중은 실시간이 아닙니다.** 운용사(NH아문디자산운용) 공시값이며 기준일이 화면에 함께 표시됩니다. 시세만 실시간으로 갱신됩니다.
- **전일 종가는 일봉에서 직접 확정합니다.** Yahoo가 meta로 주는 `previousClose`가 일부 티커(코스닥, 상하이종합)에서 한 거래일 낡은 값을 반환해 등락률 부호가 뒤집히는 문제가 있었습니다. 자세한 내용은 `functions/api/market.js` 의 `extractQuote` 주석을 참고하세요.
- **`.bat` 파일은 ASCII 전용입니다.** cmd.exe가 콘솔 코드페이지로 배치파일을 파싱해 한글이 깨지므로, 로직과 메시지는 모두 `.ps1`(UTF-8 BOM)에 두었습니다.

## 구조

```
index.html                  화면 구조
assets/style.css            디자인 시스템 (다크/라이트 자동)
assets/dashboard.js         렌더링 · 세계시계 · 지역탭 · 정렬
functions/api/market.js     Cloudflare Pages Function — 시세 수집
tools/local-server.mjs      로컬 실행용 서버 (정적 + /api/market)
tools/run-dashboard.*       바탕화면 실행 스크립트
tools/install-*             바탕화면 바로가기 생성
```
