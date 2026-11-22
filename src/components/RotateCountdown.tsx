import { useEffect, useState } from 'preact/hooks';

interface RotateCountdownProps {
  targetMs: number;
  visible: boolean;
  light: boolean;
  photos: boolean;
}

function calcSecondsLeft(targetMs: number): number {
  if (targetMs <= 0) return 0;
  var remMs = targetMs - Date.now();
  if (remMs <= 0) return 1;
  return Math.max(1, Math.ceil(remMs / 1000));
}

/**
 * Self-contained minimalist auto-rotation countdown pill ("15s", "60s").
 * Ticks its own local state once per second so DashboardShell never re-renders 60x/min.
 */
export function RotateCountdown(props: RotateCountdownProps) {
  var _tickState = useState<number>(0);
  var setTick = _tickState[1];

  useEffect(
    function () {
      if (!props.visible || props.targetMs <= 0) {
        return;
      }

      var timerId: number | null = null;

      function scheduleTick() {
        var remMs = props.targetMs - Date.now();
        if (remMs <= 0) {
          return;
        }
        var secs = Math.max(1, Math.ceil(remMs / 1000));
        var nextBoundaryMs = remMs - (secs - 1) * 1000 + 25;
        var delayMs = nextBoundaryMs < 100 ? 100 : nextBoundaryMs;
        timerId = window.setTimeout(function () {
          setTick(function (n) {
            return n + 1;
          });
          scheduleTick();
        }, delayMs);
      }

      function handleVisibility() {
        if (!document.hidden) {
          if (timerId !== null) {
            window.clearTimeout(timerId);
          }
          setTick(function (n) {
            return n + 1;
          });
          scheduleTick();
        }
      }

      scheduleTick();
      document.addEventListener('visibilitychange', handleVisibility);

      return function () {
        if (timerId !== null) {
          window.clearTimeout(timerId);
        }
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    },
    [props.visible, props.targetMs]
  );

  if (!props.visible || props.targetMs <= 0) {
    return null;
  }

  var secondsLeft = calcSecondsLeft(props.targetMs);
  if (secondsLeft <= 0) {
    return null;
  }

  var cls = props.light
    ? 'rotate-countdown-pill rotate-countdown-light'
    : props.photos
      ? 'rotate-countdown-pill rotate-countdown-photos'
      : 'rotate-countdown-pill';

  return (
    <div class={cls} aria-hidden="true">
      {String(secondsLeft) + 's'}
    </div>
  );
}
