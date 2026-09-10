/**
 * 그림 잘라내기 보정
 *
 * 비전 모델이 주는 박스는 "이 근처"까지만 맞다. 실제로 3개 중 1개꼴로 어긋나
 * 그래프 라벨(y=f(x))이 잘리거나 축 아래가 날아간다.
 *
 * 그래서 모델 좌표는 출발점으로만 쓰고, 실제 픽셀에서 잉크가 어디까지 이어지는지
 * 보고 경계를 다시 잡는다. 사방으로 넓히다가 충분히 넓은 빈 띠를 만나면 멈추고,
 * 반대로 안쪽에 남는 여백은 깎아낸다.
 */
(function (root) {
  'use strict';

  var INK = 245;        // 이 값보다 어두우면 잉크로 본다 (0=검정, 255=흰색)

  /**
   * @param {Uint8ClampedArray} rgba  캔버스 getImageData().data
   * @param {number} W  이미지 폭
   * @param {number} H  이미지 높이
   * @returns {Uint8Array} 잉크면 1 인 W*H 마스크
   */
  function inkMask(rgba, W, H) {
    var m = new Uint8Array(W * H);
    for (var i = 0, p = 0; i < m.length; i++, p += 4) {
      if (rgba[p + 3] < 16) continue;          // 투명한 곳은 배경으로 친다
      var v = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
      if (v < INK) m[i] = 1;
    }
    return m;
  }

  // [x0,x1) 구간에서 y 행의 잉크 픽셀 수
  function rowInk(mask, W, y, x0, x1) {
    var n = 0;
    var base = y * W;
    for (var x = x0; x < x1; x++) if (mask[base + x]) n++;
    return n;
  }

  // [y0,y1) 구간에서 x 열의 잉크 픽셀 수
  function colInk(mask, W, x, y0, y1) {
    var n = 0;
    for (var y = y0; y < y1; y++) if (mask[y * W + x]) n++;
    return n;
  }

  /**
   * 모델이 준 박스를 실제 그림 경계에 맞춘다.
   *
   * @param {Uint8ClampedArray} rgba  페이지 캔버스 픽셀
   * @param {number} W
   * @param {number} H
   * @param {number[]} box  [x0,y0,x1,y1] 비율(0~1)
   * @param {object} [opt]  { grow: 넓힐 수 있는 최대치(원래 크기 대비 비율) }
   * @returns {{box:number[], grew:boolean, shrank:boolean}} 비율 좌표
   */
  function snap(rgba, W, H, box, opt) {
    opt = opt || {};
    var mask = inkMask(rgba, W, H);

    var x0 = Math.max(0, Math.round(box[0] * W));
    var y0 = Math.max(0, Math.round(box[1] * H));
    var x1 = Math.min(W, Math.round(box[2] * W));
    var y1 = Math.min(H, Math.round(box[3] * H));
    if (x1 <= x0 || y1 <= y0) return { box: box.slice(), grew: false, shrank: false };

    var w0 = x1 - x0;
    var h0 = y1 - y0;

    // 그림과 본문 사이 여백. 이만큼 연속으로 비어 있으면 그림이 끝난 것으로 본다.
    // 너무 작으면 옆 문단까지 삼키고, 너무 크면 잘린 부분을 못 찾는다.
    var gapY = Math.max(10, Math.round(H * 0.010));
    var gapX = Math.max(10, Math.round(W * 0.012));

    // 모델이 크게 빗나가지는 않으므로 넓히는 폭을 제한한다.
    var growth = opt.grow == null ? 0.5 : opt.grow;
    var maxV = Math.round(h0 * growth);
    var maxHz = Math.round(w0 * growth);

    var grew = false;
    var run, x, y;

    // ── 박스가 너무 크게 잡힌 경우: 안에서 그림 덩어리만 고른다 ──
    // 빈 행이 gapY 이상 이어지는 곳을 경계로 가로 띠들을 나누면
    // 본문은 한 줄 높이의 얇은 띠로, 그림은 두꺼운 띠 하나로 갈린다.
    var bands = [];
    var cur = -1;
    for (y = y0; y < y1; y++) {
      if (rowInk(mask, W, y, x0, x1) > 0) {
        if (cur < 0) cur = y;
        run = 0;
      } else if (cur >= 0 && ++run >= gapY) {
        bands.push([cur, y - run + 1]);
        cur = -1;
      }
    }
    if (cur >= 0) bands.push([cur, y1]);

    // 본문 두어 줄보다 확실히 두꺼운 띠만 그림 후보로 본다
    var minFig = Math.round(H * 0.04);
    var best = null;
    for (var i = 0; i < bands.length; i++) {
      var hh = bands[i][1] - bands[i][0];
      if (hh >= minFig && (!best || hh > best[1] - best[0])) best = bands[i];
    }
    if (best && bands.length > 1) {
      y0 = best[0];
      y1 = best[1];
      // 세로를 좁혔으니 가로도 그 구간 기준으로 다시 타이트하게
      while (x0 < x1 && colInk(mask, W, x0, y0, y1) === 0) x0++;
      while (x1 > x0 && colInk(mask, W, x1 - 1, y0, y1) === 0) x1--;
    }

    // ── 위로 ──
    run = 0;
    for (y = y0 - 1; y >= Math.max(0, y0 - maxV); y--) {
      if (rowInk(mask, W, y, x0, x1) > 0) { y0 = y; run = 0; grew = true; }
      else if (++run >= gapY) break;
    }
    // ── 아래로 ──
    run = 0;
    for (y = y1; y < Math.min(H, y1 + maxV); y++) {
      if (rowInk(mask, W, y, x0, x1) > 0) { y1 = y + 1; run = 0; grew = true; }
      else if (++run >= gapY) break;
    }
    // ── 왼쪽 ──
    run = 0;
    for (x = x0 - 1; x >= Math.max(0, x0 - maxHz); x--) {
      if (colInk(mask, W, x, y0, y1) > 0) { x0 = x; run = 0; grew = true; }
      else if (++run >= gapX) break;
    }
    // ── 오른쪽 ──
    run = 0;
    for (x = x1; x < Math.min(W, x1 + maxHz); x++) {
      if (colInk(mask, W, x, y0, y1) > 0) { x1 = x + 1; run = 0; grew = true; }
      else if (++run >= gapX) break;
    }

    // ── 안쪽 여백 깎기 ──
    var shrank = false;
    while (y0 < y1 && rowInk(mask, W, y0, x0, x1) === 0) { y0++; shrank = true; }
    while (y1 > y0 && rowInk(mask, W, y1 - 1, x0, x1) === 0) { y1--; shrank = true; }
    while (x0 < x1 && colInk(mask, W, x0, y0, y1) === 0) { x0++; shrank = true; }
    while (x1 > x0 && colInk(mask, W, x1 - 1, y0, y1) === 0) { x1--; shrank = true; }

    if (x1 <= x0 || y1 <= y0) return { box: box.slice(), grew: false, shrank: false };

    // 숨 쉴 틈을 조금 남긴다
    var pad = Math.max(2, Math.round(Math.min(W, H) * 0.004));
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W, x1 + pad);
    y1 = Math.min(H, y1 + pad);

    return { box: [x0 / W, y0 / H, x1 / W, y1 / H], grew: grew, shrank: shrank };
  }

  var api = { snap: snap, inkMask: inkMask };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FigCrop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
