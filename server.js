const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game constants (must match client)
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;
const CANVAS_W = 800;
const CANVAS_H = 500;
const GROUND_Y = 440;
const GOAL_WIDTH = 20;
const GOAL_HEIGHT = 130;
const GOAL_Y = GROUND_Y - GOAL_HEIGHT;
const BALL_RADIUS = 18;
const PLAYER_RADIUS = 30;
const PLAYER_SPEED = 5;
const JUMP_FORCE = -10;
const GRAVITY = 0.45;
const KICK_FORCE = 12;
const BALL_DAMPING = 0.99;
const BALL_GROUND_DAMPING = 0.8;
const BALL_BOUNCE = 0.7;
const MATCH_DURATION = 90; // seconds
const POWERUP_INTERVAL = 8000; // ms
const COUNTDOWN_SECONDS = 3;

const NET_POST_WIDTH = 6;
const NET_POST_HEIGHT = GOAL_HEIGHT;
const CROSSBAR_HEIGHT = 6;

// Power-up types
const POWERUP_TYPES = ['big_ball', 'small_ball', 'speed_boost', 'big_head', 'freeze'];

// Rooms storage
const rooms = new Map();

function createBall() {
  return {
    x: CANVAS_W / 2,
    y: GROUND_Y - BALL_RADIUS - 100,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS
  };
}

function createPlayer(side) {
  return {
    x: side === 'left' ? 200 : 600,
    y: GROUND_Y - PLAYER_RADIUS,
    vx: 0,
    vy: 0,
    radius: PLAYER_RADIUS,
    onGround: true,
    kicking: false,
    kickCooldown: 0,
    speed: PLAYER_SPEED,
    frozen: false,
    frozenTimer: 0,
    bigHead: false,
    bigHeadTimer: 0,
    speedBoost: false,
    speedBoostTimer: 0,
    team: null,
    side: side
  };
}

function createGameState() {
  return {
    ball: createBall(),
    players: {
      left: createPlayer('left'),
      right: createPlayer('right')
    },
    score: { left: 0, right: 0 },
    timeLeft: MATCH_DURATION,
    powerup: null,
    state: 'waiting', // waiting, countdown, playing, goal_scored, finished
    countdownTimer: COUNTDOWN_SECONDS,
    goalPause: 0,
    lastPowerupTime: 0,
    tickCount: 0
  };
}

function resetPositions(game) {
  const b = game.ball;
  b.x = CANVAS_W / 2;
  b.y = GROUND_Y - BALL_RADIUS - 100;
  b.vx = 0;
  b.vy = 0;
  b.radius = BALL_RADIUS;

  const pl = game.players.left;
  pl.x = 200;
  pl.y = GROUND_Y - pl.radius;
  pl.vx = 0;
  pl.vy = 0;
  pl.onGround = true;
  pl.kicking = false;

  const pr = game.players.right;
  pr.x = 600;
  pr.y = GROUND_Y - pr.radius;
  pr.vx = 0;
  pr.vy = 0;
  pr.onGround = true;
  pr.kicking = false;

  game.powerup = null;
}

function spawnPowerup(game) {
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  game.powerup = {
    x: 150 + Math.random() * (CANVAS_W - 300),
    y: 80 + Math.random() * 150,
    type: type,
    radius: 15
  };
}

function applyPowerup(game, playerSide, type) {
  const player = game.players[playerSide];
  const opponent = game.players[playerSide === 'left' ? 'right' : 'left'];

  switch (type) {
    case 'big_ball':
      game.ball.radius = BALL_RADIUS * 1.8;
      break;
    case 'small_ball':
      game.ball.radius = BALL_RADIUS * 0.6;
      break;
    case 'speed_boost':
      player.speedBoost = true;
      player.speedBoostTimer = 300; // ticks
      break;
    case 'big_head':
      player.bigHead = true;
      player.bigHeadTimer = 300;
      player.radius = PLAYER_RADIUS * 1.5;
      break;
    case 'freeze':
      opponent.frozen = true;
      opponent.frozenTimer = 120; // 2 seconds
      break;
  }
}

function circleCollision(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < a.radius + b.radius;
}

function resolvePlayerBallCollision(player, ball, isKicking) {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;

  // Separate
  const overlap = (player.radius + ball.radius) - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  // Apply force
  let force = isKicking ? KICK_FORCE : 6;
  // Add player velocity influence
  ball.vx = nx * force + player.vx * 0.5;
  ball.vy = ny * force + player.vy * 0.3;

  // If heading ball from above, push it down and forward more
  if (dy > 0 && ny > 0.3) {
    ball.vy = Math.abs(ball.vy) * 0.5;
    ball.vx *= 1.3;
  }
}

function checkGoal(game) {
  const b = game.ball;
  // Left goal
  if (b.x - b.radius <= GOAL_WIDTH && b.y + b.radius > GOAL_Y && b.y - b.radius < GROUND_Y) {
    return 'right'; // right player scores
  }
  // Right goal
  if (b.x + b.radius >= CANVAS_W - GOAL_WIDTH && b.y + b.radius > GOAL_Y && b.y - b.radius < GROUND_Y) {
    return 'left'; // left player scores
  }
  return null;
}

function updateGame(room) {
  const game = room.gameState;
  const inputs = room.inputs;

  if (game.state === 'countdown') {
    game.tickCount++;
    if (game.tickCount % TICK_RATE === 0) {
      game.countdownTimer--;
      if (game.countdownTimer <= 0) {
        game.state = 'playing';
        game.lastPowerupTime = Date.now();
      }
    }
    return;
  }

  if (game.state === 'goal_scored') {
    game.goalPause--;
    if (game.goalPause <= 0) {
      resetPositions(game);
      if (game.timeLeft <= 0) {
        game.state = 'finished';
      } else {
        game.state = 'playing';
      }
    }
    return;
  }

  if (game.state !== 'playing') return;

  // Timer
  game.tickCount++;
  if (game.tickCount % TICK_RATE === 0) {
    game.timeLeft--;
    if (game.timeLeft <= 0) {
      game.state = 'finished';
      return;
    }
  }

  // Powerup spawning
  if (!game.powerup && Date.now() - game.lastPowerupTime > POWERUP_INTERVAL) {
    spawnPowerup(game);
    game.lastPowerupTime = Date.now();
  }

  // Update each player
  for (const side of ['left', 'right']) {
    const p = game.players[side];
    const input = inputs[side] || {};

    // Decrement timers
    if (p.frozenTimer > 0) {
      p.frozenTimer--;
      if (p.frozenTimer <= 0) p.frozen = false;
    }
    if (p.bigHeadTimer > 0) {
      p.bigHeadTimer--;
      if (p.bigHeadTimer <= 0) {
        p.bigHead = false;
        p.radius = PLAYER_RADIUS;
      }
    }
    if (p.speedBoostTimer > 0) {
      p.speedBoostTimer--;
      if (p.speedBoostTimer <= 0) p.speedBoost = false;
    }
    if (p.kickCooldown > 0) p.kickCooldown--;

    if (p.frozen) continue;

    const speed = p.speedBoost ? p.speed * 1.6 : p.speed;

    // Movement
    if (input.left) p.vx = -speed;
    else if (input.right) p.vx = speed;
    else p.vx = 0;

    if (input.up && p.onGround) {
      p.vy = JUMP_FORCE;
      p.onGround = false;
    }

    // Kick
    p.kicking = false;
    if (input.kick && p.kickCooldown <= 0) {
      p.kicking = true;
      p.kickCooldown = 15;
    }

    // Gravity
    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;

    // Ground
    if (p.y + p.radius >= GROUND_Y) {
      p.y = GROUND_Y - p.radius;
      p.vy = 0;
      p.onGround = true;
    }

    // Walls - keep players on their side mostly but allow some crossover
    if (p.x - p.radius < GOAL_WIDTH) p.x = GOAL_WIDTH + p.radius;
    if (p.x + p.radius > CANVAS_W - GOAL_WIDTH) p.x = CANVAS_W - GOAL_WIDTH - p.radius;

    // Ceiling
    if (p.y - p.radius < 0) {
      p.y = p.radius;
      p.vy = Math.abs(p.vy) * 0.3;
    }
  }

  // Player-player collision
  const pl = game.players.left;
  const pr = game.players.right;
  if (circleCollision(pl, pr)) {
    const dx = pr.x - pl.x;
    const dy = pr.y - pl.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = (pl.radius + pr.radius) - dist;
    pl.x -= nx * overlap * 0.5;
    pl.y -= ny * overlap * 0.5;
    pr.x += nx * overlap * 0.5;
    pr.y += ny * overlap * 0.5;
  }

  // Ball physics
  const ball = game.ball;
  ball.vy += GRAVITY;
  ball.vx *= BALL_DAMPING;
  ball.vy *= BALL_DAMPING;
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Ball-ground
  if (ball.y + ball.radius >= GROUND_Y) {
    ball.y = GROUND_Y - ball.radius;
    ball.vy = -ball.vy * BALL_BOUNCE;
    ball.vx *= BALL_GROUND_DAMPING;
    if (Math.abs(ball.vy) < 1) ball.vy = 0;
  }

  // Ball-ceiling
  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
  }

  // Ball-walls
  if (ball.x - ball.radius < 0) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
  }
  if (ball.x + ball.radius > CANVAS_W) {
    ball.x = CANVAS_W - ball.radius;
    ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
  }

  // Ball vs goal posts (physical collisions with the net structure)
  // Left goal - right post
  if (ball.x - ball.radius < GOAL_WIDTH + NET_POST_WIDTH && ball.x + ball.radius > GOAL_WIDTH) {
    if (ball.y + ball.radius > GOAL_Y - CROSSBAR_HEIGHT && ball.y - ball.radius < GOAL_Y) {
      // Crossbar hit
      ball.y = GOAL_Y - CROSSBAR_HEIGHT - ball.radius;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    } else if (ball.y - ball.radius < GOAL_Y) {
      // Post hit
      ball.x = GOAL_WIDTH + NET_POST_WIDTH + ball.radius;
      ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
    }
  }

  // Right goal - left post
  if (ball.x + ball.radius > CANVAS_W - GOAL_WIDTH - NET_POST_WIDTH && ball.x - ball.radius < CANVAS_W - GOAL_WIDTH) {
    if (ball.y + ball.radius > GOAL_Y - CROSSBAR_HEIGHT && ball.y - ball.radius < GOAL_Y) {
      ball.y = GOAL_Y - CROSSBAR_HEIGHT - ball.radius;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    } else if (ball.y - ball.radius < GOAL_Y) {
      ball.x = CANVAS_W - GOAL_WIDTH - NET_POST_WIDTH - ball.radius;
      ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
    }
  }

  // Ball-player collisions
  for (const side of ['left', 'right']) {
    const p = game.players[side];
    if (circleCollision(p, ball)) {
      resolvePlayerBallCollision(p, ball, p.kicking);
    }
  }

  // Powerup collection
  if (game.powerup) {
    for (const side of ['left', 'right']) {
      const p = game.players[side];
      const pu = game.powerup;
      const dx = p.x - pu.x;
      const dy = p.y - pu.y;
      if (Math.sqrt(dx * dx + dy * dy) < p.radius + pu.radius) {
        applyPowerup(game, side, pu.type);
        game.powerup = null;
        game.lastPowerupTime = Date.now();
        break;
      }
    }
  }

  // Check goals
  const scorer = checkGoal(game);
  if (scorer) {
    game.score[scorer]++;
    game.state = 'goal_scored';
    game.goalPause = 90; // 1.5 seconds
    // Reset powerup effects
    for (const side of ['left', 'right']) {
      const p = game.players[side];
      p.frozen = false;
      p.frozenTimer = 0;
      p.bigHead = false;
      p.bigHeadTimer = 0;
      p.radius = PLAYER_RADIUS;
      p.speedBoost = false;
      p.speedBoostTimer = 0;
    }
    game.ball.radius = BALL_RADIUS;
  }
}

function getStateForClient(room) {
  const g = room.gameState;
  return {
    ball: { x: g.ball.x, y: g.ball.y, radius: g.ball.radius },
    players: {
      left: {
        x: g.players.left.x, y: g.players.left.y,
        radius: g.players.left.radius,
        kicking: g.players.left.kicking,
        frozen: g.players.left.frozen,
        speedBoost: g.players.left.speedBoost,
        bigHead: g.players.left.bigHead,
        team: g.players.left.team,
        side: 'left'
      },
      right: {
        x: g.players.right.x, y: g.players.right.y,
        radius: g.players.right.radius,
        kicking: g.players.right.kicking,
        frozen: g.players.right.frozen,
        speedBoost: g.players.right.speedBoost,
        bigHead: g.players.right.bigHead,
        team: g.players.right.team,
        side: 'right'
      }
    },
    score: g.score,
    timeLeft: g.timeLeft,
    powerup: g.powerup,
    state: g.state,
    countdownTimer: g.countdownTimer
  };
}

// Socket.IO
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = {
      id: roomId,
      players: [{ id: socket.id, side: 'left', team: data.team }],
      gameState: createGameState(),
      inputs: { left: {}, right: {} },
      interval: null
    };
    room.gameState.players.left.team = data.team;
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerSide = 'left';
    socket.emit('room_created', { roomId, side: 'left' });
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  socket.on('join_room', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) {
      socket.emit('error_msg', { message: 'Room not found' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error_msg', { message: 'Room is full' });
      return;
    }
    room.players.push({ id: socket.id, side: 'right', team: data.team });
    room.gameState.players.right.team = data.team;
    socket.join(data.roomId);
    socket.roomId = data.roomId;
    socket.playerSide = 'right';

    socket.emit('room_joined', { roomId: data.roomId, side: 'right' });

    // Start the game
    room.gameState.state = 'countdown';
    room.gameState.countdownTimer = COUNTDOWN_SECONDS;
    room.gameState.tickCount = 0;

    io.to(data.roomId).emit('game_start', {
      leftTeam: room.players[0].team,
      rightTeam: room.players[1].team
    });

    // Start game loop
    room.interval = setInterval(() => {
      updateGame(room);
      io.to(data.roomId).emit('game_state', getStateForClient(room));

      if (room.gameState.state === 'finished') {
        clearInterval(room.interval);
        room.interval = null;
        io.to(data.roomId).emit('game_over', {
          score: room.gameState.score,
          winner: room.gameState.score.left > room.gameState.score.right ? 'left' :
                  room.gameState.score.right > room.gameState.score.left ? 'right' : 'draw'
        });
      }
    }, TICK_INTERVAL);

    console.log(`Player ${socket.id} joined room ${data.roomId}`);
  });

  socket.on('quick_match', (data) => {
    // Find a room waiting for a player
    let foundRoom = null;
    for (const [id, room] of rooms) {
      if (room.players.length === 1 && !room.interval) {
        foundRoom = room;
        break;
      }
    }

    if (foundRoom) {
      // Join existing room
      foundRoom.players.push({ id: socket.id, side: 'right', team: data.team });
      foundRoom.gameState.players.right.team = data.team;
      socket.join(foundRoom.id);
      socket.roomId = foundRoom.id;
      socket.playerSide = 'right';

      socket.emit('room_joined', { roomId: foundRoom.id, side: 'right' });

      foundRoom.gameState.state = 'countdown';
      foundRoom.gameState.countdownTimer = COUNTDOWN_SECONDS;
      foundRoom.gameState.tickCount = 0;

      io.to(foundRoom.id).emit('game_start', {
        leftTeam: foundRoom.players[0].team,
        rightTeam: foundRoom.players[1].team
      });

      foundRoom.interval = setInterval(() => {
        updateGame(foundRoom);
        io.to(foundRoom.id).emit('game_state', getStateForClient(foundRoom));

        if (foundRoom.gameState.state === 'finished') {
          clearInterval(foundRoom.interval);
          foundRoom.interval = null;
          io.to(foundRoom.id).emit('game_over', {
            score: foundRoom.gameState.score,
            winner: foundRoom.gameState.score.left > foundRoom.gameState.score.right ? 'left' :
                    foundRoom.gameState.score.right > foundRoom.gameState.score.left ? 'right' : 'draw'
          });
        }
      }, TICK_INTERVAL);
    } else {
      // Create new room and wait
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const room = {
        id: roomId,
        players: [{ id: socket.id, side: 'left', team: data.team }],
        gameState: createGameState(),
        inputs: { left: {}, right: {} },
        interval: null
      };
      room.gameState.players.left.team = data.team;
      rooms.set(roomId, room);
      socket.join(roomId);
      socket.roomId = roomId;
      socket.playerSide = 'left';
      socket.emit('waiting_for_opponent', { roomId });
    }
  });

  socket.on('player_input', (input) => {
    const room = rooms.get(socket.roomId);
    if (room && socket.playerSide) {
      room.inputs[socket.playerSide] = input;
    }
  });

  socket.on('play_again', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    if (!room.playAgainVotes) room.playAgainVotes = new Set();
    room.playAgainVotes.add(socket.id);

    if (room.playAgainVotes.size >= 2) {
      // Both want to play again
      room.gameState = createGameState();
      room.gameState.players.left.team = room.players[0].team;
      room.gameState.players.right.team = room.players[1].team;
      room.inputs = { left: {}, right: {} };
      room.playAgainVotes = new Set();

      room.gameState.state = 'countdown';
      room.gameState.countdownTimer = COUNTDOWN_SECONDS;
      room.gameState.tickCount = 0;

      io.to(room.id).emit('game_start', {
        leftTeam: room.players[0].team,
        rightTeam: room.players[1].team
      });

      room.interval = setInterval(() => {
        updateGame(room);
        io.to(room.id).emit('game_state', getStateForClient(room));

        if (room.gameState.state === 'finished') {
          clearInterval(room.interval);
          room.interval = null;
          io.to(room.id).emit('game_over', {
            score: room.gameState.score,
            winner: room.gameState.score.left > room.gameState.score.right ? 'left' :
                    room.gameState.score.right > room.gameState.score.left ? 'right' : 'draw'
          });
        }
      }, TICK_INTERVAL);
    } else {
      socket.emit('waiting_play_again');
      // Notify the other player
      socket.to(socket.roomId).emit('opponent_wants_rematch');
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        if (room.interval) {
          clearInterval(room.interval);
          room.interval = null;
        }
        io.to(socket.roomId).emit('opponent_disconnected');
        rooms.delete(socket.roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sports Heads Football Online running on http://localhost:${PORT}`);
});
