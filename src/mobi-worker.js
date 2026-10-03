'use strict';

const { openMobi, loadChapter, resolveMobiHref, sampleMobiText } = require('./shared/mobi');

const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send(message);
let opened = null;
let directory = '';
let queue = Promise.resolve();

async function run({ id, method, payload }) {
  try {
    let value;
    if (method === 'open') {
      directory = payload.directory;
      opened = await openMobi(payload.filePath, directory);
      const { kind, title, author, cover, chapters, toc } = opened;
      value = { kind, title, author, cover, chapters, toc, textSample: sampleMobiText(opened) };
    } else {
      if (!opened) throw new Error('MOBI 会话尚未打开');
      if (method === 'chapter') value = await loadChapter(opened, payload.index, directory);
      else if (method === 'resolve') value = resolveMobiHref(opened, payload.href);
      else throw new Error('未知的图书解析请求');
    }
    send({ id, value });
  } catch (error) {
    send({ id, error: error.message || '图书解析失败' });
  }
}

function enqueue(message) { queue = queue.then(() => run(message)); }
if (process.parentPort) process.parentPort.on('message', event => enqueue(event.data));
else process.on('message', enqueue);
