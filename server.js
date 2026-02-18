/**
 * Arena Battle — WebSocket Game Server
 * Run: node server.js
 * Requires: npm install ws
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// ── HTTP server (serves a basic status page) ──────────────────
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Arena Battle Server — ${rooms.size} room(s) active\n${[...rooms.entries()].map(([code, r]) => `  Room ${code}: ${r.players.length}/2 players`).join('\n')}`);
});

// ── WebSocket server ──────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

// rooms: Map<code, Room>
const rooms = new Map();

function makeRoom(code) {
  return {
    code,
    players: [],      // [{ ws, role:'p1'|'p2', name }]
    state: null,      // game state (authoritative)
    timerInt: null,
    loopInt: null,
  };
}

function broadcast(room, msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── UNIT DEFINITIONS (mirrored from client) ───────────────────
const UNITS = {
  soldier: { id: 'soldier', hp: 80,  dmg: 15 },
  knight:  { id: 'knight',  hp: 150, dmg: 22 },
  archer:  { id: 'archer',  hp: 55,  dmg: 28 },
  mage:    { id: 'mage',    hp: 45,  dmg: 38 },
  tank:    { id: 'tank',    hp: 220, dmg: 12 },
};

const ROWS = 10, COLS = 10;

// ── GAME STATE ────────────────────────────────────────────────
function initGameState() {
  return {
    round: 1,
    maxRounds: 3,
    timeLeft: 20,
    p1Stars: 0,
    p2Stars: 0,
    units: [],
    nextId: 0,
    roundActive: false,
  };
}

function isOccupied(state, r, c) {
  return state.units.some(u => u.row === r && u.col === c);
}

function dist(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function isAdj(a, b) {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1 &&
         !(a.row === b.row && a.col === b.col);
}

// ── GAME LOOP ─────────────────────────────────────────────────
function gameTick(room) {
  const state = room.state;
  if (!state || !state.roundActive) return;

  const snapshot = [...state.units];
  const events = []; // collect events to send

  snapshot.forEach(unit => {
    if (!state.units.find(u => u.id === unit.id)) return;
    const enemies = state.units.filter(u => u.team !== unit.team);
    if (!enemies.length) return;

    const nearest = enemies.reduce((b, e) => dist(unit, e) < dist(unit, b) ? e : b, enemies[0]);

    if (isAdj(unit, nearest)) {
      nearest.hp = Math.max(0, nearest.hp - unit.dmg);
      events.push({ type: 'attack', attackerId: unit.id, targetId: nearest.id, newHp: nearest.hp, dmg: unit.dmg });
      if (nearest.hp <= 0) {
        state.units = state.units.filter(u => u.id !== nearest.id);
        events.push({ type: 'death', unitId: nearest.id });
      }
    } else {
      const dr = Math.sign(nearest.row - unit.row);
      const dc = Math.sign(nearest.col - unit.col);
      const tries = [];
      if (dr) tries.push([unit.row + dr, unit.col]);
      if (dc) tries.push([unit.row, unit.col + dc]);
      if (dr && dc) tries.push([unit.row + dr, unit.col + dc]);

      for (const [nr, nc] of tries) {
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !isOccupied(state, nr, nc)) {
          unit.row = nr; unit.col = nc;
          events.push({ type: 'move', unitId: unit.id, row: nr, col: nc });
          break;
        }
      }
    }
  });

  // Send tick update to both players
  broadcast(room, {
    type: 'TICK',
    units: serializeUnits(state.units),
    events,
    timeLeft: state.timeLeft,
  });
}

function serializeUnits(units) {
  return units.map(u => ({
    id: u.id, typeId: u.typeId, row: u.row, col: u.col,
    hp: u.hp, maxHp: u.maxHp, team: u.team,
  }));
}

function startRound(room) {
  const state = room.state;
  state.timeLeft = 20;
  state.roundActive = true;
  state.units = [];

  broadcast(room, {
    type: 'ROUND_START',
    round: state.round,
    timeLeft: state.timeLeft,
    p1Stars: state.p1Stars,
    p2Stars: state.p2Stars,
  });

  // Timer
  clearInterval(room.timerInt);
  room.timerInt = setInterval(() => {
    state.timeLeft--;
    broadcast(room, { type: 'TIMER', timeLeft: state.timeLeft });
    if (state.timeLeft <= 0) endRound(room);
  }, 1000);

  // Game loop
  clearInterval(room.loopInt);
  room.loopInt = setInterval(() => gameTick(room), 900);
}

function endRound(room) {
  const state = room.state;
  state.roundActive = false;
  clearInterval(room.timerInt);
  clearInterval(room.loopInt);

  const p1Count = state.units.filter(u => u.team === 'p1').length;
  const p2Count = state.units.filter(u => u.team === 'p2').length;
  let winner = null;

  if (p1Count > p2Count) { state.p1Stars++; winner = 'p1'; }
  else if (p2Count > p1Count) { state.p2Stars++; winner = 'p2'; }

  broadcast(room, {
    type: 'ROUND_END',
    round: state.round,
    winner,
    p1Count, p2Count,
    p1Stars: state.p1Stars,
    p2Stars: state.p2Stars,
  });

  const gameOver = state.p1Stars >= 2 || state.p2Stars >= 2 || state.round >= state.maxRounds;

  if (gameOver) {
    setTimeout(() => {
      broadcast(room, {
        type: 'GAME_OVER',
        p1Stars: state.p1Stars,
        p2Stars: state.p2Stars,
      });
    }, 2500);
  } else {
    state.round++;
    setTimeout(() => startRound(room), 3000);
  }
}

// ── CONNECTION HANDLER ────────────────────────────────────────
wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerRole = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'CREATE_ROOM': {
        const code = randomCode();
        const room = makeRoom(code);
        rooms.set(code, room);
        const player = { ws, role: 'p1', name: msg.name || 'Player 1' };
        room.players.push(player);
        playerRoom = room;
        playerRole = 'p1';
        sendTo(ws, { type: 'ROOM_CREATED', code, role: 'p1' });
        console.log(`[${code}] Room created by P1`);
        break;
      }

      case 'JOIN_ROOM': {
        const code = msg.code?.toUpperCase();
        const room = rooms.get(code);
        if (!room) { sendTo(ws, { type: 'ERROR', msg: 'Room not found' }); return; }
        if (room.players.length >= 2) { sendTo(ws, { type: 'ERROR', msg: 'Room is full' }); return; }

        const player = { ws, role: 'p2', name: msg.name || 'Player 2' };
        room.players.push(player);
        playerRoom = room;
        playerRole = 'p2';

        sendTo(ws, { type: 'JOINED_ROOM', code, role: 'p2' });
        broadcast(room, { type: 'OPPONENT_JOINED', name: player.name }, ws);
        console.log(`[${code}] P2 joined — starting game`);

        // Start game
        room.state = initGameState();
        setTimeout(() => {
          broadcast(room, {
            type: 'GAME_START',
            p1Name: room.players.find(p => p.role === 'p1')?.name || 'Player 1',
            p2Name: room.players.find(p => p.role === 'p2')?.name || 'Player 2',
          });
          setTimeout(() => startRound(room), 500);
        }, 300);
        break;
      }

      case 'SPAWN': {
        if (!playerRoom || !playerRoom.state) return;
        const state = playerRoom.state;
        if (!state.roundActive) return;

        const { typeId, row, col } = msg;
        const unitDef = UNITS[typeId];
        if (!unitDef) return;

        // Validate zone
        const validZone = (playerRole === 'p1' && row >= 5) || (playerRole === 'p2' && row < 5);
        if (!validZone) { sendTo(ws, { type: 'SPAWN_DENIED', reason: 'Wrong zone' }); return; }
        if (isOccupied(state, row, col)) { sendTo(ws, { type: 'SPAWN_DENIED', reason: 'Occupied' }); return; }

        const unit = {
          id: state.nextId++,
          typeId, row, col,
          hp: unitDef.hp, maxHp: unitDef.hp,
          dmg: unitDef.dmg,
          team: playerRole,
        };
        state.units.push(unit);

        broadcast(playerRoom, {
          type: 'UNIT_SPAWNED',
          unit: { id: unit.id, typeId, row, col, hp: unit.hp, maxHp: unit.maxHp, team: playerRole },
        });
        break;
      }

      case 'PING': {
        sendTo(ws, { type: 'PONG' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!playerRoom) return;
    console.log(`[${playerRoom.code}] ${playerRole} disconnected`);
    clearInterval(playerRoom.timerInt);
    clearInterval(playerRoom.loopInt);
    broadcast(playerRoom, { type: 'OPPONENT_DISCONNECTED' }, ws);
    // Clean up room after a delay
    setTimeout(() => {
      if (playerRoom.players.every(p => p.ws.readyState !== WebSocket.OPEN)) {
        rooms.delete(playerRoom.code);
        console.log(`[${playerRoom.code}] Room closed`);
      }
    }, 5000);
  });

  ws.on('error', (err) => console.error('WS error:', err.message));
});

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

httpServer.listen(PORT, () => {
  console.log(`\n🎮 Arena Battle Server`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Status:    http://localhost:${PORT}`);
  console.log(`   Ready for connections...\n`);
});
