'use strict';

/**
 * MOBI / AZW3 (KF8) 解析封装。
 *
 * 依赖 @lingo-reader/mobi-parser（MIT，基于 Foliate 的 johnfactotum 实现）。
 * 该包为 ESM-only，主进程内通过动态 import 加载。
 *
 * 关键点：
 * 1. 文件可能是纯 MOBI7、纯 KF8（AZW3），或 MOBI7+KF8 组合（扩展名 .mobi 但含 KF8 正文）。
 *    - KF8 / 组合文件必须用 initKf8File 才能拿到完整 spine。
 *    - 纯 MOBI7 用 initMobiFile。
 * 2. MOBI7 的落盘资源及 KF8 的原始资源统一内联，让渲染进程拿到自包含 HTML。
 */

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

let parserPromise = null;

function loadParser() {
  if (!parserPromise) {
    parserPromise = import('@lingo-reader/mobi-parser').catch((err) => {
      parserPromise = null;
      throw err;
    });
  }
  return parserPromise;
}

/** 小端/大端无符号整数读取（默认大端，MOBI 内部字段均大端）。 */
function readU32(buf, offset) {
  return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}

/**
 * 从 PDB 容器中读取记录偏移表。
 * 记录表从 78 字节处开始，每条 8 字节（4 字节偏移 + 4 字节属性）。
 */
function readRecordOffsets(buf) {
  if (buf.length < 78) return [];
  const numRecords = (buf[76] << 8) | buf[77];
  const offsets = [];
  for (let i = 0; i < numRecords; i++) {
    const off = readU32(buf, 78 + i * 8);
    offsets.push(off);
  }
  return offsets;
}

/**
 * 检测 MOBI 文件类型。
 * @returns {'kf8'|'mobi7'|'unknown'}
 * - 'kf8'：KF8 / AZW3，或含 KF8 正文的组合文件（必须用 initKf8File）
 * - 'mobi7'：纯 MOBI7（用 initMobiFile）
 */
function detectKind(buf) {
  if (!buf || buf.length < 120) return 'unknown';
  // PalmDB type/creator：偏移 60 处为 "BOOKMOBI"（type="BOOK", creator="MOBI"）
  const dbType = buf.toString('latin1', 60, 68);
  if (dbType !== 'BOOKMOBI') return 'unknown';
  try {
    const offsets = readRecordOffsets(buf);
    if (!offsets.length) return 'unknown';
    const rec0 = buf.slice(offsets[0], offsets[1] || offsets[0] + 512);
    if (rec0.length < 64) return 'unknown';
    // record0 = 16 字节 PalmDoc header + MOBI header（magic "MOBI" 在偏移 16）
    const magic = rec0.toString('latin1', 16, 20);
    if (magic !== 'MOBI') return 'unknown';
    const version = readU32(rec0, 16 + 20); // mobiHeader.version 相对 record0 偏移 36
    if (version >= 8) return 'kf8';
    // MOBI7 头：检查 EXTH 中是否有 KF8 boundary（id=121）
    const exthFlag = readU32(rec0, 128);
    const length = readU32(rec0, 16 + 4); // MOBI header length
    if ((exthFlag & 0x40) && rec0.length >= 16 + length + 12) {
      const exthStart = 16 + length;
      const exthLen = readU32(rec0, exthStart + 4);
      const exthEnd = Math.min(rec0.length, exthStart + exthLen);
      let pos = exthStart + 12;
      while (pos + 8 <= exthEnd) {
        const id = readU32(rec0, pos);
        const size = readU32(rec0, pos + 4);
        if (size < 8 || pos + size > exthEnd) break;
        if (id === 121) return 'kf8';
        pos += size;
      }
    }
    return 'mobi7';
  } catch {
    return 'unknown';
  }
}

function mimeOf(buf, fallback) {
  if (!buf || !buf.length) return fallback || 'application/octet-stream';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (/^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  const start = buf.toString('utf8', 0, 8192).replace(/^\uFEFF/, '')
    .replace(/<\?xml\b[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b(?:[^>\[]|\[[\s\S]*?\])*?>/gi, '').trimStart();
  if (/^<svg(?:\s|\/?>)/i.test(start)) return 'image/svg+xml';
  return fallback || 'application/octet-stream';
}

function decodeResourceRef(value) {
  return String(value || '').replace(/&(?:amp|quot|apos|#(\d+)|#x([\da-f]+));/gi, (match, decimal, hex) => {
    if (decimal || hex) {
      const code = Number.parseInt(decimal || hex, decimal ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'" }[match.toLowerCase()] || match;
  });
}

/** 原始本地路径优先，URL 才解码；保留 SVG 的片段定位，避免误把远程 URL 当路径。 */
function localResource(ref, baseDir) {
  const value = decodeResourceRef(ref).trim();
  if (!value || value[0] === '#' || /^\/\//.test(value)) return null;
  try {
    if (/^file:/i.test(value)) {
      const url = new URL(value);
      return { filePath: fileURLToPath(url), fragment: url.hash };
    }
    if (/^[a-z][\w+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
    const absolute = (name) => path.isAbsolute(name) ? name : path.resolve(baseDir || '.', name);
    if (fs.existsSync(absolute(value))) return { filePath: absolute(value), fragment: '' };
    const [pathname] = value.split(/[?#]/, 1);
    const hash = value.indexOf('#');
    const fragment = hash >= 0 ? value.slice(hash) : '';
    return { filePath: absolute(decodeURIComponent(pathname)), fragment };
  } catch {
    return null;
  }
}

function resourceContext() {
  return { cache: new Map(), pending: new Set() };
}

function cssTokenEnd(source, start) {
  if (source.startsWith('/*', start)) {
    const end = source.indexOf('*/', start + 2);
    return end < 0 ? source.length : end + 2;
  }
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return start;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === quote) return index + 1;
  }
  return source.length;
}

function skipCssSpace(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) index += 1;
    else if (source.startsWith('/*', index)) index = cssTokenEnd(source, index);
    else break;
  }
  return index;
}

/** 仅扫描 import 的函数括号，跳过字符串/注释中的括号和分号。 */
function cssFunctionEnd(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const tokenEnd = cssTokenEnd(source, index);
    if (tokenEnd > index) { index = tokenEnd - 1; continue; }
    if (source[index] === '\\') { index += 1; continue; }
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')' && --depth === 0) return index + 1;
  }
  return -1;
}

function decodeCssRef(value) {
  return value.replace(/\\(?:([\da-f]{1,6})\s?|\r\n|[\r\n\f]|([\s\S]))/gi, (match, hex, char) => {
    const code = hex && Number.parseInt(hex, 16);
    return hex ? (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD') : char || '';
  });
}

/** 将 import 就地展开，防止拼接独立样式表或套 media 后让浏览器忽略导入。 */
function inlineCssResources(source, baseDir, context) {
  let output = '';
  let copied = 0;
  for (let index = 0; index < source.length; index += 1) {
    const tokenEnd = cssTokenEnd(source, index);
    if (tokenEnd > index) { index = tokenEnd - 1; continue; }
    if (!/^@import\b/i.test(source.slice(index, index + 8))) continue;
    let position = skipCssSpace(source, index + 7);
    let ref;
    if (source[position] === '"' || source[position] === "'") {
      const end = cssTokenEnd(source, position);
      ref = source.slice(position + 1, end - 1);
      position = end;
    } else {
      const url = source.slice(position).match(/^url\s*\(/i);
      if (!url) continue;
      const open = position + url[0].length - 1;
      const end = cssFunctionEnd(source, open);
      if (end < 0) continue;
      ref = source.slice(open + 1, end - 1).trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
      position = end;
    }
    const wrappers = [];
    position = skipCssSpace(source, position);
    const layer = source.slice(position).match(/^layer\b/i);
    if (layer) {
      position = skipCssSpace(source, position + layer[0].length);
      if (source[position] === '(') {
        const end = cssFunctionEnd(source, position);
        if (end < 0) continue;
        wrappers.push('@layer ' + source.slice(position + 1, end - 1).trim());
        position = skipCssSpace(source, end);
      } else wrappers.push('@layer');
    }
    const supports = source.slice(position).match(/^supports\s*\(/i);
    if (supports) {
      const open = position + supports[0].length - 1;
      const end = cssFunctionEnd(source, open);
      if (end < 0) continue;
      wrappers.push('@supports (' + source.slice(open + 1, end - 1).trim() + ')');
      position = skipCssSpace(source, end);
    }
    let end = position;
    for (; end < source.length; end += 1) {
      const tokenEnd = cssTokenEnd(source, end);
      if (tokenEnd > end) { end = tokenEnd - 1; continue; }
      if (source[end] === '(') {
        const close = cssFunctionEnd(source, end);
        if (close < 0) break;
        end = close - 1;
      } else if (';{}'.includes(source[end])) break;
    }
    if (source[end] !== ';') continue;
    const media = source.slice(position, end).trim();
    if (media) wrappers.push('@media ' + media);
    let css = readCssResource(decodeCssRef(ref), baseDir, context);
    if (css == null) { index = end; continue; }
    for (const wrapper of wrappers.reverse()) css = wrapper + ' {\n' + css + '\n}';
    output += source.slice(copied, index) + css;
    copied = end + 1;
    index = end;
  }
  return inlineResourceReferences(output + source.slice(copied), baseDir, context);
}

function readCssResource(ref, baseDir, context) {
  try {
    // 无 ?mime 的 KF8 flow 可能标为 octet-stream；stylesheet 的引用上下文已明确它是 CSS。
    if (/^data:/i.test(ref)) {
      const comma = ref.indexOf(',');
      if (comma < 0) return null;
      const text = /;base64/i.test(ref.slice(0, comma))
        ? Buffer.from(ref.slice(comma + 1), 'base64').toString('utf8') : decodeURIComponent(ref.slice(comma + 1));
      return inlineCssResources(text, baseDir, context);
    }
    const local = localResource(ref, baseDir);
    if (!local) return null;
    if (context.pending.has(local.filePath)) return '';
    context.pending.add(local.filePath);
    try {
      return inlineCssResources(fs.readFileSync(local.filePath, 'utf8'), path.dirname(local.filePath), context);
    } finally {
      context.pending.delete(local.filePath);
    }
  } catch {
    return null;
  }
}

/** 按实际内容识别图片；SVG 中的外部图片也必须内联才能作为 data URL 显示。 */
function toDataUrl(ref, baseDir, context = resourceContext(), imageOnly = true) {
  const local = localResource(ref, baseDir);
  if (!local) return null;
  const key = local.filePath + (imageOnly ? ':image' : ':resource');
  if (context.cache.has(key)) return context.cache.get(key) + local.fragment;
  if (context.pending.has(local.filePath)) return null;
  context.pending.add(local.filePath);
  try {
    let buf = fs.readFileSync(local.filePath);
    const mime = mimeOf(buf, !imageOnly && /\.css$/i.test(local.filePath) ? 'text/css' : undefined);
    if (imageOnly && !mime.startsWith('image/')) return null;
    if (mime === 'image/svg+xml') buf = Buffer.from(inlineResourceReferences(buf.toString('utf8'), path.dirname(local.filePath), context));
    else if (mime === 'text/css') buf = Buffer.from(inlineCssResources(buf.toString('utf8'), path.dirname(local.filePath), context));
    const dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
    context.cache.set(key, dataUrl);
    return dataUrl + local.fragment;
  } catch {
    return null;
  } finally {
    context.pending.delete(local.filePath);
  }
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : '';
}

function inlineResourceReferences(source, baseDir, context) {
  let text = source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (match, open, css, close) => open + inlineCssResources(css, baseDir, context) + close);
  text = text.replace(/<(?:img|image|use)\b[^>]*>/gi, (tag) => tag.replace(
    /(\s(?:src|href|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, prefix, double, single, unquoted) => {
      const dataUrl = toDataUrl(double ?? single ?? unquoted, baseDir, context);
      return dataUrl ? prefix + '"' + dataUrl + '"' : match;
    }
  ));
  text = text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi, (match, double, single, unquoted) => {
    const ref = decodeResourceRef(double ?? single ?? unquoted).replace(/^(["'])([\s\S]*)\1$/, '$2');
    const dataUrl = toDataUrl(ref, baseDir, context, false);
    // base64 URL 无需引号，避免破坏外层 style="..." 属性。
    return dataUrl ? 'url(' + dataUrl + ')' : match;
  });
  return text;
}

/**
 * 把章节 HTML 中引用本地资源（图片/CSS）的绝对路径替换为内联内容。
 * 返回 { html, cssText }：html 为自包含片段，cssText 为可注入的样式。
 */
function inlineChapterResources(chapterHtml, resourceSaveDir, stylesheets = []) {
  let html = chapterHtml || '';
  const cssText = [];
  const context = resourceContext();
  for (const sheet of stylesheets || []) {
    const css = readCssResource(typeof sheet === 'string' ? sheet : sheet && sheet.href, resourceSaveDir, context);
    if (css != null) cssText.push(css);
  }
  html = html.replace(/<link\b[^>]*>/gi, (match) => {
    if (!/(?:^|\s)stylesheet(?:\s|$)/i.test(attributeValue(match, 'rel'))) return match;
    const css = readCssResource(attributeValue(match, 'href'), resourceSaveDir, context);
    if (css == null) return match;
    const media = attributeValue(match, 'media');
    cssText.push(media ? '@media ' + media + ' {\n' + css + '\n}' : css);
    return '';
  });
  return { html: inlineResourceReferences(html, resourceSaveDir, context), cssText: cssText.join('\n') };
}

const kf8ResourceResolvers = new WeakSet();

/**
 * 上游 0.4.6 的 embed 用了 36 进制、flow 用了十进制；二者实际都为 32 进制。
 * 只替换 KF8 实例的资源钩子，保留章节/定位解析，也不影响 MOBI7 的十进制 recindex。
 */
function installKf8ResourceResolver(book, resourceSaveDir) {
  if (!book || typeof book.loadFlow !== 'function' || kf8ResourceResolvers.has(book)) return;
  const context = resourceContext();
  const cache = new Map();
  const pending = new Set();
  book.replaceResources = (source, flowType) => String(source || '').replace(
    /kindle:(flow|embed):(\w+)(?:\?mime=([\w.+-]+\/[\w.+-]+))?/gi,
    (match, resourceType, id, declaredType) => {
      if (!/^[0-9a-v]+$/i.test(id)) return match;
      const index = Number.parseInt(id, 32);
      const type = resourceType.toLowerCase();
      if (!Number.isSafeInteger(index) || (type === 'embed' && index < 1)) return match;
      const fallbackType = type === 'flow' ? flowType : '';
      const key = type + ':' + index + ':' + (declaredType || fallbackType || '').toLowerCase();
      if (cache.has(key)) return cache.get(key);
      if (pending.has(key)) return type === 'flow' && String(declaredType || fallbackType).toLowerCase() === 'text/css' ? 'data:text/css;base64,' : match;
      pending.add(key);
      try {
        const resource = type === 'flow' ? { raw: book.loadFlow(index) } : book.mobiFile.loadResource(index - 1);
        if (!resource || !resource.raw) return match;
        let data = Buffer.from(resource.raw);
        if (!data.length) return match;
        // 不信任 URI 中的图片 MIME：INDX 等书内索引不能被包装成图片。
        const detectedType = mimeOf(data);
        const hint = (declaredType || resource.type || fallbackType || '').toLowerCase();
        if (hint.startsWith('image/') && !detectedType.startsWith('image/')) return match;
        const mime = detectedType.startsWith('image/') ? detectedType : hint || 'application/octet-stream';
        if (mime === 'text/css' || mime === 'image/svg+xml') {
          const text = book.mobiFile.decode(data);
          const replaced = book.replaceResources(text, mime === 'text/css' ? 'text/css' : undefined);
          data = Buffer.from((mime === 'text/css' ? inlineCssResources : inlineResourceReferences)(replaced, resourceSaveDir, context));
        }
        const url = 'data:' + mime + ';base64,' + data.toString('base64');
        cache.set(key, url);
        return url;
      } catch {
        // 单张资源损坏时保留引用，不能中断整章文字与其它插图。
        return match;
      } finally {
        pending.delete(key);
      }
    }
  );
  // 上游只提取双引号 link，且会丢掉 head 内的 style；保留原来的样式顺序。
  book.replace = (source) => {
    const head = source.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
    const css = [];
    for (const match of (head ? head[1] : '').matchAll(/<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)) {
      const tag = match[0];
      const media = attributeValue(tag.slice(0, tag.indexOf('>') + 1), 'media');
      if (/^<style\b/i.test(tag)) {
        let text = book.replaceResources(tag.slice(tag.indexOf('>') + 1).replace(/<\/style\s*>$/i, ''), 'text/css');
        text = inlineCssResources(text, resourceSaveDir, context);
        if (media) text = '@media ' + media + ' {\n' + text + '\n}';
        css.push({ href: 'data:text/css;base64,' + Buffer.from(text).toString('base64') });
      } else if (/(?:^|\s)stylesheet(?:\s|$)/i.test(attributeValue(tag, 'rel'))) {
        const href = book.replaceResources(attributeValue(tag, 'href'), 'text/css');
        if (!media) css.push({ href });
        else {
          const text = readCssResource(href, resourceSaveDir, context);
          if (text != null) css.push({ href: 'data:text/css;base64,' + Buffer.from('@media ' + media + ' {\n' + text + '\n}').toString('base64') });
        }
      }
    }
    const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
    return { html: book.replaceResources(body ? body[1] : source), css };
  };
  kf8ResourceResolvers.add(book);
}

/**
 * 打开并解析 MOBI/AZW3 文件。
 * @param {string} filePath
 * @param {string} resourceSaveDir 图片/CSS 等资源的落盘目录
 */
/**
 * 判断文本是否以闭合的 pagebreak 标签开头（如 "</mbp:pagebreak>"）。
 * 这类书籍的章节结构是 "<mbp:pagebreak/> 标题页 </mbp:pagebreak> 正文"，
 * 正文章节的开头会残留闭合标签，这是"标题页被切分成独立章节"的结构信号。
 */
function startsWithClosingPagebreak(text) {
  return /^\s*<\s*\/\s*(?:mbp:)?pagebreak/i.test(text || '');
}

/** 估算章节的阅读内容量，用于在未预加载全部章节时稳定计算全书进度。 */
function chapterContentWeight(value) {
  const chapter = value && typeof value === 'object' ? value : null;
  // parser 的 length 是本章长度；totalLength 在 KF8 中通常是截至本章的累计值，不能优先使用。
  const structuralLength = chapter ? Number(chapter.length) || Number(chapter.totalLength) || 0 : 0;
  if (structuralLength > 0) return Math.max(1, structuralLength);
  const source = String(chapter ? chapter.text || '' : value || '');
  const imageCount = (source.match(/<img\b/gi) || []).length;
  const text = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, '字')
    .replace(/\s+/g, ' ')
    .trim();
  return Math.max(1, text.length + imageCount * 400);
}

/** 解析 Kindle position URI。FID/OFF 均为 32 进制，不是十六进制。 */
function parseKindlePosition(href) {
  const match = String(href || '').match(/kindle:pos:fid:(\w+):off:(\w+)/i);
  if (!match) return null;
  const fid = Number.parseInt(match[1], 32);
  const off = Number.parseInt(match[2], 32);
  return Number.isFinite(fid) && Number.isFinite(off) ? { fid, off } : null;
}

function selectorFromAttribute(name, value) {
  const safeName = /^(?:id|name|aid)$/i.test(String(name || '')) ? String(name).toLowerCase() : '';
  if (!safeName) return '';
  const safeValue = String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return safeValue ? '[' + safeName + '="' + safeValue + '"]' : '';
}

/**
 * KF8 的 position 有时落在脚注正文文本中，而不是带 aid/id 的标签起点。
 * 上游解析器此时能找到章节但会返回空 selector；从原始 fragment 中取距离
 * position 最近的前置定位属性，才能把脚注带入当前可视页。
 */
function nearestKf8Selector(book, fid, off) {
  if (!book || !Array.isArray(book.chapters) || typeof book.loadRaw !== 'function' || !book.mobiFile) return '';
  const chapter = book.chapters.find((item) => Array.isArray(item.frags) && item.frags.some((frag) => frag.index === fid));
  if (!chapter || !chapter.skel) return '';
  const frag = chapter.frags.find((item) => item.index === fid);
  if (!frag) return '';
  try {
    const start = chapter.skel.offset + chapter.skel.length + frag.offset;
    const raw = book.loadRaw(start, start + frag.length);
    const source = book.mobiFile.decode(raw.buffer);
    const target = Math.max(0, Math.min(source.length, Number(off) || 0));
    const attrPattern = /<[^>]*\s(id|name|aid)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match;
    let before = null;
    let after = null;
    while ((match = attrPattern.exec(source))) {
      const candidate = { index: match.index, selector: selectorFromAttribute(match[1], match[2]) };
      if (!candidate.selector) continue;
      if (match.index <= target) before = candidate;
      else {
        after = candidate;
        break;
      }
    }
    if (before && target - before.index <= 1024) return before.selector;
    if (after && after.index - target <= 256) return after.selector;
  } catch (error) {}
  return '';
}

function charIndexAtUtf8ByteOffset(source, byteOffset) {
  const text = String(source || '');
  const wanted = Math.max(0, Number(byteOffset) || 0);
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= wanted) low = middle;
    else high = middle - 1;
  }
  return low;
}

function mobi7TextHint(book, rawIndex, filepos) {
  const chapter = book && Array.isArray(book.chapters) ? book.chapters[rawIndex] : null;
  if (!chapter || typeof chapter.text !== 'string') return '';
  const relative = Number(filepos) - Number(chapter.start || 0);
  let offset = charIndexAtUtf8ByteOffset(chapter.text, relative);
  const tagStart = chapter.text.lastIndexOf('<', offset);
  const tagEndBefore = chapter.text.lastIndexOf('>', offset);
  if (tagStart > tagEndBefore) {
    const tagEnd = chapter.text.indexOf('>', offset);
    if (tagEnd >= 0) offset = tagEnd + 1;
  }
  return chapter.text.slice(offset, offset + 800)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/**
 * 规划 MOBI7 章节合并。
 * MOBI7 的章节按 <mbp:pagebreak/> 切分，部分书籍（尤其中文 MOBI 转档）会把
 * "章节标题页"和"正文"切成两个独立章节，阅读时只见标题。
 * 规则：若下一章以闭合的 </mbp:pagebreak> 开头，说明本章是标题页，并入下一章正文。
 * 这是通用的结构修复，不依赖章节长度或具体书籍。
 * @param {Array} rawChapters 解析器原始章节数组
 * @param {string} kind 'mobi7' | 'kf8'
 * @returns {number[]} mergeTarget：i 合并到 mergeTarget[i]，-1 表示独立成章
 */
function planChapterMerge(rawChapters, kind) {
  const n = rawChapters.length;
  const mergeTarget = new Array(n).fill(-1);
  if (kind !== 'mobi7') return mergeTarget;
  for (let i = 0; i < n - 1; i++) {
    const next = rawChapters[i + 1];
    const nextText = next && typeof next.text === 'string' ? next.text : '';
    if (startsWithClosingPagebreak(nextText)) mergeTarget[i] = i + 1;
  }
  // 连续标题页/短节链式并入最终正文章节
  for (let i = n - 2; i >= 0; i--) {
    const t = mergeTarget[i];
    if (t !== -1 && mergeTarget[t] !== -1) mergeTarget[i] = mergeTarget[t];
  }
  return mergeTarget;
}

async function openMobi(filePath, resourceSaveDir) {
  const buf = fs.readFileSync(filePath);
  let kind = detectKind(buf);
  const parser = await loadParser();

  let book;
  if (kind === 'kf8') {
    book = await parser.initKf8File(filePath, resourceSaveDir);
  } else {
    // mobi7 或 unknown：先尝试 MOBI，若解析器内部识别为 KF8 兼容文件则回退 KF8
    try {
      book = await parser.initMobiFile(filePath, resourceSaveDir);
    } catch (errMobi) {
      try {
        book = await parser.initKf8File(filePath, resourceSaveDir);
        kind = 'kf8';
      } catch (errKf8) {
        throw new Error('无法解析 MOBI 文件：' + errMobi.message + ' / ' + errKf8.message);
      }
    }
  }

  installKf8ResourceResolver(book, resourceSaveDir);
  const meta = book.getMetadata();
  const spine = book.getSpine();
  const toc = book.getToc();
  let cover = null;
  try {
    const coverRef = book.getCoverImage();
    if (coverRef && /^(https?:|data:|blob:)/i.test(coverRef)) {
      cover = coverRef;
    } else if (coverRef) {
      cover = toDataUrl(coverRef, resourceSaveDir);
    }
  } catch {
    // 无封面不阻塞
  }

    // 把 TOC 条目映射到章节序号（快速路径：直接匹配 frag index）
  const fidToIndex = new Map();
  const rawChapters = book.chapters || [];
  const rawIndexById = new Map(rawChapters.map((chapter, index) => [String(chapter.id), index]));

  // MOBI7 部分书籍把章节标题页切分成独立短章，合并到下一章正文，避免阅读时只见标题
  const mergeTarget = planChapterMerge(rawChapters, kind);
  const mergedKept = [];
  const newIndexOf = new Array(rawChapters.length).fill(-1);
  const mergePred = new Array(rawChapters.length).fill(null);
  for (let i = 0; i < rawChapters.length; i++) {
    if (mergeTarget[i] === -1) {
      newIndexOf[i] = mergedKept.length;
      mergedKept.push(i);
    } else {
      const t = mergeTarget[i];
      if (!mergePred[t]) mergePred[t] = [];
      mergePred[t].push(i);
    }
  }
  const chapters = mergedKept.map((rawIdx, index) => {
    const sourceIndexes = (mergePred[rawIdx] || []).concat([rawIdx]);
    const weight = sourceIndexes.reduce((sum, sourceIndex) => {
      const source = rawChapters[sourceIndex];
      return sum + chapterContentWeight(source);
    }, 0);
    return { id: String(rawIdx), index, raw: rawIdx, weight: Math.max(1, weight) };
  });
  for (let i = 0; i < rawChapters.length; i++) {
    const frags = rawChapters[i].frags || [];
    for (const frag of frags) {
      if (!fidToIndex.has(frag.index)) fidToIndex.set(frag.index, i);
    }
  }
  function tocTargetFromHref(href) {
    return resolveMobiHref({ book, rawIndexById, fidToIndex, mergeTarget, newIndexOf }, href);
  }
  const mapToc = (items) => (items || []).map((item) => {
    const target = tocTargetFromHref(item.href);
    return {
      label: item.label || '',
      href: item.href || '',
      index: target.index,
      selector: target.selector,
      children: mapToc(item.children),
    };
  });
  const tocWithIndex = mapToc(toc);

  return {
    kind,
    title: meta.title || '',
    author: Array.isArray(meta.author) ? meta.author.join('、') : (meta.author || ''),
    publisher: meta.publisher || '',
    language: meta.language || '',
    description: meta.description || '',
    cover,
    chapters,
    toc: tocWithIndex,
    mergedKept,
    mergePred,
    mergeTarget,
    newIndexOf,
    rawIndexById,
    fidToIndex,
    book,
    spine,
  };
}

/** 把书内 filepos:/kindle:pos: 链接解析为合并后的章节序号和章节内选择器。 */
function resolveMobiHref(opened, href) {
  const book = opened && opened.book;
  if (!book || !href) return { index: null, selector: '' };
  const position = parseKindlePosition(href);
  const fileposMatch = String(href).match(/^filepos:(\d+)/i);
  let raw = position && opened.fidToIndex instanceof Map ? opened.fidToIndex.get(position.fid) : null;
  let resolved = null;
  if (typeof book.resolveHref === 'function') {
    try { resolved = book.resolveHref(String(href)); } catch (error) {}
  }
  if (raw == null && resolved && resolved.id != null && opened.rawIndexById instanceof Map) {
    raw = opened.rawIndexById.get(String(resolved.id));
  }
  if (raw == null && fileposMatch && Array.isArray(book.chapters) && book.mobiFile) {
    // MOBI7's final chapter has no next pagebreak, so upstream leaves end
    // undefined and cannot resolve links into it. PalmDOC stores the exact
    // uncompressed text length; use it as the final bound, not Infinity.
    try {
      const header = Buffer.from(book.mobiFile.loadRecord(0));
      const textLength = header.readUInt32BE(4);
      const offset = Number(fileposMatch[1]);
      if (Number.isSafeInteger(offset) && offset < textLength) {
        const index = book.chapters.findIndex((chapter) => offset >= chapter.start &&
          offset < (Number.isFinite(chapter.end) ? chapter.end : textLength));
        if (index >= 0) raw = index;
      }
    } catch {
      // Malformed headers still leave the link unresolved.
    }
  }
  if (raw == null) return { index: null, selector: '' };
  const target = Array.isArray(opened.mergeTarget) && opened.mergeTarget[raw] >= 0 ? opened.mergeTarget[raw] : raw;
  const mapped = Array.isArray(opened.newIndexOf) ? opened.newIndexOf[target] : target;
  let selector = position && resolved && typeof resolved.selector === 'string' ? resolved.selector : '';
  if (!selector && position) selector = nearestKf8Selector(book, position.fid, position.off);
  const textHint = fileposMatch ? mobi7TextHint(book, raw, Number(fileposMatch[1])) : '';
  return { index: Number.isInteger(mapped) && mapped >= 0 ? mapped : null, selector, textHint };
}

/**
 * 加载指定章节并内联资源。
 * @param {object} opened 由 openMobi 返回的对象（含 book/spine 引用）
 * @param {string|number} chapterId 章节 id（字符串）或序号
 * @param {string} resourceSaveDir
 */
async function loadChapter(opened, chapterIndex, resourceSaveDir) {
  const { book, spine, mergedKept, mergePred } = opened;
  installKf8ResourceResolver(book, resourceSaveDir);
  const rawIdx = mergedKept[chapterIndex];
  if (rawIdx == null) throw new Error('章节不存在: ' + chapterIndex);
  const parts = [];
  const preds = mergePred[rawIdx] || [];
  for (const ri of preds.concat([rawIdx])) {
    const chapter = spine[ri];
    if (!chapter) continue;
    const processed = book.loadChapter(chapter.id);
    if (processed) parts.push(processed);
  }
  if (!parts.length) throw new Error('章节加载失败: ' + chapterIndex);
  const inlinedList = parts.map((p) => inlineChapterResources(p.html, resourceSaveDir, p.css));
  return {
    index: chapterIndex,
    html: inlinedList.map((x) => x.html).join(''),
    cssText: inlinedList.map((x) => x.cssText).join('\n'),
  };
}

/** 释放资源（删除落盘资源目录）。 */
function cleanupMobi(opened) {
  if (opened && opened.book && typeof opened.book.destroy === 'function') {
    try {
      opened.book.destroy();
    } catch {
      // 忽略
    }
  }
}


const MAX_MOBI_METADATA_BYTES = 1024 * 1024;
const MAX_MOBI_COVER_BYTES = 8 * 1024 * 1024;

function decodeMobiText(buffer, encoding) {
  const text = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8').decode(buffer);
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || match;
    const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  }).replace(/\0/g, '').trim();
}

function metadataFromMobiRecord(record) {
  if (record.length < 92 || record.toString('ascii', 16, 20) !== 'MOBI') throw new Error('MOBI 元数据头无效');
  const headerLength = record.readUInt32BE(20);
  if (headerLength < 76 || 16 + headerLength > record.length) throw new Error('MOBI 元数据头长度无效');
  const encoding = record.readUInt32BE(28);
  const titleOffset = record.readUInt32BE(84);
  const titleLength = record.readUInt32BE(88);
  const title = titleOffset + titleLength <= record.length
    ? decodeMobiText(record.subarray(titleOffset, titleOffset + titleLength), encoding) : '';
  const result = {
    title,
    author: '',
    version: record.readUInt32BE(36),
    resourceStart: headerLength >= 96 ? record.readUInt32BE(108) : 0xffffffff,
    boundary: 0xffffffff,
    coverOffset: 0xffffffff,
    thumbnailOffset: 0xffffffff,
  };
  if (headerLength < 116 || !(record.readUInt32BE(128) & 0x40)) return result;
  const start = 16 + headerLength;
  if (start + 12 > record.length || record.toString('ascii', start, start + 4) !== 'EXTH') throw new Error('MOBI EXTH 头无效');
  const length = record.readUInt32BE(start + 4);
  const count = record.readUInt32BE(start + 8);
  const end = start + length;
  if (length < 12 || end > record.length || count > Math.floor((length - 12) / 8)) throw new Error('MOBI EXTH 长度无效');
  const authors = [];
  let offset = start + 12;
  for (let index = 0; index < count; index += 1) {
    if (offset + 8 > end) throw new Error('MOBI EXTH 条目缺失');
    const id = record.readUInt32BE(offset);
    const size = record.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > end) throw new Error('MOBI EXTH 条目长度无效');
    const data = record.subarray(offset + 8, offset + size);
    if (id === 100) authors.push(decodeMobiText(data, encoding));
    else if (id === 503) result.title = decodeMobiText(data, encoding) || result.title;
    else if (data.length >= 4) {
      if (id === 121) result.boundary = data.readUInt32BE(0);
      else if (id === 201) result.coverOffset = data.readUInt32BE(0);
      else if (id === 202) result.thumbnailOffset = data.readUInt32BE(0);
    }
    offset += size;
  }
  result.author = authors.filter(Boolean).join('、');
  return result;
}

/** 只读取书架信息：PDB 记录表、最多两个 MOBI 头和单张封面，不初始化正文解析器。 */
async function readMobiMetadata(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const readRange = async (offset, length, limit) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > limit || offset + length > stat.size) {
        throw new Error('MOBI 元数据记录越界或超过读取上限');
      }
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
        if (!bytesRead) throw new Error('MOBI 元数据记录不完整');
        read += bytesRead;
      }
      return buffer;
    };
    const pdb = await readRange(0, 78, 78);
    if (pdb.toString('ascii', 60, 68) !== 'BOOKMOBI') throw new Error('不是 MOBI 文件');
    const count = pdb.readUInt16BE(76);
    if (!count) throw new Error('MOBI 缺少记录');
    const table = await readRange(78, count * 8, 65535 * 8);
    const offsets = [];
    let previous = 78 + count * 8;
    for (let index = 0; index < count; index += 1) {
      const offset = table.readUInt32BE(index * 8);
      if (offset < previous || offset > stat.size) throw new Error('MOBI 记录表无效');
      offsets.push(offset);
      previous = offset;
    }
    const readRecord = async (index, limit) => {
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('MOBI 记录编号无效');
      return readRange(offsets[index], (offsets[index + 1] ?? stat.size) - offsets[index], limit);
    };
    const original = metadataFromMobiRecord(await readRecord(0, MAX_MOBI_METADATA_BYTES));
    let metadata = original;
    if (original.version < 8 && original.boundary > 0 && original.boundary < count) {
      try {
        const secondary = metadataFromMobiRecord(await readRecord(original.boundary, MAX_MOBI_METADATA_BYTES));
        if (secondary.version >= 8) metadata = secondary;
      } catch {
        // 组合书的 KF8 头损坏时仍能使用 MOBI7 头的书架信息。
      }
    }
    const result = { title: metadata.title || original.title, author: metadata.author || original.author, cover: null };
    // 组合文件的图片共用首个头声明的资源表，KF8 头的 resourceStart 可能为 FFFFFFFF。
    const resourceStart = original.resourceStart < count ? original.resourceStart : metadata.resourceStart;
    const coverOffsets = [metadata.coverOffset, metadata.thumbnailOffset, original.coverOffset, original.thumbnailOffset];
    for (const offset of new Set(coverOffsets)) {
      if (offset === 0xffffffff || resourceStart + offset >= count) continue;
      try {
        const data = await readRecord(resourceStart + offset, MAX_MOBI_COVER_BYTES);
        const mime = mimeOf(data);
        const valid = (mime === 'image/jpeg' && data.length >= 4 && data[2] === 0xff)
          || (mime === 'image/png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          || (mime === 'image/gif' && data.length >= 13 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6)))
          || (mime === 'image/webp' && data.length >= 12 && data.toString('ascii', 8, 12) === 'WEBP')
          || mime === 'image/bmp' || mime === 'image/svg+xml';
        if (valid) { result.cover = `data:${mime};base64,${data.toString('base64')}`; break; }
      } catch {
        // 大封面、损坏封面以及失效的资源索引均不妨碍书架信息。
      }
    }
    return result;
  } finally {
    await handle.close();
  }
}
module.exports = {
  readMobiMetadata,
  detectKind,
  openMobi,
  loadChapter,
  cleanupMobi,
  planChapterMerge,
  chapterContentWeight,
  parseKindlePosition,
  resolveMobiHref,
  inlineChapterResources,
};
