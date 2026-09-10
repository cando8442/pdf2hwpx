// 한글이 직접 만든 수식 238개(reference/sample_output_template.hwpx)를 정답지로
// 폭 추정기를 채점한다. 데이터는 out/eqdata.json (없으면 먼저 추출한다).
const fs = require('fs');
const path = require('path');
const { widthUnits } = require('../src/eqwidth.js');

const ROOT = path.join(__dirname, '..');
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'out/eqdata.json'), 'utf8'));

let under = 0, bad = 0;
const ratios = [];
const worst = [];
for (const r of rows) {
  const want = r.w / r.unit;          // 한글이 계산한 폭 (baseUnit 배수)
  const got = widthUnits(r.script);
  const ratio = got / want;
  ratios.push(ratio);
  if (ratio < 0.95) under++;          // 좁게 잡으면 글자가 겹친다
  if (ratio < 0.9 || ratio > 1.6) { bad++; worst.push({ ratio, want, got, s: r.script }); }
}
ratios.sort((a, b) => a - b);
const pct = (p) => ratios[Math.floor(ratios.length * p)].toFixed(2);

console.log('수식 ' + rows.length + '개');
console.log('  예측/실제 비율  p5=' + pct(0.05) + '  중앙=' + pct(0.5) + '  p95=' + pct(0.95));
console.log('  좁게 잡음(<0.95): ' + under + '개  (겹침 위험)');
console.log('  범위 벗어남(<0.9 또는 >1.6): ' + bad + '개');
worst.sort((a, b) => a.ratio - b.ratio).slice(0, 6).forEach((w) => {
  console.log('   ' + w.ratio.toFixed(2) + '  실제=' + w.want.toFixed(1) + ' 예측=' + w.got.toFixed(1) + '  ' + w.s.slice(0, 64));
});

// 겹침이 곧 버그다. 좁게 잡은 수식이 전체의 10% 를 넘으면 실패로 본다.
const limit = Math.ceil(rows.length * 0.10);
if (under > limit) { console.log('FAIL: 좁게 잡은 수식이 ' + under + '개 (허용 ' + limit + ')'); process.exit(1); }
console.log('PASS');
