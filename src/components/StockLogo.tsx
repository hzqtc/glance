interface StockLogoProps {
  symbol: string;
  label?: string;
  size: 'card' | 'hero';
}

interface LogoStyle {
  bg: string;
  fg?: string;
}

function getLogoBadgeStyle(symbol: string): LogoStyle {
  var s = (symbol || '').toUpperCase();
  if (s === 'AAPL') return { bg: 'rgba(248, 250, 252, 0.14)' };
  if (s === 'MSFT') return { bg: 'rgba(255, 255, 255, 0.12)' };
  if (s === 'GOOGL' || s === 'GOOG') return { bg: 'rgba(255, 255, 255, 0.14)' };
  if (s === 'NVDA') return { bg: 'rgba(118, 185, 0, 0.18)' };
  if (s === 'AMZN') return { bg: 'rgba(255, 153, 0, 0.16)' };
  if (s === 'META') return { bg: 'rgba(0, 129, 251, 0.18)' };
  if (s === 'TSLA') return { bg: 'rgba(227, 25, 55, 0.2)' };
  if (s === 'AVGO') return { bg: 'rgba(204, 9, 47, 0.2)' };
  if (s === 'TSM') return { bg: 'rgba(239, 68, 68, 0.18)' };
  if (s === 'AMD') return { bg: 'rgba(248, 250, 252, 0.14)' };
  if (s === 'NFLX') return { bg: 'rgba(229, 9, 20, 0.2)' };
  if (s === 'BTC-USD' || s === 'BTC') return { bg: 'rgba(247, 147, 26, 0.2)' };
  if (s === '^GSPC') return { bg: 'rgba(56, 189, 248, 0.18)' };
  if (s === '^IXIC') return { bg: 'rgba(0, 160, 223, 0.18)' };
  if (s === '^TNX') return { bg: 'rgba(245, 158, 11, 0.18)' };
  return { bg: 'rgba(148, 163, 184, 0.2)', fg: '#e2e8f0' };
}

function renderMark(symbol: string, iconPx: number) {
  var s = (symbol || '').toUpperCase();

  // Apple
  if (s === 'AAPL') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83z"
          fill="#f8fafc"
        />
        <path
          d="M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
          fill="#f8fafc"
        />
      </svg>
    );
  }

  // Microsoft
  if (s === 'MSFT') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="8.4" height="8.4" rx="0.8" fill="#f25022" />
        <rect x="12.6" y="3" width="8.4" height="8.4" rx="0.8" fill="#7fba00" />
        <rect x="3" y="12.6" width="8.4" height="8.4" rx="0.8" fill="#00a4ef" />
        <rect x="12.6" y="12.6" width="8.4" height="8.4" rx="0.8" fill="#ffb900" />
      </svg>
    );
  }

  // Alphabet / Google
  if (s === 'GOOGL' || s === 'GOOG') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21.8 12.23c0-.72-.06-1.41-.18-2.08H12v3.93h5.5a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.04-4.4 3.04-7.49z"
          fill="#4285f4"
        />
        <path
          d="M12 22c2.76 0 5.07-.91 6.76-2.48l-3.3-2.56c-.91.61-2.08.97-3.46.97-2.66 0-4.92-1.8-5.72-4.22H2.87v2.64A10 10 0 0 0 12 22z"
          fill="#34a853"
        />
        <path
          d="M6.28 13.71a5.98 5.98 0 0 1 0-3.42V7.65H2.87a10 10 0 0 0 0 8.7l3.41-2.64z"
          fill="#fbbc05"
        />
        <path
          d="M12 6.07c1.5 0 2.85.52 3.91 1.53l2.93-2.93C17.06 3.02 14.75 2 12 2a10 10 0 0 0-9.13 5.65l3.41 2.64c.8-2.42 3.06-4.22 5.72-4.22z"
          fill="#ea4335"
        />
      </svg>
    );
  }

  // NVIDIA
  if (s === 'NVDA') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3.2 12.1C5.4 7.7 9.9 5.7 14.5 6.4c3.4.5 5.8 2.9 6.4 5.7-2 4.3-6.3 6.3-10.7 5.7-2.8-.4-5-2.1-5.8-4.4"
          stroke="#76b900"
          stroke-width="2.1"
          stroke-linecap="round"
        />
        <path
          d="M6.8 12.1c1.5-2.6 4.2-3.6 6.9-3.1 2 .4 3.4 1.6 3.9 3.1-1.5 2.5-4.1 3.5-6.5 3-1.5-.3-2.5-1.3-2.5-2.5 0-1.2 1.2-2 2.9-1.8 1.3.2 2.3.9 2.7 1.8"
          stroke="#a3e635"
          stroke-width="1.9"
          stroke-linecap="round"
        />
      </svg>
    );
  }

  // Amazon
  if (s === 'AMZN') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M14.7 13.8c-.2-.4-.3-.9-.3-1.5V8.9c0-1.9-1.2-3.1-3.4-3.1-1.6 0-3 .6-3.7 1.7l1.5 1.1c.4-.7 1.1-1 2-1 1 0 1.6.5 1.6 1.4v.4h-.8c-2.6 0-4.2 1-4.2 2.7 0 1.5 1.1 2.4 2.7 2.4 1.2 0 2.1-.5 2.7-1.3.1.4.2.7.4 1l1.5-.4zm-2.3-2.4c0 1-.8 1.6-1.8 1.6-.7 0-1.2-.4-1.2-1 0-.8.7-1.2 2.1-1.2h.9v.6z"
          fill="#f8fafc"
        />
        <path
          d="M4.6 16.5c4.2 2.7 9.8 2.8 14.3.2"
          stroke="#ff9900"
          stroke-width="2"
          stroke-linecap="round"
        />
        <path
          d="M17.2 15.8l2.5.4-.9 2.4"
          stroke="#ff9900"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }

  // Meta
  if (s === 'META') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7.2 7.5C4.5 7.5 3 9.8 3 12.8c0 2.4 1.4 3.9 3.4 3.9 2.4 0 3.9-2.4 5.6-5.3 1.7-2.9 3.1-3.9 4.8-3.9 2.7 0 4.2 2.3 4.2 5.3 0 2.4-1.4 3.9-3.4 3.9-2.4 0-3.9-2.4-5.6-5.3-1.7-2.9-3.1-3.9-4.8-3.9z"
          stroke="#1d9bf0"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }

  // Tesla
  if (s === 'TSLA') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3.4 6.5c4.3-1.5 12.9-1.5 17.2 0l-.7 1.3c-3.8-1.2-12-1.2-15.8 0l-.7-1.3z"
          fill="#ef4444"
        />
        <path
          d="M4.8 9.1c3.2-1.1 5.7-1.1 7.2.7 1.5-1.8 4-1.8 7.2-.7l-.8 1.4c-1.9-.6-3.6-.5-4.5.3L12 20.6l-1.9-9.8c-.9-.8-2.6-.9-4.5-.3l-.8-1.4z"
          fill="#ef4444"
        />
      </svg>
    );
  }

  // Broadcom (AVGO) — signature crimson pulse wave in circle
  if (s === 'AVGO') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.8" stroke="#f43f5e" stroke-width="2" />
        <path
          d="M5.2 12.8h2.9l1.8-4.5 2.5 7.4 2.1-4.8 1.4 1.9h2.9"
          stroke="#fda4af"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }

  // TSMC (TSM) — iconic semiconductor wafer grid
  if (s === 'TSM') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" stroke="#f87171" stroke-width="1.9" />
        <line x1="8.5" y1="4.4" x2="8.5" y2="19.6" stroke="#f87171" stroke-width="1.3" opacity="0.75" />
        <line x1="12" y1="3.6" x2="12" y2="20.4" stroke="#f87171" stroke-width="1.3" opacity="0.75" />
        <line x1="15.5" y1="4.4" x2="15.5" y2="19.6" stroke="#f87171" stroke-width="1.3" opacity="0.75" />
        <line x1="4.4" y1="9" x2="19.6" y2="9" stroke="#f87171" stroke-width="1.3" opacity="0.75" />
        <line x1="3.8" y1="12.5" x2="20.2" y2="12.5" stroke="#f87171" stroke-width="1.3" opacity="0.75" />
        <line x1="5.2" y1="16" x2="18.8" y2="16" stroke="#f87171" stroke-width="1.3" opacity="0.75" />
      </svg>
    );
  }

  // AMD — iconic geometric corner arrow emblem
  if (s === 'AMD') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 5h14v14l-4.2-4.2V9.2H9.2L5 5z" fill="#f8fafc" />
        <path d="M5 19v-5.8l4.2-4.2v5.8h5.8L10.8 19H5z" fill="#cbd5e1" />
      </svg>
    );
  }

  // Netflix (NFLX) — iconic crimson N ribbon
  if (s === 'NFLX') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6.5 4h3.2v16H6.5V4z" fill="#b91c1c" />
        <path d="M14.3 4h3.2v16h-3.2V4z" fill="#b91c1c" />
        <path d="M6.5 4h3.2l7.8 16h-3.2L6.5 4z" fill="#ef4444" />
      </svg>
    );
  }

  // Bitcoin (BTC-USD)
  if (s === 'BTC-USD' || s === 'BTC') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M10.2 3.8v2.4M13.6 3.8v2.4M10.2 17.8v2.4M13.6 17.8v2.4"
          stroke="#f7931a"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <path
          d="M8.2 6.5h5.6c2 0 3.3 1 3.3 2.7 0 1.3-.8 2.2-2 2.5 1.5.3 2.5 1.3 2.5 2.9 0 2-1.5 3.1-3.8 3.1H8.2V6.5z"
          stroke="#f7931a"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <line x1="8.2" y1="11.8" x2="14.2" y2="11.8" stroke="#f7931a" stroke-width="1.9" />
      </svg>
    );
  }

  // S&P 500 Index
  if (s === '^GSPC') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="13.5" width="3.2" height="6.5" rx="1" fill="#38bdf8" opacity="0.6" />
        <rect x="10.4" y="10" width="3.2" height="10" rx="1" fill="#38bdf8" opacity="0.82" />
        <rect x="16.8" y="6.5" width="3.2" height="13.5" rx="1" fill="#38bdf8" />
        <path
          d="M4.5 10.2l5.6-3.6 3.5 1.8 5.8-4.4"
          stroke="#bae6fd"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }

  // NASDAQ Composite
  if (s === '^IXIC') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4.2 17.5L8 6.5h2.5L6.7 17.5H4.2z" fill="#38bdf8" />
        <path d="M9.6 18.8L14.2 5.2h2.6l-4.6 13.6H9.6z" fill="#00a0df" />
        <path d="M15.4 17.5l3.8-11h2.5l-3.8 11h-2.5z" fill="#7dd3fc" />
      </svg>
    );
  }

  // US 10Y Treasury Bond
  if (s === '^TNX') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 4.2L4.2 8.4h15.6L12 4.2z"
          fill="#fbbf24"
        />
        <rect x="6" y="10" width="2.2" height="7" rx="0.6" fill="#f59e0b" />
        <rect x="10.9" y="10" width="2.2" height="7" rx="0.6" fill="#f59e0b" />
        <rect x="15.8" y="10" width="2.2" height="7" rx="0.6" fill="#f59e0b" />
        <rect x="4" y="18.2" width="16" height="2" rx="1" fill="#fbbf24" />
      </svg>
    );
  }

  return null;
}

export function StockLogo(props: StockLogoProps) {
  var isHero = props.size === 'hero';
  var iconPx = isHero ? 24 : 14;
  var style = getLogoBadgeStyle(props.symbol);
  var mark = renderMark(props.symbol, iconPx);

  var fallbackText = (props.label || props.symbol || '?')
    .replace(/^\^/, '')
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      class={isHero ? 'stock-logo stock-logo-hero' : 'stock-logo stock-logo-card'}
      style={{ backgroundColor: style.bg }}
      aria-hidden="true"
    >
      {mark ? (
        mark
      ) : (
        <span
          class={isHero ? 'stock-logo-mono stock-logo-mono-hero' : 'stock-logo-mono'}
          style={style.fg ? { color: style.fg } : undefined}
        >
          {fallbackText}
        </span>
      )}
    </span>
  );
}
