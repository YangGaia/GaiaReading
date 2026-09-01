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
    const pctBefore = __gaiaDebug.getProgressWidth();
    await __gaiaDebug.nextPage();
    await new Promise((r) => setTimeout(r, 500));
    const pageAfter = __gaiaDebug.getPaginatorPage();
    const pctAfter = __gaiaDebug.getProgressWidth();
    const pctMoved = pctBefore !== pctAfter && pctAfter !== '';
    const frame = document.getElementById('reader-content').querySelector('iframe');
    const pCount = frame && frame.contentDocument ? frame.contentDocument.body.querySelectorAll('p').length : -1;
    const lineBreaks = frame && frame.contentDocument ? (frame.contentDocument.body.innerHTML.match(/<br>/g) || []).length : -1;
    // 书签内容锚点：加书签 → 改行距重排 → 跳回仍回到同一段
    await __gaiaDebug.addBookmark();
    await new Promise((r) => setTimeout(r, 300));
    const bmList = __gaiaDebug.getBookmarks();
    const bm = bmList[bmList.length - 1];
    const pageAtBookmark = __gaiaDebug.getPaginatorPage();
    await __gaiaDebug.setLineHeight(2.4);
    await new Promise((r) => setTimeout(r, 600));
    const pageAfterReflow = __gaiaDebug.getPaginatorPage();
    await __gaiaDebug.jumpToBookmark(bm);
    await new Promise((r) => setTimeout(r, 600));
    const pageAfterJump = __gaiaDebug.getPaginatorPage();
    const snippetAfterJump = __gaiaDebug.getAnchorSnippet();
    const anchorOk = !!(bm && bm.anchor && typeof bm.anchor.off === 'number') && __gaiaDebug.getAnchorInView(bm.anchor.off) && pageAfterJump >= 0;
    const wheelsAfterNav = __gaiaDebug.countBoundWheels();
    return JSON.stringify({ status, contentLen, totalPages, pageBefore, pageAfter, pctMoved, pCount, lineBreaks, pageAtBookmark, pageAfterReflow, pageAfterJump, snippetAfterJump, anchorOk, wheelsAfterNav, layout: __gaiaDebug.getPaginatorLayout() });
  } catch (e) {
    console.error('TXT_OPEN_ERROR', e && (e.stack || e.message || String(e)));
    return 'ERROR';
  }
})();