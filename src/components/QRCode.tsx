import qrcode from 'qrcode-generator';

interface QRCodeProps {
  value: string;
  size: number;
}

// Crisp vector QR code (one SVG path) so a phone can open the link from the wall.
export function QRCode(props: QRCodeProps) {
  var qr = qrcode(0, 'M');
  qr.addData(props.value);
  qr.make();
  var count = qr.getModuleCount();
  var quiet = 2;
  var total = count + quiet * 2;
  var d = '';
  for (var r = 0; r < count; r++) {
    for (var c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        d += 'M' + String(c + quiet) + ' ' + String(r + quiet) + 'h1v1h-1z';
      }
    }
  }
  return (
    <svg
      class="qr-code"
      width={String(props.size)}
      height={String(props.size)}
      viewBox={'0 0 ' + String(total) + ' ' + String(total)}
      shape-rendering="crispEdges"
      role="img"
      aria-label={'QR code for ' + props.value}
    >
      <rect width={String(total)} height={String(total)} fill="#ffffff" />
      <path d={d} fill="#0b1322" />
    </svg>
  );
}
