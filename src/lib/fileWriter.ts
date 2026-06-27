// FileWriter 추상화 인터페이스 — 추후 Tauri/Capacitor 환경에서 동일 인터페이스로 교체 가능
export interface FileWriter {
  write(chunk: ArrayBuffer, offset: number): Promise<void>;
  close(): Promise<void>;
}

// ── OPFS 구현체 ─────────────────────────────────────────────

export class OPFSFileWriter implements FileWriter {
  private handle: FileSystemSyncAccessHandle | null = null;

  private constructor() {}

  static async create(fileName: string): Promise<OPFSFileWriter> {
    const root = await navigator.storage.getDirectory();
    // 같은 파일명이 이미 존재하면 덮어쓰기 (이어받기 시나리오에서는 기존 파일 유지)
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    const writer = new OPFSFileWriter();
    writer.handle = await fileHandle.createSyncAccessHandle();
    return writer;
  }

  async write(chunk: ArrayBuffer, offset: number): Promise<void> {
    this.handle!.write(chunk, { at: offset });
  }

  async close(): Promise<void> {
    this.handle!.flush();
    this.handle!.close();
    this.handle = null;
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
