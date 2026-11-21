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
  sessionStart?: number;
  regularStart?: number;
  regularEnd?: number;
  sessionEnd?: number;
  onScrub?: (point: StockPoint | null) => void;
}

export function StockChart(props: StockChartProps) {
  var pts = props.points || [];
  var isPositive = props.isPositive;
  var strokeColor = isPositive ? '#34d399' : '#fb7185';
  var gradId = isPositive ? 'stock-area-up' : 'stock-area-down';
  var ahGradId = isPositive ? 'stock-ah-area-up' : 'stock-ah-area-down';

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

  // Proportional 1D trading-session axis (e.g. 6:30 AM - 1:00 PM PT, extending to 5:00 PM PT with after-hours)
  var sessionStart = props.sessionStart || 0;
  var sessionEnd = props.sessionEnd || 0;
  var regularEnd = props.regularEnd || 0;
  var useProportional1D =
    props.range === '1d' &&
    sessionStart > 0 &&
    sessionEnd > sessionStart &&
    pts[pts.length - 1].t >= sessionStart &&
    pts[0].t <= sessionEnd;
  var sessionSpan = useProportional1D ? sessionEnd - sessionStart : 1;

  function pointX(idx: number): number {
    if (useProportional1D) {
      var ratio = (pts[idx].t - sessionStart) / sessionSpan;
      if (ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      return ratio * vbW;
    }
    return (idx / (pts.length - 1)) * vbW;
  }

  function pointY(val: number): number {
    return vbH - ((val - yMin) / ySpan) * vbH;
  }

  // Detect whether after-hours points exist past regularEnd on 1D
  var hasAfterHours =
    useProportional1D &&
    regularEnd > sessionStart &&
    regularEnd < sessionEnd &&
    pts[pts.length - 1].t > regularEnd;

  var regEndPct = hasAfterHours
    ? ((regularEnd - sessionStart) / sessionSpan) * 100
    : -1;
  var regEndX = hasAfterHours ? (regEndPct / 100) * vbW : -1;

  var regLineParts: string[] = [];
  var ahLineParts: string[] = [];
  var regFirstX = 0;
  var regLastX = 0;
  var ahFirstX = 0;
  var ahLastX = 0;
  var lastX = 0;
  var lastY = 0;

  for (var j = 0; j < pts.length; j++) {
    var px = pointX(j);
    var py = pointY(pts[j].v);
    var isAH = hasAfterHours && pts[j].t > regularEnd;

    if (!isAH) {
      if (regLineParts.length === 0) {
        regFirstX = px;
        regLineParts.push('M ' + px.toFixed(1) + ' ' + py.toFixed(1));
      } else {
        regLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
      }
      regLastX = px;
    } else {
      if (ahLineParts.length === 0) {
        // Connect smoothly from last regular point if present
        if (j > 0 && regLineParts.length > 0) {
          var prevX = pointX(j - 1);
          var prevY = pointY(pts[j - 1].v);
          ahFirstX = prevX;
          ahLineParts.push('M ' + prevX.toFixed(1) + ' ' + prevY.toFixed(1));
          ahLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
        } else {
          ahFirstX = px;
          ahLineParts.push('M ' + px.toFixed(1) + ' ' + py.toFixed(1));
        }
      } else {
        ahLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
      }
      ahLastX = px;
    }

    if (j === pts.length - 1) {
      lastX = px;
      lastY = py;
    }
  }

  var regLinePath = regLineParts.join(' ');
  var regAreaPath =
    regLineParts.length >= 2
      ? regLinePath +
        ' L ' +
        regLastX.toFixed(1) +
        ' ' +
        String(vbH) +
        ' L ' +
        regFirstX.toFixed(1) +
        ' ' +
        String(vbH) +
        ' Z'
      : '';

  var ahLinePath = ahLineParts.join(' ');
  var ahAreaPath =
    ahLineParts.length >= 2
      ? ahLinePath +
        ' L ' +
        ahLastX.toFixed(1) +
        ' ' +
        String(vbH) +
        ' L ' +
        ahFirstX.toFixed(1) +
        ' ' +
        String(vbH) +
        ' Z'
      : '';

  var baseY = hasBaseline ? pointY(props.baseline) : -1;
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

    var idx = 0;
    if (useProportional1D) {
      var targetX = ratio * vbW;
      var bestDist = Infinity;
      for (var k = 0; k < pts.length; k++) {
        var dist = Math.abs(pointX(k) - targetX);
        if (dist < bestDist) {
          bestDist = dist;
          idx = k;
        }
      }
    } else {
      idx = Math.round(ratio * (pts.length - 1));
      if (idx < 0) idx = 0;
      if (idx >= pts.length) idx = pts.length - 1;
    }

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
  var scrubIsAH = false;
  if (scrubPoint && activeIdx !== null) {
    scrubLeftPct = (pointX(activeIdx) / vbW) * 100;
    scrubTopPct = (pointY(scrubPoint.v) / vbH) * 100;
    tooltipLeftPct = scrubLeftPct;
    if (tooltipLeftPct < 14) tooltipLeftPct = 14;
    if (tooltipLeftPct > 86) tooltipLeftPct = 86;
    scrubIsAH = hasAfterHours && scrubPoint.t > regularEnd;
  }

  // 4 evenly spaced X-axis timestamps (proportional session bounds on 1D, data indices on multi-day)
  var xAxisTimestamps: number[];
  if (useProportional1D) {
    xAxisTimestamps = [
      sessionStart,
      Math.round(sessionStart + sessionSpan * 0.33),
      Math.round(sessionStart + sessionSpan * 0.67),
      sessionEnd,
    ];
  } else {
    xAxisTimestamps = [
      pts[0].t,
      pts[Math.floor((pts.length - 1) * 0.33)].t,
      pts[Math.floor((pts.length - 1) * 0.67)].t,
      pts[pts.length - 1].t,
    ];
  }

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
        {/* Subtle shaded after-hours zone on 1D when extended-hours prints exist */}
        {hasAfterHours && regEndPct > 5 && regEndPct < 98 ? (
          <div
            class="stock-ah-zone"
            style={{ left: regEndPct.toFixed(2) + '%' }}
            aria-hidden="true"
          >
            <span class="stock-ah-badge">After Hours</span>
          </div>
        ) : null}

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
            <linearGradient id="stock-ah-area-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#34d399" stop-opacity="0.16" />
              <stop offset="100%" stop-color="#34d399" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="stock-ah-area-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fb7185" stop-opacity="0.16" />
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

          {hasAfterHours && regEndX > 0 && regEndX < vbW ? (
            <line
              x1={regEndX.toFixed(1)}
              y1="0"
              x2={regEndX.toFixed(1)}
              y2={String(vbH)}
              stroke="rgba(203, 213, 225, 0.24)"
              stroke-width="1"
              stroke-dasharray="3 4"
              vector-effect="non-scaling-stroke"
            />
          ) : null}

          {regAreaPath ? <path d={regAreaPath} fill={'url(#' + gradId + ')'} /> : null}
          {regLinePath ? (
            <path
              d={regLinePath}
              fill="none"
              stroke={strokeColor}
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          ) : null}

          {ahAreaPath ? <path d={ahAreaPath} fill={'url(#' + ahGradId + ')'} /> : null}
          {ahLinePath ? (
            <path
              d={ahLinePath}
              fill="none"
              stroke={strokeColor}
              stroke-opacity="0.76"
              stroke-width="2"
              stroke-dasharray="4 3"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          ) : null}
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
                {scrubIsAH ? ' · After Hours' : ''}
              </span>
            </div>
          </div>
        ) : null}

        {/* Dashed baseline reference label */}
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
        {xAxisTimestamps.map(function (ts, idx) {
          return (
            <span class="stock-x-label" key={String(idx) + '-' + String(ts)}>
              {formatChartAxisTime(ts, props.range, props.timeFormat)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
