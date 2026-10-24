# 코드로 옮길 때 점검표

실제 작업에서 걸렸던 것들이다. 순서는 토큰 → 공용 컴포넌트 → 화면.

## 토큰 (Tailwind v4 `@theme` 기준)

- 글자색은 바탕 위에서 4.5:1, 테두리·스위치 트랙·슬라이더 트랙은 3:1. 기존 `gray-300`(1.5:1)으로
  입력 테두리를 그리면 비텍스트 대비 미달이다. `--color-line`처럼 "경계 전용" 토큰을 하나 둔다.
- 어두운 테마는 같은 이름을 `:root[data-theme="dark"]`에서 다시 정의한다. 흰 글씨를 얹는 `-500`은 4.5:1을
  다시 계산한다(밝은 테마의 값이 어두운 바탕에서는 보통 미달).
- 형광펜·메모 같은 색 바탕 위의 회색 글자는 따로 계산한다(`yellow-100` 위 `gray-400`이 3.7:1인 경우).
- 시간·개수처럼 "숫자" 토큰(`--color-time`)을 하나 두면 화면마다 시간 색이 흩어지지 않는다.
- 그림자 토큰을 `0 0 0 0 transparent`로 두면 `.card`를 일일이 고치지 않고 그림자를 없앨 수 있다.
- 비활성은 `opacity: .5` 대신 바탕 `gray-100` + 글자 `gray-500`(투명도는 흰 글씨를 2:1로 떨어뜨린다).

## 포커스

- 전역 규칙은 반드시 레이어 안에:
  ```css
  @layer base { :focus-visible { outline: 2px solid var(--color-accent-600); outline-offset: 2px; } }
  ```
  레이어 밖에 두면 유틸리티(`outline-offset-[-2px]`)를 이겨서 `overflow-hidden` 카드 안의 행 포커스 링이
  잘린다. 안쪽 링이 필요한 행은 `outline-offset-[-2px]`.
- 모달·팔레트 닫힐 때 포커스 복귀: 열기 전 요소를 **첫 렌더에서** 잡는다.
  ```ts
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => { if (before && before !== document.body && document.contains(before) && document.activeElement === document.body) before.focus(); }, []);
  ```
  effect 안에서 잡으면 입력칸이 이미 포커스를 가져간 뒤이고, StrictMode는 effect를 두 번 돌려 두 번째
  마운트에서 팔레트 자신을 기억한다.
- hover에만 보이던 행 안 버튼(체크, ⋯)은 `group-focus-within:opacity-100`도 준다.

## ARIA 패턴

- **탭**: `role="tablist"` 안에는 `role="tab"`만(접기 버튼은 밖으로). 선택된 탭만 `tabIndex=0`, 나머지 `-1`,
  ←/→/Home/End로 이동(roving tabindex). 탭에 `id`와 `aria-controls`, 패널에 `role="tabpanel"`과
  `aria-labelledby`.
- **툴바**(문장 도구처럼 항목마다 반복되는 버튼 묶음): 도구에 `tabIndex=-1`, 묶음에 `role="toolbar"`, 기준
  버튼에서 →로 진입, ←/→ 이동, Esc로 복귀. Tab 정지가 항목당 10개에서 1개로 준다.
- **분할선**: 포커스 가능한 `role="separator"`는 `aria-valuemin/max/now`와 `aria-valuetext`가 필수.
- **스위치**: 진짜 `<input type="checkbox" class="peer sr-only">` + 그려진 `.switch` 스팬(`aria-hidden`),
  `peer-focus-visible:`로 링. 공용 `Toggle` 컴포넌트 하나로 통일한다.
- **상태 영역**: 매초 바뀌는 시계를 `role="status"` 안에 두지 않는다. 분 단위로만 바뀌는 sr-only 줄을 따로.
- **제목 구조**: 화면마다 h1 하나(입력칸이 제목이면 sr-only h1), 설정 블록은 h2, 그 아래 h3. `role="alert"`를
  h1에 직접 주면 heading 역할이 사라지므로 감싸는 div에 준다.
- **div의 `aria-selected`**는 역할이 없으면 허용되지 않는다. 선택 상태는 `aria-pressed` 버튼에.
- **글자 아이콘**(✓, ☐)은 `aria-hidden` + sr-only 글("완료: ", "할 일: ").
- **이름 없는 select/input**: 라벨 글자가 `<label>`이 아니면 `useId()`로 id를 만들어 `aria-labelledby`.
  `Row` 같은 래퍼에서 `Children.map` + `cloneElement`로 한 번에 붙일 수 있다.
- **랜드마크**: `<aside>`가 둘 이상이면 각각 `aria-label`. 폴더가 없을 때는 `role="tree"`를 빼라
  (treeitem 없는 tree는 위반).

## 대상 크기와 시간

- 아이콘 버튼 24×24 이상(권장 32), 시간 버튼은 `min-h-6`. 메타 줄의 인라인 글자 링크는 2.5.8 예외.
- 알림(토스트)은 마우스 올림·포커스 중 멈추고, 되돌리기가 있으면 8초 이상. 재생 바가 있으면 그 위로.

## 화면 구조를 바꿀 때

- 머리를 줄일 때: 넓은 창(`lg:`)에서 제목 옆 한 줄, 좁은 창에서는 제목 아래 한 줄(`hidden sm:flex lg:hidden`).
  한 메타 조각을 변수로 두고 두 자리에서 쓴다.
- "집중 모드"(토글 숨기기): 토글은 공용 `Popover`(아래/위 배치 옵션)에 담고, 상태는 한 줄 글("자막 · 교정
  켜짐")로 남긴다. 숨긴 패널로 가는 버튼도 그 창 안에 둔다.
- 같은 데이터가 여러 자리에 보이면 하나로 합친다. 합친 뒤 남은 자리의 폼·읽기 블록·개수 배지를 다 지운다.
- 메모장 같은 자유 텍스트는 CodeMirror 6 + `@codemirror/lang-markdown`으로 라이브 프리뷰(커서 줄만 원문,
  나머지는 서식) 편집기를 만든다. 마크 숨김은 `syntaxTree` 노드(HeaderMark, EmphasisMark, ListMark,
  TaskMarker, QuoteMark)에 `Decoration.replace`, 스타일은 `Decoration.mark`/`Decoration.line`.
  색은 CSS 변수를 써서 어두운 테마가 따라오게 한다.

## 문구와 i18n

- 엔티티(`&gt;`, `&amp;`)가 글자로 보이면 평문으로.
- 새 `t("…")` 문구는 사전(en.json 등)에 영어를 넣고 빌드해 누락 0을 확인한다. 소스에서 정규식으로
  `t("…")`를 긁어 사전과 비교하는 스크립트를 한 번 만들어 두면 매 커밋마다 쓴다.
- 안 쓰게 된 문구는 사전에서도 지운다.

## 버전·의존성

- 버전은 릴리스 스크립트(`tools/release.py set X.Y.Z`)로 한 번에. 화면 구조가 바뀌면 부 버전.
- 의존성을 넣었다 뺐으면 `node_modules`에서도 지우고 lockfile을 main 기준으로 되돌린 뒤 버전만 올린다.
- npm 버전 차이로 lockfile의 `libc` 필드가 수십 줄 사라지면 main의 lockfile에서 복원한다(의미 없는 diff를
  리뷰어에게 남기지 않는다).
- lockfile의 루트 `version`도 package.json과 맞춘다.

## 검증 전 자기 점검

- `tsc --noEmit` 0 오류.
- axe를 같은 화면 목록으로 다시. heading-order, page-has-heading-one, aria-allowed-role이 새로 생겼으면
  내가 넣은 h 태그·role 때문이다.
- 키보드: 팔레트 Esc 뒤 포커스가 body가 아닌지, 목록 행 링이 보이는지, 툴바 →/Esc가 되는지.
- 어두운 테마 캡처를 한 장은 꼭 본다. 달력 일요일 숫자처럼 라이브러리 기본 색이 걸린다.
