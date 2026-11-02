const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const socketRoom = new Map();
const MAX_ROOM_PLAYERS = 7;

app.get('/health', (_req, res) => res.json({ ok: true, service: 'AQUA WARS', rooms: rooms.size }));
app.use(express.static(path.join(__dirname)));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function roomList() {
  // 비공개 방의 코드가 전체 목록에 노출되지 않도록 공개 목록은 비웁니다.
  // 참가자는 방장이 전달한 초대 코드로만 입장할 수 있습니다.
  return [];
}
function publishRooms() { io.emit('rooms:update', roomList()); }
function leave(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketRoom.delete(socket.id);
  if (room) {
    room.players.delete(socket.id);
    socket.leave(code);
    if (room.players.size === 0) rooms.delete(code);
    else {
      const next = room.players.values().next().value;
      room.hostId = next;
      io.to(code).emit('room:member-left', { id: socket.id });
    }
  }
  publishRooms();
}
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function enter(socket, room, nickname) {
  if (room.players.size >= MAX_ROOM_PLAYERS) return socket.emit('room:error', { message: `이 방은 최대 ${MAX_ROOM_PLAYERS}명까지 입장할 수 있습니다.` });
  room.players.set(socket.id, { id: socket.id, name: String(nickname || '아쿠아영웅').slice(0, 12) });
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);
  socket.emit('room:joined', { code: room.code, name: room.name, isHost: room.hostId === socket.id, players: [...room.players.values()], maxPlayers: MAX_ROOM_PLAYERS, rooms: roomList() });
  socket.to(room.code).emit('room:member-joined', { id: socket.id, name: String(nickname || '아쿠아영웅').slice(0, 12) });
  publishRooms();
}

io.on('connection', socket => {
  socket.emit('rooms:list', roomList());
  socket.on('rooms:list', () => socket.emit('rooms:list', roomList()));
  socket.on('room:create', data => {
    leave(socket);
    const code = makeCode();
    const room = { code, name: String(data?.name || '아쿠아 방').slice(0, 30), stageIndex: Number(data?.stageIndex) || 0, hostId: socket.id, players: new Map(), started: false };
    rooms.set(code, room);
    enter(socket, room, data?.nickname);
  });
  socket.on('room:join', data => {
    const code = String(data?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { message: '방을 찾을 수 없습니다.' });
    leave(socket);
    enter(socket, room, data?.nickname);
  });
  socket.on('room:leave', () => leave(socket));
  socket.on('game:start', data => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.started = true;
    room.stageIndex = Number(data?.stageIndex) || room.stageIndex;
    io.to(code).emit('game:start', { stageIndex: room.stageIndex });
  });
  socket.on('game:state', state => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || !room.started || !state || typeof state !== 'object') return;
    const safe = { id: socket.id, x: Number(state.x), y: Number(state.y), radius: Number(state.radius), name: String(state.name || '아쿠아영웅').slice(0, 12), color: String(state.color || '#38bdf8'), landColor: String(state.landColor || '#2563eb'), stageIndex: Number(state.stageIndex) || 0 };
    if (![safe.x, safe.y, safe.radius].every(Number.isFinite)) return;
    socket.to(code).emit('game:state', safe);
  });
  socket.on('disconnect', () => leave(socket));
});

server.listen(PORT, '0.0.0.0', () => console.log(`AQUA WARS server listening on ${PORT}`));
