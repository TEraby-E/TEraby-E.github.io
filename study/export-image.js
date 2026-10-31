'use strict';

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyImage = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  const SCALE = 2;
  const MAX_HEIGHT = 4096;
  const MAX_PIXELS = 16000000;
  const scope = root.document ? new URL('.', root.document.baseURI).pathname : '/';
  const DB_NAME = `sjtu-study-export:${scope}`;
  const scriptURL = root.document?.currentScript?.src || root.document?.baseURI;
  let directoryHandle;
  let rendererPromise;
  let exportQueue = Promise.resolve();

  function dateValue(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('导出日期格式不正确。');
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(0);
    value.setFullYear(year, month - 1, day);
    value.setHours(12, 0, 0, 0);
    if (year < 1 || value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) throw new Error('导出日期不是有效的日历日期。');
    return value;
  }

  function captureSlices(height, width, boundaries = []) {
    if (!Number.isFinite(height) || !Number.isFinite(width) || height < 1 || width < 1 || width > 10000 || height > 1000000) throw new Error('图片区域尺寸不正确。');
    height = Math.ceil(height); width = Math.ceil(width);
    const limit = Math.min(MAX_HEIGHT, Math.floor(MAX_PIXELS / (width * SCALE * SCALE)));
    const edges = [...new Set(boundaries.filter(Number.isFinite).map(Math.floor))].sort((a, b) => a - b);
    const slices = [];
    for (let top = 0; top < height;) {
      let end = Math.min(height, top + limit);
      if (end < height) {
        const candidates = edges.filter(edge => edge > top + limit / 2 && edge <= end);
        if (candidates.length) end = candidates[candidates.length - 1];
      }
      slices.push({ top, height: end - top });
      top = end;
    }
    return slices;
  }

  function loadRenderer() {
    if (root.htmlToImage?.toCanvas) return Promise.resolve(root.htmlToImage);
    if (!rendererPromise) rendererPromise = new Promise((resolve, reject) => {
      const script = root.document.createElement('script');
      const url = new URL('./vendor/html-to-image.js', scriptURL);
      const release = new URL(scriptURL).searchParams.get('v');
      if (release) url.searchParams.set('v', release);
      script.src = url.href;
      script.onload = () => {
        script.remove();
        if (root.htmlToImage?.toCanvas) resolve(root.htmlToImage);
        else { rendererPromise = null; reject(new Error('图片组件载入不完整，请刷新后重试。')); }
      };
      script.onerror = () => { script.remove(); rendererPromise = null; reject(new Error('图片组件未能载入，请联网打开一次后重试。')); };
      root.document.head.append(script);
    });
    return rendererPromise;
  }

  async function prepareSurface(surface) {
    surface.setAttribute('aria-hidden', 'true');
    // Native system fonts also work inside the isolated SVG used for capture.
    surface.style.setProperty('--journal-font', '"Times New Roman", "SimSun", "宋体", "Songti SC", serif');
    surface.style.fontFamily = 'var(--journal-font)';
    for (const control of surface.querySelectorAll('button,input,select')) control.disabled = false;
    for (const use of surface.querySelectorAll('svg use')) {
      const id = use.getAttribute('href');
      const symbol = id?.startsWith('#') ? root.document.getElementById(id.slice(1)) : null;
      if (symbol) {
        const svg = use.closest('svg');
        svg.setAttribute('viewBox', symbol.getAttribute('viewBox') || '0 0 24 24');
        use.replaceWith(...[...symbol.childNodes].map(node => node.cloneNode(true)));
      }
    }
    root.document.body.append(surface);
    try {
      if (root.document.fonts?.ready) await root.document.fonts.ready;
      await Promise.all([...surface.querySelectorAll('img')].map(async image => {
        image.loading = 'eager';
        if (image.decode) await image.decode();
        if (!image.complete || !image.naturalWidth) throw new Error('卡面图片未能载入，请刷新后重试。');
      }));
      // Flush layout after turning off offscreen-card rendering optimizations.
      const rect = surface.getBoundingClientRect();
      const height = Math.ceil(Math.max(rect.height, surface.scrollHeight));
      const width = Math.ceil(rect.width);
      const boundaries = [...surface.querySelectorAll('.study-card,.subject-group,.sheet-bottom')].map(node => node.getBoundingClientRect().bottom - rect.top);
      return { width, height, slices: captureSlices(height, width, boundaries) };
    } catch (error) { surface.remove(); throw error; }
  }

  async function captureSurface(surface, date) {
    if (!surface?.querySelector('.page-heading') || !surface.querySelector('.task-sheet') || !surface.querySelector('.sheet-bottom')) throw new Error('打卡页面尚未准备好，请等待清单载入后重试。');
    let canvas;
    try {
      const renderer = await loadRenderer();
      const { width, height, slices } = await prepareSurface(surface);
      const files = [];
      for (let index = 0; index < slices.length; index += 1) {
        const slice = slices[index];
        canvas = await renderer.toCanvas(surface, {
          width, height: slice.height, canvasWidth: width, canvasHeight: slice.height,
          pixelRatio: SCALE, skipAutoScale: true, skipFonts: true,
          backgroundColor: '#efede8',
          style: { position: 'relative', left: '0', top: '0', zIndex: '0', margin: '0', height: `${height}px`, transform: `translateY(-${slice.top}px)`, transformOrigin: 'top left' },
          filter: node => !node.hidden,
        });
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('浏览器未能生成 PNG 图片，请重试。')), 'image/png'));
        const suffix = slices.length > 1 ? `_p${index + 1}` : '';
        files.push({ name: `今日打卡_${date}${suffix}.png`, blob, width: canvas.width, height: canvas.height });
        canvas.width = canvas.height = 1;
        canvas = null;
        if (index + 1 < slices.length) await new Promise(resolve => root.setTimeout(resolve, 0));
      }
      return files;
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      surface.remove();
    }
  }

  function settings(action, value) {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('当前浏览器不能记住导出目录。')); return; }
      const open = root.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('preferences'); };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('导出目录设置暂时被其他窗口占用。'));
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('preferences', action === 'get' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('preferences');
        const request = action === 'get' ? store.get('directory') : action === 'delete' ? store.delete('directory') : store.put(value, 'directory');
        let result;
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => { db.close(); resolve(result); };
        transaction.onerror = () => { db.close(); reject(transaction.error || new Error('导出目录设置未保存。')); };
        transaction.onabort = () => { db.close(); reject(transaction.error || new Error('导出目录设置未保存。')); };
      };
    });
  }

  async function rememberedDirectory() {
    if (directoryHandle === undefined) {
      try { directoryHandle = (await settings('get')) || null; } catch { directoryHandle = null; }
    }
    return directoryHandle;
  }

  async function getDirectoryInfo() {
    const supported = typeof root.showDirectoryPicker === 'function' && root.isSecureContext;
    const handle = supported ? await rememberedDirectory() : null;
    return { supported: Boolean(supported), configured: Boolean(handle), name: handle?.name || '' };
  }

  async function chooseDirectory() {
    if (typeof root.showDirectoryPicker !== 'function' || !root.isSecureContext) return { supported: false, configured: false, name: '', cancelled: false };
    let handle;
    try { handle = await root.showDirectoryPicker({ id: 'sjtu-study-export', mode: 'readwrite', startIn: 'desktop' }); }
    catch (error) { if (error.name === 'AbortError') return { ...(await getDirectoryInfo()), cancelled: true }; throw new Error(`未能选择导出目录：${error.message}`); }
    directoryHandle = handle;
    let warning;
    try { await settings('put', handle); } catch { warning = '这个目录本次可以使用，但浏览器未能记住它；下次需要重新选择。'; }
    return { supported: true, configured: true, name: handle.name, cancelled: false, warning };
  }

  async function clearDirectory() { await settings('delete'); directoryHandle = null; return getDirectoryInfo(); }

  async function permittedDirectory() {
    const handle = await rememberedDirectory();
    if (!handle) return { handle: null };
    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted' && root.navigator?.userActivation?.isActive) permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') return { handle };
    } catch { /* A revoked folder handle must not prevent a regular download. */ }
    return { handle: null, warning: '导出目录暂未授权，已改为浏览器下载。需要保存到桌面时，请重新选择导出目录。' };
  }

  async function uniqueFile(handle, desired) {
    const stem = desired.replace(/\.png$/i, '');
    for (let collision = 0; collision < 10000; collision += 1) {
      const name = collision ? `${stem}_${collision + 1}.png` : desired;
      try { await handle.getFileHandle(name); }
      catch (error) { if (error.name === 'NotFoundError') return { name, handle: await handle.getFileHandle(name, { create: true }) }; throw error; }
    }
    throw new Error('同名图片过多，请整理导出目录后重试。');
  }

  function download(blob, name) {
    const url = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.hidden = true;
    root.document.body.append(anchor); anchor.click(); anchor.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
  function crc32(bytes) { let crc = 0xFFFFFFFF; for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
  function binary(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
  async function zipFiles(files) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const name = new TextEncoder().encode(file.name);
      const crc = crc32(data);
      const header = binary(30 + name.length);
      header.view.setUint32(0, 0x04034B50, true); header.view.setUint16(4, 20, true); header.view.setUint16(6, 0x0800, true);
      header.view.setUint32(14, crc, true); header.view.setUint32(18, data.length, true); header.view.setUint32(22, data.length, true); header.view.setUint16(26, name.length, true); header.bytes.set(name, 30);
      local.push(header.bytes, data);
      const entry = binary(46 + name.length);
      entry.view.setUint32(0, 0x02014B50, true); entry.view.setUint16(4, 20, true); entry.view.setUint16(6, 20, true); entry.view.setUint16(8, 0x0800, true);
      entry.view.setUint32(16, crc, true); entry.view.setUint32(20, data.length, true); entry.view.setUint32(24, data.length, true); entry.view.setUint16(28, name.length, true); entry.view.setUint32(42, offset, true); entry.bytes.set(name, 46);
      central.push(entry.bytes); offset += header.bytes.length + data.length;
    }
    const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
    const end = binary(22);
    end.view.setUint32(0, 0x06054B50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true); end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
    return new Blob([...local, ...central, end.bytes], { type: 'application/zip' });
  }

  async function performExport({ date, surface }) {
    dateValue(date);
    const permission = await permittedDirectory();
    const files = await captureSurface(surface, date);
    if (permission.handle) {
      const write = async () => {
        let saved = 0;
        try {
          for (const file of files) {
            const target = await uniqueFile(permission.handle, file.name);
            const writable = await target.handle.createWritable();
            try { await writable.write(file.blob); await writable.close(); }
            catch (error) { await writable.abort().catch(() => {}); throw error; }
            file.name = target.name; saved += 1;
          }
        } catch (error) { throw new Error(`${saved ? `已有 ${saved} 张图片保存，` : ''}其余图片未能写入“${permission.handle.name}”：${error.message}。请检查目录权限或改用浏览器下载。`); }
      };
      if (root.navigator?.locks?.request) await root.navigator.locks.request(`sjtu-study-image:${scope}`, write);
      else await write();
      return { files, destination: 'directory', directoryName: permission.handle.name };
    }
    let archiveName;
    if (files.length > 1) { archiveName = `今日打卡_${date}_全部图片.zip`; download(await zipFiles(files), archiveName); }
    else download(files[0].blob, files[0].name);
    return { files, destination: 'download', archiveName, warning: permission.warning };
  }

  function exportDaily(value) {
    const run = exportQueue.then(() => performExport(value));
    exportQueue = run.catch(() => {});
    return run;
  }

  return { exportDaily, chooseDirectory, getDirectoryInfo, clearDirectory, _test: { captureSlices, captureSurface, prepareSurface, dateValue, crc32, zipFiles, SCALE, MAX_HEIGHT, MAX_PIXELS } };
});
