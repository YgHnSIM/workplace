# 우체국물류지원단 물류노동조합 공개 자료실

우체국물류지원단 물류노동조합의 성명서, 회의록, 알림 자료를 정적 웹페이지로 공개하는 저장소입니다.

배포 사이트: <https://yghnsim.github.io/workplace/>

## 구성

| 경로 | 역할 |
| --- | --- |
| `index.html` | 전체 자료 아카이브 첫 화면입니다. `build_site.js`로 생성됩니다. |
| `MoM/` | 운영위원회 회의록 공개 HTML과 회의록 목록 페이지입니다. |
| `_source/MoM/` | 회의록 원본 Markdown입니다. `npm run build` 때 `MoM/*.html`로 변환됩니다. |
| `_source/generated/mom.json` | 회의록 목록 생성을 위한 자동 생성 manifest입니다. |
| `_source/catalog.json` | 성명서, 알림, 지식 문서의 공개 목록 메타데이터입니다. |
| `statement/` | 성명서 상세 HTML입니다. |
| `notice/` | 알림 상세 HTML과 첨부 이미지입니다. |
| `knowledge/` | 지식 자료 상세 HTML과 목록 페이지입니다. |
| `assets/` | 공통 CSS, 문서 툴바, 아카이브 필터 스크립트입니다. |
| `build_mom.js` | 회의록 HTML과 `MoM/index.html`을 생성합니다. |
| `build_site.js` | 루트 아카이브, `notice/index.html`, `knowledge/index.html`을 생성합니다. |
| `validate_site.js` | 링크, 누락 파일, 회의록 목록, 공개 금지 패턴을 검사합니다. |

## 공개 문서

- 성명서: `statement/성명서_202607.html`
- 운영위원회 회의록 목록: `MoM/index.html`
- 지식 자료
  - `knowledge/sick-leave-double-reduction.html`
- 알림
  - `notice/logistics-union-9-years.html`
  - `notice/2025-performance-pay.html`

루트 아카이브는 `index.html`에서 성명서, 회의록, 알림을 한 화면에 모아 보여주며, 카테고리 필터를 제공합니다.

## 문서 기능

상세 문서는 공통 툴바를 사용합니다.

- 글자 크기 크게
- 글자 크기 작게
- 글자 크기 초기화
- 텍스트 복사
- 웹페이지 링크 복사
- 맨 위로 이동

공통 동작은 `assets/document-tools.js`에서 관리합니다.

## 작업 명령

```bash
npm run build
```

회의록과 아카이브 목록을 다시 생성합니다.

```bash
npm run validate
```

생성된 HTML의 내부 링크, 회의록 목록, 공개 금지 패턴을 검사합니다.

```bash
npm run check
```

JavaScript 문법 검사, 빌드, 사이트 검증을 모두 실행합니다. 배포 전 기본 확인 명령입니다.

## 회의록 수정 절차

1. `_source/MoM/`의 해당 Markdown 파일을 수정합니다.
2. 새 회의록은 파일명을 `YYYYMM 운영위원회 회의록.md` 형식으로 추가합니다.
3. `npm run check`를 실행합니다.
4. 생성된 `MoM/*.html`, `MoM/index.html`, `_source/generated/mom.json`, `index.html` 변경분을 함께 커밋합니다.

회의록 공개 HTML은 원본 Markdown에서 생성되므로, `MoM/*.html`만 직접 수정하면 다음 빌드 때 덮어써집니다.

## 성명서·알림 문서 수정 절차

1. 공개 HTML 파일을 직접 수정합니다.
2. 문서가 루트 아카이브에 표시되어야 하면 `_source/catalog.json`의 메타데이터를 함께 수정합니다.
3. `npm run check`를 실행합니다.
4. 생성된 카테고리 목록과 루트 아카이브 변경분을 함께 커밋합니다.

`draft: true`가 붙은 catalog 항목은 아카이브 목록에 표시되지 않습니다. 단, HTML 파일을 공개 폴더에 두면 직접 URL 접근은 가능하므로 비공개 초안은 public 폴더에 두지 마세요.

## 배포

이 저장소는 GitHub Pages 정적 사이트로 배포됩니다. `main` 브랜치에 커밋을 푸시하면 배포 사이트에 반영됩니다.

```bash
git status
git add -A
git commit -m "변경 내용 요약"
git push
```

## 주의사항

- `_source/`는 `_config.yml`에서 Pages 배포 제외 대상으로 지정되어 있습니다.
- `MoM/` 폴더에는 원본 Markdown을 두지 않습니다. 검증 스크립트가 public 회의록 폴더의 Markdown 파일을 오류로 처리합니다.
- `statement/index.html`은 중복 별칭 페이지로 제거했습니다. 성명서는 개별 HTML 파일로 연결합니다.
- `knowledge/test.html`은 임시 페이지로 제거했습니다. 지식 자료는 실제 공개 글만 둡니다.
- `notice/test.html`은 공개 사이트에 있으면 검증 실패로 처리됩니다.
- 공통 CSS 또는 JS를 바꾸면 `build_mom.js`, `build_site.js`의 `assetVersion`도 함께 올려 캐시를 갱신합니다.
