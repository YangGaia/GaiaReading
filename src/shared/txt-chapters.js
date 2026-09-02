'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaTxtChapters = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHAPTER_RE = /^(?:正文\s*)?(?:第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章节回卷部篇集]|(?:Chapter|Part|Book)\s+[0-9IVXLCDMivxlcdm]+|序章|序言|楔子|引子|尾声|终章|后记|番外|[卷部篇]\s*[0-9零〇一二三四五六七八九十百千万两]+|(?:[0-9]{1,4}|[零〇一二三四五六七八九十百千万两]{1,8})[、.．]\s*\S+)/i;

  function isChapterTitle(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 80) return false;
    return CHAPTER_RE.test(text.split('\n')[0].trim());
  }

  /**
   * 与 txt-html 的分段规则保持一致：
   * - 有空行：空行分段，段内单个换行保留
   * - 没有空行：每一行单独成段
   * - \r\n / \r 统一为 \n
   * 返回段落数组，段内多行以 \n 连接。
   */
  function splitTxtParagraphs(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const hasBlankLines = /\n\s*\n/.test(normalized);
    if (hasBlankLines) {
      const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      return blocks.map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'));
    }
    return normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  /** 识别常见章节标题（“第一章/第X回/Chapter X/序章/楔子”等），返回 [{ title, paraIndex }]。 */
  function detectTxtChapters(paragraphs) {
    const chapters = [];
    for (let i = 0; i < (paragraphs || []).length; i++) {
      const t = String(paragraphs[i] || '').trim();
      if (!t || t.length > 40) continue;
      const firstLine = t.split('\n')[0].trim();
      if (isChapterTitle(firstLine)) chapters.push({ title: firstLine, paraIndex: i });
    }
    return chapters;
  }

  /** 段落序号属于第几个识别出的章节（0 起），未命中返回 -1。 */
  function chapterAt(chapters, paraIndex) {
    let idx = -1;
    for (let i = 0; i < (chapters || []).length; i++) {
      if (chapters[i].paraIndex <= paraIndex) idx = i;
      else break;
    }
    return idx;
  }

  /** 段落所在章节标题；未命中返回 null。 */
  function chapterTitleForParagraph(chapters, paraIndex) {
    const idx = chapterAt(chapters, paraIndex);
    return idx >= 0 ? chapters[idx].title : null;
  }

  /** 段落 + 段内字符 → 全局字符偏移（段落按顺序拼接，不含分隔符）。 */
  function paragraphCharOffset(paragraphs, paraIndex, charInPara) {
    let off = 0;
    for (let i = 0; i < paraIndex; i++) off += String(paragraphs[i] || '').length;
    return off + Math.max(0, charInPara || 0);
  }

  /** 全局字符偏移 → { paraIndex, charInPara }。 */
  function paragraphForCharOffset(paragraphs, off) {
    const list = paragraphs || [];
    let remaining = Math.max(0, off || 0);
    for (let i = 0; i < list.length; i++) {
      const len = String(list[i] || '').length;
      if (remaining <= len) return { paraIndex: i, charInPara: remaining };
      remaining -= len;
    }
    if (list.length === 0) return { paraIndex: 0, charInPara: 0 };
    return { paraIndex: list.length - 1, charInPara: String(list[list.length - 1]).length };
  }

  return { splitTxtParagraphs, detectTxtChapters, isChapterTitle, chapterAt, chapterTitleForParagraph, paragraphCharOffset, paragraphForCharOffset };
});
