import { describe, it, expect } from 'vitest';
import { buildChunk, parseChunk, calcTotalChunks, sanitizeFileName, isValidFileMeta } from '@/lib/chunkUtils';
import { CHUNK_SIZE, MAX_FILE_NAME_LENGTH } from '@/constants/transfer';
import type { FileMeta } from '@/types/transfer';

describe('buildChunk / parseChunk', () => {
  it('roundtrip: index와 data가 복원된다', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const packet = buildChunk(42, data);
    const result = parseChunk(packet);

    expect(result.chunkIndex).toBe(42);
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('4바이트 little-endian prefix가 올바르게 인코딩된다', () => {
    const data = new ArrayBuffer(0);
    const packet = buildChunk(0x01020304, data);
    const view = new DataView(packet);
    // little-endian: [0x04, 0x03, 0x02, 0x01]
    expect(view.getUint8(0)).toBe(0x04);
    expect(view.getUint8(1)).toBe(0x03);
    expect(view.getUint8(2)).toBe(0x02);
    expect(view.getUint8(3)).toBe(0x01);
  });

  it('chunkIndex = 0 처리', () => {
    const data = new Uint8Array([9]).buffer;
    const { chunkIndex, data: out } = parseChunk(buildChunk(0, data));
    expect(chunkIndex).toBe(0);
    expect(new Uint8Array(out)[0]).toBe(9);
  });

  it('빈 data도 처리된다', () => {
    const packet = buildChunk(7, new ArrayBuffer(0));
    expect(packet.byteLength).toBe(4);
    const result = parseChunk(packet);
    expect(result.chunkIndex).toBe(7);
    expect(result.data.byteLength).toBe(0);
  });

  it('대용량 chunkIndex (uint32 max)가 정확히 인코딩된다', () => {
    const max = 0xffffffff;
    const packet = buildChunk(max, new ArrayBuffer(0));
    const { chunkIndex } = parseChunk(packet);
    expect(chunkIndex).toBe(max);
  });

  it('전체 패킷 크기는 4 + data.byteLength', () => {
    const data = new Uint8Array(100).buffer;
    expect(buildChunk(0, data).byteLength).toBe(104);
  });
});

describe('calcTotalChunks', () => {
  it('빈 파일은 0', () => {
    expect(calcTotalChunks(0)).toBe(0);
  });

  it('정확히 CHUNK_SIZE이면 1', () => {
    expect(calcTotalChunks(CHUNK_SIZE)).toBe(1);
  });

  it('CHUNK_SIZE보다 1바이트 크면 2', () => {
    expect(calcTotalChunks(CHUNK_SIZE + 1)).toBe(2);
  });

  it('1바이트 파일도 1', () => {
    expect(calcTotalChunks(1)).toBe(1);
  });

  it('임의 크기에 대해 올림 적용', () => {
    expect(calcTotalChunks(CHUNK_SIZE * 3 - 1)).toBe(3);
    expect(calcTotalChunks(CHUNK_SIZE * 3)).toBe(3);
    expect(calcTotalChunks(CHUNK_SIZE * 3 + 1)).toBe(4);
  });

  it('커스텀 chunkSize 파라미터 지원', () => {
    expect(calcTotalChunks(10, 3)).toBe(4); // ceil(10/3)
  });
});

describe('sanitizeFileName', () => {
  it('평범한 파일명은 그대로 유지된다', () => {
    expect(sanitizeFileName('report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('사진 2024.zip')).toBe('사진 2024.zip');
  });

  it('C0 제어문자를 제거한다', () => {
    const withControl = 'evil' + String.fromCharCode(0x0001) + '.txt';
    expect(sanitizeFileName(withControl)).toBe('evil.txt');
  });

  it('DEL(0x7F)을 제거한다', () => {
    const withDel = 'a' + String.fromCharCode(0x007f) + 'b.txt';
    expect(sanitizeFileName(withDel)).toBe('ab.txt');
  });

  it('RTL override(U+202E) 등 방향성 제어문자를 제거한다 — 확장자 위장 방지', () => {
    // "invoice" + RLO + "fdp.exe" 처럼 보이도록 조작된 이름에서 RLO를 제거하면
    // 시각적 위장 없이 실제 문자만 남는다.
    const spoofed = 'invoice' + String.fromCharCode(0x202e) + 'fdp.exe';
    const result = sanitizeFileName(spoofed);
    expect(result).not.toContain(String.fromCharCode(0x202e));
    expect(result).toBe('invoicefdp.exe');
  });

  it('LRM/RLM/LRI 등 다른 bidi 제어문자도 제거한다', () => {
    const chars = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x2066, 0x2067, 0x2068, 0x2069];
    for (const code of chars) {
      const name = 'a' + String.fromCharCode(code) + 'b';
      expect(sanitizeFileName(name)).toBe('ab');
    }
  });

  it('제거 후 빈 문자열이면 fallback 이름을 사용한다', () => {
    const onlyControl = String.fromCharCode(0x0001) + String.fromCharCode(0x0002);
    expect(sanitizeFileName(onlyControl)).toBe('file');
  });

  it('앞뒤 공백을 trim한다', () => {
    expect(sanitizeFileName('  spaced.txt  ')).toBe('spaced.txt');
  });
});

describe('isValidFileMeta', () => {
  const base: FileMeta = {
    type: 'FILE_META',
    fileId: 'f1',
    fileName: 'test.bin',
    fileSize: CHUNK_SIZE * 2,
    chunkSize: CHUNK_SIZE,
    totalChunks: 2,
    totalHashParts: 1,
  };

  it('정상적인 메타데이터는 통과한다', () => {
    expect(isValidFileMeta(base)).toBe(true);
  });

  it('빈 파일명은 거부한다', () => {
    expect(isValidFileMeta({ ...base, fileName: '' })).toBe(false);
  });

  it('너무 긴 파일명은 거부한다', () => {
    expect(isValidFileMeta({ ...base, fileName: 'a'.repeat(MAX_FILE_NAME_LENGTH + 1) })).toBe(false);
  });

  it('음수/무한대 fileSize는 거부한다', () => {
    expect(isValidFileMeta({ ...base, fileSize: -1 })).toBe(false);
    expect(isValidFileMeta({ ...base, fileSize: Infinity })).toBe(false);
  });

  it('chunkSize가 프로토콜 상수와 다르면 거부한다', () => {
    expect(isValidFileMeta({ ...base, chunkSize: 1024 })).toBe(false);
  });

  it('totalChunks가 fileSize/chunkSize와 안 맞으면 거부한다 (조작 방지)', () => {
    expect(isValidFileMeta({ ...base, totalChunks: 999 })).toBe(false);
  });

  it('totalChunks가 정수가 아니면 거부한다', () => {
    expect(isValidFileMeta({ ...base, totalChunks: 2.5 })).toBe(false);
  });
});
