/**
 * `fold()` is the single place where small groups are hidden before anything
 * is published: categories under K are merged into "other", and an "other"
 * still under K is reported as "< 5" rather than an exact count.
 */
import { describe, expect, it } from 'vitest';
import { fold, K, SMALL } from '@/lib/stats/fold';

describe('fold', () => {
  it('keeps categories at or above K, sorted by installs', () => {
    expect(
      fold([
        { value: '0.5.0', installs: 6 },
        { value: '0.6.0', installs: 12 },
        { value: '0.4.0', installs: K },
      ]),
    ).toEqual([
      { value: '0.6.0', installs: 12 },
      { value: '0.5.0', installs: 6 },
      { value: '0.4.0', installs: 5 },
    ]);
  });

  it('merges categories under K into other, reported as "< 5" when still small', () => {
    expect(
      fold([
        { value: '0.6.0', installs: 12 },
        { value: '0.5.0', installs: 6 },
        { value: '0.4.1', installs: 2 },
      ]),
    ).toEqual([
      { value: '0.6.0', installs: 12 },
      { value: '0.5.0', installs: 6 },
      { value: 'other', installs: SMALL },
    ]);
  });

  it('reports other exactly once enough small categories add up to K', () => {
    expect(
      fold([
        { value: 'a', installs: 10 },
        { value: 'b', installs: 3 },
        { value: 'c', installs: 4 },
      ]),
    ).toEqual([
      { value: 'a', installs: 10 },
      { value: 'other', installs: 7 },
    ]);
  });

  it('adds an existing "other" category to the folded ones', () => {
    expect(
      fold([
        { value: 'react', installs: 9 },
        { value: 'other', installs: 3 },
        { value: 'angular', installs: 2 },
      ]),
    ).toEqual([
      { value: 'react', installs: 9 },
      { value: 'other', installs: 5 },
    ]);
  });

  it('keeps other last even when it is the largest', () => {
    expect(
      fold([
        { value: 'a', installs: 5 },
        { value: 'b', installs: 4 },
        { value: 'c', installs: 4 },
      ]),
    ).toEqual([
      { value: 'a', installs: 5 },
      { value: 'other', installs: 8 },
    ]);
  });

  it('omits other when nothing was folded', () => {
    expect(fold([{ value: 'a', installs: 7 }])).toEqual([
      { value: 'a', installs: 7 },
    ]);
  });

  it('never names a category under K', () => {
    const folded = fold([
      { value: 'common', installs: 20 },
      { value: 'acme-build', installs: 1 },
    ]);

    expect(folded.map((entry) => entry.value)).not.toContain('acme-build');
  });

  it('publishes only value and installs', () => {
    const input = [{ value: 'a', installs: 9, type: 'react', secret: 'x' }];

    expect(fold(input)).toEqual([{ value: 'a', installs: 9 }]);
  });

  it('K is 5', () => {
    expect(K).toBe(5);
    expect(SMALL).toBe('< 5');
  });
});
