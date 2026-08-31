(async () => {
  try {
    await __gaiaDebug.waitHome();
    await __gaiaDebug.openBook({
      path: window.__TXT_SMOKE_PATH,
      format: 'txt',
      title: 'txt-fixture',
    });
    await new Promise((r) => setTimeout(r, 1200));
    const status = __gaiaDebug.getStatus();
    const contentLen = __gaiaDebug.getMobiContentLength();
    const totalPages = __gaiaDebug.getPaginatorTotal();
    const pageBefore = __gaiaDebug.getPaginatorPage();
    await __gaiaDebug.nextPage();
    await new Promise((r) => setTimeout(r, 500));
    const pageAfter = __gaiaDebug.getPaginatorPage();
    // 切到滚动模式
    __gaiaDebug.setMode('scroll');
    await new Promise((r) => setTimeout(r, 400));
    const scrollMode = __gaiaDebug.getReadMode();
    const scrollTop = __gaiaDebug.getReaderScrollTop();
    return JSON.stringify({ status, contentLen, totalPages, pageBefore, pageAfter, scrollMode, scrollTop });
  } catch (e) {
    console.error('TXT_OPEN_ERROR', e && (e.stack || e.message || String(e)));
    return 'ERROR';
  }
})();
