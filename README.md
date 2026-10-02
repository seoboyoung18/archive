# 차원격투 · Dimension Fight

차원을 넘어 모인 인물들의 격투

여러 세계의 인간·비스트·로봇이 대결하는 2D 애니메이션풍 격투게임.

- 대상 저장소: https://github.com/seoboyoung18/dimension-fight
- 현재 단계: H1 시안94포즈를 사용하는 **H1 대 H1 AI 대전**에 C 콤보와 G 잡기·풀기를 연결했습니다. 기존75포즈에 잡기19포즈를 추가했고, 걷기는12장·0.8초, 기본 공격8종은 각각6장(선 강발8장)을 유지합니다. CPU가 접근·공격·방어하며60초·2선승·재경기·전체 재시작으로 플레이합니다. 사용자 선택 A안의 빨강·금색 `K O!!`를 사용합니다. G의 검증 결과은 [잡기 검수 기록](docs/reviews/h1-grab.md)을 따르며 전체 모션 품질과 AI의 체감 난이도는 계속 검수 중입니다.
- 개발 방식: [SDD](docs/SDD.md)
- Git 운영: [1인 개발 컨벤션](docs/git-convention.md) — `main`에서 작업하고 검증 후 커밋·push합니다.
- [확정 기획](docs/game-concept.md) · [결정 기록](docs/decisions.md)
- [캐릭터 기준](docs/design/characters.md) · [H1 전투 명세 v0.3](docs/specs/h1-combat-draft.md)
- [작업 계획](docs/plan.md)

## 초기 캐릭터

| H1 인간 | B1 비스트 | R3 로봇 |
|---|---|---|
| ![H1](assets/characters/h1/reference.png) | ![B1](assets/characters/b1/reference.png) | ![R3](assets/characters/r3/reference.png) |

기준 이미지는 단일 자세이며 애니메이션 시트가 아닙니다. 현재 시안은 H1의 `generated`, `derived` 아래 `v2`, `movement-v1`, `combat-v1`, `motion-v1`, `walk-v2`, `attack-motion-v1`, `opposite-limbs-v1`, `grab-v1`에 있으며 이전 버전과 탈락 후보도 보존합니다.

## 로컬 실행

Node.js 22.12 이상 필요. 검증 환경은 Windows, Node.js 24.18.0, npm 11.16.0입니다.

```sh
npm ci
npm run dev
```

터미널의 로컬 주소를 엽니다(기본 http://127.0.0.1:5173/). 첫 페이지에서 전투 검수 링크를 누르거나 http://127.0.0.1:5173/combat.html 을 엽니다. **전투 시작** 후 W 점프·A/D 이동·S 앉기·U/I 손·J/K 발·U+I 잡기를 조작합니다. 상대는 검수용 표적이며 선 뒤/앉은 뒤/잡히면1회 풀기를 선택할 수 있습니다. 가까이서 **표적 잡기1회**를 누르면 재개하며 표적이 잡기를 시도합니다. 잡힌 뒤 새 U+I로 직접 풀기를 확인합니다. Esc로 정지/재개하고 포커스가 다른 곳으로 옮겨져도 정지합니다. KO 후 **검수 초기화**로 체력·위치·입력을 복원합니다. AI·60초·라운드 승수는 아래 `match.html`에서 사용합니다. 기존 이동 전용 화면은 http://127.0.0.1:5173/movement.html 에 남아 있습니다.

공격 시안 화면은 동작·포즈 선택, 반복 재생, 좌우 반전·판정 표시를 제공합니다. 선 약손은 6F/3F/15F, 앉은 약발은 8F/4F/18F이며 반복 사이 기본 자세는 검수용 30F입니다. 이 재생은 실제 타격 처리가 아닙니다.

```sh
npm run verify:assets
npm test
npm run build
npm run preview
```

`build`는 타입 검사와 정적 빌드를 수행합니다. `preview`는 빌드 결과를 로컬에서 확인합니다. 이미지 검사는 파일 해시·RGBA·512×512·투명 경계·기준점 정렬을 확인하며 외형 검수를 대신하지 않습니다.

**AI 경기 화면:** http://127.0.0.1:5173/match.html — 경기 시작/Enter 후60초·먼저2승으로 진행합니다. CPU는 접근·공격·방어합니다. 시간 종료는 높은 체력 쪽 승리, 동일 체력/동시 KO는 같은 라운드를 재경기합니다. KO18F 뒤 Enter/버튼으로 다음 라운드·재경기를 시작하고 최종 결과에서는 R/버튼으로 승수까지 초기화합니다. Esc는 정지/재개입니다. 기존 `combat.html`의 표적·개별 공격 검수와 초기화는 그대로 사용할 수 있습니다.

[경기 진행 명세](docs/specs/h1-match-flow.md) · [자동/브라우저 검증 결과](docs/reviews/h1-match-flow.md)

승인된 [H1 AI 대전 v0.1](docs/specs/h1-ai-match.md)은12F마다 공개된 상태를 보고 닿는 기본기를 순환 선택합니다. 선 방어/후진에 하단을 우선하고 앉은 상대에게 선 강발을 쓰지 않습니다. 현재 아래+뒤를 유지하면 모든 공격을 막거나 피할 수 있는 한계는 남습니다. [AI 검수 결과](docs/reviews/h1-ai-match.md)에 자동 검사와 실제 플레이 확인 범위를 구분했습니다.

G 이전의 실제 키 검수에서 PLAYER의2:1 최종 승리를 확인했습니다. 사람의 지속 방어/난이도 체감은 계속 확인 중입니다. [전투 확장 v0.2](docs/specs/h1-combat-expansion.md)의 **C 콤보와 G 잡기·풀기는 승인·구현됐습니다.** 가까이 서서 U를 누르고 놓은 뒤 I → J를 이어 누르면 명중 시 연계하며,2타 피해20·3타 피해30입니다. 멀거나 막히면 끊깁니다. C 단계 결과는 [콤보 검수 기록](docs/reviews/h1-combo.md)을 참고하세요.

[G 잡기·풀기 명세](docs/specs/h1-grab.md)에 따라 두 손을3F 이내에 겹쳐 누르면 잡기를 시도합니다. 선 단독 손은 최대3F(50ms) 기다리며 먼저 놓으면 즉시 시작합니다. 성공 후18F에 피해18을 주고, 잡힌 쪽은 성공 다음F부터12F 안에 새 U+I로 풀 수 있습니다. C 후속 입력에는 이 손 지연이 없습니다. CPU는 기존 기본기 전략을 유지하고 잡기·풀기를 선택하지 않습니다. 현재 검증 범위와 미확인 사항은 [G 검수 기록](docs/reviews/h1-grab.md)에 정리합니다. S 효과음과 CPU의 새 기술 선택은 별도 승인 대기입니다.

Windows에서 v2 정렬 재현: `pwsh -File scripts/normalize-h1.ps1`. 이동은 `-Version movement-v1`, 전투는 `-Version combat-v1`, 중간 포즈는 `-Version motion-v1`, 교차 보행은 `-Version walk-v2`, 이전 시안은 `-Version v1`을 지정합니다. 모든 자세에 대기 기준 공통 배율을 적용하며 점프에는 가상 지면을 사용합니다. ImageGen 재생성이 아닌 정렬 작업이며 정확한 프롬프트는 각 버전의 `prompts.json`과 각 재생성 프롬프트 JSON에 있습니다. `npm test`는 전투·입력·경기·AI와 C/G 검사를 수행합니다. 검사 결과는 완성 스프라이트나 체감 난이도 승인을 뜻하지 않습니다.

[시안 작업 명세](docs/specs/h1-asset-preview.md) · [시안 검수 기록](docs/reviews/h1-preview.md)

[앉기·하단 작업 명세](docs/specs/h1-crouch-preview.md) · [v2 검수 결과](docs/reviews/h1-crouch-preview.md)

[입력·이동 명세](docs/specs/h1-movement.md) · [이동 검수 결과](docs/reviews/h1-movement.md)

[전투 판정 구현 명세](docs/specs/h1-combat-core.md) · [전투 로직 검증 결과](docs/reviews/h1-combat-core.md)

[전투 포즈·화면 명세](docs/specs/h1-combat-preview.md) · [전투 화면 검수](docs/reviews/h1-combat-preview.md)

[모션 보완 기준](docs/specs/h1-motion-polish.md) · [KO 선택·표시 기준](docs/specs/ko-art-options.md) · [보완 검수 결과](docs/reviews/h1-motion-ko.md)

[공격7종 프레임 명세](docs/specs/h1-all-attack-frames.md) · [공격 보완 검수](docs/reviews/h1-all-attack-frames.md) · [동작 전후 비교](docs/reviews/evidence/h1-motion-comparison.html)

새 공격 그림 정렬은 `pwsh -File scripts/normalize-h1.ps1 -Version attack-motion-v1`로 재현합니다. 비교 화면의 동작 선택에서 공격8종을 고른 뒤 느린 재생·1F 이동·왼쪽 보기를 사용할 수 있습니다.

강손·강발4종의 반대 손발과 전신 회전은 [수정 명세](docs/specs/h1-opposite-limbs.md)를 따릅니다. `-Version opposite-limbs-v1`로26장을 정렬합니다. 비교 화면은 강공격의 이전26포즈와 보완본을 같은 시간에 재생하며 아래에서 약/강의 실제 공격 손발도 나란히 확인할 수 있습니다.

선 강발은 [첫 발차기 타격 기준](docs/specs/h1-heavy-kick-contact.md)에 따라 다리가 완전히 펴진12~15F의 발끝에서 타격하고16F부터 하강·회복합니다. 비교 화면의 **공격 판정 표시**로 발끝과 빨간 영역을 확인할 수 있습니다. 준비12/유효4/회복36F이며 총52F·피해16을 유지합니다. [검증 결과](docs/reviews/h1-heavy-kick-contact.md)를 참고하세요.
