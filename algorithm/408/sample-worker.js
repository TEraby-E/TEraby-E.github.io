const MAX_OUTPUT = 16000;
const BAD_FD = 8;
const NO_SYSCALL = 52;
const NOT_SEEKABLE = 70;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class ProgramExit extends Error {
  constructor(code) {
    super(`程序退出，状态码 ${code}`);
    this.code = code;
  }
}

async function run(program, input) {
  const stdin = encoder.encode(input);
  const streams = [new Uint8Array(MAX_OUTPUT), new Uint8Array(MAX_OUTPUT)];
  const lengths = [0, 0];
  let readOffset = 0;
  let memory;
  let error = '';
  const view = () => new DataView(memory.buffer);
  const write = (ptr, value) => view().setUint32(ptr, value, true);
  const bytes = (ptr, length) => new Uint8Array(memory.buffer, ptr, length);
  const functions = {
    proc_exit(code) { throw new ProgramExit(code); },
    environ_sizes_get(count, size) { write(count, 0); write(size, 0); return 0; },
    environ_get() { return 0; },
    args_sizes_get(count, size) { write(count, 1); write(size, 5); return 0; },
    args_get(argv, data) {
      write(argv, data);
      bytes(data, 5).set([109, 97, 105, 110, 0]); // main
      return 0;
    },
    clock_time_get(id, _precision, output) {
      const nanoseconds = id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.floor(performance.now() * 1000000));
      view().setBigUint64(output, nanoseconds, true);
      return 0;
    },
    random_get(ptr, count) {
      for (let offset = 0; offset < count; offset += 65536) crypto.getRandomValues(bytes(ptr + offset, Math.min(65536, count - offset)));
      return 0;
    },
    fd_prestat_get() { return BAD_FD; },
    fd_prestat_dir_name() { return BAD_FD; },
    fd_close(fd) { return fd <= 2 ? 0 : BAD_FD; },
    fd_seek(fd) { return fd <= 2 ? NOT_SEEKABLE : BAD_FD; },
    fd_fdstat_get(fd, stat) {
      if (fd > 2) return BAD_FD;
      const fields = bytes(stat, 24);
      fields.fill(0);
      fields[0] = 2; // Character device.
      return 0;
    },
    fd_read(fd, iov, count, size) {
      if (fd !== 0) return BAD_FD;
      const data = view();
      let read = 0;
      for (let i = 0; i < count && readOffset < stdin.length; i++, iov += 8) {
        const ptr = data.getUint32(iov, true);
        const length = Math.min(data.getUint32(iov + 4, true), stdin.length - readOffset);
        bytes(ptr, length).set(stdin.subarray(readOffset, readOffset + length));
        readOffset += length;
        read += length;
      }
      write(size, read);
      return 0;
    },
    fd_write(fd, iov, count, size) {
      if (fd !== 1 && fd !== 2) return BAD_FD;
      const index = fd - 1;
      const data = view();
      let written = 0;
      for (let i = 0; i < count; i++, iov += 8) {
        const ptr = data.getUint32(iov, true);
        const length = data.getUint32(iov + 4, true);
        const available = Math.min(length, MAX_OUTPUT - lengths[index]);
        streams[index].set(bytes(ptr, available), lengths[index]);
        lengths[index] += available;
        written += available;
        if (available < length) throw new Error('输出超过上限');
      }
      write(size, written);
      return 0;
    }
  };
  try {
    const wasi = {};
    for (const item of WebAssembly.Module.imports(program)) {
      if (item.module !== 'wasi_unstable' || item.kind !== 'function') throw new Error('程序使用了不支持的浏览器接口');
      wasi[item.name] = Object.hasOwn(functions, item.name) ? functions[item.name] : () => NO_SYSCALL;
    }
    const instance = await WebAssembly.instantiate(program, {wasi_unstable: wasi});
    memory = instance.exports.memory;
    instance.exports._start();
  } catch (cause) {
    if (!(cause instanceof ProgramExit && cause.code === 0)) error = cause.message || '运行失败';
  }
  return {
    stdout: decoder.decode(streams[0].subarray(0, lengths[0])),
    stderr: decoder.decode(streams[1].subarray(0, lengths[1])),
    error
  };
}

self.addEventListener('message', async ({data}) => {
  self.postMessage({result: await run(data.program, data.input)});
});
