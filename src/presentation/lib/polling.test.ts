import { describe, expect, it } from 'vitest';
import { pollingIntervalMs } from './polling';

describe('pollingIntervalMs', () => {
  it('converts whole minutes to milliseconds', () => {
    expect(pollingIntervalMs(5)).toBe(300_000);
  });

  it('disables polling for zero', () => {
    expect(pollingIntervalMs(0)).toBe(false);
  });

  it('disables polling for negative values', () => {
    expect(pollingIntervalMs(-1)).toBe(false);
  });

  it('disables polling for NaN', () => {
    expect(pollingIntervalMs(Number.NaN)).toBe(false);
  });

  it('disables polling for non-finite values', () => {
    expect(pollingIntervalMs(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rounds fractional minutes to the nearest millisecond', () => {
    expect(pollingIntervalMs(0.5)).toBe(30_000);
  });

  it('supports large intervals', () => {
    expect(pollingIntervalMs(120)).toBe(7_200_000);
  });
});
