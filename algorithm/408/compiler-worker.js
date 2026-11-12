import {API} from './compiler-vendor/binji.js';

const MAX_DIAGNOSTICS = 16000;
let toolchain;

async function readAsset(name) {
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持编译器解压');
  const local = new URL(`./compiler-assets/${name}.gz`, import.meta.url);
  const response = await fetch(local);
  if (!response.ok) throw new Error(`编译器资源下载失败（${response.status}）`);
  const raw = response.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(raw).arrayBuffer();
}

async function loadToolchain() {
  const [clang, lld, memfs, sysroot] = await Promise.all([
    readAsset('clang').then(WebAssembly.compile),
    readAsset('lld').then(WebAssembly.compile),
    readAsset('memfs').then(WebAssembly.compile),
    readAsset('sysroot.tar')
  ]);
  return {clang, lld, memfs, sysroot};
}

async function compile(source) {
  if (typeof source !== 'string' || source.length > 64000) throw new Error('代码过长');
  if (!toolchain) {
    self.postMessage({status: 'load'});
    try {
      toolchain = await loadToolchain();
    } catch (error) {
      throw new Error(`编译器加载失败：${error.message}`);
    }
  }
  self.postMessage({status: 'compile'});
  let diagnostic = '';
  const {clang, lld, memfs, sysroot} = toolchain;
  const api = new API({
    compileStreaming: async (name) => ({clang, lld, memfs})[name],
    readBuffer: async () => sysroot,
    hostWrite(chunk) { diagnostic += chunk.slice(0, MAX_DIAGNOSTICS - diagnostic.length); }
  });
  api.hostLog = () => {};
  api.hostLogAsync = (_message, promise) => promise;
  await api.ready;
  api.memfs.addFile('main.cpp', new TextEncoder().encode(source));
  try {
    await api.run(clang, 'clang', '-cc1', '-emit-obj',
      ...api.clangCommonArgs.filter(arg => arg !== '-fcolor-diagnostics'),
      '-std=c++17', '-O0', '-o', 'main.o', '-x', 'c++', 'main.cpp');
    const lib = 'lib/wasm32-wasi';
    await api.run(lld, 'wasm-ld', '--no-threads', '--export-dynamic',
      '--max-memory=67108864', '-z', 'stack-size=1048576',
      `-L${lib}`, `${lib}/crt1.o`, 'main.o', '-lc', '-lc++', '-lc++abi',
      'lib/clang/8.0.1/lib/wasi/libclang_rt.builtins-wasm32.a', '-o', 'main.wasm');
    return await WebAssembly.compile(api.memfs.getFileContents('main.wasm'));
  } catch (error) {
    // The original WASI filesystem forwards UTF-8 as individual byte values.
    const bytes = Uint8Array.from(diagnostic, character => character.charCodeAt(0));
    const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;]*m/g, '').trim();
    throw new Error(`编译失败\n${text || error.message}`);
  }
}

self.addEventListener('message', async ({data}) => {
  try {
    self.postMessage({result: await compile(data.source)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
});
