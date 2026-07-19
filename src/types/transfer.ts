// DataChannel 제어 메시지 타입 (Sender → Receiver)
export interface FileMeta {
  type: 'FILE_META';
  fileId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  totalHashParts: number;
}

export interface HashPart {
  type: 'HASH_PART';
  fileId: string;
  partIndex: number;
  hashes: string[];
}

export interface HashDone {
  type: 'HASH_DONE';
  fileId: string;
  fileHash: string;
}

export interface TransferDone {
  type: 'TRANSFER_DONE';
  fileId: string;
}

// DataChannel 제어 메시지 타입 (Receiver → Sender)
export interface ReadyMsg {
  type: 'READY';
  fileId: string;
}

export interface ResumeMsg {
  type: 'RESUME';
  fileId: string;
  receivedIndices: number[];
}

export interface VerifyOk {
  type: 'VERIFY_OK';
  fileId: string;
}

export interface VerifyFail {
  type: 'VERIFY_FAIL';
  fileId: string;
  reason: 'file_hash_mismatch';
}

export interface TransferRequest {
  type: 'TRANSFER_REQUEST';
  files: Array<{ fileId: string; fileName: string; fileSize: number }>;
}

export interface TransferAccept {
  type: 'TRANSFER_ACCEPT';
}

export interface TransferReject {
  type: 'TRANSFER_REJECT';
}

export type SenderMessage = FileMeta | HashPart | HashDone | TransferDone | TransferRequest;
export type ReceiverMessage = ReadyMsg | ResumeMsg | VerifyOk | VerifyFail | TransferAccept | TransferReject;
export type ControlMessage = SenderMessage | ReceiverMessage;

// IndexedDB 스키마
export interface SessionRecord {
  token: string;      // Primary Key
  role: 'offerer' | 'answerer';
  expiresAt: number;  // Unix ms
}

export interface TransferRecord {
  fileId: string;         // Primary Key
  token: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  fileHash: string;
  chunkHashes: string[];
  status: 'pending' | 'done';
}

// 수신 청크 인덱스는 별도의 append-only 스토어(receivedBatches)에 배치 단위로 저장된다
// (src/lib/indexeddb.ts의 addReceivedBatch/getReceivedChunkIndices 참고).

// 전송 큐 항목 (Zustand 상태용)
export type TransferStatus =
  | 'queued'
  | 'waiting_accept'
  | 'hashing'
  | 'waiting_ready'
  | 'transferring'
  | 'verifying'
  | 'done'
  | 'error';

export interface QueuedFile {
  fileId: string;
  fileName: string;
  fileSize: number;
  file?: File;
  status: TransferStatus;
  totalChunks: number;
  sentChunks: number;
  receivedChunks: number;
  speedBps: number;
  etaSeconds: number;
}
