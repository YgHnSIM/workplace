'use strict';

const parse5 = require('parse5');
const {
  classNames,
  hasClass,
  textContent,
  visitNodes,
} = require('./html-tree');

const ALLOWED_TAGS = new Set([
  'section',
  'h2',
  'p',
  'div',
  'ol',
  'ul',
  'li',
  'strong',
  'em',
  'br',
]);
const ALLOWED_CLASSES = new Set([
  'intro-section',
  'section-title',
  'body-text',
  'no-indent',
  'demands',
  'closing-block',
  'closing-highlight',
  'closing-text',
]);

function emptyMetrics() {
  return {
    sectionCount: 0,
    sectionTitleCount: 0,
    paragraphCount: 0,
    lineBreakCount: 0,
    demandCount: 0,
    closingRowCount: 0,
    characterCount: 0,
  };
}

function analyzeStatementFragment(fragment, sourcePath = 'statement body fragment') {
  const source = String(fragment || '');
  const label = typeof sourcePath === 'string' ? sourcePath : String(sourcePath);
  const errors = [];
  const metrics = emptyMetrics();
  const report = (message) => errors.push(`${label}: ${message}`);

  if (!source.trim()) {
    report('statement body is empty');
    return {
      errors,
      html: '',
      metrics,
      success: false,
    };
  }

  const document = parse5.parseFragment(source, { sourceCodeLocationInfo: true });
  const closingBlocks = [];
  const closingParagraphs = [];
  let demandBlockCount = 0;

  visitNodes(document, (node, ancestors) => {
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') {
      report('contains unsupported comment or doctype markup');
    }
    if (!node.tagName) return;

    if (!ALLOWED_TAGS.has(node.tagName)) {
      report(`contains unsupported <${node.tagName}> markup`);
    }
    (node.attrs || []).forEach((attribute) => {
      if (attribute.name !== 'class') {
        report(`contains unsupported ${attribute.name} attribute on <${node.tagName}>`);
      }
    });
    classNames(node).forEach((className) => {
      if (!ALLOWED_CLASSES.has(className)) {
        report(`contains unsupported class: ${className}`);
      }
    });

    if (node.tagName === 'section') metrics.sectionCount += 1;
    if (node.tagName === 'h2' && hasClass(node, 'section-title')) metrics.sectionTitleCount += 1;
    if (node.tagName === 'p' && hasClass(node, 'body-text')) metrics.paragraphCount += 1;
    if (node.tagName === 'br') metrics.lineBreakCount += 1;
    if (node.tagName === 'div' && hasClass(node, 'demands')) demandBlockCount += 1;
    if (node.tagName === 'li'
      && node.parentNode && ['ol', 'ul'].includes(node.parentNode.tagName)
      && ancestors.some((ancestor) => hasClass(ancestor, 'demands'))) {
      metrics.demandCount += 1;
    }
    if (node.tagName === 'div' && hasClass(node, 'closing-block')) closingBlocks.push(node);
    if (node.tagName === 'p' && (hasClass(node, 'closing-highlight') || hasClass(node, 'closing-text'))) {
      closingParagraphs.push(node);
    }
  });

  metrics.characterCount = textContent(document).replace(/\s+/g, '').length;
  if (metrics.sectionCount < 1 || metrics.sectionTitleCount < 1 || metrics.paragraphCount < 1) {
    report('must contain sections, section-title headings, and body-text paragraphs');
  }
  if (demandBlockCount > 1) report('may contain at most one demands block');
  if (demandBlockCount === 1 && metrics.demandCount < 1) {
    report('demands block must contain at least one list item');
  }

  if (closingBlocks.length !== 1) {
    report('must contain one closing block with highlights and one closing-text row');
  } else {
    const closingBlock = closingBlocks[0];
    if (closingBlock.parentNode !== document) {
      report('closing block must be a top-level element');
    }

    const closingRows = (closingBlock.childNodes || []).filter((node) => node.tagName);
    const invalidClosingText = (closingBlock.childNodes || [])
      .some((node) => node.nodeName === '#text' && String(node.value || '').trim());
    const validClosingRows = closingRows.every((node) => (
      node.tagName === 'p'
      && (hasClass(node, 'closing-highlight') || hasClass(node, 'closing-text'))
    ));
    const closingTextRows = closingRows.filter((node) => hasClass(node, 'closing-text'));
    if (invalidClosingText || !validClosingRows || closingRows.length < 2
      || closingTextRows.length !== 1 || !hasClass(closingRows.at(-1), 'closing-text')) {
      report('closing block must end with one closing-text row after its highlights');
    }
    if (closingParagraphs.some((node) => node.parentNode !== closingBlock)) {
      report('closing rows must be direct children of the closing block');
    }
    metrics.closingRowCount = closingRows.length;

    const topLevelElements = (document.childNodes || []).filter((node) => node.tagName);
    const invalidTopLevelNode = (document.childNodes || []).find((node) => {
      if (node.nodeName === '#text') return String(node.value || '').trim();
      if (node.tagName === 'section') return false;
      return node !== closingBlock;
    });
    if (invalidTopLevelNode || topLevelElements.at(-1) !== closingBlock) {
      report('may contain only sections followed by the closing block at the top level');
    }
  }

  return {
    errors,
    html: parse5.serialize(document).trim(),
    metrics,
    success: errors.length === 0,
  };
}

function inspectStatementFragment(fragment, sourcePath = 'statement body fragment') {
  const source = String(fragment || '');
  const label = typeof sourcePath === 'string' ? sourcePath : String(sourcePath);
  if (!source.trim()) {
    throw new Error(`${label} must contain sections, section-title headings, and body-text paragraphs`);
  }
  const analysis = analyzeStatementFragment(fragment, sourcePath);
  if (!analysis.success) {
    const firstError = analysis.errors[0].replace(`${label}: `, `${label} `);
    throw new Error(firstError);
  }
  return analysis;
}

function validateStatementFragment(fragment, sourcePath = 'statement body fragment') {
  return inspectStatementFragment(fragment, sourcePath).metrics;
}

module.exports = {
  analyzeStatementFragment,
  inspectStatementFragment,
  validateStatementFragment,
};
