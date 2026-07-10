# 우체국물류지원단 물류노동조합 공개 자료실

우체국물류지원단 물류노동조합의 성명서, 회의록, 지식, 알림 자료를 정적 웹페이지로 공개하는 저장소입니다.

배포 사이트: <https://yghnsim.github.io/workplace/>

## 구성

| 경로 | 역할 |
| --- | --- |
| `index.html` | 전체 자료를 최신순으로 보여주는 아카이브 첫 화면입니다. |
| `_source/MoM/` | 회의록과 결산 자료의 Markdown 원본입니다. |
| `_source/statement/` | 공통 인쇄 템플릿으로 생성할 성명서 본문 원본입니다. |
| `_source/catalog.json` | 성명서, 지식, 알림 문서의 목록 메타데이터입니다. |
| `MoM/` | Markdown에서 생성된 회의록·결산 HTML과 목록입니다. |
| `statement/` | 성명서 원본과 공통 템플릿에서 생성된 공개 HTML입니다. |
| `knowledge/`, `notice/` | 직접 관리하는 공개 상세 문서입니다. |
| `assets/` | 공통 CSS·JavaScript, 최적화 로고, favicon, 공유 이미지입니다. |
| `build_mom.js` | frontmatter와 Markdown을 검증하고 회의록 HTML·manifest를 생성합니다. |
| `build_statement.js` | 카탈로그와 성명서 본문을 검증하고 분량별 인쇄 밀도를 적용한 HTML을 생성합니다. |
| `build_site.js` | 목록, SEO 메타데이터, 자산 해시, sitemap, robots 파일을 생성합니다. |
| `validate_site.js` | 실제 배포물의 HTML·링크·메타데이터·콘텐츠 규칙을 검사합니다. |
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

`npm run check`는 문법 검사, 전체 빌드, 자동 테스트, `_site/` 조립, 실제 배포물 검증을 차례로 수행합니다.

개별 명령은 다음과 같습니다.

```bash
npm run build     # 공개 HTML, 목록, SEO 파일 생성
npm test          # 빌더·validator 회귀 테스트
npm run stage     # _site/ 배포물 조립
npm run validate  # 현재 사이트 또는 SITE_ROOT 대상 검증
```

## 회의록 추가·수정

회의록 원본은 frontmatter와 Markdown 본문으로 구성합니다.

```markdown
---
title: "2026년 8월 운영위원회 회의록"
date: 2026-08-07
excerpt: "회의에서 논의한 핵심 내용을 한 문장으로 정리합니다."
type: minutes
slug: 202608
---

# 2026년 8월 운영위원회 회의록
```

- `date`는 `YYYY-MM-DD` 형식입니다.
- `type`은 `minutes` 또는 `report`입니다.
- `slug`가 공개 파일명과 URL을 결정합니다. 같은 달에 문서가 여러 개면 `202608-regular`, `202608-report`처럼 서로 다른 값을 사용합니다.
- 출력 경로 또는 slug가 중복되면 쓰기 전에 빌드가 실패합니다.
- `excerpt`는 목록 카드에 그대로 사용되므로 본문에서 자동 추출하지 않습니다.

수정 후 `npm run check`를 실행하고 변경된 원본과 생성 HTML을 함께 커밋합니다. `_source/generated/mom.json`은 빌드 중 생성되는 임시 manifest이므로 Git에서 추적하지 않습니다.

## 성명서 추가·수정

성명서는 `_source/catalog.json`의 메타데이터와 `_source/statement/*.body.html` 본문을 사용합니다. 공통 헤더, 노조 슬로건, 하단 날짜·로고, 인쇄 크기, 도구막대는 `build_statement.js`가 자동으로 적용합니다.

본문 분량에 따라 `short`, `standard`, `long` 인쇄 밀도가 자동 선택되므로 1페이지와 2페이지 성명서에서 제목과 본문 크기가 각각 조정됩니다. 자세한 구조와 예시는 [`_source/statement/README.md`](_source/statement/README.md)를 참고합니다.

## 지식·알림 문서 추가·수정

1. 해당 공개 HTML을 추가하거나 수정합니다.
2. `_source/catalog.json`에 `category`, `href`, `title`, ISO 형식 `date`, `excerpt`, `action`을 기록합니다.
3. 상세 HTML의 제목·설명·공유 메타데이터를 실제 내용과 맞춥니다.
4. `npm run check`를 실행합니다.

공통 CSS와 JavaScript의 캐시 버전은 파일 내용의 SHA-256 해시로 자동 갱신됩니다. 버전 문자열을 수동으로 올릴 필요가 없습니다.

## 배포와 검증

Pull Request에서는 빌드·테스트·실제 `_site/` 검증을 수행합니다. `main` 브랜치에서는 같은 검증이 통과한 뒤 GitHub Pages 배포 작업만 추가로 실행됩니다.

배포물에는 다음 항목만 포함됩니다.

- `index.html`, `sitemap.xml`, `robots.txt`, `.nojekyll`
- `assets/`, `MoM/`, `statement/`, `knowledge/`, `notice/`

`MoM/`의 예상하지 않은 HTML, 누락 링크, 위험 URL, 잘못된 메타데이터, Markdown 잔재, 크기 없는 이미지, 지연 로딩되지 않은 iframe은 검증 실패로 처리됩니다.
