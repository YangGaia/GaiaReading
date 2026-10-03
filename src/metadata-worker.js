'use strict';

// This entry is forked as a Node process, including when the parent is Electron.
// Never import main.js or initialize an application window here.
const { metaFor } = require('./shared/book-metadata');

process.once('message', async (request) => {
  let message;
  try {
    if (!request || typeof request.filePath !== 'string') throw new Error('图书路径无效');
    const value = await metaFor(request.filePath, { temporaryRoot: request.temporaryRoot });
    message = { type: 'metadata', ok: true, value };
  } catch (error) {
    message = { type: 'metadata', ok: false, error: String(error && error.message || error || '图书解析失败') };
  }
  if (process.connected) process.send(message, () => { if (process.connected) process.disconnect(); });
});
