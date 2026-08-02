# 원본 지식 베이스

## 개요

공개 사이트의 기준 콘텐츠와 메타데이터입니다. 빌더가 이 트리를 읽으며 배포 산출물에서는 제외됩니다.

## 작업 위치

| 작업 | 위치 |
| --- | --- |
| 회의록 | `MoM/*.md` |
| 지식 문서 | `knowledge/*.html` |
| 공지 | `notice/*.html` |
| 성명서 | `statement/*.body.html` |
| 문서 메타데이터 | `catalog.json` |
| 공통 분류 | `topics.json`, `sources.json` |
| 검증 계약 | `schemas/*.schema.json` |

## 규칙

- 모든 공개 문서는 고유한 `id`와 `route`를 가진 카탈로그 레코드가 필요합니다.
- 날짜는 `YYYY-MM-DD`를 사용하며 visibility와 workflow가 목록·색인·공개를 제어합니다.
- 성명서 본문은 완성 페이지가 아닌 조각이며 `build_statement.js`가 레이아웃을 적용합니다.
- 회의록 Markdown은 YAML frontmatter 뒤에 본문이 옵니다.

## 금지 사항

- 원본 변경 대신 저장소 루트의 생성 파일을 직접 수정하지 않습니다.
- route나 ID를 재사용하거나 필수 관계 ID를 생략하지 않습니다.
- 생성 HTML만 바꿔 비공개 콘텐츠를 노출하지 말고 원본 workflow 메타데이터를 갱신합니다.
