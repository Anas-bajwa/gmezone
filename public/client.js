/*
 * GameZone net client: WebSocket lobby, rooms, multiplayer games & chat.
 * Server is authoritative for multiplayer moves; this file renders state.
 * Exposes window.Net (used by app.js for profile updates).
 */
(function (global) {
  'use strict';

  const App = global.App, Sound = global.Sound;

  const Net = {
    ws: null,
    backoff: 1000,
    wantRoom: null,      // room code to rejoin after a reconnect
    inRoom: false,
    roomCode: null,
    players: [],
    currentGame: null,
    lastResult: null,    // for rps reveal rendering

    url() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + location.host + '/ws';
    },

    connect() {
      this.setLoading(true);
      let ws;
      try { ws = new WebSocket(this.url()); } catch { return this.scheduleReconnect(); }
      this.ws = ws;

      ws.onopen = () => {
        this.backoff = 1000;
        this.setLoading(false);
        this.hideConnBanner();
        this.hello();
        if (this.wantRoom) {
          this.send({ t: 'join_room', code: this.wantRoom });
          this.wantRoom = null;
        } else {
          App.toast(App.t('connBack'));
        }
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.onMessage(msg);
      };

      ws.onclose = () => this.scheduleReconnect();
      ws.onerror = () => { try { ws.close(); } catch {} };
    },

    scheduleReconnect() {
      this.setLoading(false);
      this.showConnBanner();
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15000);
    },

    send(obj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      }
    },

    hello() {
      this.send({ t: 'hello', name: App.displayName(), avatar: App.profile.avatar });
      this.paintProfileChip();
    },

    setLoading(on) { document.getElementById('loader').hidden = !on; },
    showConnBanner() {
      const b = document.getElementById('connBanner');
      b.textContent = '⚠️ ' + App.t('connLost');
      b.hidden = false;
    },
    hideConnBanner() { document.getElementById('connBanner').hidden = true; },

    /* ---------------- incoming ---------------- */
    onMessage(msg) {
      switch (msg.t) {
        case 'lobby_chat': this.addChat('lobbyChat', msg); Sound.notify(); break;
        case 'room_created': break; // room_joined follows
        case 'room_joined':
          this.inRoom = true; this.roomCode = msg.code; this.players = msg.players;
          App.showView('room'); this.renderRoom(); Sound.win();
          App.toast('✅ ' + App.t('youJoined') + ': ' + msg.code);
          break;
        case 'room_update': this.players = msg.players; this.renderPlayers(); break;
        case 'room_left':
          this.inRoom = false; this.roomCode = null; this.players = [];
          this.currentGame = null; App.showView('lobby');
          break;
        case 'room_chat': this.addChat('roomChat', msg); if (!msg.sys) Sound.notify(); break;
        case 'game_state': this.currentGame = msg; this.renderGame(); break;
        case 'game_over': this.currentGame = msg; this.renderGameOver(msg); break;
        case 'rps_result': this.lastResult = msg; this.renderRpsResult(msg); break;
        case 'opponent_left':
          App.toast('👋 ' + msg.name + ' — ' + App.t('opponentLeft'), 'warn');
          this.setStatus('👋 ' + msg.name + ' — ' + App.t('opponentLeft'));
          this.currentGame = null;
          document.getElementById('mpBoard').innerHTML = '';
          document.getElementById('mpActions').hidden = true;
          break;
        case 'error': App.toast('⚠️ ' + this.friendlyError(msg.msg), 'error'); Sound.lose(); break;
      }
    },

    friendlyError(serverMsg) {
      const m = String(serverMsg || '');
      if (/Room not found/i.test(m)) return App.t('roomNotFound');
      if (/Room is full/i.test(m)) return App.t('roomFull');
      if (/Wait for your opponent/i.test(m)) return App.t('waitingOpponent');
      return m; // server messages are already user-friendly
    },

    /* ---------------- lobby ---------------- */
    init() {
      document.getElementById('createBtn').addEventListener('click', () => {
        Sound.click(); this.send({ t: 'create_room' });
      });
      const joinGo = () => {
        const code = document.getElementById('joinCode').value.trim().toUpperCase();
        if (code.length !== 6) { App.toast('⚠️ ' + App.t('enterCode'), 'error'); return; }
        Sound.click(); this.send({ t: 'join_room', code });
      };
      document.getElementById('joinBtn').addEventListener('click', joinGo);
      document.getElementById('joinCode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinGo();
      });
      wireChat('lobbyChat', 'lobbyInput', 'lobbySend', (text) => this.send({ t: 'lobby_chat', text }));
      wireChat('roomChat', 'roomInput', 'roomSend', (text) => this.send({ t: 'room_chat', text }));
      this.paintProfileChip();
      this.connect();
    },

    paintProfileChip() {
      document.getElementById('chipAvatar').textContent = App.profile.avatar || '🎮';
      document.getElementById('chipName').textContent = App.displayName();
    },

    /* ---------------- room ---------------- */
    renderRoom() {
      document.getElementById('roomCode').textContent = this.roomCode;
      this.renderPlayers();
      document.getElementById('roomChat').innerHTML = '';
      document.getElementById('mpBoard').innerHTML = '';
      document.getElementById('mpActions').hidden = true;
      this.setStatus(this.players.length < 2 ? App.t('waitingOpponent') : App.t('chooseGame'));

      document.getElementById('copyBtn').onclick = () => this.copyCode();
      document.getElementById('shareBtn').onclick = () => this.shareCode();
      document.getElementById('leaveBtn').onclick = () => { Sound.click(); this.send({ t: 'leave_room' }); };
      document.getElementById('rematchBtn').onclick = () => { Sound.click(); this.send({ t: 'rematch' }); };
      document.querySelectorAll('.pickbtn').forEach(b => {
        b.onclick = () => {
          if (this.players.length < 2) { App.toast('⚠️ ' + App.t('waitingOpponent'), 'warn'); return; }
          Sound.click(); this.lastResult = null;
          this.send({ t: 'select_game', game: b.dataset.game });
        };
      });
    },

    renderPlayers() {
      const box = document.getElementById('playerList');
      box.innerHTML = '';
      this.players.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = 'player' + (p.name === App.displayName() ? ' you' : '');
        div.innerHTML = '<span class="pavatar">' + escapeHtml(p.avatar || '🎮') + '</span>' +
          '<span class="pname">' + escapeHtml(p.name) + '</span>' +
          (p.name === App.displayName() ? '<em>· you</em>' : '') +
          (i === 0 ? '<span class="host">HOST</span>' : '');
        box.appendChild(div);
      });
      if (this.inRoom && this.players.length < 2) this.setStatus(App.t('waitingOpponent'));
      else if (this.inRoom && !this.currentGame) this.setStatus(App.t('chooseGame'));
    },

    copyCode() {
      Sound.click();
      const done = () => App.toast('📋 ' + App.t('copyOk'));
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(this.roomCode).then(done).catch(() => fallbackCopy());
      } else fallbackCopy();
      function fallbackCopy() {
        const ta = document.createElement('textarea');
        ta.value = Net.roomCode; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); done(); } catch {}
        ta.remove();
      }
    },

    shareCode() {
      Sound.click();
      const text = 'Join my GameZone room! Code: ' + this.roomCode + ' — ' + location.origin;
      if (navigator.share) navigator.share({ title: 'GameZone', text }).catch(() => {});
      else this.copyCode();
    },

    setStatus(s) { document.getElementById('mpStatus').textContent = s; },

    /* ---------------- multiplayer rendering ---------------- */
    renderGame() {
      const g = this.currentGame;
      if (!g) return;
      document.getElementById('mpActions').hidden = false;
      if (g.game === 'tictactoe') this.renderTtt(g);
      else if (g.game === 'connect4') this.renderC4(g);
      else if (g.game === 'rps') this.renderRps(g);
    },

    renderTtt(g) {
      this.setStatus(g.yourTurn ? '🎯 ' + App.t('yourTurn') + ' (' + g.you + ')'
                                : '⏳ ' + App.t('opponentTurn') + ' (' + g.turn + ')');
      const board = document.getElementById('mpBoard');
      board.innerHTML = '<div class="ttt-grid"></div>';
      const grid = board.firstChild;
      g.board.forEach((v, i) => {
        const c = document.createElement('button');
        c.className = 'ttt-cell' + (v ? ' filled ' + v : '');
        c.textContent = v || '';
        c.disabled = !g.yourTurn || v;
        c.addEventListener('click', () => {
          Sound.move(); this.send({ t: 'move', idx: i });
        });
        grid.appendChild(c);
      });
    },

    renderC4(g) {
      const myColor = g.you === 'R' ? '🔴' : '🟡';
      this.setStatus(g.yourTurn ? '🎯 ' + App.t('yourTurn') + ' ' + myColor
                                : '⏳ ' + App.t('opponentTurn'));
      const board = document.getElementById('mpBoard');
      board.innerHTML = '<div class="c4-colbtns"></div><div class="c4-grid"></div>';
      const btns = board.querySelector('.c4-colbtns');
      const grid = board.querySelector('.c4-grid');
      for (let c = 0; c < 7; c++) {
        const b = document.createElement('button');
        b.className = 'c4-colbtn'; b.textContent = '▼';
        b.disabled = !g.yourTurn;
        b.addEventListener('click', () => { Sound.drop(); this.send({ t: 'move', col: c }); });
        btns.appendChild(b);
      }
      g.board.forEach((v) => {
        const d = document.createElement('div');
        d.className = 'c4-cell' + (v === 'R' ? ' red' : v === 'Y' ? ' yellow' : '');
        grid.appendChild(d);
      });
    },

    renderRps(g) {
      const box = document.getElementById('mpBoard');
      const score = g.scores.you + ' – ' + g.scores.opponent;
      if (g.youChose && !this.lastResult) {
        this.setStatus('✊ ' + App.t('waiting') + ' (' + escapeHtml(g.oppName) + ')');
        box.innerHTML = '<div class="rps-wait"><div class="big-emoji">⏳</div><p>' +
          App.t('waiting') + '</p><p class="score-line">' + escapeHtml(App.displayName()) +
          ' ' + score + ' ' + escapeHtml(g.oppName) + '</p></div>';
        return;
      }
      this.setStatus('✊ Round ' + g.round + ' — ' +
        (g.opponentLocked ? '⚡ ' + escapeHtml(g.oppName) + ' locked in, your pick!' : App.t('chooseGame')));
      box.innerHTML = '<div class="rps-choices"></div><p class="score-line">' +
        escapeHtml(App.displayName()) + ' ' + score + ' ' + escapeHtml(g.oppName) + '</p>';
      const wrap = box.querySelector('.rps-choices');
      [['rock', '🪨'], ['paper', '📄'], ['scissors', '✂️']].forEach(([k, e]) => {
        const b = document.createElement('button');
        b.className = 'rps-btn'; b.innerHTML = '<span>' + e + '</span><small>' + k + '</small>';
        b.addEventListener('click', () => {
          Sound.click(); this.lastResult = null; this.send({ t: 'rps', choice: k });
        });
        wrap.appendChild(b);
      });
    },

    renderRpsResult(r) {
      const box = document.getElementById('mpBoard');
      const emo = { rock: '🪨', paper: '📄', scissors: '✂️' };
      const title = r.result === 'win' ? App.t('youWin') : r.result === 'lose' ? App.t('youLose') : App.t('draw');
      if (r.result === 'win') Sound.win(); else if (r.result === 'lose') Sound.lose(); else Sound.move();
      this.setStatus('✊ Round ' + r.round + ' — ' + title);
      box.innerHTML =
        '<div class="rps-result"><div class="rps-fight"><div><div class="big-emoji">' + emo[r.you] +
        '</div><small>' + escapeHtml(App.displayName()) + '</small></div>' +
        '<div class="vs">VS</div><div><div class="big-emoji">' + emo[r.opponent] +
        '</div><small>' + escapeHtml(r.oppName) + '</small></div></div>' +
        '<h3>' + title + '</h3>' +
        '<p class="score-line">' + escapeHtml(App.displayName()) + ' ' + r.scores.you + ' – ' +
        r.scores.opponent + ' ' + escapeHtml(r.oppName) + '</p>' +
        '<button class="btn primary" id="rpsNext">' + App.t('play') + ' — Round ' + (r.round + 1) + '</button></div>';
      document.getElementById('rpsNext').addEventListener('click', () => {
        Sound.click(); this.lastResult = null;
        // Server already cleared choices and advanced the round —
        // just show the choice buttons again for the next round.
        this.renderRps({ game: 'rps', round: r.round + 1, youChose: false,
          scores: r.scores, oppName: r.oppName });
      });
      this.lastResult = null;
    },

    renderGameOver(g) {
      // paint final board, then overlay result
      const ghost = Object.assign({}, g, { yourTurn: false });
      if (g.game === 'tictactoe' || g.game === 'connect4') {
        const tmp = this.currentGame; this.currentGame = ghost; this.renderGame(); this.currentGame = tmp;
        this.highlightWin(g);
      }
      const title = g.draw ? App.t('draw')
        : (g.winnerName === App.displayName() ? App.t('youWin') : App.t('youLose'));
      if (!g.draw && g.winnerName === App.displayName()) Sound.win(); else Sound.lose();
      this.setStatus('🏁 ' + title + (g.winnerName && !g.draw ? ' — ' + g.winnerName : ''));
      const board = document.getElementById('mpBoard');
      const ov = document.createElement('div');
      ov.className = 'gameover-overlay';
      ov.innerHTML = '<div class="gameover-card"><h2>' + escapeHtml(title) + '</h2>' +
        (g.winnerName && !g.draw ? '<p>🏆 ' + escapeHtml(g.winnerName) + '</p>' : '') +
        '<div class="row"><button class="btn primary" id="goRematch">' + App.t('rematch') +
        '</button><button class="btn ghost" id="goClose">' + App.t('close') + '</button></div></div>';
      board.appendChild(ov);
      document.getElementById('goRematch').addEventListener('click', () => { Sound.click(); this.send({ t: 'rematch' }); });
      document.getElementById('goClose').addEventListener('click', () => { Sound.click(); ov.remove(); });
    },

    highlightWin(g) {
      const board = document.getElementById('mpBoard');
      if (g.game === 'tictactoe' && g.line) {
        g.line.forEach(i => board.querySelectorAll('.ttt-cell')[i].classList.add('win'));
      }
      if (g.game === 'connect4' && g.winCells) {
        g.winCells.forEach(i => board.querySelectorAll('.c4-cell')[i].classList.add('win'));
      }
    },

    /* ---------------- chat ---------------- */
    addChat(boxId, msg) {
      const box = document.getElementById(boxId);
      const div = document.createElement('div');
      div.className = 'chat-msg' + (msg.sys ? ' sys' : '') +
        (msg.name === App.displayName() ? ' mine' : '');
      const time = new Date(msg.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = msg.sys
        ? '<span class="ctext">' + escapeHtml(msg.text) + '</span>'
        : '<span class="cavatar">' + escapeHtml(msg.avatar || '🎮') + '</span>' +
          '<div class="cbody"><div class="chead"><strong>' + escapeHtml(msg.name) +
          '</strong><time>' + time + '</time></div>' +
          '<div class="ctext">' + escapeHtml(msg.text) + '</div></div>';
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
      // keep DOM small
      while (box.children.length > 120) box.firstChild.remove();
    },
  };

  function wireChat(boxId, inputId, sendId, onSend) {
    const input = document.getElementById(inputId);
    const go = () => {
      const text = input.value.trim();
      if (!text) return;
      Sound.click(); onSend(text); input.value = ''; input.focus();
    };
    document.getElementById(sendId).addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  global.Net = Net;
  document.addEventListener('DOMContentLoaded', () => Net.init());
})(window);
