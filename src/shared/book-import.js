(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaiaBookImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pathKey(value) { return String(value || '').replace(/\\/g, '/').toLowerCase(); }

  function createBookImporter({ getLibrary, metadata, commit, cancelMetadata, onProgress = () => {} }) {
    let active = null;
    return {
      get busy() { return !!active; },
      cancel() {
        if (!active) return;
        active.cancelled = true;
        // Observe IPC rejection without leaving an unhandled promise on cancellation.
        Promise.resolve().then(() => cancelMetadata()).catch(() => {});
      },
      async run(paths) {
        if (active) throw new Error('已有导入任务正在进行');
        const task = { cancelled: false };
        active = task;
        const result = { added: 0, recovered: 0, skipped: 0, failures: [], cancelled: false };
        try {
          const existing = new Set(getLibrary().map((book) => pathKey(book.path)));
          for (let index = 0; index < paths.length; index++) {
            if (index && index % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
            if (task.cancelled) break;
            const filePath = paths[index];
            onProgress({ index: index + 1, total: paths.length, path: filePath, ...result });
            if (existing.has(pathKey(filePath))) { result.skipped += 1; continue; }
            let meta;
            try {
              meta = await metadata(filePath);
              if (task.cancelled) break;
              if (!meta || pathKey(meta.path) !== pathKey(filePath) || !meta.format) throw new Error('无法读取图书信息');
            } catch (error) {
              if (task.cancelled) break;
              result.failures.push({ path: filePath, message: error.message || '未知错误' });
              continue;
            }
            try {
              // A book counts as imported only after its checkpoint is safely written.
              await commit(meta);
              existing.add(pathKey(filePath));
              result.added += 1;
              if (meta.recovered) result.recovered += 1;
            } catch (error) {
              result.failures.push({ path: filePath, message: '保存书架失败：' + (error.message || '未知错误') });
              result.stopped = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          result.cancelled = task.cancelled;
          return result;
        } finally { active = null; }
      },
    };
  }

  return { createBookImporter, pathKey };
});
