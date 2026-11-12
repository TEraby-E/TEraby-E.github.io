const formTemplate = document.querySelector('#judge-form-template');
const resultTemplate = document.querySelector('#judge-result-template');
const forms = Array.from(document.querySelectorAll('.paper-question'), (question, index) => {
  const form = formTemplate.content.firstElementChild.cloneNode(true);
  const id = `judge-code-${index + 1}`;
  form.querySelector('label').htmlFor = id;
  form.querySelector('textarea').id = id;
  question.querySelectorAll('.judge-sample').forEach(sample => {
    sample.append(resultTemplate.content.cloneNode(true));
  });
  question.append(form);
  return form;
});
const runButtons = forms.map(form => form.querySelector('button[type=submit]'));
let activeRun = null;

function sameOutput(actual, expected) {
  const normalize = text => text.trim().replace(/\s+/g, ' ');
  return normalize(actual) === normalize(expected);
}

function resetSample(sample) {
  const verdict = sample.querySelector('[data-verdict]');
  verdict.hidden = true;
  verdict.textContent = '';
  delete verdict.dataset.state;
  sample.querySelector('.judge-actual').hidden = true;
}

function showResult(sample, result) {
  const expected = sample.querySelector('[data-expected]').textContent;
  const passed = !result.error && sameOutput(result.stdout || '', expected);
  const verdict = sample.querySelector('[data-verdict]');
  verdict.dataset.state = passed ? 'pass' : 'fail';
  verdict.textContent = result.error || (passed ? '通过' : '输出不符');
  verdict.hidden = false;
  const actual = sample.querySelector('.judge-actual');
  actual.querySelector('[data-stdout]').textContent = result.stdout || '（无输出）';
  const stderr = actual.querySelector('[data-stderr]');
  stderr.querySelector('pre').textContent = result.stderr || '';
  stderr.hidden = !result.stderr;
  actual.hidden = false;
  return passed;
}

for (const form of forms) {
  const question = form.closest('.paper-question');
  const samples = [...question.querySelectorAll('.judge-sample')];
  const editor = form.querySelector('textarea');
  const status = form.querySelector('.judge-status');
  const stop = form.querySelector('[data-stop]');
  stop.addEventListener('click', () => activeRun?.abort());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (activeRun) return;
    const source = editor.value;
    if (!source.trim()) {
      status.textContent = '请输入 C++ 代码';
      editor.focus();
      return;
    }
    const controller = new AbortController();
    activeRun = controller;
    runButtons.forEach(button => { button.disabled = true; });
    editor.readOnly = true;
    stop.hidden = false;
    samples.forEach(resetSample);
    status.textContent = '加载编译器…';
    try {
      const { runSamples } = await import('./compiler.js');
      const inputs = samples.map(sample => sample.querySelector('[data-input]').textContent);
      const { results } = await runSamples(source, inputs, {
        signal: controller.signal,
        onStatus(stage, sampleIndex) {
          if (stage === 'load') status.textContent = '加载编译器…';
          if (stage === 'compile') status.textContent = '编译中…';
          if (stage === 'run') status.textContent = `运行样例 ${sampleIndex + 1}…`;
        },
      });
      if (results.length !== samples.length) throw new Error('样例运行未完成');
      const passed = results.filter((result, index) => showResult(samples[index], result)).length;
      status.textContent = `${passed} / ${samples.length} 组通过`;
    } catch (error) {
      status.textContent = controller.signal.aborted ? '已停止' : error.message || '编译未完成';
    } finally {
      activeRun = null;
      editor.readOnly = false;
      stop.hidden = true;
      runButtons.forEach(button => { button.disabled = false; });
    }
  });
}
