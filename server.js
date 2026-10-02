/*
 * GameZone server — plain Node http + ws (no Express).
 * One `node server.js` serves the static PWA files AND the WebSocket
 * endpoint used for lobby, rooms, multiplayer games and chat.
 *
 * WebSocket protocol (JSON messages, field "t" = type):
 *
 *  Client -> Server
 *   {t:'hello', name}            set / update display name
 *   {t:'create_room'}            create a room -> {t:'room_created', code}
 *   {t:'join_room', code}         join a room   -> {t:'room_joined', ...}
 *   {t:'leave_room'}             leave current room
 *   {t:'lobby_chat', text}       message to everyone in the lobby
 *   {t:'room_chat', text}        message to everyone in your room
 *   {t:'select_game', game}      'tictactoe' | 'connect4' | 'rps' (needs 2 players)
 *   {t:'move', idx}              tic-tac-toe cell (0-8)
 *   {t:'move', col}              connect-four column (0-6)
 *   {t:'rps', choice}            'rock' | 'paper' | 'scissors'
 *   {t:'rematch'}                restart the current game kind
 *
 *  Server -> Client
 *   {t:'lobby_chat', name, text, ts}
 *   {t:'room_created', code}
 *   {t:'room_joined', code, players:[names], you}
 *   {t:'room_update', players:[names]}
 *   {t:'room_chat', name, text, ts}
 *   {t:'game_state', game, ...}  full authoritative state (personalised)
 *   {t:'game_over', game, ...}   winner / draw info
 *   {t:'rps_result', ...}        revealed round result (personalised)
 *   {t:'opponent_left', name}
 *   {t:'error', msg}
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* Static file server                                                  */
/* ------------------------------------------------------------------ */
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // Prevent path traversal: resolve and make sure we stay inside public/
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(serveStatic);

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */
let nextClientId = 1;
const clients = new Map(); // ws -> { id, name, room: code | null }
const rooms = new Map();   // code -> { code, players: [clientRec], game, createdAt }

// 6-char codes, unambiguous alphabet (no 0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function roomBroadcast(room, obj, exceptWs) {
  for (const p of room.players) {
    if (p.ws !== exceptWs) send(p.ws, obj);
  }
}
function lobbyBroadcast(obj) {
  for (const [ws] of clients) send(ws, obj);
}
function roomNames(room) {
  return room.players.map(p => p.name);
}
function roomPlayers(room) {
  return room.players.map(p => ({ name: p.name, avatar: p.avatar || '🎮' }));
}
function cleanName(raw, fallback) {
  const n = String(raw || '').trim().slice(0, 20);
  return n || fallback;
}
function cleanAvatar(raw) {
  // take the first grapheme-ish character so only one emoji is stored
  const ch = Array.from(String(raw || '').trim())[0];
  return ch || '🎮';
}
function cleanText(raw) {
  return String(raw || '').trim().slice(0, 300);
}

/* ------------------------- game logic ----------------------------- */

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
function tttWinner(b) {
  for (const line of TTT_LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { winner: b[a], line };
  }
  return null;
}

const C4_ROWS = 6, C4_COLS = 7;
function c4Winner(b) {
  // b is a flat 42-cell array, row-major, row 0 = top
  const at = (r, c) => b[r * C4_COLS + c];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const v = at(r, c);
      if (!v) continue;
      for (const [dr, dc] of dirs) {
        const cells = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k, nc = c + dc * k;
          if (nr < 0 || nr >= C4_ROWS || nc < 0 || nc >= C4_COLS || at(nr, nc) !== v) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) {
          return { winner: v, cells: cells.map(([rr, cc]) => rr * C4_COLS + cc) };
        }
      }
    }
  }
  return null;
}

function rpsWinner(a, b) {
  if (a === b) return 'draw';
  if ((a === 'rock' && b === 'scissors') ||
      (a === 'scissors' && b === 'paper') ||
      (a === 'paper' && b === 'rock')) return 'a';
  return 'b';
}

function newGame(kind, room) {
  const [p1, p2] = room.players;
  if (kind === 'tictactoe') {
    return { kind, board: Array(9).fill(null), turn: 'X',
             roles: { [p1.id]: 'X', [p2.id]: 'O' },
             names: { X: p1.name, O: p2.name } };
  }
  if (kind === 'connect4') {
    return { kind, board: Array(C4_ROWS * C4_COLS).fill(null), turn: 'R',
             roles: { [p1.id]: 'R', [p2.id]: 'Y' },
             names: { R: p1.name, Y: p2.name } };
  }
  if (kind === 'rps') {
    return { kind, choices: {}, round: 1,
             scores: { [p1.id]: 0, [p2.id]: 0 } };
  }
  return null;
}

// Personalised full-state snapshot for one player
function stateFor(game, me) {
  if (game.kind === 'tictactoe') {
    const you = game.roles[me.id];
    return { t: 'game_state', game: 'tictactoe', board: game.board,
             turn: game.turn, you, yourTurn: game.turn === you,
             names: game.names };
  }
  if (game.kind === 'connect4') {
    const you = game.roles[me.id];
    return { t: 'game_state', game: 'connect4', board: game.board,
             turn: game.turn, you, yourTurn: game.turn === you,
             names: game.names };
  }
  if (game.kind === 'rps') {
    const opp = me.roomRef.players.find(p => p.id !== me.id);
    return { t: 'game_state', game: 'rps',
             round: game.round, youChose: Boolean(game.choices[me.id]),
             scores: { you: game.scores[me.id], opponent: game.scores[opp.id] },
             oppName: opp.name };
  }
  return null;
}

function pushGameState(room) {
  for (const p of room.players) send(p.ws, stateFor(room.game, p));
}

/* ------------------------- room helpers --------------------------- */

function leaveRoom(me, notifyLeft = true) {
  const code = me.room;
  if (!code) return;
  const room = rooms.get(code);
  me.room = null;
  if (!room) return;
  room.players = room.players.filter(p => p.id !== me.id);
  room.game = null; // any running game is void when someone leaves
  if (room.players.length === 0) {
    rooms.delete(code); // auto-cleanup of empty rooms
  } else if (notifyLeft) {
    roomBroadcast(room, { t: 'opponent_left', name: me.name });
    roomBroadcast(room, { t: 'room_update', players: roomPlayers(room) });
  }
  send(me.ws, { t: 'room_left' });
}

// Drop rooms that somehow ended up empty (safety net, runs every minute)
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.players.length === 0) rooms.delete(code);
  }
}, 60 * 1000);

/* ------------------------------------------------------------------ */
/* WebSocket handling                                                  */
/* ------------------------------------------------------------------ */
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const me = { id: nextClientId++, name: 'Guest-' + nextClientId, avatar: '🎮', room: null, ws };
  me.ws = ws;
  clients.set(ws, me);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { t: 'error', msg: 'Bad message format.' }); }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'hello': {
        me.name = cleanName(msg.name, me.name);
        me.avatar = cleanAvatar(msg.avatar);
        break;
      }

      case 'create_room': {
        leaveRoom(me, false);
        const code = genRoomCode();
        const room = { code, players: [me], game: null, createdAt: Date.now() };
        rooms.set(code, room);
        me.room = code;
        send(ws, { t: 'room_created', code });
        send(ws, { t: 'room_joined', code, players: roomPlayers(room), you: me.name });
        break;
      }

      case 'join_room': {
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', msg: 'Room not found. Check the code.' });
        if (room.players.length >= 2) return send(ws, { t: 'error', msg: 'Room is full.' });
        if (room.players.some(p => p.id === me.id)) return send(ws, { t: 'error', msg: 'Already in this room.' });
        leaveRoom(me, false);
        room.players.push(me);
        me.room = code;
        send(ws, { t: 'room_joined', code, players: roomPlayers(room), you: me.name });
        roomBroadcast(room, { t: 'room_update', players: roomPlayers(room) });
        roomBroadcast(room, { t: 'room_chat', name: 'GameZone', avatar: '🤖', text: me.name + ' joined the room.', ts: Date.now(), sys: true });
        break;
      }

      case 'leave_room': {
        leaveRoom(me);
        break;
      }

      case 'lobby_chat': {
        const text = cleanText(msg.text);
        if (!text) return;
        lobbyBroadcast({ t: 'lobby_chat', name: me.name, avatar: me.avatar, text, ts: Date.now() });
        break;
      }

      case 'room_chat': {
        const text = cleanText(msg.text);
        if (!text || !me.room) return;
        const room = rooms.get(me.room);
        if (!room) return;
        roomBroadcast(room, { t: 'room_chat', name: me.name, avatar: me.avatar, text, ts: Date.now() });
        break;
      }

      case 'select_game': {
        const room = rooms.get(me.room);
        if (!room) return send(ws, { t: 'error', msg: 'Join a room first.' });
        if (room.players.length < 2) return send(ws, { t: 'error', msg: 'Wait for your opponent to join.' });
        if (!['tictactoe', 'connect4', 'rps'].includes(msg.game)) {
          return send(ws, { t: 'error', msg: 'Unknown game.' });
        }
        for (const p of room.players) p.roomRef = room; // back-ref for rps state
        room.game = newGame(msg.game, room);
        pushGameState(room);
        roomBroadcast(room, { t: 'room_chat', name: 'GameZone', avatar: '🤖',
          text: me.name + ' started ' + gameLabel(msg.game) + '.', ts: Date.now(), sys: true });
        break;
      }

      case 'rematch': {
        const room = rooms.get(me.room);
        if (!room || !room.game) return send(ws, { t: 'error', msg: 'No game to rematch.' });
        room.game = newGame(room.game.kind, room);
        pushGameState(room);
        break;
      }

      case 'move': {
        handleMove(me, msg, ws);
        break;
      }

      case 'rps': {
        handleRps(me, msg, ws);
        break;
      }

      default:
        send(ws, { t: 'error', msg: 'Unknown message.' });
    }
  });

  ws.on('close', () => {
    const code = me.room;
    const room = code && rooms.get(code);
    const wasInRoom = Boolean(room);
    leaveRoom(me, true);
    if (room && wasInRoom && room.players.length === 0) {
      // room already deleted by leaveRoom; nothing else to do
    }
    clients.delete(ws);
  });

  ws.on('error', () => { /* ignore; close handler cleans up */ });
});

function gameLabel(kind) {
  return kind === 'tictactoe' ? 'Tic Tac Toe'
       : kind === 'connect4' ? 'Connect Four' : 'Rock Paper Scissors';
}

function handleMove(me, msg, ws) {
  const room = rooms.get(me.room);
  if (!room || !room.game) return send(ws, { t: 'error', msg: 'No active game.' });
  const game = room.game;
  const you = game.roles && game.roles[me.id];
  if (!you) return send(ws, { t: 'error', msg: 'You are not in this game.' });
  if (game.turn !== you) return send(ws, { t: 'error', msg: 'Not your turn.' });

  if (game.kind === 'tictactoe') {
    const idx = Number(msg.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx > 8 || game.board[idx]) {
      return send(ws, { t: 'error', msg: 'Illegal move.' });
    }
    game.board[idx] = you;
    const win = tttWinner(game.board);
    if (win) return endGame(room, you, win.line, null);
    if (game.board.every(Boolean)) return endGame(room, null, null, null);
    game.turn = you === 'X' ? 'O' : 'X';
    pushGameState(room);
  } else if (game.kind === 'connect4') {
    const col = Number(msg.col);
    if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) {
      return send(ws, { t: 'error', msg: 'Illegal move.' });
    }
    let row = -1;
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (!game.board[r * C4_COLS + col]) { row = r; break; }
    }
    if (row === -1) return send(ws, { t: 'error', msg: 'Column is full.' });
    game.board[row * C4_COLS + col] = you;
    const win = c4Winner(game.board);
    if (win) return endGame(room, you, null, win.cells);
    if (game.board.every(Boolean)) return endGame(room, null, null, null);
    game.turn = you === 'R' ? 'Y' : 'R';
    pushGameState(room);
  }
}

function endGame(room, winnerRole, line, winCells) {
  const game = room.game;
  const payload = {
    t: 'game_over', game: game.kind, board: game.board,
    winner: winnerRole, winnerName: winnerRole ? game.names[winnerRole] : null,
    draw: !winnerRole, line: line || null, winCells: winCells || null,
    names: game.names,
  };
  roomBroadcast(room, payload);
}

function handleRps(me, msg, ws) {
  const room = rooms.get(me.room);
  if (!room || !room.game || room.game.kind !== 'rps') {
    return send(ws, { t: 'error', msg: 'No active RPS game.' });
  }
  const game = room.game;
  const choice = String(msg.choice || '').toLowerCase();
  if (!['rock', 'paper', 'scissors'].includes(choice)) {
    return send(ws, { t: 'error', msg: 'Pick rock, paper or scissors.' });
  }
  if (game.choices[me.id]) return send(ws, { t: 'error', msg: 'Already chose — waiting for opponent.' });
  game.choices[me.id] = choice;
  const [p1, p2] = room.players;
  if (game.choices[p1.id] && game.choices[p2.id]) {
    const a = game.choices[p1.id], b = game.choices[p2.id];
    const res = rpsWinner(a, b);
    if (res === 'a') game.scores[p1.id]++;
    else if (res === 'b') game.scores[p2.id]++;
    // personalised reveal
    for (const p of room.players) {
      const opp = p.id === p1.id ? p2 : p1;
      const myChoice = game.choices[p.id], oppChoice = game.choices[opp.id];
      const myRes = myChoice === oppChoice ? 'draw'
        : rpsWinner(myChoice, oppChoice) === 'a' ? 'win' : 'lose';
      send(p.ws, { t: 'rps_result', you: myChoice, opponent: oppChoice,
        result: myRes, round: game.round, oppName: opp.name,
        scores: { you: game.scores[p.id], opponent: game.scores[opp.id] } });
    }
    game.choices = {};
    game.round++;
  } else {
    // let the other player know someone locked in (without revealing)
    const opp = me.id === p1.id ? p2 : p1;
    send(opp.ws, { t: 'game_state', game: 'rps', round: game.round,
      youChose: Boolean(game.choices[opp.id]), opponentLocked: true,
      scores: { you: game.scores[opp.id], opponent: game.scores[me.id] },
      oppName: me.name });
    send(ws, stateFor(game, me));
  }
}

/* ------------------------------------------------------------------ */
server.listen(PORT, () => {
  console.log('GameZone running at http://localhost:' + PORT);
});
