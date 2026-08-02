# 프로젝트 지식 베이스

**생성일:** 2026-08-02
**커밋:** ca77ed8
**브랜치:** main

## 개요

Node.js로 구축한 한국어 공공정보 사이트입니다. `_source/`의 Markdown/YAML과 관리 HTML을 검증해 공개 페이지와 GitHub Pages 산출물로 변환합니다.

## 구조

```text
_source/       원본 콘텐츠, 카탈로그, 스키마, 성명서 조각
lib/           공통 파싱·모델·HTML·사이트 도우미
scripts/       빌드·원본 검증·스테이징·확인
test/          Node 회귀 테스트와 fixture
assets/        공통 CSS, 브라우저 JavaScript, 이미지, 로고
MoM/           생성된 회의록 페이지
statement/     생성된 성명서 페이지
knowledge/     공개 지식 문서
notice/        공개 공지 문서
_site/         GitHub Pages 배포 산출물
```

## 작업 위치

| 작업 | 위치 | 비고 |
| --- | --- | --- |
| 회의록 추가·수정 | `_source/MoM/` | YAML frontmatter + Markdown 본문 |
| 성명서 추가·수정 | `_source/catalog.json`, `_source/statement/` | 조각 HTML과 메타데이터 결합 |
| 문서 검증 변경 | `lib/content-model.js`, `_source/schemas/` | 런타임 검사와 JSON 스키마를 함께 변경 |
| 생성 마크업 변경 | `lib/`, `build_*.js` | 공개 산출물을 다시 빌드 |
| 배포 산출물 검증 | `validate_site.js`, `scripts/stage-site.js` | `_site/`를 최종 검증 |

## 코드 맵

| 파일 | 역할 |
| --- | --- |
| `lib/content-model.js` | 카탈로그·원본 레코드와 관계 검증 |
| `lib/html-tree.js` | HTML 파싱 및 트리 도우미 |
| `lib/statement-fragment.js` | 성명서 조각 정규화·페이지 분할 |
| `build_mom.js` | 원본 회의록에서 페이지 생성 |
| `build_statement.js` | 카탈로그와 조각에서 성명서 생성 |
| `build_site.js` | 목록·SEO 파일·사이트 메타데이터 생성 |
| `validate_site.js` | HTML·링크·메타데이터·embed 검증 |

## 규칙 및 금지 사항

- 원본 레코드는 안정적인 ID와 route를 사용하며 생성 파일은 검증합니다.
- 공개 여부, route, 날짜, 관계 ID, 근거 필드는 카탈로그 데이터로 관리합니다.
- 생성된 `MoM/`, `statement/`, `index.html`, SEO 파일, `_site/`를 직접 수정하지 않습니다.
- `_source/catalog.json`을 갱신하고 원본 검증을 통과하지 않은 문서는 공개하지 않습니다.
- `npm run check`를 생략하지 않습니다. 구문·원본·빌드·테스트·스테이징·산출물을 모두 확인합니다.

## 명령어

```bash
npm ci
npm run check
npm run build
npm test
npm run stage
npm run validate
```

## 참고

`_config.yml`은 Jekyll 처리에서 `_source/`를 제외합니다. GitHub Actions는 Node 20에서 검사 후 `main`의 `_site/`만 배포합니다.
