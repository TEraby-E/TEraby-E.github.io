const BASE = new URL('.', import.meta.url);
const COMPILER_TIMEOUT = 30000;
const DOWNLOAD_TIMEOUT = 120000;
const SAMPLE_TIMEOUT = 3000;
let compiler;
let busy = false;

function abortError() {
  return new DOMException('已停止运行', 'AbortError');
}

function request(worker, payload, {timeout, timeoutMessage, signal, onStatus, onFailure}) {
  return new Promise((resolve, reject) => {
    let timer;
    let failure = timeoutMessage;
    const setTimer = (delay) => {
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(failure)), delay);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.removeEventListener('message', receive);
      worker.removeEventListener('error', workerError);
      worker.removeEventListener('messageerror', workerError);
    };
    const fail = (error) => {
      cleanup();
      onFailure?.();
      reject(error);
    };
    const abort = () => fail(abortError());
    const workerError = () => fail(new Error('浏览器无法启动运行环境'));
    const receive = ({data}) => {
      if (data.status) {
        if (data.status === 'compile') {
          failure = '编译超时';
          setTimer(COMPILER_TIMEOUT);
        }
        onStatus?.(data.status);
        return;
      }
      cleanup();
      if (data.error && !data.result) reject(new Error(data.error));
      else resolve(data.result);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, {once: true});
    worker.addEventListener('message', receive);
    worker.addEventListener('error', workerError);
    worker.addEventListener('messageerror', workerError);
    setTimer(timeout);
    try {
      worker.postMessage(payload);
    } catch (error) {
      fail(error);
    }
  });
}

export async function runSamples(source, inputs, {onStatus, signal} = {}) {
  if (signal?.aborted) throw abortError();
  if (busy) throw new Error('已有样例正在运行');
  busy = true;
  try {
    compiler ??= new Worker(new URL('./compiler-worker.js', BASE), {type: 'module'});
    const program = await request(compiler, {source}, {
      timeout: DOWNLOAD_TIMEOUT,
      timeoutMessage: '编译器下载超时，请重试',
      signal,
      onStatus,
      onFailure: () => {
        compiler.terminate();
        compiler = undefined;
      }
    });
    const results = [];
    for (const [index, input] of inputs.entries()) {
      if (signal?.aborted) throw abortError();
      onStatus?.('run', index);
      const runner = new Worker(new URL('./sample-worker.js', BASE), {type: 'module'});
      try {
        results.push(await request(runner, {program, input}, {
          timeout: SAMPLE_TIMEOUT,
          timeoutMessage: '运行超时',
          signal
        }));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        results.push({stdout: '', stderr: '', error: error.message});
      } finally {
        runner.terminate();
      }
    }
    return {results};
  } finally {
    busy = false;
  }
}
