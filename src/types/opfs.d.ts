// OPFS SyncAccessHandle — TypeScript DOM lib에 미포함된 타입 보완
interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  flush(): void;
  close(): void;
  truncate(size: number): void;
  getSize(): number;
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}
