(async () => {
  try {
    await __gaiaDebug.waitHome();
    await __gaiaDebug.openBook({
      path: window.__MOBI_SMOKE_PATH,
      format: window.__MOBI_SMOKE_FORMAT,
      title: 'mobi-fixture',
    });
    await new Promise((r) => setTimeout(r, 1500));
    const status = __gaiaDebug.getStatus();
    const contentLen = __gaiaDebug.getMobiContentLength();
    const chapters = __gaiaDebug.getMobiChapters();
    const tocCount = __gaiaDebug.getMobiTocCount();
    const idxBefore = __gaiaDebug.getMobiIndex();
    const pct = __gaiaDebug.getPercent();
    await __gaiaDebug.nextPage();
    await new Promise((r) => setTimeout(r, 800));
    const idxAfter = __gaiaDebug.getMobiIndex();
    return JSON.stringify({ status, contentLen, chapters, tocCount, idxBefore, idxAfter, pct });
  } catch (e) {
    console.error('MOBI_OPEN_ERROR', e && (e.stack || e.message || String(e)));
    return 'ERROR';
  }
})();
