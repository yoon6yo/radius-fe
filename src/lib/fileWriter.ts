// FileWriter 추상화 인터페이스 — 추후 Tauri/Capacitor 환경에서 동일 인터페이스로 교체 가능
export interface FileWriter {
  write(chunk: ArrayBuffer, offset: number): Promise<void>;
  close(): Promise<void>;
}

// ── OPFS 구현체 ─────────────────────────────────────────────

export class OPFSFileWriter implements FileWriter {
  private writable: FileSystemWritableFileStream | null = null;

  private constructor() {}

  // isResume=false: 파일을 0바이트로 초기화 → 이전 전송 잔여 바이트 방지
  // isResume=true: 기존 데이터 유지 → 이어받기 시 수신된 청크 보존
  static async create(fileName: string, isResume = false): Promise<OPFSFileWriter> {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    const writer = new OPFSFileWriter();
    writer.writable = await fileHandle.createWritable({ keepExistingData: isResume });
    return writer;
  }

  async write(chunk: ArrayBuffer, offset: number): Promise<void> {
    // position 지정으로 랜덤 접근 쓰기 (청크 순서 무관)
    await this.writable!.write({ type: 'write', position: offset, data: chunk });
  }

  async close(): Promise<void> {
    await this.writable!.close();
    this.writable = null;
  }
}

// ── OPFS 파일 → Blob 다운로드 내보내기 ──────────────────────

export async function exportFromOPFS(
  fileName: string,
  _mimeType = 'application/octet-stream',
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(fileName);
  const file = await fileHandle.getFile();

  onProgress?.(0, file.size);

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  onProgress?.(file.size, file.size);

  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
}

export async function deleteFromOPFS(fileName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
  } catch {
    // 파일이 없어도 무시
  }
}
