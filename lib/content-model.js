const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const YAML = require('yaml');
const { analyzeStatementFragment } = require('./statement-fragment');

const DOCUMENT_SCHEMA = require('../_source/schemas/document.schema.json');
const CATALOG_SCHEMA = require('../_source/schemas/catalog.schema.json');
const TOPICS_SCHEMA = require('../_source/schemas/topics.schema.json');
const SOURCES_SCHEMA = require('../_source/schemas/sources.schema.json');

const SCHEMA_VERSION = 2;
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');

const CATEGORY_REGISTRY = Object.freeze([
  Object.freeze({
    key: 'statement',
    label: '성명서',
    directory: 'statement',
    title: '성명서',
    description: '노동 현장의 쟁점과 요구를 알리는 노동조합 성명서입니다.',
    action: '성명서 보기',
    order: 0,
  }),
  Object.freeze({
    key: 'mom',
    label: '회의록',
    directory: 'MoM',
    title: '운영위원회 회의록',
    description: '우체국물류지원단 물류노동조합 운영위원회의 정기·임시 회의록과 결산 자료입니다.',
    action: '회의록 전문 보기',
    actions: Object.freeze({ minutes: '회의록 전문 보기', report: '결산 자료 전문 보기' }),
    order: 1,
  }),
  Object.freeze({
    key: 'knowledge',
    label: '지식',
    directory: 'knowledge',
    title: '지식',
    description: '노동·법률 쟁점을 판례와 공개 자료에 비추어 해설한 지식 자료입니다.',
    action: '지식 자료 보기',
    order: 2,
  }),
  Object.freeze({
    key: 'notice',
    label: '알림',
    directory: 'notice',
    title: '알림',
    description: '노동조합의 활동 기록과 조합원 안내를 모았습니다.',
    action: '알림 보기',
    order: 3,
  }),
]);

const CATEGORY_BY_ID = new Map(CATEGORY_REGISTRY.map((category) => [category.key, category]));

const TOPIC_LABEL_TO_ID = Object.freeze({
  '건강권': 'health-rights',
  '검토·결산': 'review-summary',
  '결산': 'review-summary',
  '고용안정': 'employment-stability',
  '교섭단위': 'bargaining-unit',
  '노동강도': 'labor-intensity',
  '노조 역사': 'union-history',
  '단체교섭': 'collective-bargaining',
  '병가': 'sick-leave',
  '성과급': 'performance-pay',
  '운영위원회': 'operations-committee',
  '원청 사용자성': 'lead-employer-status',
  '인력충원': 'staffing',
  '임금': 'wages',
  '직무수당': 'job-allowance',
  '차별': 'discrimination',
  '퇴직금': 'severance-pay',
  '퇴직연금': 'retirement-pension',
  '평균임금': 'average-wage',
  '회의록': 'meeting-minutes',
  'DB·DC': 'db-dc',
  'DB/DC': 'db-dc',
});

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(DOCUMENT_SCHEMA, DOCUMENT_SCHEMA.$id);
const validateDocumentSchema = ajv.compile(DOCUMENT_SCHEMA);
const validateCatalogSchema = ajv.compile(CATALOG_SCHEMA);
const validateTopicsSchema = ajv.compile(TOPICS_SCHEMA);
const validateSourcesSchema = ajv.compile(SOURCES_SCHEMA);

class ContentGraphValidationError extends Error {
  constructor(errors, data) {
    super(errors.join('\n'));
    this.name = 'ContentGraphValidationError';
    this.errors = errors;
    this.data = data;
  }
}

function makeLookup(entries) {
  return new Map(entries);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function readJsonFile(filePath, label, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push(`${label}: file is missing`);
    return undefined;
  }
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function relativePath(projectRoot, filePath) {
  return String(path.relative(projectRoot, filePath)).replace(/\\/g, '/');
}

function ajvErrors(errors, label, validator) {
  if (validator.errors) {
    validator.errors.forEach((error) => {
      const pointer = error.instancePath || '/';
      const location = pointer === '/' ? '' : pointer;
      errors.push(`${label}${location}: ${error.message}`);
    });
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(value) {
  return String(value).normalize('NFC').toLocaleLowerCase('en-US');
}

function assertDate(value, label, errors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${label}: must be a valid YYYY-MM-DD date`);
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${label}: must be a valid calendar date`);
    return false;
  }
  return true;
}

function validateRoute(route, category, label, errors) {
  if (typeof route !== 'string' || !route.trim()) {
    errors.push(`${label}.route: must be a non-empty POSIX relative .html path`);
    return undefined;
  }
  const value = route.trim();
  const categoryMeta = CATEGORY_BY_ID.get(category);
  const segments = value.split('/');
  const unsafe = !value.endsWith('.html')
    || value.includes('\\')
    || value.startsWith('/')
    || value.startsWith('//')
    || value.includes('?')
    || value.includes('#')
    || value.includes('%')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || segments.some((segment) => !segment || segment === '.' || segment === '..');
  if (unsafe) {
    errors.push(`${label}.route: unsafe POSIX relative .html path (${value})`);
    return undefined;
  }
  if (categoryMeta && segments[0] !== categoryMeta.directory) {
    errors.push(`${label}.route: must be inside ${categoryMeta.directory}/ for category ${category}`);
  }
  if (path.posix.normalize(value) !== value) {
    errors.push(`${label}.route: must not contain redundant path segments`);
  }
  return value;
}

function validateSocialImage(socialImage, projectRoot, label, errors) {
  if (typeof socialImage !== 'string' || !socialImage.trim()) return;
  const value = socialImage.trim();
  const segments = value.split('/');
  const unsafe = value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || value.includes('%')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || path.posix.normalize(value) !== value;
  if (unsafe) {
    errors.push(`${label}.socialImage: unsafe POSIX relative image path (${value})`);
    return;
  }
  const filePath = path.join(projectRoot, ...segments);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    errors.push(`${label}.socialImage: image file is missing (${value})`);
  }
}

function parseYamlFrontMatter(markdown, sourcePath) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`${sourcePath}: YAML frontmatter must start and end with ---`);
  }
  const document = YAML.parseDocument(match[1], { uniqueKeys: true, prettyErrors: true });
  if (document.errors.length) {
    throw new Error(`${sourcePath}: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  const metadata = document.toJS({ maxAliasCount: 0 });
  if (!isObject(metadata)) throw new Error(`${sourcePath}: frontmatter must be a mapping`);
  return { metadata, body: source.slice(match[0].length) };
}

function parseLegacyFrontMatter(markdown, sourcePath) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${sourcePath}: legacy frontmatter is missing`);
  const metadata = {};
  match[1].split(/\r?\n/).forEach((line, index) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) throw new Error(`${sourcePath}:${index + 2}: invalid legacy frontmatter`);
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    metadata[field[1]] = value;
  });
  return { metadata, body: source.slice(match[0].length) };
}

function sourcePathForDocument(projectRoot, document) {
  if (!document || typeof document.route !== 'string') return undefined;
  const relativeRoute = document.route.split('/').slice(1).join('/');
  if (document.category === 'mom') return undefined;
  if (document.category === 'statement') {
    return path.join(projectRoot, '_source', 'statement', `${relativeRoute.slice(0, -'.html'.length)}.body.html`);
  }
  return path.join(projectRoot, '_source', document.category, relativeRoute);
}

function readDirectoryFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && predicate(target, entry.name)) files.push(target);
    });
  };
  visit(directory);
  return files;
}

function topicIdsFromLegacy(value, topicRegistry) {
  const labels = Array.isArray(value) ? value : [];
  return labels.map((label) => {
    const text = String(label || '').trim();
    const mapped = TOPIC_LABEL_TO_ID[text];
    if (mapped && topicRegistry.has(mapped)) return mapped;
    const byLabel = [...topicRegistry.values()].find((topic) => topic.label === text);
    return byLabel ? byLabel.id : text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }).filter(Boolean);
}

function legacyRecord(raw, sourceLabel, topicRegistry, routeToId) {
  const route = String(raw.href || raw.route || '').replace(/\\/g, '/');
  const category = String(raw.category || '');
  const id = `${category}:${path.posix.basename(route, '.html')}`.normalize('NFC');
  const relatedDocumentIds = Array.isArray(raw.relatedDocuments)
    ? raw.relatedDocuments.map((related) => routeToId.get(normalizeKey(related)) || `${String(related).split('/')[0]}:${path.posix.basename(String(related), '.html')}`)
    : [];
  const publishedOn = raw.publishedOn || raw.date;
  const modifiedOn = raw.modifiedOn || raw.dateModified || publishedOn;
  return {
    id,
    category,
    route,
    title: String(raw.title || '').trim(),
    summary: String(raw.summary || raw.excerpt || '').trim(),
    dates: {
      publishedOn,
      modifiedOn,
      reviewedOn: raw.reviewedOn || modifiedOn,
      ...(category === 'mom' || category === 'statement' ? { eventOn: raw.eventOn || publishedOn } : {}),
    },
    workflow: { status: raw.status || 'final', visibility: 'public' },
    topicIds: topicIdsFromLegacy(raw.topics, topicRegistry),
    evidence: {
      count: Number.isInteger(raw.sourceCount) ? raw.sourceCount : 1,
      note: String(raw.provenance || '공개 기록').trim(),
      noteVisibility: raw.showProvenance === false ? 'private' : 'public',
      sourceIds: [],
      complete: false,
    },
    relatedDocumentIds,
    displayOrder: Number.isInteger(raw.displayOrder) ? raw.displayOrder : (Number(raw.order) || 0),
    presentation: {
      print: raw.printTitleLines ? { titleLines: raw.printTitleLines } : {},
    },
    ...(category === 'mom' && raw.type ? { type: raw.type } : {}),
    ...(raw.socialImage ? { socialImage: raw.socialImage } : {}),
  };
}

function addSchemaErrors(value, label, validator, errors) {
  if (!validator(value)) {
    ajvErrors(errors, label, validator);
    return false;
  }
  return true;
}

function checkCategorySpecificFields(document, label, errors) {
  if (document.category !== 'mom' && document.type !== undefined) {
    errors.push(`${label}.type: is only allowed for category mom`);
  }
  if (document.category !== 'statement'
    && document.presentation && document.presentation.print
    && document.presentation.print.titleLines !== undefined) {
    errors.push(`${label}.presentation.print.titleLines: is only allowed for category statement`);
  }
  if (document.category !== 'mom' && document.category !== 'statement'
    && document.dates && document.dates.eventOn !== undefined) {
    errors.push(`${label}.dates.eventOn: is only allowed for meeting and statement documents`);
  }
  if (document.socialImage !== undefined && document.category !== 'notice') {
    errors.push(`${label}.socialImage: is only allowed for notice documents`);
  }
  if (document.category === 'mom' && !['minutes', 'report'].includes(document.type)) {
    errors.push(`${label}.type: must be minutes or report for category mom`);
  }
  if (document.category === 'statement' && document.presentation && document.presentation.print
    && Array.isArray(document.presentation.print.titleLines)
    && document.presentation.print.titleLines.length > 0) {
    const lines = document.presentation.print.titleLines;
    if (lines.join(' ').replace(/\s+/g, ' ') !== String(document.title).replace(/\s+/g, ' ')) {
      errors.push(`${label}.presentation.print.titleLines: must combine to title`);
    }
  }
}

function validateDocumentRelations(document, label, topicRegistry, sourceRegistry, errors) {
  const dates = document.dates || {};
  ['publishedOn', 'modifiedOn', 'reviewedOn', 'eventOn'].forEach((field) => {
    if (dates[field] !== undefined) assertDate(dates[field], `${label}.dates.${field}`, errors);
  });
  if (dates.modifiedOn && dates.publishedOn && dates.modifiedOn < dates.publishedOn) {
    errors.push(`${label}.dates.modifiedOn: must be on or after publishedOn`);
  }
  if (dates.reviewedOn && dates.publishedOn && dates.reviewedOn < dates.publishedOn) {
    errors.push(`${label}.dates.reviewedOn: must be on or after publishedOn`);
  }
  const topicIds = Array.isArray(document.topicIds) ? document.topicIds : [];
  topicIds.forEach((topicId, index) => {
    if (!topicRegistry.has(topicId)) errors.push(`${label}.topicIds[${index}]: unknown topic ${topicId}`);
  });
  const sourceIds = document.evidence && Array.isArray(document.evidence.sourceIds)
    ? document.evidence.sourceIds : [];
  sourceIds.forEach((sourceId, index) => {
    if (!sourceRegistry.has(sourceId)) errors.push(`${label}.evidence.sourceIds[${index}]: unknown source ${sourceId}`);
  });
  if (document.evidence && sourceIds.length > document.evidence.count) {
    errors.push(`${label}.evidence.sourceIds: cannot exceed evidence.count`);
  }
  if (document.evidence && document.evidence.complete && sourceIds.length !== document.evidence.count) {
    errors.push(`${label}.evidence.sourceIds: complete evidence must match evidence.count`);
  }
}

function loadRegistries(projectRoot, errors) {
  const topicsRaw = readJsonFile(path.join(projectRoot, '_source', 'topics.json'), '_source/topics.json', errors);
  const sourcesRaw = readJsonFile(path.join(projectRoot, '_source', 'sources.json'), '_source/sources.json', errors);
  const topics = topicsRaw && addSchemaErrors(topicsRaw, '_source/topics.json', validateTopicsSchema, errors)
    ? topicsRaw.topics : [];
  const sources = sourcesRaw && addSchemaErrors(sourcesRaw, '_source/sources.json', validateSourcesSchema, errors)
    ? sourcesRaw.sources : [];
  const validateRegistryIds = (entries, label, property) => {
    const seen = new Map();
    entries.forEach((entry, index) => {
      if (!entry || typeof entry.id !== 'string') return;
      const key = normalizeKey(entry.id);
      if (seen.has(key)) {
        errors.push(`${label}.${property}[${index}].id: duplicate identifier with ${seen.get(key)}`);
      } else {
        seen.set(key, `${label}.${property}[${index}].id`);
      }
    });
  };
  validateRegistryIds(topics, '_source/topics.json', 'topics');
  validateRegistryIds(sources, '_source/sources.json', 'sources');
  return {
    topics: makeLookup(topics.map((topic) => [topic.id, topic])),
    sources: makeLookup(sources.map((source) => [source.id, source])),
  };
}

function collectMomSources(projectRoot, allowLegacy, errors) {
  const directory = path.join(projectRoot, '_source', 'MoM');
  const sources = [];
  const files = readDirectoryFiles(directory, (filePath, name) => (
    path.extname(name).toLowerCase() === '.md' && name !== 'README.md'
  ));
  files.sort((a, b) => relativePath(projectRoot, a).localeCompare(relativePath(projectRoot, b), 'ko'));
  files.forEach((filePath) => {
    const label = relativePath(projectRoot, filePath);
    try {
      const markdown = readText(filePath);
      const parsed = parseYamlFrontMatter(markdown, label);
      const metadata = parsed.metadata;
      if (metadata.schemaVersion !== undefined && metadata.schemaVersion !== SCHEMA_VERSION) {
        errors.push(`${label}: schemaVersion must be 2`);
      }
      if (metadata.schemaVersion === undefined && allowLegacy) {
        const legacy = parseLegacyFrontMatter(markdown, label);
        sources.push({ filePath, label, metadata: legacy.metadata, body: legacy.body, legacy: true });
      } else {
        sources.push({ filePath, label, metadata, body: parsed.body, legacy: false });
      }
    } catch (error) {
      errors.push(error.message);
    }
  });
  return sources;
}

function validateSourceFragment(filePath, projectRoot, errors) {
  const html = readText(filePath);
  const label = relativePath(projectRoot, filePath);
  const analysis = analyzeStatementFragment(html, label);
  errors.push(...analysis.errors);
}

function validateManualHtmlSource(filePath, projectRoot, errors) {
  const label = relativePath(projectRoot, filePath);
  const html = readText(filePath);
  const allowedScripts = new Set([
    '../assets/archive-filter.js',
    '../assets/document-tools.js',
    '../assets/video-embed.js',
    'assets/archive-filter.js',
    'assets/document-tools.js',
    'assets/video-embed.js',
  ]);
  [...html.matchAll(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].forEach((match) => {
    const src = String(match[2]).replace(/\?v=[^#\s>]+$/i, '');
    if (!allowedScripts.has(src)) errors.push(`${label}: external script is not in the local allowlist (${match[2]})`);
  });
}

function createGraph(options, errors) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const allowLegacy = options.allowLegacy === true;
  const registry = loadRegistries(projectRoot, errors);
  const catalogPath = path.join(projectRoot, '_source', 'catalog.json');
  const catalogRaw = readJsonFile(catalogPath, '_source/catalog.json', errors);
  let catalog = catalogRaw;
  let manualRaw = [];
  let legacyCatalog = false;
  if (isObject(catalogRaw) && catalogRaw.schemaVersion === SCHEMA_VERSION) {
    addSchemaErrors(catalogRaw, '_source/catalog.json', validateCatalogSchema, errors);
    manualRaw = Array.isArray(catalogRaw.documents) ? catalogRaw.documents : [];
  } else if (isObject(catalogRaw) && allowLegacy) {
    legacyCatalog = true;
    manualRaw = Array.isArray(catalogRaw.documents) ? catalogRaw.documents : [];
    if (!Array.isArray(catalogRaw.documents)) errors.push('_source/catalog.json.documents: must be an array');
  } else if (catalogRaw !== undefined) {
    errors.push('_source/catalog.json: schemaVersion must be 2');
  }

  const momSources = collectMomSources(projectRoot, allowLegacy, errors);
  const routeToId = new Map();
  const rawRecords = [];
  manualRaw.forEach((raw, index) => {
    const label = `_source/catalog.json#/documents/${index}`;
    const record = legacyCatalog ? legacyRecord(raw, label, registry.topics, routeToId) : raw;
    if (!legacyCatalog) addSchemaErrors(raw, label, validateDocumentSchema, errors);
    if (!isObject(raw)) return;
    rawRecords.push({ record, label, kind: 'manual' });
    if (typeof record.route === 'string' && typeof record.id === 'string') routeToId.set(normalizeKey(record.route), record.id);
  });
  momSources.forEach((source, index) => {
    const label = `${source.label}#/frontmatter`;
    const record = source.legacy
      ? legacyRecord({ ...source.metadata, category: 'mom', href: source.metadata.href || `MoM/${source.metadata.slug || path.basename(source.filePath, '.md')}.html` }, label, registry.topics, routeToId)
      : { ...source.metadata };
    if (!source.legacy) addSchemaErrors(record, label, validateDocumentSchema, errors);
    if (!isObject(record)) return;
    rawRecords.push({ record, label, kind: 'mom', source });
    if (typeof record.route === 'string' && typeof record.id === 'string') routeToId.set(normalizeKey(record.route), record.id);
  });

  const documents = [];
  const ids = new Map();
  const canonicalIds = new Map();
  const routes = new Map();
  rawRecords.forEach(({ record: raw, label, kind, source }) => {
    if (!isObject(raw)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    const record = JSON.parse(JSON.stringify(raw));
    const route = validateRoute(record.route, record.category, label, errors);
    if (typeof record.id === 'string') record.id = record.id.normalize('NFC');
    if (!/^([a-z][a-z0-9-]*):.+$/u.test(String(record.id || ''))) {
      errors.push(`${label}.id: must be a stable category:basename identifier`);
    } else if (typeof record.category === 'string'
      && String(record.id).slice(0, String(record.id).indexOf(':')) !== record.category) {
      errors.push(`${label}.id: must use the category prefix ${record.category}`);
    }
    if (route) record.route = route;
    checkCategorySpecificFields(record, label, errors);
    validateSocialImage(record.socialImage, projectRoot, label, errors);
    validateDocumentRelations(record, label, registry.topics, registry.sources, errors);
    if (record.id) {
      const key = normalizeKey(record.id);
      if (ids.has(key)) errors.push(`${label}.id: duplicate identifier with ${ids.get(key)}`);
      else {
        ids.set(key, label);
        canonicalIds.set(key, record.id);
      }
    }
    if (route) {
      const key = normalizeKey(route);
      if (routes.has(key)) errors.push(`${label}.route: duplicate route with ${routes.get(key)}`);
      else routes.set(key, label);
    }
    if (kind === 'manual' && record.category === 'mom') errors.push(`${label}.category: catalog documents cannot be mom`);
    if (kind === 'mom' && record.category !== 'mom') errors.push(`${label}.category: MoM frontmatter must use mom`);
    let sourcePath = route ? sourcePathForDocument(projectRoot, record) : undefined;
    if (allowLegacy && kind === 'manual' && (!sourcePath || !fs.existsSync(sourcePath))
      && typeof record.route === 'string') {
      const legacyPath = path.join(projectRoot, ...record.route.split('/'));
      if (fs.existsSync(legacyPath)) sourcePath = legacyPath;
    }
    if (kind === 'manual') {
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        errors.push(`${label}: source file is missing (${sourcePath ? relativePath(projectRoot, sourcePath) : 'unknown'})`);
      } else if (record.category === 'statement') {
        validateSourceFragment(sourcePath, projectRoot, errors);
      } else {
        if (!/^\s*<!doctype html>/i.test(readText(sourcePath))) {
          errors.push(`${relativePath(projectRoot, sourcePath)}: manual source must be a complete HTML document`);
        }
        validateManualHtmlSource(sourcePath, projectRoot, errors);
      }
    }
    documents.push({ record, label, kind, source, sourcePath });
  });

  const documentByRoute = new Map(documents.filter((item) => typeof item.record.route === 'string')
    .map((item) => [normalizeKey(item.record.route), item.record.id]));
  if (allowLegacy) {
    documents.forEach((item) => {
      if (!Array.isArray(item.record.relatedDocumentIds)) return;
      item.record.relatedDocumentIds = item.record.relatedDocumentIds.map((relatedId) => (
        documentByRoute.get(normalizeKey(relatedId)) || relatedId
      ));
    });
  }
  documents.forEach((item) => {
    const record = item.record;
    if (!Array.isArray(record.relatedDocumentIds)) return;
    record.relatedDocumentIds = record.relatedDocumentIds.map((relatedId, index) => {
      const canonicalId = canonicalIds.get(normalizeKey(relatedId));
      if (!canonicalId) {
        errors.push(`${item.label}.relatedDocumentIds[${index}]: unknown document ${relatedId}`);
        return relatedId;
      }
      if (canonicalId === record.id) {
        errors.push(`${item.label}.relatedDocumentIds[${index}]: self reference is not allowed`);
      }
      return canonicalId;
    });
  });

  const expectedManual = new Set(documents.filter((item) => item.kind === 'manual' && item.sourcePath).map((item) => normalizeKey(relativePath(projectRoot, item.sourcePath))));
  ['knowledge', 'notice'].forEach((category) => {
    const directory = path.join(projectRoot, '_source', category);
    readDirectoryFiles(directory, (filePath, name) => path.extname(name).toLowerCase() === '.html')
      .forEach((filePath) => {
        const key = normalizeKey(relativePath(projectRoot, filePath));
        if (!expectedManual.has(key)) errors.push(`${relativePath(projectRoot, filePath)}: orphan manual source`);
      });
  });
  const expectedStatements = new Set(documents.filter((item) => item.record.category === 'statement' && item.sourcePath).map((item) => normalizeKey(relativePath(projectRoot, item.sourcePath))));
  readDirectoryFiles(path.join(projectRoot, '_source', 'statement'), (filePath, name) => name.toLowerCase().endsWith('.body.html'))
    .forEach((filePath) => {
      const key = normalizeKey(relativePath(projectRoot, filePath));
      if (!expectedStatements.has(key)) errors.push(`${relativePath(projectRoot, filePath)}: orphan statement source`);
    });

  const sortedItems = documents.filter((item) => item.record && item.record.route);
  const categoryOrder = new Map(CATEGORY_REGISTRY.map((category) => [category.key, category.order]));
  sortedItems.sort((a, b) => (
    String(b.record.dates && b.record.dates.publishedOn || '').localeCompare(String(a.record.dates && a.record.dates.publishedOn || ''))
    || ((categoryOrder.get(a.record.category) ?? 99) - (categoryOrder.get(b.record.category) ?? 99))
    || ((Number(a.record.displayOrder) || 0) - (Number(b.record.displayOrder) || 0))
    || String(a.record.id).localeCompare(String(b.record.id), 'ko')
  ));
  const normalizedDocuments = sortedItems.map((item) => item.record);
  const documentItemsById = new Map(sortedItems.map((item) => [item.record.id, item]));
  const documentsById = makeLookup(normalizedDocuments.map((record) => [record.id, record]));
  const graph = {
    schemaVersion: SCHEMA_VERSION,
    projectRoot,
    documents: normalizedDocuments,
    listedDocuments: normalizedDocuments.filter((record) => record.workflow && record.workflow.visibility === 'public'),
    documentsById,
    topicsById: registry.topics,
    sourcesById: registry.sources,
    sourcePathsById: makeLookup(sortedItems.map((item) => [item.record.id, item.sourcePath || item.source && item.source.filePath])),
    sourceDataById: makeLookup(sortedItems.map((item) => [item.record.id, item.source || {}])),
    categoryRegistry: CATEGORY_REGISTRY,
    catalog,
    documentItemsById,
  };
  return graph;
}

function validateSourceTree(options = {}) {
  const errors = [];
  let data;
  try {
    data = createGraph(options, errors);
  } catch (error) {
    errors.push(error.message);
  }
  return { success: errors.length === 0, data, errors };
}

function loadContentGraph(options = {}) {
  const result = validateSourceTree(options);
  if (!result.success) throw new ContentGraphValidationError(result.errors, result.data);
  return result.data;
}

module.exports = {
  CATEGORY_BY_ID,
  CATEGORY_REGISTRY,
  ContentGraphValidationError,
  SCHEMA_VERSION,
  loadContentGraph,
  parseYamlFrontMatter,
  validateSourceTree,
  validateRoute,
};
