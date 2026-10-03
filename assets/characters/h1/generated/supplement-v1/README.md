# H1 공격 준비·회복 중간 그림

기존8공격마다 준비1장과 회복1장을 내장 ImageGen으로 제작했다. 정확한 준비 프롬프트/참조/반환경로는 `prompts.json`, 회복은 `recovery-prompts.json`에 보존한다. `rejected` 후보는 반대 손발 등 검수 부적합 원화이며 게임에서 사용하지 않는다.

정렬된512 참조를 기준으로 생성1254의 전체 캔버스 비율512/1254를 공통 적용하고 발 하단448에 배치한다. 신체를 코드로 그리거나 알파/색을 수정하지 않는다. `scripts/normalize-h1-supplement.ps1 -Version supplement-v1`로 재현하며 파생 manifest가 source/output SHA와 변환을 기록한다.

파일명은 제작 의도이고 최종 순서는 실제 자세 기준이다. 약손/약발의 새 준비 그림은 기존 extend 뒤에, 강손/강발은 extend/lift 앞에 배치했다. 회복 새 그림은 retract 다음이다. 공격 구간·유효 자세·피해 수치는 유지한다.
