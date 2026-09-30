# 웹 실행 기술 검토 · 2026-09-30

상태: **사용자 선택으로 Phaser 4 + TypeScript + Vite 확정**. 아래 비교는 선정 근거이며, Godot는 비교 후보로 보존한다.

## 요구사항
- Windows PC의 Chrome·Edge에서 실행하는 2D 프레임 애니메이션 격투게임.
- 선/앉은 공격 8종, 별도 공격·피격 사각형, 초당 60회 전투 갱신, AI·경기·일시정지·재시작.
- 공통 전투와 캐릭터 데이터 분리. 게임 규칙을 렌더링 없이 검증할 수 있어야 한다.
- H1 시안 검수 후 동작 확대. 초기 3명과 추후 캐릭터 확장을 지원하되 서버·DB·온라인은 도입하지 않는다.

## 후보 비교
| 후보 | 장점 | 이 프로젝트에서 필요한 준비 |
|---|---|---|
| Phaser 4 + TypeScript + Vite | 2D 웹용 프레임워크. 이미지·입력·화면 관리와 TypeScript/Vite 개발 흐름을 사용할 수 있음 | 전투 상태·판정·고정 시간은 명세대로 작성. 렌더링과 순수 전투 처리 분리 |
| Godot + GDScript | 장면·리소스를 편집기에서 관리하고 웹으로 내보낼 수 있음 | 편집기·웹 내보내기 템플릿 준비. 웹의 WebAssembly/WebGL 2 요구조건 확인 |

**추천: Phaser 4 + TypeScript + Vite.** 브라우저가 첫 플랫폼이고 Git의 코드·데이터 변경과 자동 검증을 중심으로 개발하므로 직접적인 웹 개발 구성이 적합하다고 판단한다. 이는 요구사항에 따른 판단이며 성능 비교 시험의 결과는 아니다.

Phaser 공식 릴리스 페이지에서 4.2.1을 확인했다. 공식 TypeScript/Vite 템플릿은 Phaser 4를 지원한다. 정확한 의존성 버전은 설치 시 호환성을 확인하고 lockfile에 고정한다. 템플릿의 버전 목록을 최신 버전이라고 단정하지 않는다.

## 적용할 최소 구조
- 전투 규칙: 렌더링 API를 참조하지 않는 TypeScript 모듈. 이동·판정·피해·경기 상태와 캐릭터 데이터를 명세 기준으로 검증.
- Phaser: 이미지 로딩·표시, 입력 전달, 상태별 포즈 선택 및 화면 크기 대응. 일반 물리 엔진으로 피해/방어를 자동 결정하지 않음.
- Vite: 로컬 개발 서버와 정적 배포 파일 빌드. 서버 게임 로직이나 DB가 필요하다는 뜻은 아님.
- TypeScript: 데이터 구조와 상태의 타입 검사. 빌드 성공과 타입 검사 결과를 구분.
- UI: 시작·다음 라운드·일시정지·결과 화면의 버튼은 키보드로 접근 가능하게 구성.
- 원본 `assets/characters/*/reference.png` 보존. 파생 이미지가 없으면 준비되지 않은 전투를 실행 가능한 것으로 표시하지 않음.

## 로컬 사전 확인
- PATH에서 Node.js `v24.18.0`, npm `11.16.0`, Git 실행 파일을 확인했다.
- 의존성 설치·패키지 설정·개발 서버와 시안 화면 정적 빌드까지 수행했다. 전투 게임 빌드·플레이 검증은 아직 아니다.
- `.gitignore`를 추가하여 의존성/빌드 결과/로컬 환경 파일을 커밋에서 제외한다.
- 공식 템플릿을 통째로 덮어쓰지 않고 기존 저장소를 보존하며 필요한 설정만 작성한다.

## 설치 기준
- npm 공식 레지스트리 조회 결과: Phaser 4.2.1, Vite 8.3.1, TypeScript 7.0.2.
- Vite의 Node 요구조건은 `^20.19.0 || >=22.12.0`이며 현재 Node v24.18.0이 해당한다. 실제 설치·타입 검사·빌드로 호환성을 확인한다.
- 의존성은 정확한 버전과 package-lock.json으로 고정하고 기본 Node 테스트 도구를 우선 사용한다. 별도 UI 프레임워크·물리 엔진·서버는 추가하지 않는다.

## 공식 자료
- [Phaser의 2D JavaScript/TypeScript 프레임워크 설명](https://phaser.io/news/2026/07/no-you-didn-t-miss-a-3d-update)
- [Phaser 릴리스](https://github.com/phaserjs/phaser/releases)
- [Phaser TypeScript/Vite 템플릿](https://github.com/phaserjs/template-vite-ts)
- [Vite 시작 안내](https://vite.dev/guide/)
- [Godot 웹 내보내기](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
