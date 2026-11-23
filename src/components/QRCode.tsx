import qrcode from 'qrcode-generator';

interface QRCodeProps {
  value: string;
  size: number;
  // Optional centre badge (e.g. the feed's initial on its accent color)
  logoText?: string;
  logoColor?: string;
}

var INK = '#0b1322';

// Rounded-square path (SVG) without relying on rx support quirks
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return (
    'M' + (x + r) + ' ' + y +
    'h' + (w - 2 * r) +
    'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
    'v' + (h - 2 * r) +
    'a' + r + ' ' + r + ' 0 0 1 ' + -r + ' ' + r +
    'h' + -(w - 2 * r) +
    'a' + r + ' ' + r + ' 0 0 1 ' + -r + ' ' + -r +
    'v' + -(h - 2 * r) +
    'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + -r +
    'z'
  );
}

// Modern QR code as one SVG: dot modules, rounded finder "eyes", and an
// optional badge in the centre. Uses error-correction level H (~30%
// recoverable) so the badge can cover the middle and it still scans.
export function QRCode(props: QRCodeProps) {
  var hasLogo = Boolean(props.logoText);
  var qr = qrcode(0, hasLogo ? 'H' : 'M');
  qr.addData(props.value);
  qr.make();
  var n = qr.getModuleCount();
  var quiet = 2;
  var total = n + quiet * 2;

  // Centre area reserved for the badge: ~22% of the width, odd-sized and centred
  var logoModules = 0;
  if (hasLogo) {
    logoModules = Math.floor(n * 0.22);
    if (logoModules % 2 === 0) logoModules += 1;
  }
  var logoStart = Math.floor((n - logoModules) / 2);
  var logoEnd = logoStart + logoModules;

  function inFinder(r: number, c: number): boolean {
    return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  }

  // Data modules as round dots (skip the finder patterns and the badge area)
  var dots = '';
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inFinder(r, c)) continue;
      if (hasLogo && r >= logoStart - 1 && r < logoEnd + 1 && c >= logoStart - 1 && c < logoEnd + 1) continue;
      var cx = c + quiet + 0.5;
      var cy = r + quiet + 0.5;
      // Circle as two arcs (compact, crisp at any scale)
      dots += 'M' + (cx - 0.42) + ' ' + cy + 'a0.42 0.42 0 1 0 0.84 0a0.42 0.42 0 1 0 -0.84 0z';
    }
  }

  // Finder "eyes": rounded 7x7 ring with a rounded 3x3 centre
  var eyes = '';
  var eyeOrigins = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  for (var e = 0; e < eyeOrigins.length; e++) {
    var ey = eyeOrigins[e][0] + quiet;
    var ex = eyeOrigins[e][1] + quiet;
    eyes += roundedRect(ex, ey, 7, 7, 2.2);
    eyes += roundedRect(ex + 1, ey + 1, 5, 5, 1.5); // hole (even-odd)
    eyes += roundedRect(ex + 2, ey + 2, 3, 3, 1);
  }

  var logo = null;
  if (hasLogo) {
    var lx = logoStart + quiet;
    var ly = logoStart + quiet;
    var fontSize = logoModules * 0.6;
    logo = (
      <g>
        <path d={roundedRect(lx - 0.5, ly - 0.5, logoModules + 1, logoModules + 1, 1.6)} fill="#ffffff" />
        <path
          d={roundedRect(lx, ly, logoModules, logoModules, 1.3)}
          fill={props.logoColor || INK}
        />
        <text
          x={String(lx + logoModules / 2)}
          y={String(ly + logoModules / 2)}
          text-anchor="middle"
          dominant-baseline="central"
          font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', sans-serif"
          font-weight="800"
          font-size={String(fontSize)}
          fill="#ffffff"
        >
          {props.logoText}
        </text>
      </g>
    );
  }

  return (
    <svg
      class="qr-code"
      width={String(props.size)}
      height={String(props.size)}
      viewBox={'0 0 ' + String(total) + ' ' + String(total)}
      role="img"
      aria-label={'QR code for ' + props.value}
    >
      <path d={roundedRect(0, 0, total, total, 2.4)} fill="#ffffff" />
      <path d={dots} fill={INK} />
      <path d={eyes} fill={INK} fill-rule="evenodd" />
      {logo}
    </svg>
  );
}
