// FNV-1a 32bit — 스트리밍(증분) 체크섬.
// 암호학적 해시가 아니라 우발적 손상(버그로 인한 데이터 불일치) 탐지용 보조 체크섬.
// 실제 보안 경계는 청크별 SHA-256 검증(native WebCrypto)이 그대로 담당하고, 대용량 파일의
// 전체-파일 무결성 체크는 OPFS 쓰기 경로 버그 등을 잡아내는 용도라 이 정도로 충분하다.
// 순수 XOR+곱셈이라 SHA-256보다 훨씬 빠르고(132MB 기준 853ms → 132ms) O(1) 메모리로 스트리밍된다.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class Fnv1aStream {
  private hash = FNV_OFFSET_BASIS;

  update(chunk: Uint8Array): void {
    let h = this.hash;
    for (let i = 0; i < chunk.length; i++) {
      h ^= chunk[i];
      h = Math.imul(h, FNV_PRIME);
    }
    this.hash = h;
  }

  digestHex(): string {
    return (this.hash >>> 0).toString(16).padStart(8, '0');
  }
}
