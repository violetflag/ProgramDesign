# 앱을 헤드리스로 띄우고 재는 법

검토의 신뢰도는 "진짜 앱을 봤는가"에서 나온다. 코드만 읽으면 포커스 링이 잘리는 것, 대비 수치,
Tab 횟수를 전부 틀리게 추측한다. 아래는 데스크톱 앱(Tauri 2 + React + Vite + Python 엔진)에서
검증한 방법이며, 다른 스택도 같은 원리로 간다.

## 1. 구성 요소 파악

| 찾을 것 | 어디서 | 쓰임 |
|---------|--------|------|
| 프런트 개발 서버 | `package.json`의 `dev`/`vite` 스크립트, 포트 | 브라우저로 화면을 띄우는 창구 |
| 데스크톱 셸 | `src-tauri/`, `electron/` | 브라우저에서 흉내 내야 할 호출 목록 |
| 백엔드·엔진 | `engine/`, `server/`, FastAPI·Express 등 | 데이터와 상태. 무거운 모델 없이 뜨는지 확인 |
| 첫 실행 흐름 | "setup", "onboarding" 검색 | 화면을 막으므로 API로 넘길 방법을 찾는다 |
| i18n | `t("…")` 함수, 사전 파일, 빌드 스크립트 | 새 문구를 넣을 때 |
| 릴리스 스크립트 | `tools/release.py`, `scripts/release.*` | 버전 올릴 때 |

## 2. 엔진·서버 띄우기

```bash
cd <repo>/engine
nohup python3 -m <engine_module> --data-dir <scratch>/engine-data --port 8765 > <scratch>/engine.log 2>&1 &
curl -s http://127.0.0.1:8765/health
```

- 데이터 폴더는 작업용 폴더(스크래치)에 따로 둔다. 사용자 데이터를 건드리지 않는다.
- 모델이 없어도 뜨는지 본다. 대부분 "모델 없음" 상태로 뜨며, 그 상태 자체가 검토 대상(빈 상태 화면)이다.
- 환경이 재설정되면 프로세스가 죽는다. 캡처 전에 `curl`로 살아 있는지 확인하고 아니면 다시 띄운다.

## 3. 프런트 띄우기

```bash
cd <repo>/app
nohup npx vite --port 1420 --strictPort > <scratch>/vite.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:1420/
```

## 4. 데스크톱 셸 흉내 내기 (Tauri 2)

Tauri 앱은 `window.__TAURI_INTERNALS__.invoke(cmd, args)`로 네이티브 기능을 부른다. 브라우저에서는 이
객체가 없어 앱이 멈추거나 빈 화면이 된다. Playwright의 `addInitScript`로 넣는다. 앱이 부르는 명령은
`src-tauri/src`의 `#[tauri::command]`와 프런트의 `invoke("...")` 호출을 grep 해서 모은다.

```js
const tauriMock = `
window.__mockRec = { recording: false, paused: false, note_id: null, elapsed_ms: 0, tracks: [] };
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window["_" + id] = cb; return id; },
  unregisterCallback: () => {},
  convertFileSrc: (p) => p,
  invoke: async (cmd, args) => {
    switch (cmd) {
      case "engine_port": return 8765;
      case "recording_status": return window.__mockRec;
      case "list_devices": return { inputs: [{ name: "마이크", is_default: true }], outputs: [{ name: "스피커", is_default: true }] };
      case "data_dir": return "C:\\\\Users\\\\user\\\\Documents\\\\App";
      case "start_recording": window.__mockRec = { recording: true, paused: false, note_id: args.note_id, elapsed_ms: 1000, tracks: [] }; return args.note_id;
      case "stop_recording": window.__mockRec = { recording: false, paused: false, note_id: null, elapsed_ms: 0, tracks: [] }; return null;
      case "pause_recording": window.__mockRec.paused = args.paused; return null;
      case "plugin:event|listen": return 1;
      default: return null;
    }
  },
};`;
await context.addInitScript(tauriMock);
```

- 모르는 명령은 `null`을 돌려주고 콘솔 오류를 보며 하나씩 채운다.
- "녹음 중" 같은 실시간 상태는 `page.route()`로 엔진 API 응답을 가짜로 바꾸고, 셸 상태(`__mockRec`)를
  `page.evaluate`로 바꾸면 그 화면으로 들어간다. 캡처가 끝나면 둘 다 원래대로 돌린다.
- Electron은 `window.electronAPI`(preload가 노출하는 객체)를 같은 식으로 흉내 낸다.

## 5. 테스트 데이터 심기

엔진 API로 넣는다(파일 업로드, 노트 생성, 메모·북마크·할 일 추가). 원칙:

- 목록 6개 이상, 날짜는 오늘·어제·이번 주·지난주·지난달·작년에 걸치게(날짜 묶음과 연도 표기 확인).
- 제목은 긴 것과 짧은 것, 폴더에 든 것과 안 든 것, 즐겨찾기, 처리 중, 실패를 섞는다.
- 사람 2~3명 이름을 붙이고, 이름 없는 "화자 N"도 하나 남긴다(색 규칙 검토용).
- 요약이 있는 노트와 없는 노트를 둘 다 둔다(빈 상태 화면용).
- 어두운 테마는 `document.documentElement.setAttribute("data-theme","dark")`처럼 앱이 쓰는 방식으로 켠다.

만든 ID는 `ids.env` 같은 파일에 적어 두고 스크립트가 읽게 한다. 스크립트가 데이터를 바꾸면(날짜 수정,
메모 추가) 끝에 원래대로 돌리는 함수를 둔다.

## 6. 캡처와 axe

`scripts/axe_capture.js`를 쓴다. 화면 목록은 JSON으로 준다. 준비물: Playwright(크로미엄 포함, 클라우드
세션에는 전역으로 있다)와 `axe-core`. `axe-core`는 작업 폴더에서 `npm i axe-core` 한 번. 스크립트는
플랜 파일 옆, 작업 폴더, `NODE_PATH` 순으로 찾는다. 전역 Playwright가 `/opt/node-tools/node_modules`에
있으면 `NODE_PATH="$NODE_PATH:/opt/node-tools/node_modules"`로 실행한다.

```json
{
  "url": "http://localhost:1420/",
  "ready": "text=바로 녹음",
  "initScript": "mock.js",
  "viewport": { "width": 1280, "height": 800 },
  "steps": [
    { "name": "01_home", "axe": "home" },
    { "name": "03_list", "click": { "role": "button", "name": "모든 노트", "within": "nav[aria-label='메뉴']" }, "axe": "list" },
    { "name": "11_note", "click": { "selector": "[data-note-row]" }, "wait": 800, "axe": "note" },
    { "name": "70_dark_home", "evaluate": "document.documentElement.setAttribute('data-theme','dark')", "axe": "dark_home" },
    { "name": "82_narrow", "viewport": { "width": 640, "height": 400 } }
  ]
}
```

- `axe`는 wcag2a·wcag2aa·wcag21a·wcag21aa·best-practice 태그로 돌린다. 결과는 화면 이름별로 `results.json`에
  남고, 위반 노드의 셀렉터와 HTML 앞부분이 함께 저장된다.
- 같은 이름의 버튼이 둘 있으면 Playwright strict 모드가 멈춘다. `within`으로 범위를 좁히거나 `nth`를 쓴다.
- 배지 숫자가 붙은 버튼("할 일 5")은 접근 이름이 바뀌므로 `name`을 정규식/부분 일치로 준다.
- `title`만 있고 글자가 없는 버튼은 `selector: "button[title='…']"`로 찍는다.

## 7. 키보드와 대비

- `scripts/keyboard_pass.js`: 실제 `page.keyboard.press("Tab")`을 N번 눌러 포커스 요소의 태그·role·이름·
  `:focus-visible` 여부·outline·크기를 기록한다. 메뉴 열기(Shift+F10)와 Esc 복귀, Ctrl+K 팔레트 Esc 뒤
  포커스 위치도 같은 식으로 잰다. 24px 미만의 조작 대상 목록도 뽑는다.
- `scripts/contrast.js`: 16진 색 쌍의 대비를 WCAG 공식으로 계산한다. 토큰 파일(`index.css`의 `--color-*`)을
  읽어 자동으로 쌍을 만들지는 않으므로, 글자/바탕·테두리/바탕·비활성 글자/바탕 쌍을 직접 적어 준다.
  Tailwind 기본 색(oklch)은 sRGB 근삿값 표가 스크립트 안에 있다.

## 8. 자주 걸리는 것

- **React 훅 순서 오류** "Rendered more hooks than during the previous render": 새 `useState`를 early return
  뒤에 두면 난다. 다른 state 선언 옆으로 올린다.
- **첫 실행 설정 화면**이 메뉴를 막는다: 넘기는 API를 찾아 호출하거나, 그 자체를 검토 항목(U2)으로 적는다.
- **환경 재설정** 뒤 서버가 죽어 `ERR_CONNECTION_REFUSED`: 캡처 전에 `curl`로 확인하고 다시 띄운다.
- **문서 저장소에 PR을 못 연다**: 브랜치가 하나뿐이면 PR이 불가능하다. 푸시만 하고 보고에 적는다.
- **git 프록시가 브랜치 삭제를 막는다**: `push --delete`가 끊기면 사용자에게 GitHub 화면이나 로컬 명령을
  안내한다.
