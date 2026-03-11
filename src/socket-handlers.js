'use strict';

const game = require('./game');
const { generateExpertQuestions, generateTriviaQuestions } = require('./ai');

const EXPERT_QUESTIONS_PER_PLAYER = 1;
const TRIVIA_QUESTIONS_COUNT = 10;

function setupSocketHandlers(io) {

  io.on('connection', (socket) => {
    console.log(`[connect] ${socket.id}`);

    // ── Host registration ────────────────────────────────────────────────
    socket.on('join_as_host', () => {
      const state = game.getState();
      if (state.hostSocketId && state.hostSocketId !== socket.id) {
        socket.emit('error_msg', 'A host is already connected.');
        return;
      }
      game.setHost(socket.id);
      socket.join('host');
      socket.emit('host_registered', { message: 'You are the host.' });
      socket.emit('state_sync', game.getPublicState());
      console.log(`[host] registered: ${socket.id}`);
    });

    // ── Player join ──────────────────────────────────────────────────────
    socket.on('join_as_player', ({ name, expertise }) => {
      const state = game.getState();
      if (state.phase !== 'lobby') {
        socket.emit('error_msg', 'Game already in progress.');
        return;
      }
      if (!name || !expertise) {
        socket.emit('error_msg', 'Name and expertise are required.');
        return;
      }

      game.addPlayer(socket.id, name, expertise);
      socket.join('players');

      const player = game.getState().players[socket.id];
      socket.emit('joined_game', { player });

      broadcastPlayerList(io);
      console.log(`[player] joined: ${name} (${expertise})`);
    });

    // ── Host starts game ─────────────────────────────────────────────────
    socket.on('host_start_game', async () => {
      if (!game.isHost(socket.id)) return;
      const state = game.getState();
      if (state.phase !== 'lobby') return;

      const players = game.getConnectedPlayers();
      if (players.length === 0) {
        socket.emit('error_msg', 'Need at least 1 player to start.');
        return;
      }

      game.startGenerating();
      io.emit('game_generating', { message: 'Generating questions...' });

      try {
        const expertiseList = players.map(p => p.expertise);
        const [expertQ, triviaQ] = await Promise.all([
          generateExpertQuestions(players, EXPERT_QUESTIONS_PER_PLAYER),
          generateTriviaQuestions(TRIVIA_QUESTIONS_COUNT, expertiseList)
        ]);

        game.loadQuestions(expertQ, triviaQ);
        io.emit('game_started', { message: 'Game is on!' });

        for (const player of players) {
          const questions = expertQ[player.id] || [];
          io.to(player.id).emit('your_expert_questions', { questions });
        }

        startNextRound(io);
      } catch (err) {
        console.error('Failed to start game:', err);
        io.emit('error_msg', 'Failed to generate questions. Try again.');
        game.getState().phase = 'lobby';
      }
    });

    // ── Hot seat answer ───────────────────────────────────────────────────
    socket.on('player_expert_answer', ({ choiceIndex }) => {
      const state = game.getState();
      if (state.phase !== 'playing') return;
      if (state.currentRound.type !== 'hot_seat') return;
      if (state.currentRound.hotSeatPlayerId !== socket.id) return;

      const result = game.submitHotSeatAnswer(choiceIndex);
      if (!result) return;

      const round = game.getState().currentRound;
      const correctAnswer = round.question.choices[round.question.correctIndex];

      io.emit('hot_seat_result', {
        correct: result.correct,
        correctIndex: round.question.correctIndex,
        chosenIndex: choiceIndex,
        correctAnswer,
        playerName: round.hotSeatPlayerName,
        pickingDrinker: result.pickingDrinker,
        players: getPlayerList()
      });
    });

    // ── Hot seat: pick who drinks ─────────────────────────────────────────
    socket.on('pick_drinker', ({ targetId }) => {
      const result = game.assignDrink(socket.id, targetId);
      if (!result) return;

      const pickerName = game.getState().players[socket.id]?.name;
      io.emit('drinker_picked', {
        pickerName,
        targetName: result.targetName,
        players: getPlayerList()
      });

      io.to(targetId).emit('drink_received', { from: pickerName });
    });

    // ── Host opens buzzer ─────────────────────────────────────────────────
    socket.on('host_open_buzzer', () => {
      if (!game.isHost(socket.id)) return;
      const opened = game.openBuzzer();
      if (opened) {
        io.emit('buzzer_open', { message: 'BUZZ IN!' });
      }
    });

    // ── Player buzzes in ──────────────────────────────────────────────────
    socket.on('player_buzz', () => {
      const won = game.buzz(socket.id);
      if (won) {
        const round = game.getState().currentRound;
        io.emit('buzzer_locked', {
          winnerId: socket.id,
          winnerName: round.buzzedPlayerName
        });
        io.to(socket.id).emit('you_buzzed_in', {
          question: round.question
        });
      }
    });

    // ── Player submits trivia answer ───────────────────────────────────────
    socket.on('player_trivia_answer', ({ choiceIndex }) => {
      const state = game.getState();
      if (state.currentRound.buzzedPlayerId !== socket.id) return;

      const result = game.submitTriviaAnswer(choiceIndex);
      if (!result) return;

      io.emit('trivia_answer_result', {
        correct: result.correct,
        correctIndex: result.correctIndex,
        chosenIndex: choiceIndex,
        correctAnswer: state.currentRound.question.choices[result.correctIndex],
        playerName: state.currentRound.buzzedPlayerName,
        players: getPlayerList()
      });
    });

    // ── Host advances to next round ────────────────────────────────────────
    socket.on('host_next_question', () => {
      if (!game.isHost(socket.id)) return;
      const state = game.getState();
      if (state.phase !== 'playing') return;
      startNextRound(io);
    });

    // ── Host ends game ────────────────────────────────────────────────────
    socket.on('host_end_game', () => {
      if (!game.isHost(socket.id)) return;
      const leaderboard = game.endGame();
      io.emit('game_over', { leaderboard });
    });

    // ── Host restarts ─────────────────────────────────────────────────────
    socket.on('host_restart', () => {
      if (!game.isHost(socket.id)) return;
      game.resetGame();
      game.setHost(socket.id);
      io.emit('game_reset', {});
      broadcastPlayerList(io);
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const state = game.getState();
      if (state.players[socket.id]) {
        game.removePlayer(socket.id);
        broadcastPlayerList(io);
        console.log(`[disconnect] player: ${state.players[socket.id]?.name || socket.id}`);
      }
      if (state.hostSocketId === socket.id) {
        console.log(`[disconnect] host`);
      }
    });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startNextRound(io) {
  const type = game.decideNextRoundType();

  if (type === 'game_over') {
    const leaderboard = game.endGame();
    io.emit('game_over', { leaderboard });
    return;
  }

  let round;
  if (type === 'hot_seat') {
    round = game.startHotSeatRound();
    if (round.type === 'buzzer') {
      emitBuzzerRound(io, round);
      return;
    }
    emitHotSeatRound(io, round);
  } else {
    round = game.startBuzzerRound();
    emitBuzzerRound(io, round);
  }
}

function emitHotSeatRound(io, round) {
  io.to('host').emit('hot_seat_round', {
    roundType: 'hot_seat',
    hotSeatPlayerId: round.hotSeatPlayerId,
    hotSeatPlayerName: round.hotSeatPlayerName,
    hotSeatExpertise: round.hotSeatExpertise,
    question: sanitizeQuestion(round.question)
  });

  io.to(round.hotSeatPlayerId).emit('your_turn_hot_seat', {
    question: sanitizeQuestion(round.question)
  });

  io.except(round.hotSeatPlayerId).except('host').emit('spectator_hot_seat', {
    hotSeatPlayerName: round.hotSeatPlayerName,
    hotSeatExpertise: round.hotSeatExpertise
  });
}

function emitBuzzerRound(io, round) {
  io.to('host').emit('buzzer_round', {
    roundType: 'buzzer',
    question: sanitizeQuestion(round.question)
  });

  io.to('players').emit('buzzer_round_player', {
    question: sanitizeQuestion(round.question)
  });
}

function sanitizeQuestion(q) {
  if (!q) return null;
  return {
    question: q.question,
    choices: q.choices,
    category: q.category || null
  };
}

function getPlayerList() {
  return Object.values(game.getState().players).map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    drinks: p.drinks,
    connected: p.connected
  }));
}

function broadcastPlayerList(io) {
  io.emit('player_list_update', { players: getPlayerList() });
}

module.exports = { setupSocketHandlers };
