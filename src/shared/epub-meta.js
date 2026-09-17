'use strict';

const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
};

function firstOf(value) {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && typeof node['#text'] === 'string') return node['#text'];
  return '';
}

function readEntry(entry, limit) {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    const chunks = [];
    let size = 0;
    let failed = false;
    stream.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(Object.assign(new Error('EPUB 元数据超过大小限制'), { code: 'EPUB_METADATA_LIMIT' }));
        stream.destroy();
      } else chunks.push(chunk);
    });
    stream.once('error', reject);
    stream.once('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
  });
}

async function findOpfPath(zip, limit) {
  const entry = zip.file('META-INF/container.xml');
  if (!entry) return null;
  let doc;
  try {
    doc = new XMLParser(PARSER_OPTS).parse((await readEntry(entry, limit)).toString('utf8'));
  } catch (error) {
    if (error.code === 'EPUB_METADATA_LIMIT') throw error;
    return null;
  }
  const rootfile = doc && doc.container && doc.container.rootfiles
    ? firstOf(doc.container.rootfiles.rootfile)
    : null;
  return (rootfile && rootfile['@_full-path']) || null;
}

function coverHrefFromOpf(metadata, manifest) {
  const items = asArray(manifest.item);
  const byProp = items.find((it) =>
    String(it['@_properties'] || '').split(/\s+/).includes('cover-image')
  );
  if (byProp && byProp['@_href']) return byProp['@_href'];

  const coverMeta = asArray(metadata.meta).find(
    (m) => String(m['@_name'] || '').toLowerCase() === 'cover'
  );
  if (coverMeta && coverMeta['@_content']) {
    const item = items.find((it) => it['@_id'] === coverMeta['@_content']);
    if (item && item['@_href']) return item['@_href'];
  }
  return null;
}

function guessMime(href) {
  const ext = String(href).toLowerCase().split('.').pop();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

async function parseEpub(buffer, { maxXmlBytes = 8 * 1024 * 1024, maxCoverBytes = 4 * 1024 * 1024 } = {}) {
  const result = { title: '', author: '', cover: null };
  const zip = await JSZip.loadAsync(buffer);
  const opfRel = (await findOpfPath(zip, maxXmlBytes)) || 'content.opf';
  const opfEntry = zip.file(opfRel);
  if (!opfEntry) return result;

  const opfDir = opfRel.includes('/') ? opfRel.slice(0, opfRel.lastIndexOf('/')) : '';
  const opf = new XMLParser(PARSER_OPTS).parse((await readEntry(opfEntry, maxXmlBytes)).toString('utf8'));
  const pkg = (opf && opf.package) || {};
  const metadata = pkg.metadata || {};
  const manifest = pkg.manifest || {};

  result.title = textOf(firstOf(metadata['dc:title'] ?? metadata.title));
  result.author = textOf(firstOf(metadata['dc:creator'] ?? metadata.creator));

  const href = coverHrefFromOpf(metadata, manifest);
  if (href) {
    const coverPath = opfDir ? `${opfDir}/${href}` : href;
    const coverEntry = zip.file(coverPath);
    if (coverEntry) {
      try {
        result.cover = { mime: guessMime(href), base64: (await readEntry(coverEntry, maxCoverBytes)).toString('base64') };
      } catch (error) {
        // A broken/oversized cover must not prevent importing a readable book.
        result.cover = null;
      }
    }
  }
  return result;
}

module.exports = { parseEpub };
