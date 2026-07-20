// 순간 속도(직전 두 틱 사이 델타)만으로 ETA를 내면 네트워크 지터에 따라 값이 크게
// 출렁인다 — 최근 N개 순간 속도 샘플의 이동평균을 대신 사용해 완만하게 만든다.
const SPEED_SAMPLE_WINDOW = 5;

export class SpeedTracker {
  private samples: number[] = [];
  private lastTime = 0;
  private lastBytes = 0;

  // 새 파일 전송이 시작될 때 이전 파일의 샘플이 섞여 들어가지 않도록 초기화한다.
  reset(): void {
    this.samples = [];
    this.lastTime = 0;
    this.lastBytes = 0;
  }

  // 진행률 지점을 기록하고 이동평균 속도(bytes/sec)를 반환한다.
  record(now: number, bytes: number): number {
    if (this.lastTime > 0) {
      const elapsed = (now - this.lastTime) / 1000;
      if (elapsed > 0) {
        const instantBps = Math.max(0, (bytes - this.lastBytes) / elapsed);
        this.samples.push(instantBps);
        if (this.samples.length > SPEED_SAMPLE_WINDOW) this.samples.shift();
      }
    }
    this.lastTime = now;
    this.lastBytes = bytes;

    if (this.samples.length === 0) return 0;
    return this.samples.reduce((sum, s) => sum + s, 0) / this.samples.length;
  }
}
