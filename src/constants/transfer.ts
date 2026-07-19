export const CHUNK_SIZE = 65536;                // 64KB
export const BUFFER_HIGH_THRESHOLD = 1_048_576; // 1MB — 이 이상이면 전송 중단
export const BUFFER_LOW_THRESHOLD  =   262_144; // 256KB — bufferedamountlow 임계값
export const PROGRESS_UPDATE_MS    =       100; // UI 갱신 throttle 간격 (ms)
export const ROOM_TTL_MS           = 7_200_000; // 룸 만료 (7200초)
export const TOKEN_PATTERN = /^\d{6}$/;

// TRANSFER_DONE 전송 후 VERIFY_OK/FAIL 대기 타임아웃.
// 파일 크기와 무관한 고정값이면 대용량 파일에서 실전송이 끝나기 전에 타임아웃될 수 있어
// 최소 대기시간 + 예상 최소 처리량 기준으로 파일 크기에 비례하게 늘어나도록 계산한다.
export const VERIFY_TIMEOUT_MIN_MS       =    30_000; // 최소 대기 (30초)
export const VERIFY_ASSUMED_MIN_BPS      = 2 * 1024 * 1024; // 최소 예상 처리량 2MB/s
