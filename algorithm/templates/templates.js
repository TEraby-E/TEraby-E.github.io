'use strict';

const recordPrefix = 'algorithm-template-check-in:';
const form = document.querySelector('#check-in');
const list = document.querySelector('#check-in-records');
const dateFormat = list && new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function recordCard(record) {
  const details = document.createElement('details');
  details.className = 'template-record';
  const summary = document.createElement('summary');
  summary.textContent = record.title;
  const time = document.createElement('time');
  const date = new Date(record.createdAt);
  time.dateTime = date.toISOString();
  time.textContent = dateFormat.format(date);
  summary.append(time);
  const code = document.createElement('code');
  code.textContent = record.code;
  const pre = document.createElement('pre');
  pre.tabIndex = 0;
  pre.append(code);
  details.append(summary, pre);
  return details;
}

function renderRecords() {
  const records = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(recordPrefix)) continue;
      try {
        const record = JSON.parse(localStorage.getItem(key));
        if (typeof record?.title === 'string' && typeof record.code === 'string' &&
            Number.isFinite(record.createdAt) && Number.isFinite(new Date(record.createdAt).getTime())) {
          records.push(record);
        }
      } catch {
        // A damaged entry should not prevent reading other records.
      }
    }
  } catch {
    list.textContent = '无法读取本机记录';
    return;
  }
  records.sort((left, right) => right.createdAt - left.createdAt);
  list.replaceChildren(...records.map(recordCard));
  if (!records.length) list.textContent = '暂无记录';
}

if (form) {
  const titleField = form.querySelector('#problem-title');
  const codeField = form.querySelector('#solution-code');
  const status = form.querySelector('#check-in-status');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = titleField.value.trim();
    const code = codeField.value;
    if (!title || !code.trim()) {
      status.textContent = '请填写题目和代码';
      (title ? codeField : titleField).focus();
      return;
    }
    try {
      // Each submission has its own key, so tabs do not overwrite a shared list.
      const key = recordPrefix + crypto.randomUUID();
      localStorage.setItem(key, JSON.stringify({ title, code, createdAt: Date.now() }));
    } catch {
      status.textContent = '保存失败，请检查本机存储';
      return;
    }
    form.reset();
    status.textContent = '已保存到本机';
    if (list) renderRecords();
  });
}

if (list) {
  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(recordPrefix)) renderRecords();
  });
  renderRecords();
}
