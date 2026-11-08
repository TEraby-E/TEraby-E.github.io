'use strict';

for (const snippet of document.querySelectorAll('.snippet')) {
  const code = snippet.querySelector('code');
  const copy = snippet.querySelector('button');
  const download = snippet.querySelector('a');
  const status = snippet.querySelector('[role=status]');
  let loading = false;

  snippet.addEventListener('toggle', async () => {
    if (!snippet.open || loading || code.textContent) return;
    loading = true;
    status.textContent = '加载中…';
    try {
      const response = await fetch(download.href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      code.textContent = await response.text();
      copy.disabled = false;
      status.textContent = '';
    } catch {
      status.textContent = '加载失败';
    } finally {
      loading = false;
    }
  });

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = '已复制';
    } catch {
      status.textContent = '复制失败，可下载 .cpp';
    }
  });
}
