import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { subscribeDashboard, type SseSource } from '@/components/useDashboard';

class FakeSource implements SseSource {
  readyState = 0;
  onopen: SseSource['onopen'] = null;
  onerror: SseSource['onerror'] = null;
  onmessage: SseSource['onmessage'] = null;
  closed = false;
  close() { this.closed = true; this.readyState = 2; }
  fail(readyState: number) { this.readyState = readyState; this.onerror?.(new Event('error')); }
}

describe('subscribeDashboard', () => {
  let sources: FakeSource[];
  let connected: boolean[];
  const subscribe = () => subscribeDashboard({
    create: () => { const s = new FakeSource(); sources.push(s); return s; },
    onData: () => {},
    onConnected: (c) => connected.push(c),
    delayMs: 2000,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    connected = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets EventSource retry on its own while CONNECTING', () => {
    subscribe();
    sources[0].fail(0);
    vi.advanceTimersByTime(10_000);
    expect(sources).toHaveLength(1);
    expect(connected).toEqual([false]);
  });

  it('recreates the source 2 s after it reached CLOSED', () => {
    subscribe();
    sources[0].fail(2);
    vi.advanceTimersByTime(1999);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    sources[1].onopen?.(new Event('open'));
    expect(connected).toEqual([false, true]);

    // Et encore, si la nouvelle source est à son tour fermée.
    sources[1].fail(2);
    vi.advanceTimersByTime(2000);
    expect(sources).toHaveLength(3);
  });

  it('stops retrying once unsubscribed', () => {
    const unsubscribe = subscribe();
    sources[0].fail(2);
    unsubscribe();
    vi.advanceTimersByTime(10_000);
    expect(sources).toHaveLength(1);
    expect(sources[0].closed).toBe(true);
  });
});
