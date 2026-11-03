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
const ONLINE_TERRITORY_IDS = [4, 5, 6, 7, 8, 9, 10];

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
    players: [...room.players.values()].map(player => ({
      id: player.id,
      name: player.name,
      territoryId: player.territoryId
    })),
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
  for (const player of room.players.values()) {
    const spawnIndex = ONLINE_TERRITORY_IDS.indexOf(player.territoryId);
    const point = SPAWN_POINTS[spawnIndex >= 0 ? spawnIndex : 0];
    spawns[player.id] = { ...point, territoryId: player.territoryId };
  }
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

  const usedTerritories = new Set([...room.players.values()].map(member => member.territoryId));
  const territoryId = ONLINE_TERRITORY_IDS.find(id => !usedTerritories.has(id));
  if (!territoryId) {
    return socket.emit('room:error', { message: '이 방은 최대 7명까지 입장할 수 있습니다.' });
  }
  const player = {
    id: socket.id,
    name: String(nickname || '아쿠아영웅').trim().slice(0, 12) || '아쿠아영웅',
    territoryId,
    trail: [],
    lastState: null
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
    players: [...room.players.values()].map(member => ({
      id: member.id,
      name: member.name,
      territoryId: member.territoryId
    })),
    territoryId: player.territoryId,
    maxPlayers: room.maxPlayers || MAX_ROOM_PLAYERS,
    rooms: roomList()
  });
  socket.to(room.code).emit('room:member-joined', {
    id: player.id, name: player.name, territoryId: player.territoryId
  });
  publishRoomState(room);
  publishRooms();
  if (room.started) {
    // 늦게 참가한 이용자도 기존 참가자의 점령 경로를 복원해 같은 맵을 봅니다.
    const snapshotPlayers = [...room.players.values()]
      .filter(member => member.id !== socket.id && member.lastState)
      .map(member => ({
        ...member.lastState,
        trail: (member.trail || []).slice(-1800)
      }));
    socket.emit('game:map-snapshot', { players: snapshotPlayers });

    // 플레이어별 고정 슬롯을 사용해 스폰 위치와 영토 ID를 일치시킵니다.
    const spawnIndex = ONLINE_TERRITORY_IDS.indexOf(player.territoryId);
    const spawn = SPAWN_POINTS[spawnIndex >= 0 ? spawnIndex : 0];
    room.spawns = room.spawns || {};
    room.spawns[socket.id] = { ...spawn, territoryId: player.territoryId };
    socket.emit('game:start', {
      stageIndex: room.stageIndex,
      stageNumber: 100 - room.stageIndex,
      spawns: room.spawns,
      lateJoin: true
    });
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
      if (room.started && room.spawns?.[socket.id]) {
        const snapshotPlayers = [...room.players.values()]
          .filter(member => member.id !== socket.id && member.lastState)
          .map(member => ({ ...member.lastState, trail: (member.trail || []).slice(-1800) }));
        socket.emit('game:map-snapshot', { players: snapshotPlayers });
        socket.emit('game:start', { stageIndex: room.stageIndex, stageNumber: 100 - room.stageIndex, spawns: room.spawns, lateJoin: true });
      }
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
    const player = room?.players.get(socket.id);
    if (!room || !room.started || !player || !state || typeof state !== 'object') return;
    const safe = {
      id: socket.id,
      territoryId: player.territoryId,
      x: Number(state.x),
      y: Number(state.y),
      radius: Number(state.radius),
      name: String(state.name || player.name || '아쿠아영웅').slice(0, 12),
      color: String(state.color || '#38bdf8'),
      landColor: String(state.landColor || '#2563eb'),
      stageIndex: Number(state.stageIndex) || 0
    };
    if (![safe.x, safe.y, safe.radius].every(Number.isFinite)) return;
    if (safe.x < 0 || safe.x > 1 || safe.y < 0 || safe.y > 1 || safe.radius < 1 || safe.radius > 200) return;

    // 늦게 입장한 사람에게 공유할 점령 경로를 저장합니다.
    const previous = player.trail[player.trail.length - 1];
    if (!previous || Math.hypot(safe.x - previous.x, safe.y - previous.y) >= 0.0035) {
      player.trail.push({ x: safe.x, y: safe.y, radius: safe.radius });
      if (player.trail.length > 1800) player.trail.splice(0, player.trail.length - 1800);
    }
    player.lastState = safe;
    socket.to(code).emit('game:state', safe);
  });

  socket.on('disconnect', () => leave(socket));
});

server.listen(PORT, '0.0.0.0', () => console.log(`AQUA WARS server listening on ${PORT}`));
