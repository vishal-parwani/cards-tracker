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
  const cursor = new Date(barStart.getFullYear(), barStart.getMonth(), 1);
  while (cursor <= now) {
    months.push(monthLabel(cursor));
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

  function makeDonut(canvasId, existing, catMap) {
    const { labels, data, colors } = donutDatasets(catMap);
    if (existing) existing.destroy();
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 1, borderColor: '#fff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { font: { family: 'Nunito', size: 11 }, boxWidth: 12, padding: 8 } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${fmtK(ctx.raw)} (${((ctx.raw / ctx.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    });
  }

  catYtdChart = makeDonut('chart-cat-ytd', catYtdChart, catYtd);
  catMtdChart = makeDonut('chart-cat-mtd', catMtdChart, catMtd);
}
