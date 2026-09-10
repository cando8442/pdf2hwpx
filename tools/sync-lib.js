// src/ 의 변환 라이브러리를 배포 디렉터리(web/lib)로 복사한다.
// 원본은 언제나 src/ 하나뿐이고 web/lib 는 사본이다. 직접 고치지 말 것.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['zip.js', 'eqwidth.js', 'hwpx.js', 'tex2hwp.js'];
const dst = path.join(ROOT, 'web/lib');

fs.mkdirSync(dst, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, 'src', f), path.join(dst, f));
  console.log('copied src/' + f + ' -> web/lib/' + f);
}

// 브라우저가 옛 스크립트를 계속 쓰는 사고를 막는다. 실제로 조립기를 고친 뒤에도
// 탭을 열어 둔 사용자가 구버전으로 계속 변환한 일이 있었다(2026-09-10).
// 배포할 때마다 script src 의 ?v= 를 갈아 끼워 캐시를 무효화한다.
// 화면에 그대로 보이는 값이라 한국 시각으로 찍는다
const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 12);
const html = path.join(ROOT, 'web/index.html');
let page = fs.readFileSync(html, 'utf8');
page = page.replace(/(src="(?:lib\/)?[a-z0-9-]+\.js)(\?v=[0-9]+)?"/g, '$1?v=' + stamp + '"');
page = page.replace(/(<span id="ver"[^>]*>)[^<]*(<\/span>)/, '$1' + stamp + '$2');
fs.writeFileSync(html, page);
console.log('cache-bust stamp:', stamp);
