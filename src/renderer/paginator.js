'use strict';

/**
 * 轻量分页引擎（供 TXT / MOBI / AZW3 使用）。
 *
 * 原理：把内容渲染进隐藏 iframe，通过 CSS 多列（column-width）自动分页，
 * 每列 = 一页，翻页即横向滚动 body。支持：
 * - 单页 / 双页 / 滚动 三种模式
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
    this.pageWidth = opts.pageWidth || 720;
    this.gap = opts.gap || 48;
    this.mode = 'single'; // single | spread | scroll
    this.currentPage = 0;
    this.totalPages = 1;
    this.scrollTop = 0;
    this.frame = null;
    this.doc = null;
    this.onChange = null; // 回调：进度变化时通知
    this.onTotalChange = null; // 回调：总页数变化时通知
    this.typo = { fontSizePct: 100, lineHeight: 1.8, fontFamily: '' };
    this.theme = 'light';
    this._boundResize = () => this.reflow();
  }

  /** 渲染内容。html 为章节/全文 HTML 片段（不含 <html>/<body>）。 */
  async render(html, cssText) {
    this.destroy();
    const frame = document.createElement('iframe');
    frame.className = 'paginator-frame';
    frame.setAttribute('scrolling', 'no');
    this.frame = frame;
    this.host.appendChild(frame);

    const doc = frame.contentDocument;
    this.doc = doc;
    let full = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    if (cssText) full += '<style>' + cssText + '</style>';
    full += '<style id="paginator-base"></style>';
    full += '</head><body>' + (html || '') + '</body></html>';
    doc.open();
    doc.write(full);
    doc.close();

    await new Promise((resolve) => {
      if (doc.readyState === 'complete') return resolve();
      frame.addEventListener('load', () => resolve(), { once: true });
      // 兜底：内容不触发 load 时
      setTimeout(resolve, 1500);
    });

    this.applyTypography();
    this.applyTheme();
    this.reflow();
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

  /** 设置阅读模式：single | spread | scroll */
  setMode(mode) {
    this.mode = mode === 'spread' || mode === 'scroll' ? mode : 'single';
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

  setTheme(theme) {
    this.theme = theme;
    if (this.doc) this.applyTheme();
  }

  applyTypography() {
    if (!this.doc) return;
    const style = this.doc.getElementById('paginator-typo');
    if (style) style.remove();
    const s = this.doc.createElement('style');
    s.id = 'paginator-typo';
    let css = 'html, body { font-size: ' + (this.typo.fontSizePct / 100) + 'em !important; }';
    css += 'body, p, div, span, li { line-height: ' + this.typo.lineHeight + ' !important; }';
    if (this.typo.fontFamily) css += 'body, p, div, span, li { font-family: ' + this.typo.fontFamily + ' !important; }';
    s.textContent = css;
    (this.doc.head || this.doc.documentElement).appendChild(s);
  }

  applyTheme() {
    if (!this.doc) return;
    const style = this.doc.getElementById('paginator-theme');
    if (style) style.remove();
    const s = this.doc.createElement('style');
    s.id = 'paginator-theme';
    let css = '';
    if (this.theme === 'dark') {
      css = 'html, body { background: #000 !important; } body { color: #e6edf3 !important; } p, div, span, li, h1, h2, h3, h4, td, blockquote { color: #e6edf3 !important; } a { color: #58a6ff !important; }';
    } else if (this.theme === 'eye') {
      css = 'html, body { background: #f5ecd9 !important; } body { color: #4a3826 !important; } p, div, span, li, h1, h2, h3, h4, td, blockquote { color: #4a3826 !important; } a { color: #8a6d3b !important; }';
    }
    s.textContent = css;
    (this.doc.head || this.doc.documentElement).appendChild(s);
  }

  applyLayout() {
    if (!this.doc) return;
    const body = this.doc.body;
    const base = this.doc.getElementById('paginator-base');
    if (!base) return;
    if (this.mode === 'scroll') {
      base.textContent = 'html, body { margin: 0; padding: 0; } body { column-width: auto !important; column-gap: 0 !important; height: 100% !important; overflow-y: auto !important; }';
      this.frame.style.width = '100%';
      this.frame.style.height = this.host.clientHeight + 'px';
      return;
    }
    const spread = this.mode === 'spread';
    const colW = this.pageWidth;
    const gap = this.gap;
    const frameW = spread ? colW * 2 + gap : colW;
    const frameH = this.host.clientHeight || 600;
    this.frame.style.width = frameW + 'px';
    this.frame.style.height = frameH + 'px';
    base.textContent =
      'html, body { margin: 0; padding: 0; } ' +
      'body { column-width: ' + colW + 'px; column-gap: ' + gap + 'px; ' +
      'height: ' + frameH + 'px; overflow: hidden; }';
    this.measure();
    this.showPage(this.currentPage);
  }

  measure() {
    if (!this.doc || this.mode === 'scroll') return;
    const body = this.doc.body;
    const colW = this.pageWidth + this.gap;
    const w = body.scrollWidth;
    this.totalPages = Math.max(1, Math.ceil(w / colW));
    if (this.onTotalChange) this.onTotalChange(this.totalPages);
    if (this.onChange) this.onChange();
  }

  /** 显示第 page 页（0 起）。 */
  showPage(page) {
    if (!this.doc || this.mode === 'scroll') return;
    this.currentPage = Math.max(0, Math.min(this.totalPages - 1, page));
    const body = this.doc.body;
    const step = this.mode === 'spread' ? (this.pageWidth + this.gap) * 2 : this.pageWidth + this.gap;
    body.scrollLeft = this.currentPage * step;
    if (this.onChange) this.onChange();
  }

  next(step) {
    if (this.mode === 'scroll') {
      if (this.frame && this.frame.contentDocument) {
        const body = this.frame.contentDocument.body;
        const max = body.scrollHeight - this.frame.clientHeight;
        if (body.scrollTop < max) {
          body.scrollTop += (this.frame.clientHeight || 600) * 0.92;
          if (this.onChange) this.onChange();
          return true;
        }
      }
      return false;
    }
    const s = step == null ? (this.mode === 'spread' ? 2 : 1) : step;
    if (this.currentPage >= this.totalPages - 1) return false;
    this.showPage(this.currentPage + s);
    return true;
  }

  prev(step) {
    if (this.mode === 'scroll') {
      if (this.frame && this.frame.contentDocument) {
        const body = this.frame.contentDocument.body;
        if (body.scrollTop > 0) {
          body.scrollTop -= (this.frame.clientHeight || 600) * 0.92;
          if (this.onChange) this.onChange();
          return true;
        }
      }
      return false;
    }
    const s = step == null ? (this.mode === 'spread' ? 2 : 1) : step;
    if (this.currentPage <= 0) return false;
    this.showPage(this.currentPage - s);
    return true;
  }

  /** 当前滚动模式下内部滚动比例 0-100。 */
  scrollPercent() {
    if (this.mode !== 'scroll' || !this.frame || !this.frame.contentDocument) return 0;
    const body = this.frame.contentDocument.body;
    const max = body.scrollHeight - this.frame.clientHeight;
    return max > 0 ? (body.scrollTop / max) * 100 : 0;
  }

  /** 分页模式下当前页比例 0-100。 */
  pagePercent() {
    if (this.mode === 'scroll') return this.scrollPercent();
    return this.totalPages > 1 ? ((this.currentPage + 1) / this.totalPages) * 100 : 100;
  }

  /** 滚动模式下读取/设置内部滚动位置。 */
  getScrollTop() {
    return this.frame && this.frame.contentDocument ? this.frame.contentDocument.body.scrollTop : 0;
  }

  setScrollTop(v) {
    if (this.frame && this.frame.contentDocument) {
      this.frame.contentDocument.body.scrollTop = v;
      if (this.onChange) this.onChange();
    }
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
