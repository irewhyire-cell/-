AQUA WARS 온라인 서버 - Apple 및 Android 지원

주요 기능
- iPhone/iPad Safari 및 갤럭시/Android 모바일 터치 조작 지원
- iOS 조이스틱 손가락 ID 추적, 터치 취소 복구, 화면 회전 및 노치 안전 영역 대응
- 방장이 방 최대 인원을 2~7명 중 선택 (방장 포함)
- 선택한 인원수는 방 목록과 서버 입장 제한에 동일하게 적용
- 공개 방은 열린 방 목록에 표시, 비공개 방은 초대 코드로 입장
- 두 번째 플레이어 입장 시 온라인 경기가 자동 시작
- 진행 중인 경기에도 빈 자리가 있으면 중간 참가 가능
- 최대 인원 초과 입장 차단, 플레이어별 시작 위치 배정

배포 구성
- index.html: 게임 클라이언트
- server.js: Express + Socket.IO 온라인 서버
- package.json: Node.js 실행 및 테스트 명령
- render.yaml: Render 배포 설정

Render 설정
- Root Directory: 저장소 루트
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /health

모바일 접속
- iPhone/iPad에서는 Safari에서 HTTPS 게임 주소로 접속하세요.
- 기본 서버 주소: https://aqua-wars-online.onrender.com
- HTML 파일을 직접 실행하면 온라인 로비의 서버 주소를 확인하고 '주소 적용'을 누르세요.

온라인 동기화 범위
서버는 방, 참가자, 경기 시작, 시작 위치 및 플레이어 위치를 동기화합니다. 영토 점령, 공격 판정, 체력과 AI 진행은 아직 각 브라우저에서 별도로 계산합니다. 따라서 완전한 서버 권한형 실시간 대전은 추가 개발이 필요합니다.
