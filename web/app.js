/**
 * pdf2hwpx 웹앱
 *
 * PDF → 페이지 이미지(pdf.js) → Claude 비전 → LaTeX 블록 → 검수 → hwpx(조립기)
 * 서버가 없다. API 호출도, 조립도 전부 브라우저에서 일어난다.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'pdf2hwpx.key';
  var LS_MODEL = 'pdf2hwpx.model';
  var LS_REMEMBER = 'pdf2hwpx.remember';

  // 시크릿 창이나 사이트 데이터 차단 설정에서는 localStorage 접근 자체가 예외를 던진다.
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // 한글 조립기가 아는 이름만 허용한다. 모델이 엉뚱한 값을 주면 여기서 걸러진다.
  var PARA_NAMES = ['title', 'h2', 'qhead', 'body', 'choice', 'center', 'plain', 'foot'];
  var CHAR_NAMES = ['body', 'bold', 'h1', 'h2', 'sub', 'tag', 'no', 'pt', 'foot', 'rule'];

  var state = {
    pdfName: '문서',
    pages: [],      // {n, canvas, url, on}
    blocks: [],     // {id, page, t, para, pageBreak, runs[], box, w, include}
    curPage: 1,
  };
  var uid = 0;

  // ── 프롬프트 ────────────────────────────────────────────────
  var SYSTEM = [
    '너는 한국 고등학교 수학 학습지 PDF 페이지를 구조화 JSON으로 옮기는 변환기다.',
    '오직 JSON 객체 하나만 출력한다. 설명·인사말·코드펜스를 붙이지 않는다.',
    '',
    '## 출력 형식',
    '{"blocks":[ ... ]}',
    '',
    '문단 블록: {"t":"p","para":"<문단모양>","runs":[ ... ]}',
    '그림 블록: {"t":"fig","box":[x0,y0,x1,y1],"caption":"짧은 설명"}',
    '  box 는 페이지 좌상단(0,0)~우하단(1,1) 기준 비율이다. 그래프·도형 그림에만 쓴다.',
    '',
    'run 은 두 가지뿐이다.',
    '  텍스트: {"k":"t","v":"글자","s":"<글자모양>"}',
    '  수식  : {"k":"eq","v":"<LaTeX>"}   ← v 는 순수 LaTeX. $ 나 \\( \\) 를 붙이지 않는다.',
    '',
    '문단모양(para): title(큰 제목) / h2(영역 제목) / qhead(문항 번호 줄) /',
    '  body(본문·들여쓰기) / choice(선택지 줄) / center(가운데 정렬 디스플레이 수식) /',
    '  plain(들여쓰기 없는 줄) / foot(꼬리말)',
    '글자모양(s, 생략하면 body): body / bold / h1(큰 제목) / h2(영역 제목) /',
    '  sub(작은 회색 보조) / tag(아주 작은 회색 꼬리표) / no(문항 번호) / pt(배점) / foot / rule',
    '',
    '## 규칙',
    '1. 보이는 것만 옮긴다. 없는 문장·수식·문항을 지어내지 않는다.',
    '2. 수식은 아무리 짧아도 eq 로 낸다. 변수 하나(x), 숫자와 기호가 섞인 것(2n+1),',
    '   지수·분수·근호·극한·적분은 전부 수식이다. 반대로 순수 국문·순수 정수는 텍스트다.',
    '3. 텍스트 run 의 앞뒤 공백을 살린다. "함수 " + eq + " 의 그래프" 처럼 이어 붙였을 때',
    '   원문 문장이 그대로 복원되어야 한다.',
    '4. 문항 번호(01, 12 등)는 s:"no", 배점([4점])은 s:"pt" 로 낸다.',
    '5. 선택지 ①②③④⑤ 는 한 줄에 모아 para:"choice" 한 블록으로 낸다.',
    '6. 줄 가운데 홀로 크게 놓인 수식은 para:"center" 블록으로 낸다.',
    '7. 쪽 번호, 머리말/꼬리말, 워터마크, 로고는 옮기지 않는다.',
    '8. LaTeX 은 표준 명령만 쓴다: \\frac \\dfrac \\sqrt \\lim \\to \\infty \\ne \\le \\ge',
    '   \\times \\cdot \\left \\right \\begin{cases} \\mathrm \\sum \\int 등.',
    '   \\text 대신 한글은 텍스트 run 으로 빼는 편이 낫다.',
    '9. 근호가 어디까지 덮는지, 극한의 좌우 방향(x\\to-1-), 지수의 범위를 특히 정확히 본다.',
  ].join('\n');

  var USER = [
    '이 학습지 페이지를 위 형식의 JSON 으로 옮겨라.',
    '수식은 한 글자만 틀려도 문제가 달라진다. 근호 범위, 분수의 분자/분모 경계,',
    '지수의 끝, 극한의 화살표 방향을 원본과 하나씩 대조하며 읽어라.',
    'JSON 객체 하나만 출력한다.',
  ].join('\n');

  // ── ① 준비 ─────────────────────────────────────────────────
  var keyEl = $('key');
  var rememberEl = $('remember');
  var keyStatEl = $('keyStat');

  rememberEl.checked = store.get(LS_REMEMBER) !== '0';
  keyEl.value = (rememberEl.checked && store.get(LS_KEY)) || '';

  // 키 끝 4자리만 보여 준다. 저장됐는지 눈으로 확인하되 키가 화면에 드러나지는 않게.
  function showKeyStat(msg) {
    if (msg) { keyStatEl.textContent = msg; return; }
    var saved = store.get(LS_KEY);
    if (!rememberEl.checked) keyStatEl.textContent = '기억하지 않음 — 새로고침하면 다시 입력해야 합니다';
    else if (saved) keyStatEl.textContent = '✓ 저장됨 (…' + saved.slice(-4) + ')';
    else keyStatEl.textContent = '키를 입력하면 자동으로 저장됩니다';
  }

  // change 가 아니라 input 에 건다. 붙여넣고 바로 PDF 를 끌어다 놓아도 저장되도록.
  function saveKey() {
    var v = keyEl.value.trim();
    if (!rememberEl.checked) return;
    if (!v) { store.del(LS_KEY); showKeyStat(); return; }
    if (store.set(LS_KEY, v)) showKeyStat();
    else showKeyStat('⚠ 이 브라우저가 저장을 막고 있습니다 (시크릿 창 여부를 확인하세요)');
  }
  keyEl.addEventListener('input', saveKey);
  keyEl.addEventListener('change', saveKey);

  rememberEl.addEventListener('change', function () {
    store.set(LS_REMEMBER, rememberEl.checked ? '1' : '0');
    if (rememberEl.checked) saveKey();
    else store.del(LS_KEY);
    showKeyStat();
  });

  $('clearKey').addEventListener('click', function () {
    store.del(LS_KEY);
    keyEl.value = '';
    showKeyStat();
  });
  showKeyStat();

  var modelEl = $('model');
  modelEl.value = store.get(LS_MODEL) || 'claude-opus-5';
  modelEl.addEventListener('change', function () {
    store.set(LS_MODEL, modelEl.value);
  });

  var drop = $('drop');
  $('pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function (e) {
    if (e.target.files[0]) loadPdf(e.target.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('hot'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('hot'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files[0];
    if (f && /\.pdf$/i.test(f.name)) loadPdf(f);
  });

  function loadPdf(file) {
    state.pdfName = file.name.replace(/\.pdf$/i, '');
    var reader = new FileReader();
    reader.onload = function () {
      var maxPx = parseInt($('dpi').value, 10);
      // 워커도 같은 출처에서 받는다 (CSP script-src/worker-src 를 'self' 로 좁히기 위해)
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise.then(function (pdf) {
        state.pages = [];
        $('pages').textContent = '';
        var chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (n) {
            chain = chain.then(function () { return renderPage(pdf, n, maxPx); });
          })(i);
        }
        return chain;
      }).then(syncPickHint).catch(function (e) {
        alert('PDF 를 여는 데 실패했습니다: ' + e.message);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function renderPage(pdf, n, maxPx) {
    return pdf.getPage(n).then(function (page) {
      var v1 = page.getViewport({ scale: 1 });
      var scale = Math.min(3, maxPx / Math.max(v1.width, v1.height));
      var vp = page.getViewport({ scale: scale });
      var cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
        .then(function () {
          var pg = { n: n, canvas: cv, url: cv.toDataURL('image/png'), on: true };
          state.pages.push(pg);
          addThumb(pg);
        });
    });
  }

  function addThumb(pg) {
    var d = document.createElement('div');
    d.className = 'thumb';
    var img = document.createElement('img');
    img.src = pg.url;
    var tag = document.createElement('span');
    tag.className = 'n';
    tag.textContent = pg.n;
    d.appendChild(img);
    d.appendChild(tag);
    d.addEventListener('click', function () {
      pg.on = !pg.on;
      d.classList.toggle('off', !pg.on);
      syncPickHint();
    });
    $('pages').appendChild(d);
  }

  function syncPickHint() {
    var on = state.pages.filter(function (p) { return p.on; }).length;
    $('pickHint').textContent = state.pages.length
      ? on + ' / ' + state.pages.length + ' 쪽 선택됨 (썸네일을 눌러 제외)'
      : '';
    $('run').disabled = on === 0;
  }

  // ── ② 읽기 ─────────────────────────────────────────────────
  $('run').addEventListener('click', function () {
    var key = keyEl.value.trim();
    if (!key) { alert('Anthropic API 키를 입력하세요.'); keyEl.focus(); return; }
    saveKey();
    convertAll(key);
  });

  function log(msg, isErr) {
    var d = document.createElement('div');
    if (isErr) d.className = 'err';
    d.textContent = msg;
    $('log').appendChild(d);
    $('log').scrollTop = $('log').scrollHeight;
  }

  function step(n) {
    ['st1', 'st2', 'st3'].forEach(function (id, i) {
      $(id).classList.toggle('on', i === n - 1);
    });
  }

  function convertAll(key) {
    var targets = state.pages.filter(function (p) { return p.on; });
    state.blocks = [];
    $('setup').classList.add('hidden');
    $('progress').classList.remove('hidden');
    $('log').textContent = '';
    $('barFill').style.width = '0%';
    step(2);

    var model = modelEl.value;
    var done = 0;
    var chain = Promise.resolve();

    targets.forEach(function (pg) {
      chain = chain.then(function () {
        log(pg.n + '쪽 읽는 중…');
        return readPage(pg, key, model).then(function (blocks) {
          var eqs = 0;
          blocks.forEach(function (b) {
            b.id = ++uid;
            b.page = pg.n;
            (b.runs || []).forEach(function (r) { if (r.k === 'eq') eqs++; });
            state.blocks.push(b);
          });
          log('  → 블록 ' + blocks.length + '개, 수식 ' + eqs + '개');
        }).catch(function (e) {
          log('  ✗ ' + pg.n + '쪽 실패: ' + e.message, true);
        }).then(function () {
          done++;
          $('barFill').style.width = Math.round(done / targets.length * 100) + '%';
        });
      });
    });

    chain.then(function () {
      if (!state.blocks.length) {
        log('읽어낸 내용이 없습니다. 키와 모델을 확인하세요.', true);
        $('setup').classList.remove('hidden');
        step(1);
        return;
      }
      return cropFigures().then(openReview);
    });
  }

  function readPage(pg, key, model) {
    var b64 = pg.url.split(',')[1];
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
            { type: 'text', text: USER },
          ],
        }],
      }),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + res.status));
        return j;
      });
    }).then(function (j) {
      var txt = (j.content || []).filter(function (c) { return c.type === 'text'; })
        .map(function (c) { return c.text; }).join('');
      return sanitize(parseJson(txt));
    });
  }

  // 모델이 코드펜스나 군더더기를 붙여도 JSON 만 뽑아낸다.
  function parseJson(txt) {
    var s = String(txt);
    var fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
    if (fence) s = fence[1];
    var a = s.indexOf('{');
    var b = s.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('JSON 을 찾지 못했습니다');
    return JSON.parse(s.slice(a, b + 1));
  }

  function sanitize(obj) {
    var out = [];
    var blocks = (obj && obj.blocks) || [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || typeof b !== 'object') continue;
      if (b.t === 'fig') {
        var box = Array.isArray(b.box) ? b.box.map(Number) : null;
        if (!box || box.length !== 4 || box.some(isNaN)) continue;
        out.push({ t: 'fig', box: clampBox(box), caption: String(b.caption || ''), w: 70, include: true });
        continue;
      }
      var runs = [];
      var src = Array.isArray(b.runs) ? b.runs : [];
      for (var j = 0; j < src.length; j++) {
        var r = src[j];
        if (!r || r.v == null) continue;
        var v = String(r.v);
        if (r.k === 'eq') {
          if (!v.trim()) continue;
          runs.push({ k: 'eq', v: v.replace(/^\$+|\$+$/g, '').trim() });
        } else {
          if (v === '') continue;
          runs.push({ k: 't', v: v, s: CHAR_NAMES.indexOf(r.s) >= 0 ? r.s : 'body' });
        }
      }
      if (!runs.length) continue;
      out.push({
        t: 'p',
        para: PARA_NAMES.indexOf(b.para) >= 0 ? b.para : 'body',
        pageBreak: false,
        runs: runs,
      });
    }
    return out;
  }

  function clampBox(b) {
    var x0 = Math.max(0, Math.min(1, Math.min(b[0], b[2])));
    var y0 = Math.max(0, Math.min(1, Math.min(b[1], b[3])));
    var x1 = Math.max(0, Math.min(1, Math.max(b[0], b[2])));
    var y1 = Math.max(0, Math.min(1, Math.max(b[1], b[3])));
    if (x1 - x0 < 0.03) { x0 = Math.max(0, x0 - 0.02); x1 = Math.min(1, x1 + 0.02); }
    if (y1 - y0 < 0.03) { y0 = Math.max(0, y0 - 0.02); y1 = Math.min(1, y1 + 0.02); }
    return [x0, y0, x1, y1];
  }

  // 그림 블록의 박스를 실제 이미지로 잘라 둔다 (검수 미리보기와 hwpx 삽입에 함께 쓴다).
  function cropFigures() {
    var jobs = state.blocks.filter(function (b) { return b.t === 'fig'; }).map(function (b) {
      return function () {
        var pg = state.pages.filter(function (p) { return p.n === b.page; })[0];
        if (!pg) return Promise.resolve();
        var W = pg.canvas.width, H = pg.canvas.height;

        // 모델이 준 박스는 "이 근처"까지만 맞다. 실제 잉크 경계로 다시 맞춘다.
        try {
          var px = pg.canvas.getContext('2d').getImageData(0, 0, W, H).data;
          var snapped = FigCrop.snap(px, W, H, b.box);
          b.box = snapped.box;
          b.fixed = snapped.grew || snapped.shrank;
          b.grew = snapped.grew;
        } catch (e) {
          b.fixed = false;      // 캔버스를 읽지 못하면 모델 좌표를 그대로 쓴다
        }

        var sx = Math.round(b.box[0] * W), sy = Math.round(b.box[1] * H);
        var sw = Math.max(8, Math.round((b.box[2] - b.box[0]) * W));
        var sh = Math.max(8, Math.round((b.box[3] - b.box[1]) * H));
        var cv = document.createElement('canvas');
        cv.width = sw; cv.height = sh;
        cv.getContext('2d').drawImage(pg.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        b.url = cv.toDataURL('image/png');
        b.ratio = sh / sw;
        return new Promise(function (resolve) {
          cv.toBlob(function (blob) {
            blob.arrayBuffer().then(function (buf) {
              b.data = new Uint8Array(buf);
              resolve();
            });
          }, 'image/png');
        });
      };
    });
    return jobs.reduce(function (p, f) { return p.then(f); }, Promise.resolve());
  }

  // ── ③ 검수 ─────────────────────────────────────────────────
  function openReview() {
    $('progress').classList.add('hidden');
    $('reviewWrap').classList.remove('hidden');
    step(3);

    var sel = $('pageSel');
    sel.textContent = '';
    var seen = {};
    state.blocks.forEach(function (b) {
      if (seen[b.page]) return;
      seen[b.page] = true;
      var o = document.createElement('option');
      o.value = b.page;
      o.textContent = b.page + '쪽';
      sel.appendChild(o);
    });
    state.curPage = state.blocks.length ? state.blocks[0].page : 1;
    sel.value = state.curPage;
    sel.onchange = function () { state.curPage = +sel.value; showPage(); renderBlocks(); };
    $('onlyPage').onchange = renderBlocks;
    showPage();
    renderBlocks();
  }

  function showPage() {
    var pg = state.pages.filter(function (p) { return p.n === state.curPage; })[0];
    if (pg) $('origImg').src = pg.url;
  }

  function renderBlocks() {
    var host = $('blocks');
    host.textContent = '';
    var only = $('onlyPage').checked;
    var list = state.blocks.filter(function (b) { return !only || b.page === state.curPage; });
    var lastPage = null;

    if (!list.length) {
      var em = document.createElement('div');
      em.className = 'empty';
      em.textContent = '이 쪽에서 읽어낸 내용이 없습니다.';
      host.appendChild(em);
    }

    list.forEach(function (b) {
      if (!only && b.page !== lastPage) {
        var m = document.createElement('div');
        m.className = 'pagemark';
        m.textContent = b.page + '쪽';
        host.appendChild(m);
        lastPage = b.page;
      }
      host.appendChild(b.t === 'fig' ? figCard(b) : paraCard(b));
    });

    renderStat();
    typeset(host);
  }

  function paraCard(b) {
    var card = document.createElement('div');
    card.className = 'blk';

    var meta = document.createElement('div');
    meta.className = 'meta';
    var sel = document.createElement('select');
    PARA_NAMES.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    });
    sel.value = b.para;
    sel.onchange = function () { b.para = sel.value; };
    meta.appendChild(sel);

    var brk = document.createElement('label');
    brk.className = 'brk';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!b.pageBreak;
    cb.onchange = function () { b.pageBreak = cb.checked; };
    brk.appendChild(cb);
    brk.appendChild(document.createTextNode('쪽 나눔'));
    meta.appendChild(brk);

    var sp = document.createElement('span');
    sp.className = 'spacer';
    meta.appendChild(sp);

    var del = document.createElement('button');
    del.className = 'btn sm danger';
    del.textContent = '삭제';
    del.onclick = function () {
      state.blocks = state.blocks.filter(function (x) { return x !== b; });
      renderBlocks();
    };
    meta.appendChild(del);
    card.appendChild(meta);

    var content = document.createElement('div');
    content.className = 'content';
    b.runs.forEach(function (r) { content.appendChild(runEl(r, card)); });
    card.appendChild(content);
    return card;
  }

  function runEl(r, card) {
    if (r.k === 't') {
      var t = document.createElement('span');
      t.className = 'run t s-' + (r.s || 'body');
      t.contentEditable = 'true';
      t.textContent = r.v;
      t.addEventListener('input', function () { r.v = t.textContent; });
      return t;
    }
    var e = document.createElement('span');
    e.className = 'run eq';
    paintEq(e, r);
    e.addEventListener('click', function () { openEditor(e, r, card); });
    return e;
  }

  // MathJax 에 넘길 LaTeX 은 반드시 textContent 로 넣는다.
  // innerHTML 로 넣으면 부등호가 태그로 먹혀 수식이 통째로 사라진다.
  function paintEq(el, r) {
    var res = Tex2Hwp.convert(r.v);
    el.classList.toggle('bad', res.warnings.length > 0);
    el.textContent = '\\(' + r.v + '\\)';
    el.title = res.script + (res.warnings.length ? '  ⚠ ' + res.warnings.join(' ') : '');
    typeset(el);
  }

  function typeset(el) {
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([el]).catch(function () {});
    } else {
      setTimeout(function () { typeset(el); }, 300);
    }
  }

  function openEditor(anchor, r, card) {
    var old = card.querySelector('.eqedit');
    if (old) old.remove();

    var box = document.createElement('div');
    box.className = 'eqedit';

    var ta = document.createElement('textarea');
    ta.value = r.v;
    ta.spellcheck = false;

    var prev = document.createElement('div');
    prev.className = 'prev';

    var hwp = document.createElement('div');
    hwp.className = 'hwp';

    var warn = document.createElement('div');
    warn.className = 'warn';

    function refresh() {
      var res = Tex2Hwp.convert(ta.value);
      prev.textContent = '\\(' + ta.value + '\\)';
      typeset(prev);
      hwp.textContent = '한글 수식: ' + res.script;
      warn.textContent = res.warnings.length
        ? '⚠ 한글 수식으로 바꾸지 못한 명령: ' + res.warnings.join(', ')
        : '';
    }
    ta.addEventListener('input', refresh);
    refresh();

    var btns = document.createElement('div');
    btns.className = 'btns';
    var ok = document.createElement('button');
    ok.className = 'btn sm primary';
    ok.textContent = '적용';
    ok.onclick = function () {
      r.v = ta.value.trim();
      paintEq(anchor, r);
      box.remove();
      renderStat();
    };
    var cancel = document.createElement('button');
    cancel.className = 'btn sm';
    cancel.textContent = '닫기';
    cancel.onclick = function () { box.remove(); };
    btns.appendChild(ok);
    btns.appendChild(cancel);

    box.appendChild(ta);
    box.appendChild(prev);
    box.appendChild(hwp);
    box.appendChild(warn);
    box.appendChild(btns);
    card.appendChild(box);
    ta.focus();
  }

  function renderStat() {
    var eq = 0, bad = 0;
    state.blocks.forEach(function (b) {
      (b.runs || []).forEach(function (r) {
        if (r.k !== 'eq') return;
        eq++;
        if (Tex2Hwp.convert(r.v).warnings.length) bad++;
      });
    });
    $('revStat').textContent = '블록 ' + state.blocks.length + '개 · 수식 ' + eq + '개' +
      (bad ? ' · 확인 필요 ' + bad + '개' : '');
  }

  function figCard(b) {
    var card = document.createElement('div');
    card.className = 'blk';

    var meta = document.createElement('div');
    meta.className = 'meta';
    var lab = document.createElement('span');
    lab.style.fontSize = '11.5px';
    lab.style.color = 'var(--ink3)';
    lab.textContent = '그림' + (b.caption ? ' — ' + b.caption : '') +
      (b.grew ? '  (잘린 부분을 찾아 넓힘)' : b.fixed ? '  (여백 정리함)' : '');
    meta.appendChild(lab);
    var sp = document.createElement('span');
    sp.className = 'spacer';
    meta.appendChild(sp);
    var del = document.createElement('button');
    del.className = 'btn sm danger';
    del.textContent = '삭제';
    del.onclick = function () {
      state.blocks = state.blocks.filter(function (x) { return x !== b; });
      renderBlocks();
    };
    meta.appendChild(del);
    card.appendChild(meta);

    var wrap = document.createElement('div');
    wrap.className = 'figblk';
    var img = document.createElement('img');
    img.src = b.url || '';
    wrap.appendChild(img);

    var fx = document.createElement('div');
    fx.className = 'fx';

    var inc = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = b.include !== false;
    cb.onchange = function () { b.include = cb.checked; };
    inc.appendChild(cb);
    inc.appendChild(document.createTextNode(' 문서에 넣기'));
    fx.appendChild(inc);

    var wl = document.createElement('label');
    var wi = document.createElement('input');
    wi.type = 'number';
    wi.min = '20'; wi.max = '170'; wi.step = '5';
    wi.value = b.w;
    wi.onchange = function () { b.w = Math.max(20, Math.min(170, +wi.value || 70)); };
    wl.appendChild(document.createTextNode('가로 '));
    wl.appendChild(wi);
    wl.appendChild(document.createTextNode(' mm'));
    fx.appendChild(wl);

    var note = document.createElement('span');
    note.style.color = 'var(--ink3)';
    note.style.fontSize = '11.5px';
    note.textContent = '잘린 범위가 어긋나면 삭제하고 한글에서 직접 넣는 편이 빠릅니다.';
    fx.appendChild(note);

    wrap.appendChild(fx);
    card.appendChild(wrap);
    return card;
  }

  // ── 내보내기 ────────────────────────────────────────────────
  $('backBtn').addEventListener('click', function () {
    $('reviewWrap').classList.add('hidden');
    $('setup').classList.remove('hidden');
    step(1);
  });

  $('dlBtn').addEventListener('click', function () {
    var btn = $('dlBtn');
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    exportHwpx().catch(function (e) {
      alert('hwpx 를 만들지 못했습니다: ' + e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'hwpx 내려받기';
    });
  });

  function exportHwpx() {
    var breakPages = $('brk').value === '1';
    var out = [];
    var lastPage = null;

    state.blocks.forEach(function (b) {
      var isNewPage = lastPage !== null && b.page !== lastPage;
      lastPage = b.page;
      if (b.t === 'fig') {
        if (b.include === false || !b.data) return;
        out.push({ t: 'img', w: b.w, h: Math.round(b.w * (b.ratio || 0.75)), data: b.data, ext: 'png' });
        return;
      }
      var runs = b.runs.map(function (r) {
        return r.k === 'eq'
          ? { k: 'eq', v: Tex2Hwp.convert(r.v).script, s: 'body' }
          : { k: 't', v: r.v, s: r.s || 'body' };
      });
      out.push({
        t: 'p',
        para: b.para,
        pageBreak: !!b.pageBreak || (breakPages && isNewPage),
        runs: runs,
      });
    });

    if (!out.length) return Promise.reject(new Error('내보낼 내용이 없습니다'));

    var tplBytes = b64ToBytes(window.HWPX_TEMPLATE_B64);
    return HwpxBuilder.build(tplBytes, { blocks: out }).then(function (bytes) {
      var blob = new Blob([bytes], { type: 'application/hwp+zip' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.pdfName + '.hwpx';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
})();
