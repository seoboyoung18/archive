# AI 작업 규칙
작업 전 docs/SDD.md, docs/game-concept.md, docs/decisions.md 및 관련 명세를 읽는다.
최신 사용자 요구사항 우선. 확정/제안/기획 결정 필요를 구분하고 미정 기능·기술·수치를 임의로 확정하지 않는다.
Explore → Define → Specify → Design → Consistency Check → Plan → Implement → Verify → Sync를 복잡도에 맞춰 적용한다.
현재 저장소와 영향을 분석하고 최소 범위만 변경한다. 초안은 구현 승인으로 간주하지 않는다.
문서와 코드를 함께 갱신하고 기능별 브랜치와 커밋으로 롤백 지점을 유지한다.
매일 docs/devlogs/YYYY-MM-DD.md에 작업·검증·미확인 사항·다음 작업을 기록한다.
트러블슈팅은 지정된 Notion에 기록하고 정형적 수치 관련 제목에는 (정형수치문제)를 붙인다. Notion 위치 미지정 시 로컬 초안을 유지하고 위치를 확인한다.
검증하지 않은 내용을 성공으로 보고하지 않는다. 사용자 변경을 덮어쓰지 않는다.
엔진 선정 후 .gitignore를 추가한다. 비밀키와 로컬 환경 파일을 커밋하지 않는다.
