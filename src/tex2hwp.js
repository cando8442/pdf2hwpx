/**
 * LaTeX -> 한글(HWP) 수식 스크립트 변환기
 *
 * 한글 수식은 중위 표기(`a over b`)를 쓰므로 정규식 치환으로는 중첩을 못 다룬다.
 * 토크나이저 + 재귀하강 파서로 구문을 실제로 해석한 뒤 다시 조립한다.
 *
 * 변환 불가 명령은 버리지 않고 warnings에 담아 검수 화면에서 빨갛게 표시한다.
 */
(function (root) {
  'use strict';

  // ── 단순 치환 (인자 없는 명령) ──────────────────────────────
  const SYMBOL = {
    to: 'rightarrow', rightarrow: 'rightarrow', longrightarrow: 'rightarrow',
    gets: 'leftarrow', leftarrow: 'leftarrow',
    infty: 'inf', infin: 'inf',
    ne: '!=', neq: '!=', le: '<=', leq: '<=', ge: '>=', geq: '>=',
    cdot: 'cdot', cdots: 'cdots', dots: 'cdots', ldots: 'cdots',
    times: 'times', div: 'div', pm: '+-', mp: '-+',
    approx: 'approx', equiv: 'equiv', sim: 'sim', propto: 'propto',
    in: 'in', notin: 'notin', subset: 'subset', supset: 'supset',
    cup: 'union', cap: 'inter', emptyset: 'emptyset', varnothing: 'emptyset',
    forall: 'forall', exists: 'exists', therefore: 'therefore', because: 'because',
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta',
    epsilon: 'epsilon', varepsilon: 'varepsilon', zeta: 'zeta', eta: 'eta',
    theta: 'theta', vartheta: 'vartheta', iota: 'iota', kappa: 'kappa',
    lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'xi', pi: 'pi', rho: 'rho',
    sigma: 'sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi', varphi: 'varphi',
    chi: 'chi', psi: 'psi', omega: 'omega',
    Gamma: 'GAMMA', Delta: 'DELTA', Theta: 'THETA', Lambda: 'LAMBDA',
    Xi: 'XI', Pi: 'PI', Sigma: 'SIGMA', Phi: 'PHI', Psi: 'PSI', Omega: 'OMEGA',
    prime: "'", circ: 'circ', angle: 'angle',
    partial: 'partial', nabla: 'nabla',
    // 공백류 (한글 수식: ~ = 넓은 공백, ` = 좁은 공백)
    quad: '~~~', qquad: '~~~~~', ',': '`', ';': '~', ':': '`', '!': '',
    ' ': '~', enspace: '~', thinspace: '`',
  };

  // 정자체로 나가야 하는 함수 이름
  const FUNCS = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'log', 'ln', 'exp',
    'max', 'min', 'gcd', 'det', 'dim', 'ker', 'arcsin', 'arccos', 'arctan',
    'sinh', 'cosh', 'tanh'];

  // from/to 를 받는 큰 연산자
  const BIGOP = {
    sum: 'sum', prod: 'prod', int: 'int', iint: 'dint', oint: 'oint',
    lim: 'lim', limsup: 'limsup', liminf: 'liminf', bigcup: 'union', bigcap: 'inter',
  };

  // 레이아웃 전용 — 버려도 되는 것
  const IGNORE = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits',
    'nolimits', 'big', 'Big', 'bigg', 'Bigg', 'mathstrut', 'vphantom',
    'hfill', 'nonumber', 'small', 'large', 'strut']);

  const DELIM = {
    '(': '(', ')': ')', '[': '[', ']': ']', '|': '|', '/': '/',
    '\\{': '{', '\\}': '}', '\\lvert': '|', '\\rvert': '|',
    '\\lVert': '‖', '\\rVert': '‖', '\\langle': '<', '\\rangle': '>',
  };

  // ── 토크나이저 ───────────────────────────────────────────────
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        if (src[i + 1] === '\\') { out.push({ t: 'nl' }); i += 2; continue; }
        const m = /^\\([a-zA-Z]+)\*?/.exec(src.slice(i));
        if (m) { out.push({ t: 'cmd', v: m[1] }); i += m[0].length; continue; }
        out.push({ t: 'cmd', v: src[i + 1] });
        i += 2;
        continue;
      }
      if (c === '{') { out.push({ t: '{' }); i++; continue; }
      if (c === '}') { out.push({ t: '}' }); i++; continue; }
      if (c === '_' || c === '^') { out.push({ t: c }); i++; continue; }
      if (c === '&') { out.push({ t: 'amp' }); i++; continue; }
      if (/\s/.test(c)) {
        if (out.length && out[out.length - 1].t !== 'sp') out.push({ t: 'sp' });
        i++;
        continue;
      }
      out.push({ t: 'ch', v: c });
      i++;
    }
    return out;
  }

  // ── 파서 ─────────────────────────────────────────────────────
  function convert(tex) {
    const warnings = [];
    const toks = tokenize(String(tex == null ? '' : tex));
    let p = 0;

    const peek = () => toks[p];
    const next = () => toks[p++];
    const skipSp = () => { while (toks[p] && toks[p].t === 'sp') p++; };

    function balanced(s) {
      let d = 0;
      for (const c of s) {
        if (c === '{') d++;
        else if (c === '}') { d--; if (d < 0) return false; }
      }
      return d === 0;
    }

    // 첨자/분자 자리에 넣을 때 중괄호 정리
    function braced(s) {
      const t = String(s).trim();
      if (t === '') return '{}';
      if (/^\{[\s\S]*\}$/.test(t) && balanced(t.slice(1, -1))) return t;
      if (/^[A-Za-z0-9]$/.test(t)) return t;
      return '{' + t + '}';
    }

    function strip(s) {
      const t = String(s).trim();
      return /^\{[\s\S]*\}$/.test(t) && balanced(t.slice(1, -1)) ? t.slice(1, -1) : t;
    }

    // 하나의 "원자"를 읽는다 (첨자의 피연산자 단위)
    function atom() {
      skipSp();
      const tk = peek();
      if (!tk) return '';
      if (tk.t === '{') { next(); return braced(seq('}')); }
      if (tk.t === 'cmd') { next(); return cmd(tk.v); }
      if (tk.t === 'ch') { next(); return tk.v; }
      return '';
    }

    function cmd(name) {
      if (name === 'left' || name === 'right') return delimiter(name);
      if (IGNORE.has(name)) return '';

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const a = atom();
        const b = atom();
        return braced(a) + ' over ' + braced(b);
      }
      if (name === 'sqrt') {
        skipSp();
        if (peek() && peek().t === 'ch' && peek().v === '[') {
          next();
          let idx = '';
          while (peek() && !(peek().t === 'ch' && peek().v === ']')) {
            const t = next();
            idx += t.t === 'ch' ? t.v : (t.t === 'cmd' ? cmd(t.v) : '');
          }
          if (peek()) next();
          return 'root ' + braced(idx) + ' of ' + braced(atom());
        }
        return 'sqrt ' + braced(atom());
      }
      if (name === 'begin') return environment();
      if (name === 'end') { rawGroup(); return ''; }
      if (name === 'text' || name === 'textrm' || name === 'mbox' || name === 'textbf') {
        return '"' + rawGroup() + '"';
      }
      if (name === 'mathrm' || name === 'rm' || name === 'operatorname') {
        return '{rm ' + rawGroup().trim() + '}';
      }
      if (name === 'mathbf' || name === 'bf' || name === 'boldsymbol') {
        return '{bold ' + rawGroup().trim() + '}';
      }
      if (name === 'mathit' || name === 'it' || name === 'mathnormal') {
        return rawGroup().trim();
      }
      if (name === 'overline' || name === 'bar') return 'bar ' + braced(atom());
      if (name === 'underline') return 'under ' + braced(atom());
      if (name === 'hat' || name === 'widehat') return 'hat ' + braced(atom());
      if (name === 'tilde' || name === 'widetilde') return 'tilde ' + braced(atom());
      if (name === 'vec' || name === 'overrightarrow') return 'vec ' + braced(atom());
      if (name === 'dot') return 'dot ' + braced(atom());
      if (name === 'ddot') return 'ddot ' + braced(atom());
      if (name === 'binom' || name === 'dbinom') {
        const a = atom();
        const b = atom();
        return 'left ( pile{' + strip(a) + ' # ' + strip(b) + '} right )';
      }
      if (BIGOP[name]) return bigop(BIGOP[name]);
      if (FUNCS.includes(name)) return name + ' ';
      if (Object.prototype.hasOwnProperty.call(SYMBOL, name)) {
        const v = SYMBOL[name];
        // 단어형 심볼은 앞뒤를 띄워야 한다. `x\to a` 가 `xrightarrow a` 로 붙으면
        // 한글이 통째로 하나의 식별자로 읽어 수식이 깨진다.
        return /^[a-zA-Z]/.test(v) ? ' ' + v + ' ' : v;
      }
      if (name === '{') return ' left { ';
      if (name === '}') return ' right } ';
      if (name === '%' || name === '$' || name === '#' || name === '&') return name;

      warnings.push('\\' + name);
      return name;
    }

    // \left( \right| 등 — 구분자 하나를 소비
    function delimiter(kind) {
      skipSp();
      const tk = peek();
      if (!tk) return '';
      let d = '';
      if (tk.t === 'ch') {
        if (tk.v === '.') { next(); return ''; }
        next();
        d = DELIM[tk.v] || tk.v;
      } else if (tk.t === 'cmd') {
        next();
        d = DELIM['\\' + tk.v] || '';
        if (!d) return '';
      } else {
        return '';
      }
      return ' ' + kind + ' ' + d + ' ';
    }

    // \sum_{a}^{b}, \lim_{x \to 0}
    const always = (a) => { const t = String(a).trim();
      return /^\{[\s\S]*\}$/.test(t) && balanced(t.slice(1, -1)) ? t : '{' + t + '}'; };

    const pad = (a) => (a.charAt(0) === '{' ? a : ' ' + a);

    function bigop(op) {
      let s = op;
      for (;;) {
        skipSp();
        const tk = peek();
        // 인자가 중괄호로 시작하지 않으면 띄워야 한다 (`to` + `n` = `ton`)
        if (tk && tk.t === '_') { next(); s += ' from' + pad(braced(atom())); continue; }
        if (tk && tk.t === '^') { next(); s += ' to' + pad(braced(atom())); continue; }
        break;
      }
      return s + ' ';
    }

    // \begin{env} ... \end{env}
    function environment() {
      const env = rawGroup().trim();
      // array 는 열 정렬 인자를 하나 더 받는다
      if (env === 'array') { skipSp(); if (peek() && peek().t === '{') rawGroup(); }

      const rows = [];
      let row = [];
      let cell = '';
      const flushCell = () => { row.push(cell.trim()); cell = ''; };
      const flushRow = () => { flushCell(); rows.push(row); row = []; };

      for (;;) {
        skipSp();
        const tk = peek();
        if (!tk) break;
        if (tk.t === 'cmd' && tk.v === 'end') { next(); rawGroup(); break; }
        if (tk.t === 'nl') {
          next();
          skipSp();
          // \\[6pt] 같은 간격 옵션 제거
          if (peek() && peek().t === 'ch' && peek().v === '[') {
            while (peek() && !(peek().t === 'ch' && peek().v === ']')) next();
            if (peek()) next();
          }
          flushRow();
          continue;
        }
        if (tk.t === 'amp') { next(); flushCell(); continue; }
        cell += piece();
      }
      flushRow();

      const keep = rows.filter((r) => r.some((c) => c !== ''));
      const body = keep.map((r) => r.join(' & ')).join(' # ');

      if (env === 'cases') return 'cases{ ' + body + ' }';
      if (env === 'matrix') return 'matrix{ ' + body + ' }';
      if (env === 'pmatrix') return 'left ( matrix{ ' + body + ' } right )';
      if (env === 'bmatrix') return 'left [ matrix{ ' + body + ' } right ]';
      if (env === 'vmatrix') return 'left | matrix{ ' + body + ' } right |';
      if (env === 'array') return 'matrix{ ' + body + ' }';
      if (env === 'aligned' || env === 'align' || env === 'gathered' ||
          env === 'split' || env === 'gather' || env === 'eqnarray') {
        return keep.map((r) => r.join(' ')).join(' # ');
      }
      warnings.push('\\begin{' + env + '}');
      return body;
    }

    // { ... } 안을 문자 그대로 (환경 이름, \text 내용용)
    function rawGroup() {
      skipSp();
      if (!peek() || peek().t !== '{') return '';
      next();
      let depth = 1;
      let s = '';
      while (peek()) {
        const tk = next();
        if (tk.t === '{') { depth++; s += '{'; continue; }
        if (tk.t === '}') { depth--; if (!depth) break; s += '}'; continue; }
        if (tk.t === 'ch') s += tk.v;
        else if (tk.t === 'sp') s += ' ';
        else if (tk.t === 'cmd') s += '\\' + tk.v;
      }
      return s;
    }

    function piece() {
      const tk = next();
      if (!tk) return '';
      switch (tk.t) {
        case 'sp': return ' ';
        case 'ch': return tk.v;
        case 'cmd': return cmd(tk.v);
        case '{': return braced(seq('}'));
        case '}': return '';
        // 첨자는 한 글자여도 반드시 중괄호로 묶는다.
        // `x^2+ax+b` 를 한글은 `x^(2+ax+b)` 로 읽어 지수가 뒤까지 먹는다.
        case '_': return '_' + always(atom());
        case '^': return '^' + always(atom());
        case 'nl': return ' # ';
        case 'amp': return ' & ';
        default: return '';
      }
    }

    function seq(stop) {
      let s = '';
      while (peek()) {
        if (stop && peek().t === stop) { next(); break; }
        s += piece();
      }
      return s;
    }

    let script = seq(null);

    // ── 뒷정리 ────────────────────────────────────────────────
    // `left {` / `right }` 의 공백은 문법의 일부라 아래 정리에서 지워지면 안 된다.
    script = script
      .replace(/[ \t\r\n]+/g, ' ')
      .replace(/ +([,;])/g, '$1')
      .replace(/ {2,}/g, ' ')
      .trim();

    return { script, warnings: Array.from(new Set(warnings)) };
  }

  const api = { convert, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Tex2Hwp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
