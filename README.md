# 차원격투 · Dimension Fight

차원을 넘어 모인 인물들의 격투

여러 세계의 인간·비스트·로봇이 대결하는 2D 애니메이션풍 격투게임.

- 대상 저장소: https://github.com/seoboyoung18/dimension-fight
- 현재 단계: H1 시안48포즈를 전투 검수 화면에 연결했습니다. 걷기8포즈·선 약손6포즈로 중간 동작을 추가했고, 사용자 선택 A안의 빨강·금색 `K O!!`가 체력0 종료 때 표시됩니다. 공격8종·방어·피해·KO를 확인할 수 있으며 AI·경기는 다음 단계입니다. 전체 모션 품질은 계속 보완 중입니다.
- 개발 방식: [SDD](docs/SDD.md)
- [확정 기획](docs/game-concept.md) · [결정 기록](docs/decisions.md)
- [캐릭터 기준](docs/design/characters.md) · [H1 전투 명세 v0.3](docs/specs/h1-combat-draft.md)
- [작업 계획](docs/plan.md)

## 초기 캐릭터

| H1 인간 | B1 비스트 | R3 로봇 |
|---|---|---|
| ![H1](assets/characters/h1/reference.png) | ![B1](assets/characters/b1/reference.png) | ![R3](assets/characters/r3/reference.png) |

기준 이미지는 단일 자세이며 애니메이션 시트가 아닙니다. 현재 시안은 H1의 `generated`, `derived` 아래 `v2`, `movement-v1`, `combat-v1`, `motion-v1`에 있으며 이전 `v1`도 보존합니다.

## 로컬 실행

Node.js 22.12 이상 필요. 검증 환경은 Windows, Node.js 24.18.0, npm 11.16.0입니다.

```sh
npm ci
npm run dev
```

터미널의 로컬 주소를 엽니다(기본 http://127.0.0.1:5173/). 첫 페이지에서 전투 검수 링크를 누르거나 http://127.0.0.1:5173/combat.html 을 엽니다. **전투 시작** 후 W 점프·A/D 이동·S 앉기·U/I 손·J/K 발을 조작합니다. CPU는 입력 없는 표적이며, 검수용 선택창으로 선 뒤/앉은 뒤 입력을 적용할 수 있습니다. Esc로 정지/재개하고 포커스가 다른 곳으로 옮겨져도 정지합니다. KO 후 **검수 초기화**로 체력·위치·입력을 복원합니다. AI·60초·라운드 승수는 아직 연결 전입니다. 기존 이동 전용 화면은 http://127.0.0.1:5173/movement.html 에 남아 있습니다.

공격 시안 화면은 동작·포즈 선택, 반복 재생, 좌우 반전·판정 표시를 제공합니다. 선 약손은 6F/3F/15F, 앉은 약발은 8F/4F/18F이며 반복 사이 기본 자세는 검수용 30F입니다. 이 재생은 실제 타격 처리가 아닙니다.

```sh
npm run verify:assets
npm test
npm run build
npm run preview
```

`build`는 타입 검사와 정적 빌드를 수행합니다. `preview`는 빌드 결과를 로컬에서 확인합니다. 이미지 검사는 파일 해시·RGBA·512×512·투명 경계·기준점 정렬을 확인하며 외형 검수를 대신하지 않습니다.

Windows에서 v2 정렬 재현: `pwsh -File scripts/normalize-h1.ps1`. 이동은 `-Version movement-v1`, 전투는 `-Version combat-v1`, 중간 포즈는 `-Version motion-v1`, 이전 시안은 `-Version v1`을 지정합니다. 모든 자세에 대기 기준 공통 배율을 적용하며 점프에는 가상 지면을 사용합니다. ImageGen 재생성이 아닌 정렬 작업이며 정확한 프롬프트는 각 버전의 `prompts.json`과 전투의 `retry-prompts.json`에 있습니다. `npm test`는 총59개 테스트를 수행합니다. 이는 완성 스프라이트·전체 경기·AI 검증을 뜻하지 않습니다.

[시안 작업 명세](docs/specs/h1-asset-preview.md) · [시안 검수 기록](docs/reviews/h1-preview.md)

[앉기·하단 작업 명세](docs/specs/h1-crouch-preview.md) · [v2 검수 결과](docs/reviews/h1-crouch-preview.md)

[입력·이동 명세](docs/specs/h1-movement.md) · [이동 검수 결과](docs/reviews/h1-movement.md)

[전투 판정 구현 명세](docs/specs/h1-combat-core.md) · [전투 로직 검증 결과](docs/reviews/h1-combat-core.md)

[전투 포즈·화면 명세](docs/specs/h1-combat-preview.md) · [전투 화면 검수](docs/reviews/h1-combat-preview.md)

[모션 보완 기준](docs/specs/h1-motion-polish.md) · [KO 선택·표시 기준](docs/specs/ko-art-options.md) · [보완 검수 결과](docs/reviews/h1-motion-ko.md)
