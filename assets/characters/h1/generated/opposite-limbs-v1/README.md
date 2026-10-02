# H1 강공격 반대 손발·전신 회전 원화

내장 ImageGen의 identity-preserve 편집 모드로 제작했다. 원화39장(중단 전 보존2장 포함), 선택26장. 기존 기준 이미지와 버전은 보존한다.

- 최종 선택 및 정확한 해시/축소/배치: [출력 manifest](../../derived/opposite-limbs-v1/manifest.json)
- 요구사항: [명세](../../../../../docs/specs/h1-opposite-limbs.md)
- 실제 확인/제외 사유/남은 품질: [검수](../../../../../docs/reviews/h1-opposite-limbs.md)
- anchor-prompts.json: 전신 회전 요청 전의 발 고정 안. abandoned2장만 보존하며 최종 출력에 쓰지 않는다.
- body-anchor-prompts.json: 회전이 포함된4종 유효 자세.
- anchor-retry-prompts.json, arms-retry-prompts.json: 강발 여분 팔/소매 수정. 유효2종은 v3 선택.
- punch-inbetween-prompts.json: 강손 중간10장. 앉은 마지막 복귀는 settle-retry-prompt.json의 v2를 선택.
- kick-inbetween-prompts.json: 강발 중간12장 계획.
- resume-prompts.json: 중단 후 미저장6장과 회복/발 안정성 후보 재생성. 앉은 강발 extend-v2 선택.
- stability-retry-prompts.json: 선 강발 apex-v3/descend-v2, 앉은 강발 retract-v2/settle-v2 선택.

스크립트는 신체를 다시 그리지 않고 승인된 공통 비율 축소와 투명 배치만 한다. 탈락 후보는 런타임 고유 포즈 수에 포함하지 않는다.
