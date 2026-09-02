'use strict';

const JSZip = require('jszip');
const yauzl = require('yauzl');

function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: false }, (error, zipFile) => {
      if (error) reject(error);
      else resolve(zipFile);
    });
  });
}

function replacementFor(fileName) {
  if (/\.x?html?$/i.test(fileName)) {
    return Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>页面已恢复</title></head>' +
      '<body><p>这一页在源 EPUB 中已经损坏，Gaia Reading 已跳过损坏内容，使其余章节可以继续阅读。</p></body></html>',
      'utf8'
    );
  }
  return Buffer.alloc(0);
}

function sanitizeEntry(fileName, data) {
  if (/\.css$/i.test(fileName)) {
    const source = data.toString('utf8');
    const sanitized = source.replace(/url\(\s*(['"]?)res:\/\/\/[^)'"\s]+\1\s*\)/gi, 'local("__gaia_unavailable_font__")');
    return sanitized === source ? data : Buffer.from(sanitized, 'utf8');
  }
  if (!/\.x?html?$/i.test(fileName)) return data;
  const source = data.toString('utf8');
  const sanitized = source.replace(/<svg\b[^>]*>\s*(<img\b[^>]*\/?>)\s*<\/svg>/gi, '$1');
  return sanitized === source ? data : Buffer.from(sanitized, 'utf8');
}

function isCriticalEntry(fileName) {
  return fileName === 'mimetype' ||
    fileName.toLowerCase() === 'meta-inf/container.xml' ||
    /\.opf$/i.test(fileName);
}

async function collectRecoverableEntries(buffer) {
  const zipFile = await openZip(buffer);
  return new Promise((resolve, reject) => {
    const entries = [];
    const failures = [];
    let settled = false;

    const close = () => {
      try { zipFile.close(); } catch (error) {}
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      close();
      if (error) reject(error);
      else resolve({ entries, failures });
    };
    const recoverEntry = (entry, error) => {
      if (isCriticalEntry(entry.fileName)) {
        finish(new Error('关键 EPUB 文件损坏：' + entry.fileName));
        return;
      }
      failures.push({ fileName: entry.fileName, reason: error && error.message ? error.message : String(error || '读取失败') });
      entries.push({ fileName: entry.fileName, data: replacementFor(entry.fileName) });
      if (!settled) zipFile.readEntry();
    };

    zipFile.on('entry', (entry) => {
      if (settled) return;
      if (/\/$/.test(entry.fileName)) {
        zipFile.readEntry();
        return;
      }
      zipFile.openReadStream(entry, (openError, stream) => {
        if (openError) {
          recoverEntry(entry, openError);
          return;
        }
        const chunks = [];
        let streamDone = false;
        const complete = (streamError) => {
          if (streamDone || settled) return;
          streamDone = true;
          if (streamError) recoverEntry(entry, streamError);
          else {
            entries.push({ fileName: entry.fileName, data: sanitizeEntry(entry.fileName, Buffer.concat(chunks)) });
            zipFile.readEntry();
          }
        };
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.once('error', complete);
        stream.once('end', () => complete(null));
      });
    });
    zipFile.once('end', () => finish(null));
    zipFile.once('error', finish);
    zipFile.readEntry();
  });
}

async function repairEpubBuffer(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { entries, failures } = await collectRecoverableEntries(source);
  if (!entries.length) throw new Error('EPUB 中没有可恢复的文件');
  const maxFailures = Math.max(8, Math.ceil(entries.length * 0.02));
  if (failures.length > maxFailures) throw new Error('EPUB 损坏范围过大，无法可靠恢复');

  const repaired = new JSZip();
  const mimetype = entries.find((entry) => entry.fileName === 'mimetype');
  if (mimetype) repaired.file('mimetype', mimetype.data, { compression: 'STORE' });
  for (const entry of entries) {
    if (entry.fileName === 'mimetype') continue;
    repaired.file(entry.fileName, entry.data);
  }
  const repairedBuffer = await repaired.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await JSZip.loadAsync(repairedBuffer);
  return { buffer: repairedBuffer, failures };
}

module.exports = { repairEpubBuffer };
