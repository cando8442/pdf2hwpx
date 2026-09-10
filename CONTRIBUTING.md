# 이 프로젝트를 GitHub 로 관리하는 법

깃을 처음 쓰는 사람을 위한 안내다. **명령 한 줄씩 따라 치면 된다.**
모든 명령은 프로젝트 폴더(`C:\Users\cando\projects\pdf2hwpx`)에서 실행한다.

---

## 0. 큰 그림 — 왜 이렇게 하나

지금까지는 파일을 고칠 때마다 직접 Netlify 에 올렸다.
GitHub 에 연결하면 **`git push` 한 번이면 Netlify 가 알아서 새로 배포한다.**

```
내 컴퓨터에서 고침  →  git push  →  GitHub 저장  →  Netlify 자동 배포
                                     (되돌리기 가능)      (1~2분)
```

덤으로 얻는 것: 언제 무엇을 왜 고쳤는지 기록이 남고, 잘못 고쳤을 때 **되돌릴 수 있다.**

---

## 1. 매일 쓰는 것은 네 줄뿐

고치고 → 올리는 흐름이다. 이 네 줄이 전부다.

```bash
git status                        # 무엇이 바뀌었는지 본다
git add -A                        # 바뀐 것을 전부 담는다
git commit -m "수식 폭 계산 고침"   # 무엇을 했는지 적어 저장한다
git push                          # GitHub 에 올린다 → Netlify 가 자동 배포
```

**커밋 메시지는 "무엇을 왜"** 로 적는다. 나중에 되돌릴 때 이 한 줄이 전부다.

| 좋은 예 | 나쁜 예 |
|---|---|
| `수식 폭 고정값 2000 제거 — 한글에서 겹쳐 보이던 문제` | `수정` |
| `개인정보처리방침 추가` | `ㅇㅇ` |
| `pdf.js 자체 호스팅 — CSP script-src 를 self 로` | `update` |

---

## 2. 처음 한 번만 하는 것

이미 되어 있다면 건너뛴다.

```bash
git config --global user.name "이름"
git config --global user.email "메일주소"
gh auth status                    # 로그인됐는지 확인 (안 됐으면 gh auth login)
```

---

## 3. 상황별 명령

### 지금 상태가 궁금할 때

```bash
git status                # 안 올린 변경이 있는지
git log --oneline -10     # 최근 10개 기록
git diff                  # 무엇이 어떻게 바뀌었는지 (q 로 빠져나옴)
```

### 방금 고친 걸 되돌리고 싶을 때 (아직 커밋 전)

```bash
git restore web/app.js    # 그 파일만 마지막 커밋 상태로
git restore .             # 전부 되돌리기 — 주의: 저장 안 한 변경이 사라진다
```

### 이미 커밋했는데 되돌리고 싶을 때

```bash
git log --oneline -10     # 되돌아갈 지점의 해시(앞 7자)를 찾는다
git revert <해시>          # 그 커밋을 취소하는 새 커밋을 만든다
```

`git reset --hard` 는 기록을 지워 버리니 쓰지 말 것. `revert` 는 "취소했다"는 기록을 남겨 안전하다.

### 커밋 메시지를 잘못 썼을 때 (아직 push 전)

```bash
git commit --amend -m "제대로 쓴 메시지"
```

---

## 4. 무엇이 올라가고 무엇이 안 올라가나

`.gitignore` 에 적힌 것은 **올라가지 않는다.** 이 프로젝트에서 빼 둔 것:

| 빠지는 것 | 이유 |
|---|---|
| `out/` | 변환한 실제 학습지와 디버깅용 화면 캡처가 섞여 있다 |
| `.dorms-check/`, `dorms-check.config.json`, `edzip-answers.json` | 학교 이름·연락처가 들어간다 |
| `reference/` (템플릿 1개만 예외) | 학습지 원본 |
| `dist/` | `web/` 사본이라 중복 |
| `.env`, `*.key` | 혹시라도 키 파일이 생겼을 때를 막는 안전장치 |

**올리기 전에 확인하는 습관:**

```bash
git status              # 여기 뜬 것만 올라간다
git diff --cached       # add 한 내용을 눈으로 확인
```

> API 키는 코드에 없다. 쓰는 사람이 자기 브라우저에 넣는 구조라 저장소에 키가 들어갈 일이 없다.
> 그래도 새 파일을 만들 때 키를 적어 두지 않도록 조심할 것.

---

## 5. 실수로 비밀을 올렸다면

**지웠다고 끝이 아니다.** 이미 GitHub 에 올라간 것은 기록에 남는다.

1. **먼저 그 키를 폐기한다** (Anthropic 콘솔에서 삭제하고 새로 발급). 이게 가장 중요하다.
2. 그다음 저장소를 정리한다. 파일 하나면:

```bash
git rm --cached 문제파일
echo "문제파일" >> .gitignore
git commit -m "실수로 올린 파일 제거"
git push
```

기록에서 완전히 지우려면 `git filter-repo` 같은 도구가 필요하지만,
**키를 새로 발급하는 것이 훨씬 확실하고 빠르다.**

---

## 6. 배포가 잘 됐는지 보는 법

`git push` 하고 1~2분 뒤:

1. https://app.netlify.com/projects/pdf2hwpx 에서 배포 상태 확인 (초록불이면 성공)
2. 사이트를 열어 **오른쪽 위 버전 표시**가 바뀌었는지 본다 (`v202609101027` 형태)

> **캐시 주의.** 탭을 열어 둔 채로는 옛 화면이 그대로일 수 있다.
> `Ctrl+Shift+R` 로 강력 새로고침하면 최신을 받는다.
> 예전에 이걸 몰라 고친 줄 알고 한참 헤맸다. 그래서 버전 표시를 넣었다.

---

## 7. 다른 컴퓨터에서 이어서 작업하려면

```bash
git clone https://github.com/cando8442/pdf2hwpx.git
cd pdf2hwpx
node tools/sync-lib.js       # src/ → web/lib/ 복사
node tests/tex2hwp.test.js   # 잘 돌아가는지 확인
```

빌드 도구도 설치도 필요 없다. 순수 JavaScript 라 Node 만 있으면 된다.

작업을 시작하기 전에는 항상:

```bash
git pull                     # 다른 곳에서 한 작업을 받아온다
```

---

## 8. 고칠 때 지킬 것

- **`web/lib/` 를 직접 고치지 말 것.** `src/` 가 원본이고 `web/lib/` 는 사본이다.
  `src/` 를 고친 뒤 `node tools/sync-lib.js` 를 돌린다.
- **테스트를 돌리고 올린다.**

```bash
node tests/tex2hwp.test.js   # LaTeX → 한글수식 변환 30건
node tests/eqwidth.test.js   # 수식 폭 추정 (한글이 만든 238개로 채점)
node tests/build-sample.js   # 표본 hwpx 조립
```

- **수식 관련을 고쳤으면 한글에서 직접 열어 볼 것.** PDF 로 내보내면 한글이 레이아웃을
  다시 계산해 멀쩡해 보이므로, **화면에서 확인해야** 겹침을 잡을 수 있다.
