'use strict';

// ── 전역 상태 ──────────────────────────────────────────────────────────────
let marketData = null;
let currentRegion = 'all';                       // all | korea | us | asia | eu
let stockSortState = { col: null, asc: false };  // 첫 클릭은 내림차순
let currentStocks = [];

const REFRESH_INTERVAL_MS = 30000;

// ── 유틸 ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatNumber(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return 'N/A';
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 값의 크기에 맞춰 소수 자릿수를 정합니다 (비트코인처럼 큰 값은 정수). */
function autoDecimals(value) {
  if (value === null || value === undefined || isNaN(value)) return 2;
  return Math.abs(value) >= 10000 ? 0 : 2;
}

function formatVolume(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
  return n.toLocaleString('ko-KR');
}

function colorClass(value) {
  if (value === null || value === undefined || isNaN(value)) return 'text-flat';
  if (value > 0) return 'text-rise';
  if (value < 0) return 'text-fall';
  return 'text-flat';
}

function arrowFor(value) {
  if (value === null || value === undefined || isNaN(value) || value === 0) return '━';
  return value > 0 ? '▲' : '▼';
}

function formatChangeRate(rate) {
  if (rate === null || rate === undefined || isNaN(rate)) return 'N/A';
  const sign = rate > 0 ? '+' : '';
  return `${sign}${rate.toFixed(2)}%`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── 1. 세계 시계 및 장 상태 ────────────────────────────────────────────────

// open/close: 현지 시각 [시, 분] · pre: 개장 전 프리마켓 인정 범위(분)
const MARKET_HOURS = {
  seoul:     { tz: 'Asia/Seoul',       open: [9, 0],  close: [15, 30], pre: 60 },
  ny:        { tz: 'America/New_York', open: [9, 30], close: [16, 0],  pre: 60 },
  london:    { tz: 'Europe/London',    open: [8, 0],  close: [16, 30], pre: 60 },
  tokyo:     { tz: 'Asia/Tokyo',       open: [9, 0],  close: [15, 0],  pre: 60 },
  shanghai:  { tz: 'Asia/Shanghai',    open: [9, 30], close: [15, 0],  pre: 60 },
  frankfurt: { tz: 'Europe/Berlin',    open: [9, 0],  close: [17, 30], pre: 60 },
};

/**
 * 특정 타임존의 현재 시/분/요일을 Intl로 정확히 추출합니다.
 * (Date 문자열 재파싱 방식은 브라우저별 동작이 달라 사용하지 않습니다.)
 */
function getZonedParts(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value;
  // hour12:false 환경에서 자정이 '24'로 나오는 경우를 보정
  const hour = parseInt(get('hour'), 10) % 24;
  return {
    hour,
    minute: parseInt(get('minute'), 10),
    weekday: get('weekday'),
  };
}

function getMarketStatus(cityKey) {
  const m = MARKET_HOURS[cityKey];
  const { hour, minute, weekday } = getZonedParts(m.tz);

  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';

  const nowMin   = hour * 60 + minute;
  const openMin  = m.open[0] * 60 + m.open[1];
  const closeMin = m.close[0] * 60 + m.close[1];

  if (nowMin >= openMin && nowMin < closeMin) return 'open';
  if (nowMin >= openMin - m.pre && nowMin < openMin) return 'pre';
  return 'closed';
}

function formatZonedTime(timeZone) {
  const { hour, minute } = getZonedParts(timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function updateClocks() {
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = new Date().toLocaleTimeString('ko-KR');

  Object.keys(MARKET_HOURS).forEach((key) => {
    const timeEl = document.getElementById('clock-' + key);
    const dotEl  = document.getElementById('dot-' + key);
    if (timeEl) timeEl.textContent = formatZonedTime(MARKET_HOURS[key].tz);
    if (dotEl)  dotEl.className = 'status-dot ' + getMarketStatus(key);
  });
}

function updateMarketStatusBadge(status) {
  const badge = document.getElementById('market-status-badge');
  const map = {
    OPEN:       ['장중',     'open'],
    PRE_MARKET: ['프리마켓', 'pre'],
    CLOSED:     ['장 마감',  'closed'],
  };
  const [text, cls] = map[status] || map.CLOSED;
  badge.className = 'market-badge ' + cls + (cls === 'open' ? ' blink' : '');
  badge.innerHTML = `<span class="status-dot ${cls}"></span> ${text}`;
}

// ── 2. 데이터 조회 ─────────────────────────────────────────────────────────

async function fetchMarket() {
  const btn = document.getElementById('btn-refresh');
  const btnText = document.getElementById('refresh-text');
  btn.disabled = true;
  btnText.textContent = '불러오는 중...';

  try {
    const res = await fetch('/api/market');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    marketData = data;

    renderIndices();
    renderStocks(data.stocks);
    renderFxCommodities(data.fx, data.commodities);
    document.getElementById('last-updated').textContent = formatTime(data.updatedAt);
    updateMarketStatusBadge(data.marketStatus);
  } catch (err) {
    console.error('[fetchMarket]', err);
    showToast(marketData
      ? '데이터 갱신 실패 — 이전 데이터 유지 중'
      : '시장 데이터를 불러올 수 없습니다');
  } finally {
    btn.disabled = false;
    btnText.textContent = '새로고침';
  }
}

// ── 3. 지수 카드 ───────────────────────────────────────────────────────────

/**
 * 실제 시세 배열로 스파크라인 SVG를 그립니다.
 * 데이터가 2개 미만이면 빈 문자열을 반환합니다.
 */
function sparklineSVG(data, change) {
  if (!Array.isArray(data) || data.length < 2) return '';

  const w = 110, h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const color = (change === null || change === undefined || change >= 0)
    ? 'var(--positive)'
    : 'var(--danger)';
  const lastY = (h - ((data[data.length - 1] - min) / range) * h).toFixed(1);

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="overflow:visible">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${w}" cy="${lastY}" r="2.5" fill="${color}"/>
  </svg>`;
}

function renderIndices() {
  const container = document.getElementById('indices-container');
  const all = marketData?.indices || [];
  const list = currentRegion === 'all'
    ? all
    : all.filter((idx) => idx.region === currentRegion);

  if (list.length === 0) {
    container.innerHTML = '<div class="loading-text">표시할 지수가 없습니다</div>';
    return;
  }

  container.innerHTML = list.map((idx, i) => {
    const isNull = idx.value === null || idx.value === undefined;
    const cls = colorClass(idx.change);
    const badgeBg = idx.change > 0 ? 'bg-up' : idx.change < 0 ? 'bg-down' : 'bg-flat';

    const valueText = isNull ? 'N/A' : formatNumber(idx.value, 2);
    const changeText = (idx.change === null || idx.change === undefined)
      ? '—'
      : `${arrowFor(idx.change)} ${formatNumber(Math.abs(idx.change), 2)}`;
    const rateText = isNull ? 'N/A' : formatChangeRate(idx.changeRate);

    return `
      <div class="index-card fade-in" style="animation-delay: ${i * 0.04}s">
        <div class="card-header">
          <div>
            <div class="name">${escapeHtml(idx.name)}</div>
            <div class="symbol-row">
              <span class="symbol">${escapeHtml(idx.id)}</span>
              ${idx.region ? `<span class="region-tag">${escapeHtml(idx.region)}</span>` : ''}
            </div>
          </div>
          <span class="badge ${badgeBg} ${cls}">${rateText}</span>
        </div>
        <div class="price">${valueText}</div>
        <div class="change-line ${cls}">${changeText}</div>
        <div class="sparkline-wrap">${sparklineSVG(idx.sparkline, idx.change)}</div>
      </div>
    `;
  }).join('');
}

function initRegionTabs() {
  document.querySelectorAll('#region-tabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#region-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentRegion = btn.dataset.filter;
      renderIndices();
    });
  });
}

// ── 4. 환율 · 원자재 ───────────────────────────────────────────────────────

function renderFxCommodities(fx, commodities) {
  const container = document.getElementById('fx-commodity-container');
  const items = [
    ...(fx || []).map((item) => ({ label: item.id, ...item })),
    ...(commodities || []).map((item) => ({ label: item.name, ...item })),
  ];

  if (items.length === 0) {
    container.innerHTML = '<div class="loading-text">데이터 없음</div>';
    return;
  }

  container.innerHTML = items.map((item, i) => {
    const cls = colorClass(item.change);
    const valueText = formatNumber(item.value, autoDecimals(item.value));
    const changeText = (item.change === null || item.change === undefined)
      ? '—'
      : `${arrowFor(item.change)} ${formatNumber(Math.abs(item.change), autoDecimals(item.change))}`;

    return `
      <div class="commodity-card fade-in" style="animation-delay: ${i * 0.04}s">
        <span class="name">${escapeHtml(item.label)}</span>
        <div class="value-group">
          <div class="value">${valueText}</div>
          <div class="change ${cls}">${changeText} (${formatChangeRate(item.changeRate)})</div>
        </div>
      </div>
    `;
  }).join('');
}

// ── 5. 펀드 편입 종목 테이블 ───────────────────────────────────────────────

function renderStocks(stocks) {
  currentStocks = stocks || [];
  renderStocksTable();
}

/** 현재 정렬 상태를 적용해 테이블을 그립니다 (자동 갱신 후에도 정렬 유지). */
function renderStocksTable() {
  const tbody = document.getElementById('stocks-tbody');

  if (currentStocks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-text">데이터 없음</td></tr>';
    return;
  }

  let rows = [...currentStocks];
  const { col, asc } = stockSortState;
  if (col) {
    rows.sort((a, b) => {
      const va = a[col] ?? 0;
      const vb = b[col] ?? 0;
      return asc ? va - vb : vb - va;
    });
  }

  tbody.innerHTML = rows.map((stock, i) => {
    const cls = colorClass(stock.change);
    const changeText = (stock.change === null || stock.change === undefined)
      ? '—'
      : `${arrowFor(stock.change)} ${formatNumber(Math.abs(stock.change), 0)}`;

    return `
      <tr class="fade-in" style="animation-delay: ${i * 0.03}s">
        <td>
          <div class="stock-name">${escapeHtml(stock.name)}</div>
          <div class="stock-code">${escapeHtml(stock.code || stock.id)}</div>
        </td>
        <td class="num">${formatNumber(stock.price, 0)}</td>
        <td class="num ${cls}">${changeText}</td>
        <td class="num ${cls}">${formatChangeRate(stock.changeRate)}</td>
        <td class="num">${formatVolume(stock.volume)}</td>
      </tr>
    `;
  }).join('');
}

function initStockSorting() {
  document.querySelectorAll('#stocks-table th.sortable').forEach((th) => {
    // 정렬 방향 표시용 화살표 자리
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.textContent = '▼';
    th.appendChild(arrow);

    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (stockSortState.col === col) {
        stockSortState.asc = !stockSortState.asc;
      } else {
        stockSortState.col = col;
        stockSortState.asc = false;   // 첫 클릭은 큰 값부터
      }

      document.querySelectorAll('#stocks-table th.sortable').forEach((el) => {
        el.classList.remove('active');
        el.querySelector('.sort-arrow').textContent = '▼';
      });
      th.classList.add('active');
      th.querySelector('.sort-arrow').textContent = stockSortState.asc ? '▲' : '▼';

      renderStocksTable();
    });
  });
}

// ── 초기화 ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  updateClocks();
  setInterval(updateClocks, 1000);

  initRegionTabs();
  initStockSorting();

  document.getElementById('btn-refresh').addEventListener('click', fetchMarket);

  fetchMarket();
  setInterval(fetchMarket, REFRESH_INTERVAL_MS);
});
