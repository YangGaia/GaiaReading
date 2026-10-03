'use strict';

/**
 * 轻量分页引擎（供 TXT / MOBI / AZW3 使用）。
 *
 * 原理（与 epub.js paginated 布局一致）：
 * 内容渲染进 iframe，body 使用 CSS 多列（column-width）自动分页，
 * 每列 = 一页；翻页即横向滚动 documentElement（html）。
 *
 * 支持：
 * - 单页 / 双页 两种模式
 * - 字体、字号、行距、主题注入（切换后自动重排）
 * - 图片加载完成后自动重新测量页数
 */

class Paginator {
  /**
   * @param {HTMLElement} host 渲染宿主（reader-content）
   * @param {object} opts
   * @param {number} opts.pageWidth 单页内容宽度（px）
   * @param {number} opts.gap 列间距（px），双页时两页之间留白
   */
  constructor(host, opts) {
    this.host = host;
    this.pageWidth = opts.pageWidth || 640;
    const initialGap = Number(opts.gap);
    this.gap = Number.isFinite(initialGap) && initialGap >= 0 ? initialGap : 0;
    this.mode = 'single'; // single | spread
    this.currentPage = 0;
    this.totalPages = 1;
    this.frame = null;
    this.doc = null;
    this.onChange = null;      // 进度变化通知
    this.onTotalChange = null; // 总页数变化通知
    this.typo = { fontSizePct: 100, lineHeight: 1.8, fontFamily: '' };
    this.theme = 'light';
    this.textContrast = 'standard';
    this.pageBg = '#fffdf7';
    this.marginPct = 8;
    this.verticalMarginPx = 28;
    this.verticalPadding = 28;
    this.simplified = false;
    this._boundResize = () => this.reflow();
    this._renderVersion = 0;
    this._pendingFrame = null;
    this._pendingLoadCleanup = null;
    this._imageListeners = [];
    this._imageVersion = 0;
    this._imageReflow = null;
    this._imageStyles = new Map();
    this._illustrations = new Set();
    this._readingPosition = null;
  }

  /** 列步进宽度：下一页/上一页的滚动距离（含列间距）。 */
  get colStep() {
    return this.pageWidth + this.gap;
  }

  /** 渲染内容。html 为章节/全文 HTML 片段（不含 <html>/<body>）。 */
  async render(html, cssText, options = {}) {
    this.cancelPendingRender();
    const version = this._renderVersion;
    const frame = document.createElement('iframe');
    frame.className = 'paginator-frame paginator-pending';
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('title', '阅读内容');
    frame.style.background = this.pageBg;
    this._pendingFrame = frame;
    this.host.appendChild(frame);

    const doc = frame.contentDocument;
    let full = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    if (cssText) full += '<style id="paginator-book">' + cssText + '</style>';
    full += '<style id="paginator-base"></style>';
    full += '<style id="paginator-typo"></style>';
    full += '<style id="paginator-theme">html, body { background: ' + this.pageBg + ' !important; }</style>';
    full += '</head><body>' + (html || '') + '</body></html>';
    doc.open();
    doc.write(full);
    doc.close();

    await new Promise((resolve) => {
      if (doc.readyState === 'complete') return resolve();
      const finish = () => {
        clearTimeout(timer);
        frame.removeEventListener('load', finish);
        if (this._pendingLoadCleanup === finish) this._pendingLoadCleanup = null;
        resolve();
      };
      const timer = setTimeout(finish, 1500);
      this._pendingLoadCleanup = finish;
      frame.addEventListener('load', finish, { once: true });
    });

    if (version !== this._renderVersion || (options.isCurrent && !options.isCurrent())) {
      frame.remove();
      if (this._pendingFrame === frame) this._pendingFrame = null;
      return false;
    }
    const previousFrame = this.frame;
    const previousDoc = this.doc;
    const previousStyles = this._imageStyles;
    const previousIllustrations = this._illustrations;
    const previousPosition = this._readingPosition;
    this.clearImageListeners();
    this.frame = frame;
    this.doc = doc;
    this._imageStyles = new Map();
    this._illustrations = new Set();
    this._readingPosition = null;
    try {
      // Chapter bookkeeping joins the same synchronous commit as the iframe,
      // so a released hold cannot advance progress for an unseen chapter.
      if (options.beforeCommit) options.beforeCommit();
      if (window.GaiaChineseDisplay) window.GaiaChineseDisplay.apply(this.doc, this.simplified);
      this.applyTypography();
      this.applyTheme();
      this.applyLayout();
      // Swap only after typography, theme and pagination are ready to paint.
      frame.classList.remove('paginator-pending');
      if (previousFrame) previousFrame.remove();
      this._pendingFrame = null;
      this.waitImages();
      window.addEventListener('resize', this._boundResize);
      return true;
    } catch (error) {
      frame.remove();
      this._pendingFrame = null;
      this.frame = previousFrame;
      this.doc = previousDoc;
      this._imageStyles = previousStyles;
      this._illustrations = previousIllustrations;
      this._readingPosition = previousPosition;
      this.waitImages();
      throw error;
    }
  }

  /** 每批图片完成后重排；超时展示章节后仍继续监听迟到的资源。 */
  waitImages() {
    this.clearImageListeners();
    if (!this.doc) return;
    const doc = this.doc;
    const version = this._imageVersion;
    for (const img of doc.querySelectorAll('img, svg image')) {
      if (img.complete) continue;
      const settle = () => {
        cleanup();
        if (version !== this._imageVersion || this.doc !== doc || this._imageReflow != null) return;
        // The browser may already have moved text when load fires. Keep the
        // position recorded at the last page turn, before that layout shift.
        this._imageReflow = window.requestAnimationFrame(() => {
          this._imageReflow = null;
          if (version === this._imageVersion && this.doc === doc) this.reflow();
        });
      };
      const cleanup = () => {
        img.removeEventListener('load', settle);
        img.removeEventListener('error', settle);
      };
      img.addEventListener('load', settle);
      img.addEventListener('error', settle);
      this._imageListeners.push(cleanup);
    }
  }

  clearImageListeners() {
    this._imageVersion += 1;
    for (const cleanup of this._imageListeners) cleanup();
    this._imageListeners = [];
    if (this._imageReflow != null) window.cancelAnimationFrame(this._imageReflow);
    this._imageReflow = null;
  }

  /** 设置阅读模式：single | spread */
  setMode(mode) {
    const next = mode === 'spread' ? 'spread' : 'single';
    this.mode = next;
    this.reflow();
  }

  /** 设置排版：fontSizePct 为百分比，lineHeight，fontFamily 为 CSS 字体栈。 */
  setTypography({ fontSizePct, lineHeight, fontFamily }) {
    this.typo = {
      fontSizePct: fontSizePct == null ? this.typo.fontSizePct : fontSizePct,
      lineHeight: lineHeight == null ? this.typo.lineHeight : lineHeight,
      fontFamily: fontFamily == null ? this.typo.fontFamily : fontFamily,
    };
    if (this.doc) this.applyTypography();
    this.reflow();
  }

  /** 设置页面左右边距百分比（如 4/8/12/16），立即重新排版。 */
  setMargin(pct) {
    this.setMargins({ horizontalPct: pct });
  }

  /** Independent horizontal percentage and vertical pixel margins. */
  setMargins({ horizontalPct = this.marginPct, verticalPx = this.verticalMarginPx } = {}) {
    const margins = window.GaiaEpubTypography.normalizeMargins({ horizontalPct, verticalPx });
    this.marginPct = margins.horizontalPct;
    this.verticalMarginPx = margins.verticalPx;
    this.reflow();
  }

  setSimplified(enabled) {
    const position = this._readingPosition || (this.doc ? this.capturePosition() : null);
    this.simplified = !!enabled;
    if (this.doc && window.GaiaChineseDisplay) window.GaiaChineseDisplay.apply(this.doc, this.simplified);
    this.reflow(position);
  }

  sourceText() {
    if (!this.doc || !this.doc.body) return '';
    return window.GaiaChineseDisplay ? window.GaiaChineseDisplay.sourceText(this.doc.body) : this.doc.body.textContent || '';
  }

  pageTextRange(startPage, endPage, { source = true } = {}) {
    return window.GaiaPageTextRange.read(this.doc, {
      startPage, endPage, pageWidth: this.pageWidth, gap: this.gap, totalPages: this.totalPages,
      sourceText: source && window.GaiaChineseDisplay ? window.GaiaChineseDisplay.sourceText : undefined,
    });
  }

  /** 设置双页之间的列间距，并保持当前阅读位置。 */
  setGap(px) {
    const gap = Number(px);
    this.gap = Number.isFinite(gap) && gap >= 0 ? gap : 0;
    this.reflow();
  }

  setTheme(theme) {
    this.theme = theme;
    this.pageBg = theme === 'eye' ? '#f5ecd9' : (theme === 'dark' ? '#000000' : '#fffdf7');
    if (this.doc) this.applyTheme();
  }

  setTextContrast(value) {
    this.textContrast = window.GaiaReaderContrast.normalizeReaderTextContrast(value);
    if (this.doc) this.applyTheme();
  }

  applyTypography() {
    if (!this.doc) return;
    const s = this.doc.getElementById('paginator-typo');
    if (!s) return;
    let css = 'html { font-size: ' + (this.typo.fontSizePct / 100) + 'em !important; }';
    css += 'html, body { line-height: ' + this.typo.lineHeight + ' !important; word-break: break-word !important; overflow-wrap: break-word !important; }';
    // Avoid moving whole short paragraphs early, preserving explicit book rules.
    css += ':where(body) { widows: 1; orphans: 1; }';
    // 与 EPUB 阅读一致的排版：段落首行缩进、标题间距、行距
    css += 'p { text-indent: 2em !important; margin-top: 0 !important; margin-bottom: 0.8em !important; line-height: ' + this.typo.lineHeight + ' !important; }';
    css += 'h1, h2, h3, h4 { line-height: 1.4 !important; margin-top: 1.2em !important; margin-bottom: 0.6em !important; text-indent: 0 !important; }';
    css += 'blockquote { margin-top: 0.8em !important; margin-bottom: 0.8em !important; padding-left: 1em !important; border-left: 3px solid rgba(127,127,127,.35) !important; }';
    css += 'li { line-height: ' + this.typo.lineHeight + ' !important; margin-top: 0.2em !important; margin-bottom: 0.2em !important; }';
    if (this.typo.fontFamily) {
      css += 'html, body, p, div, span, li, a, h1, h2, h3, h4 { font-family: ' + this.typo.fontFamily + ' !important; }';
    }
    s.textContent = css;
  }

  applyTheme() {
    if (!this.doc) return;
    const s = this.doc.getElementById('paginator-theme');
    if (!s) return;
    const contrast = window.GaiaReaderContrast.normalizeReaderTextContrast(this.textContrast);
    const highContrast = contrast === window.GaiaReaderContrast.HIGH;
    const textSelectors = 'body, main, article, section, p, div, span, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, em, strong, small';
    let css = '';
    if (this.theme === 'dark') {
      css = 'html, body { background: #000 !important; }';
    } else if (this.theme === 'eye') {
      css = 'html, body { background: #f5ecd9 !important; }';
    } else {
      css = 'html { background: ' + this.pageBg + ' !important; } body { background: ' + this.pageBg + ' !important; }';
    }
    if (this.theme !== 'light' || highContrast) {
      const textColor = window.GaiaReaderContrast.readerTextColor(this.theme, contrast);
      const linkColor = window.GaiaReaderContrast.readerLinkColor(this.theme);
      css += textSelectors + ' { color: ' + textColor + ' !important; -webkit-text-fill-color: ' + textColor + ' !important; } a, a * { color: ' + linkColor + ' !important; -webkit-text-fill-color: ' + linkColor + ' !important; }';
    }
    if (highContrast) css += textSelectors + ' { opacity: 1 !important; }';
    s.textContent = css;
  }

  applyLayout(position) {
    if (!this.doc) return;
    const doc = this.doc;
    const base = doc.getElementById('paginator-base');
    if (!base) return;
    const hostW = this.host.clientWidth || 800;
    const hostH = this.host.clientHeight || 600;

    const gap = this.gap;
    const spread = this.mode === 'spread';
    // 页宽自适应阅读区：单页占满可用宽，双页两页+间距正好填满
    const pad = spread ? 0 : 24;
    const colW = spread
      ? Math.floor((hostW - gap) / 2)
      : Math.floor(hostW - pad * 2);
    this.pageWidth = Math.max(240, colW);
    const frameW = spread ? this.pageWidth * 2 + gap : this.pageWidth;

    this.frame.style.width = frameW + 'px';
    this.frame.style.height = hostH + 'px';
    this.frame.style.visibility = 'visible';

    const pagePad = Math.round(this.pageWidth * this.marginPct / 100); // 页边距按百分比随版心缩放
    this.verticalPadding = window.GaiaEpubTypography.verticalPadding(this.verticalMarginPx, hostH);
    base.textContent =
      'html, body { margin: 0; padding: 0; }' +
      'body { column-width: ' + this.pageWidth + 'px; column-gap: ' + gap + 'px; ' +
      'column-fill: auto; height: ' + hostH + 'px; padding: ' + this.verticalPadding + 'px 0; box-sizing: border-box; overflow: hidden; }';
    // 页面内容左右内边距（列内容不贴边，像真实书籍版心）
    base.textContent +=
      'body > * { margin-left: ' + pagePad + 'px !important; margin-right: ' + pagePad + 'px !important; max-width: ' + (this.pageWidth - pagePad * 2) + 'px !important; box-sizing: border-box !important; }' +
      'img, svg { max-width: 100% !important; box-sizing: border-box !important; object-fit: contain; }' +
      'body > img, body > svg { max-width: ' + (this.pageWidth - pagePad * 2) + 'px !important; }' +
      'body > a:has(> img), body > a:has(> svg) { display: block !important; }' +
      'table { max-width: ' + (this.pageWidth - pagePad * 2) + 'px; }';
    // 双页模式中间书缝：列间细线模拟书脊
    if (spread) {
      base.textContent +=
        'body { column-rule: 1px solid rgba(0,0,0,.12); }';
    }

    this.fitImages(this.pageWidth - pagePad * 2, Math.max(1, hostH - this.verticalPadding * 2));
    this.measure();
    this.restorePosition(position);
  }

  /** 从原书尺寸重新计算，避免连续缩放累积；正文中的小图保留作者尺寸。 */
  fitImages(pageWidth, pageHeight) {
    const doc = this.doc;
    const view = doc.defaultView;
    for (const [element, properties] of this._imageStyles) {
      for (const [name, value, priority] of properties) {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
    }
    this._imageStyles.clear();
    this._illustrations.clear();
    const override = (element, properties) => {
      let saved = this._imageStyles.get(element);
      if (!saved) this._imageStyles.set(element, saved = []);
      for (const [name, value] of Object.entries(properties)) {
        if (!saved.some(([key]) => key === name)) saved.push([name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
        element.style.setProperty(name, value, 'important');
      }
    };
    // SVG text belongs to the illustration. Text outside images (including
    // captions) prevents a container from being treated as an illustration.
    const pure = new Map();
    const classify = (node) => {
      if (node.nodeType === 3) return !node.textContent.trim();
      if (node.nodeType !== 1) return true;
      if (/^(IMG|svg)$/i.test(node.tagName)) return true;
      if (/^(SCRIPT|STYLE|BR)$/.test(node.tagName)) return true;
      let result = true;
      for (const child of node.childNodes) if (!classify(child)) result = false;
      pure.set(node, result);
      return result;
    };
    classify(doc.body);
    const images = Array.from(doc.querySelectorAll('img, svg')).filter((image) => {
      if (image.parentElement.closest('svg')) return false;
      for (let element = image; element && element !== doc.body; element = element.parentElement) {
        if (view.getComputedStyle(element).display === 'none') return false;
      }
      return true;
    });
    const containers = new Map();
    for (const image of images) {
      const parents = [];
      for (let parent = image.parentElement; parent && parent !== doc.body && pure.get(parent); parent = parent.parentElement) parents.push(parent);
      const top = parents[parents.length - 1];
      const standalone = image.parentElement === doc.body || (top && !['inline', 'contents'].includes(view.getComputedStyle(top).display));
      if (!standalone) continue;
      this._illustrations.add(image);
      for (const parent of parents) containers.set(parent, (containers.get(parent) || 0) + 1);
    }
    for (const [container, imageCount] of containers) override(container, {
      display: 'block', height: 'auto', 'min-height': '0', 'max-height': 'none',
      'text-indent': '0', 'line-height': '0', overflow: 'visible',
      'break-inside': imageCount === 1 ? 'avoid' : 'auto',
      'max-width': container.parentElement === doc.body ? pageWidth + 'px' : '100%', 'box-sizing': 'border-box',
    });
    const pixels = (style, names) => names.reduce((sum, name) => sum + (parseFloat(style[name]) || 0), 0);
    for (const image of images) {
      if (this._illustrations.has(image)) override(image, { display: 'block', 'break-inside': 'avoid' });
      const style = view.getComputedStyle(image);
      const svg = image.tagName.toLowerCase() === 'svg';
      const viewBox = svg && image.viewBox && image.viewBox.baseVal;
      const naturalW = svg ? ((viewBox && viewBox.width) || (image.hasAttribute('width') && image.width.baseVal.value) || parseFloat(style.width)) : image.naturalWidth;
      const naturalH = svg ? ((viewBox && viewBox.height) || (image.hasAttribute('height') && image.height.baseVal.value) || parseFloat(style.height)) : image.naturalHeight;
      if (!(naturalW > 0 && naturalH > 0)) continue;
      // Without a viewBox, changing the SVG viewport clips its coordinates
      // instead of scaling the drawing. Retain the original coordinate space.
      if (svg && !image.hasAttribute('viewBox')) image.setAttribute('viewBox', `0 0 ${naturalW} ${naturalH}`);
      const horizontal = pixels(style, ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']);
      const vertical = pixels(style, ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']);
      let availableW = pageWidth - pixels(style, ['marginLeft', 'marginRight']);
      // Direct children already use the page margins from paginator-base.
      if (image.parentElement === doc.body) availableW = pageWidth;
      let availableH = pageHeight - pixels(style, ['marginTop', 'marginBottom']);
      for (let parent = image.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
        const parentStyle = view.getComputedStyle(parent);
        const parentPadding = pixels(parentStyle, ['paddingLeft', 'paddingRight']);
        if (!['inline', 'contents'].includes(parentStyle.display) && parent.clientWidth) availableW = Math.min(availableW, parent.clientWidth - parentPadding);
        availableH -= Math.max(0, pixels(parentStyle, ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']));
      }
      const authoredW = parseFloat(style.width) || naturalW;
      const authoredH = parseFloat(style.height) || naturalH;
      const scale = Math.max(0.0001, Math.min(
        Math.max(1, authoredW - horizontal) / naturalW,
        Math.max(1, authoredH - vertical) / naturalH,
        Math.max(1, availableW - horizontal) / naturalW,
        Math.max(1, availableH - vertical - 1) / naturalH,
      ));
      override(image, {
        width: (naturalW * scale + horizontal) + 'px', height: (naturalH * scale + vertical) + 'px',
        'min-width': '0', 'min-height': '0', 'max-height': 'none',
      });
    }
  }

  measure() {
    if (!this.doc) return;
    const el = this.doc.documentElement;
    const w = el.scrollWidth || 1;
    this.totalPages = Math.max(1, Math.ceil(w / this.colStep));
    if (this.onTotalChange) this.onTotalChange(this.totalPages);
  }

  /** 显示第 page 页（0 起）。单页模式一次一页，双页模式一次两页（相邻列）。 */
  showPage(page) {
    if (!this.doc) return;
    this.currentPage = Math.max(0, Math.min(this.totalPages - 1, page));
    this._scrollTo(this.currentPage * this.colStep);
    this._readingPosition = this.capturePosition();
    if (this.onChange) this.onChange();
  }

  next(step) {
    const s = step == null ? (this.mode === 'spread' ? 2 : 1) : step;
    if (this.currentPage >= this.totalPages - 1) return false;
    this.showPage(this.currentPage + s);
    return true;
  }

  prev(step) {
    const s = step == null ? (this.mode === 'spread' ? 2 : 1) : step;
    if (this.currentPage <= 0) return false;
    this.showPage(this.currentPage - s);
    return true;
  }

  /** 当前页比例 0-100。 */
  pagePercent() {
    return this.totalPages > 1 ? ((this.currentPage + 1) / this.totalPages) * 100 : 100;
  }

  /** 同时滚动 html 与 body，兼容不同滚动容器。 */
  _scrollTo(left) {
    if (!this.doc) return;
    this.doc.documentElement.scrollLeft = left;
    if (this.doc.body) this.doc.body.scrollLeft = left;
  }

  /** 当前页顶部可见文本的全局偏移（正文 textContent 内），供书签使用。 */
  anchor() {
    if (!this.doc) return null;
    const doc = this.doc;
    const w = this.pageWidth;
    const h = this.host.clientHeight || 600;
    const xs = [Math.max(4, Math.floor(w / 2)), Math.max(4, 12), Math.max(4, w - 12)];
    for (let y = 8; y <= h; y += 12) {
      for (const x of xs) {
        let range = null;
        try { range = doc.caretRangeFromPoint(x, y); } catch (e) {}
        if (!range || !range.startContainer || range.startContainer.nodeType !== 3) continue;
        const nodeText = range.startContainer.textContent || '';
        if (range.startOffset >= nodeText.length) continue; // 行尾/节点末尾的光标不采
        let r = null;
        try { r = range.getBoundingClientRect(); } catch (e) {}
        if (!r || r.left < -2 || r.left >= w - 2 || r.top < -2) continue;
        const off = this._textOffsetOfNode(range.startContainer, range.startOffset);
        if (off >= 0) {
          const snippet = this._snippetAt(off);
          if (!snippet) continue; // 取不到文字片段就继续找下一行
          return { off, snippet };
        }
      }
    }
    return null;
  }

  /** 重排锚点既可指向文字，也可指向没有文字的插图页。 */
  capturePosition() {
    if (!this.doc) return null;
    const text = this.anchor();
    let textTop = Infinity;
    if (text) {
      const pos = this._nodeAtTextOffset(text.off);
      if (pos.node) {
        const range = this.doc.createRange();
        range.setStart(pos.node, pos.offset);
        range.setEnd(pos.node, Math.min(pos.offset + 1, pos.node.textContent.length));
        textTop = range.getBoundingClientRect().top;
      }
    }
    for (const image of this._illustrations) {
      const rect = image.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < this.pageWidth &&
          rect.bottom > 0 && rect.top < (this.host.clientHeight || 600) && rect.top <= textTop) {
        return { image, page: this.currentPage };
      }
    }
    return { text, page: this.currentPage };
  }

  restorePosition(position) {
    let page = position && Number.isFinite(position.page) ? position.page : this.currentPage;
    if (position && position.image && position.image.ownerDocument === this.doc && position.image.isConnected) {
      this._scrollTo(0);
      page = Math.floor(position.image.getBoundingClientRect().left / this.colStep);
    } else if (position && position.text) {
      const located = this.locate(position.text.off);
      if (located >= 0) page = located;
    }
    this.showPage(page);
  }



  /** 文本节点（含节点内偏移）→ 正文 textContent 全局偏移。 */
  _textOffsetOfNode(node, offsetInNode) {
    if (!this.doc) return -1;
    const walker = this.doc.createTreeWalker(this.doc.body, NodeFilter.SHOW_TEXT);
    let total = 0;
    let n;
    while ((n = walker.nextNode())) {
      const len = (n.textContent || "").length;
      if (n === node) return total + Math.min(offsetInNode || 0, len);
      total += len;
    }
    return -1;
  }

  /** 全局偏移 → { node, offset }。 */
  _nodeAtTextOffset(off) {
    if (!this.doc) return { node: null, offset: 0 };
    const walker = this.doc.createTreeWalker(this.doc.body, NodeFilter.SHOW_TEXT);
    let total = 0;
    let n = null;
    while ((n = walker.nextNode())) {
      const len = (n.textContent || "").length;
      if (off < total + len) return { node: n, offset: off - total };
      total += len;
    }
    return { node: n, offset: n ? (n.textContent || "").length : 0 };
  }

  /** 取全局偏移处的一段文字（用于书签展示/校验）。 */
  _snippetAt(off) {
    const pos = this._nodeAtTextOffset(off);
    if (!pos.node) return "";
    const text = window.GaiaChineseDisplay ? window.GaiaChineseDisplay.sourceText(pos.node) : pos.node.textContent || '';
    return String(text).slice(pos.offset, pos.offset + 24).replace(/\s+/g, " ").trim();
  }

  /** 定位到包含全局文本偏移 off 的列（页），返回页索引；失败返回 -1。 */
  locate(off) {
    if (!this.doc || off == null) return -1;
    const pos = this._nodeAtTextOffset(off);
    if (!pos.node) return -1;
    const doc = this.doc;
    this._scrollTo(0);
    let rect = null;
    try {
      const r = doc.createRange();
      const len = (pos.node.textContent || "").length;
      const start = Math.min(pos.offset, Math.max(0, len - 1));
      const end = Math.min(start + 1, len);
      if (len === 0) throw new Error("empty text");
      r.setStart(pos.node, start);
      r.setEnd(pos.node, end);
      const rects = r.getClientRects();
      if (rects && rects.length) rect = rects[0];
    } catch (e) {}
    if (!rect && pos.node.parentElement) rect = pos.node.parentElement.getBoundingClientRect();
    if (!rect) return -1;
    const page = Math.floor(rect.left / this.colStep);
    return Math.max(0, Math.min(this.totalPages - 1, page));
  }

  /** 校验全局偏移处文字是否落在当前可视页内。 */
  anchorInView(off) {
    if (!this.doc || off == null) return false;
    const pos = this._nodeAtTextOffset(off);
    if (!pos.node) return false;
    const doc = this.doc;
    this._scrollTo(this.currentPage * this.colStep);
    try {
      const r = doc.createRange();
      const len = (pos.node.textContent || '').length;
      const start = Math.min(pos.offset, Math.max(0, len - 1));
      r.setStart(pos.node, start);
      r.setEnd(pos.node, Math.min(start + 1, len));
      const rects = r.getClientRects();
      if (!rects || !rects.length) return false;
      const rect = rects[0];
      const h = this.host.clientHeight || 600;
      return rect.left >= -2 && rect.left < this.pageWidth - 2 && rect.top >= -2 && rect.top < h - 2;
    } catch (e) {
      return false;
    }
  }

  /** TXT 专用：全局偏移所在 <p> 的序号（0 起），找不到返回 -1。 */
  paragraphIndexOfTextOffset(off) {
    const pos = this._nodeAtTextOffset(off);
    if (!this.doc || !pos.node) return -1;
    let el = pos.node.parentElement;
    while (el && el.tagName !== "P") el = el.parentElement;
    if (!el) return -1;
    return Array.prototype.indexOf.call(this.doc.body.querySelectorAll("p"), el);
  }

  reflow(position = this._readingPosition) {
    this.applyLayout(position);
  }

  cancelPendingRender() {
    this._renderVersion += 1;
    // The committed chapter remains readable while a new one loads. Its
    // listeners survive a cancelled/failed turn and end at the actual swap.
    if (this._pendingLoadCleanup) this._pendingLoadCleanup();
    if (this._pendingFrame) this._pendingFrame.remove();
    this._pendingFrame = null;
  }

  destroy() {
    this.cancelPendingRender();
    this.clearImageListeners();
    window.removeEventListener('resize', this._boundResize);
    if (this.frame) {
      try {
        this.frame.remove();
      } catch {
        // 忽略
      }
    }
    this.frame = null;
    this.doc = null;
    this._imageStyles.clear();
    this._illustrations.clear();
    this._readingPosition = null;
  }
}

window.GaiaPaginator = Paginator;
