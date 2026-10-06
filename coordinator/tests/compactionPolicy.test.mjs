import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTokens,
  shouldCompactProactively,
  splitTranscript,
  buildSummaryPrompt,
  buildCompactionPrefill,
  truncatePrefillToFit,
  PROACTIVE_THRESHOLD_TOKENS,
  MAX_CONTEXT_TOKENS,
} = require('../dist/compactionPolicy.js');

describe('compactionPolicy', () => {
  it('estimateTokens uses len/4 heuristic', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('a'.repeat(40)), 10);
  });

  it('shouldCompactProactively at threshold', () => {
    assert.equal(shouldCompactProactively(PROACTIVE_THRESHOLD_TOKENS - 1), false);
    assert.equal(shouldCompactProactively(PROACTIVE_THRESHOLD_TOKENS), true);
  });

  it('splitTranscript keeps last N turns in tail', () => {
    const turns = [
      { role: 'user', content: '1', ts: 1 },
      { role: 'assistant', content: '2', ts: 2 },
      { role: 'user', content: '3', ts: 3 },
      { role: 'assistant', content: '4', ts: 4 },
    ];
    const { head, tail } = splitTranscript(turns, 2);
    assert.equal(head.length, 2);
    assert.equal(tail.length, 2);
    assert.equal(tail[0].content, '3');
  });

  it('buildCompactionPrefill omits empty summary block', () => {
    const text = buildCompactionPrefill('', [{ role: 'user', content: 'hi', ts: 1 }]);
    assert.ok(!text.includes('[CONVERSATION SUMMARY]'));
    assert.ok(text.includes('[RECENT MESSAGES]'));
  });

  it('truncatePrefillToFit returns null when single turn too large', () => {
    const huge = 'x'.repeat(MAX_CONTEXT_TOKENS * 8);
    assert.equal(truncatePrefillToFit(huge, 2048), null);
  });
});
