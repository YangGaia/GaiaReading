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
    this.gap = opts.gap || 40;
    this.mode = 'single'; // single | spread
    this.currentPage = 0;
    this.totalPages = 1;
    this.frame = null;
    this.doc = null;
    this.onChange = null;      // 进度变化通知
    this.onTotalChange = null; // 总页数变化通知
    this.typo = { fontSizePct: 100, lineHeight: 1.8, fontFamily: '' };
    this.theme = 'light';
    this.pageBg = '#fffdf7';
    this.marginPct = 8;
    this._boundResize = () => this.reflow();
  }

  /** 列步进宽度：下一页/上一页的滚动距离（含列间距）。 */
  get colStep() {
    return this.pageWidth + this.gap;
  }

  /** 渲染内容。html 为章节/全文 HTML 片段（不含 <html>/<body>）。 */
  async render(html, cssText) {
    this.destroy();
    const frame = document.createElement('iframe');
    frame.className = 'paginator-frame';
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('title', '阅读内容');
    this.frame = frame;
    this.host.appendChild(frame);

    const doc = frame.contentDocument;
    this.doc = doc;
    let full = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    if (cssText) full += '<style id="paginator-book">' + cssText + '</style>';
    full += '<style id="paginator-base"></style>';
    full += '<style id="paginator-typo"></style>';
    full += '<style id="paginator-theme"></style>';
    full += '</head><body>' + (html || '') + '</body></html>';
    doc.open();
    doc.write(full);
    doc.close();

    await new Promise((resolve) => {
      if (doc.readyState === 'complete') return resolve();
      frame.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 1500);
    });

    this.applyTypography();
    this.applyTheme();
    this.applyLayout();
    this.waitImages();
    window.addEventListener('resize', this._boundResize);
  }

  /** 等待图片加载完成后重排（保证页数准确）。 */
  waitImages() {
    if (!this.doc) return;
    const imgs = Array.from(this.doc.images || []);
    if (!imgs.length) return;
    let pending = imgs.length;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.reflow();
    };
    const check = () => {
      pending -= 1;
      if (pending <= 0) finish();
    };
    for (const img of imgs) {
      if (img.complete) check();
      else {
        img.addEventListener('load', check, { once: true });
        img.addEventListener('error', check, { once: true });
      }
    }
    setTimeout(finish, 2500);
  }

  /** 设置阅读模式：single | spread */
  setMode(mode) {
    const next = mode === 'spread' ? 'spread' : 'single';
    if (next === this.mode) {
      this.applyLayout();
      return;
    }
    this.mode = next;
    this.currentPage = 0;
    this.applyLayout();
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
    this.marginPct = typeof pct === 'number' && pct >= 0 ? pct : 8;
    if (this.doc) this.applyLayout();
  }

  setTheme(theme) {
    this.theme = theme;
    this.pageBg = theme === 'eye' ? '#f7efdd' : (theme === 'dark' ? '#000000' : '#fffdf7');
    if (this.doc) this.applyTheme();
  }

  applyTypography() {
    if (!this.doc) return;
    const s = this.doc.getElementById('paginator-typo');
    if (!s) return;
    let css = 'html { font-size: ' + (this.typo.fontSizePct / 100) + 'em !important; }';
    css += 'html, body { line-height: ' + this.typo.lineHeight + ' !important; word-break: break-word !important; overflow-wrap: break-word !important; }';
    // 与 EPUB 阅读一致的排版：段落首行缩进、标题间距、行距
    css += 'p { text-indent: 2em !important; margin-top: 0 !important; margin-bottom: 0.8em !important; line-height: ' + this.typo.lineHeight + ' !important; }';
    css += 'h1, h2, h3, h4 { line-height: 1.4 !important; margin-top: 1.2em !important; margin-bottom: 0.6em !important; text-indent: 0 !important; }';
    css += 'blockquote { margin-top: 0.8em !important; margin-bottom: 0.8em !important; padding-left: 1em !important; border-left: 3px solid rgba(127,127,127,.35) !important; }';
    css += 'li { line-height: ' + this.typo.lineHeight + ' !important; margin-top: 0.2em !important; margin-bottom: 0.2em !important; }';
    css += 'img { max-width: 100% !important; height: auto !important; }';
    if (this.typo.fontFamily) {
      css += 'html, body, p, div, span, li, a, h1, h2, h3, h4 { font-family: ' + this.typo.fontFamily + ' !important; }';
    }
    s.textContent = css;
  }

  applyTheme() {
    if (!this.doc) return;
    const s = this.doc.getElementById('paginator-theme');
    if (!s) return;
    let css = '';
    if (this.theme === 'dark') {
      css = 'html, body { background: #000 !important; } body { color: #e6edf3 !important; } p, div, span, li, h1, h2, h3, h4, td, blockquote { color: #e6edf3 !important; } a { color: #58a6ff !important; }';
    } else if (this.theme === 'eye') {
      css = 'html, body { background: #f5ecd9 !important; } body { color: #4a3826 !important; } p, div, span, li, h1, h2, h3, h4, td, blockquote { color: #4a3826 !important; } a { color: #8a6d3b !important; }';
    } else {
      css = 'html { background: ' + this.pageBg + ' !important; } body { background: ' + this.pageBg + ' !important; }';
    }
    s.textContent = css;
  }

  applyLayout() {
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

    const pagePad = Math.max(12, Math.round(this.pageWidth * this.marginPct / 100)); // 页边距按百分比随版心缩放
    base.textContent =
      'html, body { margin: 0; padding: 0; }' +
      'body { column-width: ' + this.pageWidth + 'px; column-gap: ' + gap + 'px; ' +
      'height: ' + hostH + 'px; overflow: hidden; }';
    // 页面内容左右内边距（列内容不贴边，像真实书籍版心）
    base.textContent +=
      'body > * { margin-left: ' + pagePad + 'px !important; margin-right: ' + pagePad + 'px !important; }' +
      'img { max-width: ' + (this.pageWidth - pagePad * 2) + 'px !important; height: auto; }' +
      'table { max-width: ' + (this.pageWidth - pagePad * 2) + 'px; }';
    // 双页模式中间书缝：列间细线模拟书脊
    if (spread) {
      base.textContent +=
        'body { column-rule: 1px solid rgba(0,0,0,.12); }';
    }

    this.measure();
    this.showPage(this.currentPage);
  }

  measure() {
    if (!this.doc) return;
    const el = this.doc.documentElement;
    const w = el.scrollWidth || 1;
    this.totalPages = Math.max(1, Math.ceil(w / this.colStep));
    if (this.onTotalChange) this.onTotalChange(this.totalPages);
    if (this.onChange) this.onChange();
  }

  /** 显示第 page 页（0 起）。单页模式一次一页，双页模式一次两页（相邻列）。 */
  showPage(page) {
    if (!this.doc) return;
    this.currentPage = Math.max(0, Math.min(this.totalPages - 1, page));
    const el = this.doc.documentElement;
    this._scrollTo(this.currentPage * this.colStep);
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
        let r = null;
        try { r = range.getBoundingClientRect(); } catch (e) {}
        if (!r || r.left < -2 || r.left >= w - 2 || r.top < -2) continue;
        const off = this._textOffsetOfNode(range.startContainer, range.startOffset);
        if (off >= 0) return { off, snippet: this._snippetAt(off) };
      }
    }
    return null;
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
    return String(pos.node.textContent || "").slice(pos.offset, pos.offset + 24).replace(/\s+/g, " ").trim();
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

  reflow() {
    this.applyLayout();
  }

  destroy() {
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
  }
}

window.GaiaPaginator = Paginator;