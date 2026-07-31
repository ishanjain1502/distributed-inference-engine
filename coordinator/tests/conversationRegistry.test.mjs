import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  ConversationRegistry,
  CONVERSATION_IDLE_TTL_MS,
} = require('../dist/conversationRegistry.js');

describe('ConversationRegistry', () => {
  /** @type {ConversationRegistry} */
  let reg;

  beforeEach(() => {
    reg = new ConversationRegistry();
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
