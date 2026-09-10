/**
 * HWPX 문서 조립기
 *
 * 한글 없이 hwpx를 만든다. 크기·베이스라인 같은 배치 수치는 대충 넣어도
 * 한글이 파일을 열면서 전부 재계산하므로(실측 확인) 신경 쓰지 않는다.
 *
 * 서식 정의(글꼴·문단모양)는 한글이 만들어 준 템플릿의 header.xml을 물려받고,
 * 우리가 쓸 스타일만 새 id로 덧붙인다. 본문(section0.xml)은 새로 조립한다.
 */
(function (root) {
  'use strict';

  const MM = 283.465;          // 1mm = 283.465 HWPUNIT
  const PT = 100;              // 1pt  = 100 HWPUNIT

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 우리가 쓸 글자모양 (템플릿 charPr 을 복제해 height/색/굵기만 바꾼다)
  const CHAR_STYLES = {
    body:   { size: 10.5, color: '#161616' },
    bold:   { size: 10.5, color: '#161616', bold: true },
    h1:     { size: 19,   color: '#161616', bold: true },
    h2:     { size: 13,   color: '#1F5F8B', bold: true },
    sub:    { size: 9.5,  color: '#666666' },
    tag:    { size: 8.5,  color: '#8A8A8A' },
    no:     { size: 11.5, color: '#1F5F8B', bold: true },
    pt:     { size: 9.5,  color: '#1F5F8B', bold: true },
    foot:   { size: 8.8,  color: '#888888' },
    rule:   { size: 9,    color: '#1F5F8B' },
  };

  // 우리가 쓸 문단모양
  const PARA_STYLES = {
    plain:  { align: 'LEFT', left: 0,  line: 160 },
    body:   { align: 'JUSTIFY', left: 22, line: 170 },
    center: { align: 'CENTER', left: 0, line: 150, prev: 1.2, next: 1.2 },
    title:  { align: 'LEFT', left: 0, line: 140 },
    h2:     { align: 'LEFT', left: 0, line: 140, prev: 4.5, next: 0.5 },
    qhead:  { align: 'LEFT', left: 0, line: 150, prev: 2.6, next: 0.3 },
    choice: { align: 'LEFT', left: 24, line: 175, prev: 1.0 },
    foot:   { align: 'JUSTIFY', left: 0, line: 160 },
  };

  let seq = 1000;
  const nextId = () => String(1190000000 + (seq += 7));

  // ── header.xml 에 스타일 덧붙이기 ───────────────────────────
  function extendHeader(header) {
    const charIds = [...header.matchAll(/<hh:charPr id="(\d+)"/g)].map((m) => +m[1]);
    const paraIds = [...header.matchAll(/<hh:paraPr id="(\d+)"/g)].map((m) => +m[1]);
    let nextChar = Math.max.apply(null, charIds) + 1;
    let nextPara = Math.max.apply(null, paraIds) + 1;

    // 본문용 charPr 하나를 원본으로 삼는다 (폰트 참조를 그대로 물려받기 위해)
    const base = /<hh:charPr id="\d+"[\s\S]*?<\/hh:charPr>/.exec(header);
    if (!base) throw new Error('템플릿에 charPr 이 없습니다');
    const baseChar = base[0];

    const charMap = {};
    const newChars = [];
    for (const name of Object.keys(CHAR_STYLES)) {
      const st = CHAR_STYLES[name];
      const id = nextChar++;
      charMap[name] = id;
      let c = baseChar
        .replace(/id="\d+"/, 'id="' + id + '"')
        .replace(/height="\d+"/, 'height="' + Math.round(st.size * PT) + '"')
        .replace(/textColor="[^"]*"/, 'textColor="' + st.color + '"');
      c = c.replace(/<hh:bold\s*\/>/g, '');
      if (st.bold) c = c.replace('<hh:underline', '<hh:bold/><hh:underline');
      newChars.push(c);
    }

    const baseParaM = /<hh:paraPr id="\d+"[\s\S]*?<\/hh:paraPr>/.exec(header);
    const basePara = baseParaM[0];

    const paraMap = {};
    const newParas = [];
    for (const name of Object.keys(PARA_STYLES)) {
      const st = PARA_STYLES[name];
      const id = nextPara++;
      paraMap[name] = id;
      let p = basePara
        .replace(/id="\d+"/, 'id="' + id + '"')
        .replace(/<hh:align horizontal="[^"]*"/, '<hh:align horizontal="' + st.align + '"');
      p = p.replace(/<hc:left value="\d+"/g, '<hc:left value="' + Math.round((st.left || 0) * PT) + '"');
      p = p.replace(/<hc:prev value="\d+"/g, '<hc:prev value="' + Math.round((st.prev || 0) * PT) + '"');
      p = p.replace(/<hc:next value="\d+"/g, '<hc:next value="' + Math.round((st.next || 0) * PT) + '"');
      p = p.replace(/<hh:lineSpacing type="[^"]*" value="\d+"/,
        '<hh:lineSpacing type="PERCENT" value="' + (st.line || 160) + '"');
      newParas.push(p);
    }

    const out = header
      .replace(/(<hh:charProperties itemCnt=")\d+(")/,
        function (m, a, b) { return a + (charIds.length + newChars.length) + b; })
      .replace(/(<hh:paraProperties itemCnt=")\d+(")/,
        function (m, a, b) { return a + (paraIds.length + newParas.length) + b; })
      .replace('</hh:charProperties>', newChars.join('') + '</hh:charProperties>')
      .replace('</hh:paraProperties>', newParas.join('') + '</hh:paraProperties>');

    return { header: out, charMap: charMap, paraMap: paraMap };
  }

  // ── 본문 요소 ────────────────────────────────────────────────
  function runXml(charId, inner) {
    return '<hp:run charPrIDRef="' + charId + '">' + inner + '</hp:run>';
  }

  function textXml(s) {
    return '<hp:t>' + esc(String(s).replace(/[\t\r\n]+/g, ' ')) + '</hp:t>';
  }

  function equationXml(script, sizePt) {
    const unit = Math.round((sizePt || 10.5) * PT);
    // 수식이 차지할 칸의 크기. 한글은 파일을 열 때 이 값을 그대로 믿고 그리므로
    // (편집이 일어나야 다시 계산한다) 고정값을 넣으면 수식이 좁은 칸에 눌려 겹친다.
    const EW = root.EqWidth || require('./eqwidth.js');
    const w = Math.round(unit * EW.widthUnits(script));
    const h = Math.round(unit * EW.heightUnits(script));
    return '<hp:equation id="' + nextId() + '" zOrder="0" numberingType="EQUATION"' +
      ' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"' +
      ' version="" baseLine="85" textColor="#000000" baseUnit="' + unit + '"' +
      ' lineMode="CHAR" font="HYhwpEQ">' +
      '<hp:sz width="' + w + '" widthRelTo="ABSOLUTE" height="' + h + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"' +
      ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP"' +
      ' horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:shapeComment>수식입니다.</hp:shapeComment>' +
      '<hp:script>' + esc(script) + '</hp:script></hp:equation>';
  }

  function picXml(binId, wmm, hmm) {
    const w = Math.round(wmm * MM);
    const h = Math.round(hmm * MM);
    return '<hp:pic id="' + nextId() + '" zOrder="1" numberingType="PICTURE"' +
      ' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"' +
      ' href="" groupLevel="0" instid="' + nextId() + '" reverse="0">' +
      '<hp:offset x="0" y="0"/>' +
      '<hp:orgSz width="' + w + '" height="' + h + '"/>' +
      '<hp:curSz width="0" height="0"/>' +
      '<hp:flip horizontal="0" vertical="0"/>' +
      '<hp:rotationInfo angle="0" centerX="' + Math.round(w / 2) + '" centerY="' +
      Math.round(h / 2) + '" rotateimage="1"/>' +
      '<hp:renderingInfo>' +
      '<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
      '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
      '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
      '</hp:renderingInfo>' +
      '<hc:img binaryItemIDRef="' + binId + '" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>' +
      '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + w + '" y="0"/>' +
      '<hc:pt2 x="' + w + '" y="' + h + '"/><hc:pt3 x="0" y="' + h + '"/></hp:imgRect>' +
      '<hp:imgClip left="0" right="' + w + '" top="0" bottom="' + h + '"/>' +
      '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:imgDim dimwidth="' + w + '" dimheight="' + h + '"/><hp:effects/>' +
      '<hp:sz width="' + w + '" widthRelTo="ABSOLUTE" height="' + h +
      '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"' +
      ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP"' +
      ' horzAlign="CENTER" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:shapeComment>그림입니다.</hp:shapeComment></hp:pic>';
  }

  /**
   * @param {ArrayBuffer|Uint8Array} templateBytes  한글이 만든 hwpx (서식 원본)
   * @param {{blocks:Array}} doc
   * @returns {Promise<Uint8Array>}
   */
  async function build(templateBytes, doc) {
    const Z = root.MiniZip || require('./zip.js');
    const files = await Z.unzip(templateBytes);

    const rawHeader = new TextDecoder().decode(files.get('Contents/header.xml'));
    const ext = extendHeader(rawHeader);
    const charMap = ext.charMap;
    const paraMap = ext.paraMap;

    const rawSection = new TextDecoder().decode(files.get('Contents/section0.xml'));
    const secPrM = /<hp:secPr[\s\S]*?<\/hp:secPr>/.exec(rawSection);
    const secPr = secPrM ? secPrM[0] : '';

    const images = [];
    const paras = [];

    for (let i = 0; i < doc.blocks.length; i++) {
      const b = doc.blocks[i];
      const pName = b.para || 'body';
      const pStyle = paraMap[pName] != null ? paraMap[pName] : paraMap.body;
      let inner = '';

      if (b.t === 'img') {
        const id = 'img' + (images.length + 1);
        const extName = b.ext || 'png';
        images.push({ id: id, name: 'BinData/' + id + '.' + extName, data: b.data, ext: extName });
        inner = runXml(charMap.body, picXml(id, b.w, b.h));
      } else {
        const runs = b.runs || [];
        for (let j = 0; j < runs.length; j++) {
          const r = runs[j];
          const sName = r.s || 'body';
          const cid = charMap[sName] != null ? charMap[sName] : charMap.body;
          const size = (CHAR_STYLES[sName] || CHAR_STYLES.body).size;
          inner += runXml(cid, r.k === 'eq' ? equationXml(r.v, size) : textXml(r.v));
        }
        if (!inner) inner = runXml(charMap.body, '');
      }

      // 첫 문단에는 용지 설정(secPr)이 들어가야 한다
      if (i === 0 && secPr) inner = runXml(charMap.body, secPr) + inner;

      // linesegarray(줄 배치 좌표)는 넣지 않는다. 한글은 저장된 vertpos 를 그대로 믿고
      // 그리기 때문에, 모르는 값을 채워 넣으면 모든 문단이 같은 자리에 겹쳐 그려진다.
      // (한글이 만든 파일은 vertpos 가 누적 좌표이고, 그림 문단은 vertsize 가 실제 높이다.)
      // 아예 비워 두면 파일을 열 때 레이아웃을 처음부터 계산해 정상 배치한다 — 실측 확인함.
      paras.push('<hp:p id="' + nextId() + '" paraPrIDRef="' + pStyle +
        '" styleIDRef="0" pageBreak="' + (b.pageBreak ? 1 : 0) +
        '" columnBreak="0" merged="0">' + inner + '</hp:p>');
    }

    const section = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" ' +
      'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" ' +
      'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" ' +
      'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
      'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" ' +
      'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" ' +
      'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" ' +
      'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" ' +
      'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
      'xmlns:opf="http://www.idpf.org/2007/opf/" ' +
      'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" ' +
      'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" ' +
      'xmlns:epub="http://www.idpf.org/2007/ops" ' +
      'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">' +
      paras.join('') + '</hs:sec>';

    // content.hpf: 기존 이미지 항목을 지우고 우리 것으로 교체
    let hpf = new TextDecoder().decode(files.get('Contents/content.hpf'));
    hpf = hpf.replace(/<opf:item[^>]*href="BinData\/[^"]*"[^>]*\/>/g, '');
    const items = images.map(function (im) {
      return '<opf:item id="' + im.id + '" href="' + im.name +
        '" media-type="image/' + (im.ext === 'jpg' ? 'jpeg' : im.ext) + '" isEmbeded="1"/>';
    }).join('');
    hpf = hpf.replace('</opf:manifest>', items + '</opf:manifest>');

    // 최종 zip: mimetype 은 반드시 첫 항목 + 무압축
    const entries = [{ name: 'mimetype', data: files.get('mimetype'), store: true }];
    for (const pair of files) {
      const name = pair[0];
      const data = pair[1];
      if (name === 'mimetype') continue;
      if (name.indexOf('BinData/') === 0) continue;
      if (name === 'Contents/header.xml') { entries.push({ name: name, data: ext.header }); continue; }
      if (name === 'Contents/section0.xml') { entries.push({ name: name, data: section }); continue; }
      if (name === 'Contents/content.hpf') { entries.push({ name: name, data: hpf }); continue; }
      if (/^Contents\/section[1-9]/.test(name)) continue;
      entries.push({ name: name, data: data });
    }
    for (const im of images) entries.push({ name: im.name, data: im.data });

    return Z.zip(entries);
  }

  const api = { build: build, CHAR_STYLES: CHAR_STYLES, PARA_STYLES: PARA_STYLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HwpxBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
