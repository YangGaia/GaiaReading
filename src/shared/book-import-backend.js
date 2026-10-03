'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_EXT = ['.epub', '.pdf', '.txt', '.mobi', '.azw3'];
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

function importCancelledError() {
  const error = new Error('已取消导入');
  error.name = 'AbortError';
  error.code = 'BOOK_IMPORT_CANCELLED';
  return error;
}

function throwIfImportCancelled(signal) {
  if (signal && signal.aborted) throw importCancelledError();
}

function formatOf(filePath) {
  if (typeof filePath !== 'string') return null;
  const extension = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXT.includes(extension) ? extension.slice(1) : null;
}

function normalizedBookPath(filePath, platform = process.platform) {
  const value = String(filePath || '');
  if (platform === 'win32') return path.win32.resolve(value.replace(/\//g, '\\')).toLowerCase();
  return path.resolve(value);
}

async function deduplicateBookPaths(paths, options = {}) {
  const { signal, platform = process.platform } = options;
  const seen = new Set();
  const result = [];
  let visited = 0;
  throwIfImportCancelled(signal);
  for (const filePath of paths) {
    throwIfImportCancelled(signal);
    if (formatOf(filePath)) {
      const key = normalizedBookPath(filePath, platform);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(filePath);
      }
    }
    // Count every entry, including duplicates and unsupported files.
    if (++visited % 64 === 0) {
      await yieldToLoop();
      throwIfImportCancelled(signal);
    }
  }
  return result;
}

async function scanBookFolder(directory, options = {}) {
  const { signal, onProgress, platform = process.platform, maxDepth = 8 } = options;
  const openDirectory = options.openDirectory || ((dir) => fs.promises.opendir(dir));
  const foundPaths = [];
  const seen = new Set();
  let scanned = 0;
  let currentPath = directory;
  let lastProgress = 0;
  const report = (force = false) => {
    throwIfImportCancelled(signal);
    const now = Date.now();
    if (typeof onProgress === 'function' && (force || now - lastProgress >= 80)) {
      lastProgress = now;
      onProgress({ phase: 'scanning', currentPath, scanned, found: foundPaths.length });
      throwIfImportCancelled(signal);
    }
  };
  async function walk(dir, depth) {
    throwIfImportCancelled(signal);
    if (depth <= 0) return;
    let entries;
    try { entries = await openDirectory(dir); }
    catch (error) {
      throwIfImportCancelled(signal);
      if (['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(error.code)) return;
      throw error;
    }
    // Async iteration closes directory handles on completion, errors and cancellation.
    for await (const entry of entries) {
      throwIfImportCancelled(signal);
      scanned += 1;
      currentPath = path.join(dir, entry.name);
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(currentPath, depth - 1);
        else if (entry.isFile() && formatOf(currentPath)) {
          const key = normalizedBookPath(currentPath, platform);
          if (!seen.has(key)) {
            seen.add(key);
            foundPaths.push(currentPath);
          }
        }
      }
      report();
      if (scanned % 64 === 0) {
        await yieldToLoop();
        throwIfImportCancelled(signal);
      }
    }
  }
  report(true);
  await walk(directory, maxDepth);
  report(true);
  return foundPaths;
}

class BookImportSessions {
  constructor() {
    this.batches = new Map();
    this.jobs = new Map();
    this.pending = new Set();
  }

  begin(senderId, requestId) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new Error('导入任务 ID 无效');
    const previous = this.batches.get(senderId);
    if (previous) {
      if (previous.requestId === requestId) return true;
      throw new Error('已有图书正在导入，请等待当前任务结束');
    }
    this.batches.set(senderId, { requestId, controller: new AbortController() });
    return true;
  }

  signalFor(senderId, requestId) {
    if (requestId == null) return undefined;
    const batch = this.batches.get(senderId);
    if (!batch || batch.requestId !== requestId) throw new Error('导入任务已结束，请重新导入');
    return batch.controller.signal;
  }

  cancel(senderId, requestId) {
    const batch = this.batches.get(senderId);
    if (!batch || batch.requestId !== requestId) return false;
    // Retain the aborted context until end(): later queued work must stay cancelled.
    batch.controller.abort();
    return true;
  }

  end(senderId, requestId) {
    if (!this.cancel(senderId, requestId)) return false;
    this.batches.delete(senderId);
    return true;
  }

  close(senderId) {
    const batch = this.batches.get(senderId);
    if (batch) this.end(senderId, batch.requestId);
    const jobs = this.jobs.get(senderId);
    if (jobs) for (const controller of jobs) controller.abort();
  }

  closeAll() {
    for (const senderId of new Set([...this.batches.keys(), ...this.jobs.keys()])) this.close(senderId);
    return Promise.allSettled([...this.pending]);
  }

  async run(senderId, requestId, operation) {
    const parentSignal = this.signalFor(senderId, requestId);
    throwIfImportCancelled(parentSignal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (parentSignal) parentSignal.addEventListener('abort', cancel, { once: true });
    let jobs = this.jobs.get(senderId);
    if (!jobs) {
      jobs = new Set();
      this.jobs.set(senderId, jobs);
    }
    jobs.add(controller);
    const task = Promise.resolve().then(() => {
      throwIfImportCancelled(controller.signal);
      return operation(controller.signal);
    });
    this.pending.add(task);
    try { return await task; }
    finally {
      if (parentSignal) parentSignal.removeEventListener('abort', cancel);
      this.pending.delete(task);
      jobs.delete(controller);
      if (!jobs.size) this.jobs.delete(senderId);
    }
  }
}

module.exports = {
  SUPPORTED_EXT, formatOf, normalizedBookPath, deduplicateBookPaths,
  scanBookFolder, importCancelledError, throwIfImportCancelled, BookImportSessions,
};
