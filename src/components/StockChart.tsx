import { useEffect, useRef, useState } from 'preact/hooks';
import type { StockFormat, StockPoint, StockRange, TimeFormat } from '../types';
import {
  formatChartAxisTime,
  formatChartTooltipTime,
  formatStockValue,
} from '../utils/stocks';

interface StockChartProps {
  points: StockPoint[];
  baseline: number;
  format: StockFormat;
  range: StockRange;
  timeFormat: TimeFormat;
  isPositive: boolean;
  isLoading: boolean;
  onScrub?: (point: StockPoint | null) => void;
}

export function StockChart(props: StockChartProps) {
  var pts = props.points || [];
  var isPositive = props.isPositive;
  var strokeColor = isPositive ? '#34d399' : '#fb7185';
  var gradId = isPositive ? 'stock-area-up' : 'stock-area-down';

  var _activeIdxState = useState<number | null>(null);
  var activeIdx = _activeIdxState[0];
  var setActiveIdx = _activeIdxState[1];

  var areaRef = useRef<HTMLDivElement | null>(null);

  // Clear scrub state whenever dataset or timeframe changes
  useEffect(
    function () {
      setActiveIdx(null);
      if (props.onScrub) {
        props.onScrub(null);
      }
    },
    [props.points, props.range]
  );

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
  var areaPath =
    linePath + ' L ' + String(vbW) + ' ' + String(vbH) + ' L 0 ' + String(vbH) + ' Z';

  var baseY = hasBaseline ? vbH - ((props.baseline - yMin) / ySpan) * vbH : -1;
  var basePct = hasBaseline ? (baseY / vbH) * 100 : -1;
  var dotLeftPct = (lastX / vbW) * 100;
  var dotTopPct = (lastY / vbH) * 100;

  function updateFromClientX(clientX: number) {
    var el = areaRef.current;
    if (!el || pts.length < 2) return;
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    var ratio = (clientX - rect.left) / rect.width;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    var idx = Math.round(ratio * (pts.length - 1));
    if (idx < 0) idx = 0;
    if (idx >= pts.length) idx = pts.length - 1;
    setActiveIdx(idx);
    if (props.onScrub) {
      props.onScrub(pts[idx]);
    }
  }

  function clearScrub() {
    setActiveIdx(null);
    if (props.onScrub) {
      props.onScrub(null);
    }
  }

  function handleMouseMove(e: MouseEvent) {
    updateFromClientX(e.clientX);
  }

  function handleTouchStart(e: TouchEvent) {
    if (!e.touches || e.touches.length === 0) return;
    e.stopPropagation();
    updateFromClientX(e.touches[0].clientX);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!e.touches || e.touches.length === 0) return;
    e.stopPropagation();
    e.preventDefault();
    updateFromClientX(e.touches[0].clientX);
  }

  function handleTouchEnd(e: TouchEvent) {
    e.stopPropagation();
    clearScrub();
  }

  var scrubPoint =
    activeIdx !== null && activeIdx >= 0 && activeIdx < pts.length
      ? pts[activeIdx]
      : null;
  var scrubLeftPct = 0;
  var scrubTopPct = 0;
  var tooltipLeftPct = 50;
  if (scrubPoint && activeIdx !== null) {
    scrubLeftPct = (activeIdx / (pts.length - 1)) * 100;
    var scrubY = vbH - ((scrubPoint.v - yMin) / ySpan) * vbH;
    scrubTopPct = (scrubY / vbH) * 100;
    tooltipLeftPct = scrubLeftPct;
    if (tooltipLeftPct < 13) tooltipLeftPct = 13;
    if (tooltipLeftPct > 87) tooltipLeftPct = 87;
  }

  // 4 evenly spaced X-axis timestamps
  var tickIndices = [
    0,
    Math.floor((pts.length - 1) * 0.33),
    Math.floor((pts.length - 1) * 0.67),
    pts.length - 1,
  ];

  return (
    <div class={props.isLoading ? 'stock-chart-wrap stock-chart-loading' : 'stock-chart-wrap'}>
      <div
        ref={areaRef}
        class="stock-chart-canvas-area"
        onMouseMove={handleMouseMove}
        onMouseLeave={clearScrub}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
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

        {/* Resting latest price dot (hidden while actively scrubbing) */}
        {!scrubPoint ? (
          <span
            class={
              isPositive ? 'stock-end-dot stock-end-dot-up' : 'stock-end-dot stock-end-dot-down'
            }
            style={{
              left: dotLeftPct.toFixed(2) + '%',
              top: dotTopPct.toFixed(2) + '%',
            }}
          />
        ) : null}

        {/* Interactive crosshair, active dot, and exact price tooltip */}
        {scrubPoint ? (
          <div class="stock-scrub-layer" aria-hidden="true">
            <div
              class="stock-crosshair"
              style={{ left: scrubLeftPct.toFixed(2) + '%' }}
            />
            <span
              class={
                isPositive
                  ? 'stock-scrub-dot stock-end-dot-up'
                  : 'stock-scrub-dot stock-end-dot-down'
              }
              style={{
                left: scrubLeftPct.toFixed(2) + '%',
                top: scrubTopPct.toFixed(2) + '%',
              }}
            />
            <div
              class="stock-tooltip"
              style={{ left: tooltipLeftPct.toFixed(2) + '%' }}
            >
              <span class="stock-tooltip-price">
                {formatStockValue(scrubPoint.v, props.format)}
              </span>
              <span class="stock-tooltip-time">
                {formatChartTooltipTime(scrubPoint.t, props.range, props.timeFormat)}
              </span>
            </div>
          </div>
        ) : null}

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
