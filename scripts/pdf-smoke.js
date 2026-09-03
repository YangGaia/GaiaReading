(async () => {
  try {
    await __gaiaDebug.waitHome();
    await __gaiaDebug.openBook({ path: window.__PDF_SMOKE_PATH, format: 'pdf', title: 'pdf-fixture' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const single = __gaiaDebug.getReaderLayoutState();
    const singleFits = single.pdfVisiblePages.join(',') === '1' && single.pdfZoomMode === 'fit-page' &&
      single.pdfStageWidth <= single.readerWidth && single.pdfStageHeight <= single.readerHeight;

    __gaiaDebug.setMode('spread');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const oddSpread = __gaiaDebug.getReaderLayoutState();
    const oddSpreadFits = oddSpread.pdfVisiblePages.join(',') === '1,2' && oddSpread.pdfPairing === 'odd-first' &&
      oddSpread.pdfStageWidth <= oddSpread.readerWidth && oddSpread.pdfStageHeight <= oddSpread.readerHeight;

    await __gaiaDebug.nextPage();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const nextSpread = __gaiaDebug.getReaderLayoutState();
    __gaiaDebug.togglePdfPairing();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const evenSpread = __gaiaDebug.getReaderLayoutState();
    const pairingWorks = nextSpread.pdfVisiblePages.join(',') === '3,4' && evenSpread.pdfVisiblePages.join(',') === '2,3' &&
      evenSpread.pdfPairing === 'even-first';

    __gaiaDebug.cyclePdfZoomMode();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const fitWidth = __gaiaDebug.getReaderLayoutState();
    __gaiaDebug.cyclePdfZoomMode();
    await new Promise((resolve) => setTimeout(resolve, 200));
    __gaiaDebug.setPdfZoom(0.1);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const manual = __gaiaDebug.getReaderLayoutState();
    const zoomModesWork = fitWidth.pdfZoomMode === 'fit-width' && manual.pdfZoomMode === 'manual' && Math.abs(manual.pdfScale - 0.1) < 0.001;

    __gaiaDebug.cyclePdfZoomMode();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const searchRun = await __gaiaDebug.runBookSearch('PDF TEST PAGE 3');
    const searchActivated = await __gaiaDebug.activateBookSearchResult(0);
    const searchLayout = __gaiaDebug.getReaderLayoutState();
    const searchWorks = searchRun.results > 0 && searchActivated.highlightCount > 0 && searchLayout.pdfVisiblePages.includes(3);
    return JSON.stringify({ singleFits, oddSpreadFits, pairingWorks, zoomModesWork, searchWorks, single, oddSpread, nextSpread, evenSpread, fitWidth, manual, searchRun, searchActivated, searchLayout });
  } catch (error) {
    console.error('PDF_SMOKE_ERROR', error && (error.stack || error.message || String(error)));
    return 'ERROR';
  }
})();
