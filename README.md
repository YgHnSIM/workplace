# 우체국물류지원단 물류노동조합 공개 자료실

우체국물류지원단 물류노동조합의 성명서, 회의록, 지식, 알림 자료를 정적 웹페이지로 공개하는 저장소입니다.

배포 사이트: <https://yghnsim.github.io/workplace/>

## 구성

| 경로 | 역할 |
| --- | --- |
| `index.html` | 전체 자료를 최신순으로 보여주는 아카이브 첫 화면입니다. |
| `_source/MoM/` | v2 YAML frontmatter와 Markdown 본문으로 된 회의록·결산 원본입니다. |
| `_source/statement/` | 공통 인쇄 템플릿으로 생성할 성명서 본문 원본입니다. |
| `_source/knowledge/`, `_source/notice/` | 전체 HTML 템플릿을 보존하는 지식·알림 원본입니다. 공통 head와 문서 chrome은 빌드 영역입니다. |
| `_source/catalog.json` | v2 `DocumentRecord` 성명서·지식·알림 메타데이터입니다. |
| `_source/topics.json`, `_source/sources.json` | 주제 ID와 선택적 출처 ID 원장입니다. |
| `MoM/` | Markdown에서 생성된 회의록·결산 HTML과 목록입니다. |
| `statement/` | 성명서 원본과 공통 템플릿에서 생성된 공개 HTML입니다. |
| `knowledge/`, `notice/` | 직접 관리하는 공개 상세 문서입니다. |
| `assets/` | 공통 CSS·JavaScript, 최적화 로고, favicon, 공유 이미지입니다. |
| `lib/content-model.js` | catalog와 모든 원본을 정규화하고 v2 관계·경로·주제·날짜를 검증합니다. |
| `build_mom.js` | MoM YAML과 Markdown을 검증하고 회의록 HTML을 생성합니다. |
| `build_statement.js` | 카탈로그와 성명서 본문을 검증하고 분량별 인쇄 밀도를 적용한 HTML을 생성합니다. |
| `build_site.js` | 목록, SEO 메타데이터, 자산 해시, sitemap, robots 파일을 생성합니다. |
| `scripts/validate-sources.js` | 첫 파일 쓰기 전에 원본 전체를 검증합니다. |
| `validate_site.js` | 실제 배포물의 HTML·링크·메타데이터·콘텐츠·게시 정책을 검사합니다. |
| `scripts/stage-site.js` | GitHub Pages에 올릴 깨끗한 `_site/` 디렉터리를 만듭니다. |

공개 폴더의 자료는 모두 공개 대상입니다. `_source/`와 개발용 파일은 배포 산출물에 포함되지 않습니다.

## 문서 기능

- 카테고리 필터와 URL 상태 보존
- 모바일·키보드 접근 가능한 문서 표
- 사용자별 글자 크기 저장
- 문서 텍스트·페이지 링크 복사
- 문서 목차와 맨 위 이동
- canonical, Open Graph, Twitter Card, JSON-LD
- `sitemap.xml`, `robots.txt`

## 작업 명령

```bash
npm install
npm run check
```

`npm run check`는 다음 고정 순서를 사용합니다.

```text
check:syntax → validate:sources → build → verify:generated → test → stage → validate:artifact
```

개별 명령은 다음과 같습니다.

```bash
npm run build     # 공개 HTML, 목록, SEO 파일 생성
npm run validate:sources # catalog·YAML·fragment·관계 사전 검증
npm test          # 빌더·validator 회귀 테스트
npm run stage     # _site/ 배포물 조립
npm run validate  # 현재 사이트 또는 SITE_ROOT 대상 검증
```

## 회의록 추가·수정

회의록 원본은 frontmatter와 Markdown 본문으로 구성합니다.

```markdown
---
id: "mom:202608"
category: mom
route: "MoM/202608.html"
title: "2026년 8월 운영위원회 회의록"
summary: "회의에서 논의한 핵심 내용을 한 문장으로 정리합니다."
dates:
  publishedOn: 2026-08-07
  modifiedOn: 2026-08-07
  reviewedOn: 2026-08-07
  eventOn: 2026-08-07
workflow:
  status: final
  visibility: public
topicIds: [operations-committee, meeting-minutes]
evidence:
  count: 1
  note: "노동조합 운영위원회 공식 기록"
  noteVisibility: public
  sourceIds: []
  complete: false
relatedDocumentIds: []
displayOrder: 10
type: minutes
presentation:
  print: {}
---

# 2026년 8월 운영위원회 회의록
```

- `publishedOn`, `modifiedOn`, `reviewedOn`은 `YYYY-MM-DD` 형식입니다.
- `type`은 `minutes` 또는 `report`입니다.
- `route`가 공개 파일명과 URL을 결정합니다. 같은 달에 문서가 여러 개면 서로 다른 route를 사용합니다.
- 출력 경로 또는 ID가 중복되면 쓰기 전에 빌드가 실패합니다.
- `summary`는 목록 카드와 상세 head·OG·Twitter·JSON-LD·문서 설명의 유일한 원천입니다.

수정 후 `npm run check`를 실행하고 변경된 원본과 생성 HTML을 함께 커밋합니다. MoM은 별도 생성 manifest를 사용하지 않습니다. catalog와 MoM frontmatter가 같은 콘텐츠 그래프의 입력입니다.

## 성명서 추가·수정

성명서는 `_source/catalog.json`의 v2 `DocumentRecord`와 `_source/statement/*.body.html` 본문을 사용합니다. 공통 헤더, 노조 슬로건, 하단 날짜·로고, 인쇄 크기, 도구막대는 `build_statement.js`가 자동으로 적용합니다.

본문 분량에 따라 `short`, `standard`, `long` 인쇄 밀도가 자동 선택되므로 1페이지와 2페이지 성명서에서 제목과 본문 크기가 각각 조정됩니다. 자세한 구조와 예시는 [`_source/statement/README.md`](_source/statement/README.md)를 참고합니다.

## 지식·알림 문서 추가·수정

1. 전체 HTML 원본을 `_source/knowledge/` 또는 `_source/notice/`에 추가·수정합니다.
2. `_source/catalog.json`의 v2 문서에 `id`, `route`, `title`, `summary`, `dates`, `workflow`, `topicIds`, `evidence`, `relatedDocumentIds`, `displayOrder`, `presentation`을 기록합니다.
3. 공개 문서는 `workflow.visibility: public`, 직접 접근만 허용할 문서는 `unlisted`로 지정합니다. unlisted 문서도 상세 HTML은 생성되지만 목록·ItemList·sitemap에서 제외되고 `noindex,follow`가 붙습니다.
4. `npm run check`를 실행합니다.

공통 CSS와 JavaScript의 캐시 버전은 파일 내용의 SHA-256 해시로 자동 갱신됩니다. 버전 문자열을 수동으로 올릴 필요가 없습니다.

## 배포와 검증

Pull Request에서는 빌드·테스트·실제 `_site/` 검증을 수행합니다. `main` 브랜치에서는 같은 검증이 통과한 뒤 GitHub Pages 배포 작업만 추가로 실행됩니다.

배포물에는 다음 항목만 포함됩니다.

- `index.html`, `sitemap.xml`, `robots.txt`, `.nojekyll`
- `assets/`, `MoM/`, `statement/`, `knowledge/`, `notice/`

`MoM/`의 예상하지 않은 HTML, 누락 링크, 위험 URL, 잘못된 메타데이터, Markdown 잔재, 크기 없는 이미지, 지연 로딩되지 않은 iframe은 검증 실패로 처리됩니다.
