AQUA WARS 온라인 서버

구성
- index.html: 게임 화면
- server.js: Express + Socket.IO 서버
- package.json: 실행 패키지
- render.yaml: Render 배포 설정

Render 배포
1. GitHub 저장소에 이 폴더의 파일을 올립니다.
2. Render에서 New > Web Service를 선택하고 GitHub 저장소를 연결합니다.
3. Root Directory가 저장소 루트이면 Build Command는 npm install, Start Command는 npm start로 둡니다.
4. 배포가 끝나면 Render가 제공한 https:// 주소로 게임에 접속합니다.
5. /health 주소가 {"ok":true,...}를 반환하면 서버가 실행 중입니다.

참고
현재 방 최대 인원은 방장을 포함해 7명입니다. 각 방은 비공개이며, 방 목록에는 코드가 공개되지 않습니다. 방장이 전달한 8자리 초대 코드를 아는 사람만 입장할 수 있습니다.
현재 서버는 방 생성/입장, 접속 상태, 플레이어 위치 동기화, 경기 시작 신호를 전달합니다. 영토 점령·전투·AI·체력 계산 전체가 서버 권한으로 동기화되는 완전한 공정 멀티플레이는 아직 아닙니다.


원클릭 배포
아래 주소를 열고 Render에서 GitHub 저장소 연결 및 배포를 승인하세요.
https://render.com/deploy?repo=https://github.com/irewhyire-cell/-
