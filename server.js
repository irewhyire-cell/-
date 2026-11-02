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
  { x: 0.12, y: 0.78 },
  { x: 0.38, y: 0.82 },
  { x: 0.66, y: 0.82 },
  { x: 0.88, y: 0.58 },
  { x: 0.12, y: 0.42 },
  { x: 0.50, y: 0.14 },
  { x: 0.88, y: 0.32 }
];

app.get('/health', (_req, res) => res.json({ ok: true, service: 'AQUA WARS', rooms: rooms.size }));
app.use(express.static(path.join(__dirname)));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function roomList() {
  // 공개로 표시한 대기 방만 다른 이용자에게 노출한다.
  return [...rooms.values()]
    // 공개 여부를 명시적으로 false로 끄지 않은 방은 공개 대기방 목록에 표시한다.
    .filter(room => room.isPublic !== false && room.players.size < MAX_ROOM_PLAYERS)
    .map(room => ({
      code: room.code,
      name: room.name,
      players: room.players.size,
      maxPlayers: room.maxPlayers || MAX_ROOM_PLAYERS,
      stageIndex: room.stageIndex,
      stageNumber: 100 - room.stageIndex,
      started: room.started,
      status: room.started ? 'in-progress' : 'waiting'
    }));
}

function publishRooms() {
  io.emit('rooms:update', roomList());
}

function publishRoomState(room) {
  const state = {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    players: [...room.players.values()],
    maxPlayers: room.maxPlayers || MAX_ROOM_PLAYERS,
    stageIndex: room.stageIndex,
    stageNumber: 100 - room.stageIndex,
    isPublic: room.isPublic,
    autoStartOnJoin: room.autoStartOnJoin,
    started: room.started
  };
  for (const socketId of room.players.keys()) {
    io.to(socketId).emit('room:state', { ...state, isHost: socketId === room.hostId });
  }
}

function leave(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketRoom.delete(socket.id);
  if (room) {
    const wasHost = room.hostId === socket.id;
    room.players.delete(socket.id);
    if (room.spawns) delete room.spawns[socket.id];
    socket.leave(code);
    if (room.players.size === 0) {
      rooms.delete(code);
    } else {
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
  do {
    code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function startRoomGame(room, selectedStageIndex = room.stageIndex) {
  if (!room || room.started || room.players.size < 1) return false;
  const rawIndex = Number(selectedStageIndex);
  room.stageIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.min(1100, Math.trunc(rawIndex))) : room.stageIndex;
  room.started = true;
  const spawns = {};
  [...room.players.keys()].forEach((id, index) => { spawns[id] = SPAWN_POINTS[index]; });
  room.spawns = spawns;
  io.to(room.code).emit('game:start', {
    stageIndex: room.stageIndex,
    stageNumber: 100 - room.stageIndex,
    spawns
  });
  publishRoomState(room);
  publishRooms();
  return true;
}

function enter(socket, room, nickname) {
  const maxPlayers = Math.max(2, Math.min(MAX_ROOM_PLAYERS, Math.trunc(Number(room.maxPlayers) || MAX_ROOM_PLAYERS)));
  room.maxPlayers = maxPlayers;
  if (room.players.size >= maxPlayers) {
    return socket.emit('room:error', { message: `이 방은 최대 ${maxPlayers}명까지 입장할 수 있습니다.` });
  }

  const player = {
    id: socket.id,
    name: String(nickname || '아쿠아영웅').trim().slice(0, 12) || '아쿠아영웅'
  };
  room.players.set(socket.id, player);
  socketRoom.set(socket.id, room.code);
  socket.join(room.code);
  socket.emit('room:joined', {
    code: room.code,
    name: room.name,
    isHost: room.hostId === socket.id,
    role: room.hostId === socket.id ? 'host' : 'player',
    hostId: room.hostId,
    isPublic: room.isPublic,
    autoStartOnJoin: room.autoStartOnJoin,
    started: room.started,
    stageIndex: room.stageIndex,
    players: [...room.players.values()],
    maxPlayers: room.maxPlayers || MAX_ROOM_PLAYERS,
    rooms: roomList()
  });
  socket.to(room.code).emit('room:member-joined', player);
  publishRoomState(room);
  publishRooms();
  if (room.started) {
    // 이미 시작한 경기에도 빈 플레이어 슬롯으로 늦게 참가할 수 있습니다.
    const used = new Set(Object.values(room.spawns || {}).map(point => `${point.x},${point.y}`));
    const spawn = SPAWN_POINTS.find(point => !used.has(`${point.x},${point.y}`));
    if (spawn) {
      room.spawns = room.spawns || {};
      room.spawns[socket.id] = spawn;
      socket.emit('game:start', {
        stageIndex: room.stageIndex,
        stageNumber: 100 - room.stageIndex,
        spawns: room.spawns,
        lateJoin: true
      });
    }
  } else if (room.autoStartOnJoin && room.players.size >= 1) {
    // 방에 들어온 즉시 온라인 경기를 시작하고, 이후 참가자는 진행 중인 게임에 합류한다.
    startRoomGame(room);
  }
}

io.on('connection', socket => {
  socket.emit('rooms:list', roomList());
  socket.on('rooms:list', () => socket.emit('rooms:list', roomList()));

  socket.on('room:create', data => {
    leave(socket);
    const rawIndex = Number(data?.stageIndex);
    const stageIndex = Number.isFinite(rawIndex) ? Math.max(0, Math.min(1100, Math.trunc(rawIndex))) : 0;
    const requestedMaxPlayers = Number(data?.maxPlayers);
    const maxPlayers = Number.isFinite(requestedMaxPlayers)
      ? Math.max(2, Math.min(MAX_ROOM_PLAYERS, Math.trunc(requestedMaxPlayers)))
      : MAX_ROOM_PLAYERS;
    const code = makeCode();
    const room = {
      code,
      name: String(data?.name || '아쿠아 방').trim().slice(0, 30) || '아쿠아 방',
      stageIndex,
      maxPlayers,
      hostId: socket.id,
      players: new Map(),
      started: false,
      // 클라이언트가 값을 보내지 않아도 기본은 공개 방으로 만든다.
      isPublic: data?.isPublic !== false,
      autoStartOnJoin: true
    };
    rooms.set(code, room);
    enter(socket, room, data?.nickname);
  });

  socket.on('room:join', data => {
    const code = String(data?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = rooms.get(code);
    if (!room) return socket.emit('room:error', { message: '방을 찾을 수 없습니다. 초대 코드를 확인해 주세요.' });
    if (socketRoom.get(socket.id) === code) {
      publishRoomState(room);
      if (room.started && room.spawns?.[socket.id]) socket.emit('game:start', { stageIndex: room.stageIndex, stageNumber: 100 - room.stageIndex, spawns: room.spawns, lateJoin: true });
      return;
    }
    const roomMaxPlayers = room.maxPlayers || MAX_ROOM_PLAYERS;
    if (room.players.size >= roomMaxPlayers) {
      return socket.emit('room:error', { message: `이 방은 최대 ${roomMaxPlayers}명까지 입장할 수 있습니다.` });
    }
    leave(socket);
    enter(socket, room, data?.nickname);
  });

  socket.on('room:leave', () => leave(socket));

  socket.on('game:start', data => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.autoStartOnJoin) return;
    if (!startRoomGame(room, data?.stageIndex) && room.players.size < 2) {
      socket.emit('room:error', { message: '최소 2명이 입장해야 경기를 시작할 수 있습니다.' });
    }
  });

  socket.on('game:state', state => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || !room.started || !state || typeof state !== 'object') return;
    const safe = {
      id: socket.id,
      x: Number(state.x),
      y: Number(state.y),
      radius: Number(state.radius),
      name: String(state.name || '아쿠아영웅').slice(0, 12),
      color: String(state.color || '#38bdf8'),
      landColor: String(state.landColor || '#2563eb'),
      stageIndex: Number(state.stageIndex) || 0
    };
    if (![safe.x, safe.y, safe.radius].every(Number.isFinite)) return;
    if (safe.x < 0 || safe.x > 1 || safe.y < 0 || safe.y > 1 || safe.radius < 1 || safe.radius > 200) return;
    socket.to(code).emit('game:state', safe);
  });

  socket.on('disconnect', () => leave(socket));
});

server.listen(PORT, '0.0.0.0', () => console.log(`AQUA WARS server listening on ${PORT}`));
