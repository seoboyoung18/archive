# 차원격투 · Dimension Fight

차원을 넘어 모인 인물들의 격투

여러 세계의 인간·비스트·로봇이 대결하는 2D 애니메이션풍 격투게임.

- 대상 저장소: https://github.com/seoboyoung18/dimension-fight
- 현재 단계: H1 시안 16/41포즈와 WASD 이동 검수 화면 준비. 공격·방어·AI·경기는 아직 없습니다.
- 개발 방식: [SDD](docs/SDD.md)
- [확정 기획](docs/game-concept.md) · [결정 기록](docs/decisions.md)
- [캐릭터 기준](docs/design/characters.md) · [H1 전투 명세 v0.3](docs/specs/h1-combat-draft.md)
- [작업 계획](docs/plan.md)

## 초기 캐릭터

| H1 인간 | B1 비스트 | R3 로봇 |
|---|---|---|
| ![H1](assets/characters/h1/reference.png) | ![B1](assets/characters/b1/reference.png) | ![R3](assets/characters/r3/reference.png) |

기준 이미지는 단일 자세이며 애니메이션 시트가 아닙니다. 현재 시안은 H1의 `generated`, `derived` 아래 `v2`와 `movement-v1`에 있으며 이전 `v1`도 보존합니다.

## 로컬 실행

Node.js 22.12 이상 필요. 검증 환경은 Windows, Node.js 24.18.0, npm 11.16.0입니다.

```sh
npm ci
npm run dev
```

터미널의 로컬 주소를 엽니다(기본 http://127.0.0.1:5173/). 첫 페이지는 공격 시안 검수이며, 이동 검수 링크 또는 http://127.0.0.1:5173/movement.html 에서 **이동 시작**을 누르면 W 점프·A/D 이동·S 앉기를 조작할 수 있습니다. Esc로 정지/재개하고, 다른 버튼이나 창으로 포커스를 옮겨도 정지합니다. CPU는 접촉 확인용 표적입니다.

공격 시안 화면은 동작·포즈 선택, 반복 재생, 좌우 반전·판정 표시를 제공합니다. 선 약손은 6F/3F/15F, 앉은 약발은 8F/4F/18F이며 반복 사이 기본 자세는 검수용 30F입니다. 이 재생은 실제 타격 처리가 아닙니다.

```sh
npm run verify:assets
npm test
npm run build
npm run preview
```

`build`는 타입 검사와 정적 빌드를 수행합니다. `preview`는 빌드 결과를 로컬에서 확인합니다. 이미지 검사는 파일 해시·RGBA·512×512·투명 경계·기준점 정렬을 확인하며 외형 검수를 대신하지 않습니다.

Windows에서 v2 정렬 재현: `pwsh -File scripts/normalize-h1.ps1`. 이동 시안은 `-Version movement-v1`, 이전 시안은 `-Version v1`을 지정합니다. 모든 자세에 대기 기준 공통 배율을 적용하며 점프에는 가상 지면을 사용합니다. ImageGen 재생성이 아닌 정렬 작업이며 프롬프트는 각 버전의 `prompts.json`에 있습니다. `npm test`는 포즈 타이밍과 입력·이동·접촉·고정 시간 테스트15개를 수행합니다. 전체 전투 검증은 아직입니다.

[시안 작업 명세](docs/specs/h1-asset-preview.md) · [시안 검수 기록](docs/reviews/h1-preview.md)

[앉기·하단 작업 명세](docs/specs/h1-crouch-preview.md) · [v2 검수 결과](docs/reviews/h1-crouch-preview.md)

[입력·이동 명세](docs/specs/h1-movement.md) · [이동 검수 결과](docs/reviews/h1-movement.md)
