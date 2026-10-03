'use strict';

const path = require('path');
const yauzl = require('yauzl');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 50000;
const PARSER_OPTS = { ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, processEntities: false };
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function limitError(message) {
  const error = new Error(message);
  error.code = 'EPUB_METADATA_LIMIT';
  return error;
}

function firstOf(value) { return Array.isArray(value) ? value[0] : value; }
function asArray(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return typeof node['#text'] === 'string' ? node['#text'] : '';
}

function openZip(source) {
  return new Promise((resolve, reject) => {
    // 大小校验在有限读取流内完成，单个坏封面的尺寸字段不能使全书索引失败。
    const options = { lazyEntries: true, autoClose: false, validateEntrySizes: false };
    const done = (error, zip) => error ? reject(error) : resolve(zip);
    if (typeof source === 'string') yauzl.open(source, options, done);
    else yauzl.fromBuffer(Buffer.isBuffer(source) ? source : Buffer.from(source), options, done);
  });
}

function collectEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = new Map();
    let count = 0;
    const fail = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      zip.removeListener('entry', next);
      zip.removeListener('end', end);
      zip.removeListener('error', fail);
    };
    const next = (entry) => {
      count += 1;
      if (count > MAX_ZIP_ENTRIES) return fail(limitError('EPUB 文件条目过多'));
      if (entries.has(entry.fileName)) return fail(new Error('EPUB 含重复的 ZIP 路径：' + entry.fileName));
      entries.set(entry.fileName, entry);
      zip.readEntry();
    };
    const end = () => { cleanup(); resolve(entries); };
    zip.on('entry', next);
    zip.once('end', end);
    zip.once('error', fail);
    zip.readEntry();
  });
}

// 同时限制声明大小和实际流量；损坏的 ZIP 大小字段不能绕过读取上限。
function readEntry(zip, entry, maxBytes) {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes) {
    return Promise.reject(limitError('EPUB 条目超过读取上限：' + entry.fileName));
  }
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let length = 0;
      let finished = false;
      const finish = (failure, result) => {
        if (finished) return;
        finished = true;
        if (failure) { stream.destroy(); reject(failure); }
        else resolve(result);
      };
      stream.on('data', (chunk) => {
        if (finished) return;
        length += chunk.length;
        if (length > maxBytes) return finish(limitError('EPUB 条目解压后超过读取上限：' + entry.fileName));
        chunks.push(chunk);
      });
      stream.once('error', (failure) => finish(failure));
      stream.once('end', () => {
        if (finished) return;
        const data = Buffer.concat(chunks, length);
        if (length !== entry.uncompressedSize || crc32(data) !== entry.crc32) return finish(new Error('EPUB 条目校验失败：' + entry.fileName));
        finish(null, data);
      });
    });
  });
}

function parseXml(data) {
  const xml = data.toString('utf8');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('EPUB 元数据不支持自定义 XML 实体');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error('EPUB 元数据 XML 损坏');
  // 仅解析 XML 内建实体；禁用自定义实体可避免小元数据的实体膨胀。
  return new XMLParser({ ...PARSER_OPTS, processEntities: true }).parse(xml);
}

function coverHrefFromOpf(metadata, manifest) {
  const items = asArray(manifest.item);
  const byProp = items.find((item) => String(item['@_properties'] || '').split(/\s+/).includes('cover-image'));
  if (byProp && byProp['@_href']) return byProp['@_href'];
  const coverMeta = asArray(metadata.meta).find((item) => String(item['@_name'] || '').toLowerCase() === 'cover');
  const item = coverMeta && items.find((candidate) => candidate['@_id'] === coverMeta['@_content']);
  return item && item['@_href'] || null;
}

function resolveEntryPath(base, href) {
  let decoded;
  try { decoded = decodeURIComponent(String(href).split('#')[0].split('?')[0]); } catch { return null; }
  if (!decoded || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(decoded) || decoded.includes('\\')) return null;
  const resolved = path.posix.normalize(path.posix.join(base, decoded));
  return resolved.startsWith('../') || resolved === '..' ? null : resolved;
}

function coverMime(buffer, href) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 13 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (/\.svg$/i.test(href) && buffer.length <= MAX_METADATA_BYTES) {
    const xml = buffer.toString('utf8');
    if (!/<!DOCTYPE|<!ENTITY/i.test(xml) && /<svg(?:\s|>)/i.test(xml) && XMLValidator.validate(xml) === true) return 'image/svg+xml';
  }
  return null;
}

async function inspectEpub(source) {
  const zip = await openZip(source);
  // 后续读取流期间 ZIP 自身的异步错误也需消费，由对应流向调用方报告。
  const onZipError = () => {};
  zip.on('error', onZipError);
  try {
    const entries = await collectEntries(zip);
    const result = { title: '', author: '', cover: null };
    let opfPath = 'content.opf';
    const container = entries.get('META-INF/container.xml');
    if (container) {
      const document = parseXml(await readEntry(zip, container, MAX_METADATA_BYTES));
      const root = document && document.container && document.container.rootfiles;
      const rootfile = root && firstOf(root.rootfile);
      opfPath = rootfile && resolveEntryPath('', rootfile['@_full-path']) || opfPath;
    }
    const opfEntry = entries.get(opfPath);
    if (!opfEntry) return { meta: result, entries: [...entries.values()], coverOmitted: false };
    const document = parseXml(await readEntry(zip, opfEntry, MAX_METADATA_BYTES));
    const pkg = document && document.package || {};
    const metadata = pkg.metadata || {};
    result.title = textOf(firstOf(metadata['dc:title'] ?? metadata.title));
    result.author = textOf(firstOf(metadata['dc:creator'] ?? metadata.creator));
    const href = coverHrefFromOpf(metadata, pkg.manifest || {});
    const coverPath = href && resolveEntryPath(path.posix.dirname(opfPath), href);
    const coverEntry = coverPath && entries.get(coverPath);
    let coverOmitted = false;
    if (coverEntry) {
      try {
        const data = await readEntry(zip, coverEntry, MAX_COVER_BYTES);
        const mime = coverMime(data, href);
        if (mime) result.cover = { mime, base64: data.toString('base64') };
        else coverOmitted = true;
      } catch {
        // 封面可缺省，封面错误不升级为全书修复、解压或导入失败。
        coverOmitted = true;
      }
    }
    return { meta: result, entries: [...entries.values()], coverOmitted };
  } finally {
    zip.close();
  }
}

async function parseEpub(source) { return (await inspectEpub(source)).meta; }


// 修复会重新生成全书，只允许在明确的压缩及解压预算内执行。
async function assertRepairBudget(source) {
  const zip = await openZip(source);
  zip.on('error', () => {});
  try {
    const entries = await collectEntries(zip);
    if (entries.size > 10000) throw limitError('EPUB 超过自动修复条目上限');
    let total = 0;
    for (const entry of entries.values()) {
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > 32 * 1024 * 1024) {
        throw limitError('EPUB 单条内容超过自动修复上限');
      }
      total += entry.uncompressedSize;
      if (total > 256 * 1024 * 1024) throw limitError('EPUB 解压大小超过自动修复上限');
    }
  } finally { zip.close(); }
}
module.exports = { parseEpub, inspectEpub, assertRepairBudget, MAX_METADATA_BYTES, MAX_COVER_BYTES };
