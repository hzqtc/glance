import type { TempUnit } from '../types';

interface TopControlsProps {
  animEnabled: boolean;
  units: TempUnit;
  isRefreshing: boolean;
  onToggleAnim: () => void;
  onToggleUnits: () => void;
  onRefresh: () => void;
}

export function TopControls(props: TopControlsProps) {
  return (
    <div class="top-controls" role="toolbar" aria-label="Dashboard controls">
      <button
        type="button"
        class={props.animEnabled ? 'ctrl-btn ctrl-btn-icon ctrl-btn-on' : 'ctrl-btn ctrl-btn-icon ctrl-btn-off'}
        onClick={props.onToggleAnim}
        title={props.animEnabled ? 'Background animation: On (tap for static)' : 'Background animation: Static (tap for animation)'}
        aria-label={props.animEnabled ? 'Background animation on' : 'Background static'}
        aria-pressed={props.animEnabled}
      >
        {props.animEnabled ? (
          /* Animation ON icon: flowing motion waves */
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.1"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <path d="M3 8c2.5-2 5.5-2 8 0s5.5 2 10 0" />
            <path d="M3 14c2.5-2 5.5-2 8 0s5.5 2 10 0" />
            <path d="M5 19.5c2-1.4 4.5-1.4 6.5 0s4.5 1.4 7.5 0" opacity="0.7" />
          </svg>
        ) : (
          /* Static OFF icon: paused / still bars */
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ctrl-svg"
            aria-hidden="true"
          >
            <line x1="8" y1="5" x2="8" y2="19" />
            <line x1="16" y1="5" x2="16" y2="19" />
          </svg>
        )}
      </button>

      <span class="ctrl-sep" aria-hidden="true" />

      <button
        type="button"
        class="ctrl-btn"
        onClick={props.onToggleUnits}
        title="Switch between Fahrenheit and Celsius"
        aria-label={'Temperature unit °' + props.units + ', tap to switch'}
      >
        <span class="ctrl-unit-active">°{props.units}</span>
        <span class="ctrl-unit-slash">/</span>
        <span class="ctrl-unit-alt">{props.units === 'F' ? 'C' : 'F'}</span>
      </button>

      <span class="ctrl-sep" aria-hidden="true" />

      <button
        type="button"
        class="ctrl-btn ctrl-btn-icon"
        onClick={props.onRefresh}
        disabled={props.isRefreshing}
        title="Hard reload & clear cache"
        aria-label="Hard reload and clear cache"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.1"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={props.isRefreshing ? 'ctrl-svg ctrl-spinning' : 'ctrl-svg'}
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </button>
    </div>
  );
}
