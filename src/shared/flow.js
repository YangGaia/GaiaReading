'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaFlow = factory().ReadingFlow;
  }
})(typeof self !== 'undefined' ? self : this, function () {

/**
 * 阅读流状态机（纯逻辑，无 DOM 依赖）。
 *
 * 支持两种内容组织：
 * - 单文档（TXT/滚动模式）：totalChapters = 1，章节内 page 就是全局页。
 * - 多章节（MOBI/AZW3 分页模式）：跨章节连续翻页，进度按「章序号 + 章内页比例」计算。
 */

class ReadingFlow {
  constructor({ totalChapters = 1, pagesPerChapter = [], chapterWeights = [], startChapter = 0, startPage = 0 } = {}) {
    this.totalChapters = Math.max(1, totalChapters);
    this.pagesPerChapter = pagesPerChapter; // 每章页数，未知时为 null
    this.chapterWeights = Array.isArray(chapterWeights) ? chapterWeights.map((value) => Math.max(0, Number(value) || 0)) : [];
    this.chapter = Math.max(0, Math.min(this.totalChapters - 1, startChapter));
    this.page = Math.max(0, startPage);
  }

  /** 设置某章页数（通常章节加载完成后调用）。 */
  setPages(chapterIndex, count) {
    this.pagesPerChapter[chapterIndex] = Math.max(1, count);
  }

  chapterPages(chapterIndex) {
    const n = this.pagesPerChapter[chapterIndex];
    return n == null ? null : Math.max(1, n);
  }

  /** 当前章已加载的页数；未知时返回 null。 */
  currentChapterPages() {
    return this.chapterPages(this.chapter);
  }

  /** 是否还有下一页（当前章内，或跨到下一章）。 */
  canNext() {
    const cur = this.currentChapterPages();
    if (cur == null) return this.chapter < this.totalChapters - 1;
    return this.page < cur - 1 || this.chapter < this.totalChapters - 1;
  }

  /** 是否还有上一页。 */
  canPrev() {
    return this.page > 0 || this.chapter > 0;
  }

  /**
   * 推进一页（单页模式一页，双页模式 step 页）。
   * 返回 { chapter, page, crossed }，crossed 表示跨章。
   */
  next(step = 1) {
    if (!this.canNext()) return null;
    let remaining = Math.max(1, step);
    let crossed = false;
    let cur = this.currentChapterPages();
    if (cur == null) cur = 1; // 未知页数按 1 页处理，保证可跨章
    while (remaining > 0) {
      const space = cur - 1 - this.page;
      if (space >= remaining) {
        this.page += remaining;
        remaining = 0;
      } else {
        remaining -= space + 1;
        if (this.chapter < this.totalChapters - 1) {
          this.chapter += 1;
          this.page = 0;
          crossed = true;
          const nextCur = this.chapterPages(this.chapter);
          if (nextCur == null) {
            // 下一章页数未知：只落在其第 0 页，避免 step>1 时跳过整章
            cur = 1;
            remaining = 0;
          } else {
            cur = nextCur;
          }
        } else {
          this.page = Math.max(0, cur - 1);
          remaining = 0;
        }
      }
    }
    return { chapter: this.chapter, page: this.page, crossed };
  }

  /**
   * 后退一页（双页模式 step 页）。
   * 返回 { chapter, page, crossed }。
   */
  prev(step = 1) {
    if (!this.canPrev()) return null;
    let remaining = Math.max(1, step);
    let crossed = false;
    while (remaining > 0) {
      if (this.page > 0) {
        const back = Math.min(this.page, remaining);
        this.page -= back;
        remaining -= back;
      } else if (this.chapter > 0) {
        this.chapter -= 1;
        crossed = true;
        const cur = this.chapterPages(this.chapter);
        if (cur == null) {
          // 上一章页数未知：只落在其第 0 页，避免 step>1 时跳过整章
          this.page = 0;
          remaining = 0;
        } else {
          this.page = Math.max(0, cur - 1);
          remaining -= 1;
        }
      } else {
        remaining = 0;
      }
    }
    return { chapter: this.chapter, page: this.page, crossed };
  }

  /** 跳到指定章首页。 */
  gotoChapter(chapterIndex) {
    this.chapter = Math.max(0, Math.min(this.totalChapters - 1, chapterIndex));
    this.page = 0;
    return { chapter: this.chapter, page: this.page };
  }

  /** 全局页序（单文档时等于 page；多章节时累计）。未知页数按已加载估算。 */
  globalPage() {
    let acc = 0;
    for (let i = 0; i < this.chapter; i++) {
      const n = this.chapterPages(i);
      acc += n == null ? 0 : n;
    }
    return acc + this.page;
  }

  /** 已加载章节的平均页数，供尚未打开的章节估算使用。 */
  averageKnownPages() {
    let known = 0;
    let sum = 0;
    for (let i = 0; i < this.totalChapters; i++) {
      const n = this.chapterPages(i);
      if (n != null) {
        known += 1;
        sum += n;
      }
    }
    return known ? sum / known : Math.max(1, this.page + 1);
  }

  estimatedChapterPages(chapterIndex) {
    const known = this.chapterPages(chapterIndex);
    return known == null ? this.averageKnownPages() : known;
  }

  /** 包含未知章节估算值的当前全局页下标。 */
  estimatedGlobalPage() {
    let acc = 0;
    for (let i = 0; i < this.chapter; i++) acc += this.estimatedChapterPages(i);
    return acc + this.page;
  }

  /** 总页数估算：已知章节累加，未知章节按已加载章节平均估。 */
  estimatedTotalPages() {
    let total = 0;
    for (let i = 0; i < this.totalChapters; i++) total += this.estimatedChapterPages(i);
    return total;
  }

  hasChapterWeights() {
    return this.chapterWeights.length >= this.totalChapters &&
      this.chapterWeights.slice(0, this.totalChapters).every((value) => value > 0);
  }

  weightedPercent() {
    const totalWeight = this.chapterWeights.slice(0, this.totalChapters).reduce((sum, value) => sum + value, 0);
    if (!totalWeight) return 0;
    let completedWeight = 0;
    for (let i = 0; i < this.chapter; i++) completedWeight += this.chapterWeights[i];
    const pages = this.currentChapterPages();
    const chapterFraction = pages == null ? 0 : Math.min(1, (this.page + 1) / pages);
    completedWeight += this.chapterWeights[this.chapter] * chapterFraction;
    return Math.min(100, (completedWeight / totalWeight) * 100);
  }

  /** 阅读进度 0-100。 */
  percent() {
    if (this.totalChapters === 1) {
      const n = this.currentChapterPages();
      if (n == null) return 0;
      return Math.min(100, ((this.page + 1) / n) * 100);
    }
    if (this.hasChapterWeights()) return this.weightedPercent();
    const total = this.estimatedTotalPages();
    if (total <= 1) return 100;
    return Math.min(100, (this.estimatedGlobalPage() / (total - 1)) * 100);
  }
}

return { ReadingFlow };
});
