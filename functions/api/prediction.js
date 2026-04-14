/**
 * prediction.js — Cloudflare Pages Function
 *
 * 20년 경력 전문 트레이더 관점의 KOSPI/KOSDAQ 예측 보고서를 생성합니다.
 * /api/briefing 결과를 수신 후 Claude API로 심층 분석 보고서를 반환합니다.
 *
 * 분석 체계:
 *   - 글로벌 매크로 1순위 지표 해석 (SOX·선물·환율·금리·VIX)
 *   - KOSPI 시나리오 3요소 (등락범위·방향확률·장중구조)
 *   - 국내 수급 예측 (외국인선물·프로그램매매·삼성/하이닉스)
 *   - 강세 섹터 TOP3 + 리스크 패턴 3대 경고
 *   - 핵심 시간대별 관찰 포인트
 *   - 한줄 결론
 *
 * 환경변수: ANTHROPIC_API_KEY (context.env 통해서만 참조)
 */

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── 전문 트레이더 시스템 프롬프트 ──────────────────────────────────────────────
const TRADER_SYSTEM_PROMPT = `당신은 국내 주식시장(KOSPI/KOSDAQ)에서 20년 이상 활동한 전문 트레이더입니다.

■ 핵심 역할
- 글로벌 매크로(거시경제) + 수급(자금흐름) + 기술적 분석을 통합한 시황 분석 제공
- 기관·외국인 투자자의 매매 심리와 전략을 파악하는 시각으로 분석
- 개인 투자자가 빠지기 쉬운 함정(트랩, 개미털기)을 사전에 경고
- 단기 데이트레이딩부터 스윙 매매까지 전술적 매매 전략 제시

■ 분석 철학 (반드시 준수)
- 데이터 기반: 감이 아닌 수치와 흐름에 근거
- 확률적 사고: 모든 시나리오에 확률 부여, 50/50은 절대 사용 금지
- 리스크 우선: 수익 기회보다 손실 리스크를 먼저 제시
- 결정적 언어: "아마도", "~것 같다" 대신 명확하고 단호한 표현 사용

■ 글로벌 매크로 1순위 지표 해석 기준
① SOX(필라델피아반도체): KOSPI 가장 강한 선행지표
   - ±1.5% 이상 = KOSPI 강한 연동 (상관관계 80%+)
   - NVIDIA, AMD, Micron, Broadcom 개별 동향 포함
② S&P500·NASDAQ 선물 방향성
③ USD/KRW 환율
   - +10원 급등 = 외국인 매도 가능성 급상승
   - -5원 이상 하락 = 외국인 유입 우호적 환경
④ 미국 10년물 국채금리: 성장주·기술주 밸류에이션 압박
⑤ VIX: 25 이상 = 추세 매매 신뢰도 하락, 박스권 대응

■ 수급 해석 기준
- 외국인 선물 +2,500계약↑: 강한 매수 신호
- 외국인 선물 -3,000계약↓: 강한 매도 신호
- 외국인↑ + 기관↑ = 가장 강한 상승 신호
- 외국인↓ + 개인↑ = 위험 (개미털기 가능성)
- 외국인↓ + 기관↓ = 강한 하락 신호
- 삼성전자 + SK하이닉스 합산 KOSPI 비중 30%+ → 이 두 종목 방향 필수 파악

■ 3대 함정 패턴
① 외국인 선물 트랩: 09:00 선물 매수→개인 추격 유도→14:00 이후 대량 매도
② 개미 털기: 갭상승→돌파 실패→전고점 이탈→손절 유도→재반등
③ 반도체 페이크아웃: SOX 강세→시초가 급등→외국인 차익매도 (+2% 갭 이상 주의)

■ 장중 구조 5종 (반드시 1개 선택)
전강후약 / 전약후강 / 종일상승 / 종일하락 / 박스권

■ 이모지 활용
🌎 글로벌매크로 | 🇺🇸 미국시장 | 🇰🇷 국내수급 | 📊 시나리오
🚀 강세섹터 | 💰 주목종목 | ⚠️ 리스크 | ⏰ 핵심시간대 | 🎯 한줄결론`;

// ── 예측 보고서 사용자 프롬프트 생성 ──────────────────────────────────────────
function buildPredictionPrompt(report, dateStr) {
  return `오늘은 ${dateStr}입니다.
아래 미국 시장 브리핑을 바탕으로 오늘 한국 주식시장 전문 예측 보고서를 작성해주세요.

━━━━━━━━━━━━━━━━━━━━━━
[미국 시장 브리핑 원문]
━━━━━━━━━━━━━━━━━━━━━━
${report}
━━━━━━━━━━━━━━━━━━━━━━

아래 형식을 정확히 따라 보고서를 작성해주세요:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🇰🇷 오늘 코스피·코스닥 시장 전망 [${dateStr}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌎 【글로벌 매크로 핵심 해석】
브리핑의 1순위 지표(SOX·S&P500·환율·금리·VIX) 각각에 대해
  수치 → 해석 → KOSPI 영향
형식으로 압축 정리 (각 지표 2~3줄)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 【KOSPI 시나리오 분석】

① 예상 등락 범위
   - 코스피: X,XXX ~ X,XXX (전일 종가 대비 ±X.X% 밴드)
   - 코스닥: XXX ~ XXX
   - 범위 설정 근거: (간략히)

② 방향 확률
   - 상승 XX% / 하락 XX%  ← 합산 반드시 100%, 50/50 절대 금지
   - XX%면 [강한 방향성 / 우세 / 혼조] 판단 명시

③ 장중 구조 예측
   ▶ 【전강후약 / 전약후강 / 종일상승 / 종일하락 / 박스권】 ← 1개 선택
   이유 3가지 이상:
   - 이유 1
   - 이유 2
   - 이유 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🇰🇷 【국내 수급 예측】

■ 외국인 선물 포지션 예측
   - 예상 포지션 방향 + 계약 수준 (예: 매수 우위 +1,500계약 수준 예상)
   - 방향 판단 근거

■ 프로그램 매매 예측
   - 차익/비차익 방향 예측
   - 지수 영향 설명

■ 삼성전자·SK하이닉스 예측
   - 두 종목 외국인 방향 예측
   - 지수 파급 효과 설명

■ 투자자별 종합 수급 예측
   - 외국인: [매수/매도] 우위 — 이유
   - 기관: [매수/매도] 우위 — 이유
   - 개인: [매수/매도] 우위 — 이유
   - 종합 신호: [가장 강한 상승/하락/혼조] 중 하나 + 근거

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 【강세 섹터 TOP 3】

1위: [섹터명]
   - 글로벌 연동 근거
   - 국내 모멘텀
   - 주목 종목 (2~3개)
   - 매수 타이밍 힌트

2위: [섹터명]
   - 근거 (위와 동일 구조)
   - 주목 종목

3위: [섹터명]
   - 근거
   - 주목 종목

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ 【리스크 패턴 경보】

다음 3대 함정 패턴의 가능성을 각각 판단해주세요:

① 외국인 선물 트랩 가능성: [높음/중간/낮음]
   발생 조건 해당 여부:
   대응 전략:

② 개미 털기 가능성: [높음/중간/낮음]
   발생 조건 해당 여부:
   대응 전략:

③ 반도체 페이크아웃 가능성: [높음/중간/낮음]
   발생 조건 해당 여부:
   대응 전략:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ 【핵심 관찰 시간대】

09:00 선물 체크
   → 확인 포인트: 외국인 KOSPI200 선물 초반 방향
   → 해석 기준:

09:30 방향 확정
   → 확인 포인트: 09:00 대비 선물 변화량
   → 시나리오 유지/조정 기준:

10:30 오전 방향 확정
   → 확인 포인트: 프로그램 매매 피벗 여부
   → 판단 기준:

13:30 오후 수급 재편
   → 확인 포인트: 외국인 포지션 재조정 여부
   → 오후 전략 변경 기준:

14:30 마감 방향 확정
   → 확인 포인트: 기관·외국인 최종 포지션
   → 내일 시초가 방향 힌트:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 【한줄 결론】

"[핵심 드라이버] + [보조요인] → [매매 입장]"
예) "SOX 강세 + 외국인 선물 매수 → 반도체 중심 상승, 눌림은 매수 기회"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ 브리핑 완료 후 투자자가 스스로 답할 수 있어야 할 3가지
  ① 오늘 가장 가능성 높은 방향은?
  ② 언제 방향이 결정되는가?
  ③ 이 시나리오를 무효화하는 리스크는 무엇인가?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
본 분석은 시장 구조 분석이며 투자 권유가 아닙니다.
최종 매매 결정과 손익 책임은 투자자 본인에게 있습니다.`;
}

// ── 메인 핸들러 ─────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── 1. /api/briefing 호출 ────────────────────────────────────────────────────
  let report = "";
  try {
    const briefingUrl = new URL("/api/briefing", context.request.url).toString();
    const briefingRes = await fetch(briefingUrl);
    if (!briefingRes.ok) throw new Error(`briefing HTTP ${briefingRes.status}`);
    const briefingData = await briefingRes.json();
    report = briefingData.report || "";
  } catch (err) {
    console.error("[prediction] /api/briefing 호출 실패:", err);
    report = "미국 시장 데이터를 불러올 수 없습니다. 가용 데이터 기반으로 시장 구조 분석을 제공합니다.";
  }

  // ── 2. API 키 로드 ───────────────────────────────────────────────────────────
  const apiKey = context.env.ANTHROPIC_API_KEY;

  // ── 3. 날짜 계산 (KST 기준) ─────────────────────────────────────────────────
  const now = new Date();
  const kstDateStr = now.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "long", day: "numeric",
  });

  // ── 4. Claude API 호출 ───────────────────────────────────────────────────────
  let prediction = "";
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: TRADER_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: buildPredictionPrompt(report, kstDateStr),
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error(`Claude API HTTP ${claudeRes.status}: ${errBody}`);
    }

    const claudeData = await claudeRes.json();

    if (Array.isArray(claudeData.content)) {
      prediction = claudeData.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    }

  } catch (err) {
    console.error("[prediction] Claude API 호출 실패:", err);
    return new Response(
      JSON.stringify({
        error: "예측 보고서 생성 실패",
        prediction: "예측 보고서를 생성할 수 없습니다. 잠시 후 다시 시도해주세요.",
        generatedAt: new Date().toISOString(),
      }),
      { status: 500, headers: corsHeaders }
    );
  }

  // ── 5. 최종 반환 ─────────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({ prediction, generatedAt: new Date().toISOString() }),
    { status: 200, headers: corsHeaders }
  );
}
