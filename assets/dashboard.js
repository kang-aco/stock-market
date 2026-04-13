'use strict';

let marketData    = null;
let investorsData = null;
let sparklineCharts = {};
let investorCharts  = {};
let stockSortState  = { col: null, asc: true };
let currentStocks   = [];

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function colorClass(v) {
  if (v == null) return 'text-flat';
  return v > 0 ? 'text-rise' : v < 0 ? 'text-fall' : 'text-flat';
}

function directionIcon(v) {
  if (v == null || v === 0) return '<span class="text-flat">━</span>';
  return v > 0 ? '<span class="text-rise">▲</span>' : '<span class="text-fall">▼</span>';
}

function formatChangeRate(r) {
  if (r == null) return 'N/A';
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`;
}

function formatChange(c) {
  if (c == null) return 'N/A';
  const a = Math.abs(c).toFixed(2);
  if (c > 0) return `<span class="text-rise">▲${a}</span>`;
  if (c < 0) return `<span class="text-fall">▼${a}</span>`;
  return `<span class="text-flat">━${a}</span>`;
}

function formatChangePrice(c) {
  if (c == null) return '<span class="text-flat">—</span>';
  const a = Math.abs(c).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (c > 0) return `<span class="text-rise">+${a}</span>`;
  if (c < 0) return `<span class="text-fall">−${a}</span>`;
  return `<span class="text-flat">±0</span>`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ── 1. 시계 & 장 상태 ─────────────────────────────────────────────────────────

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('ko-KR');
}

function updateMarketStatusBadge(status) {
  const b = document.getElementById('market-status-badge');
  b.className = 'px-3 py-1 rounded-full font-semibold text-xs';
  if (status === 'OPEN') {
    b.textContent = '● 개장 중';
    b.classList.add('bg-green-900', 'text-green-300', 'blink');
  } else if (status === 'PRE_MARKET') {
    b.textContent = '● 프리마켓';
    b.classList.add('bg-yellow-900', 'text-yellow-300');
  } else {
    b.textContent = '● 장 마감';
    b.classList.add('bg-slate-700', 'text-slate-400');
  }
}

// ── 2. fetchMarket ────────────────────────────────────────────────────────────

async function fetchMarket() {
  try {
    const res  = await fetch('/api/market');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    marketData = data;
    renderIndices(data.indices);
    renderStocks(data.stocks);
    renderFxOil(data.fx, data.oil);
    document.getElementById('last-updated').textContent = formatTime(data.updatedAt);
    updateMarketStatusBadge(data.marketStatus);
  } catch (err) {
    console.error('[fetchMarket]', err);
    showToast(marketData ? '데이터 갱신 실패 — 이전 데이터 유지 중' : '시장 데이터를 불러올 수 없습니다');
  }
}

// ── 3. fetchInvestors ─────────────────────────────────────────────────────────

async function fetchInvestors() {
  try {
    const res  = await fetch('/api/investors');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log('[investors API]', JSON.stringify(data));
    investorsData = data;
    renderInvestorCharts(data);
    renderInvestorStatus(data);
  } catch (err) {
    console.error('[fetchInvestors]', err);
    showToast(investorsData ? '데이터 갱신 실패 — 이전 데이터 유지 중' : '투자자 데이터를 불러올 수 없습니다');
  }
}

/** Mock 여부 / 업데이트 시각 / 안내문 렌더링 */
function renderInvestorStatus(data) {
  const badge   = document.getElementById('investor-data-badge');
  const updated = document.getElementById('investor-updated');
  const notice  = document.getElementById('investor-mock-notice');
  const reason  = document.getElementById('mock-reason');

  if (data.isMock) {
    if (badge) badge.innerHTML =
      '<span class="bg-yellow-900/60 text-yellow-400 border border-yellow-700/50 px-2 py-0.5 rounded text-xs">⚠️ 모의데이터</span>';
    if (notice)  notice.classList.remove('hidden');
    if (reason)  reason.textContent = data.mockReason ? `(${data.mockReason})` : '';
  } else {
    if (badge) {
      const futureTag = data.futuresMock
        ? ' <span class="text-yellow-400/70 text-xs">(선물 mock)</span>'
        : '';
      badge.innerHTML =
        `<span class="bg-green-900/60 text-green-400 border border-green-700/50 px-2 py-0.5 rounded text-xs">📡 KIS 실시간</span>${futureTag}`;
    }
    if (notice) notice.classList.add('hidden');
  }

  if (updated) updated.textContent = data.updatedAt ? `갱신: ${formatTime(data.updatedAt)}` : '';
}

// ── 4. renderIndices ──────────────────────────────────────────────────────────

function createSparkline(el, sparkline, change) {
  const color = (change == null || change >= 0) ? '#22c55e' : '#ef4444';
  return new Chart(el, {
    type: 'line',
    data: {
      labels: sparkline.map((_, i) => i),
      datasets: [{ data: sparkline, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales:  { x: { display: false }, y: { display: false } },
      animation: false,
    },
  });
}

function renderIndices(indices) {
  const container = document.getElementById('indices-container');
  container.innerHTML = '';
  indices.forEach((idx) => {
    const isNull    = idx.value === null;
    const valueText = isNull ? 'N/A' : idx.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cls       = colorClass(idx.change);
    const card      = document.createElement('div');
    card.className  = 'index-card';
    card.id         = `index-${idx.id}`;
    card.innerHTML  = `
      <div class="text-slate-400 text-xs mb-1">${idx.name}</div>
      <div class="text-2xl font-bold mb-1 ${cls}">${valueText}</div>
      <div class="text-sm mb-0.5"></div>
      <div class="text-xs ${cls}">${isNull ? 'N/A' : formatChangeRate(idx.changeRate)}</div>
      <div class="sparkline-wrapper mt-2" style="height:40px;position:relative;">
        <canvas class="sparkline-canvas" id="sparkline-${idx.id}"></canvas>
      </div>
    `;
    card.querySelectorAll('div')[2].innerHTML = isNull ? '—' : formatChange(idx.change);
    container.appendChild(card);
    if (Array.isArray(idx.sparkline) && idx.sparkline.length > 1) {
      const cv = card.querySelector(`#sparkline-${idx.id}`);
      if (sparklineCharts[idx.id]) sparklineCharts[idx.id].destroy();
      sparklineCharts[idx.id] = createSparkline(cv, idx.sparkline, idx.change);
    }
  });
}

// ── 5. renderStocks ───────────────────────────────────────────────────────────

function renderStocks(stocks) {
  currentStocks = stocks || [];
  renderStocksTable(currentStocks);
}

function renderStocksTable(stocks) {
  const tbody = document.getElementById('stocks-tbody');
  tbody.innerHTML = '';
  if (!stocks || stocks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-500">데이터 없음</td></tr>';
    return;
  }
  stocks.forEach((s) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors';
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-[#f1f5f9]">${s.name}</td>
      <td class="px-4 py-3 text-right font-mono">${s.price != null ? s.price.toLocaleString('ko-KR') + '원' : 'N/A'}</td>
      <td class="px-4 py-3 text-right font-mono">${formatChangePrice(s.change)}</td>
      <td class="px-4 py-3 text-right font-mono ${colorClass(s.changeRate)}">${formatChangeRate(s.changeRate)}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-300">${s.volume != null ? s.volume.toLocaleString('ko-KR') : 'N/A'}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-400">${s.ratio != null ? s.ratio.toFixed(2) + '%' : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── 6. 종목 테이블 정렬 ────────────────────────────────────────────────────────

function initStockSorting() {
  document.querySelectorAll('.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (stockSortState.col === col) stockSortState.asc = !stockSortState.asc;
      else { stockSortState.col = col; stockSortState.asc = true; }
      document.querySelectorAll('.sortable').forEach((el) => el.classList.remove('active'));
      th.classList.add('active');
      const sorted = [...currentStocks].sort((a, b) => {
        const key = col;
        const va = a[key] ?? 0, vb = b[key] ?? 0;
        return stockSortState.asc ? va - vb : vb - va;
      });
      renderStocksTable(sorted);
    });
  });
}

// ── 7. renderFxOil ────────────────────────────────────────────────────────────

function renderFxOil(fx, oil) {
  const container = document.getElementById('fx-oil-container');
  container.innerHTML = '';
  const renderCard = (id, label, value, change, changeRate) => {
    const card = document.createElement('div');
    card.className = 'fx-oil-card';
    card.id = id;
    const vt = value      != null ? value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';
    const ct = change     != null ? `${Math.abs(change).toFixed(2)}` : '—';
    const rt = changeRate != null ? formatChangeRate(changeRate) : 'N/A';
    card.innerHTML = `
      <div class="text-slate-400 text-xs mb-1">${label}</div>
      <div class="text-xl font-bold mb-1 ${colorClass(change)}">${vt}</div>
      <div class="flex items-center gap-1 text-sm"></div>
    `;
    card.querySelectorAll('div')[2].innerHTML = `${directionIcon(change)} <span>${ct}</span> <span class="text-xs">(${rt})</span>`;
    container.appendChild(card);
  };
  fx.forEach((i)  => renderCard(`fx-${i.id.replace('/','- ')}`,  i.id,   i.value, i.change, i.changeRate));
  oil.forEach((i) => renderCard(`oil-${i.id}`,                   i.name, i.value, i.change, i.changeRate));
}

// ── 8. renderInvestorCharts ───────────────────────────────────────────────────

function renderInvestorCharts(data) {
  const futuresUnit  = data.futuresUnit || '계약';
  const unitDisplay  = futuresUnit.replace('(mock)', '').trim();
  const futuresLabel = document.getElementById('futures-unit-label');
  if (futuresLabel) futuresLabel.textContent = `(단위: ${unitDisplay})`;

  const markets = [
    { key: 'kospi',   canvasId: 'kospi-investor-chart',   unit: data.unit || '억원' },
    { key: 'kosdaq',  canvasId: 'kosdaq-investor-chart',  unit: data.unit || '억원' },
    { key: 'futures', canvasId: 'futures-investor-chart', unit: unitDisplay },
  ];

  markets.forEach(({ key, canvasId, unit }) => {
    const mkt    = data[key] || { individual: 0, institution: 0, foreign: 0 };
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (investorCharts[key]) { investorCharts[key].destroy(); investorCharts[key] = null; }

    const values = [mkt.individual, mkt.institution, mkt.foreign];
    if (values.every(v => v === 0)) {
      canvas.parentElement.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:13px;">거래 데이터 없음</div>';
      return;
    }

    investorCharts[key] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels:   ['개인', '기관', '외국인'],
        datasets: [{
          data:            values,
          backgroundColor: values.map(v => v >= 0 ? '#3b82f6' : '#ef4444'),
          borderRadius:    4,
          borderSkipped:   false,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw.toLocaleString('ko-KR')} ${unit}` } },
        },
        scales: {
          x: {
            ticks: {
              color: '#94a3b8', font: { size: 11 },
              callback: (val) => unit === '계약' ? `${val.toLocaleString('ko-KR')}계` : `${val.toLocaleString('ko-KR')}억`,
            },
            grid: { color: 'rgba(148,163,184,0.1)' },
          },
          y: { ticks: { color: '#94a3b8', font: { size: 12 } }, grid: { display: false } },
        },
        animation: { duration: 400 },
      },
    });
  });
}

// ── 초기화 ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);
  initStockSorting();
  fetchMarket();
  fetchInvestors();
  setInterval(fetchMarket,    30000);
  setInterval(fetchInvestors, 30000);
});
