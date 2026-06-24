import { collection, query, where, getDocs, orderBy, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './config.js';

const CARD_COLORS = {
  'Magnus Burgundy': '#7B2D3C',
  'Infinia':         '#C8963E',
  'Times Black':     '#2D3436',
  'ICICI EPM':       '#2A9D8F',
  'Amazon Pay':      '#E88000',
};
const FALLBACK_COLORS = ['#6CB4EE','#9B8EA3','#CFBAF0','#B5D5C5','#8D99AE','#A8DADC'];

const CAT_COLORS = {
  'Food & Dining':       '#E76F51',
  'Grocery':             '#8AB17D',
  'Shopping':            '#F4A261',
  'Travel':              '#2A9D8F',
  'Entertainment':       '#CFBAF0',
  'Health & Medical':    '#9B8EA3',
  'Insurance':           '#8D99AE',
  'Rent':                '#B56576',
  'Utilities & Telecom': '#C9CBA3',
  'Fuel':                '#6D6875',
  'Education & Classes': '#BDE0FE',
  'Investments':         '#B5D5C5',
  'Fees & Charges':      '#CCC5B9',
  'Donations':           '#D4E09B',
  'Personal Care':       '#FFC8DD',
  'Auto & Maintenance':  '#A9A9A9',
  'Miscellaneous':       '#D3D3D3',
};

let monthlyChart = null;
let catYtdChart  = null;
let catMtdChart  = null;

// Registry of the data + option-builder for each on-dashboard chart, so the
// fullscreen overlay can rebuild an identical chart with a different legend
// position. Keyed by the same id used in the expand button's onclick.
const chartConfigs = {};
let fsChart = null;

function fmtK(v) {
  if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L';
  if (v >= 1000)   return '₹' + (v / 1000).toFixed(0) + 'K';
  return '₹' + Math.round(v);
}

function monthLabel(date) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

// Collapse the granular backend categories into the two broad buckets the user
// wants to see on the charts: every "Shopping - *" → "Shopping", every
// "Travel"/"Travel - *" → "Travel". Everything else passes through unchanged.
function groupCategory(cat) {
  if (!cat) return 'Miscellaneous';
  if (cat === 'Shopping' || cat.startsWith('Shopping -')) return 'Shopping';
  if (cat === 'Travel' || cat.startsWith('Travel -')) return 'Travel';
  return cat;
}

// Local YYYY-MM-DD (not toISOString — that shifts to UTC and can roll the day).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Sum of slices the legend currently has visible (toggled-off ones excluded).
function visibleTotal(chart) {
  const data = chart.data.datasets[0].data;
  let total = 0;
  data.forEach((v, i) => { if (chart.getDataVisibility(i)) total += v; });
  return total;
}

export async function loadCharts() {
  const now      = new Date();
  const ytdStart = new Date(now.getFullYear(), 0, 1);
  const sixAgo   = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const barStart = new Date(Math.min(ytdStart.getTime(), sixAgo.getTime()));
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const snap = await getDocs(query(
    collection(db, 'transactions'),
    where('date', '>=', Timestamp.fromDate(barStart)),
    orderBy('date', 'asc')
  ));

  const txns = snap.docs.map(d => d.data()).filter(t => t.type === 'debit');

  // ── Build month list for bar chart ───────────────────────────────
  const months = [];
  const monthStarts = [];
  const cursor = new Date(barStart.getFullYear(), barStart.getMonth(), 1);
  while (cursor <= now) {
    months.push(monthLabel(cursor));
    monthStarts.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // ── Aggregate data ────────────────────────────────────────────────
  const monthCardMap = {};  // {monthLabel: {card: amount}}
  const catYtd = {};
  const catMtd = {};
  // grouped chart label → set of the real backend categories it covers, so a
  // drill-down on "Shopping"/"Travel" filters transactions by every sub-category.
  const catRealMap = {};

  txns.forEach(t => {
    const d   = t.date.toDate();
    const ml  = monthLabel(d);
    const amt = t.amount || 0;
    const card = t.card || 'Unknown';
    const realCat = t.category || 'Miscellaneous';
    const cat  = groupCategory(realCat);

    if (!monthCardMap[ml]) monthCardMap[ml] = {};
    monthCardMap[ml][card] = (monthCardMap[ml][card] || 0) + amt;

    (catRealMap[cat] ||= new Set()).add(realCat);
    if (d >= ytdStart) catYtd[cat] = (catYtd[cat] || 0) + amt;
    if (d >= mtdStart) catMtd[cat] = (catMtd[cat] || 0) + amt;
  });

  // Expand a (possibly grouped) chart label back to the real categories the
  // transactions filter matches on.
  function realCats(label) {
    const s = catRealMap[label];
    return s ? [...s] : [label];
  }

  // ── Stacked bar ───────────────────────────────────────────────────
  const allCards = [...new Set(txns.map(t => t.card).filter(Boolean))];
  let fallbackIdx = 0;
  const barDatasets = allCards.map(card => ({
    label: card,
    data:  months.map(m => Math.round((monthCardMap[m] || {})[card] || 0)),
    backgroundColor: CARD_COLORS[card] || FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length],
  }));

  function barOptions(legendPosition, fs) {
    const lf = fs ? 16 : 11;   // legend font
    const tf = fs ? 14 : 11;   // tick font
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, els) => {
        if (!els.length) return;
        const el = els[0];
        const card = barDatasets[el.datasetIndex].label;
        const mStart = monthStarts[el.index];
        const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
        window.chartDrillDown?.({ card, dateFrom: ymd(mStart), dateTo: ymd(mEnd) });
      },
      plugins: {
        legend: { position: legendPosition, labels: { font: { family: 'Nunito', size: lf }, boxWidth: fs ? 20 : 12, padding: fs ? 16 : 10 } },
        tooltip: {
          bodyFont: { size: fs ? 15 : 12 }, titleFont: { size: fs ? 15 : 12 }, footerFont: { size: fs ? 14 : 11 },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtK(ctx.raw)}`,
            footer: items => 'Total: ' + fmtK(items.reduce((s, i) => s + i.raw, 0)),
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Nunito', size: tf } } },
        y: { stacked: true, ticks: { font: { family: 'Nunito', size: tf }, callback: fmtK }, grid: { color: '#f0e8e0' } },
      },
    };
  }

  chartConfigs.monthly = {
    type: 'bar',
    data: { labels: months, datasets: barDatasets },
    makeOptions: barOptions,
    plugins: [],
  };

  if (monthlyChart) monthlyChart.destroy();
  const barCtx = document.getElementById('chart-monthly');
  if (barCtx) {
    monthlyChart = new Chart(barCtx, {
      type: chartConfigs.monthly.type,
      data: chartConfigs.monthly.data,
      options: barOptions('bottom'),
      plugins: chartConfigs.monthly.plugins,
    });
  }

  // ── Category donuts ───────────────────────────────────────────────
  function donutDatasets(catMap) {
    const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([c]) => c),
      data:   entries.map(([, v]) => Math.round(v)),
      colors: entries.map(([c]) => CAT_COLORS[c] || '#CCC5B9'),
    };
  }

  // Draws "%" + "₹value" on every slice that is ≥5% of the *visible* total
  // (legend-toggled-off slices are excluded from both the total and labels),
  // and keeps the top-right rupee total in sync on every render/legend toggle.
  function donutLabelPlugin(totalElId) {
    return {
      id: 'donutLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        const ds = chart.data.datasets[0].data;
        const total = visibleTotal(chart);
        if (total <= 0) return;
        meta.data.forEach((arc, i) => {
          if (!chart.getDataVisibility(i)) return;
          const v = ds[i] || 0;
          const pct = (v / total) * 100;
          if (pct < 5) return;
          const ang = (arc.startAngle + arc.endAngle) / 2;
          const r = (arc.innerRadius + arc.outerRadius) / 2;
          const x = arc.x + Math.cos(ang) * r;
          const y = arc.y + Math.sin(ang) * r;
          // Scale the label to the ring thickness so the fullscreen donut gets
          // proportionally larger text than the small dashboard one.
          const fMain = Math.max(11, Math.min(22, arc.outerRadius * 0.14));
          const fSub  = fMain * 0.82;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Dark ink + white halo reads on the light/pastel slice palette far
          // better than the old white-on-light.
          ctx.lineWidth = Math.max(3, fMain * 0.4);
          ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.fillStyle = '#23201d';
          ctx.font = `800 ${fMain}px Nunito, sans-serif`;
          ctx.strokeText(`${pct.toFixed(0)}%`, x, y - fMain * 0.55);
          ctx.fillText(`${pct.toFixed(0)}%`, x, y - fMain * 0.55);
          ctx.font = `700 ${fSub}px Nunito, sans-serif`;
          ctx.strokeText(fmtK(v), x, y + fSub * 0.7);
          ctx.fillText(fmtK(v), x, y + fSub * 0.7);
          ctx.restore();
        });
      },
      afterUpdate(chart) {
        const txt = '₹' + Math.round(visibleTotal(chart)).toLocaleString('en-IN');
        const el = totalElId && document.getElementById(totalElId);
        if (el) el.textContent = txt;
        // The fullscreen chart lives on its own canvas; mirror the total into
        // the overlay header (the dashboard's total element isn't visible there).
        if (chart.canvas && chart.canvas.id === 'chart-fs-canvas') {
          const fe = document.getElementById('chart-fs-total');
          if (fe) fe.textContent = txt;
        }
      },
    };
  }

  function makeDonut(canvasId, configKey, totalElId, existing, catMap, periodStart) {
    const { labels, data, colors } = donutDatasets(catMap);

    function donutOptions(legendPosition, fs) {
      return {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        onClick: (evt, els) => {
          if (!els.length) return;
          const cat = labels[els[0].index];
          window.chartDrillDown?.({ category: realCats(cat), dateFrom: ymd(periodStart), dateTo: ymd(now) });
        },
        plugins: {
          legend: { position: legendPosition, labels: { font: { family: 'Nunito', size: fs ? 16 : 11 }, boxWidth: fs ? 20 : 12, padding: fs ? 16 : 8 } },
          tooltip: {
            bodyFont: { size: fs ? 15 : 12 }, titleFont: { size: fs ? 15 : 12 },
            callbacks: {
              label: ctx => {
                const total = visibleTotal(ctx.chart) || 1;
                return ` ${ctx.label}: ${fmtK(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`;
              },
            },
          },
        },
      };
    }

    chartConfigs[configKey] = {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 1, borderColor: '#fff' }] },
      makeOptions: donutOptions,
      plugins: [donutLabelPlugin(totalElId)],
    };

    if (existing) existing.destroy();
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const chart = new Chart(ctx, {
      type: chartConfigs[configKey].type,
      data: chartConfigs[configKey].data,
      options: donutOptions('right'),
      plugins: chartConfigs[configKey].plugins,
    });
    // afterUpdate fires on creation too, but set the total explicitly in case.
    const el = totalElId && document.getElementById(totalElId);
    if (el) el.textContent = '₹' + Math.round(visibleTotal(chart)).toLocaleString('en-IN');
    return chart;
  }

  catYtdChart = makeDonut('chart-cat-ytd', 'catYtd', 'chart-cat-ytd-total', catYtdChart, catYtd, ytdStart);
  catMtdChart = makeDonut('chart-cat-mtd', 'catMtd', 'chart-cat-mtd-total', catMtdChart, catMtd, mtdStart);
}

// ── Fullscreen expand ────────────────────────────────────────────────
// Portrait → legend at the bottom; landscape → legend on the right.
function fsLegendPos() {
  return window.innerWidth > window.innerHeight ? 'right' : 'bottom';
}

function ensureOverlay() {
  let overlay = document.getElementById('chart-fs-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'chart-fs-overlay';
  overlay.className = 'chart-fs-overlay hidden';
  overlay.innerHTML = `
    <button class="chart-fs-close" aria-label="Close">&times;</button>
    <div class="chart-fs-head">
      <div class="chart-fs-title"></div>
      <div class="chart-fs-total" id="chart-fs-total"></div>
    </div>
    <div class="chart-fs-canvas-wrap"><canvas id="chart-fs-canvas"></canvas></div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.chart-fs-close').addEventListener('click', closeFullscreenChart);
  return overlay;
}

function onFsResize() {
  if (!fsChart) return;
  fsChart.options.plugins.legend.position = fsLegendPos();
  fsChart.resize();
  fsChart.update();
}

function expandChart(key, title) {
  const cfg = chartConfigs[key];
  if (!cfg || typeof Chart === 'undefined') return;
  const overlay = ensureOverlay();
  overlay.querySelector('.chart-fs-title').textContent = title || '';
  overlay.querySelector('.chart-fs-total').textContent = '';
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (fsChart) { fsChart.destroy(); fsChart = null; }
  const canvas = document.getElementById('chart-fs-canvas');
  fsChart = new Chart(canvas, {
    type: cfg.type,
    data: structuredClone(cfg.data),
    options: cfg.makeOptions(fsLegendPos(), true),
    plugins: cfg.plugins,
  });
  window.addEventListener('resize', onFsResize);
  window.addEventListener('orientationchange', onFsResize);
}

function closeFullscreenChart() {
  const overlay = document.getElementById('chart-fs-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
  window.removeEventListener('resize', onFsResize);
  window.removeEventListener('orientationchange', onFsResize);
  if (fsChart) { fsChart.destroy(); fsChart = null; }
}

window.expandChart = expandChart;
window.closeFullscreenChart = closeFullscreenChart;
