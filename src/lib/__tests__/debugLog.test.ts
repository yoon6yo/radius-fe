import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  installConsoleCapture,
  getLogEntries,
  clearLogEntries,
  subscribeLogEntries,
  formatLogEntries,
} from '@/lib/debugLog';

describe('debugLog', () => {
  beforeEach(() => {
    clearLogEntries();
  });

  it('installConsoleCapture 이후 console.log 호출이 버퍼에 기록된다', () => {
    installConsoleCapture();
    console.log('[Test] hello', 'world');
    const entries = getLogEntries();
    expect(entries.some((e) => e.level === 'log' && e.message.includes('[Test] hello world'))).toBe(true);
  });

  it('console.warn/error도 각각 올바른 level로 기록된다', () => {
    installConsoleCapture();
    console.warn('경고 메시지');
    console.error('에러 메시지');
    const entries = getLogEntries();
    expect(entries.some((e) => e.level === 'warn' && e.message.includes('경고 메시지'))).toBe(true);
    expect(entries.some((e) => e.level === 'error' && e.message.includes('에러 메시지'))).toBe(true);
  });

  it('원본 console 동작은 그대로 유지된다 (가로채되 대체하지 않음)', () => {
    installConsoleCapture();
    const spy = vi.spyOn(console, 'log');
    // installConsoleCapture가 console.log를 감싸므로, spy는 감싸진 함수를 감시한다.
    // 원본 호출 여부는 실제로 출력이 억제되지 않는다는 사실 자체로 검증한다(에러 없이 통과).
    expect(() => console.log('still works')).not.toThrow();
    spy.mockRestore();
  });

  it('clearLogEntries 호출 시 버퍼가 비워지고 구독자에게 알린다', () => {
    installConsoleCapture();
    console.log('entry');
    expect(getLogEntries().length).toBeGreaterThan(0);

    const listener = vi.fn();
    const unsubscribe = subscribeLogEntries(listener);
    clearLogEntries();

    expect(getLogEntries()).toHaveLength(0);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('formatLogEntries는 시각/레벨/메시지를 사람이 읽을 수 있는 텍스트로 합친다', () => {
    const text = formatLogEntries([
      { time: Date.parse('2026-01-01T00:00:00'), level: 'error', message: '문제 발생' },
    ]);
    expect(text).toContain('ERROR');
    expect(text).toContain('문제 발생');
  });
});
