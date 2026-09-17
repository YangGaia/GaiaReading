'use strict';

const fs = require('fs');
const path = require('path');

function importError(message, code) {
  return Object.assign(new Error(message), { code });
}

// One disposable process per book. A stuck parser never owns the window's event loop.
class ImportQueue {
  constructor({ fork, tempRoot, timeoutMs = 15000, log = () => {} }) {
    this.fork = fork;
    this.tempRoot = path.resolve(tempRoot);
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.pending = [];
    this.active = null;
    this.closed = false;
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  read(filePath, owner = 0) {
    if (this.closed) return Promise.reject(importError('导入服务已关闭', 'IMPORT_CLOSED'));
    return new Promise((resolve, reject) => {
      this.pending.push({ filePath, owner, resolve, reject });
      this.next();
    });
  }

  cancel(owner) {
    const error = importError('已取消导入', 'IMPORT_CANCELLED');
    this.pending = this.pending.filter((job) => {
      if (job.owner !== owner) return true;
      job.reject(error);
      return false;
    });
    if (this.active && this.active.owner === owner) this.active.finish(error);
  }

  close() {
    this.closed = true;
    for (const owner of new Set(this.pending.map((job) => job.owner))) this.cancel(owner);
    if (this.active) this.cancel(this.active.owner);
  }

  next() {
    if (this.closed || this.active || !this.pending.length) return;
    const job = this.pending.shift();
    this.active = job;
    const started = Date.now();
    let child;
    let directory;
    let settled = false;
    let cleaned = false;
    let timer;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      // Only remove the exact directory created for this job, even after a worker crash.
      if (directory && path.dirname(directory) === this.tempRoot && path.basename(directory).startsWith('book-')) {
        try { await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (error) { this.log('cleanup-error', { message: error.message }); }
      }
      if (this.active === job) this.active = null;
      this.next();
    };
    job.finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.log(error ? 'failed' : 'complete', {
        file: path.basename(job.filePath), ms: Date.now() - started,
        code: error && error.code, message: error && error.message,
      });
      if (error) job.reject(error);
      else job.resolve(value);
      if (child) {
        try { child.kill(); } catch (error) { void cleanup(); }
      } else void cleanup();
    };
    try {
      directory = fs.mkdtempSync(path.join(this.tempRoot, 'book-'));
      child = this.fork();
      this.log('start', { file: path.basename(job.filePath) });
      timer = setTimeout(() => job.finish(importError('读取图书信息超时，已跳过，可稍后重试', 'IMPORT_TIMEOUT')), this.timeoutMs);
      child.on('message', (message) => {
        if (settled || !message) return;
        if (message.phase) this.log('phase', { file: path.basename(job.filePath), phase: message.phase });
        else if (message.error) job.finish(importError(message.error, 'IMPORT_PARSE_FAILED'));
        else if (message.meta && message.meta.path === job.filePath && message.meta.format) job.finish(null, message.meta);
        else job.finish(importError('解析进程返回了无效的图书信息', 'IMPORT_INVALID_RESULT'));
      });
      child.once('error', (error) => job.finish(error));
      const exited = (code) => {
        if (!settled) job.finish(importError('图书解析进程意外退出（' + code + '），已跳过', 'IMPORT_WORKER_EXIT'));
        void cleanup();
      };
      child.once('exit', exited);
      child.once('close', exited);
      child.once('spawn', () => {
        try {
          // UtilityProcess.kill() can return false before spawn; cancellation must
          // also terminate that late-starting process so the queue can advance.
          if (settled) child.kill();
          else child.postMessage({ filePath: job.filePath, directory });
        }
        catch (error) { job.finish(error); }
      });
    } catch (error) {
      job.finish(error);
    }
  }
}

module.exports = { ImportQueue };
