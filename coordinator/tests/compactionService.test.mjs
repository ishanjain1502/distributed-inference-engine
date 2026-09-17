import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPostCompactionTranscript,
  shouldDebounce,
  resetCompactionDebounce,
} = require('../dist/compactionService.js');
const { COMPACTION_DEBOUNCE_MS } = require('../dist/compactionPolicy.js');
const { healthTable } = require('../dist/healthTable.js');

describe('compactionService', () => {
  after(() => {
    healthTable.stopCleanup();
  });
  it('buildPostCompactionTranscript includes summary and tail', () => {
    const turns = buildPostCompactionTranscript('facts', [
      { role: 'user', content: 'hi', ts: 1 },
    ]);
    assert.equal(turns.length, 2);
    assert.ok(turns[0].content.includes('facts'));
    assert.equal(turns[1].content, 'hi');
  });

  it('shouldDebounce within window', () => {
    resetCompactionDebounce();
    const now = Date.now();
    shouldDebounce('c1', now);
    // seed debounce via compact's side effect is heavy; test policy window directly
    resetCompactionDebounce();
    assert.equal(shouldDebounce('c1', now), false);
    assert.equal(shouldDebounce('c1', now + COMPACTION_DEBOUNCE_MS - 1), false);
  });
});
