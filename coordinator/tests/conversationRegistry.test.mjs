import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  ConversationRegistry,
  CONVERSATION_IDLE_TTL_MS,
} = require('../dist/conversationRegistry.js');
const { sessionTracker } = require('../dist/sessionTracker.js');

describe('ConversationRegistry', () => {
  /** @type {ConversationRegistry} */
  let reg;

  beforeEach(() => {
    reg = new ConversationRegistry();
    sessionTracker.clear();
  });

  it('get returns undefined for unknown id', () => {
    assert.equal(reg.get('missing'), undefined);
  });

  it('set then get returns entry', () => {
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 10,
      lastActiveMs: Date.now(),
      model: 'm',
    });
    const e = reg.get('c1');
    assert.equal(e.sessionId, 's1');
    assert.equal(e.workerId, 'w1');
  });

  it('delete removes entry', () => {
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now(),
      model: 'm',
    });
    reg.delete('c1');
    assert.equal(reg.get('c1'), undefined);
  });

  it('expired entry is dropped on get', () => {
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now() - CONVERSATION_IDLE_TTL_MS - 1,
      model: 'm',
    });
    assert.equal(reg.get('c1'), undefined);
  });

  it('expired entry dropped on get ends sessionTracker accounting', () => {
    sessionTracker.sessionStart('s1', 'w1', 1000);
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now() - CONVERSATION_IDLE_TTL_MS - 1,
      model: 'm',
    });
    assert.equal(sessionTracker.hasSession('s1'), true);
    assert.equal(reg.get('c1'), undefined);
    assert.equal(sessionTracker.hasSession('s1'), false);
  });

  it('sweepExpired removes idle entries and returns them', () => {
    reg.set('fresh', {
      sessionId: 's-fresh',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now(),
      model: 'm',
    });
    reg.set('stale', {
      sessionId: 's-stale',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now() - CONVERSATION_IDLE_TTL_MS - 1,
      model: 'm',
    });

    const expired = reg.sweepExpired();

    assert.equal(expired.length, 1);
    assert.equal(expired[0].sessionId, 's-stale');
    assert.equal(reg.get('stale'), undefined);
    // Untouched entry survives the sweep.
    const survivor = reg.get('fresh');
    assert.equal(survivor.sessionId, 's-fresh');
  });

  it('sweepExpired ends sessionTracker accounting for abandoned conversations', () => {
    sessionTracker.sessionStart('s-abandoned', 'w1', 2048);
    reg.set('abandoned', {
      sessionId: 's-abandoned',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now() - CONVERSATION_IDLE_TTL_MS - 1,
      model: 'm',
    });

    assert.equal(sessionTracker.activeCount, 1);
    reg.sweepExpired();
    assert.equal(sessionTracker.activeCount, 0);
    assert.equal(sessionTracker.hasSession('s-abandoned'), false);
  });

  it('release removes drained tail from map', async () => {
    const release = await reg.acquire('c1');
    assert.equal(reg.hasTail('c1'), true);
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(reg.hasTail('c1'), false);
  });

  it('acquire is FIFO', async () => {
    const order = [];
    const r1 = reg.acquire('c1').then(async (release) => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
      release();
    });
    const r2 = reg.acquire('c1').then(async (release) => {
      order.push('b-start');
      release();
    });
    await Promise.all([r1, r2]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start']);
  });
});
