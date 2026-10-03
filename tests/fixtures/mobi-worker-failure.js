'use strict';

let filePath = '';
process.on('message', ({ id, method, payload }) => {
  if (method === 'open') filePath = payload.filePath;
  if (filePath === 'hang.mobi' || (filePath === 'chapter-hang.mobi' && method === 'chapter')) {
    for (;;) Math.sqrt(Date.now());
  }
  if (filePath === 'crash.mobi') process.exit(9);
  if (filePath === 'invalid.mobi') process.send({ id, error: '损坏的书籍' });
  else process.send({ id, value: method === 'open' ? { title: filePath, chapters: [{ index: 0 }] } : { html: '<p>正文</p>' } });
});
