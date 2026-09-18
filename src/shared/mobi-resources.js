'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const patched = new WeakSet();

/**
 * mobi-parser 0.4.6 reads embed IDs in base 36 and flow IDs in base 10.
 * Kindle uses base 32 for both. Translate at its resolver boundary, including
 * recursive CSS/SVG calls, retaining the parser's cache and resource cleanup.
 * Keep this adapter in sync with the pinned parser version when upgrading.
 * MOBI7 uses decimal recindex and must never go through this adapter.
 */
function fixKf8ResourceIds(book) {
  if (!book || typeof book.replaceResources !== 'function' || patched.has(book)) return book;
  const replaceResources = book.replaceResources;
  book.replaceResources = function (source) {
    const normalized = source.replace(/kindle:(embed|flow):(\w+)(\?mime=[\w/+.-]+)?/gi, (ref, type, id, mime = '') => {
      if (!/^[0-9a-v]+$/i.test(id)) return ref;
      const number = Number.parseInt(id, 32);
      if (!Number.isSafeInteger(number)) return ref;
      type = type.toLowerCase();
      return 'kindle:' + type + ':' + number.toString(type === 'embed' ? 36 : 10) + mime.toLowerCase();
    });
    return replaceResources.call(this, normalized);
  };
  patched.add(book);
  return book;
}

function mimeOf(buf, filePath) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (/^GIF8[79]a/.test(buf.toString('ascii', 0, 6))) return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (/<svg[\s>]/i.test(buf.toString('utf8', 0, 1024))) return 'image/svg+xml';
  const fonts = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  return fonts[path.extname(filePath || '').toLowerCase()] || 'application/octet-stream';
}

function localPath(ref, directory) {
  if (/^(?:https?:|data:|blob:|#|\/\/)/i.test(ref)) return null;
  try {
    if (/^file:/i.test(ref)) return fileURLToPath(ref);
    const absolute = path.isAbsolute(ref) ? ref : path.resolve(directory, ref);
    if (fs.existsSync(absolute)) return absolute;
    const decoded = decodeURIComponent(ref);
    return path.isAbsolute(decoded) ? decoded : path.resolve(directory, decoded);
  } catch {
    return null;
  }
}

function toDataUrl(filePath, visited = new Set()) {
  if (!filePath || visited.has(filePath)) return null;
  try {
    let buf = fs.readFileSync(filePath);
    const mime = mimeOf(buf, filePath);
    if (mime === 'image/svg+xml') {
      const nested = new Set(visited).add(filePath);
      buf = Buffer.from(inlineMedia(buf.toString('utf8'), path.dirname(filePath), nested));
    }
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

function inlineReference(ref, directory, visited) {
  const hash = ref.indexOf('#');
  const file = hash < 0 ? ref : ref.slice(0, hash);
  if (!file) return null;
  const data = toDataUrl(localPath(file, directory), visited);
  return data ? data + (hash < 0 ? '' : ref.slice(hash)) : null;
}

function inlineCss(source, directory, visited) {
  return source.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote, ref) => {
    const data = inlineReference(ref.trim(), directory, visited);
    // Base64 URLs need no quotes; adding double quotes here would break a
    // double-quoted HTML style attribute containing this CSS.
    return data ? 'url(' + data + ')' : match;
  });
}

function inlineMedia(source, directory, visited) {
  // SVG image/use references need inlining too: an SVG loaded from a data URL
  // cannot fetch the parser's temporary local image files itself.
  const html = source.replace(/<(?:img|image|use)\b[^>]*>/gi, tag => tag.replace(/(\s(?:src|href|xlink:href)\s*=\s*)(["'])(.*?)\2/gi, (match, pre, quote, ref) => {
    const data = inlineReference(ref, directory, visited);
    return data ? pre + quote + data + quote : match;
  }));
  return inlineCss(html, directory, visited);
}

/** KF8 returns stylesheets separately from its body-only HTML. */
function inlineChapterResources(chapterHtml, resourceSaveDir, stylesheets = []) {
  const cssText = [];
  const loaded = new Set();
  function addStylesheet(href) {
    const file = localPath(href, resourceSaveDir);
    if (!file) return false;
    if (loaded.has(file)) return true;
    try {
      const css = fs.readFileSync(file, 'utf8');
      cssText.push(inlineCss(css, path.dirname(file)));
      loaded.add(file);
      return true;
    } catch {
      return false;
    }
  }
  for (const stylesheet of stylesheets) {
    if (stylesheet && stylesheet.href) addStylesheet(stylesheet.href);
  }
  const html = (chapterHtml || '').replace(/<link\b[^>]*>/gi, tag => {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    return href && addStylesheet(href[2]) ? '' : tag;
  });
  return { html: inlineMedia(html, resourceSaveDir), cssText: cssText.join('\n') };
}

module.exports = { fixKf8ResourceIds, toDataUrl, inlineChapterResources };
