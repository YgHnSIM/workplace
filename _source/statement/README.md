# 성명서 원본 작성 규칙

성명서는 `_source/catalog.json`의 메타데이터와 이 폴더의 `*.body.html` 본문 조각으로 생성합니다. `npm run build`를 실행하면 `statement/*.html`에 공통 헤더, 슬로건, 서명, 도구막대와 자산 해시가 포함된 공개 문서가 만들어집니다.

## 새 성명서 추가

1. `_source/catalog.json`에 `category: "statement"` 문서를 추가합니다.
2. 공개 주소가 `statement/example.html`이면 `_source/statement/example.body.html`을 만듭니다.
3. 아래 허용 구조로 본문을 작성합니다.
4. `npm run check`를 실행하고 원본과 생성 HTML을 함께 커밋합니다.

`titleLines`는 선택 사항입니다. 정확한 제목 줄바꿈이 필요할 때만 사용하며, 각 줄을 공백으로 합친 값이 `title`과 같아야 합니다.

자동 선택 결과가 실제 인쇄물과 맞지 않는 예외 문서는 `printDensity`를 `short`, `standard`, `long` 중 하나로 지정해 수동 보정할 수 있습니다. 기본값은 항상 본문 분량에 따른 자동 선택입니다.

```json
{
  "category": "statement",
  "href": "statement/example.html",
  "title": "성명서 제목",
  "titleLines": ["성명서", "제목"],
  "date": "2026-07-11",
  "excerpt": "목록과 공유 메타데이터에 사용할 설명입니다.",
  "action": "성명서 보기",
  "groupOrder": 10,
  "order": 20
}
```

## 템플릿이 보장하는 공통 형태

아래 요소는 모든 성명서에 동일하게 적용되는 템플릿 계약입니다. 개별 본문 조각에 다시 작성하거나 문서별 CSS로 덮어쓰지 않습니다.

- A2 세로형 `420mm × 594mm`
- 첫 페이지 상단의 노조 슬로건과 우측 정사각형 심볼
- 심볼 아래에서 전체 폭을 사용하는 청색 제목
- 성명서 목차 미생성
- 본문 분량에 따른 `short`, `standard`, `long` 인쇄 밀도
- 페이지마다 좌우 15mm 내부 여백
- 페이지 경계의 상하 18mm 인쇄 여백. 첫 페이지 상단만 밀도별 헤더 여백을 사용합니다.
- 청색 소제목, 요구안 박스, 맺음말 박스
- 하단 중앙의 날짜와 조직 로고

이 계약은 `build_statement.js`와 `assets/interface.css`에서 관리합니다. 레이아웃을 바꿀 때는 개별 성명서가 아니라 공통 템플릿과 회귀 테스트를 함께 수정합니다.

## 본문 조각

헤더, 슬로건, 날짜, 로고, 도구막대는 원본에 넣지 않습니다. 템플릿이 자동으로 생성합니다.

```html
<section class="intro-section">
  <p class="body-text">서두 문단</p>
</section>

<section>
  <h2 class="section-title">1. 소제목</h2>
  <p class="body-text">본문 문단</p>

  <div class="demands">
    <ol>
      <li>첫 번째 <strong>강조 요구</strong></li>
    </ol>
  </div>
</section>

<div class="closing-block">
  <p class="closing-highlight">강조 문장</p>
  <p class="closing-text">마지막 문장</p>
</div>
```

허용 태그와 클래스 밖의 마크업, 스크립트, 이벤트 속성은 빌드에서 거부합니다. `closing-block`은 하나만 두고 마지막 행 하나에 `closing-text`를 사용합니다.

## 인쇄 밀도 자동 조절

빌더는 제목과 본문 글자 수, 제목 줄 수, 소제목, 요구안 항목, 맺음말 행을 점수화해 다음 밀도를 자동 선택합니다. 본문이 짧아도 제목이 길면 더 작은 밀도를 선택해 한 페이지 넘침을 방지합니다.

- `short`: 1페이지용. 제목·본문·소제목·박스·서명을 가장 크게 출력합니다.
- `standard`: 중간 분량용.
- `long`: 장문용. 2페이지 성명서에 맞춘 넓은 행간과 문단 간격을 사용합니다.

개발용 샘플은 `test/fixtures/statement/`에 둡니다. `statement/`에 샘플을 직접 만들면 공개 배포 대상이 되므로 사용하지 않습니다.
