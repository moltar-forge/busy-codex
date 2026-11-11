import assert from 'node:assert/strict';
import { normalize } from './sync.mjs';
const window = (usedPercent, windowDurationMins = 10080) => ({ usedPercent, windowDurationMins, resetsAt: 1794527558 });
assert.deepEqual(normalize({ rateLimits: { primary: window(62) } }, 100), { remaining: 38, windowMins: 10080, resetsAt: 1794527558, updatedAt: 100 });
assert.equal(normalize({ rateLimits: { primary: window(20), secondary: window(95, 300) } }).remaining, 5);
assert.equal(normalize({ rateLimitsByLimitId: { codex: { primary: window(100) } }, rateLimits: { primary: window(0) } }).remaining, 0);
assert.throws(() => normalize({ rateLimits: { primary: window(NaN) } }));
assert.throws(() => normalize({ rateLimits: {} }));
console.log('Usage normalization checks passed');
