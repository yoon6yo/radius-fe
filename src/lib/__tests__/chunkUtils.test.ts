import { describe, it, expect } from 'vitest';
import { buildChunk, parseChunk, calcTotalChunks } from '@/lib/chunkUtils';
import { CHUNK_SIZE } from '@/constants/transfer';

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
