# Radius — Frontend

서버를 거치지 않는 WebRTC P2P 파일 공유 웹 앱.  
시그널링 서버([radius-be](https://github.com/yoon6yo/radius-be))와 함께 동작합니다.

## 기술 스택

- React 19 + TypeScript + Vite
- Zustand (상태 관리)
- Socket.io-client (시그널링)
- OPFS + Web Worker (파일 수신 버퍼)
- Tailwind CSS

## 로컬 개발

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# VITE_SIGNALING_URL=http://localhost:3000

# 3. radius-be 먼저 실행 후
npm run dev
```

## 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `VITE_SIGNALING_URL` | 시그널링 백엔드 주소 | `https://api.radius.example.com` |

> VITE 환경변수는 **빌드 타임에 번들에 포함**됩니다. Docker 이미지 빌드 시 `--build-arg`로 전달해야 합니다.

## 빌드

```bash
npm run build       # dist/ 생성
npm run preview     # 빌드 결과 미리보기
```

## Docker

```bash
docker build \
  --build-arg VITE_SIGNALING_URL=https://api.radius.example.com \
  -t radius-fe .
docker run -p 8080:80 radius-fe
```

## 테스트

```bash
npm test              # 단위 테스트 (vitest)
npm run test:coverage # 커버리지 리포트
```

## CI/CD

`main` 브랜치 push 시 GitHub Actions가 자동으로 실행됩니다.

**필요한 GitHub Secrets:**

| Secret | 값 |
|--------|---|
| `VITE_SIGNALING_URL` | `https://api.radius.example.com` |
| `K8S_SSH_HOST` | 서버 IP 또는 도메인 |
| `K8S_SSH_USER` | SSH 사용자 |
| `K8S_SSH_KEY` | SSH 개인키 |

## 동작 요구사항

- HTTPS 또는 localhost (WebRTC + OPFS는 보안 컨텍스트 필수)
- Chrome 108+ 권장 (OPFS SyncAccessHandle 지원)
