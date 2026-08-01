import assert from 'node:assert/strict';
import { resolveCalculationConvention } from './prayerTimes.ts';

assert.equal(resolveCalculationConvention('TR'), 'turkey');
assert.equal(resolveCalculationConvention('tr'), 'turkey');
assert.equal(resolveCalculationConvention('SA'), 'umm-al-qura');
assert.equal(resolveCalculationConvention('sa'), 'umm-al-qura');
assert.equal(resolveCalculationConvention('DE'), 'muslim-world-league');
assert.equal(resolveCalculationConvention(null), 'muslim-world-league');

console.log('prayer calculation convention tests passed (6 assertions)');
