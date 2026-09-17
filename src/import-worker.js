'use strict';

const { readBookMetadata } = require('./shared/book-metadata');

// Electron utility process in the app; a Node child process in integration tests.
const send = (message) => process.parentPort ? process.parentPort.postMessage(message) : process.send(message);
async function run({ filePath, directory }) {
  try { send({ meta: await readBookMetadata(filePath, directory, (phase) => send({ phase })) }); }
  catch (error) { send({ error: error && error.message ? error.message : '无法读取图书信息' }); }
}
if (process.parentPort) process.parentPort.on('message', (event) => void run(event.data));
else process.on('message', (message) => void run(message));
