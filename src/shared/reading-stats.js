(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaReadingStats = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_GOAL_MINUTES = 30;

  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function createReadingStats(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      version: 1,
      goalMinutes: [15, 30, 45, 60].includes(Number(source.goalMinutes)) ? Number(source.goalMinutes) : DEFAULT_GOAL_MINUTES,
      days: source.days && typeof source.days === 'object' ? Object.assign({}, source.days) : {},
      completedBooks: source.completedBooks && typeof source.completedBooks === 'object' ? Object.assign({}, source.completedBooks) : {},
    };
  }

  function setGoalMinutes(stats, minutes) {
    const next = createReadingStats(stats);
    const value = Number(minutes);
    if ([15, 30, 45, 60].includes(value)) next.goalMinutes = value;
    return next;
  }

  function addReadingTime(stats, entry) {
    const next = createReadingStats(stats);
    const data = entry || {};
    const at = Number(data.at) || Date.now();
    const ms = Math.max(0, Math.min(Number(data.ms) || 0, 60 * 1000));
    if (!ms) return next;
    const key = dateKey(at);
    const oldDay = next.days[key] && typeof next.days[key] === 'object' ? next.days[key] : {};
    const byBook = Object.assign({}, oldDay.byBook || {});
    const book = data.book || {};
    const path = String(book.path || 'unknown');
    byBook[path] = (Number(byBook[path]) || 0) + ms;
    next.days[key] = { ms: (Number(oldDay.ms) || 0) + ms, byBook, lastReadAt: at };

    if (Number(data.percent) >= 99.5 && book.path && !next.completedBooks[path]) {
      next.completedBooks[path] = {
        path,
        title: String(book.title || '未命名图书'),
        cover: book.cover || '',
        finishedAt: at,
      };
    }
    return next;
  }

  function startOfDay(value) {
    const date = new Date(value == null ? Date.now() : value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function streaks(days, now) {
    const read = new Set(Object.keys(days || {}).filter((key) => Number(days[key] && days[key].ms) > 0));
    const sorted = Array.from(read).sort();
    let longest = 0;
    let run = 0;
    let previous = null;
    for (const key of sorted) {
      const current = startOfDay(key);
      if (previous && current.getTime() - previous.getTime() === 86400000) run += 1;
      else run = 1;
      longest = Math.max(longest, run);
      previous = current;
    }

    const cursor = startOfDay(now);
    if (!read.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let current = 0;
    while (read.has(dateKey(cursor))) {
      current += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return { current, longest };
  }

  function buildReadingSummary(stats, now) {
    const data = createReadingStats(stats);
    const today = startOfDay(now);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const labels = ['一', '二', '三', '四', '五', '六', '日'];
    const week = labels.map((label, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const key = dateKey(date);
      return { key, label, ms: Number(data.days[key] && data.days[key].ms) || 0, isToday: key === dateKey(today) };
    });
    const year = today.getFullYear();
    const completedBooks = Object.values(data.completedBooks)
      .filter((book) => new Date(book.finishedAt).getFullYear() === year)
      .sort((a, b) => b.finishedAt - a.finishedAt);
    const streak = streaks(data.days, today);
    return {
      todayKey: dateKey(today),
      todayMs: Number(data.days[dateKey(today)] && data.days[dateKey(today)].ms) || 0,
      goalMinutes: data.goalMinutes,
      goalMs: data.goalMinutes * 60000,
      week,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      completedBooks,
      completedThisYear: completedBooks.length,
    };
  }

  function formatDuration(ms) {
    const totalMinutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours) return hours + '小时' + (minutes ? minutes + '分钟' : '');
    return totalMinutes + '分钟';
  }

  return { DEFAULT_GOAL_MINUTES, dateKey, createReadingStats, setGoalMinutes, addReadingTime, buildReadingSummary, formatDuration };
});
