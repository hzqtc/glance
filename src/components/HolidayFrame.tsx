import type { ComponentChildren } from 'preact';
import type { ActiveHolidayTheme, HolidayThemeId } from '../utils/holidays';

// Static inline-SVG ornaments. `corner` is drawn in a 160x160 box anchored at
// the top-left corner and mirrored for the top-right. `accent` is drawn in a
// 140x140 box anchored at the bottom-right (bottom-left holds the photo meta).

type Kids = ComponentChildren;

function tr(x: number, y: number, rot?: number, s?: number): string {
  return 'translate(' + x + ' ' + y + ') rotate(' + (rot || 0) + ') scale(' + (s || 1) + ')';
}

function starPoints(cx: number, cy: number, r: number): string {
  var pts: string[] = [];
  for (var i = 0; i < 10; i++) {
    var rad = i % 2 === 0 ? r : r * 0.42;
    var a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push((cx + rad * Math.cos(a)).toFixed(1) + ',' + (cy + rad * Math.sin(a)).toFixed(1));
  }
  return pts.join(' ');
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Star(p: { x: number; y: number; r: number; fill: string; o?: number }) {
  return <polygon points={starPoints(p.x, p.y, p.r)} fill={p.fill} opacity={p.o || 1} />;
}

function Dot(p: { x: number; y: number; r: number; fill: string; o?: number }) {
  return <circle cx={p.x} cy={p.y} r={p.r} fill={p.fill} opacity={p.o || 1} />;
}

/** Cute face: two eyes, a smile and rosy cheeks, centered at (x, y) */
function Face(p: { x: number; y: number; s: number; ink?: string; blush?: boolean }) {
  var ink = p.ink || '#2b1a12';
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <circle cx="-4" cy="0" r="1.6" fill={ink} />
      <circle cx="4" cy="0" r="1.6" fill={ink} />
      <path d="M-2.6 2.6 Q0 5 2.6 2.6" stroke={ink} stroke-width="1.2" fill="none" stroke-linecap="round" />
      {p.blush === false ? null : <circle cx="-6.6" cy="2.8" r="1.7" fill="#ff7b9c" opacity="0.6" />}
      {p.blush === false ? null : <circle cx="6.6" cy="2.8" r="1.7" fill="#ff7b9c" opacity="0.6" />}
    </g>
  );
}

function Confetti(p: { x: number; y: number; rot: number; fill: string }) {
  return <rect x={p.x - 3} y={p.y - 1.5} width="6" height="3" rx="1" fill={p.fill} transform={'rotate(' + p.rot + ' ' + p.x + ' ' + p.y + ')'} />;
}

function Leaf(p: { x: number; y: number; rot: number; len: number; fill: string; vein?: string }) {
  var l = p.len;
  var w = l * 0.32;
  return (
    <g transform={tr(p.x, p.y, p.rot)}>
      <path d={'M0 0 C' + l * 0.25 + ' ' + -w + ' ' + l * 0.75 + ' ' + -w + ' ' + l + ' 0 C' + l * 0.75 + ' ' + w + ' ' + l * 0.25 + ' ' + w + ' 0 0Z'} fill={p.fill} />
      <path d={'M2 0 L' + (l - 4) + ' 0'} stroke={p.vein || 'rgba(0,0,0,0.25)'} stroke-width="1.2" />
    </g>
  );
}

function Heart(p: { x: number; y: number; s: number; fill: string; rot?: number; o?: number }) {
  return (
    <path
      transform={tr(p.x, p.y, p.rot, p.s / 20)}
      d="M0 6 C0 -2 -12 -4 -12 4 C-12 10 -4 14 0 19 C4 14 12 10 12 4 C12 -4 0 -2 0 6Z"
      fill={p.fill}
      opacity={p.o || 1}
    />
  );
}

function Snowflake(p: { x: number; y: number; r: number; o?: number }) {
  var arms: Kids[] = [];
  for (var i = 0; i < 6; i++) {
    arms.push(
      <g key={i} transform={'rotate(' + i * 60 + ')'}>
        <line x1="0" y1="0" x2="0" y2={-p.r} />
        <line x1="0" y1={-p.r * 0.6} x2={p.r * 0.25} y2={-p.r * 0.85} />
        <line x1="0" y1={-p.r * 0.6} x2={-p.r * 0.25} y2={-p.r * 0.85} />
      </g>
    );
  }
  return (
    <g transform={tr(p.x, p.y)} stroke="#f8fbff" stroke-width="1.6" stroke-linecap="round" opacity={p.o || 0.9}>
      {arms}
    </g>
  );
}

function Burst(p: { x: number; y: number; r: number; color: string }) {
  var rays: Kids[] = [];
  for (var i = 0; i < 12; i++) {
    var a = (Math.PI / 6) * i;
    rays.push(<line key={i} x1={p.x + Math.cos(a) * p.r * 0.35} y1={p.y + Math.sin(a) * p.r * 0.35} x2={p.x + Math.cos(a) * p.r} y2={p.y + Math.sin(a) * p.r} />);
    rays.push(<circle key={'d' + i} cx={p.x + Math.cos(a) * p.r * 1.18} cy={p.y + Math.sin(a) * p.r * 1.18} r={1.6} fill={p.color} stroke="none" />);
  }
  return (
    <g stroke={p.color} stroke-width="2" stroke-linecap="round">
      {rays}
    </g>
  );
}

function Cloud(p: { x: number; y: number; s: number; color: string }) {
  return (
    <path
      transform={tr(p.x, p.y, 0, p.s)}
      d="M-20 4 C-20 -2 -14 -4 -11 -2 C-10 -8 -2 -10 2 -5 C5 -9 13 -8 13 -2 C18 -3 21 3 17 6 Z M-6 0 C-4 -3 0 -3 1 0 M4 -2 C6 -4 9 -3 9 0"
      fill="none"
      stroke={p.color}
      stroke-width="2"
      stroke-linecap="round"
    />
  );
}

function Waves(p: { y: number; w: number; color: string; o?: number }) {
  var d = 'M0 ' + p.y;
  for (var x = 0; x < p.w; x += 24) {
    d += ' q6 -8 12 0 t12 0';
  }
  return <path d={d} stroke={p.color} stroke-width="2.4" fill="none" opacity={p.o || 1} stroke-linecap="round" />;
}

/** Hanging string from the top edge down to (x, y) */
function Hang(p: { x: number; y: number; color?: string }) {
  return <line x1={p.x} y1="0" x2={p.x} y2={p.y} stroke={p.color || '#f5c451'} stroke-width="1.3" />;
}

// ---------------------------------------------------------------------------
// Themed objects
// ---------------------------------------------------------------------------

function Lantern(p: { x: number; y: number; s: number; string: number }) {
  var s = p.s;
  return (
    <g transform={'translate(' + p.x + ' 0)'}>
      <line x1="0" y1="0" x2="0" y2={p.y} stroke="#f5c451" stroke-width="1.4" />
      <g transform={'translate(0 ' + p.y + ') scale(' + s + ')'}>
        <rect x="-8" y="0" width="16" height="5" rx="1.5" fill="#f5c451" />
        <ellipse cx="0" cy="22" rx="20" ry="18" fill="#d9262b" />
        <path d="M-10 6 C-16 16 -16 28 -10 38 M0 4 L0 40 M10 6 C16 16 16 28 10 38" stroke="#a3161b" stroke-width="1.4" fill="none" />
        <rect x="-8" y="38" width="16" height="5" rx="1.5" fill="#f5c451" />
        <line x1="0" y1="43" x2="0" y2={43 + p.string} stroke="#f5c451" stroke-width="1.2" />
        <path d={'M-4 ' + (43 + p.string) + ' L4 ' + (43 + p.string) + ' L2 ' + (58 + p.string) + ' L-2 ' + (58 + p.string) + 'Z'} fill="#d9262b" />
      </g>
    </g>
  );
}

function Firecrackers(p: { x: number; len: number }) {
  var pieces: Kids[] = [];
  for (var i = 0; i < 6; i++) {
    var y = 20 + i * 11;
    var side = i % 2 === 0 ? -1 : 1;
    pieces.push(
      <g key={i} transform={'translate(' + (p.x + side * 5) + ' ' + y + ') rotate(' + side * -28 + ')'}>
        <rect x="-3.5" y="-7" width="7" height="14" rx="1.5" fill="#e0262b" />
        <rect x="-3.5" y="-7" width="7" height="2.5" fill="#f5c451" />
      </g>
    );
  }
  var bottom = 20 + 5 * 11 + 10;
  return (
    <g>
      <line x1={p.x} y1="0" x2={p.x} y2={bottom} stroke="#f5c451" stroke-width="1.4" />
      <path d={'M' + (p.x - 6) + ' 10 L' + p.x + ' 4 L' + (p.x + 6) + ' 10 L' + p.x + ' 16Z'} fill="#f5c451" />
      {pieces}
      <Burst x={p.x} y={bottom + 6} r={7} color="#ffb703" />
    </g>
  );
}

function RedEnvelope(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <rect x="-14" y="-19" width="28" height="38" rx="3" fill="#d9262b" />
      <path d="M-14 -16 Q0 -2 14 -16 L14 -19 L-14 -19Z" fill="#b5151b" />
      <circle cx="0" cy="-5" r="6" fill="#f5c451" />
      <text x="0" y="-1.6" text-anchor="middle" font-size="9" font-weight="700" fill="#b5151b" font-family="'Songti SC', 'STSong', serif">福</text>
    </g>
  );
}

function Coin(p: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={p.r} fill="#f5c451" stroke="#c99a2e" stroke-width="1.4" />
      <rect x={p.x - p.r * 0.3} y={p.y - p.r * 0.3} width={p.r * 0.6} height={p.r * 0.6} fill="#c99a2e" />
    </g>
  );
}

function Pumpkin(p: { x: number; y: number; s: number; carved?: boolean }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <path d="M-2 -14 C-2 -20 2 -24 6 -24" stroke="#3f6b2a" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <ellipse cx="-9" cy="0" rx="11" ry="14" fill="#e8731a" />
      <ellipse cx="9" cy="0" rx="11" ry="14" fill="#e8731a" />
      <ellipse cx="0" cy="0" rx="10" ry="15" fill="#f6892a" />
      {p.carved ? (
        <g>
          <path d="M-7 -4 L-3 -4 L-5 -8Z M3 -4 L7 -4 L5 -8Z" fill="#3b1a06" />
          <path d="M-8 4 Q0 11 8 4 Q4 6 2 5 L0 7 L-2 5 Q-4 6 -8 4Z" fill="#3b1a06" />
        </g>
      ) : (
        <g>
          <path d="M-5 -12 Q-8 0 -5 13 M5 -12 Q8 0 5 13" stroke="#d8650f" stroke-width="1.4" fill="none" />
          <path d="M2 -16 Q10 -22 14 -16 Q8 -14 2 -16Z" fill="#5c9e3a" />
        </g>
      )}
    </g>
  );
}

function Bat(p: { x: number; y: number; s: number; rot?: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path
        d="M0 -3 L2 -6 L3 -2 C8 -6 14 -6 18 -2 C14 -1 13 2 12 4 C9 1 6 2 4 4 C2 2 1 2 0 3 C-1 2 -2 2 -4 4 C-6 2 -9 1 -12 4 C-13 2 -14 -1 -18 -2 C-14 -6 -8 -6 -3 -2 L-2 -6Z"
        fill="#1c0f2b"
      />
      <circle cx="-1.2" cy="-1.5" r="0.8" fill="#ffd43b" />
      <circle cx="1.2" cy="-1.5" r="0.8" fill="#ffd43b" />
    </g>
  );
}

function Ghost(p: { x: number; y: number; s: number; rot?: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M-14 12 L-14 -4 C-14 -18 14 -18 14 -4 L14 12 L9 8 L4 12 L0 8 L-4 12 L-9 8Z" fill="#f8f8ff" />
      <ellipse cx="-5" cy="-4" rx="2.2" ry="3" fill="#2b2140" />
      <ellipse cx="5" cy="-4" rx="2.2" ry="3" fill="#2b2140" />
      <ellipse cx="0" cy="3" rx="2.4" ry="3" fill="#2b2140" />
      <circle cx="-9" cy="1" r="1.8" fill="#ff9bb5" opacity="0.6" />
      <circle cx="9" cy="1" r="1.8" fill="#ff9bb5" opacity="0.6" />
    </g>
  );
}

function Spider(p: { x: number; y: number; s: number }) {
  var legs: Kids[] = [];
  for (var i = 0; i < 4; i++) {
    var dy = -4 + i * 3;
    legs.push(<path key={'l' + i} d={'M-3 ' + dy + ' Q-9 ' + (dy - 5) + ' -12 ' + (dy + 3)} />);
    legs.push(<path key={'r' + i} d={'M3 ' + dy + ' Q9 ' + (dy - 5) + ' 12 ' + (dy + 3)} />);
  }
  return (
    <g>
      <line x1={p.x} y1="0" x2={p.x} y2={p.y - 6 * p.s} stroke="#d6d6e0" stroke-width="1" opacity="0.8" />
      <g transform={tr(p.x, p.y, 0, p.s)}>
        <g stroke="#1c0f2b" stroke-width="1.6" fill="none" stroke-linecap="round">
          {legs}
        </g>
        <ellipse cx="0" cy="0" rx="6" ry="7" fill="#1c0f2b" />
        <circle cx="-2.2" cy="-1" r="1.6" fill="#fff" />
        <circle cx="2.2" cy="-1" r="1.6" fill="#fff" />
        <circle cx="-2" cy="-0.6" r="0.8" fill="#1c0f2b" />
        <circle cx="2.4" cy="-0.6" r="0.8" fill="#1c0f2b" />
      </g>
    </g>
  );
}

function Web() {
  return (
    <g stroke="#e4e4ee" stroke-width="1" fill="none" opacity="0.55">
      <path d="M0 0 L58 58 M0 0 L30 64 M0 0 L64 30 M0 0 L8 70 M0 0 L70 8" />
      <path d="M0 22 Q10 18 11 11 Q18 10 22 0" />
      <path d="M0 42 Q14 40 18 30 Q26 26 30 18 Q40 14 42 0" />
      <path d="M0 62 Q20 60 26 46 Q38 42 44 30 Q58 22 62 0" />
    </g>
  );
}

function Bauble(p: { x: number; y: number; r: number; fill: string }) {
  return (
    <g>
      <Hang x={p.x} y={p.y - p.r} />
      <rect x={p.x - 3.5} y={p.y - p.r - 4} width="7" height="5" rx="1" fill="#f5c451" />
      <circle cx={p.x} cy={p.y} r={p.r} fill={p.fill} />
      <path d={'M' + (p.x - p.r) + ' ' + p.y + ' Q' + p.x + ' ' + (p.y + p.r * 0.5) + ' ' + (p.x + p.r) + ' ' + p.y} stroke="#fff" stroke-width="1.4" fill="none" opacity="0.6" />
      <circle cx={p.x - p.r * 0.38} cy={p.y - p.r * 0.38} r={p.r * 0.22} fill="#fff" opacity="0.55" />
    </g>
  );
}

function CandyCane(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)} fill="none" stroke-linecap="round">
      <path d="M0 26 L0 0 A7 7 0 0 1 14 0" stroke="#ffffff" stroke-width="6" />
      <path d="M0 26 L0 0 A7 7 0 0 1 14 0" stroke="#d6213b" stroke-width="6" stroke-dasharray="4 4" />
    </g>
  );
}

function Snowman(p: { x: number; y: number; s: number }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <path d="M-14 4 L-26 -6 M-22 -2 L-26 0 M14 4 L26 -6 M22 -2 L26 0" stroke="#6b4423" stroke-width="2" stroke-linecap="round" />
      <circle cx="0" cy="16" r="16" fill="#ffffff" />
      <circle cx="0" cy="-8" r="12" fill="#ffffff" />
      <rect x="-12" y="1" width="24" height="5" rx="2.5" fill="#d6213b" />
      <rect x="4" y="3" width="5" height="12" rx="2" fill="#d6213b" />
      <circle cx="-4" cy="-10" r="1.6" fill="#2b1a12" />
      <circle cx="4" cy="-10" r="1.6" fill="#2b1a12" />
      <path d="M0 -7 L9 -5 L0 -4.5Z" fill="#f08c00" />
      <path d="M-4 -3 Q0 -1 4 -3" stroke="#2b1a12" stroke-width="1.2" fill="none" stroke-linecap="round" />
      <circle cx="-8" cy="-5" r="1.8" fill="#ff7b9c" opacity="0.6" />
      <circle cx="8" cy="-5" r="1.8" fill="#ff7b9c" opacity="0.6" />
      <rect x="-12" y="-21" width="24" height="3" rx="1" fill="#2b2b33" />
      <rect x="-8" y="-33" width="16" height="13" rx="1.5" fill="#2b2b33" />
      <rect x="-8" y="-24" width="16" height="2.5" fill="#d6213b" />
      <circle cx="0" cy="13" r="1.6" fill="#2b2b33" />
      <circle cx="0" cy="20" r="1.6" fill="#2b2b33" />
    </g>
  );
}

function Gift(p: { x: number; y: number; s: number; box: string; ribbon: string }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <rect x="-16" y="-10" width="32" height="26" rx="2.5" fill={p.box} />
      <rect x="-18" y="-14" width="36" height="7" rx="2" fill={p.box} />
      <rect x="-3" y="-14" width="6" height="30" fill={p.ribbon} />
      <path d="M0 -14 C-12 -26 -14 -14 0 -14 C14 -26 12 -14 0 -14Z" fill="none" stroke={p.ribbon} stroke-width="3" />
    </g>
  );
}

function PartyHat(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M0 -26 L14 12 L-14 12Z" fill="#7048e8" />
      <path d="M-4 -15 L5 -12 M-8 -3 L9 2 M-12 8 L13 12" stroke="#ffd43b" stroke-width="3" />
      <circle cx="0" cy="-27" r="4.5" fill="#ff6b6b" />
      <path d="M-14 12 Q0 17 14 12" stroke="#ffd43b" stroke-width="2.4" fill="none" />
    </g>
  );
}

function Streamer(p: { x: number; y: number; color: string; rot: number }) {
  return (
    <path
      transform={tr(p.x, p.y, p.rot)}
      d="M0 0 C6 -6 10 4 16 -2 C22 -8 26 2 32 -4"
      stroke={p.color}
      stroke-width="2.4"
      fill="none"
      stroke-linecap="round"
    />
  );
}

function ChampagneGlass(p: { x: number; y: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot)}>
      <path d="M-7 -24 L7 -24 L5 -2 Q0 3 -5 -2Z" fill="rgba(255,255,255,0.35)" stroke="#fff" stroke-width="1.4" />
      <path d="M-6.2 -16 L6.2 -16 L5 -2 Q0 3 -5 -2Z" fill="#f5c451" />
      <line x1="0" y1="1" x2="0" y2="16" stroke="#fff" stroke-width="1.8" />
      <path d="M-7 17 L7 17" stroke="#fff" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="-1" cy="-10" r="1.1" fill="#fff8db" />
      <circle cx="2" cy="-6" r="0.9" fill="#fff8db" />
    </g>
  );
}

function Arrow(p: { x1: number; y1: number; x2: number; y2: number }) {
  var a = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
  var deg = (a * 180) / Math.PI;
  return (
    <g>
      <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="#f5c451" stroke-width="2.2" />
      <path transform={tr(p.x2, p.y2, deg)} d="M0 0 L-8 -4.5 L-8 4.5Z" fill="#f5c451" />
      <path transform={tr(p.x1, p.y1, deg)} d="M0 0 L-6 -5 L2 -5Z M0 0 L-6 5 L2 5Z" fill="#ff8fab" />
    </g>
  );
}

function HeartBalloon(p: { x: number; y: number; s: number; fill: string; sway: number }) {
  return (
    <g>
      <path d={'M' + p.x + ' ' + (p.y + p.s * 0.95) + ' q' + p.sway + ' 14 0 28 q' + -p.sway + ' 10 0 20'} stroke="#ffe3ec" stroke-width="1.2" fill="none" />
      <Heart x={p.x} y={p.y} s={p.s} fill={p.fill} />
      <ellipse cx={p.x - p.s * 0.28} cy={p.y + p.s * 0.15} rx={p.s * 0.08} ry={p.s * 0.14} fill="#fff" opacity="0.55" />
    </g>
  );
}

function Shamrock(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M0 2 C2 10 4 16 8 20" stroke="#1f7a3d" stroke-width="2.4" fill="none" stroke-linecap="round" />
      <Heart x={0} y={-9} s={14} fill="#2e9e52" rot={180} />
      <Heart x={-8} y={0} s={14} fill="#28914a" rot={60} />
      <Heart x={8} y={0} s={14} fill="#28914a" rot={-60} />
    </g>
  );
}

function LeprechaunHat(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <ellipse cx="0" cy="10" rx="22" ry="5" fill="#1f7a3d" />
      <path d="M-13 10 L-10 -16 L10 -16 L13 10Z" fill="#2e9e52" />
      <rect x="-11.4" y="1" width="22.8" height="5" fill="#1c1c1c" />
      <rect x="-4" y="0" width="8" height="7" fill="none" stroke="#f5c451" stroke-width="1.8" />
    </g>
  );
}

function PotOfGold(p: { x: number; y: number; s: number }) {
  var arcs = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa'];
  var rainbow: Kids[] = [];
  for (var i = 0; i < arcs.length; i++) {
    var r = 40 - i * 4;
    rainbow.push(<path key={i} d={'M' + -r + ' 0 A' + r + ' ' + r + ' 0 0 1 ' + r + ' 0'} stroke={arcs[i]} stroke-width="4" fill="none" transform="translate(-22 -2)" />);
  }
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      {rainbow}
      <Cloud x={-58} y={-2} s={0.9} color="#ffffff" />
      <Coin x={-6} y={-6} r={5} />
      <Coin x={4} y={-9} r={5} />
      <Coin x={12} y={-5} r={5} />
      <Coin x={-1} y={-12} r={4.5} />
      <ellipse cx="2" cy="-2" rx="19" ry="5" fill="#2b2b33" />
      <path d="M-16 -2 Q-20 20 2 22 Q24 20 20 -2Z" fill="#1c1c1c" />
      <circle cx="-17" cy="8" r="3" fill="none" stroke="#2b2b33" stroke-width="2" />
      <circle cx="21" cy="8" r="3" fill="none" stroke="#2b2b33" stroke-width="2" />
    </g>
  );
}

function Egg(p: { x: number; y: number; s: number; rot: number; fill: string; band: string; face?: boolean }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M0 -16 C9 -16 13 2 13 7 C13 14 7 18 0 18 C-7 18 -13 14 -13 7 C-13 2 -9 -16 0 -16Z" fill={p.fill} />
      <path d="M-12.6 3 Q-6 -1 0 3 Q6 7 12.6 3 L12.9 8 Q6 12 0 8 Q-6 4 -12.9 8Z" fill={p.band} />
      {p.face ? <Face x={0} y={-5} s={0.75} /> : <circle cx="-5" cy="-6" r="1.8" fill="#fff" opacity="0.8" />}
    </g>
  );
}

function Bunny(p: { x: number; y: number; s: number }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <ellipse cx="-6" cy="-26" rx="4.5" ry="13" fill="#ffffff" transform="rotate(-12 -6 -26)" />
      <ellipse cx="6" cy="-26" rx="4.5" ry="13" fill="#ffffff" transform="rotate(12 6 -26)" />
      <ellipse cx="-6" cy="-26" rx="2" ry="9" fill="#ffc9de" transform="rotate(-12 -6 -26)" />
      <ellipse cx="6" cy="-26" rx="2" ry="9" fill="#ffc9de" transform="rotate(12 6 -26)" />
      <ellipse cx="0" cy="12" rx="17" ry="15" fill="#ffffff" />
      <circle cx="0" cy="-6" r="12" fill="#ffffff" />
      <Face x={0} y={-6} s={0.85} />
      <path d="M-1.5 -4 L1.5 -4 L0 -2.5Z" fill="#ff8fab" />
      <ellipse cx="-8" cy="25" rx="6" ry="3.5" fill="#f1f3f5" />
      <ellipse cx="8" cy="25" rx="6" ry="3.5" fill="#f1f3f5" />
    </g>
  );
}

function Flower(p: { x: number; y: number; r: number; petal: string; center: string }) {
  var petals: Kids[] = [];
  for (var i = 0; i < 5; i++) {
    var a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    petals.push(<circle key={i} cx={p.x + Math.cos(a) * p.r * 0.62} cy={p.y + Math.sin(a) * p.r * 0.62} r={p.r * 0.5} fill={p.petal} />);
  }
  return (
    <g>
      {petals}
      <circle cx={p.x} cy={p.y} r={p.r * 0.32} fill={p.center} />
    </g>
  );
}

function Tulip(p: { x: number; y: number; s: number; rot: number; fill: string }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M0 0 Q2 18 0 34" stroke="#5c9e6a" stroke-width="2.4" fill="none" />
      <path d="M0 24 Q-10 18 -12 8 Q-4 12 0 22" fill="#5c9e6a" />
      <path d="M-8 -14 L-4 -8 L0 -15 L4 -8 L8 -14 Q10 0 0 2 Q-10 0 -8 -14Z" fill={p.fill} />
    </g>
  );
}

function Mustache(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <path
      transform={tr(p.x, p.y, p.rot, p.s)}
      d="M0 -2 C-4 -6 -10 -6 -14 -1 C-17 2 -21 2 -23 -2 C-22 6 -14 8 -8 4 C-4 2 -2 2 0 1 C2 2 4 2 8 4 C14 8 22 6 23 -2 C21 2 17 2 14 -1 C10 -6 4 -6 0 -2Z"
      fill="#4a2e1b"
    />
  );
}

function Tie(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M-6 -18 L6 -18 L4 -12 L-4 -12Z" fill="#1e3a6e" />
      <path d="M-4 -12 L4 -12 L9 12 L0 20 L-9 12Z" fill="#2f5aa8" />
      <path d="M-6 -4 L6 4 M-7 6 L8 14" stroke="#f2c14e" stroke-width="2" />
    </g>
  );
}

function Mug(p: { x: number; y: number; s: number }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <path d="M-6 -24 Q-10 -30 -6 -36 M2 -24 Q-2 -30 2 -36" stroke="#e9ecef" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.85" />
      <path d="M14 -8 C24 -8 24 10 14 10" stroke="#f2c14e" stroke-width="4" fill="none" />
      <rect x="-16" y="-18" width="30" height="34" rx="4" fill="#f2c14e" />
      <rect x="-16" y="-18" width="30" height="5" rx="2" fill="#d9a12f" />
      <text x="-1" y="6" text-anchor="middle" font-size="12" font-weight="800" fill="#1e3a6e" font-family="-apple-system, 'Helvetica Neue', sans-serif">#1</text>
    </g>
  );
}

function Zongzi(p: { x: number; y: number; s: number; rot: number; face?: boolean }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M0 -16 L15 12 L-15 12Z" fill="#4f9a3a" stroke="#2f6b22" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M0 -16 L4 12" stroke="#2f6b22" stroke-width="1.2" />
      <path d="M-11 -1 L11 -1" stroke="#d6b36a" stroke-width="2.6" />
      {p.face ? <Face x={0} y={5} s={0.65} ink="#1d3b14" /> : null}
    </g>
  );
}

function DragonBoat(p: { x: number; y: number; s: number }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <path d="M-40 -6 Q-46 -14 -40 -20 Q-38 -12 -34 -8Z" fill="#f5c451" />
      <path d="M-38 -6 Q0 10 36 -6 L32 -2 Q0 10 -34 -2Z" fill="#f5c451" />
      <path d="M-36 -6 Q0 8 34 -6 L30 -10 L-32 -10Z" fill="#d9262b" />
      <path d="M-20 -10 L-26 2 M-8 -10 L-14 2 M4 -10 L-2 2 M16 -10 L10 2" stroke="#8d5a2b" stroke-width="2" stroke-linecap="round" />
      <circle cx="-20" cy="-14" r="3.4" fill="#ffd8a8" />
      <circle cx="-8" cy="-14" r="3.4" fill="#ffd8a8" />
      <circle cx="4" cy="-14" r="3.4" fill="#ffd8a8" />
      <circle cx="16" cy="-14" r="3.4" fill="#ffd8a8" />
      <path d="M30 -8 Q34 -22 42 -26 Q50 -28 52 -22 L46 -20 Q50 -16 44 -16 Q40 -14 38 -8Z" fill="#2f9e44" />
      <circle cx="46" cy="-23" r="1.6" fill="#fff" />
      <circle cx="46.4" cy="-23" r="0.8" fill="#1c1c1c" />
      <path d="M42 -26 L40 -32 L45 -27 M38 -24 L34 -30 L41 -25" stroke="#f5c451" stroke-width="1.6" fill="none" />
    </g>
  );
}

function Magpie(p: { x: number; y: number; s: number; flip?: boolean }) {
  return (
    <g transform={'translate(' + p.x + ' ' + p.y + ') scale(' + (p.flip ? -p.s : p.s) + ' ' + p.s + ')'}>
      <path d="M-10 2 L-26 8 L-24 4 L-28 2 L-10 -2Z" fill="#1e2a4a" />
      <ellipse cx="0" cy="0" rx="11" ry="6.5" fill="#1e2a4a" />
      <ellipse cx="1" cy="2.6" rx="7" ry="3.6" fill="#f8f9fa" />
      <circle cx="10" cy="-4" r="5" fill="#1e2a4a" />
      <circle cx="11.5" cy="-5" r="1.1" fill="#fff" />
      <path d="M14.6 -4 L19 -3 L14.6 -2Z" fill="#f5c451" />
      <path d="M-4 -3 Q2 -18 10 -16 Q6 -8 4 -2Z" fill="#2b3b66" />
      <path d="M-1 -6 Q3 -14 8 -14" stroke="#f8f9fa" stroke-width="1.4" fill="none" />
    </g>
  );
}

/** Little standing figure (feet at y), for the Cowherd & Weaver Girl */
function Figure(p: { x: number; y: number; s: number; robe: string; trim: string; girl?: boolean; flip?: boolean }) {
  return (
    <g transform={'translate(' + p.x + ' ' + p.y + ') scale(' + (p.flip ? -p.s : p.s) + ' ' + p.s + ')'}>
      <path d="M-8 0 L-5 -14 L5 -14 L8 0Z" fill={p.robe} />
      <path d="M-5 -14 L0 -6 L5 -14" stroke={p.trim} stroke-width="1.6" fill="none" />
      <path d="M4 -12 Q10 -14 11 -18" stroke={p.robe} stroke-width="3" fill="none" stroke-linecap="round" />
      {p.girl ? <path d="M-9 -12 Q-14 -4 -12 4" stroke={p.trim} stroke-width="1.4" fill="none" opacity="0.9" /> : null}
      <circle cx="0" cy="-20" r="7" fill="#ffe0c2" />
      <path d="M-7 -21 Q-6 -28 0 -28 Q6 -28 7 -21 Q3 -24 0 -23 Q-3 -24 -7 -21Z" fill="#2b1a12" />
      {p.girl ? (
        <g>
          <circle cx="0" cy="-29.5" r="3.6" fill="#2b1a12" />
          <path d="M-5 -31 L5 -28" stroke="#f5c451" stroke-width="1.2" stroke-linecap="round" />
          <circle cx="5" cy="-28" r="1.2" fill="#ff6b9a" />
        </g>
      ) : (
        <rect x="-2" y="-32" width="4" height="4" rx="1" fill="#2b1a12" />
      )}
      <circle cx="-2.4" cy="-19.5" r="0.9" fill="#2b1a12" />
      <circle cx="2.4" cy="-19.5" r="0.9" fill="#2b1a12" />
      <path d="M-1.4 -17 Q0 -16 1.4 -17" stroke="#2b1a12" stroke-width="0.8" fill="none" stroke-linecap="round" />
      <circle cx="-4.2" cy="-17.6" r="1.1" fill="#ff7b9c" opacity="0.6" />
      <circle cx="4.2" cy="-17.6" r="1.1" fill="#ff7b9c" opacity="0.6" />
    </g>
  );
}

/** Magpie bridge (鹊桥): magpies arranged along a quadratic arch */
function MagpieBridge(p: { x0: number; x1: number; y: number; peak: number; s: number }) {
  var cx = (p.x0 + p.x1) / 2;
  var birds: Kids[] = [];
  var ts = [0.06, 0.2, 0.34, 0.66, 0.8, 0.94];
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i];
    var u = 1 - t;
    var bx = u * u * p.x0 + 2 * u * t * cx + t * t * p.x1;
    var by = u * u * p.y + 2 * u * t * p.peak + t * t * p.y;
    var dx = 2 * u * (cx - p.x0) + 2 * t * (p.x1 - cx);
    var dy = 2 * u * (p.peak - p.y) + 2 * t * (p.y - p.peak);
    var deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    var left = t < 0.5;
    birds.push(
      <g key={i} transform={'translate(' + bx.toFixed(1) + ' ' + by.toFixed(1) + ') rotate(' + (left ? deg : deg - 180).toFixed(1) + ')'}>
        <Magpie x={0} y={0} s={p.s} flip={!left} />
      </g>
    );
  }
  return <g>{birds}</g>;
}

function Moon(p: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={p.r * 1.25} fill="#fde7a3" opacity="0.22" />
      <circle cx={p.x} cy={p.y} r={p.r} fill="#fde7a3" />
      <ellipse cx={p.x - p.r * 0.4} cy={p.y + p.r * 0.2} rx={p.r * 0.3} ry={p.r * 0.2} fill="#f2d27e" opacity="0.55" />
      <circle cx={p.x + p.r * 0.45} cy={p.y + p.r * 0.4} r={p.r * 0.13} fill="#f2d27e" opacity="0.5" />
      <ellipse cx={p.x + p.r * 0.2} cy={p.y - p.r * 0.45} rx={p.r * 0.17} ry={p.r * 0.12} fill="#f2d27e" opacity="0.45" />
    </g>
  );
}

function Mooncake(p: { x: number; y: number; r: number }) {
  var scallops: Kids[] = [];
  var petals: Kids[] = [];
  for (var i = 0; i < 12; i++) {
    var a = (Math.PI * 2 * i) / 12;
    scallops.push(<circle key={i} cx={p.x + Math.cos(a) * p.r} cy={p.y + Math.sin(a) * p.r} r={p.r * 0.3} fill="#c98a3a" />);
  }
  for (var j = 0; j < 6; j++) {
    var b = (Math.PI * 2 * j) / 6;
    petals.push(<circle key={j} cx={p.x + Math.cos(b) * p.r * 0.42} cy={p.y + Math.sin(b) * p.r * 0.42} r={p.r * 0.22} fill="none" stroke="#9a6322" stroke-width="1.6" />);
  }
  return (
    <g>
      {scallops}
      <circle cx={p.x} cy={p.y} r={p.r} fill="#d39a48" />
      <circle cx={p.x} cy={p.y} r={p.r * 0.78} fill="none" stroke="#9a6322" stroke-width="1.6" />
      {petals}
      <circle cx={p.x} cy={p.y} r={p.r * 0.16} fill="#9a6322" />
    </g>
  );
}

function TangyuanBowl(p: { x: number; y: number; s: number }) {
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      <path d="M-14 -16 Q-16 -22 -12 -26 M0 -18 Q-2 -24 2 -28" stroke="#fff" stroke-width="1.8" fill="none" opacity="0.7" stroke-linecap="round" />
      <circle cx="-9" cy="-6" r="7" fill="#ffffff" />
      <circle cx="4" cy="-7" r="7" fill="#ffd6e0" />
      <circle cx="14" cy="-4" r="6" fill="#ffffff" />
      <Face x={4} y={-7} s={0.55} />
      <path d="M-24 -2 L24 -2 Q22 18 0 20 Q-22 18 -24 -2Z" fill="#3b5bdb" />
      <path d="M-22 4 Q0 10 22 4" stroke="#dbe4ff" stroke-width="2" fill="none" />
      <rect x="-8" y="19" width="16" height="4" rx="1.5" fill="#364fc7" />
    </g>
  );
}

function Rocket(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M-4 16 Q0 30 4 16Z" fill="#ffa94d" />
      <path d="M-2.4 16 Q0 24 2.4 16Z" fill="#ffe066" />
      <rect x="-6" y="-10" width="12" height="26" rx="2" fill="#ffffff" />
      <rect x="-6" y="-4" width="12" height="5" fill="#e03131" />
      <rect x="-6" y="6" width="12" height="5" fill="#e03131" />
      <path d="M-6 -10 L0 -22 L6 -10Z" fill="#364fc7" />
      <path d="M-6 10 L-11 18 L-6 16Z M6 10 L11 18 L6 16Z" fill="#364fc7" />
    </g>
  );
}

function Flag(p: { x: number; y: number; s: number; rot: number }) {
  var stripes: Kids[] = [];
  for (var i = 0; i < 7; i++) {
    stripes.push(<rect key={i} x="0" y={i * 3.4} width="34" height="3.4" fill={i % 2 === 0 ? '#e03131' : '#ffffff'} />);
  }
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <line x1="0" y1="-2" x2="0" y2="44" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="0" cy="-3" r="2.4" fill="#f5c451" />
      <g transform="translate(1 0)">
        {stripes}
        <rect x="0" y="0" width="15" height="13.6" fill="#364fc7" />
        <circle cx="4" cy="4" r="1" fill="#fff" />
        <circle cx="10" cy="4" r="1" fill="#fff" />
        <circle cx="7" cy="9" r="1" fill="#fff" />
      </g>
    </g>
  );
}

function Maple(p: { x: number; y: number; s: number; rot: number; fill: string }) {
  return (
    <path
      transform={tr(p.x, p.y, p.rot, p.s)}
      d="M0 -20 L4 -10 L10 -13 L8 -4 L18 -6 L13 2 L17 6 L6 6 L7 12 L1 9 L1 20 L-1 20 L-1 9 L-7 12 L-6 6 L-17 6 L-13 2 L-18 -6 L-8 -4 L-10 -13 L-4 -10Z"
      fill={p.fill}
    />
  );
}

function Acorn(p: { x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={tr(p.x, p.y, p.rot, p.s)}>
      <path d="M-8 -2 Q-8 14 0 16 Q8 14 8 -2Z" fill="#d9a066" />
      <path d="M-10 -1 Q-10 -10 0 -10 Q10 -10 10 -1Z" fill="#7a4a22" />
      <path d="M0 -10 Q1 -15 4 -16" stroke="#7a4a22" stroke-width="2" fill="none" stroke-linecap="round" />
    </g>
  );
}

function Turkey(p: { x: number; y: number; s: number }) {
  var colors = ['#c92a2a', '#e8590c', '#f59f00', '#e8590c', '#c92a2a', '#f59f00', '#e8590c'];
  var feathers: Kids[] = [];
  for (var i = 0; i < colors.length; i++) {
    var a = -160 + i * (140 / (colors.length - 1));
    feathers.push(<ellipse key={i} cx="0" cy="-22" rx="7" ry="17" fill={colors[i]} transform={'rotate(' + (a + 90) + ')'} />);
  }
  return (
    <g transform={tr(p.x, p.y, 0, p.s)}>
      {feathers}
      <path d="M-5 16 L-5 24 M-8 24 L-2 24 M5 16 L5 24 M2 24 L8 24" stroke="#f08c00" stroke-width="2" stroke-linecap="round" />
      <ellipse cx="0" cy="4" rx="15" ry="14" fill="#8b5a2b" />
      <ellipse cx="0" cy="8" rx="9" ry="8" fill="#a9713c" />
      <circle cx="0" cy="-12" r="9" fill="#9c6634" />
      <circle cx="-3.2" cy="-14" r="1.6" fill="#1c1c1c" />
      <circle cx="3.2" cy="-14" r="1.6" fill="#1c1c1c" />
      <path d="M-3 -10 L3 -10 L0 -5Z" fill="#f59f00" />
      <path d="M1.5 -8 Q4 -2 1 0 Q-1 -4 1.5 -8Z" fill="#e03131" />
      <circle cx="-6.5" cy="-10" r="1.7" fill="#ff7b9c" opacity="0.6" />
      <circle cx="6.5" cy="-10" r="1.7" fill="#ff7b9c" opacity="0.6" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Per-theme compositions
// ---------------------------------------------------------------------------

interface ThemeArt {
  corner: Kids;
  accent: Kids;
}

function artFor(id: HolidayThemeId): ThemeArt {
  switch (id) {
    case 'christmas':
      return {
        corner: (
          <g>
            <Bauble x={78} y={40} r={10} fill="#c8102e" />
            <Bauble x={116} y={24} r={8} fill="#f5c451" />
            <Bauble x={142} y={50} r={6} fill="#2f9e44" />
            <Leaf x={14} y={18} rot={20} len={52} fill="#1f6b3a" vein="#2f8a4f" />
            <Leaf x={14} y={18} rot={62} len={48} fill="#17582f" vein="#2f8a4f" />
            <Leaf x={14} y={18} rot={-8} len={40} fill="#26804a" vein="#3a9c5c" />
            <Dot x={18} y={22} r={6} fill="#c8102e" />
            <Dot x={27} y={18} r={5.5} fill="#e0263f" />
            <Dot x={21} y={31} r={5} fill="#b00d26" />
            <CandyCane x={30} y={76} s={1} rot={-20} />
            <Snowflake x={100} y={80} r={6} o={0.7} />
            <Snowflake x={66} y={96} r={4.5} o={0.6} />
          </g>
        ),
        accent: (
          <g>
            <Snowman x={92} y={86} s={1.15} />
            <Gift x={44} y={110} s={0.85} box="#c8102e" ribbon="#f5c451" />
            <Snowflake x={30} y={56} r={6} o={0.7} />
          </g>
        ),
      };
    case 'new-year':
      return {
        corner: (
          <g>
            <PartyHat x={34} y={40} s={1.15} rot={-22} />
            <Streamer x={56} y={70} color="#ff6b6b" rot={20} />
            <Streamer x={18} y={96} color="#4dabf7" rot={-10} />
            <Burst x={108} y={28} r={15} color="#f5c451" />
            <Burst x={136} y={70} r={9} color="#e9e4ff" />
            <Confetti x={80} y={20} rot={30} fill="#ffd43b" />
            <Confetti x={94} y={66} rot={-20} fill="#ff8fab" />
            <Confetti x={60} y={110} rot={60} fill="#69db7c" />
            <Confetti x={120} y={100} rot={10} fill="#4dabf7" />
            <Confetti x={40} y={130} rot={-40} fill="#ffd43b" />
          </g>
        ),
        accent: (
          <g>
            <ChampagneGlass x={64} y={96} rot={-14} />
            <ChampagneGlass x={86} y={96} rot={14} />
            <Burst x={75} y={56} r={14} color="#f5c451" />
            <Confetti x={40} y={70} rot={20} fill="#ff8fab" />
            <Confetti x={112} y={64} rot={-30} fill="#69db7c" />
            <Confetti x={108} y={110} rot={50} fill="#ffd43b" />
          </g>
        ),
      };
    case 'lunar-new-year':
      return {
        corner: (
          <g>
            <Lantern x={34} y={10} s={1.05} string={10} />
            <Lantern x={86} y={4} s={0.7} string={8} />
            <Firecrackers x={128} len={6} />
          </g>
        ),
        accent: (
          <g>
            <RedEnvelope x={86} y={84} s={1.35} rot={12} />
            <Coin x={48} y={110} r={9} />
            <Coin x={60} y={120} r={7} />
            <Burst x={44} y={66} r={12} color="#f5c451" />
          </g>
        ),
      };
    case 'lantern':
      return {
        corner: (
          <g>
            <Lantern x={28} y={8} s={0.85} string={8} />
            <Lantern x={74} y={20} s={0.7} string={6} />
            <Lantern x={120} y={6} s={0.6} string={6} />
          </g>
        ),
        accent: (
          <g>
            <Moon x={96} y={42} r={20} />
            <TangyuanBowl x={70} y={96} s={1.25} />
          </g>
        ),
      };
    case 'valentines':
      return {
        corner: (
          <g>
            <Heart x={34} y={20} s={38} fill="#e0315b" rot={-12} />
            <Face x={34} y={36} s={1} ink="#5c0a22" />
            <Arrow x1={4} y1={66} x2={70} y2={20} />
            <Heart x={82} y={18} s={20} fill="#ff6f91" rot={10} />
            <Heart x={22} y={84} s={18} fill="#ff8fab" rot={-24} />
            <Heart x={114} y={44} s={11} fill="#ffc2d1" rot={18} />
            <Heart x={66} y={70} s={10} fill="#ffc2d1" />
          </g>
        ),
        accent: (
          <g>
            <HeartBalloon x={84} y={30} s={30} fill="#e0315b" sway={6} />
            <HeartBalloon x={54} y={50} s={20} fill="#ff8fab" sway={-5} />
          </g>
        ),
      };
    case 'st-patricks':
      return {
        corner: (
          <g>
            <LeprechaunHat x={36} y={30} s={1.2} rot={-16} />
            <Shamrock x={92} y={24} s={1} rot={15} />
            <Shamrock x={26} y={92} s={0.9} rot={-50} />
            <Shamrock x={128} y={60} s={0.6} rot={30} />
            <Coin x={70} y={70} r={4} />
          </g>
        ),
        accent: <PotOfGold x={86} y={96} s={1.1} />,
      };
    case 'easter':
      return {
        corner: (
          <g>
            <Egg x={30} y={30} s={1.35} rot={-18} fill="#a5d8ff" band="#ffd43b" face={true} />
            <Egg x={78} y={24} s={0.95} rot={14} fill="#ffc9de" band="#b197fc" />
            <Egg x={28} y={88} s={0.85} rot={-40} fill="#d3f9d8" band="#ff8fab" />
            <Flower x={114} y={56} r={11} petal="#fff3bf" center="#f59f00" />
            <Flower x={66} y={76} r={8} petal="#e5dbff" center="#f59f00" />
          </g>
        ),
        accent: (
          <g>
            <Bunny x={86} y={92} s={1.2} />
            <Egg x={46} y={112} s={0.9} rot={-14} fill="#fff3bf" band="#74c0fc" face={true} />
            <Flower x={30} y={84} r={9} petal="#ffc9de" center="#f59f00" />
          </g>
        ),
      };
    case 'mothers-day':
      return {
        corner: (
          <g>
            <Leaf x={20} y={40} rot={50} len={34} fill="#5c9e6a" />
            <Leaf x={40} y={20} rot={40} len={30} fill="#5c9e6a" />
            <Flower x={28} y={28} r={20} petal="#f783ac" center="#fff0f6" />
            <Flower x={78} y={22} r={13} petal="#faa2c1" center="#fff0f6" />
            <Flower x={26} y={82} r={12} petal="#fcc2d7" center="#fff0f6" />
            <Heart x={70} y={62} s={10} fill="#f06595" />
            <Heart x={118} y={40} s={8} fill="#fcc2d7" />
          </g>
        ),
        accent: (
          <g>
            <Tulip x={64} y={80} s={1.2} rot={-18} fill="#f783ac" />
            <Tulip x={80} y={74} s={1.3} rot={0} fill="#e64980" />
            <Tulip x={96} y={80} s={1.2} rot={18} fill="#faa2c1" />
            <path d="M68 106 Q80 100 92 106 L88 112 Q80 108 72 112Z" fill="#fff0f6" />
            <HeartBalloon x={36} y={44} s={18} fill="#f06595" sway={-4} />
          </g>
        ),
      };
    case 'fathers-day':
      return {
        corner: (
          <g>
            <Tie x={34} y={40} s={1.5} rot={-18} />
            <Mustache x={92} y={30} s={1.3} rot={8} />
            <Star x={120} y={66} r={6} fill="#f2c14e" />
            <Star x={30} y={100} r={6} fill="#dbe4ff" />
            <Star x={70} y={80} r={4} fill="#dbe4ff" />
          </g>
        ),
        accent: (
          <g>
            <Mug x={84} y={96} s={1.25} />
            <Star x={36} y={84} r={7} fill="#f2c14e" />
          </g>
        ),
      };
    case 'dragon-boat':
      return {
        corner: (
          <g>
            <Zongzi x={34} y={34} s={1.6} rot={-14} face={true} />
            <Zongzi x={90} y={24} s={1} rot={18} face={true} />
            <Leaf x={14} y={84} rot={-30} len={44} fill="#4f9a3a" />
            <Leaf x={62} y={80} rot={-60} len={30} fill="#6bb04f" />
          </g>
        ),
        accent: (
          <g>
            <DragonBoat x={64} y={96} s={1.05} />
            <Waves y={110} w={140} color="#4dabf7" />
            <Waves y={124} w={140} color="#339af0" o={0.7} />
          </g>
        ),
      };
    case 'qixi':
      return {
        corner: (
          <g>
            <path d="M-10 150 Q50 70 170 0" stroke="#d0bfff" stroke-width="34" fill="none" opacity="0.13" stroke-linecap="round" />
            <path d="M-4 140 Q50 70 160 4" stroke="#f3e8ff" stroke-width="12" fill="none" opacity="0.16" stroke-linecap="round" />
            <Star x={24} y={24} r={9} fill="#f3e8ff" />
            <Star x={70} y={14} r={5} fill="#d0bfff" />
            <Star x={20} y={108} r={5} fill="#f3e8ff" />
            <Star x={122} y={70} r={4} fill="#d0bfff" />
            <Dot x={52} y={80} r={1.8} fill="#ffffff" />
            <Dot x={84} y={52} r={1.6} fill="#ffffff" />
            <Dot x={104} y={34} r={1.4} fill="#ffffff" />
            <Dot x={36} y={60} r={1.4} fill="#ffffff" />
            <Dot x={140} y={18} r={1.6} fill="#ffffff" />
            <Magpie x={96} y={88} s={0.9} />
            <Magpie x={130} y={110} s={0.6} />
          </g>
        ),
        accent: (
          <g>
            <MagpieBridge x0={10} x1={130} y={118} peak={66} s={0.8} />
            <Figure x={60} y={90} s={1.1} robe="#4c6ef5" trim="#dbe4ff" />
            <Figure x={80} y={90} s={1.1} robe="#e64980" trim="#ffdeeb" girl={true} flip={true} />
            <Heart x={70} y={30} s={16} fill="#ff6b9a" />
            <Star x={24} y={40} r={5} fill="#f3e8ff" />
            <Star x={120} y={34} r={4} fill="#f3e8ff" />
            <Dot x={100} y={14} r={1.6} fill="#ffffff" />
          </g>
        ),
      };
    case 'mid-autumn':
      return {
        corner: (
          <g>
            <Moon x={44} y={42} r={30} />
            <Cloud x={58} y={80} s={1.6} color="#f5c451" />
            <Lantern x={118} y={6} s={0.6} string={6} />
          </g>
        ),
        accent: (
          <g>
            <Bunny x={52} y={84} s={1.1} />
            <Mooncake x={98} y={104} r={18} />
            <Cloud x={110} y={60} s={1} color="#f5c451" />
          </g>
        ),
      };
    case 'independence':
      return {
        corner: (
          <g>
            <Flag x={22} y={14} s={1.4} rot={-10} />
            <Star x={84} y={22} r={9} fill="#e03131" />
            <Star x={40} y={108} r={8} fill="#ffffff" />
            <Burst x={112} y={54} r={16} color="#ff6b6b" />
            <Burst x={72} y={92} r={11} color="#74c0fc" />
          </g>
        ),
        accent: (
          <g>
            <Rocket x={96} y={92} s={1.3} rot={20} />
            <Burst x={56} y={52} r={18} color="#ffffff" />
            <Star x={36} y={100} r={7} fill="#e03131" />
          </g>
        ),
      };
    case 'halloween':
      return {
        corner: (
          <g>
            <Web />
            <Spider x={52} y={92} s={1.1} />
            <Bat x={92} y={24} s={1.3} rot={-8} />
            <Bat x={130} y={54} s={0.85} rot={12} />
            <Bat x={98} y={88} s={0.7} rot={-16} />
          </g>
        ),
        accent: (
          <g>
            <Ghost x={46} y={60} s={1.4} rot={-8} />
            <Pumpkin x={92} y={102} s={1.5} carved={true} />
            <Pumpkin x={48} y={114} s={0.9} carved={true} />
          </g>
        ),
      };
    case 'thanksgiving':
      return {
        corner: (
          <g>
            <Maple x={32} y={30} s={1.5} rot={-20} fill="#d9480f" />
            <Maple x={84} y={22} s={0.95} rot={25} fill="#f08c00" />
            <Maple x={26} y={88} s={0.9} rot={-55} fill="#c92a2a" />
            <Acorn x={118} y={48} s={1} rot={18} />
            <Acorn x={68} y={70} s={0.8} rot={-24} />
            <Leaf x={104} y={86} rot={30} len={22} fill="#e8590c" />
          </g>
        ),
        accent: (
          <g>
            <Turkey x={90} y={92} s={1.3} />
            <Pumpkin x={38} y={114} s={0.9} />
            <Maple x={32} y={70} s={0.7} rot={30} fill="#f59f00" />
          </g>
        ),
      };
  }
  return { corner: null, accent: null };
}

export function HolidayFrame(props: { theme: ActiveHolidayTheme }) {
  var art = artFor(props.theme.id);
  return (
    <div class={'holiday-frame holiday-' + props.theme.id} aria-hidden="true">
      <svg class="holiday-corner holiday-corner-tl" viewBox="0 0 160 160" width="160" height="160">
        {art.corner}
      </svg>
      <svg class="holiday-corner holiday-corner-tr" viewBox="0 0 160 160" width="160" height="160">
        <g transform="translate(160 0) scale(-1 1)">{art.corner}</g>
      </svg>
      <div class="holiday-accent-wrap">
        <svg class="holiday-accent" viewBox="0 0 140 140" width="140" height="140">
          {art.accent}
        </svg>
      </div>
    </div>
  );
}
