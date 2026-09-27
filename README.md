# 나만의 캘린더 v1.1

주간 화면 중심의 개인 일정/업무량 관리 웹앱입니다.

## v1.1 핵심
- Firebase Authentication 이메일/비밀번호 로그인
- 로그인 사용자별 Firestore 데이터 분리 및 자동 실시간 동기화
- 주간 화면 기본, 날짜 빈 공간 더블클릭으로 일정 등록 유지
- 일정 등록 취소 시 저장되지 않는 버그 수정
- 긴 일정 등록창/모달 스크롤 및 닫힘 처리 개선
- 반복 일정 상세 설정
  - 매일: N일마다
  - 매주: N주마다 + 복수 요일
  - 매월: 같은 날짜 / 몇째 주 같은 요일 / 마지막 같은 요일
  - 매년: 월·일
  - 종료 없음 / 종료 날짜 / 총 반복 횟수
- 반복 일정은 v1.1에서 시리즈 전체 수정 방식
- 할 일/습관은 발생일별 완료 체크
- 캘린더별 묶음/우선순위 표시, 하루 가용시간 대비 업무량 초과 표시
- 매월 고정업무 + 날짜로 드래그 배치
- 일반 일정은 날짜로 드래그 이동
- 일정 복사, 장소, 메모
- 캘린더 표시/숨김
- 기념일/D-Day 사이드 표시
- 날짜별 다이어리
- 일정/고정업무/다이어리 검색
- 주/월/일/목록 보기
- PC/모바일 반응형

## Firebase 보안 규칙
Firestore Console → 규칙(Rules)에 `firestore.rules` 내용을 붙여넣고 게시하세요.
이 규칙은 로그인한 사용자가 자신의 `users/{uid}/...` 데이터만 읽고 쓰게 합니다.

## GitHub Pages 업데이트
기존 저장소 루트의 아래 파일을 v1.1 파일로 덮어쓰면 됩니다.
- index.html
- app.js
- style.css
- manifest.json
- README.md

`firestore.rules`는 GitHub에 올려도 되지만, 실제 적용은 Firebase Console의 Firestore → 규칙에서 해야 합니다.

## 참고
Firebase Web config는 공개 웹앱에 포함되는 식별 설정값이며 비밀번호가 아닙니다. 실제 데이터 보호는 Firebase Authentication + Firestore Security Rules로 합니다.
