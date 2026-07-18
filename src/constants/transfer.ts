export const CHUNK_SIZE = 65536;                // 64KB
export const BUFFER_HIGH_THRESHOLD = 1_048_576; // 1MB — 이 이상이면 전송 중단
export const BUFFER_LOW_THRESHOLD  =   262_144; // 256KB — bufferedamountlow 임계값
export const PROGRESS_UPDATE_MS    =       100; // UI 갱신 throttle 간격 (ms)
export const ROOM_TTL_MS           = 7_200_000; // 룸 만료 (7200초)
export const TOKEN_PATTERN = /^\d{6}$/;
