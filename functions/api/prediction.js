/**
 * prediction.js — Cloudflare Pages Function
 *
 * KOSPI/KOSDAQ 예측 보고서 생성
 * 최적화:
 *   - 내부 /api/briefing 호출 제거 → 클라이언트에서 briefing 전달 (타임아웃 수정)
 *   - claude-haiku-4-5-20251001 사용 (Sonnet 대비 약 10배 저렴)
 *   - max_tokens 4000 → 2000
 *   - 시스템 프롬프트 2500토큰 → 500토큰으로 압축
 *
 * POST /api/prediction  { briefing: string } → { prediction, generatedAt }
 * OPTIONS               → CORS preflight
 */

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `KOSPI/KOSDAQ 20년 경력 전문 트레이더.

■ 분석 철학: 데이터 기반, 확률적 사고(50/50 절대 금지), 리스크 우선, 단호한 표현.

■ 핵심 지표
① SOX ±1.5%↑ = KOSPI 강연동 (상관관계 80%+)
② S&P500·NASDAQ선물 방향
③ USD/KRW: +10원=외국인매도 가능성, -5원↓=유입 우호
④ 미10년물금리: 성장주·기술주 밸류에이션 압박
⑤ VIX 25↑ = 추세 매매 신뢰 하락

■ 수급 기준
외국인선물 +2500계약↑=강매수, -3000계약↓=강매도
외국인↑+기관↑=최강상승, 외국인↓+개인↑=위험(개미털기)
삼성전자+SK하이닉스 합산 KOSPI 비중 30%+ → 방향 필수 파악

■ 3대 함정: 외국인선물트랩 / 개미털기 / 반도체페이크아웃(+2%갭↑주의)
■ 장중구조 5종: 전강후약 / 전약후강 / 종일상승 / 종일하락 / 박스권`;

function buildPrompt(briefing, dateStr) {
  return `오늘: ${dateStr}

[미국 시장 브리핑]
${briefing}

위 브리핑을 바탕으로 한국 시장 전문 예측 보고서 작성:

🌎 【글로벌 매크로 핵심 해석】
SOX·S&P500·환율·금리·VIX 각각: 수치→해석→KOSPI영향 (지표당 2줄)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 【KOSPI 시나리오】
① 예상 등락범위: 코스피 X,XXX~X,XXX / 코스닥 XXX~XXX + 근거
② 방향 확률: 상승XX% / 하락XX% (합계 반드시 100%, 근거 명시)
③ 장중구조: [5종 중 1개 선택] + 이유 3가지

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🇰🇷 【국내 수급 예측】
외국인선물 포지션 / 프로그램매매 / 삼성+하이닉스 방향 / 투자자별 종합신호

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 【강세 섹터 TOP3】
각 섹터: 글로벌연동근거·주목종목 2~3개·매수타이밍힌트

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ 【리스크 패턴 경보】
외국인선물트랩/개미털기/반도체페이크아웃 → 각각 [높음/중간/낮음] + 발생조건 + 대응전략

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ 【핵심 관찰 시간대】
09:00 / 09:30 / 10:30 / 13:30 / 14:30 각 확인포인트와 판단기준

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 【한줄 결론】
"핵심드라이버 + 보조요인 → 매매입장"

※투자 권유 아님. 최종 책임은 투자자 본인.`;
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── briefing 텍스트 수신 (POST body) ─────────────────────────────────────
  let briefing = "";
  try {
    const body = await context.request.json();
    briefing = body.briefing || "";
  } catch (_) {
    briefing = "미국 시장 데이터를 불러올 수 없습니다. 가용 데이터 기반으로 분석합니다.";
  }

  const apiKey = context.env.ANTHROPIC_API_KEY;
  const now = new Date();
  const kstDateStr = now.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "long", day: "numeric",
  });

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: buildPrompt(briefing, kstDateStr),
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errBody}`);
    }

    const claudeData = await claudeRes.json();
    const prediction = (claudeData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return new Response(
      JSON.stringify({ prediction, generatedAt: new Date().toISOString() }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error("[prediction] error:", err);
    return new Response(
      JSON.stringify({
        error: "예측 보고서 생성 실패",
        prediction: "예측 보고서를 생성할 수 없습니다. 잠시 후 다시 시도해주세요.",
        generatedAt: new Date().toISOString(),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
