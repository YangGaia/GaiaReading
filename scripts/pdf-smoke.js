(async () => {
  const committedStage = () => document.querySelector('#reader-content > .pdf-spread:not(.is-preparing)');
  const pendingStages = () => document.querySelectorAll('#reader-content > .pdf-spread.is-preparing').length;
  const waitForRender = async (phase, predicate, previousStage) => {
    const deadline = performance.now() + 10000;
    let layout;
    while (performance.now() < deadline) {
      layout = __gaiaDebug.getReaderLayoutState();
      const stage = committedStage();
      // Mode fields change before the asynchronous canvas/text render commits.
      // Require the new painted stage as well as its expected observable layout.
      if (stage && stage !== previousStage && !pendingStages() && !pdfZoomRuntime.timer && predicate(layout)) return layout;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('PDF render timed out: ' + phase + ' ' + JSON.stringify({
      layout,
      pendingStages: pendingStages(),
      zoomTimerPending: !!pdfZoomRuntime.timer,
      renderVersion: state.current && state.current.pdfRenderVersion,
      stageReplaced: committedStage() !== previousStage,
    }));
  };
  const fitsPage = (layout) => layout.pdfStageWidth > 0 && layout.pdfStageHeight > 0 &&
    layout.pdfStageWidth <= layout.readerWidth && layout.pdfStageHeight <= layout.readerHeight;
  try {
    await __gaiaDebug.waitHome();
    await __gaiaDebug.openBook({ path: window.__PDF_SMOKE_PATH, format: 'pdf', title: 'pdf-fixture' });
    const single = await waitForRender('single page', (layout) => layout.pdfVisiblePages.join(',') === '1' &&
      layout.pdfZoomMode === 'fit-page' && fitsPage(layout));
    const singleFits = single.pdfVisiblePages.join(',') === '1' && single.pdfZoomMode === 'fit-page' &&
      fitsPage(single);

    let previousStage = committedStage();
    __gaiaDebug.setMode('spread');
    const oddSpread = await waitForRender('odd spread', (layout) => layout.pdfVisiblePages.join(',') === '1,2' &&
      layout.pdfPairing === 'odd-first' && fitsPage(layout), previousStage);
    const oddSpreadFits = oddSpread.pdfVisiblePages.join(',') === '1,2' && oddSpread.pdfPairing === 'odd-first' &&
      fitsPage(oddSpread);

    previousStage = committedStage();
    await __gaiaDebug.nextPage();
    const nextSpread = await waitForRender('next spread', (layout) => layout.pdfVisiblePages.join(',') === '3,4', previousStage);
    previousStage = committedStage();
    __gaiaDebug.togglePdfPairing();
    const evenSpread = await waitForRender('even spread', (layout) => layout.pdfVisiblePages.join(',') === '2,3' &&
      layout.pdfPairing === 'even-first', previousStage);
    const pairingWorks = nextSpread.pdfVisiblePages.join(',') === '3,4' && evenSpread.pdfVisiblePages.join(',') === '2,3' &&
      evenSpread.pdfPairing === 'even-first';

    previousStage = committedStage();
    __gaiaDebug.cyclePdfZoomMode();
    const fitWidth = await waitForRender('fit width', (layout) => layout.pdfZoomMode === 'fit-width' &&
      layout.pdfScale > evenSpread.pdfScale && layout.pdfStageWidth > evenSpread.pdfStageWidth, previousStage);
    previousStage = committedStage();
    __gaiaDebug.cyclePdfZoomMode();
    const manualDefault = await waitForRender('manual 100%', (layout) => layout.pdfZoomMode === 'manual' &&
      Math.abs(layout.pdfScale - 1) < 0.001, previousStage);
    previousStage = committedStage();
    __gaiaDebug.setPdfZoom(0.1);
    const manual = await waitForRender('manual 10%', (layout) => layout.pdfZoomMode === 'manual' &&
      Math.abs(layout.pdfScale - 0.1) < 0.001 && layout.pdfStageWidth < manualDefault.pdfStageWidth, previousStage);
    const zoomModesWork = fitWidth.pdfZoomMode === 'fit-width' && fitWidth.pdfScale > evenSpread.pdfScale &&
      fitWidth.pdfStageWidth > evenSpread.pdfStageWidth && manual.pdfZoomMode === 'manual' &&
      Math.abs(manualDefault.pdfScale - 1) < 0.001 && Math.abs(manual.pdfScale - 0.1) < 0.001 &&
      manual.pdfStageWidth < manualDefault.pdfStageWidth;

    previousStage = committedStage();
    __gaiaDebug.cyclePdfZoomMode();
    await waitForRender('restore fit page', (layout) => layout.pdfZoomMode === 'fit-page' && fitsPage(layout), previousStage);
    const searchRun = await __gaiaDebug.runBookSearch('PDF TEST PAGE 3');
    const searchActivated = await __gaiaDebug.activateBookSearchResult(0);
    const searchLayout = await waitForRender('search result', (layout) => layout.pdfVisiblePages.includes(3) && fitsPage(layout));
    const searchWorks = searchRun.results > 0 && searchActivated.highlightCount > 0 && searchLayout.pdfVisiblePages.includes(3);
    return JSON.stringify({ singleFits, oddSpreadFits, pairingWorks, zoomModesWork, searchWorks, single, oddSpread, nextSpread, evenSpread, fitWidth, manualDefault, manual, searchRun, searchActivated, searchLayout });
  } catch (error) {
    console.error('PDF_SMOKE_ERROR', error && (error.stack || error.message || String(error)));
    return 'ERROR';
  }
})();
