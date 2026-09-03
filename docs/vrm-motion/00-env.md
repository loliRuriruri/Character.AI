# VRM Motion Environment

- Date: 2026-09-03
- OS: Windows

## Installed Package Versions (Fixed)

| Package | package.json | Lockfile / Installed | Peer Range | Status |
| :--- | :--- | :--- | :--- | :--- |
| `three` | `0.170.0` | `0.170.0` | - | 버전 고정 완료 |
| `@pixiv/three-vrm` | `3.5.5` | `3.5.5` | `three ">=0.137"` | 버전 고정 완료 (호환 정상) |
| `@pixiv/three-vrm-animation` | `3.5.5` | `3.5.5` | `three ">=0.137"` | 버전 고정 완료 (호환 정상) |
| `@pixiv/three-vrm-core` | *(transitive)* | `3.5.5` | `three ">=0.137"` | 전이 의존성 (호환 정상) |
| `@types/three` | `^0.170.0` | `0.170.0` | - | three 0.170 계열과 일치 |

## Environment & Tech Stack Specifications

- **three 실제 설치 버전**: `0.170.0` (버전 드리프트 방지를 위해 package.json 고정 완료)
- **@pixiv/three-vrm peer 범위**: `three ">=0.137"` (현재 three 0.170.0은 호환 범위 내 정상)
- **렌더러 종류**: `WebGLRenderer` (`THREE.WebGLRenderer`, WebGPU 미사용)
- **React · R3F (@react-three/fiber) 사용 여부**: **미사용 (No)** (순수 Vanilla TypeScript + Vite + Electron 아키텍처)
- **MToon nodes 사용 여부**: **미사용 (No)** (`@pixiv/three-vrm/nodes` import 금지, 표준 WebGL MToon 경로 사용)
- **StrictMode 활성 여부**: **해당 없음 (N/A / 비활성)** (React 프레임워크 미사용)

## Additional Environment Notes
- Bundler: Vite 6.0.7
- Desktop Runtime: Electron 33.4.11
- Language: TypeScript 5.7.3
- Rig: VRM 0.0 (`public/models/HatsuneMikuNT.vrm`) with `VRMUtils.rotateVRM0`
- Motion Format: VRMA 1.0 (`public/models/idle_loop.vrma`) via `@pixiv/three-vrm-animation`
