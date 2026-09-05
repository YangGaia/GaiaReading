(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaStatsPresentation = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A display of recorded duration, never a second timer or a source of reading data.
  function clockReading(ms, goalMs) {
    const elapsed = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
    const totalSeconds = Math.floor(elapsed / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;
    const progress = goalMs > 0 ? Math.min(1, elapsed / goalMs) : 0;
    return {
      text: [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':'),
      label: hours + '小时' + minutes + '分钟' + seconds + '秒',
      // A 60-minute stopwatch dial; full hours remain in the numeric readout.
      minuteAngle: (totalSeconds % 3600) / 10,
      secondAngle: seconds * 6,
      progress,
      // Reserve 100% for actually meeting the goal, even in its last few seconds.
      percent: Math.floor(progress * 100),
    };
  }

  function createRenderer(root, { formatDuration, readingCompanionLine }) {
    const doc = root.ownerDocument;
    const get = (id) => root.querySelector('#' + id);
    const el = Object.fromEntries([
      'stats-today', 'stats-date', 'stats-goal-copy', 'stats-goal-status', 'stats-ring',
      'stats-ring-percent', 'stats-clock-progress', 'stats-clock-minute',
      'stats-clock-second', 'stats-clock-ticks', 'stats-alice-line', 'stats-current-streak',
      'stats-longest-streak', 'stats-week-total', 'stats-week-chart', 'stats-goal-options',
      'stats-finished-count', 'stats-finished-books',
    ].map((id) => [id, get(id)]));
    let lastWeek = '';
    let lastBooks = '';
    const text = (id, value) => {
      if (el[id].textContent !== value) el[id].textContent = value;
    };
    for (let tick = 0; tick < 60; tick += 1) {
      const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '180');
      line.setAttribute('x2', '180');
      line.setAttribute('y1', '33');
      line.setAttribute('y2', tick % 5 === 0 ? '44' : '37');
      line.setAttribute('transform', 'rotate(' + tick * 6 + ' 180 180)');
      if (tick % 5 === 0) line.classList.add('major');
      el['stats-clock-ticks'].appendChild(line);
    }

    function renderWeek(summary) {
      const key = JSON.stringify([summary.goalMs, summary.week]);
      if (key === lastWeek) return;
      lastWeek = key;
      const chart = el['stats-week-chart'];
      const chartMax = Math.max(summary.goalMs, ...summary.week.map((day) => day.ms), 1);
      const keysMatch = [...chart.children].map((node) => node.dataset.day).join(',') === summary.week.map((day) => day.key).join(',');
      // Keep focused day controls in place when the goal or today's reading changes.
      if (!keysMatch) {
        chart.replaceChildren();
        for (const day of summary.week) {
          const column = doc.createElement('button');
          column.type = 'button';
          column.className = 'stats-day';
          column.dataset.day = day.key;
          const slot = doc.createElement('span');
          slot.className = 'stats-day-bar-slot';
          const bar = doc.createElement('span');
          bar.className = 'stats-day-bar';
          slot.appendChild(bar);
          const minutes = doc.createElement('span');
          minutes.className = 'stats-day-minutes';
          const label = doc.createElement('span');
          label.className = 'stats-day-label';
          const detail = doc.createElement('span');
          detail.className = 'stats-day-detail';
          detail.setAttribute('aria-hidden', 'true');
          column.append(slot, minutes, label, detail);
          chart.appendChild(column);
        }
      }
      summary.week.forEach((day, index) => {
        const column = chart.children[index];
        const detail = day.key.slice(5).replace('-', '.') + ' · ' + clockReading(day.ms, 0).label;
        column.classList.toggle('today', day.isToday);
        column.setAttribute('aria-label', (day.isToday ? '今天，' : '') + day.key + '，星期' + day.label + '，已读' + clockReading(day.ms, 0).label);
        column.querySelector('.stats-day-bar').style.height = (day.ms / chartMax * 100).toFixed(3) + '%';
        column.querySelector('.stats-day-minutes').textContent = day.ms ? Math.floor(day.ms / 60000) + '分' : '—';
        column.querySelector('.stats-day-label').textContent = day.isToday ? '今天' : day.label;
        column.querySelector('.stats-day-detail').textContent = detail;
      });
    }

    function renderBooks(books) {
      const key = JSON.stringify(books);
      if (key === lastBooks) return;
      lastBooks = key;
      const list = el['stats-finished-books'];
      list.replaceChildren();
      if (!books.length) {
        const empty = doc.createElement('p');
        empty.className = 'stats-empty';
        empty.textContent = '读完一本书后，它会出现在这里。';
        list.appendChild(empty);
        return;
      }
      for (const book of books) {
        const item = doc.createElement('article');
        item.className = 'stats-finished-book';
        item.tabIndex = 0;
        const date = new Date(book.finishedAt);
        const dateText = date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + String(date.getDate()).padStart(2, '0');
        item.setAttribute('aria-label', book.title + '，读完于 ' + dateText);
        let cover;
        if (book.cover) {
          cover = doc.createElement('img');
          cover.src = book.cover;
          cover.alt = '';
          cover.loading = 'lazy';
          cover.draggable = false;
        } else {
          cover = doc.createElement('div');
          cover.textContent = '已读';
        }
        cover.className = 'stats-finished-cover';
        const title = doc.createElement('p');
        title.className = 'stats-finished-title';
        title.textContent = book.title;
        title.title = book.title;
        const finished = doc.createElement('time');
        finished.className = 'stats-finished-date';
        finished.dateTime = date.toISOString();
        finished.textContent = dateText.slice(5) + ' 读完';
        item.append(cover, title, finished);
        list.appendChild(item);
      }
    }

    function render(summary) {
      const clock = clockReading(summary.todayMs, summary.goalMs);
      text('stats-today', clock.text);
      el['stats-today'].setAttribute('aria-label', '今日已读 ' + clock.label);
      el['stats-ring'].setAttribute('aria-label', '累计阅读计时器，主针每圈60分钟，细针每圈60秒。今日累计阅读 ' + clock.label + '，每日目标已完成 ' + clock.percent + '%');
      el['stats-clock-minute'].setAttribute('transform', 'rotate(' + clock.minuteAngle + ' 180 180)');
      el['stats-clock-second'].setAttribute('transform', 'rotate(' + clock.secondAngle + ' 180 180)');
      el['stats-clock-progress'].setAttribute('stroke-dasharray', (clock.progress * 100).toFixed(3) + ' 100');
      text('stats-ring-percent', clock.percent + '%');
      text('stats-date', summary.todayKey.replaceAll('-', ' . '));
      text('stats-goal-copy', '每日目标 ' + summary.goalMinutes + ' 分钟');
      text('stats-goal-status', clock.progress >= 1 ? '今日目标已完成' : summary.todayMs > 0 ? '距离目标还差 ' + Math.ceil((summary.goalMs - summary.todayMs) / 60000) + ' 分钟' : '从翻开一页开始');
      text('stats-alice-line', readingCompanionLine(summary));
      text('stats-current-streak', summary.currentStreak + ' 天');
      text('stats-longest-streak', summary.longestStreak + ' 天');
      text('stats-week-total', formatDuration(summary.week.reduce((sum, day) => sum + day.ms, 0)));
      text('stats-finished-count', summary.completedThisYear + ' 本');
      for (const button of el['stats-goal-options'].querySelectorAll('[data-goal-minutes]')) {
        const active = Number(button.dataset.goalMinutes) === summary.goalMinutes;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      renderWeek(summary);
      renderBooks(summary.completedBooks);
    }
    return { render };
  }
  return { clockReading, createRenderer };
});
