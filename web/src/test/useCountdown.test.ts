import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from '../hooks';

describe('useCountdown hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when target is null', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBe(0);
  });

  it('returns 0 when target has already passed', () => {
    const past = Date.now() - 5000;
    const { result } = renderHook(() => useCountdown(past));
    expect(result.current).toBe(0);
  });

  it('calculates remaining milliseconds accurately and ticks down', () => {
    const target = Date.now() + 10_000;
    const { result } = renderHook(() => useCountdown(target));

    expect(result.current).toBeGreaterThanOrEqual(9900);
    expect(result.current).toBeLessThanOrEqual(10000);

    // Fast forward 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current).toBeGreaterThanOrEqual(6900);
    expect(result.current).toBeLessThanOrEqual(7000);

    // Fast forward remaining 8 seconds (past expiry)
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(result.current).toBe(0);
  });
});
