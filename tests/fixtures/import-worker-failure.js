'use strict';
process.on('message', ({ filePath, directory }) => {
  require('fs').writeFileSync(require('path').join(directory, 'worker-resource'), 'temporary');
  if (filePath === 'hang.epub') { while (true) {} }
  if (filePath === 'crash.epub') process.exit(37);
  process.send({ meta: { path: filePath, format: 'epub' } });
});
