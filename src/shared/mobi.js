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
 * 2. 资源（图片/CSS）会被 node 版保存到 resourceSaveDir，章节 HTML 里是本地绝对路径。
 *    我们将其内联为 data URL，让渲染进程拿到自包含 HTML。
 */

const fs = require('fs');
const path = require('path');

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
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/webp';
  return fallback || 'application/octet-stream';
}

/** 读取资源文件为 data URL。 */
function toDataUrl(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const mime = mimeOf(buf, 'application/octet-stream');
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

/**
 * 把章节 HTML 中引用本地资源（图片/CSS）的绝对路径替换为内联内容。
 * 返回 { html, cssText }：html 为自包含片段，cssText 为可注入的样式。
 */
function inlineChapterResources(chapterHtml, resourceSaveDir) {
  let html = chapterHtml || '';
  const cssText = [];

  // CSS 文件引用：<link rel="stylesheet" href="...">
  html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
    if (/^(https?:|data:)/i.test(href)) return match;
    const p = path.isAbsolute(href) ? href : path.join(resourceSaveDir, href);
    try {
      cssText.push(fs.readFileSync(p, 'utf8'));
      return '';
    } catch {
      return match;
    }
  });

  // 图片引用：src="..." 或 srcset
  html = html.replace(/(<img[^>]*src=["'])([^"']+)(["'])/gi, (match, pre, src, post) => {
    if (/^(https?:|data:|blob:)/i.test(src)) return match;
    const p = path.isAbsolute(src) ? src : path.join(resourceSaveDir, src);
    const dataUrl = toDataUrl(p);
    if (dataUrl) return pre + dataUrl + post;
    return match;
  });

  // CSS url(...) 引用（背景图等）
  html = html.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, ref) => {
    if (/^(https?:|data:)/i.test(ref)) return match;
    const p = path.isAbsolute(ref) ? ref : path.join(resourceSaveDir, ref);
    const dataUrl = toDataUrl(p);
    if (dataUrl) return 'url(' + dataUrl + ')';
    return match;
  });

  return { html, cssText: cssText.join('\n') };
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
  const kind = detectKind(buf);
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
      } catch (errKf8) {
        throw new Error('无法解析 MOBI 文件：' + errMobi.message + ' / ' + errKf8.message);
      }
    }
  }

  const meta = book.getMetadata();
  const spine = book.getSpine();
  const toc = book.getToc();
  let cover = null;
  try {
    const coverRef = book.getCoverImage();
    if (coverRef && /^(https?:|data:|blob:|file:)/i.test(coverRef)) {
      cover = coverRef;
    } else if (coverRef && fs.existsSync(coverRef)) {
      cover = toDataUrl(coverRef);
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
  let raw = position && opened.fidToIndex instanceof Map ? opened.fidToIndex.get(position.fid) : null;
  let resolved = null;
  if (typeof book.resolveHref === 'function') {
    try { resolved = book.resolveHref(String(href)); } catch (error) {}
  }
  if (raw == null && resolved && resolved.id != null && opened.rawIndexById instanceof Map) {
    raw = opened.rawIndexById.get(String(resolved.id));
  }
  if (raw == null) return { index: null, selector: '' };
  const target = Array.isArray(opened.mergeTarget) && opened.mergeTarget[raw] >= 0 ? opened.mergeTarget[raw] : raw;
  const mapped = Array.isArray(opened.newIndexOf) ? opened.newIndexOf[target] : target;
  let selector = position && resolved && typeof resolved.selector === 'string' ? resolved.selector : '';
  if (!selector && position) selector = nearestKf8Selector(book, position.fid, position.off);
  const fileposMatch = String(href).match(/^filepos:(\d+)/i);
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
  const inlinedList = parts.map((p) => inlineChapterResources(p.html, resourceSaveDir));
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

module.exports = {
  detectKind,
  openMobi,
  loadChapter,
  cleanupMobi,
  planChapterMerge,
  chapterContentWeight,
  parseKindlePosition,
  resolveMobiHref,
};
