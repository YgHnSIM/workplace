'use strict';

function getAttribute(node, name) {
  const expectedName = String(name).toLowerCase();
  const attribute = (node && node.attrs || [])
    .find((candidate) => String(candidate.name).toLowerCase() === expectedName);
  return attribute ? attribute.value : undefined;
}

function classNames(node) {
  return new Set(
    String(getAttribute(node, 'class') || '')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function hasClass(node, className) {
  return classNames(node).has(className);
}

function visitNodes(node, callback, ancestors = []) {
  callback(node, ancestors);
  (node.childNodes || []).forEach((child) => (
    visitNodes(child, callback, [...ancestors, node])
  ));
  if (node.content) visitNodes(node.content, callback, [...ancestors, node]);
}

function findElements(node, predicate) {
  const matches = [];
  visitNodes(node, (candidate) => {
    if (candidate.tagName && predicate(candidate)) matches.push(candidate);
  });
  return matches;
}

function findFirstDescendant(node, predicate) {
  let result;
  visitNodes(node, (candidate) => {
    if (!result && candidate !== node && candidate.tagName && predicate(candidate)) {
      result = candidate;
    }
  });
  return result;
}

function textContent(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

function normalizedText(node) {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

module.exports = {
  classNames,
  findElements,
  findFirstDescendant,
  getAttribute,
  hasClass,
  normalizedText,
  textContent,
  visitNodes,
};
