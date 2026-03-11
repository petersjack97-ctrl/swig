# SWIG

A multiplayer party drinking game. Host displays on a TV, players join on their phones by scanning a QR code. Questions are AI-generated via the Claude API.

## Setup

```bash
npm install
cp .env.example .env
# Add your Anthropic API key to .env
npm run dev
```

## Running

```
Host (TV):  http://localhost:3000/host/
Player:     http://localhost:3000/player/
```

Players join by scanning the QR code shown on the host screen.

## Game Flow

1. Host opens `/host/` on a TV — a QR code appears pointing to the player join page
2. Players scan the QR code, enter their name and a topic they claim expertise in
3. Host presses **Start** (or `Enter`) → Claude generates questions → game begins
4. Game runs **10 trivia rounds + 1 expert round per player**, then ends with a leaderboard

## Round Types

### Buzzer Trivia
A general trivia question appears on the TV and all phones. Host opens the buzzer (`Space`). First player to tap the giant buzzer button on their phone wins the right to answer.
- Correct: **+3 pts**
- Wrong: drink

### Hot Seat (Expert)
A player is called out and gets a question about their declared expertise topic.
- Correct: **+2 pts** + pick someone to drink
- Wrong: they drink

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (required) |
| `PORT` | Server port (default: 3000) |

## Tech Stack

- **Node.js + Express** — HTTP server
- **Socket.IO** — Real-time communication between host and players
- **Claude API (claude-sonnet-4-6)** — AI-generated trivia and expert questions
- **QRCode** — QR code generation for player join
