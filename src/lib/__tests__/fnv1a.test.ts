import { describe, it, expect } from 'vitest';
import { Fnv1aStream } from '@/lib/fnv1a';

function hashOf(str: string): string {
  const s = new Fnv1aStream();
  s.update(new TextEncoder().encode(str));
  return s.digestHex();
}

describe('Fnv1aStream', () => {
  it('빈 입력은 FNV offset basis 그대로 반환한다', () => {
    expect(hashOf('')).toBe('811c9dc5');
  });

  it('"a"에 대해 알려진 FNV-1a 값을 반환한다', () => {
    expect(hashOf('a')).toBe('e40c292c');
  });

  it('"foobar"에 대해 알려진 FNV-1a 값을 반환한다', () => {
    expect(hashOf('foobar')).toBe('bf9cf968');
  });

  it('한 번에 넣든 여러 청크로 나눠 넣든 결과가 같다 (스트리밍 정합성)', () => {
    const bytes = new Uint8Array(200_003).map((_, i) => (i * 7) & 0xff);

    const once = new Fnv1aStream();
    once.update(bytes);

    const chunked = new Fnv1aStream();
    for (let i = 0; i < bytes.length; i += 65536) {
      chunked.update(bytes.subarray(i, i + 65536));
    }

    const byteAtATime = new Fnv1aStream();
    for (let i = 0; i < 300; i++) {
      byteAtATime.update(bytes.subarray(i, i + 1));
    }
    const referenceForFirst300 = new Fnv1aStream();
    referenceForFirst300.update(bytes.subarray(0, 300));

    expect(chunked.digestHex()).toBe(once.digestHex());
    expect(byteAtATime.digestHex()).toBe(referenceForFirst300.digestHex());
  });

  it('항상 8자리 hex(32bit)를 반환한다', () => {
    expect(hashOf('x')).toHaveLength(8);
    expect(hashOf('')).toHaveLength(8);
  });
});
