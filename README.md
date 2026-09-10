# pdf2hwpx

PDF 학습지를 **한글 네이티브 수식이 살아있는 hwpx**로 바꾸는 정적 웹앱.
서버가 없다. 브라우저 하나에서 전부 돌아간다.

```
PDF → 페이지 이미지(pdf.js) → [Claude 비전] → LaTeX → [tex2hwp] → 한글수식 → hwpx
                                 ↑ 여기만 부정확        ↑ 여기부터 결정론적
```

## 왜 비전인가

PDF 텍스트 추출로는 수식을 못 살린다. MathJax가 수식을 SVG 벡터로 그려 넣기 때문에
PDF 안에 글자가 아예 없다. 추출하면 "함수 [빈칸] 의 그래프가"처럼 수식만 증발한다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/tex2hwp.js` | LaTeX → 한글 수식 스크립트. 토크나이저 + 재귀하강 파서 |
| `src/hwpx.js` | hwpx 조립기. 템플릿 `header.xml`을 물려받고 `section0.xml`만 새로 만든다 |
| `src/zip.js` | 의존성 없는 zip/unzip (`mimetype`은 첫 엔트리 + 무압축) |
| `web/` | 배포 디렉터리. `index.html` + `app.js` + `lib/`(src 사본) + `template.js` |
| `tests/tex2hwp.test.js` | 변환기 정답지 30건 |
| `tests/build-sample.js` | 조립기 표본 출력 → `out/sample.hwpx` |
| `reference/` | 실물 근거자료 (검수 끝낸 학습지, 원본 LaTeX, 그림) |
| `web/vendor/` | pdf.js·MathJax 자체 호스팅본. CSP `script-src 'self'` 를 지키려고 CDN 을 쓰지 않는다 |
| `dist/` | dorms-check 점검용 `web/` 사본. 스캐너가 `web` 을 빌드 후보로 보지 않아 필요하다 |

`web/lib/`는 사본이다. 고칠 곳은 언제나 `src/`이고 `node tools/sync-lib.js`로 옮긴다.

## 개발

```bash
node tests/tex2hwp.test.js     # 변환기 회귀 테스트
node tests/build-sample.js     # 조립기 표본 hwpx
node tools/sync-lib.js         # src → web/lib
python -m http.server 8899 --directory web
```

## 배포

Netlify 정적 배포. `netlify.toml`이 `publish = "web"`, 빌드는 `node tools/sync-lib.js`.

## API 키

Anthropic API 키(`sk-ant-...`)를 쓰는 사람이 직접 입력한다. 키는 그 브라우저의
localStorage(`pdf2hwpx.key`)에만 남고 코드에는 들어가지 않는다.
브라우저에서 `api.anthropic.com`을 직접 호출한다
(`anthropic-dangerous-direct-browser-access: true`, CORS 허용 실측 확인).

## 알려진 한계

- 스캔본·교과서 사진은 정확도가 떨어진다. 깨끗한 벡터 PDF에서 실측 5/5.
- 그림은 모델이 준 박스 비율로 잘라 넣는다. 어긋나면 삭제하고 한글에서 직접 넣는 편이 빠르다.
- 표는 아직 다루지 않는다.
- 자동 교차검증(재렌더 그림 ↔ 원본 조각 대조)은 미구현.
