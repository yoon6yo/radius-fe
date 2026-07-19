import { describe, it, expect } from 'vitest';
import { Sha256Stream } from '@/lib/sha256Stream';

async function subtleHex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('Sha256Stream', () => {
  it('빈 입력에 대해 알려진 SHA-256 값을 반환한다', () => {
    const s = new Sha256Stream();
    expect(s.digestHex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"abc"에 대해 알려진 SHA-256 값을 반환한다', () => {
    const s = new Sha256Stream();
    s.update(new TextEncoder().encode('abc'));
    expect(s.digestHex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('56바이트 경계(패딩 두 블록 분기)를 넘는 긴 문자열도 알려진 값과 일치한다', () => {
    const s = new Sha256Stream();
    s.update(
      new TextEncoder().encode(
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      ),
    );
    expect(s.digestHex()).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('64바이트 정확히 한 블록에 대해 WebCrypto와 결과가 일치한다', async () => {
    const bytes = new Uint8Array(64).map((_, i) => i);
    const s = new Sha256Stream();
    s.update(bytes);
    expect(s.digestHex()).toBe(await subtleHex(bytes));
  });

  it('한 번에 넣든 여러 청크로 나눠 넣든 결과가 같다 (스트리밍 정합성)', () => {
    const bytes = new Uint8Array(200_003).map((_, i) => (i * 7) & 0xff);

    const once = new Sha256Stream();
    once.update(bytes);

    const chunked = new Sha256Stream();
    for (let i = 0; i < bytes.length; i += 65536) {
      chunked.update(bytes.subarray(i, i + 65536));
    }

    const byteAtATime = new Sha256Stream();
    for (let i = 0; i < 300; i++) {
      byteAtATime.update(bytes.subarray(i, i + 1));
    }

    expect(chunked.digestHex()).toBe(once.digestHex());
    expect(byteAtATime.digestHex()).toBe(
      (() => {
        const s = new Sha256Stream();
        s.update(bytes.subarray(0, 300));
        return s.digestHex();
      })(),
    );
  });

  it('임의 크기 데이터에서 WebCrypto SubtleCrypto 결과와 정확히 일치한다', async () => {
    for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 1000, 65536, 65537, 200_003]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 11) & 0xff);
      const s = new Sha256Stream();
      // 청크를 임의 크기(4096)로 나눠 넣어 스트리밍 경로를 실제로 타게 함
      for (let i = 0; i < bytes.length; i += 4096) {
        s.update(bytes.subarray(i, i + 4096));
      }
      expect(s.digestHex()).toBe(await subtleHex(bytes));
    }
  });
});
