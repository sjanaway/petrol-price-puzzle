#!/usr/bin/env node
// Collects live UK pump prices, Brent crude and the pound/dollar rate,
// and writes them to site/data/prices.json for the page to read.
// Needs Node 20+ (built-in fetch). No dependencies.
//
// Each source is fetched independently. If one fails, its previous value
// is kept (with its old timestamp) so the page never loses data.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../site/data/prices.json', import.meta.url);
const HEADERS = { 'user-agent': 'Mozilla/5.0 (petrol-price-puzzle; daily price update)' };

// Retailer feeds published under the CMA's open fuel price data scheme.
// Feeds older than MAX_AGE_DAYS are skipped automatically, so stale or
// retired feeds can stay in the list. Motorway-only operators (e.g. Moto)
// are left out because their prices aren't typical.
const FEEDS = [
  { brand: 'Asda', url: 'https://storelocator.asda.com/fuel_prices_data.json' },
  { brand: 'Esso', url: 'https://fuelprices.esso.co.uk/latestdata.json' },
  { brand: 'Motor Fuel Group', url: 'https://fuel.motorfuelgroup.com/fuel_prices_data.json' },
  { brand: 'SGN', url: 'https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json' },
  { brand: 'Rontec', url: 'https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json' },
  { brand: 'Applegreen', url: 'https://applegreenstores.com/fuel-prices/data.json' },
  { brand: 'Shell', url: 'https://www.shell.co.uk/fuel-prices-data.html' },
  { brand: 'Tesco', url: 'https://www.tesco.com/fuel_prices/fuel_prices_data.json' },
  { brand: "Sainsbury's", url: 'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json' },
  { brand: 'BP', url: 'https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json' },
];
const MAX_AGE_DAYS = 4;
const MIN_STATIONS = 300;

// Fuel duty in pence per litre, by start date. Check against GOV.UK when
// budgets change: https://www.gov.uk/guidance/fuel-duty
const DUTY_SCHEDULE = [
  { from: '2022-03-23', rate: 52.95 },
  { from: '2027-01-01', rate: 55.95 },
  { from: '2027-03-01', rate: 57.95 },
];

const today = new Date();
const isoDate = (d) => d.toISOString().slice(0, 10);

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// "07/10/2026 09:45:30" (UK day-first) -> Date
function parseFeedDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
  if (!m) return null;
  const [, dd, mm, yyyy, h = '0', mi = '0', sec = '0'] = m;
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +mi, +sec));
}

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

async function pumpPrices() {
  const seen = new Map(); // site_id -> { petrol, diesel }
  const sources = [];
  for (const feed of FEEDS) {
    try {
      const data = await getJSON(feed.url);
      const updated = parseFeedDate(data.last_updated);
      const ageDays = updated ? (today - updated) / 864e5 : Infinity;
      if (!(ageDays <= MAX_AGE_DAYS)) {
        console.log(`skip ${feed.brand}: last updated ${data.last_updated ?? 'unknown'}`);
        continue;
      }
      let n = 0;
      for (const st of data.stations ?? []) {
        const e10 = Number(st.prices?.E10), b7 = Number(st.prices?.B7);
        const ok = (x) => Number.isFinite(x) && x > 80 && x < 400;
        if (!ok(e10) && !ok(b7)) continue;
        seen.set(st.site_id ?? `${feed.brand}-${n}`, { petrol: ok(e10) ? e10 : null, diesel: ok(b7) ? b7 : null });
        n++;
      }
      sources.push({ brand: feed.brand, stations: n, updated: updated.toISOString() });
      console.log(`ok   ${feed.brand}: ${n} stations, updated ${data.last_updated}`);
    } catch (err) {
      console.log(`fail ${feed.brand}: ${err.message}`);
    }
  }
  const all = [...seen.values()];
  const petrol = all.map((s) => s.petrol).filter((x) => x != null);
  const diesel = all.map((s) => s.diesel).filter((x) => x != null);
  if (petrol.length < MIN_STATIONS) throw new Error(`only ${petrol.length} stations with petrol prices`);
  return {
    petrol: round1(mean(petrol)),
    diesel: round1(mean(diesel)),
    stations: all.length,
    sources,
    asOf: new Date(Math.max(...sources.map((s) => Date.parse(s.updated)))).toISOString(),
  };
}

async function brent() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?range=1y&interval=1d';
  const r = (await getJSON(url)).chart.result[0];
  const closes = r.indicators.quote[0].close;
  const history = r.timestamp
    .map((t, i) => [isoDate(new Date(t * 1000)), closes[i]])
    .filter(([, c]) => Number.isFinite(c))
    .map(([d, c]) => [d, Math.round(c * 100) / 100]);
  return {
    price: Math.round(r.meta.regularMarketPrice * 100) / 100,
    asOf: new Date(r.meta.regularMarketTime * 1000).toISOString(),
    history,
  };
}

async function fx() {
  const j = await getJSON('https://api.frankfurter.dev/v1/latest?base=GBP&symbols=USD');
  return { usdPerGbp: Math.round(j.rates.USD * 10000) / 10000, asOf: j.date };
}

function dutyOn(dateStr) {
  return DUTY_SCHEDULE.filter((d) => d.from <= dateStr).at(-1).rate;
}

let prev = {};
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

const out = { updated: today.toISOString(), duty: dutyOn(isoDate(today)) };
const errors = [];
for (const [key, fn] of [['pump', pumpPrices], ['brent', brent], ['fx', fx]]) {
  try {
    out[key] = await fn();
  } catch (err) {
    errors.push(`${key}: ${err.message}`);
    if (prev[key]) out[key] = prev[key];
  }
}

// One history row per day, kept for two years.
const history = (prev.history ?? []).filter((h) => h.date !== isoDate(today));
if (out.pump && out.brent) {
  history.push({ date: isoDate(today), petrol: out.pump.petrol, diesel: out.pump.diesel, brent: out.brent.price });
}
out.history = history.slice(-730);

if (!out.pump || !out.brent || !out.fx) {
  console.error('Missing data and nothing to fall back on:', errors.join('; '));
  process.exit(1);
}

await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`\npetrol ${out.pump.petrol}p, diesel ${out.pump.diesel}p (${out.pump.stations} stations)`);
console.log(`brent $${out.brent.price}, £1 = $${out.fx.usdPerGbp}, duty ${out.duty}p`);
if (errors.length) console.log('kept previous values for:', errors.join('; '));
