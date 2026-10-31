const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const image = require('../study/export-image.js')._test;

test('export validates calendar dates, including leap years', () => {
  assert.equal(image.dateValue('2028-02-29').getDate(), 29);
  for (const date of ['2026-02-29', '2026-13-01', '../record']) assert.throws(() => image.dateValue(date));
});

test('screen-sized card is exported in one complete image', () => {
  assert.deepEqual(image.captureSlices(1454, 1190), [{top:0,height:1454}]);
});

test('long exports cover every pixel exactly once within canvas limits', () => {
  for (const width of [360, 1190, 1600]) {
    for (const height of [1, 4096, 20001, 95000]) {
      const pages = image.captureSlices(height, width);
      assert.equal(pages[0].top, 0);
      assert.equal(pages.at(-1).top + pages.at(-1).height, height);
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        assert(page.height > 0 && page.height <= image.MAX_HEIGHT);
        assert(width * page.height * image.SCALE ** 2 <= image.MAX_PIXELS);
        if (i) assert.equal(page.top, pages[i-1].top + pages[i-1].height);
      }
    }
  }
});

test('page breaks prefer card boundaries and still split oversized cards without trimming', () => {
  const pages = image.captureSlices(9000, 1200, [3000, 4000, 8000]);
  assert.equal(pages[0].height, 3000);
  assert.equal(pages.at(-1).top + pages.at(-1).height, 9000);
  for (const args of [[0,1200],[100,0],[NaN,1200],[100,Infinity]]) assert.throws(() => image.captureSlices(...args));
});

function captureFixture({fail=false, height=1454}={}) {
  const calls = [];
  const controls = [{disabled:true}];
  let removed = false;
  const surface = {
    style: { setProperty() {} }, scrollHeight: height,
    setAttribute() {},
    getBoundingClientRect: () => ({width:1190,height,top:0}),
    querySelector: () => ({}),
    querySelectorAll: selector => selector === 'button,input,select' ? controls : [],
    remove() {removed=true;},
  };
  const window = {
    document: {baseURI:'http://localhost/study/',body:{append(){}},fonts:{ready:Promise.resolve()}},
    setTimeout: callback => callback(),
    htmlToImage: {async toCanvas(node, options) {
      calls.push({node,options});
      if (fail) throw new Error('capture failed');
      return {width:options.width*2,height:options.height*2,toBlob(cb) {cb(new Blob(['png']));}};
    }},
  };
  const context=vm.createContext({window, URL, Blob, TextEncoder, Uint8Array, DataView});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../study/export-image.js'),'utf8'),context);
  return {surface,calls,controls,removed:()=>removed,api:window.StudyImage._test};
}

test('capture renders the supplied page DOM including all folds and tray, not a parallel card renderer', async () => {
  const f=captureFixture();
  const files=await f.api.captureSurface(f.surface,'2026-10-31');
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].node,f.surface);
  assert.equal(files[0].width,2380);
  assert.equal(files[0].height,2908);
  assert.equal(files[0].name,'今日打卡_2026-10-31.png');
  assert.equal(f.calls[0].options.pixelRatio,2);
  assert.equal(f.calls[0].options.skipAutoScale,true);
  assert.equal(f.controls[0].disabled,false);
  assert(f.removed());
});

test('capture offsets every long-page slice and removes its temporary DOM on failure', async () => {
  const f=captureFixture({height:9500});
  const files=await f.api.captureSurface(f.surface,'2026-10-31');
  assert(files.length>1);
  assert.equal(files.reduce((n,file)=>n+file.height,0),19000);
  assert(f.calls[1].options.style.transform.startsWith('translateY(-'));
  const broken=captureFixture({fail:true});
  await assert.rejects(broken.api.captureSurface(broken.surface,'2026-10-31'),/capture failed/);
  assert(broken.removed());
});

test('ZIP stores UTF-8 PNG names and valid CRC data', async () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(image.crc32(bytes), 0xCBF43926);
  const archive = await image.zipFiles([{ name: '今日打卡_2026-10-25_p1.png', blob: new Blob([bytes]) }, { name: '第二张.png', blob: new Blob(['PNG']) }]);
  const data = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(data.buffer);
  assert.equal(view.getUint32(0, true), 0x04034B50);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint32(data.length - 22, true), 0x06054B50);
  assert.equal(view.getUint16(data.length - 12, true), 2);
  assert(new TextDecoder().decode(data).includes('第二张.png'));
});
