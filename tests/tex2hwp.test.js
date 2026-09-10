const { convert } = require('../src/tex2hwp.js');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// 2026-09-09 미적분1 학습지 두 편(주관식/객관식)에서 손으로 매핑했던 수식들.
// 그 작업이 그대로 이 변환기의 정답지가 된다.
const CASES = [
  ['y=f(x)', 'y=f(x)'],
  ['a+b', 'a+b'],
  ['b\\ne0', 'b!=0'],
  ['x>1', 'x>1'],
  ['-3<x<3', '-3<x<3'],
  ['x^{2}', 'x^{2}'],
  ["f'(1)=12", "f'(1)=12"],
  ['\\displaystyle\\lim_{x\\to a}f(x)', 'lim from{x rightarrow a} f(x)'],
  ['\\lim_{x\\to-1-}f(x)', 'lim from{x rightarrow -1-} f(x)'],
  ['\\lim_{x\\to\\infty}', 'lim from{x rightarrow inf}'],
  ['\\lim_{x\\to-\\infty}', 'lim from{x rightarrow - inf}'],
  ['\\frac{a}{b}', 'a over b'],
  ['\\dfrac{1}{3}', '1 over 3'],
  ['\\frac{f(b)-f(a)}{b-a}', '{f(b)-f(a)} over {b-a}'],
  ['\\sqrt{x}', 'sqrt x'],
  ['\\sqrt{x+5}', 'sqrt {x+5}'],
  ['\\lim_{x\\to4}\\frac{\\sqrt{x+5}-3}{\\sqrt{x}-2}',
    'lim from{x rightarrow 4} {sqrt {x+5}-3} over {sqrt x-2}'],
  ['\\left|x^{2}-3x+2\\right|', 'left | x^{2}-3x+2 right |'],
  ['\\left(\\sqrt{9x^{2}+ax+1}-3x\\right)', 'left ( sqrt {9x^{2}+ax+1}-3x right )'],
  ['\\{f(x)-2g(x)\\}', 'left { f(x)-2g(x) right }'],
  ['a\\cdot b', 'a cdot b'],
  ['2\\times2', '2 times 2'],
  ['x\\ge1', 'x>=1'],
  ['\\mathrm{A}(a,\\,f(a))', '{rm A}(a,`f(a))'],
  ['f(-1)=k^{2}-5k,\\qquad f(2)=4', 'f(-1)=k^{2}-5k,~~~~~ f(2)=4'],
  ['\\begin{cases}x^{2}+3x & (x<1)\\\\ 4x-2 & (x\\ge1)\\end{cases}',
    'cases{ x^{2}+3x & (x<1) # 4x-2 & (x>=1) }'],
  ['\\begin{cases}\\dfrac{x^{2}+ax+b}{x+1} & (x\\ne-1)\\\\[6pt] 4 & (x=-1)\\end{cases}',
    'cases{ {x^{2}+ax+b} over {x+1} & (x!=-1) # 4 & (x=-1) }'],
  ['\\sum_{k=1}^{n}k^{2}', 'sum from{k=1} to n k^{2}'],
  ['\\lim_{h\\to0}\\frac{f(2+3h)-f(2-h)}{2h}=6',
    'lim from{h rightarrow 0} {f(2+3h)-f(2-h)} over {2h}=6'],
  ['\\int_0^{1} x^{2} dx', 'int from 0 to 1 x^{2} dx'],
];

let pass = 0;
const fails = [];
for (const [tex, want] of CASES) {
  let got;
  try {
    got = convert(tex).script;
  } catch (e) {
    got = 'THROW: ' + e.message;
  }
  if (norm(got) === norm(want)) pass++;
  else fails.push({ tex, want, got });
}
console.log('PASS ' + pass + '/' + CASES.length);
for (const f of fails) {
  console.log('\n  TeX  : ' + f.tex);
  console.log('  기대 : ' + f.want);
  console.log('  실제 : ' + f.got);
}
process.exit(fails.length ? 1 : 0);
