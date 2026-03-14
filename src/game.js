'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

function createInitialState() {
  return {
    phase: 'lobby',               // lobby | generating | playing | results
    hostSocketId: null,
    players: {},
    questionPool: {
      expert: {},                 // { [socketId]: [{question,choices,correctIndex,used}] }
      trivia: []                  // [{question,choices,correctIndex,category,used}]
    },
    currentRound: createEmptyRound(),
    roundHistory: [],
    consecutiveBuzzerRounds: 0,   // force hot seat after 3 consecutive buzzer rounds
    hotSeatQueue: [],             // players who haven't had a hot seat yet
    roundNumber: 0,
    act: 1,                       // current act (1 | 2 | 3)
    drinkMultiplier: 1,           // 1x | 2x | 3x
    actBoundaries: [],            // [endOfAct1, endOfAct2, total]
    actJustChanged: false,        // flag consumed by socket-handlers to emit transition
    luckyDrinkRounds: new Set()  // round numbers after which a lucky drink fires
  };
}

function createEmptyRound() {
  return {
    type: null,                   // 'hot_seat' | 'buzzer'
    // Hot seat fields
    hotSeatPlayerId: null,
    hotSeatPlayerName: null,
    hotSeatExpertise: null,
    question: null,
    answered: false,
    answeredCorrectly: null,
    pickingDrinker: false,
    // Buzzer fields
    buzzerOpen: false,
    buzzedPlayerId: null,
    buzzedPlayerName: null,
    answerSubmitted: false,
    timedOut: false,
    buzzerEndsAt: null,
  };
}

let state = createInitialState();

// ─── Getters ─────────────────────────────────────────────────────────────────

function getState() { return state; }

function getPublicState() {
  const players = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = {
      id: p.id,
      name: p.name,
      expertise: p.expertise,
      score: p.score,
      drinks: p.drinks,
      connected: p.connected
    };
  }
  return {
    phase: state.phase,
    players,
    currentRound: { ...state.currentRound, question: null },
    roundNumber: state.roundNumber,
    act: state.act,
    drinkMultiplier: state.drinkMultiplier
  };
}

function getConnectedPlayerCount() {
  return Object.values(state.players).filter(p => p.connected).length;
}

function getConnectedPlayers() {
  return Object.values(state.players).filter(p => p.connected);
}

// ─── Player management ───────────────────────────────────────────────────────

function addPlayer(socketId, name, expertise) {
  state.players[socketId] = {
    id: socketId,
    name: name.trim().slice(0, 20),
    expertise: expertise.trim().slice(0, 40),
    score: 0,
    drinks: 0,
    connected: true
  };
}

function removePlayer(socketId) {
  if (state.players[socketId]) {
    state.players[socketId].connected = false;
  }
}

function isHost(socketId) {
  return state.hostSocketId === socketId;
}

function setHost(socketId) {
  state.hostSocketId = socketId;
}

// ─── Game start ──────────────────────────────────────────────────────────────

function startGenerating() {
  state.phase = 'generating';
}

function loadQuestions(expertQuestions, triviaQuestions) {
  state.questionPool.trivia = triviaQuestions.map(q => ({ ...q, used: false }));

  for (const [sid, questions] of Object.entries(expertQuestions)) {
    state.questionPool.expert[sid] = questions.map(q => ({ ...q, used: false }));
  }

  const totalTrivia = state.questionPool.trivia.length;
  const totalExpert = Object.values(state.questionPool.expert)
    .reduce((sum, pool) => sum + pool.length, 0);
  state.actBoundaries = computeActBoundaries(totalTrivia + totalExpert);
  state.luckyDrinkRounds = computeLuckyDrinkRounds(state.actBoundaries);

  state.hotSeatQueue = Object.keys(state.players).filter(id => state.players[id].connected);
  shuffle(state.hotSeatQueue);

  state.phase = 'playing';
}

function computeActBoundaries(totalRounds) {
  const base = Math.floor(totalRounds / 3);
  const rem = totalRounds % 3;
  const end1 = base + (rem > 0 ? 1 : 0);
  const end2 = end1 + base + (rem > 1 ? 1 : 0);
  return [end1, end2, totalRounds];
}

function computeLuckyDrinkRounds(actBoundaries) {
  const [end1, end2, total] = actBoundaries;
  const acts = [
    { start: 1, end: end1 },
    { start: end1 + 1, end: end2 },
    { start: end2 + 1, end: total }
  ];
  const rounds = new Set();
  for (const { start, end } of acts) {
    if (start <= end) {
      rounds.add(start + Math.floor(Math.random() * (end - start + 1)));
    }
  }
  return rounds;
}

function shouldFireLuckyDrink() {
  return state.luckyDrinkRounds.has(state.roundNumber);
}

function pickRandomDrinker() {
  const connected = getConnectedPlayers();
  if (connected.length === 0) return null;
  const player = connected[Math.floor(Math.random() * connected.length)];
  player.drinks += state.drinkMultiplier;
  return { id: player.id, name: player.name };
}

function checkAndAdvanceAct() {
  if (state.actBoundaries.length === 0) return;
  const rn = state.roundNumber;
  if (state.act === 1 && rn > state.actBoundaries[0]) {
    state.act = 2;
    state.drinkMultiplier = 2;
    state.actJustChanged = true;
  } else if (state.act === 2 && rn > state.actBoundaries[1]) {
    state.act = 3;
    state.drinkMultiplier = 3;
    state.actJustChanged = true;
  }
}

// ─── Round logic ─────────────────────────────────────────────────────────────

function isGameOver() {
  const triviaLeft = state.questionPool.trivia.some(q => !q.used);
  const expertLeft = Object.values(state.questionPool.expert).some(pool =>
    pool.some(q => !q.used)
  );
  return !triviaLeft && !expertLeft;
}

function decideNextRoundType() {
  const players = getConnectedPlayers();
  if (players.length === 0) return 'buzzer';

  if (isGameOver()) return 'game_over';

  const triviaLeft = state.questionPool.trivia.some(q => !q.used);
  const anyExpertLeft = players.some(p => {
    const pool = state.questionPool.expert[p.id] || [];
    return pool.some(q => !q.used);
  });

  if (!triviaLeft) return 'hot_seat';
  if (!anyExpertLeft) return 'buzzer';

  if (state.consecutiveBuzzerRounds >= 3 && state.hotSeatQueue.length > 0) {
    return 'hot_seat';
  }

  return Math.random() < 0.5 ? 'hot_seat' : 'buzzer';
}

function startHotSeatRound() {
  if (state.hotSeatQueue.length === 0) {
    state.hotSeatQueue = Object.keys(state.players)
      .filter(id => state.players[id].connected);
    shuffle(state.hotSeatQueue);
  }

  let playerId = null;
  let attemptCount = 0;
  while (state.hotSeatQueue.length > 0 && attemptCount < state.hotSeatQueue.length) {
    const candidate = state.hotSeatQueue[0];
    const pool = state.questionPool.expert[candidate] || [];
    const hasQ = pool.some(q => !q.used);
    if (hasQ && state.players[candidate]?.connected) {
      playerId = candidate;
      state.hotSeatQueue.shift();
      break;
    }
    state.hotSeatQueue.push(state.hotSeatQueue.shift());
    attemptCount++;
  }

  if (!playerId) return startBuzzerRound();

  const player = state.players[playerId];
  const pool = state.questionPool.expert[playerId];
  const unusedIdx = pool.findIndex(q => !q.used);
  const question = pool[unusedIdx];
  pool[unusedIdx].used = true;

  state.consecutiveBuzzerRounds = 0;
  state.roundNumber++;
  checkAndAdvanceAct();
  state.currentRound = {
    ...createEmptyRound(),
    type: 'hot_seat',
    hotSeatPlayerId: playerId,
    hotSeatPlayerName: player.name,
    hotSeatExpertise: player.expertise,
    question: { ...question }
  };

  return state.currentRound;
}

function startBuzzerRound() {
  const pool = state.questionPool.trivia;
  const unusedIdx = pool.findIndex(q => !q.used);

  let question;
  if (unusedIdx === -1) {
    pool.forEach(q => (q.used = false));
    question = { ...pool[0] };
    pool[0].used = true;
  } else {
    question = { ...pool[unusedIdx] };
    pool[unusedIdx].used = true;
  }

  state.consecutiveBuzzerRounds++;
  state.roundNumber++;
  checkAndAdvanceAct();
  state.currentRound = {
    ...createEmptyRound(),
    type: 'buzzer',
    question: { ...question }
  };

  return state.currentRound;
}

// ─── Answer handling ─────────────────────────────────────────────────────────

function submitHotSeatAnswer(choiceIndex) {
  const round = state.currentRound;
  if (round.type !== 'hot_seat' || round.answered) return null;

  const correct = choiceIndex === round.question.correctIndex;
  round.answered = true;
  round.answeredCorrectly = correct;

  const player = state.players[round.hotSeatPlayerId];
  if (correct) {
    player.score += 2;
    round.pickingDrinker = true;
  } else {
    player.drinks += state.drinkMultiplier;
  }

  logRound({
    type: 'hot_seat',
    playerName: player.name,
    question: round.question.question,
    correct,
    drinksDelta: correct ? 0 : state.drinkMultiplier
  });

  return { correct, pickingDrinker: correct };
}

function openBuzzer(endsAt) {
  if (state.currentRound.type !== 'buzzer') return false;
  state.currentRound.buzzerOpen = true;
  state.currentRound.buzzerEndsAt = endsAt || null;
  return true;
}

function setAnswerTimedOut() {
  const round = state.currentRound;
  if (round.type !== 'buzzer' || !round.buzzedPlayerId || round.answerSubmitted) return false;
  round.answerSubmitted = true;
  const player = state.players[round.buzzedPlayerId];
  if (player) player.drinks += state.drinkMultiplier;
  logRound({
    type: 'buzzer',
    playerName: player?.name || '',
    question: round.question.question,
    correct: false,
    drinksDelta: state.drinkMultiplier
  });
  return { playerName: player?.name, correctIndex: round.question.correctIndex };
}

function setBuzzerTimedOut() {
  const round = state.currentRound;
  if (round.type !== 'buzzer' || !round.buzzerOpen) return false;
  round.buzzerOpen = false;
  round.timedOut = true;
  return true;
}

function buzz(socketId) {
  const round = state.currentRound;
  if (round.type !== 'buzzer' || !round.buzzerOpen || round.buzzedPlayerId) return false;

  const player = state.players[socketId];
  if (!player) return false;

  round.buzzerOpen = false;
  round.buzzedPlayerId = socketId;
  round.buzzedPlayerName = player.name;
  return true;
}

function submitTriviaAnswer(choiceIndex) {
  const round = state.currentRound;
  if (round.type !== 'buzzer' || !round.buzzedPlayerId || round.answerSubmitted) return null;

  const correct = choiceIndex === round.question.correctIndex;
  round.answerSubmitted = true;

  const player = state.players[round.buzzedPlayerId];
  if (correct) {
    player.score += 3;
  } else {
    player.drinks += state.drinkMultiplier;
  }

  logRound({
    type: 'buzzer',
    playerName: player.name,
    question: round.question.question,
    correct,
    drinksDelta: correct ? 0 : 1
  });

  return { correct, correctIndex: round.question.correctIndex };
}

function assignDrink(pickerSocketId, targetSocketId) {
  const round = state.currentRound;
  if (!round.pickingDrinker || round.hotSeatPlayerId !== pickerSocketId) return false;

  const target = state.players[targetSocketId];
  if (!target) return false;

  target.drinks += state.drinkMultiplier;
  round.pickingDrinker = false;
  return { targetName: target.name };
}

// ─── End game ────────────────────────────────────────────────────────────────

function endGame() {
  state.phase = 'results';
  const leaderboard = Object.values(state.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      expertise: p.expertise,
      score: p.score,
      drinks: p.drinks
    }));
  return leaderboard;
}

function resetGame() {
  state = createInitialState();
  state.hostSocketId = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function logRound(entry) {
  state.roundHistory.push({ ...entry, roundNumber: state.roundNumber });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  getState,
  getPublicState,
  getConnectedPlayerCount,
  getConnectedPlayers,
  addPlayer,
  removePlayer,
  isHost,
  setHost,
  startGenerating,
  loadQuestions,
  isGameOver,
  decideNextRoundType,
  startHotSeatRound,
  startBuzzerRound,
  submitHotSeatAnswer,
  openBuzzer,
  setBuzzerTimedOut,
  setAnswerTimedOut,
  shouldFireLuckyDrink,
  pickRandomDrinker,
  buzz,
  submitTriviaAnswer,
  assignDrink,
  endGame,
  resetGame,
};
