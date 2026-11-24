import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  var extGradId = isPositive ? 'stock-ah-area-up' : 'stock-ah-area-down';

  var _activeIdxState = useState<number | null>(null);
  var activeIdx = _activeIdxState[0];
  var setActiveIdx = _activeIdxState[1];

  var areaRef = useRef<HTMLDivElement | null>(null);
  var activeIdxRef = useRef<number | null>(null);
  var cachedRectRef = useRef<DOMRect | null>(null);

  // Clear scrub state whenever dataset or timeframe changes
  useEffect(
    function () {
      activeIdxRef.current = null;
      cachedRectRef.current = null;
      setActiveIdx(null);
      if (props.onScrub) {
        props.onScrub(null);
      }
    },
    [props.points, props.range]
  );

  var vbW = 800;
  var vbH = 200;
  var sessionStart = props.sessionStart || 0;
  var sessionEnd = props.sessionEnd || 0;
  var regularStart = props.regularStart || 0;
  var regularEnd = props.regularEnd || 0;

  var geom = useMemo(
    function () {
      if (pts.length < 2) {
        return null;
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

      // Proportional 1D trading-session axis (supports Pre-Market, Regular, and After Hours)
      var useProportional1D =
        props.range === '1d' &&
        sessionStart > 0 &&
        sessionEnd > sessionStart &&
        pts[pts.length - 1].t >= sessionStart &&
        pts[0].t <= sessionEnd;
      var sessionSpan = useProportional1D ? sessionEnd - sessionStart : 1;

      // Detect Pre-Market (t < regularStart) and After Hours (t > regularEnd) zones on 1D
      var hasPreMarket =
        useProportional1D &&
        regularStart > sessionStart &&
        regularStart < sessionEnd &&
        pts[0].t < regularStart;
      var hasAfterHours =
        useProportional1D &&
        regularEnd > sessionStart &&
        regularEnd < sessionEnd &&
        pts[pts.length - 1].t > regularEnd;

      var span = maxV - minV;
      var basePad = span > 0 ? span * 0.1 : Math.max(0.5, Math.abs(maxV) * 0.01);
      // Extra top headroom when Pre-Market / After Hours badges are shown so high peaks stay clear of them
      var topPad =
        hasPreMarket || hasAfterHours
          ? span > 0
            ? span * 0.22
            : basePad * 2
          : basePad;
      var yMin = minV - basePad;
      var yMax = maxV + topPad;
      var ySpan = Math.max(0.0001, yMax - yMin);

      function calcX(idx: number): number {
        if (useProportional1D) {
          var ratio = (pts[idx].t - sessionStart) / sessionSpan;
          if (ratio < 0) ratio = 0;
          if (ratio > 1) ratio = 1;
          return ratio * vbW;
        }
        return (idx / (pts.length - 1)) * vbW;
      }

      function calcY(val: number): number {
        return vbH - ((val - yMin) / ySpan) * vbH;
      }

      var regStartPct = hasPreMarket
        ? ((regularStart - sessionStart) / sessionSpan) * 100
        : -1;
      var regStartX = hasPreMarket ? (regStartPct / 100) * vbW : -1;

      var regEndPct = hasAfterHours
        ? ((regularEnd - sessionStart) / sessionSpan) * 100
        : -1;
      var regEndX = hasAfterHours ? (regEndPct / 100) * vbW : -1;

      var pmLineParts: string[] = [];
      var regLineParts: string[] = [];
      var ahLineParts: string[] = [];
      var pmFirstX = 0;
      var pmLastX = 0;
      var regFirstX = 0;
      var regLastX = 0;
      var ahFirstX = 0;
      var ahLastX = 0;
      var lastX = 0;
      var lastY = 0;

      for (var j = 0; j < pts.length; j++) {
        var px = calcX(j);
        var py = calcY(pts[j].v);
        var isPM = hasPreMarket && pts[j].t < regularStart;
        var isAH = hasAfterHours && pts[j].t > regularEnd;

        if (isPM) {
          if (pmLineParts.length === 0) {
            pmFirstX = px;
            pmLineParts.push('M ' + px.toFixed(1) + ' ' + py.toFixed(1));
          } else {
            pmLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
          }
          pmLastX = px;
        } else if (isAH) {
          if (ahLineParts.length === 0) {
            if (j > 0 && regLineParts.length > 0) {
              var prevX = calcX(j - 1);
              var prevY = calcY(pts[j - 1].v);
              if (regEndX > prevX && px > regEndX) {
                var ahFrac = (regEndX - prevX) / (px - prevX);
                var ahSplitY = prevY + (py - prevY) * ahFrac;
                regLineParts.push('L ' + regEndX.toFixed(1) + ' ' + ahSplitY.toFixed(1));
                regLastX = regEndX;
                ahFirstX = regEndX;
                ahLineParts.push('M ' + regEndX.toFixed(1) + ' ' + ahSplitY.toFixed(1));
                ahLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
              } else {
                ahFirstX = prevX;
                ahLineParts.push('M ' + prevX.toFixed(1) + ' ' + prevY.toFixed(1));
                ahLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
              }
            } else {
              ahFirstX = px;
              ahLineParts.push('M ' + px.toFixed(1) + ' ' + py.toFixed(1));
            }
          } else {
            ahLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
          }
          ahLastX = px;
        } else {
          if (regLineParts.length === 0) {
            if (j > 0 && pmLineParts.length > 0) {
              var pmPrevX = calcX(j - 1);
              var pmPrevY = calcY(pts[j - 1].v);
              if (regStartX > pmPrevX && px > regStartX) {
                var pmFrac = (regStartX - pmPrevX) / (px - pmPrevX);
                var pmSplitY = pmPrevY + (py - pmPrevY) * pmFrac;
                pmLineParts.push('L ' + regStartX.toFixed(1) + ' ' + pmSplitY.toFixed(1));
                pmLastX = regStartX;
                regFirstX = regStartX;
                regLineParts.push('M ' + regStartX.toFixed(1) + ' ' + pmSplitY.toFixed(1));
                regLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
              } else if (px === regStartX) {
                pmLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
                pmLastX = px;
                regFirstX = px;
                regLineParts.push('M ' + px.toFixed(1) + ' ' + py.toFixed(1));
              } else {
                regFirstX = pmPrevX;
                regLineParts.push('M ' + pmPrevX.toFixed(1) + ' ' + pmPrevY.toFixed(1));
                regLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
              }
            } else {
              regFirstX = px;
              regLineParts.push('M ' + px.toFixed(1) + ' ' + py.toFixed(1));
            }
          } else {
            regLineParts.push('L ' + px.toFixed(1) + ' ' + py.toFixed(1));
          }
          regLastX = px;
        }

        if (j === pts.length - 1) {
          lastX = px;
          lastY = py;
        }
      }

      var pmLinePath = pmLineParts.join(' ');
      var pmAreaPath =
        pmLineParts.length >= 2
          ? pmLinePath +
            ' L ' +
            pmLastX.toFixed(1) +
            ' ' +
            String(vbH) +
            ' L ' +
            pmFirstX.toFixed(1) +
            ' ' +
            String(vbH) +
            ' Z'
          : '';

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

      var baseY = hasBaseline ? calcY(props.baseline) : -1;
      var basePct = hasBaseline ? (baseY / vbH) * 100 : -1;
      var dotLeftPct = (lastX / vbW) * 100;
      var dotTopPct = (lastY / vbH) * 100;

      var xAxisTimestamps: number[] = useProportional1D
        ? [
            sessionStart,
            Math.round(sessionStart + sessionSpan * 0.33),
            Math.round(sessionStart + sessionSpan * 0.67),
            sessionEnd,
          ]
        : [
            pts[0].t,
            pts[Math.floor((pts.length - 1) * 0.33)].t,
            pts[Math.floor((pts.length - 1) * 0.67)].t,
            pts[pts.length - 1].t,
          ];

      return {
        hasBaseline: hasBaseline,
        useProportional1D: useProportional1D,
        sessionSpan: sessionSpan,
        hasPreMarket: hasPreMarket,
        hasAfterHours: hasAfterHours,
        yMin: yMin,
        ySpan: ySpan,
        regStartPct: regStartPct,
        regStartX: regStartX,
        regEndPct: regEndPct,
        regEndX: regEndX,
        pmLinePath: pmLinePath,
        pmAreaPath: pmAreaPath,
        regLinePath: regLinePath,
        regAreaPath: regAreaPath,
        ahLinePath: ahLinePath,
        ahAreaPath: ahAreaPath,
        baseY: baseY,
        basePct: basePct,
        dotLeftPct: dotLeftPct,
        dotTopPct: dotTopPct,
        xAxisTimestamps: xAxisTimestamps,
      };
    },
    [pts, props.baseline, props.range, sessionStart, regularStart, regularEnd, sessionEnd]
  );

  if (!geom) {
    return (
      <div class="stock-chart-empty">
        {props.isLoading ? 'Loading chart…' : 'No chart data available'}
      </div>
    );
  }

  var hasBaseline = geom.hasBaseline;
  var useProportional1D = geom.useProportional1D;
  var sessionSpan = geom.sessionSpan;
  var hasPreMarket = geom.hasPreMarket;
  var hasAfterHours = geom.hasAfterHours;
  var regStartPct = geom.regStartPct;
  var regStartX = geom.regStartX;
  var regEndPct = geom.regEndPct;
  var regEndX = geom.regEndX;
  var pmLinePath = geom.pmLinePath;
  var pmAreaPath = geom.pmAreaPath;
  var regLinePath = geom.regLinePath;
  var regAreaPath = geom.regAreaPath;
  var ahLinePath = geom.ahLinePath;
  var ahAreaPath = geom.ahAreaPath;
  var baseY = geom.baseY;
  var basePct = geom.basePct;
  var dotLeftPct = geom.dotLeftPct;
  var dotTopPct = geom.dotTopPct;
  var xAxisTimestamps = geom.xAxisTimestamps;

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
    return vbH - ((val - geom!.yMin) / geom!.ySpan) * vbH;
  }

  function updateFromClientX(clientX: number, refreshRect?: boolean) {
    var el = areaRef.current;
    if (!el || pts.length < 2) return;
    if (refreshRect || !cachedRectRef.current) {
      cachedRectRef.current = el.getBoundingClientRect();
    }
    var rect = cachedRectRef.current;
    if (!rect || rect.width <= 0) return;
    var ratio = (clientX - rect.left) / rect.width;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    var idx = 0;
    if (useProportional1D) {
      var targetT = sessionStart + ratio * sessionSpan;
      var lo = 0;
      var hi = pts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (pts[mid].t < targetT) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      if (lo > 0 && Math.abs(pts[lo - 1].t - targetT) <= Math.abs(pts[lo].t - targetT)) {
        idx = lo - 1;
      } else {
        idx = lo;
      }
    } else {
      idx = Math.round(ratio * (pts.length - 1));
      if (idx < 0) idx = 0;
      if (idx >= pts.length) idx = pts.length - 1;
    }

    if (idx === activeIdxRef.current) {
      return;
    }
    activeIdxRef.current = idx;
    setActiveIdx(idx);
    if (props.onScrub) {
      props.onScrub(pts[idx]);
    }
  }

  function clearScrub() {
    cachedRectRef.current = null;
    if (activeIdxRef.current === null) {
      return;
    }
    activeIdxRef.current = null;
    setActiveIdx(null);
    if (props.onScrub) {
      props.onScrub(null);
    }
  }

  function handleMouseMove(e: MouseEvent) {
    updateFromClientX(e.clientX, false);
  }

  function handleTouchStart(e: TouchEvent) {
    if (!e.touches || e.touches.length === 0) return;
    e.stopPropagation();
    updateFromClientX(e.touches[0].clientX, true);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!e.touches || e.touches.length === 0) return;
    e.stopPropagation();
    e.preventDefault();
    updateFromClientX(e.touches[0].clientX, false);
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
  var scrubSessionSuffix = '';
  if (scrubPoint && activeIdx !== null) {
    scrubLeftPct = (pointX(activeIdx) / vbW) * 100;
    scrubTopPct = (pointY(scrubPoint.v) / vbH) * 100;
    tooltipLeftPct = scrubLeftPct;
    if (tooltipLeftPct < 14) tooltipLeftPct = 14;
    if (tooltipLeftPct > 86) tooltipLeftPct = 86;
    if (hasPreMarket && scrubPoint.t < regularStart) {
      scrubSessionSuffix = ' · Pre-Market';
    } else if (hasAfterHours && scrubPoint.t > regularEnd) {
      scrubSessionSuffix = ' · After Hours';
    }
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
        {/* Subtle shaded Pre-Market zone on 1D during pre-market and early morning session */}
        {hasPreMarket && regStartPct > 4 && regStartPct < 96 ? (
          <div
            class="stock-pm-zone"
            style={{ width: regStartPct.toFixed(2) + '%' }}
            aria-hidden="true"
          >
            <span class="stock-pm-badge">Pre-Market</span>
          </div>
        ) : null}

        {/* Subtle shaded After Hours zone on 1D when post-market prints exist */}
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

          {hasPreMarket && regStartX > 0 && regStartX < vbW ? (
            <line
              x1={regStartX.toFixed(1)}
              y1="0"
              x2={regStartX.toFixed(1)}
              y2={String(vbH)}
              stroke="rgba(203, 213, 225, 0.24)"
              stroke-width="1"
              stroke-dasharray="3 4"
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

          {pmAreaPath ? <path d={pmAreaPath} fill={'url(#' + extGradId + ')'} /> : null}
          {pmLinePath ? (
            <path
              d={pmLinePath}
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

          {ahAreaPath ? <path d={ahAreaPath} fill={'url(#' + extGradId + ')'} /> : null}
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
                {scrubSessionSuffix}
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
