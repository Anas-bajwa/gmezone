/*
 * GameZone app shell: views, settings, profile, leaderboard, i18n,
 * toasts, modals, PWA install prompt, fullscreen, service worker.
 * Loaded before client.js. Exposes window.App.
 */
(function (global) {
  'use strict';

  /* ---------------- i18n ---------------- */
  const I18N = {
    en: {
      tagline: '5 games, online multiplayer & chat — all in one installable app',
      play: 'Play', howToPlay: 'How to play', home: 'Home', leaderboard: 'Leaderboard',
      profile: 'Profile', settings: 'Settings', lobby: 'Online Lobby',
      createRoom: 'Create Room', joinRoom: 'Join Room', roomCode: 'Room Code',
      enterCode: 'Enter 6-letter code', yourName: 'Your name', players: 'Players',
      chooseGame: 'Choose a game', waitingOpponent: 'Waiting for opponent to join…',
      rematch: 'Rematch', leaveRoom: 'Leave Room', send: 'Send',
      typeMessage: 'Type a message…', copyCode: 'Copy code', installApp: 'Install App',
      sound: 'Sound effects', music: 'Background music', theme: 'Theme', language: 'Language',
      dark: 'Dark', light: 'Light', save: 'Save', bestScores: 'Your Best Scores',
      noScores: 'No scores yet — go play!', playAgain: 'Play Again', gameOver: 'Game Over',
      youWin: 'You Win! 🎉', youLose: 'You Lose', draw: "It's a Draw",
      yourTurn: 'Your turn', opponentTurn: "Opponent's turn", waiting: 'Waiting…',
      pause: 'Pause', resume: 'Resume', start: 'Start', score: 'Score', best: 'Best',
      moves: 'Moves', time: 'Time', close: 'Close', back: 'Back',
      singlePlayer: 'Solo · offline', multiplayer: 'Online · 2 players',
      chooseAvatar: 'Choose your avatar', copyOk: 'Room code copied!',
      connLost: 'Connection lost — reconnecting…', connBack: 'Back online!',
      roomFull: 'That room is full.', roomNotFound: 'Room not found — check the code.',
      opponentLeft: 'Opponent left the room.', youJoined: 'You joined the room',
      fullscreen: 'Fullscreen', clearData: 'Clear saved data', dataCleared: 'Saved data cleared.',
      newBest: 'New best!', share: 'Share', lobbyChat: 'Lobby Chat (everyone online)',
      roomChat: 'Room Chat', startPlaying: 'Start Playing', tapToStart: 'Tap Start when ready',
      confirmClear: 'Clear all saved scores, profile and settings?',
    },
    ur: {
      tagline: '5 games, online multiplayer aur chat — sab ek installable app mein',
      play: 'Khelo', howToPlay: 'Khelne ka tareeqa', home: 'Home', leaderboard: 'Leaderboard',
      profile: 'Profile', settings: 'Settings', lobby: 'Online Lobby',
      createRoom: 'Room Banao', joinRoom: 'Room Join Karo', roomCode: 'Room Code',
      enterCode: '6 harf ka code likho', yourName: 'Apna naam', players: 'Khilari',
      chooseGame: 'Game chuno', waitingOpponent: 'Opponent ka intezar hai…',
      rematch: 'Dobara Khelo', leaveRoom: 'Room Chhoro', send: 'Bhejo',
      typeMessage: 'Message likho…', copyCode: 'Code copy karo', installApp: 'App Install Karo',
      sound: 'Sound effects', music: 'Background music', theme: 'Theme', language: 'Zubaan',
      dark: 'Dark', light: 'Light', save: 'Save karo', bestScores: 'Apke Best Scores',
      noScores: 'Abhi koi score nahi — khelo!', playAgain: 'Dobara Khelo', gameOver: 'Game Over',
      youWin: 'Jeet Gaye! 🎉', youLose: 'Haar Gaye', draw: 'Draw ho gaya',
      yourTurn: 'Apki baari', opponentTurn: 'Opponent ki baari', waiting: 'Intezar…',
      pause: 'Roko', resume: 'Jari rakho', start: 'Shuru karo', score: 'Score', best: 'Best',
      moves: 'Chaalain', time: 'Waqt', close: 'Band karo', back: 'Wapas',
      singlePlayer: 'Akela · offline', multiplayer: 'Online · 2 khilari',
      chooseAvatar: 'Apna avatar chuno', copyOk: 'Room code copy ho gaya!',
      connLost: 'Connection toot gaya — dobara connect ho raha hai…', connBack: 'Wapas online!',
      roomFull: 'Room full hai.', roomNotFound: 'Room nahi mila — code check karo.',
      opponentLeft: 'Opponent room chhor gaya.', youJoined: 'Ap room mein aa gaye',
      fullscreen: 'Fullscreen', clearData: 'Saved data clear karo', dataCleared: 'Saved data clear ho gaya.',
      newBest: 'Naya best!', share: 'Share karo', lobbyChat: 'Lobby Chat (sab online log)',
      roomChat: 'Room Chat', startPlaying: 'Khelna Shuru Karo', tapToStart: 'Taiyar ho to Start dabao',
      confirmClear: 'Scores, profile aur settings clear kar dein?',
    }
  };

  /* ---------------- storage helpers ---------------- */
  const store = {
    read(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
      catch { return fallback; }
    },
    write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  };

  const DEFAULT_SETTINGS = { theme: 'dark', sound: true, music: true, lang: 'en' };

  const App = {
    settings: Object.assign({}, DEFAULT_SETTINGS, store.read('gz_settings', {})),
    profile: Object.assign({ name: '', avatar: '🎮' }, store.read('gz_profile', {})),
    scores: Object.assign({ snake: 0, memory: null }, store.read('gz_scores', {})),
    // memory best stored as {moves, time}
    deferredInstall: null,
    currentView: 'home',

    t(key) {
      const lang = I18N[this.settings.lang] ? this.settings.lang : 'en';
      return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    },

    saveSettings() {
      store.write('gz_settings', this.settings);
      document.body.dataset.theme = this.settings.theme;
      document.querySelector('meta[name="theme-color"]')
        .setAttribute('content', this.settings.theme === 'dark' ? '#0b0e1a' : '#f2f4fb');
      Sound.refreshMusic();
    },
    saveProfile() { store.write('gz_profile', this.profile); },
    saveScores() { store.write('gz_scores', this.scores); },

    displayName() {
      return this.profile.name.trim() || 'Player' + Math.floor(1000 + Math.random() * 9000);
    },

    /* ---------------- views ---------------- */
    showView(name) {
      this.currentView = name;
      document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
      document.querySelectorAll('.navbtn').forEach(b =>
        b.classList.toggle('active', b.dataset.view === name));
      if (name === 'leaderboard') this.renderLeaderboard();
      window.scrollTo({ top: 0 });
    },

    /* ---------------- toast ---------------- */
    toast(msg, kind) {
      const box = document.getElementById('toastBox');
      const el = document.createElement('div');
      el.className = 'toast' + (kind ? ' ' + kind : '');
      el.textContent = msg;
      box.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 2600);
    },

    /* ---------------- how-to-play modal ---------------- */
    openHowTo(gameId, onPlay) {
      const data = HOWTO[gameId];
      if (!data) { onPlay(); return; }
      document.getElementById('howtoTitle').textContent = data.title;
      document.getElementById('howtoBody').innerHTML = data.html;
      const playBtn = document.getElementById('howtoPlay');
      playBtn.textContent = this.t('play');
      playBtn.onclick = () => { Sound.click(); this.closeModal(); onPlay(); };
      document.getElementById('howtoModal').hidden = false;
    },
    closeModal() { document.getElementById('howtoModal').hidden = true; },

    /* ---------------- leaderboard ---------------- */
    renderLeaderboard() {
      const s = this.scores;
      const rows = [];
      rows.push({ game: '🐍 Snake', val: s.snake > 0 ? s.snake + ' pts' : '—' });
      if (s.memory) {
        rows.push({ game: '🃏 Memory Match', val: s.memory.moves + ' ' + this.t('moves') + ' · ' + s.memory.time + 's' });
      } else rows.push({ game: '🃏 Memory Match', val: '—' });
      rows.push({ game: '❌ Tic Tac Toe', val: this.t('multiplayer') });
      rows.push({ game: '🔴 Connect Four', val: this.t('multiplayer') });
      rows.push({ game: '✊ Rock Paper Scissors', val: this.t('multiplayer') });
      document.getElementById('lbRows').innerHTML = rows.map(r =>
        '<div class="lb-row"><span>' + r.game + '</span><strong>' + r.val + '</strong></div>').join('');
      document.getElementById('lbEmpty').hidden = s.snake > 0 || s.memory;
    },

    /* ---------------- install prompt ---------------- */
    setupInstall() {
      const btns = [document.getElementById('installBtn'), document.getElementById('installBtn2')]
        .filter(Boolean);
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredInstall = e;
        btns.forEach(b => b.hidden = false);
      });
      const doInstall = async () => {
        Sound.click();
        if (!this.deferredInstall) {
          // Fallback instructions when the browser has no automatic prompt
          this.toast('📲 ' + (this.settings.lang === 'ur'
            ? 'Browser menu → "Add to Home Screen" dabao'
            : 'Open browser menu → "Add to Home Screen" / "Install"'));
          return;
        }
        this.deferredInstall.prompt();
        await this.deferredInstall.userChoice.catch(() => {});
        this.deferredInstall = null;
        btns.forEach(b => b.hidden = true);
      };
      btns.forEach(b => b.addEventListener('click', doInstall));
      // iOS never fires beforeinstallprompt — show button with instructions
      const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isiOS) btns.forEach(b => b.hidden = false);
    },

    toggleFullscreen() {
      Sound.click();
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      } catch {}
    },

    init() {
      // theme + language
      document.body.dataset.theme = this.settings.theme;
      this.applyI18n();
      this.saveSettings();

      // nav
      document.querySelectorAll('.navbtn').forEach(b =>
        b.addEventListener('click', () => { Sound.click(); this.showView(b.dataset.view); }));
      document.getElementById('logoBtn').addEventListener('click', () => this.showView('home'));
      document.getElementById('fsBtn').addEventListener('click', () => this.toggleFullscreen());
      const sndBtn = document.getElementById('soundBtn');
      const paintSnd = () => sndBtn.textContent = this.settings.sound ? '🔊' : '🔇';
      paintSnd();
      sndBtn.addEventListener('click', () => {
        this.settings.sound = !this.settings.sound;
        this.saveSettings(); paintSnd(); Sound.click();
      });

      // home cards
      document.querySelectorAll('.gcard').forEach(card => {
        const id = card.dataset.game;
        card.querySelector('.btn-howto').addEventListener('click', (e) => {
          e.stopPropagation(); Sound.click(); this.openHowTo(id, () => this.playGame(id));
        });
        card.querySelector('.btn-play').addEventListener('click', () => {
          Sound.click(); this.openHowTo(id, () => this.playGame(id));
        });
      });

      // settings page
      this.initSettings();
      this.initProfile();
      this.setupInstall();

      // modal close
      document.getElementById('howtoClose').addEventListener('click', () => this.closeModal());
      document.getElementById('howtoModal').addEventListener('click', (e) => {
        if (e.target.id === 'howtoModal') this.closeModal();
      });

      // service worker (PWA offline support)
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
      }
    },

    playGame(id) {
      if (id === 'snake') location.href = '/games/snake.html';
      else if (id === 'memory') location.href = '/games/memory.html';
      else this.showView('lobby'); // multiplayer games go through the lobby
    },

    applyI18n() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = this.t(el.dataset.i18n);
      });
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        el.placeholder = this.t(el.dataset.i18nPh);
      });
      document.documentElement.lang = this.settings.lang === 'ur' ? 'ur' : 'en';
    },

    initSettings() {
      const s = this.settings;
      const themeSeg = document.getElementById('setTheme');
      const paintTheme = () => {
        themeSeg.querySelectorAll('button').forEach(b =>
          b.classList.toggle('active', b.dataset.val === s.theme));
      };
      paintTheme();
      themeSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        s.theme = b.dataset.val; this.saveSettings(); paintTheme(); Sound.click();
      }));
      const snd = document.getElementById('setSound'), mus = document.getElementById('setMusic');
      snd.checked = s.sound !== false; mus.checked = s.music !== false;
      snd.addEventListener('change', () => { s.sound = snd.checked; this.saveSettings(); Sound.click(); });
      mus.addEventListener('change', () => { s.music = mus.checked; this.saveSettings(); });
      const lang = document.getElementById('setLang');
      lang.value = s.lang;
      lang.addEventListener('change', () => {
        s.lang = lang.value; this.saveSettings(); this.applyI18n(); Sound.click();
        this.toast('🌐 ' + (s.lang === 'ur' ? 'Zubaan badal gayi' : 'Language changed'));
      });
      document.getElementById('fsBtn2').addEventListener('click', () => this.toggleFullscreen());
      document.getElementById('clearBtn').addEventListener('click', () => {
        if (!confirm(this.t('confirmClear'))) return;
        localStorage.removeItem('gz_scores'); localStorage.removeItem('gz_profile');
        this.scores = { snake: 0, memory: null };
        this.profile = { name: '', avatar: '🎮' };
        this.initProfile(); this.renderLeaderboard();
        this.toast(this.t('dataCleared'));
      });
    },

    initProfile() {
      const AVATARS = ['🎮','😎','🤖','👾','🐼','🦊','🐯','🦁','🐸','🐵','👻','💀','🧙','🦄','🐲','⚡'];
      const grid = document.getElementById('avatarGrid');
      grid.innerHTML = '';
      const paint = () => {
        grid.querySelectorAll('.avatar').forEach(a =>
          a.classList.toggle('sel', a.dataset.a === this.profile.avatar));
        document.getElementById('profilePreview').textContent = this.profile.avatar;
      };
      AVATARS.forEach(a => {
        const b = document.createElement('button');
        b.className = 'avatar'; b.dataset.a = a; b.textContent = a;
        b.addEventListener('click', () => { this.profile.avatar = a; paint(); Sound.click(); });
        grid.appendChild(b);
      });
      const nameInput = document.getElementById('profileName');
      nameInput.value = this.profile.name;
      paint();
      document.getElementById('profileSave').addEventListener('click', () => {
        this.profile.name = nameInput.value.trim().slice(0, 20);
        this.saveProfile(); Sound.win();
        this.toast('✅ ' + this.t('save'));
        if (window.Net) Net.hello(); // update name/avatar live
      });
    },
  };

  /* ---------------- how-to-play content ---------------- */
  const HOWTO = {
    tictactoe: { title: '❌ Tic Tac Toe',
      html: '<ul><li>2 players, online. You are <b>X</b> or <b>O</b>.</li><li>Tap a square on your turn.</li><li>First to get <b>3 in a row</b> wins. No row = draw.</li></ul>' },
    connect4: { title: '🔴 Connect Four',
      html: '<ul><li>2 players, online. You are <b>🔴 Red</b> or <b>🟡 Yellow</b>.</li><li>Tap a column to drop your disc.</li><li>First to connect <b>4 in a row</b> (any direction) wins.</li></ul>' },
    rps: { title: '✊ Rock Paper Scissors',
      html: '<ul><li>2 players, online.</li><li>Pick <b>🪨 Rock</b>, <b>📄 Paper</b> or <b>✂️ Scissors</b> each round.</li><li>Rock beats Scissors, Scissors beats Paper, Paper beats Rock.</li><li>Scores are kept across rounds.</li></ul>' },
    snake: { title: '🐍 Snake',
      html: '<ul><li>Eat the red apples to grow and score.</li><li>Don\'t hit the walls or yourself!</li><li><b>Desktop:</b> arrow keys / WASD, <b>P</b> to pause.</li><li><b>Mobile:</b> swipe anywhere, or use the on-screen pad.</li><li>Speed increases as you eat. Good luck!</li></ul>' },
    memory: { title: '🃏 Memory Match',
      html: '<ul><li>Tap cards to flip them and find all <b>8 pairs</b>.</li><li>Finish in fewer moves and less time for a better score.</li><li>Use the pause button anytime — the timer stops too.</li></ul>' },
  };

  global.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})(window);
