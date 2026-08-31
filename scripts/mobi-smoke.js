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
    // 跳到第 10 章（长正文）验证章内连续翻页与进度逐页推进
    await __gaiaDebug.jumpToMobiChapter(10);
    await new Promise((r) => setTimeout(r, 600));
    const longScrolls = [];
    const progressTrace = [];
    for (let k = 0; k < 8; k++) {
      await __gaiaDebug.nextPage();
      await new Promise((r) => setTimeout(r, 200));
      longScrolls.push(__gaiaDebug.getReaderScrollTop());
      progressTrace.push(__gaiaDebug.getStatus());
    }
    const pctOf = (s) => {
      const m = s.match(/进度\s+([\d.]+)%/);
      return m ? parseFloat(m[1]) : -1;
    };
    const pctMoved = progressTrace.length >= 2 && pctOf(progressTrace[progressTrace.length - 1]) > pctOf(progressTrace[0]);
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
    // 阅读习惯与主题：设置护眼+双页后重开，应立即生效并延续
    await __gaiaDebug.setTheme('eye');
    if (!__gaiaDebug.getSpreadMode()) await __gaiaDebug.setMode('spread');
    await __gaiaDebug.backToLibrary();
    await new Promise((r) => setTimeout(r, 300));
    await __gaiaDebug.openBook({
      path: window.__MOBI_SMOKE_PATH,
      format: window.__MOBI_SMOKE_FORMAT,
      title: 'mobi-fixture',
    });
    await new Promise((r) => setTimeout(r, 1500));
    const eyeBg = __gaiaDebug.getMobiBackground();
    const eyeOk = eyeBg.indexOf('245, 236, 217') >= 0;
    const habitTheme = __gaiaDebug.getTheme();
    const habitSpread = __gaiaDebug.getSpreadMode();
    const habitOk = habitTheme === 'eye' && habitSpread === true;
    return JSON.stringify({ status, contentLen, chapters, tocCount, idxBefore, idxAfter, scrollBefore, scrollAfter, pct, moved, crossed, longIdx, longScrolls, pctMoved, eyeBg, eyeOk, habitOk });
  } catch (e) {
    console.error('MOBI_OPEN_ERROR', e && (e.stack || e.message || String(e)));
    return 'ERROR';
  }
})();