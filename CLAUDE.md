# SWIG — Party Drinking Game

## What it is
A multiplayer party drinking game. Host displays on a TV, players join on their phones by scanning a QR code. AI-generated questions via Claude API.

## How to run
```bash
cd ~/Desktop/DEV/drink_game
/opt/homebrew/bin/npm run dev
# Host: http://localhost:3000/host/
# Player: http://localhost:3000/player/
```
Node is at `/opt/homebrew/bin/node` (installed via Homebrew, not on PATH by default).

## Game flow
1. Host opens `/host/` on TV — QR code appears pointing to LAN IP `/player/`
2. Players scan QR, enter their name + a topic they claim expertise in
3. Host presses START (or Enter) → Claude generates questions → game begins
4. Game runs **10 trivia (buzzer) rounds + 1 expert round per player**, then auto-ends with leaderboard

## Two round types

### Hot Seat (Expert)
- A random player is called out dramatically on the TV
- They get a question **directly about their declared expertise topic** on their phone
- Correct → +2pts, they pick any other player to drink (target gets a 🍺 popup on their phone saying "OH NO!")
- Wrong → they drink

### Buzzer Trivia
- General trivia question shown on TV and all phones
- Host presses OPEN BUZZER (or Space bar)
- First player to tap the giant pink circle button on their phone wins the right to answer
- Correct → +3pts | Wrong → they drink

## File structure
```
drink_game/
├── .env                      ← ANTHROPIC_API_KEY
├── package.json
├── server.js                 ← Express + Socket.io + QR endpoint (/qr)
├── src/
│   ├── game.js               ← State machine (lobby→generating→playing→results)
│   ├── ai.js                 ← Claude claude-sonnet-4-6, expert + trivia generation, fallbacks
│   └── socket-handlers.js    ← All socket event wiring
└── public/
    ├── host/index.html       ← TV display (7 view states)
    ├── player/index.html     ← Phone display (8 view states + buzzer)
    └── shared/style.css      ← Arcade theme (Press Start 2P + Nunito fonts)
```

## UI / Theme
- Name: **SWIG**
- Style: airy light background (`#F8F9FF`) with neon pink/blue/green accents
- Fonts: Press Start 2P (arcade headers) + Nunito (body)
- Buzzer button: 80vw pink circle with pulse glow animation
- Beer popup: fullscreen pink overlay with bouncing 🍺 + "OH NO!" when someone sends you a drink

## Key socket events
| Event | Direction | Purpose |
|---|---|---|
| `join_as_host` | client→server | Register as host |
| `join_as_player` | client→server | Join with name + expertise |
| `host_start_game` | client→server | Trigger AI generation + start |
| `player_expert_answer` | client→server | Hot seat answer |
| `host_open_buzzer` | client→server | Open buzzer for trivia |
| `player_buzz` | client→server | Buzz in |
| `player_trivia_answer` | client→server | Trivia answer after buzzing |
| `pick_drinker` | client→server | Hot seat winner picks who drinks |
| `host_next_question` | client→server | Advance to next round (→ key) |
| `drink_received` | server→client | Private notification to drink target |
| `game_over` | server→client | Auto-fires when all questions used |

## Host keyboard shortcuts
- `Enter` — Start game
- `Space` — Open buzzer
- `→` — Next question

## AI question config (src/ai.js)
- Expert questions: must be **directly about the player's declared topic** (e.g. math expert → math question)
- Trivia: avoids players' expertise topics, mixed categories
- Both have hardcoded fallback questions if API fails

## Game constants (src/socket-handlers.js)
```js
EXPERT_QUESTIONS_PER_PLAYER = 1
TRIVIA_QUESTIONS_COUNT = 10
```

## Scoring
- Hot seat correct: +2pts
- Trivia buzzer correct: +3pts
- Wrong answer (either type): +1 drink, 0pts
- Pick who drinks: target gets +1 drink

## Repo notes
- `drink_game/` has its own `.git` and is independent of any parent repo on this machine. Commit and push from inside `~/Desktop/DEV/drink_game/`, not from a parent directory.
- GitHub: https://github.com/petersjack97-ctrl/swig

## Network requirement
- The QR code points to the host machine's LAN IP. Players must be on the **same WiFi network** as the host for it to work. The game will not work over the internet or across different networks.
