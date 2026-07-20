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

// 직전 내보내기의 Blob URL — 바로 revoke하지 않고 다음 내보내기가 시작될 때(또는
// 페이지를 벗어날 때) 회수한다. iOS Safari는 a.click() 이후 실제 blob 데이터를
// 백그라운드에서 비동기로 읽어 Files 앱과 동기화하는데, 이 완료 시점을 JS에서
// 알 방법이 없다. 예전엔 1초 뒤 고정 타이머로 revoke했는데, iOS가 아직 다 읽기
// 전에 소스가 사라져서 다운로드가 Files 앱에 "대기 중..."으로 영원히 멈추는
// 문제가 있었다(파일 크기와 무관하게 재현됨 — 큰 파일만의 문제가 아니었음).
let pendingExportUrl: string | null = null;

export async function exportFromOPFS(
  fileName: string,
  _mimeType = 'application/octet-stream',
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(fileName);
  const file = await fileHandle.getFile();

  onProgress?.(0, file.size);

  if (pendingExportUrl) {
    URL.revokeObjectURL(pendingExportUrl);
  }

  const url = URL.createObjectURL(file);
  pendingExportUrl = url;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  onProgress?.(file.size, file.size);
}

export async function deleteFromOPFS(fileName: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
  } catch {
    // 파일이 없어도 무시
  }
}
