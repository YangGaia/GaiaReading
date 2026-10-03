'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const { importCancelledError, throwIfImportCancelled } = require('./book-import-backend');

const METADATA_TIMEOUT_MS = 15000;

function metadataError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function runMetadataProcess(filePath, options = {}) {
  const { signal, temporaryRoot = os.tmpdir(), timeoutMs = METADATA_TIMEOUT_MS } = options;
  throwIfImportCancelled(signal);
  await fs.promises.mkdir(temporaryRoot, { recursive: true });
  throwIfImportCancelled(signal);
  const jobDirectory = await fs.promises.mkdtemp(path.join(temporaryRoot, 'GaiaReading_Lucky-metadata-'));
  try {
    throwIfImportCancelled(signal);
    return await new Promise((resolve, reject) => {
      let child;
      let outcome = null;
      let timer;
      const cleanupListeners = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const finish = (error, value) => {
        if (outcome) return;
        outcome = { error, value };
        cleanupListeners();
        // Kill even after a response: each worker owns only this one book, and
        // a parser must not leave handles or ongoing work behind in the batch.
        if (child) child.kill('SIGKILL');
      };
      const onAbort = () => finish(importCancelledError());
      try {
        child = fork(options.workerPath || path.join(__dirname, '..', 'metadata-worker.js'), [], {
          execPath: options.execPath || process.execPath,
          execArgv: [],
          env: {
            ...process.env,
            // Electron otherwise starts another application main process.
            ELECTRON_RUN_AS_NODE: '1',
            TEMP: jobDirectory,
            TMP: jobDirectory,
          },
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          serialization: 'json',
        });
      } catch (error) {
        cleanupListeners();
        reject(metadataError('无法启动图书解析进程：' + error.message, 'BOOK_METADATA_START_FAILED'));
        return;
      }
      child.once('error', (error) => finish(metadataError('图书解析进程出错：' + error.message, 'BOOK_METADATA_PROCESS_FAILED')));
      child.on('message', (message) => {
        if (outcome || !message || message.type !== 'metadata') return;
        if (message.ok === true && message.value && typeof message.value === 'object') finish(null, message.value);
        else finish(metadataError(String(message.error || '图书解析失败'), 'BOOK_METADATA_PARSE_FAILED'));
      });
      child.once('close', (code, exitSignal) => {
        cleanupListeners();
        if (!outcome) {
          outcome = { error: metadataError(
            '图书解析进程异常退出（' + (exitSignal || '退出码 ' + code) + '）',
            'BOOK_METADATA_PROCESS_EXITED'
          ) };
        }
        if (outcome.error) reject(outcome.error);
        else resolve(outcome.value);
      });
      timer = setTimeout(() => finish(metadataError(
        '单本图书解析超过 ' + (timeoutMs / 1000) + ' 秒，已跳过', 'BOOK_METADATA_TIMEOUT'
      )), timeoutMs);
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
      if (!outcome) {
        child.send({ filePath, temporaryRoot: jobDirectory }, (error) => {
          if (error) finish(metadataError('无法发送图书解析任务：' + error.message, 'BOOK_METADATA_PROCESS_FAILED'));
        });
      }
    });
  } finally {
    // A killed parser can leave resources behind. Remove only the directory
    // created for this invocation, after its process has closed all handles.
    await fs.promises.rm(jobDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

module.exports = { METADATA_TIMEOUT_MS, runMetadataProcess };
