import { useEffect, useRef, useState } from 'preact/hooks';

interface PasscodeGateProps {
  misconfigured?: boolean;
  initialError?: string | null;
  onUnlocked: () => void;
}

var PIN_LENGTH = 4;

export function PasscodeGate(props: PasscodeGateProps) {
  var _pinState = useState<string>('');
  var pin = _pinState[0];
  var setPin = _pinState[1];

  var _submittingState = useState<boolean>(false);
  var isSubmitting = _submittingState[0];
  var setIsSubmitting = _submittingState[1];

  var _errorState = useState<string | null>(props.initialError || null);
  var errorMsg = _errorState[0];
  var setErrorMsg = _errorState[1];

  var _shakeState = useState<boolean>(false);
  var isShaking = _shakeState[0];
  var setIsShaking = _shakeState[1];

  var submittingRef = useRef<boolean>(false);
  var pinRef = useRef<string>('');
  submittingRef.current = isSubmitting;
  pinRef.current = pin;

  function triggerShake(msg: string) {
    setErrorMsg(msg);
    setIsShaking(true);
    window.setTimeout(function () {
      setIsShaking(false);
      setPin('');
    }, 420);
  }

  function submitPin(code: string) {
    if (submittingRef.current) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    fetch('/api/auth', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ passcode: code }),
    })
      .then(function (resp) {
        return resp
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body: { authenticated?: boolean; error?: string }) {
            return { ok: resp.ok, status: resp.status, body: body };
          });
      })
      .then(function (res) {
        setIsSubmitting(false);
        if (res.ok && res.body && res.body.authenticated) {
          props.onUnlocked();
          return;
        }
        var msg =
          res.body && res.body.error
            ? String(res.body.error)
            : res.status === 429
              ? 'Too many attempts. Try again later.'
              : 'Incorrect PIN';
        triggerShake(msg);
      })
      .catch(function () {
        setIsSubmitting(false);
        triggerShake('Connection error — try again');
      });
  }

  function handleDigit(d: string) {
    if (props.misconfigured || submittingRef.current) return;
    var cur = pinRef.current;
    if (cur.length >= PIN_LENGTH) return;
    var next = cur + d;
    setPin(next);
    setErrorMsg(null);
    if (next.length === PIN_LENGTH) {
      submitPin(next);
    }
  }

  function handleBackspace() {
    if (props.misconfigured || submittingRef.current) return;
    var cur = pinRef.current;
    if (cur.length === 0) return;
    setPin(cur.slice(0, cur.length - 1));
    setErrorMsg(null);
  }

  function handleClear() {
    if (props.misconfigured || submittingRef.current) return;
    setPin('');
    setErrorMsg(null);
  }

  // Desktop keyboard support (0-9, Backspace, Escape)
  useEffect(
    function () {
      if (props.misconfigured) return;
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          handleDigit(e.key);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          handleBackspace();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleClear();
        }
      }
      window.addEventListener('keydown', handleKeyDown);
      return function () {
        window.removeEventListener('keydown', handleKeyDown);
      };
    },
    [props.misconfigured]
  );

  var rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];

  return (
    <div class="pin-gate">
      <div class="pin-gate-backdrop" aria-hidden="true" />
      <div class="pin-card">
        <div class="pin-lock-icon" aria-hidden="true">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="4" y="11" width="16" height="10" rx="2.5" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>

        <h1 class="pin-title">Glance</h1>

        {props.misconfigured ? (
          <div class="pin-misconfig">
            <p class="pin-sub">Passcode not configured</p>
            <p class="pin-misconfig-hint">
              Set <code>GLANCE_PASSCODE</code> (4-digit PIN) in Vercel Project Settings → Environment Variables and redeploy.
            </p>
          </div>
        ) : (
          <div class="pin-pad-stage">
            <div class="pin-sub">
              {isSubmitting ? 'Verifying…' : 'Enter 4-digit PIN'}
            </div>

            <div
              class={isShaking ? 'pin-dots pin-dots-shake' : 'pin-dots'}
              aria-label={String(pin.length) + ' of 4 digits entered'}
            >
              {[0, 1, 2, 3].map(function (idx) {
                var filled = idx < pin.length;
                return (
                  <span
                    key={idx}
                    class={filled ? 'pin-dot pin-dot-filled' : 'pin-dot'}
                  />
                );
              })}
            </div>

            <div class="pin-error-slot" role="alert">
              {errorMsg || ''}
            </div>

            <div class="pin-keypad">
              {rows.map(function (row, rIdx) {
                return (
                  <div class="pin-key-row" key={rIdx}>
                    {row.map(function (digit) {
                      return (
                        <button
                          type="button"
                          key={digit}
                          class="pin-key"
                          disabled={isSubmitting}
                          onClick={function () {
                            handleDigit(digit);
                          }}
                        >
                          {digit}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              <div class="pin-key-row">
                <button
                  type="button"
                  class="pin-key pin-key-action"
                  disabled={isSubmitting || pin.length === 0}
                  onClick={handleClear}
                  aria-label="Clear PIN"
                >
                  Clear
                </button>
                <button
                  type="button"
                  class="pin-key"
                  disabled={isSubmitting}
                  onClick={function () {
                    handleDigit('0');
                  }}
                >
                  0
                </button>
                <button
                  type="button"
                  class="pin-key pin-key-action"
                  disabled={isSubmitting || pin.length === 0}
                  onClick={handleBackspace}
                  aria-label="Delete last digit"
                >
                  ⌫
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
