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
    // 跳到第 10 章（长正文）验证章内连续滚动
    await __gaiaDebug.jumpToMobiChapter(10);
    await new Promise((r) => setTimeout(r, 600));
    const longScrolls = [];
    for (let k = 0; k < 8; k++) {
      await __gaiaDebug.nextPage();
      await new Promise((r) => setTimeout(r, 200));
      longScrolls.push(__gaiaDebug.getReaderScrollTop());
    }
    const longIdx = __gaiaDebug.getMobiIndex();
    const idxBefore = __gaiaDebug.getMobiIndex();
    const scrollBefore = __gaiaDebug.getReaderScrollTop();
    const pct = __gaiaDebug.getPercent();
    await __gaiaDebug.nextPage();
    await new Promise((r) => setTimeout(r, 800));
    const idxAfter = __gaiaDebug.getMobiIndex();
    const scrollAfter = __gaiaDebug.getReaderScrollTop();
    // 连续翻 5 页，验证章节内滚动与跨章
    let moved = 0;
    let crossed = 0;
    let prevIdx = idxAfter;
    let prevScroll = scrollAfter;
    for (let k = 0; k < 5; k++) {
      await __gaiaDebug.nextPage();
      await new Promise((r) => setTimeout(r, 300));
      const curIdx = __gaiaDebug.getMobiIndex();
      const curScroll = __gaiaDebug.getReaderScrollTop();
      if (curScroll !== prevScroll || curIdx !== prevIdx) moved++;
      if (curIdx !== prevIdx) crossed++;
      prevIdx = curIdx;
      prevScroll = curScroll;
    }
    return JSON.stringify({ status, contentLen, chapters, tocCount, idxBefore, idxAfter, scrollBefore, scrollAfter, pct, moved, crossed, longIdx, longScrolls });
  } catch (e) {
    console.error('MOBI_OPEN_ERROR', e && (e.stack || e.message || String(e)));
    return 'ERROR';
  }
})();
