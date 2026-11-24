import { Component } from 'preact';
import type { StockCardMetric, StockQuote, StockRange } from '../types';
import {
  formatMarketCap,
  formatStockDelta,
  formatStockPct,
  formatStockValue,
  isBigMover,
} from '../utils/stocks';
import { StockLogo } from './StockLogo';

interface StockCardProps {
  quote: StockQuote;
  metric: StockCardMetric;
  range: StockRange;
  isSelected: boolean;
  onSelect: (symbol: string) => void;
}

function MiniSparkline(props: { values: number[]; isPositive: boolean }) {
  var vals = props.values || [];
  if (vals.length < 2) {
    return null;
  }
  var minV = vals[0];
  var maxV = vals[0];
  for (var i = 1; i < vals.length; i++) {
    if (vals[i] < minV) minV = vals[i];
    if (vals[i] > maxV) maxV = vals[i];
  }
  var span = maxV - minV;
  var w = 48;
  var h = 18;
  var parts: string[] = [];
  for (var j = 0; j < vals.length; j++) {
    var x = (j / (vals.length - 1)) * w;
    var y = span > 0 ? h - 2 - ((vals[j] - minV) / span) * (h - 4) : h / 2;
    parts.push((j === 0 ? 'M ' : 'L ') + x.toFixed(1) + ' ' + y.toFixed(1));
  }
  return (
    <svg
      width={w}
      height={h}
      viewBox={'0 0 ' + String(w) + ' ' + String(h)}
      fill="none"
      class="stock-sparkline"
      aria-hidden="true"
    >
      <path
        d={parts.join(' ')}
        stroke={props.isPositive ? '#34d399' : '#fb7185'}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export class StockCard extends Component<StockCardProps> {
  shouldComponentUpdate(nextProps: StockCardProps): boolean {
    return (
      nextProps.quote !== this.props.quote ||
      nextProps.metric !== this.props.metric ||
      nextProps.range !== this.props.range ||
      nextProps.isSelected !== this.props.isSelected
    );
  }

  render() {
    var self = this;
    var props = this.props;
    var q = props.quote;
    var isPositive = q.change >= 0;
    var bigMover = !q.unavailable && isBigMover(q.changePct, props.range);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // Read the latest onSelect: shouldComponentUpdate skips re-renders when only it changes
        self.props.onSelect(q.symbol);
      }
    }

    var cardClass = 'stock-card';
    if (bigMover) {
      cardClass += isPositive ? ' stock-card-mover-up' : ' stock-card-mover-down';
    }
    if (props.isSelected) {
      cardClass += ' stock-card-selected';
    }

    return (
      <div
        role="button"
        tabIndex={0}
        class={cardClass}
        onClick={function () {
          self.props.onSelect(q.symbol);
        }}
        onKeyDown={handleKeyDown}
        aria-pressed={props.isSelected}
      >
        <div class="stock-card-top">
          <div class="stock-card-symbol-row">
            <StockLogo symbol={q.symbol} label={q.label} size="card" />
            <span class="stock-card-label">{q.label}</span>
          </div>
          {!q.unavailable ? (
            props.metric === 'mcap' ? (
              <span class="stock-pct-badge stock-pct-neutral">
                {formatMarketCap(q.marketCap)}
              </span>
            ) : (
              <span
                class={
                  isPositive
                    ? 'stock-pct-badge stock-pct-up'
                    : 'stock-pct-badge stock-pct-down'
                }
              >
                {props.metric === 'abs'
                  ? formatStockDelta(q.change, q.format)
                  : formatStockPct(q.changePct)}
              </span>
            )
          ) : null}
        </div>

        <div class="stock-card-name">{q.name}</div>

        <div class="stock-card-bottom">
          <span class="stock-card-price">
            {q.unavailable ? '—' : formatStockValue(q.price, q.format)}
          </span>
          {!q.unavailable ? (
            <MiniSparkline values={q.sparkline} isPositive={isPositive} />
          ) : null}
        </div>
      </div>
    );
  }
}
