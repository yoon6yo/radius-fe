import { describe, it, expect, beforeEach } from 'vitest';
import { useTransferStore } from '@/store/transferStore';

const makeFile = (name = 'test.bin', size = 1024) =>
  new File([new Uint8Array(size)], name);

beforeEach(() => {
  useTransferStore.getState().reset();
});

describe('addFiles', () => {
  it('파일을 큐에 추가한다', () => {
    useTransferStore.getState().addFiles([makeFile('a.bin'), makeFile('b.bin')]);
    expect(useTransferStore.getState().queue).toHaveLength(2);
  });

  it('초기 status는 queued이다', () => {
    useTransferStore.getState().addFiles([makeFile()]);
    expect(useTransferStore.getState().queue[0].status).toBe('queued');
  });

  it('isLocked이면 파일이 추가되지 않는다', () => {
    useTransferStore.getState().lockQueue();
    useTransferStore.getState().addFiles([makeFile()]);
    expect(useTransferStore.getState().queue).toHaveLength(0);
  });
});

describe('removeFile', () => {
  it('fileId로 파일을 제거한다', () => {
    useTransferStore.getState().addFiles([makeFile('a.bin'), makeFile('b.bin')]);
    const id = useTransferStore.getState().queue[0].fileId;
    useTransferStore.getState().removeFile(id);
    expect(useTransferStore.getState().queue).toHaveLength(1);
  });

  it('isLocked이면 제거되지 않는다', () => {
    useTransferStore.getState().addFiles([makeFile()]);
    const id = useTransferStore.getState().queue[0].fileId;
    useTransferStore.getState().lockQueue();
    useTransferStore.getState().removeFile(id);
    expect(useTransferStore.getState().queue).toHaveLength(1);
  });
});

describe('lockQueue', () => {
  it('isLocked를 true로 설정한다', () => {
    useTransferStore.getState().lockQueue();
    expect(useTransferStore.getState().isLocked).toBe(true);
  });
});

describe('updateFileStatus', () => {
  it('특정 파일의 status만 변경한다', () => {
    useTransferStore.getState().addFiles([makeFile('a.bin'), makeFile('b.bin')]);
    const [first, second] = useTransferStore.getState().queue;
    useTransferStore.getState().updateFileStatus(first.fileId, 'transferring');

    const updated = useTransferStore.getState().queue;
    expect(updated[0].status).toBe('transferring');
    expect(updated[1].status).toBe('queued'); // 변경 없음
  });
});

describe('updateProgress', () => {
  it('sentChunks, speedBps, etaSeconds를 업데이트한다', () => {
    useTransferStore.getState().addFiles([makeFile()]);
    const { fileId } = useTransferStore.getState().queue[0];
    useTransferStore.getState().updateProgress(fileId, {
      sentChunks: 10,
      speedBps: 500_000,
      etaSeconds: 5,
    });

    const item = useTransferStore.getState().queue[0];
    expect(item.sentChunks).toBe(10);
    expect(item.speedBps).toBe(500_000);
    expect(item.etaSeconds).toBe(5);
  });

  it('지정하지 않은 필드는 유지된다', () => {
    useTransferStore.getState().addFiles([makeFile()]);
    const { fileId } = useTransferStore.getState().queue[0];
    useTransferStore.getState().updateProgress(fileId, { sentChunks: 3 });
    const item = useTransferStore.getState().queue[0];
    expect(item.speedBps).toBe(0); // 초기값 유지
  });
});

describe('advanceQueue', () => {
  it('currentIndex를 1 증가시킨다', () => {
    expect(useTransferStore.getState().currentIndex).toBe(0);
    useTransferStore.getState().advanceQueue();
    expect(useTransferStore.getState().currentIndex).toBe(1);
    useTransferStore.getState().advanceQueue();
    expect(useTransferStore.getState().currentIndex).toBe(2);
  });
});

describe('reset', () => {
  it('큐, currentIndex, isLocked를 초기화한다', () => {
    useTransferStore.getState().addFiles([makeFile(), makeFile()]);
    useTransferStore.getState().lockQueue();
    useTransferStore.getState().advanceQueue();
    useTransferStore.getState().reset();

    const { queue, currentIndex, isLocked } = useTransferStore.getState();
    expect(queue).toHaveLength(0);
    expect(currentIndex).toBe(0);
    expect(isLocked).toBe(false);
  });
});
