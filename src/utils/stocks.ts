import type { StockFormat, StockRange, TimeFormat } from '../types';

export interface RangeOption {
  id: StockRange;
  label: string;
}

export const STOCK_RANGES: RangeOption[] = [
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1Y' },
  { id: '2y', label: '2Y' },
  { id: '5y', label: '5Y' },
  { id: '10y', label: '10Y' },
  { id: 'all', label: 'ALL' },
];

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addCommas(numStr: string): string {
  var parts = numStr.split('.');
  var intPart = parts[0];
  var neg = intPart.charAt(0) === '-';
  if (neg) intPart = intPart.slice(1);
  var out = '';
  for (var i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) {
      out += ',';
    }
    out += intPart.charAt(i);
  }
  return (neg ? '-' : '') + out + (parts.length > 1 ? '.' + parts[1] : '');
}

export function getCurrencySymbol(currency?: string): string {
  var c = (currency || 'USD').trim().toUpperCase();
  if (c === 'EUR') return '€';
  if (c === 'GBP' || c === 'GBp') return '£';
  if (c === 'JPY' || c === 'CNY' || c === 'RMB') return '¥';
  if (c === 'HKD') return 'HK$';
  if (c === 'CAD') return 'C$';
  if (c === 'CHF') return 'CHF ';
  return '$';
}

export function formatHeroValue(
  val: number,
  format: StockFormat,
  currency?: string
): string {
  if (typeof val !== 'number' || isNaN(val)) {
    return '—';
  }
  if (format === 'yield') {
    return val.toFixed(2) + '%';
  }
  var decimals = Math.abs(val) >= 10000 ? 1 : 2;
  var formatted = addCommas(val.toFixed(decimals));
  return getCurrencySymbol(currency) + formatted;
}

export function formatStockValue(val: number, format: StockFormat): string {
  if (typeof val !== 'number' || isNaN(val)) {
    return '—';
  }
  if (format === 'yield') {
    return val.toFixed(2) + '%';
  }
  var decimals = Math.abs(val) >= 10000 ? 1 : 2;
  var formatted = addCommas(val.toFixed(decimals));
  if (format === 'points') {
    return formatted;
  }
  return '$' + formatted;
}

export function formatStockDelta(change: number, format: StockFormat): string {
  if (typeof change !== 'number' || isNaN(change)) {
    return '—';
  }
  var sign = change > 0 ? '+' : change < 0 ? '-' : '';
  var abs = Math.abs(change);
  if (format === 'yield') {
    return sign + abs.toFixed(2);
  }
  var formatted = addCommas(abs.toFixed(2));
  if (format === 'points') {
    return sign + formatted;
  }
  return sign + '$' + formatted;
}

export function formatStockPct(pct: number): string {
  if (typeof pct !== 'number' || isNaN(pct)) {
    return '0.00%';
  }
  var sign = pct > 0 ? '+' : '';
  return sign + pct.toFixed(2) + '%';
}

export function formatMarketCap(cap?: number): string {
  if (typeof cap !== 'number' || isNaN(cap) || cap <= 0) {
    return '—';
  }
  if (cap >= 1e12) {
    var t = cap / 1e12;
    return '$' + (t >= 10 ? t.toFixed(1) : t.toFixed(2)) + 'T';
  }
  if (cap >= 1e9) {
    var b = cap / 1e9;
    return '$' + (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + 'B';
  }
  if (cap >= 1e6) {
    var m = cap / 1e6;
    return '$' + (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + 'M';
  }
  return '$' + addCommas(cap.toFixed(0));
}

export function formatMarketState(state: string): { label: string; isOpen: boolean } {
  var upper = (state || '').toUpperCase();
  if (upper === 'REGULAR') {
    return { label: 'Market Open', isOpen: true };
  }
  if (upper === 'PRE') {
    return { label: 'Pre-Market', isOpen: false };
  }
  if (upper === 'POST' || upper === 'POSTPOST') {
    return { label: 'After Hours', isOpen: false };
  }
  return { label: 'Market Closed', isOpen: false };
}

export function formatExchangeName(exchange: string): string {
  var code = (exchange || '').trim().toUpperCase();
  if (!code) return '';
  if (code === 'NMS' || code === 'NGM' || code === 'NCM' || code === 'NAS' || code === 'NIM') {
    return 'NASDAQ';
  }
  if (code === 'NYQ' || code === 'NYSE') {
    return 'NYSE';
  }
  if (code === 'PCX' || code === 'ARCX') {
    return 'NYSE Arca';
  }
  if (code === 'ASE') {
    return 'AMEX';
  }
  if (code === 'SNP') {
    return 'S&P';
  }
  if (code === 'DJI') {
    return 'Dow Jones';
  }
  if (code === 'NYB') {
    return 'Treasury';
  }
  if (code === 'CCC') {
    return 'Crypto';
  }
  if (code === 'WCB') {
    return 'CBOE';
  }
  if (code === 'CMX') {
    return 'COMEX';
  }
  if (code === 'NYM') {
    return 'NYMEX';
  }
  if (code === 'CBT' || code === 'CME') {
    return 'CME';
  }
  return code;
}

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

export function formatChartAxisTime(
  unixSec: number,
  range: StockRange,
  timeFormat: TimeFormat
): string {
  var d = new Date(unixSec * 1000);
  if (range === '1d') {
    var h = d.getHours();
    var m = d.getMinutes();
    if (timeFormat === '24h') {
      return pad2(h) + ':' + pad2(m);
    }
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    return String(h12 === 0 ? 12 : h12) + ':' + pad2(m) + ' ' + ampm;
  }
  if (range === '1w') {
    var wd = WEEKDAYS_SHORT[d.getDay()];
    return wd + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + String(d.getDate());
  }
  if (range === '1m' || range === 'ytd' || range === '1y') {
    return MONTHS_SHORT[d.getMonth()] + ' ' + String(d.getDate());
  }
  if (range === '2y' || range === '5y') {
    return MONTHS_SHORT[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
  }
  return String(d.getFullYear());
}

export function formatChartTooltipTime(
  unixSec: number,
  range: StockRange,
  timeFormat: TimeFormat
): string {
  var d = new Date(unixSec * 1000);
  var h = d.getHours();
  var m = d.getMinutes();
  var timeStr: string;
  if (timeFormat === '24h') {
    timeStr = pad2(h) + ':' + pad2(m);
  } else {
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    timeStr = String(h12 === 0 ? 12 : h12) + ':' + pad2(m) + ' ' + ampm;
  }

  var monthDay = MONTHS_SHORT[d.getMonth()] + ' ' + String(d.getDate());
  if (range === '1d') {
    return timeStr;
  }
  if (range === '1w' || range === '1m') {
    return monthDay + ', ' + timeStr;
  }
  return monthDay + ', ' + String(d.getFullYear());
}
