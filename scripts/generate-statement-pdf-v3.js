const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

function getChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome or Edge browser executable not found.');
}

function generateA2Html() {
  const logo600Path = path.join(projectRoot, 'assets', 'logo-header-600.webp');
  const logoBase64 = fs.readFileSync(logo600Path).toString('base64');
  const logoDataUri = `data:image/webp;base64,${logoBase64}`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>단시간·비정규 노동자 차별을 제도화한 사측과 교섭대표노조를 규탄한다 — 중앙노동위원회 재심 판정 승소를 알리며 —</title>
  <style>
    @page {
      size: 420mm 594mm;
      margin: 10mm 15mm 10mm 15mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      background: #FFFFFF;
      color: #111111;
      font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* 전체 연속 플로우 컨테이너 */
    .statement-container {
      width: 100%;
      box-sizing: border-box;
    }

    /* 1페이지 헤더 */
    .statement-header {
      border-bottom: 3.5px solid #111111;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .statement-identity {
      display: flex;
      align-items: center;
      gap: 22px;
      font-size: 28px;
      font-weight: 700;
      color: #333333;
      padding-top: 14px;
      position: relative;
    }

    .statement-identity::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 3.5px;
      background: linear-gradient(to right, #002FA7 0 130px, #D9D9D9 130px 100%);
    }

    .statement-identity span + span {
      border-left: 2.5px solid #B8B8B8;
      padding-left: 22px;
    }

    .statement-brand-mark {
      width: 100px;
      height: 100px;
      overflow: hidden;
      display: block;
      background: #FFFFFF;
    }

    .statement-brand-mark img {
      height: 100%;
      width: auto;
      max-width: none;
      object-fit: cover;
      object-position: left center;
    }

    /* 대제목: 70px, 3행 구조 */
    .statement-title {
      color: #002FA7;
      font-size: 70px;
      font-weight: 800;
      line-height: 1.20;
      letter-spacing: -0.04em;
      word-break: keep-all;
    }

    .statement-title-line {
      display: block;
    }

    /* 부제 뱃지: 로열 딥 골드 테두리 + 다크 오커 글자색 */
    .statement-title-line:last-child {
      display: inline-block;
      font-size: 42px;
      font-weight: 800;
      color: #92400E;
      background: #FEF3C7;
      border: 2.5px solid #B45309;
      border-radius: 8px;
      padding: 8px 24px;
      margin-top: 34px;
      letter-spacing: -0.02em;
    }

    /* 본문 공통 스타일 (1, 2페이지 동일한 36px) */
    .body-text {
      color: #1A1A1A;
      font-size: 36px;
      font-weight: 600;
      line-height: 1.62;
      text-align: justify;
      word-break: keep-all;
      margin-bottom: 10px;
    }

    .body-text:last-child {
      margin-bottom: 0;
    }

    .body-text.no-indent {
      font-weight: 700;
      color: #111111;
      font-size: 37px;
      margin-bottom: 8px;
    }

    /* 소제목 섹션: 구분선 위에 공백 */
    .section-title {
      color: #002FA7;
      font-size: 42px;
      font-weight: 800;
      line-height: 1.25;
      border-top: 2.5px solid #111111;
      padding-top: 14px;
      margin-top: 46px;
      margin-bottom: 10px;
      position: relative;
      word-break: keep-all;
    }

    .section-title::before {
      content: "";
      position: absolute;
      top: -2.5px;
      left: 0;
      width: 100px;
      height: 5px;
      background: #002FA7;
    }

    section {
      margin-bottom: 14px;
    }

    .intro-section {
      margin-bottom: 14px;
    }

    /* 요구안 박스: 39px */
    .demands {
      background: #F8F9FA;
      border: 2.5px solid #111111;
      border-left: 14px solid #002FA7;
      padding: 18px 32px;
      margin: 12px 0 16px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .demands ol {
      padding-left: 44px;
      margin: 0;
    }

    .demands li {
      font-size: 39px;
      font-weight: 600;
      line-height: 1.58;
      color: #1A1A1A;
      padding: 6px 0;
      word-break: keep-all;
    }

    .demands li strong {
      color: #002FA7;
      font-weight: 800;
    }

    /* 맺음말 블록 */
    .closing-block {
      border-top: 3.5px solid #002FA7;
      border-bottom: 3.5px solid #002FA7;
      padding: 16px 0;
      margin: 38px 0;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .closing-highlight {
      font-size: 42px;
      font-weight: 800;
      color: #C8102E; /* 크림슨 레드 */
      line-height: 1.30;
      margin-bottom: 8px;
      word-break: keep-all;
    }

    .closing-text {
      font-size: 35px;
      font-weight: 700;
      color: #111111;
      line-height: 1.40;
      word-break: keep-all;
    }

    /* 서명 블록 */
    .signature-block {
      margin-top: 50px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .signature-date {
      font-size: 34px;
      font-weight: 800;
      color: #111111;
      letter-spacing: 0.05em;
      margin-bottom: 68px;
    }

    .signature-org-row {
      display: flex;
      justify-content: center;
      align-items: center;
      padding-bottom: 6px;
    }

    .signature-org-logo {
      width: 460px;
      height: auto;
      display: block;
    }
  </style>
</head>
<body>
  <div class="statement-container">
    <header class="statement-header">
      <div class="header-top">
        <p class="statement-identity">
          <span>차별 없는 일터</span>
          <span>병들지 않는 노동</span>
        </p>
        <span class="statement-brand-mark" aria-hidden="true">
          <img src="${logoDataUri}" alt="">
        </span>
      </div>
      <h1 class="statement-title">
        <span class="statement-title-line">단시간·비정규 노동자 차별을 제도화한</span>
        <span class="statement-title-line">사측과 교섭대표노조를 규탄한다</span>
        <span class="statement-title-line">— 중앙노동위원회 재심 판정 승소를 알리며 —</span>
      </h1>
    </header>

    <div class="statement-body">
      <section class="intro-section">
        <p class="body-text">
          우리 조합원 성소옥 동지가 제기한 차별시정 재심에서, 중앙노동위원회는 지원단의 유급병가 제도가 단시간근로자에 대한 차별적 처우임을 인정하였다.
        </p>
        <p class="body-text">
          통상근로자에게는 연간 유급병가 60일을 부여하면서, 단시간근로자(석근)에게는 30일만 부여한 것은 「기간제법」이 금지하는 차별이다. 병가를 유급으로 처리하는 시간에서 이미 근로시간 비례가 반영되는데, 사용 가능 일수까지 다시 절반으로 줄인 것은 시간비례가 아니라 이중삭감이다. 중앙노동위원회가 이를 차별이라 판정한 것은 지극히 상식적인 결론이다.
        </p>
      </section>

      <section>
        <h2 class="section-title">1. 사측과 교섭대표노동조합의 차별적 노사합의를 규탄한다</h2>
        <p class="body-text">
          이 차별은 사측과 교섭대표노동조합이 2025년 노사협정에서 단시간근로자의 유급병가 일수를 근로시간 비례로 축소하기로 합의하며 제도화한 결과다. 차별은 노사합의라는 형식으로 결코 정당화될 수 없으며, 노동자를 지켜야 할 노동조합 스스로의 본분을 근본적으로 저버린 배반일 뿐이다. 우리는 단시간근로자의 치료와 회복, 생계를 침해한 이 차별적 노사합의를 강력히 규탄한다.
        </p>
      </section>

      <section>
        <h2 class="section-title">2. 교섭대표노동조합은 자기 조합원도 배반하고 권익을 침해했다</h2>
        <p class="body-text">
          교섭대표노동조합에도 이 협정으로 유급병가가 축소되는 단시간근로자 조합원이 있다. 그럼에도 단시간근로자라는 고용형태를 이유로 병가 권리를 침해하는 합의를 한 것은, 노동조합이 스스로 지켜 내야 할 조합원을 저버린 배반이다. 「노조법」 제9조가 정한 고용형태 차별 금지원칙을 정면으로 거스른 행위이기도 하다.
        </p>
      </section>

      <section>
        <h2 class="section-title">3. 가족수당의 정규직·비정규직 차별 합의도 규탄한다<br>— 향후 임금교섭에서 반드시 시정하라</h2>
        <p class="body-text">
          문제는 유급병가에 그치지 않는다. 지난 임금교섭에서도 사측과 교섭대표노동조합은 정규직과 달리 비정규직에게 가족수당을 차별하는 내용의 합의를 또 하였다.<br>
          유급병가에서는 통상근로자와 단시간근로자를, 가족수당에서는 정규직과 비정규직을 가르는 차별이 노사합의의 이름으로 반복되고 있다. 우리는 이 가족수당 차별 합의를 규탄하며, 향후 임금교섭에서 반드시 시정할 것을 요구한다. 차별 없는 임금·수당·복리후생은 선택이 아니라 의무다.
        </p>
        <p class="body-text">
          정규직·통상근로자 중심의 이익만을 앞세우고 단시간 조합원을 희생양으로 삼은 합의는 교섭이 아니라 직무유기이며, 물류노동자에 대한 권익 침해다. 우리는 교섭대표노동조합의 이 배반적 합의를 규탄하며, 물류노동자의 권익을 짓밟는 합의를 결코 용납하지 않을 것임을 분명히 한다.
        </p>
      </section>

      <section>
        <h2 class="section-title">4. 사측은 재심 결과를 즉시 수용하라</h2>
        <p class="body-text">
          중앙노동위원회의 차별 시정 판정은 너무나 당연한 결과다. 사측은 재심 판정을 즉시 수용하고, 단시간근로자에게도 통상근로자와 동일한 유급병가 사용 가능 일수를 보장하도록 즉시 제도를 시정해야 한다. 행정소송 등 불필요한 법적 대응으로 시간을 끌며 행정적·경제적 비용을 낭비하는 것은 공공성과 책임을 저버리는 행위이다. 그럴 예산과 행정력이 있다면 노동조건을 개선하고 차별 없는 일터를 만드는 데 쓰라.
        </p>
      </section>

      <section>
        <h2 class="section-title">5. 우리의 요구</h2>
        <p class="body-text no-indent">우리는 사측과 교섭대표노동조합에 다음과 같이 요구한다.</p>

        <div class="demands">
          <ol>
            <li>사측은 <strong>중앙노동위원회 재심 판정을 즉시 수용</strong>하라.</li>
            <li>단시간근로자에게도 통상근로자와 동일한 <strong>유급병가 사용 가능 일수를 보장</strong>하도록 제도를 시정하라.</li>
            <li>교섭대표노동조합은 <strong>차별적 노사합의(유급병가, 가족수당)에 대해 물류노동자들에게 사과</strong>하고, <strong>고용형태에 따른 차별 합의를 반복하지 않을 것을 약속</strong>하라.</li>
            <li>향후 임금교섭에서 <strong>고용형태에 따른 차별 없는 임금, 수당, 복리후생을 보장</strong>하라.</li>
          </ol>
        </div>
      </section>

      <div class="closing-block">
        <p class="closing-highlight">차별은 노사합의로 정당화되지 않는다.</p>
        <p class="closing-text">중앙노동위원회가 확인한 상식을, 현장의 권리로 만들 때까지<br>우리는 투쟁을 멈추지 않을 것이다.</p>
      </div>

      <div class="signature-block">
        <p class="signature-date"><time datetime="2026-09-21">2026년 9월 21일</time></p>
        <div class="signature-org-row">
          <img src="${logoDataUri}" alt="우체국물류지원단 물류노동조합" class="signature-org-logo">
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;
}

function buildPdf(options = {}) {
  const chromePath = getChromePath();
  const htmlContent = generateA2Html();
  const tempHtmlPath = path.join(projectRoot, 'temp_statement_a2_v3.html');
  const outputPdfPath = options.outputPath || path.join(projectRoot, '성명서_20260921_A2_v3.pdf');

  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outputPdfPath}`,
      `file:///${tempHtmlPath.replace(/\\/g, '/')}`,
    ];

    console.log(`Rendering 2-page A2 PDF (v3) with ${chromePath}...`);
    const result = spawnSync(chromePath, args, { encoding: 'utf8' });
    if (result.error) throw result.error;

    if (!fs.existsSync(outputPdfPath)) {
      throw new Error(`PDF was not created at ${outputPdfPath}`);
    }

    const pdfBuffer = fs.readFileSync(outputPdfPath, 'latin1');
    const pageCount = (pdfBuffer.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const fileSize = fs.statSync(outputPdfPath).size;

    console.log(`Success! Created ${outputPdfPath}`);
    console.log(`Page count: ${pageCount}, File size: ${fileSize} bytes`);

    return { outputPdfPath, pageCount, fileSize };
  } finally {
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
}

if (require.main === module) {
  try {
    buildPdf();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { buildPdf };
