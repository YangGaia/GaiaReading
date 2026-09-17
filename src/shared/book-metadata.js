'use strict';

const fs = require('fs');
const path = require('path');
const { parseEpub } = require('./epub-meta');
const { repairEpubBuffer } = require('./epub-repair');
const { openMobi, cleanupMobi } = require('./mobi');
const { titleFromFilename } = require('./txt-utils');

const SUPPORTED_EXT = new Set(['.epub', '.pdf', '.txt', '.mobi', '.azw3']);

async function readBookMetadata(filePath, directory, phase = () => {}) {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXT.has(extension)) throw new Error('不支持的文件格式');
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error('请选择电子书文件');
  const fallback = { path: filePath, format: extension.slice(1), title: titleFromFilename(path.basename(filePath)), author: '', cover: null };
  if (extension === '.txt' || extension === '.pdf') return fallback;
  // Metadata extraction must not allocate arbitrarily large compressed books in memory.
  if (stat.size > 512 * 1024 * 1024) return { ...fallback, metadataWarning: '书籍较大，已使用文件名导入，打开时再读取正文' };
  phase('读取图书信息');
  if (extension === '.epub') {
    const buffer = await fs.promises.readFile(filePath);
    let meta;
    let recovered = null;
    try { meta = await parseEpub(buffer); }
    catch (error) {
      if (error.code === 'EPUB_METADATA_LIMIT') throw error;
      phase('恢复 EPUB');
      recovered = await repairEpubBuffer(buffer);
      meta = await parseEpub(recovered.buffer);
    }
    return {
      ...fallback, title: meta.title || fallback.title, author: meta.author || '',
      cover: meta.cover ? `data:${meta.cover.mime};base64,${meta.cover.base64}` : null,
      recovered: !!recovered, recoveredEntries: recovered ? recovered.failures.map((item) => item.fileName) : [],
    };
  }
  let opened;
  try {
    opened = await openMobi(filePath, directory, { metadataOnly: true });
    const cover = opened.cover;
    return { ...fallback, title: opened.title || fallback.title, author: opened.author || '', cover: cover && cover.length <= 6 * 1024 * 1024 ? cover : null };
  } finally {
    cleanupMobi(opened);
  }
}

async function scanBookFolder(directory, depth = 8) {
  const files = [];
  async function visit(dir, remaining) {
    if (remaining <= 0) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (dir === directory) throw error; return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full, remaining - 1);
      else if (entry.isFile() && SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }
  await visit(directory, depth);
  return files;
}

module.exports = { readBookMetadata, scanBookFolder };
