'use strict';

const { readBookMetadata } = require('./shared/book-metadata');
const { inspectBookFile } = require('./shared/book-files');

// Electron utility process in the app; a Node child process in integration tests.
const send = (message) => process.parentPort ? process.parentPort.postMessage(message) : process.send(message);
async function run({ filePath, directory, deadline }) {
  try {
    const meta = await readBookMetadata(filePath, directory, (phase) => send({ phase }));
    // Keep slow drives and large books from holding up the import queue for an optional fingerprint.
    const budget = Math.min(1200, deadline - Date.now() - 200);
    if (budget > 0) {
      const file = await inspectBookFile(filePath, { signal: AbortSignal.timeout(budget) }).catch(() => null);
      if (file) meta.fingerprint = file.fingerprint;
    }
    send({ meta });
  } catch (error) { send({ error: error && error.message ? error.message : '无法读取图书信息' }); }
}
if (process.parentPort) process.parentPort.on('message', (event) => void run(event.data));
else process.on('message', (message) => void run(message));
