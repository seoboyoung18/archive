# B1 동작 그림 R1 · 상태→포즈 명세 초안

2026-10-06. B1 호랑이 비스트를 실제 대전에 넣기 전 필요한 그림 슬롯과 검수 조건을 정한다. 사용자는 [R0 비교 시안](../reviews/roster-r0.md)의 B1·R3 크기와 외형을 승인했다. **첫 대전 능력치·CPU 캐릭터 선택은 아직 미정**이다. 이 문서는 새 그림 제작·전투 코드 연결 승인으로 간주하지 않는다.

## 기준과 적용 규칙

- [B1 원본](../../assets/characters/b1/reference.png)의 주황 털·검은 줄무늬·남색 바지·손발 붕대·꼬리, 얼굴과 체형을 유지한다. 원본은 보존한다. R0 정렬 그림은 `idle-0` 후보이며 아직 게임용 그림으로 연결하지 않았다.
- 현행 [H1 포즈 선택 코드](../../src/characters/h1-poses.ts)를 기준으로 **도달 가능한 139슬롯 후보**를 조사했다: 공격66, 보행24, 그 밖의 상태49. H1 등록145개의 기계적 복제가 아니다. `grab-stand-brace/push`, `grab-crouch-brace/push`, `grabbed-stand-impact`, `grabbed-crouch-impact`의 6개 등록 그림은 현행 선택 함수가 반환하지 않아 제외했다. 코드가 바뀌면 목록을 다시 계산한다.
- 아래 각 슬롯 ID의 원화 후보 경로는 `assets/characters/b1/generated/r1-v1/<ID>.png`, 정렬 결과 후보 경로는 `assets/characters/b1/derived/r1-v1/<ID>.png`다. **현재 두 경로의 R1 파일은 없다.** 모든 슬롯은 미제작·미검수, 다른 슬롯 그림 재사용은 미승인이다. 같은 B1 그림을 재사용해야 한다면 두 슬롯·표시 구간·시각 검수 결과를 명시한다. H1 이미지를 B1에 대체 연결하지 않는다.
- 출력 규격은 승인된 R0의 512×512 투명 RGBA, 발 기준점 (256,448), 표시 배율0.625다. 왼쪽 방향은 루트를 기준으로 수평 반전한다. 자유 회전 점프는 기존 중심 피벗·각도를 따르며, 각 회전 포즈의 발 기준점은 실제 접지점이 아닌 가상 기준점이다.
- 아래 구간은 **현재 H1 렌더러의 표시 후보**다. B1 전투 시간을 다르게 정하면 프레임 배분·판정·상대 반응을 함께 재명세한다. 그림 이름만 보고 피해를 발생시키지 않고 승인된 공격 유효 구간과 일치시킨다.

## 기본·이동·반응 50슬롯

각 표의 ID마다 위 원화/출력 경로·반전·미제작/미검수 규칙을 적용한다. 보행의 NN은 00~11 전체이며 두 접두 슬롯을 각각 제작한다.

| 상태 | 슬롯 ID | 현재 표시 구간·조건 | 검수 초점 |
|---|---|---|---|
| 대기 | `idle-0`, `idle-in`, `idle-1`, `idle-out` | 30F 주기 0~7/8~14/15~22/23~29F | 호흡·꼬리 흐름, 양발 고정 |
| 보행 | `walk-00`, `walk-mid-00` … `walk-11`, `walk-mid-11` | 24슬롯×2F=48F(0.8초), 후진은 역순 | 앞발·뒷발 교차, 체중 이동, 미끄러짐 없음 |
| 앉기 | `crouch` | 자유 상태 S 유지 | 몸 중심·꼬리 여백 |
| 자유 점프 | `jump-rise`, `flip-lift`, `flip-fold`, `flip-tuck`, `flip-coil`, `flip-release`, `flip-open`, `jump-fall`, `flip-landing` | 48F: rise 0~3, lift 4~5, fold 6~9, tuck 10~16·29~32, coil 17~28, release 33~36, open 37~40, fall 41~44, landing 45~48 | 한 바퀴 회전, 꼬리·사지 연속성, 화면 잘림 |
| 회전 중단 뒤 자유 점프 | `jump-apex` 포함 rise/apex/fall | 수직속도에 따라 기본 점프 그림 선택 | 피격 뒤 갑작스러운 자세 전환 없음 |
| 방어 | `stand-guard`, `crouch-guard` | 지상 선/앉은 방어 경직 | 팔·몸 방어, 꼬리 비접촉 |
| 피격 | `stand-hit`, `stand-hit-settle`, `crouch-hit`, `crouch-hit-settle` | 피격 중; 지상 경직 잔여≤4F에 settle | 충격 방향과 복귀 |
| KO | `ko-0`, `ko-mid-01`, `ko-1`, `ko-mid-12`, `ko-2` | 결과 연출 0~2/3~5/6~8/9~11/12F 이후 | 바닥 접촉·양 코너 잘림 |

이 표의 고유 슬롯은 대기4+보행24+앉기1+점프/회전10+방어2+피격4+KO5 = **50**이다. `flip-tuck`은 한 회전에서 두 구간에 같은 슬롯을 다시 표시한다.

## 공격 8종 · 66슬롯

표 안의 순서가 단계 내 표시 순서다. 단계 길이 D, 그 단계 그림 수 N, 단계 나이 a(0부터)일 때 그림 인덱스는 `floor(a×N/D)`다. 실제 D는 B1 능력치 확정 후 계산한다. 각 슬롯은 위 원화/출력 경로·반전·미제작/미검수 규칙을 따른다.

| 공격 | 준비 | 유효 | 회복 | 그림 기준 |
|---|---|---|---|---|
| 선 약손 U | `stand-lp-startup` → `lp-extend` → `stand-lp-start-mid` | `stand-lp-active` | `lp-retract` → `stand-lp-recover-mid` → `stand-lp-recovery` → `lp-settle` | 앞손, 어깨·골반 연결 |
| 선 강손 I | `stand-hp-startup` → `stand-hp-start-mid` → `stand-hp-extend` | `stand-hp-active` | `stand-hp-retract` → `stand-hp-recover-mid` → `stand-hp-recovery` → `stand-hp-settle` | 약손과 반대 손, 뒤발·허리·상체 회전 |
| 선 약발 J | `stand-lk-startup` → `stand-lk-extend` → `stand-lk-start-mid` | `stand-lk-active` | `stand-lk-retract` → `stand-lk-recover-mid` → `stand-lk-recovery` → `stand-lk-settle` | 앞발, 지지발 접지, 꼬리 균형 |
| 선 강발 K | `stand-hk-startup` → `stand-hk-start-mid` → `stand-hk-lift` | `stand-hk-apex` | `stand-hk-descend` → `stand-hk-active` → `stand-hk-retract` → `stand-hk-recover-mid` → `stand-hk-recovery` → `stand-hk-settle` | 반대 발, 지지발·골반·허리 회전, 완전 신전의 발끝 |
| 앉은 약손 S+U | `crouch-lp-startup` → `crouch-lp-extend` → `crouch-lp-start-mid` | `crouch-lp-active` | `crouch-lp-retract` → `crouch-lp-recover-mid` → `crouch-lp-recovery` → `crouch-lp-settle` | 낮은 몸 중심과 앞손 |
| 앉은 강손 S+I | `crouch-hp-startup` → `crouch-hp-start-mid` → `crouch-hp-extend` | `crouch-hp-active` | `crouch-hp-retract` → `crouch-hp-recover-mid` → `crouch-hp-recovery` → `crouch-hp-settle` | 반대 손, 앉은 전신 회전 |
| 앉은 약발 S+J | `crouch-lk-startup` → `crouch-lk-extend` → `crouch-lk-start-mid` | `crouch-lk-active` | `crouch-lk-retract` → `crouch-lk-recover-mid` → `crouch-lk-settle` → `crouch-lk-recovery` | 앞발 하단 접촉·회수 |
| 앉은 강발 S+K | `crouch-hk-startup` → `crouch-hk-start-mid` → `crouch-hk-extend` | `crouch-hk-active` | `crouch-hk-retract` → `crouch-hk-recover-mid` → `crouch-hk-settle` → `crouch-hk-recovery` | 반대 발·골반 회전·하단 접촉 |

현행 H1의 `stand-hk-active`는 파일 이름과 달리 **하강 회복 그림**이다. B1에서도 발이 완전히 뻗은 `stand-hk-apex`가 유효 구간이어야 하며, 발끝 판정 사각형은 B1 그림에서 별도로 측정한다. H1의 발끝 픽셀 좌표나 공격·피격 사각형을 복사하지 않는다. U→I→J 콤보 취소점에서는 앞 동작 회복과 다음 준비의 연결도 검수한다.

## 잡기·풀기·메치기 · 23슬롯

| 상태와 현재 H1 표시 구간 | 슬롯 ID | 검수 초점 |
|---|---|---|
| U+I 시도 age0~2/3~7/8~19/20 이후 | `grab-ready`, `grab-reach`, `grab-retract`, `grab-settle` | 성공·헛잡기의 팔 뻗기와 회수 |
| 성공 H0~풀기 종료, 상대 선/앉음 | 공격자 `grab-stand-hold`, `grab-crouch-hold`; 대상 `grabbed-stand-hold`, `grabbed-crouch-hold` | 양쪽 손·몸의 접촉, 꼬리/팔 관통 없음 |
| 풀기: 대상 age0~3/4 이후, 공격자 age0~1/2~3 | 대상 `grabbed-stand-escape`, `grabbed-crouch-escape`, `grabbed-stand-recover`, `grabbed-crouch-recover`; 공격자 `grab-release`, `grab-release-mid` 뒤 `grab-retract`, `grab-settle` | 바닥 충돌 없이 양쪽 이탈·복귀 |
| 성공 회전·들기·내리기 | 공격자 `throw-turn`, `throw-turn-mid`, `throw-lift`, `throw-drop-mid`, `throw-slam`; 대상 `thrown-air` | 두 몸의 접촉점·방향·회전 순서 |
| H36 충돌 뒤 다운·기상·복귀 | 대상 `thrown-down`, `thrown-rise-mid`, `thrown-rise`, `grabbed-stand-recover` 또는 `grabbed-crouch-recover`; 공격자 `throw-slam` 뒤 `grab-settle` | 충돌 전 피해 없음, 다운/KO 구분 |

H36과 위 나이는 현재 H1의 **그림 배치 예시**다. B1의 잡기 시간을 달리 정하면 두 역할의 그림 전환을 다시 정한다. 성공 잡기로 KO가 났을 때도 대상은 `thrown-down`을 사용한다. 표에 적힌 동일 슬롯의 반복 표시만 현재 허용한다.

## 제작 계획·완료 조건

1. R0 크기·외형 승인(완료)을 기준으로 B1 대기·24슬롯 보행부터 제작한다. 첫 연락판에서 얼굴·무늬·남색 바지·붕대·꼬리, 앞뒤발 교차·접지를 확인한다. 원화·정확한 프롬프트·정렬 PNG·SHA와 탈락 후보를 보존한다.
2. 공격8종을 하나씩 제작해 준비/유효/회복, 약/강의 반대 손발과 전신 회전, 완전 신전 발끝을 느린 재생으로 확인한다. 이어 방어/피격/KO·점프/회전·잡기/풀기/메치기의 양쪽 역할을 제작한다.
3. 포즈 ID→B1 파일·규격·알파/발 위치·좌우 반전·카메라 코너·회전/메치기 잘림을 검사한다. 판정은 손끝/발끝 그림과 별도로 대조하고 꼬리를 자동 피격 범위에 넣지 않는다.
4. 승인된 전투 정의와 모든 도달 슬롯의 B1 그림, 중앙·양 코너·상호 교차·콤보·잡기/풀기·동시 KO/시간 종료·라운드 초기화 및 H1 회귀 검증을 끝낸 뒤에만 B1을 **선택 가능**으로 공개한다.

현재 R1 그림·판정·전투 코드 구현은 0건이다. **능력치·CPU 캐릭터 선택·효과음 재사용**, 공격/잡기 시간표와 이 139슬롯 제작 범위는 사용자 결정 후 확정한다. 다음 구현 단위는 결정과 이 명세 확인을 받은 뒤 대기·보행 시안이다.
