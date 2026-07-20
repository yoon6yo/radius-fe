import { describe, it, expect } from 'vitest';
import { SpeedTracker } from '@/lib/speedTracker';

describe('SpeedTracker', () => {
  it('첫 기록은 이전 지점이 없어 속도 0을 반환한다', () => {
    const tracker = new SpeedTracker();
    expect(tracker.record(1000, 0)).toBe(0);
  });

  it('두 지점 사이 델타로 순간 속도를 계산한다', () => {
    const tracker = new SpeedTracker();
    tracker.record(1000, 0);
    const speed = tracker.record(2000, 1000); // 1000 bytes / 1s
    expect(speed).toBe(1000);
  });

  it('여러 샘플의 이동평균을 반환해 순간값 급변을 완화한다', () => {
    const tracker = new SpeedTracker();
    tracker.record(1000, 0);
    tracker.record(2000, 1000); // 1000 B/s
    const speed = tracker.record(3000, 11000); // 10000 B/s → 평균은 두 값 사이
    expect(speed).toBe((1000 + 10000) / 2);
  });

  it('윈도우 크기를 초과하면 오래된 샘플을 버린다', () => {
    const tracker = new SpeedTracker();
    let now = 1000;
    let bytes = 0;
    tracker.record(now, bytes);
    // 처음 큰 스파이크 하나
    now += 1000; bytes += 100_000;
    tracker.record(now, bytes);
    // 이후 계속 느린 속도로 5회 이상 기록해 윈도우를 밀어냄
    let speed = 0;
    for (let i = 0; i < 6; i++) {
      now += 1000; bytes += 100;
      speed = tracker.record(now, bytes);
    }
    // 초기 스파이크가 윈도우에서 밀려나 평균이 낮은 속도에 수렴해야 한다
    expect(speed).toBeLessThan(1000);
  });

  it('reset 후에는 이전 샘플이 새 계산에 섞이지 않는다', () => {
    const tracker = new SpeedTracker();
    tracker.record(1000, 0);
    tracker.record(2000, 1_000_000); // 매우 빠른 속도
    tracker.reset();
    expect(tracker.record(5000, 0)).toBe(0);
    const speed = tracker.record(6000, 100); // 100 B/s, 이전 스파이크 영향 없어야 함
    expect(speed).toBe(100);
  });

  it('시간이 역행하거나 정지된 틱은 샘플에 추가하지 않는다', () => {
    const tracker = new SpeedTracker();
    tracker.record(1000, 0);
    const speed = tracker.record(1000, 500); // elapsed === 0
    expect(speed).toBe(0);
  });
});
