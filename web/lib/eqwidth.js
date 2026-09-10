/**
 * 한글 수식 스크립트의 렌더 폭 추정기
 *
 * 왜 필요한가: hwpx 의 <hp:equation> 은 <hp:sz width>(수식이 차지할 폭)를 갖는다.
 * 한글은 파일을 열 때 이 값을 그대로 믿고 그린다 — 편집이 일어나야 다시 계산한다.
 * 그래서 고정값을 넣으면 수식이 좁은 칸에 눌려 글자가 겹쳐 보이고(폭이 작을 때),
 * sz 를 아예 빼면 반대로 지나치게 넓게 잡혀 문장이 흩어진다. 둘 다 실측 확인함.
 *
 * 정확할 필요는 없지만 틀리는 방향이 중요하다. 좁으면 겹치고 넓으면 빈칸이 생기니
 * 애매하면 넓게 잡는다(SAFETY). 계수는 한글이 직접 만든 수식 238개에 맞췄다.
 * 검증: node tests/eqwidth.test.js
 */
(function (root) {
  'use strict';

  var SAFETY = 1.15;   // 과소추정이 겹침을 부르므로 넉넉하게 (빈칸은 겹침보다 낫다)

  // baseUnit(글자 크기) 1 당 폭. 한글 수식은 이탤릭 세리프로 그려진다.
  var W_DIGIT = 0.50;
  var W_ALPHA = 0.53;
  var W_HANGUL = 1.00;
  var W_OP = 0.78;     // + - = < > 앞뒤 여백 포함
  var W_PAREN = 0.36;
  var W_COMMA = 0.28;
  var W_TILDE = 0.34;  // ~ 넓은 공백
  var W_GRAVE = 0.18;  // ` 좁은 공백
  var SUB = 0.62;      // 첨자·from/to 축소 비율

  // 이름 하나로 그려지는 기호들의 폭 (단위: baseUnit)
  var SYMW = {
    inf: 0.95, rightarrow: 1.0, leftarrow: 1.0, cdot: 0.4, cdots: 1.1,
    times: 0.78, div: 0.78, pm: 0.78, approx: 0.78, equiv: 0.78,
    '!=': 0.78, '>=': 0.78, '<=': 0.78, '+-': 0.78,
    alpha: 0.6, beta: 0.6, gamma: 0.6, delta: 0.6, theta: 0.6, lambda: 0.6,
    mu: 0.6, pi: 0.6, sigma: 0.6, phi: 0.6, omega: 0.6, epsilon: 0.6,
    DELTA: 0.8, SIGMA: 0.85, PI: 0.8, OMEGA: 0.85,
    partial: 0.6, nabla: 0.7, angle: 0.6, circ: 0.35, prime: 0.25,
    in: 0.7, notin: 0.7, subset: 0.7, union: 0.7, inter: 0.7,
    emptyset: 0.65, forall: 0.65, exists: 0.65, therefore: 0.8, because: 0.8,
  };

  // from/to 를 받는 큰 연산자 — 첨자가 아래위로 붙는다
  var BIGOP = { lim: 1.55, sum: 1.05, prod: 1.05, int: 0.6, dint: 1.0, oint: 0.7,
    limsup: 2.6, liminf: 2.4 };
  var FUNC = { sin: 1.3, cos: 1.4, tan: 1.3, sec: 1.3, csc: 1.3, cot: 1.3,
    log: 1.5, ln: 0.9, exp: 1.5, max: 1.6, min: 1.6, gcd: 1.6, det: 1.3,
    sinh: 1.8, cosh: 1.9, tanh: 1.8, arcsin: 2.6, arccos: 2.7, arctan: 2.6 };

  function tokenize(s) {
    var out = [];
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{' || c === '}') { out.push({ t: c }); i++; continue; }
      if (c === '^' || c === '_') { out.push({ t: 'sup', v: c }); i++; continue; }
      if (c === '#' || c === '&') { out.push({ t: c }); i++; continue; }
      var two = s.substr(i, 2);
      if (two === '!=' || two === '>=' || two === '<=' || two === '+-' || two === '-+') {
        out.push({ t: 'sym', v: two }); i += 2; continue;
      }
      var m = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(i));
      if (m) { out.push({ t: 'word', v: m[0] }); i += m[0].length; continue; }
      var d = /^[0-9]+(\.[0-9]+)?/.exec(s.slice(i));
      if (d) { out.push({ t: 'num', v: d[0] }); i += d[0].length; continue; }
      out.push({ t: 'ch', v: c });
      i++;
    }
    return out;
  }

  function measure(script) {
    var toks = tokenize(String(script == null ? '' : script));
    var p = 0;

    function group() {           // 다음 한 덩어리의 폭
      if (!toks[p]) return 0;
      if (toks[p].t === '{') {
        p++;
        return run('}');
      }
      return atom();
    }

    function atom() {
      var tk = toks[p];
      if (!tk) return 0;
      p++;
      if (tk.t === 'num') return tk.v.length * W_DIGIT;
      if (tk.t === 'sym') return SYMW[tk.v] || W_OP;
      if (tk.t === 'ch') {
        var c = tk.v;
        if ('+-=<>'.indexOf(c) >= 0) return W_OP;
        if ('()[]|'.indexOf(c) >= 0) return W_PAREN;
        if (c === ',' || c === ';') return W_COMMA;
        if (c === '~') return W_TILDE;
        if (c === '`') return W_GRAVE;
        if (c === "'") return 0.25;
        if (c.charCodeAt(0) > 0x1100) return W_HANGUL;   // 한글·전각
        return W_ALPHA;
      }
      var v = tk.v;
      if (v === 'over') return 0;                        // run() 에서 처리
      if (v === 'sqrt' || v === 'root') return 0.95 + group();
      if (v === 'of') return 0;
      if (v === 'left' || v === 'right') {
        // 뒤따르는 구분자 한 개를 함께 먹는다
        if (toks[p] && (toks[p].t === 'ch' || toks[p].t === 'word')) p++;
        return W_PAREN;
      }
      // 정자체(rm)·굵은체는 이탤릭 변수보다 눈에 띄게 넓다 — 실측 {rm A} = 1.5
      if (v === 'rm' || v === 'bold') return group() * 1.9;
      if (v === 'it') return group();
      if (BIGOP[v] != null) {
        var w = BIGOP[v];
        var side = 0;
        // from{...} to{...} 는 연산자 아래위로 들어간다. 옆에 붙는 게 아니므로
        // 더하면 안 되고, 연산자 자신과 첨자 중 넓은 쪽이 그 칸의 폭이 된다.
        while (toks[p] && toks[p].t === 'word' && (toks[p].v === 'from' || toks[p].v === 'to')) {
          p++;
          side = Math.max(side, group() * SUB);
        }
        return Math.max(w, side);
      }
      if (FUNC[v] != null) return FUNC[v];
      if (SYMW[v] != null) return SYMW[v];
      if (v === 'cases' || v === 'matrix' || v === 'pile') return 0.9 + rowsMax();
      if (v === 'from' || v === 'to') return group() * SUB;   // 홀로 쓰인 경우
      return v.length * W_ALPHA;                              // 미지의 식별자
    }

    // cases{ a & b # c & d } — 행 중 가장 넓은 것
    function rowsMax() {
      if (!toks[p] || toks[p].t !== '{') return 0;
      p++;
      var best = 0, cur = 0;
      while (toks[p]) {
        if (toks[p].t === '}') { p++; break; }
        if (toks[p].t === '#') { p++; best = Math.max(best, cur); cur = 0; continue; }
        if (toks[p].t === '&') { p++; cur += 0.6; continue; }
        cur += piece();
      }
      return Math.max(best, cur);
    }

    function piece() {
      var tk = toks[p];
      if (!tk) return 0;
      if (tk.t === 'sup') { p++; return group() * SUB; }      // ^ 또는 _
      if (tk.t === 'word' && tk.v === 'over') { p++; return 0; }
      return group();
    }

    // over 는 바로 앞 덩어리와 바로 뒤 덩어리만 묶는 이항 연산자다.
    // `A over B = C over D` 처럼 분수가 여러 개 나열될 수 있으므로
    // 식 전체를 하나의 분수로 보면 안 된다(그러면 나머지 항이 통째로 사라진다).
    function run(stop) {
      var total = 0;
      var last = 0;          // 직전 덩어리 — over 를 만나면 분모와 묶인다
      while (toks[p]) {
        if (stop && toks[p].t === stop) { p++; break; }
        if (toks[p].t === '#' || toks[p].t === '&') break;
        if (toks[p].t === 'word' && toks[p].v === 'over') {
          p++;
          var denom = piece();
          last = Math.max(last, denom) + 0.35;   // 분수선 여백
          continue;
        }
        total += last;
        last = piece();
      }
      return total + last;
    }

    return run(null);
  }

  // 한글이 만든 수식 238개에 최소제곱으로 맞춘 값: 실제 ≈ 1.237 × measure + 0.04.
  // 여기에 SAFETY 를 곱해 과소추정(=겹침)을 8% 아래로 눌렀다. tests/eqwidth.test.js 참고.
  var FIT_A = 1.237;
  var FIT_B = 0.04;

  /** @returns {number} baseUnit 배수로 나타낸 수식 폭 */
  function widthUnits(script) {
    return Math.max(0.8, (measure(script) * FIT_A + FIT_B) * SAFETY);
  }

  /**
   * 수식이 차지할 높이(baseUnit 배수).
   * 폭과 같은 이유로 필요하다 — 낮게 잡으면 위아래 줄과 겹친다.
   * 분수는 분자/분모가 위아래로 쌓이고 cases 는 행마다 쌓인다.
   */
  function heightUnits(script) {
    var s = String(script == null ? '' : script);

    // over / sqrt 는 낱말 단위로 센다. 정규식 단어경계는 쓰지 않는다 —
    // 소스에 백슬래시를 넣다가 제어문자로 변해 조용히 매칭이 죽은 적이 있다.
    var words = s.split(/[^A-Za-z]+/);
    var overs = 0;
    var hasSqrt = false;
    for (var i = 0; i < words.length; i++) {
      if (words[i] === 'over') overs++;
      else if (words[i] === 'sqrt' || words[i] === 'root') hasSqrt = true;
    }

    var rows = 1;
    var m = /(cases|matrix|pile)s*{([sS]*)}/.exec(s);
    if (m) rows = m[2].split('#').length;

    var h = 1.2;
    // 분수는 분자·분모가 위아래로 쌓인다. 여러 개가 나란히 놓여도 높이는 한 겹이지만
    // 중첩되면 더 자라므로 개수에 따라 완만히 올린다.
    if (overs) h = 1.2 + (1 + Math.min(2, Math.floor((overs - 1) / 3))) * 1.15;
    else if (hasSqrt || s.indexOf('^') >= 0 || s.indexOf('_') >= 0) h = 1.45;
    if (rows > 1) h = Math.max(h, 1.1 + rows * 1.15);
    return h;
  }

  var api = { widthUnits: widthUnits, heightUnits: heightUnits, measure: measure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EqWidth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
