import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { TranscriptStore } = require('../dist/transcriptStore.js');

describe('TranscriptStore', () => {
  let store;
  beforeEach(() => {
    store = new TranscriptStore();
  });

  it('append and get round-trip', () => {
    store.append('c1', { role: 'user', content: 'hi', ts: 1 });
    assert.equal(store.get('c1').length, 1);
  });

  it('replace overwrites transcript', () => {
    store.append('c1', { role: 'user', content: 'old', ts: 1 });
    store.replace('c1', [{ role: 'assistant', content: 'summary', ts: 2 }]);
    assert.equal(store.get('c1')[0].content, 'summary');
  });

  it('delete removes conversation', () => {
    store.append('c1', { role: 'user', content: 'x', ts: 1 });
    store.delete('c1');
    assert.deepEqual(store.get('c1'), []);
  });
});
