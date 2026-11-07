'use strict';

const status = document.querySelector('#practice-status');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(label, href, className) {
  const node = element('a', label, className);
  node.href = href;
  return node;
}

async function load(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function showList({ problems, difficulties, chapters }) {
  const search = document.querySelector('#problem-search');
  const difficulty = document.querySelector('#difficulty-filter');
  const chapter = document.querySelector('#chapter-filter');
  const list = document.querySelector('#problem-list');
  for (const item of difficulties) difficulty.add(new Option(item.label, item.id));
  for (const item of chapters) chapter.add(new Option(item.label, item.id));
  const difficultyNames = new Map(difficulties.map(item => [item.id, item.label]));
  const chapterNames = new Map(chapters.map(item => [item.id, item.label]));

  const rows = problems.map(problem => {
    const row = link(null, `./problem.html?id=${problem.id}`, 'resource');
    const body = element('span', null, 'resource-body');
    body.append(
      element('span', problem.title, 'resource-title'),
      element('span', `${difficultyNames.get(problem.difficulty)} · ${chapterNames.get(problem.chapter)}`, 'resource-description')
    );
    const arrow = element('span', '→', 'resource-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    row.append(element('span', problem.id, 'resource-number'), body, arrow);
    return { problem, row, searchText: `${problem.id} ${problem.title}`.toLowerCase() };
  });
  list.replaceChildren(...rows.map(item => item.row));

  function render() {
    const query = search.value.trim().toLowerCase();
    let count = 0;
    for (const { problem, row, searchText } of rows) {
      const matches = (!difficulty.value || problem.difficulty === difficulty.value) &&
        (!chapter.value || problem.chapter === chapter.value) && searchText.includes(query);
      const hidden = !matches;
      if (row.hidden !== hidden) row.hidden = hidden;
      if (matches) count += 1;
    }
    status.textContent = count ? `${count} / ${problems.length} 道题` : '没有符合条件的题目。';
  }

  document.querySelector('#problem-filters').addEventListener('submit', event => event.preventDefault());
  search.addEventListener('input', render);
  difficulty.addEventListener('change', render);
  chapter.addEventListener('change', render);
  render();
}

function panel(title, body) {
  const section = element('section', null, 'problem-panel');
  section.append(element('h2', title), element('p', body));
  return section;
}

function examples(samples, sampleNote) {
  const section = element('section', null, 'problem-panel');
  section.append(element('h2', '样例'));
  if (sampleNote) section.append(element('p', sampleNote));
  for (const [index, sample] of samples.entries()) {
    if (samples.length > 1) section.append(element('h3', `样例 ${index + 1}`));
    const pair = element('div', null, 'sample-pair');
    for (const [key, label] of [['input', '输入'], ['output', '输出']]) {
      const column = element('div');
      column.append(element('h3', sample[key + 'Label'] || label), element('pre', sample[key]));
      pair.append(column);
    }
    section.append(pair);
  }
  return section;
}

function solution(problem) {
  const section = element('section', null, 'problem-panel');
  const details = element('details');
  const actions = element('div', null, 'problem-actions');
  const path = `./solutions/${problem.id}.cpp`;
  const download = link('下载 .cpp', path);
  download.download = `${problem.id}.cpp`;
  const copy = element('button', '复制代码');
  copy.type = 'button';
  copy.disabled = true;
  const feedback = element('span', '展开后加载代码。');
  feedback.setAttribute('role', 'status');
  const code = element('code');
  const pre = element('pre');
  pre.append(code);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      feedback.textContent = '已复制代码。';
    } catch {
      feedback.textContent = '可选中代码手动复制，或下载 .cpp 文件。';
    }
  });
  let pending = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || pending || code.textContent) return;
    pending = true;
    feedback.textContent = '正在加载代码…';
    try {
      code.textContent = await (await load(path)).text();
      feedback.textContent = '';
      copy.disabled = false;
    } catch {
      feedback.textContent = '代码加载失败。可收起后重试，或下载 .cpp 文件。';
    } finally {
      pending = false;
    }
  });
  actions.append(copy, download, feedback);
  details.append(element('summary', '查看题解与 C++17 代码'), element('p', problem.method),
    element('p', problem.complexity), actions, pre);
  section.append(details);
  return section;
}

function showProblem({ problems, difficulties, chapters }) {
  const id = new URLSearchParams(location.search).get('id');
  const problem = problems.find(item => String(item.id) === id);
  if (!problem) {
    status.textContent = '找不到这道题。请从题目列表选择。';
    return;
  }
  const title = `${problem.id} · ${problem.title}`;
  const difficulty = difficulties.find(item => item.id === problem.difficulty).label;
  const chapter = chapters.find(item => item.id === problem.chapter).label;
  document.title = `${title} · 基础算法题库`;
  const article = document.querySelector('#problem-content');
  article.append(element('h1', title), element('p', `${difficulty} · ${chapter} · ${problem.limits}`, 'problem-meta'),
    link('查看 ECNU 原题 ↗', `https://acm.ecnu.edu.cn/problem/${problem.id}/`, 'nav-github'),
    panel('题目', problem.summary), panel('输入', problem.input), panel('输出', problem.output));
  if (problem.constraints) article.append(panel('数据范围与说明', problem.constraints));
  if (problem.samples.length || problem.sampleNote) article.append(examples(problem.samples, problem.sampleNote));
  article.append(solution(problem));
  article.hidden = false;
  status.hidden = true;
}

load('./problems.json')
  .then(response => response.json())
  .then(document.querySelector('#problem-view') ? showProblem : showList)
  .catch(() => { status.textContent = '题库加载失败，请刷新后重试。'; });
