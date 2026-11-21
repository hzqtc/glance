import type { StockFormat, StockPoint, StockRange, TimeFormat } from '../types';
import { formatChartAxisTime, formatStockValue } from '../utils/stocks';

interface StockChartProps {
  points: StockPoint[];
  baseline: number;
  format: StockFormat;
  range: StockRange;
  timeFormat: TimeFormat;
  isPositive: boolean;
  isLoading: boolean;
}

export function StockChart(props: StockChartProps) {
  var pts = props.points || [];
  var isPositive = props.isPositive;
  var strokeColor = isPositive ? '#34d399' : '#fb7185';
  var gradId = isPositive ? 'stock-area-up' : 'stock-area-down';

  if (pts.length < 2) {
    return (
      <div class="stock-chart-empty">
        {props.isLoading ? 'Loading chart…' : 'No chart data available'}
      </div>
    );
  }

  var minV = pts[0].v;
  var maxV = pts[0].v;
  for (var i = 1; i < pts.length; i++) {
    if (pts[i].v < minV) minV = pts[i].v;
    if (pts[i].v > maxV) maxV = pts[i].v;
  }

  var hasBaseline = typeof props.baseline === 'number' && props.baseline > 0;
  if (hasBaseline) {
    if (props.baseline < minV) minV = props.baseline;
    if (props.baseline > maxV) maxV = props.baseline;
  }

  var span = maxV - minV;
  var pad = span > 0 ? span * 0.1 : Math.max(0.5, Math.abs(maxV) * 0.01);
  var yMin = minV - pad;
  var yMax = maxV + pad;
  var ySpan = Math.max(0.0001, yMax - yMin);

  var vbW = 800;
  var vbH = 200;

  var lineParts: string[] = [];
  var lastX = 0;
  var lastY = 0;

  for (var j = 0; j < pts.length; j++) {
    var x = (j / (pts.length - 1)) * vbW;
    var y = vbH - ((pts[j].v - yMin) / ySpan) * vbH;
    lineParts.push((j === 0 ? 'M ' : 'L ') + x.toFixed(1) + ' ' + y.toFixed(1));
    if (j === pts.length - 1) {
      lastX = x;
      lastY = y;
    }
  }

  var linePath = lineParts.join(' ');
  var areaPath = linePath + ' L ' + String(vbW) + ' ' + String(vbH) + ' L 0 ' + String(vbH) + ' Z';

  var baseY = hasBaseline ? vbH - ((props.baseline - yMin) / ySpan) * vbH : -1;
  var basePct = hasBaseline ? (baseY / vbH) * 100 : -1;
  var dotLeftPct = (lastX / vbW) * 100;
  var dotTopPct = (lastY / vbH) * 100;

  // 4 evenly spaced X-axis timestamps
  var tickIndices = [
    0,
    Math.floor((pts.length - 1) * 0.33),
    Math.floor((pts.length - 1) * 0.67),
    pts.length - 1,
  ];

  return (
    <div class={props.isLoading ? 'stock-chart-wrap stock-chart-loading' : 'stock-chart-wrap'}>
      <div class="stock-chart-canvas-area">
        <svg
          class="stock-chart-svg"
          viewBox={'0 0 ' + String(vbW) + ' ' + String(vbH)}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="stock-area-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#34d399" stop-opacity="0.34" />
              <stop offset="85%" stop-color="#34d399" stop-opacity="0.04" />
              <stop offset="100%" stop-color="#34d399" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="stock-area-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fb7185" stop-opacity="0.34" />
              <stop offset="85%" stop-color="#fb7185" stop-opacity="0.04" />
              <stop offset="100%" stop-color="#fb7185" stop-opacity="0" />
            </linearGradient>
          </defs>

          {hasBaseline && baseY >= 0 && baseY <= vbH ? (
            <line
              x1="0"
              y1={baseY.toFixed(1)}
              x2={String(vbW)}
              y2={baseY.toFixed(1)}
              stroke="rgba(203, 213, 225, 0.28)"
              stroke-width="1"
              stroke-dasharray="5 5"
              vector-effect="non-scaling-stroke"
            />
          ) : null}

          <path d={areaPath} fill={'url(#' + gradId + ')'} />
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        {/* Crisp non-distorted latest price dot */}
        <span
          class={isPositive ? 'stock-end-dot stock-end-dot-up' : 'stock-end-dot stock-end-dot-down'}
          style={{
            left: dotLeftPct.toFixed(2) + '%',
            top: dotTopPct.toFixed(2) + '%',
          }}
        />

        {/* Crisp Y-axis bounds */}
        <span class="stock-y-label stock-y-high">
          {formatStockValue(maxV, props.format)}
        </span>
        <span class="stock-y-label stock-y-low">
          {formatStockValue(minV, props.format)}
        </span>
        {hasBaseline && basePct > 14 && basePct < 86 ? (
          <span
            class="stock-y-label stock-y-base"
            style={{ top: basePct.toFixed(1) + '%' }}
          >
            {props.range === '1d' ? 'Prev ' : 'Open '}
            {formatStockValue(props.baseline, props.format)}
          </span>
        ) : null}
      </div>

      <div class="stock-x-axis">
        {tickIndices.map(function (idx, i) {
          return (
            <span class="stock-x-label" key={String(i) + '-' + String(pts[idx].t)}>
              {formatChartAxisTime(pts[idx].t, props.range, props.timeFormat)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
