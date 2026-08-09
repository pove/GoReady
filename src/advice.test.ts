import { describe, expect, it } from 'vitest';
import { decideAdviceAction } from './advice';

describe('decideAdviceAction', () => {
  // Regression: on a no-data day the app used to write an empty value to
  // "clear" the field regardless of what was already stored. Reported from a
  // real account where a stale real value (from an earlier point in the day)
  // sat in TrainingAdvice even after taking today's HRV measurement had not
  // yet happened - the clear either never went out or never round-tripped as
  // blank, and either way, no data means nothing correct exists to send.
  it('skips the write entirely on a no-data day, whatever is already stored', () => {
    expect(decideAdviceAction(null, undefined)).toEqual({ action: 'skip', status: { kind: 'no-data' } });
    expect(decideAdviceAction(null, '')).toEqual({ action: 'skip', status: { kind: 'no-data' } });
    expect(decideAdviceAction(null, '3')).toEqual({ action: 'skip', status: { kind: 'no-data' } });
  });

  it('writes when nothing is stored yet', () => {
    expect(decideAdviceAction(3, undefined)).toEqual({ action: 'write', status: { kind: 'sent' } });
    expect(decideAdviceAction(3, '')).toEqual({ action: 'write', status: { kind: 'sent' } });
  });

  it('skips the write when the stored value already matches', () => {
    expect(decideAdviceAction(3, '3')).toEqual({ action: 'skip', status: { kind: 'already-set' } });
  });

  // Regression: the previous check was "is *something* stored", not "is the
  // *correct* thing stored" - so a stale value (an old code from earlier in
  // the day, or in the reported case, a leftover empty-clear write) would
  // permanently block the real value from ever being sent that day, once
  // real data did arrive.
  it('overwrites a stale value that differs from what would be sent now', () => {
    expect(decideAdviceAction(3, '1')).toEqual({ action: 'write', status: { kind: 'sent' } });
    expect(decideAdviceAction(3, '99')).toEqual({ action: 'write', status: { kind: 'sent' } });
  });

  it('compares numerically, tolerant of incidental formatting', () => {
    expect(decideAdviceAction(3, '3.0')).toEqual({ action: 'skip', status: { kind: 'already-set' } });
    expect(decideAdviceAction(3, ' 3 ')).toEqual({ action: 'skip', status: { kind: 'already-set' } });
  });
});
