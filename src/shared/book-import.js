(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaiaBookImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normalizeBookPath(value, windows) {
    let normalized = String(value || '').replace(/\\/g, '/');
    if (windows !== false) {
      normalized = normalized.replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
    }
    const prefix = normalized.startsWith('//') ? '//' : normalized.startsWith('/') ? '/' : '';
    const parts = [];
    for (const part of normalized.slice(prefix.length).split('/')) {
      if (!part || part === '.') continue;
      if (part === '..' && parts.length && parts[parts.length - 1] !== '..' && !/:$/.test(parts[parts.length - 1])) parts.pop();
      else parts.push(part);
    }
    normalized = prefix + parts.join('/');
    return windows === false ? normalized : normalized.toLowerCase();
  }

  function errorMessage(error) {
    return error && error.message ? error.message : String(error || '未知错误');
  }

  function emptyResult() {
    return { added: 0, recovered: 0, skipped: 0, failures: [], cancelled: false, saveError: null };
  }

  function createBookImporter(options) {
    const settings = options || {};
    const yieldControl = settings.yieldControl || (() => new Promise((resolve) => setTimeout(resolve, 0)));
    const yieldEvery = Math.max(1, Number(settings.yieldEvery) || 32);
    let active = null;
    let sequence = 0;
    let lastState = { active: false, phase: 'idle', requestId: '', processed: 0, total: 0, saved: 0, currentPath: '' };
    const cancelledMarker = {};

    function report(session, changes) {
      if (active !== session) return;
      Object.assign(session.progress, changes || {}, {
        active: true,
        requestId: session.requestId,
        saved: session.result.added,
        recovered: session.result.recovered,
        skipped: session.result.skipped,
        failed: session.result.failures.length,
        cancelled: session.result.cancelled,
      });
      lastState = Object.assign({}, session.progress);
      if (settings.onProgress) settings.onProgress(Object.assign({}, lastState));
    }

    async function notifyCancellation(session) {
      if (!session.begun || !settings.cancel) return;
      try { await settings.cancel(session.requestId); } catch (error) {
        if (settings.onFailure) settings.onFailure({ stage: 'cancel', message: errorMessage(error) });
      }
    }

    function cancel() {
      const session = active;
      if (!session) return Promise.resolve(false);
      if (!session.result.cancelled) {
        session.result.cancelled = true;
        session.resolveCancellation(cancelledMarker);
        report(session, { phase: 'cancelling' });
        session.cancelPromise = notifyCancellation(session);
      }
      return session.promise.then(() => true);
    }

    function scanning(event) {
      if (!active || !event || event.requestId !== active.requestId || active.result.cancelled || event.phase !== 'scanning') return;
      report(active, {
        phase: 'scanning', currentPath: String(event.currentPath || ''),
        scanned: Number(event.scanned) || 0, found: Number(event.found) || 0,
      });
    }

    async function run(session, input) {
      const result = session.result;
      try {
        if (settings.begin) await settings.begin(session.requestId);
        session.begun = true;
        if (result.cancelled) {
          await notifyCancellation(session);
          return result;
        }
        let paths = input.paths;
        if (input.selectPaths) {
          try {
            paths = await Promise.race([input.selectPaths(session.requestId), session.cancellation]);
          } catch (error) {
            if (!result.cancelled) result.selectionError = errorMessage(error);
            return result;
          }
          if (paths === cancelledMarker || result.cancelled) return result;
        }
        paths = Array.isArray(paths) ? paths : [];
        result.selectionEmpty = paths.length === 0;
        report(session, { phase: 'preparing', total: paths.length, currentPath: '' });
        if (!paths.length) return result;
        let library = settings.getLibrary().slice();
        const existing = new Set();
        for (let index = 0; index < library.length; index += 1) {
          if (result.cancelled) return result;
          existing.add(normalizeBookPath(library[index].path, settings.windows));
          if ((index + 1) % yieldEvery === 0) await yieldControl();
        }
        const attempted = new Set();
        for (let index = 0; index < paths.length; index += 1) {
          if (index % yieldEvery === 0) await yieldControl();
          if (result.cancelled) break;
          const filePath = paths[index];
          const key = normalizeBookPath(filePath, settings.windows);
          session.progress.currentPath = String(filePath || '');
          if (existing.has(key) || attempted.has(key)) {
            result.skipped += 1;
            session.progress.processed = index + 1;
            if ((index + 1) % yieldEvery === 0 || index === paths.length - 1) report(session, { phase: 'parsing' });
            continue;
          }
          attempted.add(key);
          report(session, { phase: 'parsing' });
          let meta;
          try {
            meta = await Promise.race([settings.metadata(filePath, session.requestId), session.cancellation]);
            if (meta === cancelledMarker || result.cancelled) break;
            if (!meta || !meta.path || !meta.format) throw new Error('无法读取图书信息');
          } catch (error) {
            if (result.cancelled) break;
            const failure = { path: filePath, message: errorMessage(error), stage: 'metadata' };
            result.failures.push(failure);
            if (settings.onFailure) settings.onFailure(failure);
            report(session, { processed: index + 1 });
            continue;
          }
          const metadataKey = normalizeBookPath(meta.path, settings.windows);
          if (existing.has(metadataKey)) {
            result.skipped += 1;
            report(session, { processed: index + 1 });
            continue;
          }
          const nextLibrary = library.concat([meta]);
          report(session, { phase: 'saving' });
          try {
            // A dispatched write must settle before cancellation releases this batch.
            const saved = await settings.saveLibrary(nextLibrary);
            if (saved === false) throw new Error('书架保存未成功');
          } catch (error) {
            result.saveError = errorMessage(error);
            const failure = { path: filePath, message: result.saveError, stage: 'save' };
            result.failures.push(failure);
            if (settings.onFailure) settings.onFailure(failure);
            report(session, { processed: index + 1 });
            break;
          }
          library = nextLibrary;
          settings.setLibrary(library);
          existing.add(key);
          existing.add(metadataKey);
          result.added += 1;
          if (meta.recovered) result.recovered += 1;
          report(session, { phase: result.cancelled ? 'cancelling' : 'parsing', processed: index + 1 });
          if (settings.onSaved) settings.onSaved(meta, Object.assign({}, session.progress));
        }
        return result;
      } catch (error) {
        if (!result.cancelled) result.selectionError = errorMessage(error);
        return result;
      } finally {
        if (session.cancelPromise) await session.cancelPromise;
        if (settings.end) {
          try { await settings.end(session.requestId); } catch (error) {
            if (settings.onFailure) settings.onFailure({ stage: 'end', message: errorMessage(error) });
          }
        }
        if (active === session) {
          report(session, { phase: 'complete', currentPath: '' });
          active = null;
          lastState.active = false;
          if (settings.onProgress) settings.onProgress(Object.assign({}, lastState));
        }
      }
    }

    function start(input) {
      if (active) return Promise.resolve(Object.assign(emptyResult(), { busy: true }));
      const request = input || {};
      const session = {
        requestId: request.requestId || 'book-import-' + Date.now() + '-' + (++sequence),
        result: emptyResult(), begun: false, cancelPromise: null,
        progress: { phase: request.selectPaths ? 'selecting' : 'preparing', processed: 0, total: 0, scanned: 0, found: 0, currentPath: '' },
      };
      session.cancellation = new Promise((resolve) => { session.resolveCancellation = resolve; });
      active = session;
      // Install the promise before reporting so callbacks can cancel immediately.
      session.promise = Promise.resolve().then(() => run(session, request));
      report(session);
      return session.promise;
    }

    return { start, cancel, scanning, getState: () => Object.assign({}, lastState) };
  }

  return { normalizeBookPath, createBookImporter };
});
