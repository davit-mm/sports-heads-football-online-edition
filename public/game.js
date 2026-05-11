// ============================================================
// Sports Heads Football Online Edition - Game Client
// ============================================================

const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Constants
const CANVAS_W = 800;
const CANVAS_H = 500;
const GROUND_Y = 440;
const GOAL_WIDTH = 50;
const GOAL_HEIGHT = 130;
const GOAL_Y = GROUND_Y - GOAL_HEIGHT;

// Teams
const TEAMS = [
  { name: 'England', flag: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', colors: ['#fff', '#c8102e'] },
  { name: 'France', flag: '\u{1F1EB}\u{1F1F7}', colors: ['#002395', '#fff'] },
  { name: 'Germany', flag: '\u{1F1E9}\u{1F1EA}', colors: ['#fff', '#000'] },
  { name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}', colors: ['#c60b1e', '#ffc400'] },
  { name: 'Italy', flag: '\u{1F1EE}\u{1F1F9}', colors: ['#0066cc', '#fff'] },
  { name: 'Portugal', flag: '\u{1F1F5}\u{1F1F9}', colors: ['#c60b1e', '#006600'] },
  { name: 'Netherlands', flag: '\u{1F1F3}\u{1F1F1}', colors: ['#ff6600', '#fff'] },
  { name: 'Belgium', flag: '\u{1F1E7}\u{1F1EA}', colors: ['#c8102e', '#ffd700'] },
  { name: 'Croatia', flag: '\u{1F1ED}\u{1F1F7}', colors: ['#ff0000', '#fff'] },
  { name: 'Poland', flag: '\u{1F1F5}\u{1F1F1}', colors: ['#fff', '#dc143c'] },
  { name: 'Sweden', flag: '\u{1F1F8}\u{1F1EA}', colors: ['#006aa7', '#fecc00'] },
  { name: 'Denmark', flag: '\u{1F1E9}\u{1F1F0}', colors: ['#c8102e', '#fff'] },
  { name: 'Turkey', flag: '\u{1F1F9}\u{1F1F7}', colors: ['#c8102e', '#fff'] },
  { name: 'Greece', flag: '\u{1F1EC}\u{1F1F7}', colors: ['#0d5eaf', '#fff'] },
  { name: 'Ukraine', flag: '\u{1F1FA}\u{1F1E6}', colors: ['#005bbb', '#ffd500'] },
  { name: 'Russia', flag: '\u{1F1F7}\u{1F1FA}', colors: ['#fff', '#d52b1e'] },
];

// Client-side prediction constants (must match server)
const PLAYER_SPEED = 3.5;
const JUMP_FORCE = -8;
const GRAVITY = 0.4;
const PLAYER_RADIUS = 30;

// State
let selectedTeam = null;
let mySide = null;
let gameState = null;
let leftTeam = null;
let rightTeam = null;
let currentScreen = 'menu';
let goalAnimation = 0;
let lastGoalScorer = null;
let particles = [];

// Client-side prediction state
let predictedPos = { x: 0, y: 0, vx: 0, vy: 0, onGround: true };
let predictionActive = false;

// Input state
const keys = {};

// DOM elements
const menuScreen = document.getElementById('menuScreen');
const waitingScreen = document.getElementById('waitingScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const disconnectedScreen = document.getElementById('disconnectedScreen');
const teamGrid = document.getElementById('teamGrid');
const errorMsg = document.getElementById('errorMsg');

// Populate team grid
TEAMS.forEach((team, i) => {
  const btn = document.createElement('div');
  btn.className = 'team-btn';
  btn.innerHTML = `<span class="team-flag">${team.flag}</span>${team.name}`;
  btn.onclick = () => {
    document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedTeam = i;
  };
  teamGrid.appendChild(btn);
});
// Select first team by default
teamGrid.children[0].click();

// Screen management
function showScreen(name) {
  currentScreen = name;
  [menuScreen, waitingScreen, gameOverScreen, disconnectedScreen].forEach(s => s.classList.remove('active'));
  canvas.style.display = 'none';
  document.getElementById('hud').style.display = 'none';

  switch (name) {
    case 'menu': menuScreen.classList.add('active'); break;
    case 'waiting': waitingScreen.classList.add('active'); break;
    case 'game':
      canvas.style.display = 'block';
      document.getElementById('hud').style.display = 'flex';
      break;
    case 'gameover': gameOverScreen.classList.add('active'); break;
    case 'disconnected': disconnectedScreen.classList.add('active'); break;
  }
}

// Button handlers
document.getElementById('btnQuickMatch').onclick = () => {
  if (selectedTeam === null) { errorMsg.textContent = 'Select a team first!'; return; }
  errorMsg.textContent = '';
  socket.emit('quick_match', { team: selectedTeam });
};

document.getElementById('btnCreateRoom').onclick = () => {
  if (selectedTeam === null) { errorMsg.textContent = 'Select a team first!'; return; }
  errorMsg.textContent = '';
  socket.emit('create_room', { team: selectedTeam });
};

document.getElementById('btnJoinRoom').onclick = () => {
  if (selectedTeam === null) { errorMsg.textContent = 'Select a team first!'; return; }
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) { errorMsg.textContent = 'Enter a room code!'; return; }
  errorMsg.textContent = '';
  socket.emit('join_room', { roomId: code, team: selectedTeam });
};

document.getElementById('btnBackToMenu').onclick = () => {
  location.reload();
};

document.getElementById('btnPlayAgain').onclick = () => {
  socket.emit('play_again');
  document.getElementById('rematchStatus').style.display = 'block';
  document.getElementById('rematchStatus').textContent = 'Waiting for opponent...';
  document.getElementById('btnPlayAgain').disabled = true;
};

document.getElementById('btnBackMenu').onclick = () => location.reload();
document.getElementById('btnBackAfterDc').onclick = () => location.reload();

// Socket handlers
socket.on('room_created', (data) => {
  mySide = data.side;
  document.getElementById('roomCodeDisplay').textContent = data.roomId;
  showScreen('waiting');
});

socket.on('room_joined', (data) => {
  mySide = data.side;
});

socket.on('waiting_for_opponent', (data) => {
  document.getElementById('roomCodeDisplay').textContent = data.roomId;
  showScreen('waiting');
});

socket.on('error_msg', (data) => {
  errorMsg.textContent = data.message;
});

socket.on('game_start', (data) => {
  leftTeam = TEAMS[data.leftTeam];
  rightTeam = TEAMS[data.rightTeam];
  document.getElementById('hudLeftTeam').textContent = leftTeam.flag + ' ' + leftTeam.name;
  document.getElementById('hudRightTeam').textContent = rightTeam.name + ' ' + rightTeam.flag;
  particles = [];
  goalAnimation = 0;
  // Initialize prediction position
  predictedPos = {
    x: mySide === 'left' ? 200 : 600,
    y: GROUND_Y - PLAYER_RADIUS,
    vx: 0, vy: 0, onGround: true
  };
  predictionActive = false;
  showScreen('game');
});

socket.on('game_state', (state) => {
  const prevState = gameState;
  gameState = state;

  // Reconcile local prediction with server
  reconcileWithServer();

  // Detect new goal
  if (prevState && state.state === 'goal_scored' && prevState.state === 'playing') {
    if (state.score.left > (prevState.score.left || 0)) {
      lastGoalScorer = 'left';
    } else {
      lastGoalScorer = 'right';
    }
    goalAnimation = 60;
    spawnGoalParticles(lastGoalScorer);
  }

  // Update HUD
  document.getElementById('hudLeftScore').textContent = state.score.left;
  document.getElementById('hudRightScore').textContent = state.score.right;
  const mins = Math.floor(state.timeLeft / 60);
  const secs = state.timeLeft % 60;
  document.getElementById('hudTimer').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
});

socket.on('game_over', (data) => {
  const resultText = document.getElementById('resultText');
  const finalScore = document.getElementById('finalScore');

  if (data.winner === 'draw') {
    resultText.textContent = "It's a Draw!";
    resultText.style.color = '#ffd700';
  } else if (data.winner === mySide) {
    resultText.textContent = 'You Win!';
    resultText.style.color = '#4CAF50';
  } else {
    resultText.textContent = 'You Lose!';
    resultText.style.color = '#ff4444';
  }
  finalScore.textContent = `${data.score.left} - ${data.score.right}`;
  document.getElementById('rematchStatus').style.display = 'none';
  document.getElementById('btnPlayAgain').disabled = false;
  showScreen('gameover');
});

socket.on('opponent_disconnected', () => {
  showScreen('disconnected');
});

socket.on('waiting_play_again', () => {
  document.getElementById('rematchStatus').textContent = 'Waiting for opponent...';
});

socket.on('opponent_wants_rematch', () => {
  document.getElementById('rematchStatus').style.display = 'block';
  document.getElementById('rematchStatus').textContent = 'Opponent wants a rematch!';
});

// Input handling
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  // Prevent scrolling
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// Client-side prediction — move our player locally for instant response
function predictLocalPlayer() {
  if (!gameState || currentScreen !== 'game' || !mySide) return;

  const input = {
    left: keys['ArrowLeft'] || false,
    right: keys['ArrowRight'] || false,
    up: keys['ArrowUp'] || false,
    kick: keys['Space'] || false
  };

  const p = predictedPos;

  // Movement
  const speed = PLAYER_SPEED;
  if (input.left) p.vx = -speed;
  else if (input.right) p.vx = speed;
  else p.vx = 0;

  if (input.up && p.onGround) {
    p.vy = JUMP_FORCE;
    p.onGround = false;
  }

  // Gravity
  p.vy += GRAVITY;
  p.x += p.vx;
  p.y += p.vy;

  // Ground
  if (p.y + PLAYER_RADIUS >= GROUND_Y) {
    p.y = GROUND_Y - PLAYER_RADIUS;
    p.vy = 0;
    p.onGround = true;
  }

  // Walls
  if (p.x - PLAYER_RADIUS < GOAL_WIDTH) p.x = GOAL_WIDTH + PLAYER_RADIUS;
  if (p.x + PLAYER_RADIUS > CANVAS_W - GOAL_WIDTH) p.x = CANVAS_W - GOAL_WIDTH - PLAYER_RADIUS;

  // Ceiling
  if (p.y - PLAYER_RADIUS < 0) {
    p.y = PLAYER_RADIUS;
    p.vy = Math.abs(p.vy) * 0.3;
  }

  predictionActive = true;
}

// Reconcile prediction with server state
function reconcileWithServer() {
  if (!gameState || !mySide || !predictionActive) return;

  const serverPlayer = gameState.players[mySide];
  const p = predictedPos;

  // Smoothly blend toward server position to prevent drift
  const lerpFactor = 0.3;
  p.x += (serverPlayer.x - p.x) * lerpFactor;
  p.y += (serverPlayer.y - p.y) * lerpFactor;
}

// Send inputs to server
function sendInput() {
  if (currentScreen !== 'game') return;
  const input = {
    left: keys['ArrowLeft'] || false,
    right: keys['ArrowRight'] || false,
    up: keys['ArrowUp'] || false,
    kick: keys['Space'] || false
  };
  socket.emit('player_input', input);
}
setInterval(sendInput, 1000 / 60);

// Particles
function spawnGoalParticles(side) {
  const x = side === 'left' ? 150 : CANVAS_W - 150;
  for (let i = 0; i < 30; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * 100,
      y: 200 + (Math.random() - 0.5) * 100,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8 - 3,
      life: 60 + Math.random() * 30,
      color: side === 'left' ? '#4CAF50' : '#2196F3',
      size: 3 + Math.random() * 5
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ============================================================
// RENDERING
// ============================================================

function drawField() {
  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGrad.addColorStop(0, '#87CEEB');
  skyGrad.addColorStop(0.7, '#b0e0e6');
  skyGrad.addColorStop(1, '#90EE90');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);

  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  drawCloud(100, 60, 40);
  drawCloud(350, 40, 30);
  drawCloud(600, 70, 35);
  drawCloud(750, 30, 25);

  // Grass
  const grassGrad = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
  grassGrad.addColorStop(0, '#4CAF50');
  grassGrad.addColorStop(1, '#2E7D32');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

  // Grass stripes
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < CANVAS_W; x += 40) {
    if ((x / 40) % 2 === 0) {
      ctx.fillRect(x, GROUND_Y, 40, CANVAS_H - GROUND_Y);
    }
  }

  // Center line
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2, GROUND_Y);
  ctx.lineTo(CANVAS_W / 2, CANVAS_H);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center circle
  ctx.beginPath();
  ctx.arc(CANVAS_W / 2, GROUND_Y + 30, 50, Math.PI, 2 * Math.PI);
  ctx.stroke();
}

function drawCloud(x, y, size) {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.arc(x + size * 0.8, y - size * 0.3, size * 0.7, 0, Math.PI * 2);
  ctx.arc(x + size * 1.4, y, size * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

// Draw goal backgrounds (nets) — rendered BEHIND the ball
function drawGoalNets() {
  // Left goal net background
  // Dark interior for depth
  ctx.fillStyle = 'rgba(30,30,30,0.6)';
  ctx.fillRect(0, GOAL_Y, GOAL_WIDTH, GOAL_HEIGHT);
  // Back wall shading
  ctx.fillStyle = 'rgba(60,60,60,0.4)';
  ctx.fillRect(0, GOAL_Y, 4, GOAL_HEIGHT);
  // Net lines
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let y = GOAL_Y; y <= GROUND_Y; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(GOAL_WIDTH, y);
    ctx.stroke();
  }
  for (let x = 0; x <= GOAL_WIDTH; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, GOAL_Y);
    ctx.lineTo(x, GROUND_Y);
    ctx.stroke();
  }

  // Right goal net background
  ctx.fillStyle = 'rgba(30,30,30,0.6)';
  ctx.fillRect(CANVAS_W - GOAL_WIDTH, GOAL_Y, GOAL_WIDTH, GOAL_HEIGHT);
  ctx.fillStyle = 'rgba(60,60,60,0.4)';
  ctx.fillRect(CANVAS_W - 4, GOAL_Y, 4, GOAL_HEIGHT);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let y = GOAL_Y; y <= GROUND_Y; y += 10) {
    ctx.beginPath();
    ctx.moveTo(CANVAS_W - GOAL_WIDTH, y);
    ctx.lineTo(CANVAS_W, y);
    ctx.stroke();
  }
  for (let x = CANVAS_W - GOAL_WIDTH; x <= CANVAS_W; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, GOAL_Y);
    ctx.lineTo(x, GROUND_Y);
    ctx.stroke();
  }
}

// Draw goal posts and crossbars — rendered IN FRONT of the ball
function drawGoalPosts() {
  // Left goal
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;
  ctx.fillRect(GOAL_WIDTH - 4, GOAL_Y - 4, 8, GOAL_HEIGHT + 4); // Post
  ctx.fillRect(0, GOAL_Y - 6, GOAL_WIDTH + 4, 8); // Crossbar
  // Post highlight
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(GOAL_WIDTH - 2, GOAL_Y, 2, GOAL_HEIGHT);

  // Right goal
  ctx.fillStyle = '#fff';
  ctx.fillRect(CANVAS_W - GOAL_WIDTH - 4, GOAL_Y - 4, 8, GOAL_HEIGHT + 4); // Post
  ctx.fillRect(CANVAS_W - GOAL_WIDTH - 4, GOAL_Y - 6, GOAL_WIDTH + 4, 8); // Crossbar
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(CANVAS_W - GOAL_WIDTH, GOAL_Y, 2, GOAL_HEIGHT);

  ctx.shadowBlur = 0;
}

function drawBall(ball) {
  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(ball.x, GROUND_Y + 3, ball.radius * 0.8, ball.radius * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ball
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pentagon pattern
  const r = ball.radius * 0.45;
  ctx.fillStyle = '#333';
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
    const px = ball.x + Math.cos(angle) * r;
    const py = ball.y + Math.sin(angle) * r;
    ctx.beginPath();
    for (let j = 0; j < 5; j++) {
      const a2 = angle + (j * Math.PI * 2) / 5;
      const size = ball.radius * 0.2;
      const x2 = px + Math.cos(a2) * size;
      const y2 = py + Math.sin(a2) * size;
      if (j === 0) ctx.moveTo(x2, y2);
      else ctx.lineTo(x2, y2);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawPlayer(player, team) {
  if (!team) return;
  ctx.save();

  const x = player.x;
  const y = player.y;
  const r = player.radius;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, GROUND_Y + 3, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  // Frozen effect
  if (player.frozen) {
    ctx.fillStyle = 'rgba(100,200,255,0.3)';
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Speed boost aura
  if (player.speedBoost) {
    ctx.strokeStyle = 'rgba(255,200,0,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Body (small body below head)
  ctx.fillStyle = team.colors[0];
  ctx.fillRect(x - r * 0.35, y + r * 0.6, r * 0.7, r * 0.5);

  // Legs
  ctx.strokeStyle = team.colors[1];
  ctx.lineWidth = 3;
  const legPhase = player.kicking ? 0.5 : 0;
  // Left leg
  ctx.beginPath();
  ctx.moveTo(x - r * 0.2, y + r * 1.1);
  ctx.lineTo(x - r * 0.3, y + r * 1.1 + 12 - legPhase * 5);
  ctx.stroke();
  // Right leg (kick animation)
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2, y + r * 1.1);
  if (player.kicking) {
    const kickDir = player.side === 'left' ? 1 : -1;
    ctx.lineTo(x + r * 0.2 + kickDir * 15, y + r * 1.1 + 5);
  } else {
    ctx.lineTo(x + r * 0.3, y + r * 1.1 + 12);
  }
  ctx.stroke();

  // Head (main circle)
  const headGrad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
  headGrad.addColorStop(0, '#ffdbac');
  headGrad.addColorStop(1, '#e8b88a');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c8946e';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Hair / headband in team color
  ctx.fillStyle = team.colors[0];
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI + 0.3, Math.PI * 2 - 0.3);
  ctx.lineTo(x + r * 0.7, y - r * 0.5);
  ctx.quadraticCurveTo(x, y - r * 1.1, x - r * 0.7, y - r * 0.5);
  ctx.closePath();
  ctx.fill();

  // Headband stripe
  ctx.fillStyle = team.colors[1];
  ctx.fillRect(x - r * 0.8, y - r * 0.35, r * 1.6, r * 0.15);

  // Eyes
  const eyeDir = player.side === 'left' ? 1 : -1;
  // White
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(x + eyeDir * r * 0.25, y - r * 0.05, r * 0.22, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupil
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(x + eyeDir * r * 0.3, y - r * 0.05, r * 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (player.kicking) {
    // Open mouth when kicking
    ctx.arc(x + eyeDir * r * 0.15, y + r * 0.35, r * 0.15, 0, Math.PI);
  } else {
    ctx.arc(x + eyeDir * r * 0.15, y + r * 0.3, r * 0.12, 0.2, Math.PI - 0.2);
  }
  ctx.stroke();

  // Nose
  ctx.fillStyle = '#d4956b';
  ctx.beginPath();
  ctx.arc(x + eyeDir * r * 0.45, y + r * 0.1, r * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // "YOU" indicator
  if ((player.side === 'left' && mySide === 'left') || (player.side === 'right' && mySide === 'right')) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', x, y - r - 10);
    // Arrow
    ctx.beginPath();
    ctx.moveTo(x, y - r - 5);
    ctx.lineTo(x - 5, y - r - 10);
    ctx.lineTo(x + 5, y - r - 10);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawPowerup(pu) {
  if (!pu) return;
  ctx.save();

  // Glow
  ctx.shadowColor = getPowerupColor(pu.type);
  ctx.shadowBlur = 15;

  // Box
  ctx.fillStyle = getPowerupColor(pu.type);
  ctx.beginPath();
  ctx.arc(pu.x, pu.y, pu.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Icon
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(getPowerupIcon(pu.type), pu.x, pu.y);

  ctx.restore();
}

function getPowerupColor(type) {
  switch (type) {
    case 'big_ball': return '#FF9800';
    case 'small_ball': return '#9C27B0';
    case 'speed_boost': return '#FFEB3B';
    case 'big_head': return '#4CAF50';
    case 'freeze': return '#00BCD4';
    default: return '#fff';
  }
}

function getPowerupIcon(type) {
  switch (type) {
    case 'big_ball': return 'B';
    case 'small_ball': return 's';
    case 'speed_boost': return '!';
    case 'big_head': return 'H';
    case 'freeze': return '*';
    default: return '?';
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life / 90;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawCountdown(timer) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(timer > 0 ? timer.toString() : 'GO!', CANVAS_W / 2, CANVAS_H / 2);
}

function drawGoalText() {
  if (goalAnimation <= 0) return;
  const alpha = Math.min(1, goalAnimation / 20);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 80px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 10;
  ctx.fillText('GOAL!', CANVAS_W / 2, CANVAS_H / 2);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

// Main render loop
function render() {
  if (currentScreen !== 'game' || !gameState) {
    requestAnimationFrame(render);
    return;
  }

  // Run client-side prediction each frame
  predictLocalPlayer();

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawField();

  // Layer order: goal nets (back) → players + ball → goal posts (front)
  drawGoalNets();

  // Draw players — use predicted position for our own player
  let leftPlayerData = gameState.players.left;
  let rightPlayerData = gameState.players.right;

  if (mySide === 'left' && predictionActive) {
    leftPlayerData = { ...leftPlayerData, x: predictedPos.x, y: predictedPos.y };
  } else if (mySide === 'right' && predictionActive) {
    rightPlayerData = { ...rightPlayerData, x: predictedPos.x, y: predictedPos.y };
  }

  drawPlayer(leftPlayerData, leftTeam);
  drawPlayer(rightPlayerData, rightTeam);

  // Draw ball (between net and posts so it appears inside the goal)
  drawBall(gameState.ball);

  // Draw posts on top of everything
  drawGoalPosts();

  // Draw powerup
  drawPowerup(gameState.powerup);

  // Particles
  updateParticles();
  drawParticles();

  // Goal animation
  if (goalAnimation > 0) {
    goalAnimation--;
    drawGoalText();
  }

  // Countdown
  if (gameState.state === 'countdown') {
    drawCountdown(gameState.countdownTimer);
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
