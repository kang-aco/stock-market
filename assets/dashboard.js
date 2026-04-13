'use strict';

// ── 전역 상태 ──────────────────────────────────────────────────────────────
let marketData = null;
let investorsData = null;
let sparklineCharts = {};
let investorCharts = {};
let stockSortState = { col: null, asc: true };
let currentStocks = [];

// ── 유틸 ──────────────────────────────────────────────────────────────────

function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function colorClass(value) {
  if (value === null || value === undefined) return 'text-flat';
  if (value > 0) return 'text-rise';
  if (value < 0) return 'text-fall';
  return 'text-flat';
}

function directionIcon(value) {
  if (value === null || value === undefined || value === 0) return '<span class="text-flat">━</span>';
  if (value > 0) return '<span class="text-rise">▲</span>';
  return '<span class="text-fall">▼</span>';
}

function formatChangeRate(rate) {
  if (rate === null || rate === undefined) return 'N/A';
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(2)}%`;
}

function formatChange(change) {
  if (change === null || change === undefined) return 'N/A';
  const abs = Math.abs(change).toFixed(2);
  if (change > 0) return `<span class="text-rise">▲${abs}</span>`;
  if (change < 0) return `<span class="text-fall">▼${abs}</span>`;
  return `<span class="text-flat">━${abs}</span>`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── 1. 시계 및 장 상태 뱃지 ─────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('ko-KR');
}

function updateMarketStatusBadge(status) {
  const badge = document.getElementById('market-status-badge');
  badge.className = 'px-3 py-1 rounded-full font-semibold text-xs';

  if (status === 'OPEN') {
    badge.textContent = '● 개장 중';
    badge.classList.add('bg-green-900', 'text-green-300', 'blink');
  } else if (status === 'PRE_MARKET') {
    badge.textContent = '● 프리마켓';
    badge.classList.add('bg-yellow-900', 'text-yellow-300');
  } else {
    badge.textContent = '● 장 마감';
    badge.classList.add('bg-slate-700', 'text-slate-400');
  }
}

// ── 2. fetchMarket ────────────────────────────────────────────────────────

async function fetchMarket() {
  try {
    const res = await fetch('/api/market');
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
    if (marketData) {
      showToast('데이터 갱신 실패 — 이전 데이터 유지 중');
    } else {
      showToast('시장 데이터를 불러올 수 없습니다');
    }
  }
}

// ── 3. fetchInvestors ─────────────────────────────────────────────────────

async function fetchInvestors() {
  try {
    const res = await fetch('/api/investors');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    investorsData = data;
    renderInvestorCharts(data);
  } catch (err) {
    console.error('[fetchInvestors]', err);
    if (investorsData) {
      showToast('데이터 갱신 실패 — 이전 데이터 유지 중');
    } else {
      showToast('투자자 데이터를 불러올 수 없습니다');
    }
  }
}

// ── 4. renderIndices ──────────────────────────────────────────────────────

function createSparkline(canvasEl, sparkline, change) {
  const color = (change === null || change === undefined || change >= 0) ? '#22c55e' : '#ef4444';
  return new Chart(canvasEl, {
    type: 'line',
    data: {
      labels: sparkline.map((_, i) => i),
      datasets: [{
        data: sparkline,
        borderColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      animation: false,
    },
  });
}

function renderIndices(indices) {
  const container = document.getElementById('indices-container');
  container.innerHTML = '';

  indices.forEach((idx) => {
    const isNull = idx.value === null;
    const valueText = isNull ? 'N/A' : idx.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cls = colorClass(idx.change);
    const rateText = isNull ? 'N/A' : formatChangeRate(idx.changeRate);

    const card = document.createElement('div');
    card.className = 'index-card';
    card.id = `index-${idx.id}`;
    card.innerHTML = `
      <div class="text-slate-400 text-xs mb-1">${idx.name}</div>
      <div class="text-2xl font-bold mb-1 ${cls}">${valueText}</div>
      <div class="text-sm mb-0.5 ${cls}"></div>
      <div class="text-xs ${cls}">${rateText}</div>
      <div class="sparkline-wrapper mt-2" style="height:40px; position:relative;">
        <canvas class="sparkline-canvas" id="sparkline-${idx.id}"></canvas>
      </div>
    `;

    const changeDiv = card.querySelectorAll('div')[2];
    changeDiv.innerHTML = isNull ? '—' : formatChange(idx.change);

    container.appendChild(card);

    if (Array.isArray(idx.sparkline) && idx.sparkline.length > 1) {
      const canvasEl = card.querySelector(`#sparkline-${idx.id}`);
      if (sparklineCharts[idx.id]) {
        sparklineCharts[idx.id].destroy();
      }
      sparklineCharts[idx.id] = createSparkline(canvasEl, idx.sparkline, idx.change);
    }
  });
}

// ── 5. renderStocks ───────────────────────────────────────────────────────

function renderStocks(stocks) {
  currentStocks = stocks || [];
  renderStocksTable(currentStocks);
}

function renderStocksTable(stocks) {
  const tbody = document.getElementById('stocks-tbody');
  tbody.innerHTML = '';

  if (!stocks || stocks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-500">데이터 없음</td></tr>';
    return;
  }

  stocks.forEach((stock) => {
    const rateCls = colorClass(stock.changeRate);
    const rateText = formatChangeRate(stock.changeRate);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-[#f1f5f9]">${stock.name}</td>
      <td class="px-4 py-3 text-right font-mono">${stock.price.toLocaleString('ko-KR')}원</td>
      <td class="px-4 py-3 text-right font-mono ${rateCls}">${rateText}</td>
      <td class="px-4 py-3 text-right font-mono text-slate-300">${stock.volume.toLocaleString('ko-KR')}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── 6. 종목 테이블 정렬 ───────────────────────────────────────────────────

function initStockSorting() {
  document.querySelectorAll('.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (stockSortState.col === col) {
        stockSortState.asc = !stockSortState.asc;
      } else {
        stockSortState.col = col;
        stockSortState.asc = true;
      }

      document.querySelectorAll('.sortable').forEach((el) => el.classList.remove('active'));
      th.classList.add('active');

      const sorted = [...currentStocks].sort((a, b) => {
        let va, vb;
        if (col === 'price') { va = a.price; vb = b.price; }
        else if (col === 'changeRate') { va = a.changeRate; vb = b.changeRate; }
        else { va = a.volume; vb = b.volume; }
        return stockSortState.asc ? va - vb : vb - va;
      });

      renderStocksTable(sorted);
    });
  });
}

// ── 7. renderFxOil ────────────────────────────────────────────────────────

function renderFxOil(fx, oil) {
  const container = document.getElementById('fx-oil-container');
  container.innerHTML = '';

  const renderCard = (id, label, value, change, changeRate) => {
    const card = document.createElement('div');
    card.className = 'fx-oil-card';
    card.id = id;

    const valueText = value !== null && value !== undefined
      ? value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : 'N/A';

    const changeText = change !== null && change !== undefined
      ? `${Math.abs(change).toFixed(2)}`
      : '—';
    const rateText = changeRate !== null && changeRate !== undefined
      ? formatChangeRate(changeRate)
      : 'N/A';

    card.innerHTML = `
      <div class="text-slate-400 text-xs mb-1">${label}</div>
      <div class="text-xl font-bold mb-1"></div>
      <div class="flex items-center gap-1 text-sm"></div>
    `;

    const valueDiv = card.querySelectorAll('div')[1];
    valueDiv.className = `text-xl font-bold mb-1 ${colorClass(change)}`;
    valueDiv.textContent = valueText;

    const changeRow = card.querySelectorAll('div')[2];
    changeRow.innerHTML = `${directionIcon(change)} <span>${changeText}</span> <span class="text-xs">(${rateText})</span>`;

    container.appendChild(card);
  };

  fx.forEach((item) => {
    const safeId = `fx-${item.id.replace('/', '-')}`;
    renderCard(safeId, item.id, item.value, item.change, item.changeRate);
  });

  oil.forEach((item) => {
    renderCard(`oil-${item.id}`, item.name, item.value, item.change, item.changeRate);
  });
}

// ── 8. renderInvestorCharts ───────────────────────────────────────────────

function renderInvestorCharts(data) {
  const markets = [
    { key: 'kospi', canvasId: 'kospi-investor-chart' },
    { key: 'kosdaq', canvasId: 'kosdaq-investor-chart' },
  ];

  markets.forEach(({ key, canvasId }) => {
    const mktData = data[key];
    if (!mktData) return;

    const labels = ['개인', '기관', '외국인'];
    const values = [mktData.individual, mktData.institution, mktData.foreign];
    const colors = values.map((v) => (v >= 0 ? '#3b82f6' : '#ef4444'));

    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    if (investorCharts[key]) {
      investorCharts[key].destroy();
    }

    investorCharts[key] = new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.raw.toLocaleString('ko-KR')} 억원`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#94a3b8',
              font: { size: 11 },
              callback: (val) => `${val.toLocaleString('ko-KR')}억`,
            },
            grid: { color: 'rgba(148,163,184,0.1)' },
          },
          y: {
            ticks: { color: '#94a3b8', font: { size: 12 } },
            grid: { display: false },
          },
        },
        animation: { duration: 400 },
      },
    });
  });
}

// ── 9. 초기화 ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);

  initStockSorting();

  fetchMarket();
  fetchInvestors();

  setInterval(fetchMarket, 30000);
  setInterval(fetchInvestors, 30000);
});
