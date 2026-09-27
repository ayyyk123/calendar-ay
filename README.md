# 나만의 캘린더 v1.0

주간 화면 중심의 개인 일정/업무량 관리 웹앱입니다.

## 포함 기능
- 주/월/일/목록 보기 (기본: 주간)
- 여러 캘린더, 색상, 표시 우선순위, 오전/오후/저녁 설정
- 캘린더별 하루 가용시간
- 일정/할 일, 예상 소요시간, 메모, 종일/시간 입력
- 같은 날짜에서 캘린더 우선순위별 묶음 표시
- 날짜별 캘린더 업무량 합계 및 초과 표시
- 매월 고정업무 보관함 + 날짜로 드래그 배치 + 해당 월 배치 여부 체크
- PC/모바일 반응형
- 로컬 자동 저장
- Firebase Firestore 실시간 동기화 설정 화면

## Firebase 연결
1. Firebase 프로젝트에서 Web App을 생성합니다.
2. Firestore Database를 활성화합니다.
3. 앱 오른쪽 위 ⚙ → Firebase config에 Firebase Web SDK 설정 JSON을 붙여 넣습니다.
4. 같은 `동기화 문서 ID`를 PC와 모바일에서 사용하면 같은 데이터를 봅니다.

주의: v1.0의 Firebase 연결은 빠른 개인용 시작본입니다. 공개 배포 전에는 Firebase Authentication과 Firestore Security Rules를 반드시 설정하세요.

## GitHub Pages
이 폴더 전체를 GitHub 저장소 루트에 올리고 Settings → Pages에서 배포하면 됩니다.
