import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { decodeTracker, getDecodeAdmissionConfig } = require('../dist/decodeTracker.js');

describe('decodeTracker', () => {
  beforeEach(() => {
    decodeTracker.clear();
  });

  it('starts empty', () => {
    assert.equal(decodeTracker.getTotal(), 0);
    assert.equal(decodeTracker.getWorkerCount('w1'), 0);
  });

  it('tracks per-worker and total counts', () => {
    decodeTracker.decodeStart('s1', 'w1');
    decodeTracker.decodeStart('s2', 'w1');
    decodeTracker.decodeStart('s3', 'w2');

    assert.equal(decodeTracker.getTotal(), 3);
    assert.equal(decodeTracker.getWorkerCount('w1'), 2);
    assert.equal(decodeTracker.getWorkerCount('w2'), 1);
  });

  it('decodeEnd is idempotent', () => {
    decodeTracker.decodeStart('s1', 'w1');
    decodeTracker.decodeEnd('s1');
    decodeTracker.decodeEnd('s1');

    assert.equal(decodeTracker.getTotal(), 0);
    assert.equal(decodeTracker.getWorkerCount('w1'), 0);
  });

  it('rejects when system decode limit reached', () => {
    const config = getDecodeAdmissionConfig();
    for (let i = 0; i < config.maxTotalInFlightDecodes; i++) {
      decodeTracker.decodeStart(`s${i}`, 'w1');
    }

    const result = decodeTracker.canAccept();
    assert.equal(result.canAccept, false);
    assert.equal(result.reason, 'system_in_flight_decode_full');
  });

  it('rejects when worker decode limit reached', () => {
    const config = getDecodeAdmissionConfig();
    for (let i = 0; i < config.maxInFlightDecodesPerWorker; i++) {
      decodeTracker.decodeStart(`s${i}`, 'w1');
    }

    const result = decodeTracker.canAccept('w1');
    assert.equal(result.canAccept, false);
    assert.equal(result.reason, 'worker_in_flight_decode_full');
  });

  it('canAcceptOnAnyWorker requires a worker with decode headroom', () => {
    const config = getDecodeAdmissionConfig();
    for (let i = 0; i < config.maxInFlightDecodesPerWorker; i++) {
      decodeTracker.decodeStart(`s${i}`, 'w1');
    }

    const blocked = decodeTracker.canAcceptOnAnyWorker(['w1']);
    assert.equal(blocked.canAccept, false);
    assert.equal(blocked.reason, 'all_workers_decode_busy');

    const allowed = decodeTracker.canAcceptOnAnyWorker(['w1', 'w2']);
    assert.equal(allowed.canAccept, true);
  });
});
