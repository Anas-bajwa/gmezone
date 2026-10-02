# 🎮 GameZone

An installable **PWA game hub** with 5 games, online multiplayer rooms and live chat.

## Games

| Game | Mode |
|---|---|
| ❌ Tic Tac Toe | Online 2-player |
| 🔴 Connect Four | Online 2-player |
| ✊ Rock Paper Scissors | Online 2-player |
| 🐍 Snake | Solo, works offline |
| 🃏 Memory Match | Solo, works offline |

Plus: **lobby chat + per-room chat**, **player profiles** (name + emoji avatar),
**local leaderboard** (best scores saved on your device), **sound effects + background music**
with mute, **dark/light theme**, **English + Roman Urdu** language option,
**fullscreen toggle**, **pause/resume** and game-over screens for solo games,
**copy/share room codes**, and friendly error handling throughout.

## Run it

Requirements: **Node.js 16+**.

```bash
cd gamezone
npm install     # installs the 'ws' WebSocket package
node server.js  # one command runs the website AND the multiplayer server
```

Then open **http://localhost:3000** in your browser.

> The server uses plain Node `http` + `ws` (no Express). Static files and the
> WebSocket endpoint run on the same port, so there is nothing else to configure.
> Set the `PORT` env variable to change the port: `PORT=8080 node server.js`.

## How online multiplayer works

1. Open the **Online Lobby** (🌐), set your name/avatar in **Profile** (or just type a name).
2. One player taps **Create Room** → gets a 6-letter room code (e.g. `KQ7B2D`).
3. The other player taps **Join Room** and enters the code (or uses 📋 Copy / 🔗 Share).
4. Pick **Tic Tac Toe**, **Connect Four** or **RPS** — the server runs the game,
   validates turns, detects wins/draws, and both players can **Rematch**.
5. Chat in the room while you play; if someone disconnects the other player is told.

Solo games (Snake, Memory Match) run entirely in the browser and keep working
offline once the app is installed.

## Install it like an app (PWA)

GameZone is a Progressive Web App (`manifest.json` + `service-worker.js`):

- **Android / Chrome / Edge:** open the site, then tap the **📲 Install App** button
  in the header (or browser menu → *Install app* / *Add to Home Screen*).
- **iPhone / Safari:** Share button → *Add to Home Screen*.
- **Desktop:** browser menu → *Install GameZone…*.

Installed, it launches fullscreen like a native app, and Snake + Memory Match
are playable with no internet (cache-first service worker).

## Project structure

```
gamezone/
├── package.json            # only dependency: ws
├── server.js               # http static server + WebSocket game server
├── README.md
└── public/
    ├── index.html          # hub: home, lobby, room, leaderboard, profile, settings
    ├── styles.css          # dark/light theme, mobile-first responsive
    ├── app.js              # views, i18n, settings, profile, scores, install prompt
    ├── client.js           # WebSocket client: rooms, multiplayer boards, chat
    ├── sound.js            # WebAudio SFX + chiptune music loop (no audio files)
    ├── manifest.json       # PWA manifest
    ├── sw.js               # service worker (offline support)
    ├── favicon.svg
    ├── icons/              # icon-192.png, icon-512.png (app icons)
    └── games/
        ├── snake.html      # swipe + d-pad + keyboard, pause, high score
        └── memory.html     # tap cards, pause, best moves/time
```

## WebSocket protocol (summary)

JSON messages with a `t` (type) field. Client → server: `hello`, `create_room`,
`join_room`, `leave_room`, `lobby_chat`, `room_chat`, `select_game`, `move`,
`rps`, `rematch`. Server → client: `lobby_chat`, `room_created`, `room_joined`,
`room_update`, `room_chat`, `game_state`, `game_over`, `rps_result`,
`opponent_left`, `error`. Full details are in the header comment of `server.js`.

## Notes

- Room codes are 6 characters; empty rooms are deleted automatically.
- High scores, profile, and settings are stored in `localStorage` on each device.
- No build step, no database — just `npm install` and `node server.js`.
