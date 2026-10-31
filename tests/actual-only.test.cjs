'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('study UI has no standalone planned-time totals or editing dialog; original durations remain stage weights', () => {
  for (const filename of ['index.html', 'app.js', 'export-image.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../study', filename), 'utf8');
    assert(!source.includes('预计'), filename);
    assert(!source.includes('estimated-time'), filename);
    assert(!source.includes('stage-progress'), filename);
    assert(!source.includes('estimate-dialog'), filename);
  }
  const source = fs.readFileSync(path.join(__dirname, '../study/app.js'), 'utf8');
  assert(!source.includes('getEstimate'));
});
