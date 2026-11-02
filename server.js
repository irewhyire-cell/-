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
const SPAWN_POINTS = [
  { x: 0.12, y: 0.78 }, { x: 0.38, y: 0.82 }, { x: 0.66, y: 0.82 },
  { x: 0.88, y: 0.58 }, { x: 0.12, y: 0.42 }, { x: 0.50, y: 0.14 },
  { x: 0.88, y: 0.32 }
];
app.get('/health', (_req, res) => res.json({ ok: true, service: 'AQUA WARS', rooms: rooms.size }));
app.use(express.static(path.join(__dirname)));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
function roomList() {
  return [...rooms.values()]
    .filter(room => room.isPublic && !room.started && room.players.size < MAX_ROOM_PLAYERS)
    .map(room => ({ code: room.code, name: room.name, players: room.players.size, maxPlayers: MAX_ROOM_PLAYERS, stageIndex: room.stageIndex, stageNumber: 100 - room.stageIndex, started: room.started }));
}
function publishRooms() { io.emit('rooms:update', roomList()); }
function publishRoomState(room) {
  const state = { code: room.code, name: room.name, hostId: room.hostId, players: [...room.players.values()], maxPlayers: MAX_ROOM_PLAYERS, stageIndex: room.stageIndex, stageNumber: 100 - room.stageIndex, isPublic: room.isPublic, started: room.started };
  for (const socketId of room.players.keys()) io.to(socketId).emit('room:state', { ...state, isHost: socketId === room.hostId });
}
function leave(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketRoom.delete(socket.id);
  if (room) {
    const wasHost = room.hostId === socket.id;
    room.players.delete(socket.id);
    socket.leave(code);
    if (room.players.size === 0) rooms.delete(code);
    else {
      if (wasHost) room.hostId = room.players.keys().next().value;
      io.to(code).emit('room:member-left', { id: socket.id });
      publishRoomState(room);
    }
  }
  publishRooms();
}
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}
function enter(socket, room, nickname) {
  if (room.started) return socket.emit('room:error', { message: '이미 시작한 방에는 입장할 수 없습니다.' });
  if (room.players.size >= MAX_ROOM_PLAYERS) return socket.emit('room:error', { message: `이 방은 최대 ${MAX_ROOM_PLAYERS}명까지 입장할 수 있습니다.` });
  const player = { id: socket.id, name: String(nickname || '아쿠아영웅').trim().slice(0, 12) || '아쿠아영웅' };
  room.players.set(socket.id, player);
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);
  socket.emit('room:joined', { code: room.code, name: room.name, isHost: room.hostId === socket.id, hostId: room.hostId, isPublic: room.isPublic, started: room.started, stageIndex: room.stageIndex, players: [...room.players.values()], maxPlayers: MAX_ROOM_PLAYERS, rooms: roomList() });
  socket.to(room.code).emit('room:member-joined', player);
  publishRoomState(room);
  publishRooms();
}
io.on('connection', socket => {
  socket.emit('rooms:list', roomList());
  socket.on('rooms:list', () => socket.emit('rooms:list', roomList()));
  socket.on('room:create', data => {
    leave(socket);
    const rawIndex = Number(data?.stageIndex);
    const stageIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.min(1100, Math.trunc(rawIndex))) : 0;
    const code = makeCode();
    const room = { code, name: String(data?.name || '아쿠아 방').trim().slice(0, 30) || '아쿠아 방', stageIndex, hostId: socket.id, players: new Map(), started: false, isPublic: data?.isPublic === true };
    rooms.set(code, room);
    enter(socket, room, data?.nickname);
  });
  socket.on('room:join', data => {
    const code = String(data?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { message: '방을 찾을 수 없습니다. 초대 코드를 확인해 주세요.' });
    if (room.started) return socket.emit('room:error', { message: '이미 시작한 방에는 입장할 수 없습니다.' });
    if (socketRoom.get(socket.id) === code) { publishRoomState(room); return; }
    if (room.players.size >= MAX_ROOM_PLAYERS) return socket.emit('room:error', { message: `이 방은 최대 ${MAX_ROOM_PLAYERS}명까지 입장할 수 있습니다.` });
    leave(socket);
    enter(socket, room, data?.nickname);
  });
  socket.on('room:leave', () => leave(socket));
  socket.on('game:start', data => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.size < 2) return socket.emit('room:error', { message: '최소 2명이 입장해야 경기를 시작할 수 있습니다.' });
    const rawIndex = Number(data?.stageIndex);
    room.stageIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.min(1100, Math.trunc(rawIndex))) : room.stageIndex;
    room.started = true;
    const spawns = {};
    [...room.players.keys()].forEach((id, index) => { spawns[id] = SPAWN_POINTS[index]; });
    io.to(code).emit('game:start', { stageIndex: room.stageIndex, stageNumber: 100 - room.stageIndex, spawns });
    publishRoomState(room);
    publishRooms();
  });
  socket.on('game:state', state => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || !room.started || !state || typeof state !== 'object') return;
    const safe = { id: socket.id, x: Number(state.x), y: Number(state.y), radius: Number(state.radius), name: String(state.name || '아쿠아영웅').slice(0, 12), color: String(state.color || '#38bdf8'), landColor: String(state.landColor || '#2563eb'), stageIndex: Number(state.stageIndex) || 0 };
    if (![safe.x, safe.y, safe.radius].every(Number.isFinite)) return;
    if (safe.x < 0 || safe.x > 1 || safe.y < 0 || safe.y > 1 || safe.radius < 1 || safe.radius > 200) return;
    socket.to(code).emit('game:state', safe);
  });
  socket.on('disconnect', () => leave(socket));
});
server.listen(PORT, '0.0.0.0', () => console.log(`AQUA WARS server listening on ${PORT}`));
