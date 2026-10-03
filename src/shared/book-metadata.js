'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { inspectEpub, parseEpub, assertRepairBudget } = require('./epub-meta');
const { repairEpubBuffer } = require('./epub-repair');
const { readMobiMetadata } = require('./mobi');

const MAX_COMPRESSED_BOOK_BYTES = 512 * 1024 * 1024;
const MAX_REPAIR_SOURCE_BYTES = 128 * 1024 * 1024;
const FORMATS = new Set(['epub', 'mobi', 'azw3', 'txt', 'pdf']);

async function epubMetadata(filePath, size) {
  let inspected;
  let source;
  try {
    inspected = await inspectEpub(filePath);
    // 小文件保留原有坏章节恢复能力。封面省略后无需为它展开或重写全书。
    if (size <= MAX_REPAIR_SOURCE_BYTES && !inspected.coverOmitted) {
      source = await fs.promises.readFile(filePath);
      await JSZip.loadAsync(source);
    }
    return { meta: inspected.meta, recovered: false, recoveredEntries: [] };
  } catch (error) {
    if (size > MAX_REPAIR_SOURCE_BYTES || error.code === 'EPUB_METADATA_LIMIT') throw error;
    source = source || await fs.promises.readFile(filePath);
    await assertRepairBudget(source);
    const repaired = await repairEpubBuffer(source);
    return {
      meta: await parseEpub(repaired.buffer),
      recovered: true,
      recoveredEntries: repaired.failures.map((entry) => entry.fileName),
    };
  }
}

// 此模块不依赖 Electron，供独立解析进程调用。当前解析均在内存或文件句柄中完成，
// temporaryRoot 参数保留给调用方约定；不生成 MOBI 图片目录或其他临时文件。
async function metaFor(filePath, { temporaryRoot } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('图书路径无效');
  const extension = path.extname(filePath).toLowerCase();
  const format = extension.slice(1);
  if (!FORMATS.has(format)) throw new Error('不支持的图书格式：' + extension);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error('图书路径不是文件');
  const result = {
    path: filePath,
    format,
    title: path.basename(filePath, path.extname(filePath)),
    author: '',
    cover: null,
    recovered: false,
    recoveredEntries: [],
  };
  if (format === 'txt' || format === 'pdf' || stat.size > MAX_COMPRESSED_BOOK_BYTES) return result;
  if (format === 'epub') {
    try {
      const parsed = await epubMetadata(filePath, stat.size);
      result.title = parsed.meta.title || result.title;
      result.author = parsed.meta.author || '';
      result.cover = parsed.meta.cover ? `data:${parsed.meta.cover.mime};base64,${parsed.meta.cover.base64}` : null;
      result.recovered = parsed.recovered;
      result.recoveredEntries = parsed.recoveredEntries;
    } catch (error) {
      throw new Error('EPUB 文件损坏或超过安全解析上限：' + (error.message || '未知错误'));
    }
  } else {
    try {
      const meta = await readMobiMetadata(filePath);
      result.title = meta.title || result.title;
      result.author = meta.author || '';
      result.cover = meta.cover || null;
    } catch (error) {
      // MOBI/AZW3 沿用文件名回退；进程级超时及退出由批量导入调度器计为失败。
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  return result;
}

module.exports = { metaFor, MAX_COMPRESSED_BOOK_BYTES, MAX_REPAIR_SOURCE_BYTES };
