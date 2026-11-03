// 零依賴 QR（版本 6、M 級修正）：本實作有 108 個資料碼字，byte mode 扣掉模式及長度後可容納 106 bytes。
(function (g) {
  var MAX_BYTES = 106;
  var EXP = [], LOG = [], x = 1;
  for (var i = 0; i < 256; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (i = 256; i < 512; i++) EXP[i] = EXP[i - 255];
  function mul(a, b) { return !a || !b ? 0 : EXP[LOG[a] + LOG[b]]; }
  function poly(a, b) { var r = Array(a.length + b.length - 1).fill(0); for (var p = 0; p < a.length; p++) for (var q = 0; q < b.length; q++) r[p + q] ^= mul(a[p], b[q]); return r; }
  function generator(n) { var r = [1]; for (var j = 0; j < n; j++) r = poly(r, [1, EXP[j]]); return r; }
  function ecc(data, n) { var g = generator(n), r = Array(n).fill(0); data.forEach(function (v) { var f = v ^ r.shift(); r.push(0); for (var j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f); }); return r; }
  function bits(v, n, out) { for (var j = n - 1; j >= 0; j--) out.push((v >>> j) & 1); }
  function bch(v, p) { var d = function (n) { var z = 0; while (n) { z++; n >>>= 1; } return z; }; while (d(v) >= d(p)) v ^= p << (d(v) - d(p)); return v; }
  function finder(m, r, c) { for (var y = -1; y <= 7; y++) for (var z = -1; z <= 7; z++) if (r + y >= 0 && r + y < 41 && c + z >= 0 && c + z < 41) m[r + y][c + z] = y >= 0 && y <= 6 && z >= 0 && z <= 6 && (y === 0 || y === 6 || z === 0 || z === 6 || y >= 2 && y <= 4 && z >= 2 && z <= 4); }
  function alignment(m, r, c) { for (var y = -2; y <= 2; y++) for (var z = -2; z <= 2; z++) if (m[r + y][c + z] === null) m[r + y][c + z] = Math.abs(y) === 2 || Math.abs(z) === 2 || y === 0 && z === 0; }
  function matrix(text) {
    if (!new RegExp('^[\\x20-\\x7e]{1,' + MAX_BYTES + '}$').test(text)) throw new Error('payload');
    var m = Array.from({ length: 41 }, function () { return Array(41).fill(null); });
    finder(m, 0, 0); finder(m, 34, 0); finder(m, 0, 34); alignment(m, 34, 34);
    for (var k = 8; k < 33; k++) { if (m[k][6] === null) m[k][6] = k % 2 === 0; if (m[6][k] === null) m[6][k] = k % 2 === 0; }
    var raw = []; bits(4, 4, raw); bits(text.length, 8, raw); for (k = 0; k < text.length; k++) bits(text.charCodeAt(k), 8, raw); for (k = 0; k < Math.min(4, 108 * 8 - raw.length); k++) raw.push(0); while (raw.length % 8) raw.push(0);
    var bytes = []; for (k = 0; k < raw.length; k += 8) { var v = 0; for (var q = 0; q < 8; q++) v = (v << 1) | raw[k + q]; bytes.push(v); } for (k = 0; bytes.length < 108; k++) bytes.push(k % 2 ? 0x11 : 0xec);
    var blocks = []; for (k = 0; k < 4; k++) { var d = bytes.slice(k * 27, k * 27 + 27); blocks.push({ d: d, e: ecc(d, 16) }); }
    var data = []; for (k = 0; k < 27; k++) for (q = 0; q < 4; q++) data.push(blocks[q].d[k]); for (k = 0; k < 16; k++) for (q = 0; q < 4; q++) data.push(blocks[q].e[k]);
    // M 級（00）、遮罩 0；格式資訊按 QR 規格 BCH(0x537) 後 xor 0x5412。
    var info = ((bch(0 << 3 | 0, 0x537) | (0 << 10)) ^ 0x5412) >>> 0;
    for (k = 0; k < 15; k++) { var on = !!((info >>> k) & 1); if (k < 6) m[k][8] = on; else if (k < 8) m[k + 1][8] = on; else m[41 - 15 + k][8] = on; if (k < 8) m[8][41 - k - 1] = on; else if (k < 9) m[8][15 - k] = on; else m[8][15 - k - 1] = on; }
    m[33][8] = true;
    var row = 40, up = true, bi = 0, bit = 7;
    for (var col = 40; col > 0; col -= 2) { if (col === 6) col--; for (;;) { for (var side = 0; side < 2; side++) { var cc = col - side; if (m[row][cc] !== null) continue; var dark = bi < data.length && !!((data[bi] >>> bit) & 1); if ((row + cc) % 2 === 0) dark = !dark; m[row][cc] = dark; bit--; if (bit < 0) { bi++; bit = 7; } } row += up ? -1 : 1; if (row < 0 || row >= 41) { row += up ? 1 : -1; up = !up; break; } } }
    return m;
  }
  function qr(text) { var m = matrix(text), parts = ['<svg class="pair-qr" viewBox="0 0 41 41" role="img" aria-label="二維碼" shape-rendering="crispEdges"><rect width="41" height="41" fill="#fff"/>']; for (var r = 0; r < 41; r++) for (var c = 0; c < 41; c++) if (m[r][c]) parts.push('<rect x="' + c + '" y="' + r + '" width="1" height="1" fill="#000"/>'); return parts.join('') + '</svg>'; }
  function pairPage() {
    var N = g.SOS_NAMES && g.SOS_NAMES.ui, app = document.getElementById('pair-app'); if (!N || !app) return;
    var secret = location.hash.slice(1); try { history.replaceState(null, '', '/pair'); } catch (e) { }
    function show(msg, code) { app.replaceChildren(Object.assign(document.createElement('h1'), { textContent: N.brand }), Object.assign(document.createElement('p'), { textContent: msg }), code ? Object.assign(document.createElement('strong'), { textContent: code }) : document.createElement('span')); }
    if (!/^[a-f0-9]{64}$/.test(secret)) { show(N.phonePairExpired); return; }
    show(N.phoneConnecting);
    fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: secret }) }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); }).then(function (v) {
      if (!v.r.ok) { show(v.j.message || (v.j.error === 'origin' ? N.phoneNoPrivateNetwork : N.phonePairExpired)); return; }
      show(N.phoneWaiting, v.j.code || '');
      var until = Date.now() + 5 * 60000;
      var timer = setInterval(function () {
        fetch('/api/status', { cache: 'no-store' }).then(function (r) {
          if (r.ok) { clearInterval(timer); show(N.phoneConnected); setTimeout(function () { location.replace('/'); }, 300); return null; }
          if (r.status !== 403) return null;
          return r.json().then(function (j) { if (j.error !== 'pending') { clearInterval(timer); show(N.phoneRejected); } });
        }).catch(function () { if (Date.now() > until) { clearInterval(timer); show(N.phoneRejected); } });
        if (Date.now() > until) { clearInterval(timer); show(N.phoneRejected); }
      }, 3000);
    }).catch(function () { show(N.phoneOffline); });
  }
  g.SOS_PAIR = { qr: qr, maxBytes: MAX_BYTES, start: pairPage };
  if (typeof document !== 'undefined' && document.getElementById('pair-app')) pairPage();
})(globalThis);
