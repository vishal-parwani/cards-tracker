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
  'Shopping - Online':   '#F4A261',
  'Shopping - Apparel':  '#F9C784',
  'Shopping - Electronics': '#6CB4EE',
  'Shopping - Home':     '#A8DADC',
  'Shopping - Jewellery':'#E9C46A',
  'Shopping - Software': '#B5D5C5',
  'Travel':              '#2A9D8F',
  'Travel - Hotels':     '#43AA8B',
  'Travel - Air':        '#90E0EF',
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

function fmtK(v) {
  if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L';
  if (v >= 1000)   return '₹' + (v / 1000).toFixed(0) + 'K';
  return '₹' + Math.round(v);
}

function monthLabel(date) {
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
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

  txns.forEach(t => {
    const d   = t.date.toDate();
    const ml  = monthLabel(d);
    const amt = t.amount || 0;
    const card = t.card || 'Unknown';
    const cat  = t.category || 'Miscellaneous';

    if (!monthCardMap[ml]) monthCardMap[ml] = {};
    monthCardMap[ml][card] = (monthCardMap[ml][card] || 0) + amt;

    if (d >= ytdStart) catYtd[cat] = (catYtd[cat] || 0) + amt;
    if (d >= mtdStart) catMtd[cat] = (catMtd[cat] || 0) + amt;
  });

  // ── Stacked bar ───────────────────────────────────────────────────
  const allCards = [...new Set(txns.map(t => t.card).filter(Boolean))];
  let fallbackIdx = 0;
  const barDatasets = allCards.map(card => ({
    label: card,
    data:  months.map(m => Math.round((monthCardMap[m] || {})[card] || 0)),
    backgroundColor: CARD_COLORS[card] || FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length],
  }));

  if (monthlyChart) monthlyChart.destroy();
  const barCtx = document.getElementById('chart-monthly');
  if (barCtx) {
    monthlyChart = new Chart(barCtx, {
      type: 'bar',
      data: { labels: months, datasets: barDatasets },
      options: {
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
          legend: { position: 'bottom', labels: { font: { family: 'Nunito', size: 11 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmtK(ctx.raw)}`,
              footer: items => 'Total: ' + fmtK(items.reduce((s, i) => s + i.raw, 0)),
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Nunito', size: 11 } } },
          y: { stacked: true, ticks: { font: { family: 'Nunito', size: 11 }, callback: fmtK }, grid: { color: '#f0e8e0' } },
        },
      },
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
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.fillStyle = '#fff';
          ctx.font = '800 11px Nunito, sans-serif';
          ctx.strokeText(`${pct.toFixed(0)}%`, x, y - 6);
          ctx.fillText(`${pct.toFixed(0)}%`, x, y - 6);
          ctx.font = '700 10px Nunito, sans-serif';
          ctx.strokeText(fmtK(v), x, y + 6);
          ctx.fillText(fmtK(v), x, y + 6);
          ctx.restore();
        });
      },
      afterUpdate(chart) {
        const el = totalElId && document.getElementById(totalElId);
        if (el) el.textContent = '₹' + Math.round(visibleTotal(chart)).toLocaleString('en-IN');
      },
    };
  }

  function makeDonut(canvasId, totalElId, existing, catMap, periodStart) {
    const { labels, data, colors } = donutDatasets(catMap);
    if (existing) existing.destroy();
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 1, borderColor: '#fff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        onClick: (evt, els) => {
          if (!els.length) return;
          const cat = labels[els[0].index];
          window.chartDrillDown?.({ category: cat, dateFrom: ymd(periodStart), dateTo: ymd(now) });
        },
        plugins: {
          legend: { position: 'right', labels: { font: { family: 'Nunito', size: 11 }, boxWidth: 12, padding: 8 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = visibleTotal(ctx.chart) || 1;
                return ` ${ctx.label}: ${fmtK(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`;
              },
            },
          },
        },
      },
      plugins: [donutLabelPlugin(totalElId)],
    });
    // afterUpdate fires on creation too, but set the total explicitly in case.
    const el = totalElId && document.getElementById(totalElId);
    if (el) el.textContent = '₹' + Math.round(visibleTotal(chart)).toLocaleString('en-IN');
    return chart;
  }

  catYtdChart = makeDonut('chart-cat-ytd', 'chart-cat-ytd-total', catYtdChart, catYtd, ytdStart);
  catMtdChart = makeDonut('chart-cat-mtd', 'chart-cat-mtd-total', catMtdChart, catMtd, mtdStart);
}
