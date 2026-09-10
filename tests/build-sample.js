// 조립기가 만든 hwpx 를 한글이 실제로 열 수 있는지 확인하는 표본 생성기.
const fs = require('fs');
const path = require('path');
require('../src/zip.js');
const { build } = require('../src/hwpx.js');
const { convert } = require('../src/tex2hwp.js');

const ROOT = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(ROOT, 'reference/sample_output_template.hwpx'));
// 학습지 그림은 저장소에 올리지 않으므로(.gitignore) 없을 수 있다.
// 없으면 그림 블록만 빼고 나머지를 그대로 검증한다.
const figPath = path.join(ROOT, 'reference/fig/g1.png');
const fig = fs.existsSync(figPath) ? fs.readFileSync(figPath) : null;

const eq = (tex, s) => ({ k: 'eq', v: convert(tex).script, s: s });
const tx = (v, s) => ({ k: 't', v: v, s: s });

const doc = { blocks: [
  { t: 'p', para: 'title', runs: [tx('미적분Ⅰ 심화 연습 문제', 'h1')] },
  { t: 'p', para: 'plain', runs: [tx('조립기 검증용 표본 — 수식·그림·문단모양', 'sub')] },
  { t: 'p', para: 'h2', runs: [tx('A. 함수의 극한', 'h2'), tx('　　문제 01 ~ 02', 'sub')] },
  { t: 'p', para: 'qhead', runs: [tx('01', 'no'), tx('　[ 인라인 수식 ]', 'tag')] },
  { t: 'p', para: 'body', runs: [
    tx('함수 '), eq('y=f(x)'), tx(' 의 그래프가 그림과 같을 때, '),
    eq('\\lim_{x\\to4}\\frac{\\sqrt{x+5}-3}{\\sqrt{x}-2}'),
    tx(' 의 값을 구하시오.'), tx('　[6점]', 'pt'),
  ] },
  ...(fig ? [{ t: 'img', w: 60, h: 50, data: fig, ext: 'png' }] : []),
  { t: 'p', para: 'choice', runs: [
    tx('① '), eq('1 \\over 3'), tx('　　　② '), eq('\\dfrac{2}{3}'),
    tx('　　　③ '), eq('1'),
  ] },
  { t: 'p', para: 'qhead', runs: [tx('02', 'no'), tx('　[ 디스플레이 수식 ]', 'tag')] },
  { t: 'p', para: 'center', runs: [
    eq('f(x)=\\begin{cases}\\dfrac{x^{2}+ax+b}{x+1} & (x\\ne-1)\\\\ 4 & (x=-1)\\end{cases}'),
  ] },
  { t: 'p', para: 'body', runs: [tx('가 실수 전체의 집합에서 연속일 때 '), eq('a+b'), tx(' 의 값은?')] },
  { t: 'p', para: 'title', pageBreak: true, runs: [tx('정답 및 해설', 'h1')] },
  { t: 'p', para: 'body', runs: [tx('01 ', 'no'), eq('\\frac{2}{3}'), tx('　분자와 분모를 유리화하면 된다.')] },
  { t: 'p', para: 'foot', runs: [tx('pdf2hwpx 조립기 표본 출력', 'foot')] },
] };

build(tpl, doc).then((bytes) => {
  // linesegarray 가 다시 들어오면 한글이 모든 문단을 같은 자리에 겹쳐 그린다.
  if (Buffer.from(bytes).includes('hp:linesegarray')) {
    console.error('FAIL: section0.xml 에 linesegarray 가 들어있다');
    process.exit(1);
  }
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  const out = path.join(ROOT, 'out/sample.hwpx');
  fs.writeFileSync(out, bytes);
  console.log('wrote', out, bytes.length, 'bytes');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
