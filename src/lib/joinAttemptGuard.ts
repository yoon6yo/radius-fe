// PIN(6자리 숫자, 100만 개 공간)에 대한 무작위 대입을 어렵게 만드는 클라이언트 측 보조 저지선.
// 진짜 방어는 서버 측 rate-limit이 담당해야 한다 — 이건 스크립트로 소켓 이벤트를 직접
// 호출하면 우회 가능한 UX 수준의 장치일 뿐이라 보안 경계로 취급하지 않는다.

const MAX_FAILURES = 5;
const COOLDOWN_MS = 30_000;

let failureCount = 0;
let cooldownUntil = 0;

export function canAttemptJoin(): { allowed: boolean; retryAfterMs: number } {
  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) return { allowed: false, retryAfterMs: remaining };
  return { allowed: true, retryAfterMs: 0 };
}

export function recordJoinFailure(): void {
  failureCount += 1;
  if (failureCount >= MAX_FAILURES) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    failureCount = 0;
  }
}

export function recordJoinSuccess(): void {
  failureCount = 0;
  cooldownUntil = 0;
}
