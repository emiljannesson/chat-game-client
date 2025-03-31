import { Identity } from "@clockworklabs/spacetimedb-sdk";
import p5 from "p5";
import {
  DbConnection,
  Enemy,
  EnemyType,
  Message,
  Projectile,
  User,
} from "./module_bindings"; // Import Enemy type

// --- Configuration ---
// Use wss:// for secure connection in production, ws:// for local development
const SPACETIME_DB_HOST = import.meta.env.PROD
  ? "wss://maincloud.spacetimedb.com"
  : "ws://localhost:3000";
const SPACETIME_DB_NAME = "chat-game";
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
const PLAYER_SIZE = 20;
const PLAYER_SPEED = 3;
const MESSAGE_DURATION_MS = 5000;
const MOVE_THROTTLE_MS = 16; // ~60fps
const PROJECTILE_DAMAGE = 10; // TODO: should be available from server

// Visual Effect Constants
// const PARTICLE_COUNT = 50; // Number of particles in effects
const SCREEN_SHAKE_DURATION = 200; // ms
const SCREEN_SHAKE_INTENSITY = 5; // pixels

// --- Global State ---
let dbConnection: DbConnection | null = null;
let localIdentity: Identity | null = null;
let isConnected = false;
let users = new Map<string, User>();
let playerMessages = new Map<string, { text: string; timestamp: number }[]>();
let projectiles = new Map<bigint, Projectile>(); // Map projectile ID (u64) to Projectile data
let enemies = new Map<bigint, Enemy>(); // Map enemy ID to enemy data
let localPlayerPos = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }; // Make localPlayerPos global and initialize it
let lastMoveSentTime = 0;
let lastMoveDirection = { dx: 1, dy: 0 }; // Start facing right by default

// Visual Effect State
let particles: Particle[] = [];
let screenShake = { active: false, duration: 0, intensity: 0, startTime: 0 };
let backgroundStars: BackgroundStar[] = [];
let bossSpawning = false;
let bossSpawnPosition = { x: 0, y: 0 };
let bossSpawnTime = 0;
let bgEffects: BackgroundEffect[] = [];
let hitEffects: HitEffect[] = [];
let damageNumbers: DamageNumber[] = [];
let deathRings: DeathRing[] = [];
let floatingTexts: FloatingText[] = [];
let p5Instance: p5 | null = null; // Store instance for death effect

// Types for effects
interface HitEffect {
  x: number;
  y: number;
  time: number;
  isBoss: boolean;
}

interface DamageNumber {
  x: number;
  y: number;
  amount: number;
  time: number;
  color: p5.Color | null;
}

interface DeathRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  time: number;
  color: p5.Color;
}

interface FloatingText {
  text: string;
  x: number;
  y: number;
  color: p5.Color;
  fontSize: number;
  time: number;
  duration: number;
}

// Define particle class for visual effects
class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: p5.Color | null = null;
  size: number;
  life: number;
  maxLife: number;

  constructor(
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    life: number,
    color?: p5.Color
  ) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.alpha = 255;
    this.color = color || null;
    this.size = size;
    this.maxLife = life;
    this.life = life;
  }

  update(p: p5) {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    this.alpha = p.map(this.life, 0, this.maxLife, 0, 255);
    this.vx *= 0.97; // Friction
    this.vy *= 0.97; // Friction
    this.vy += 0.02; // Gravity
  }

  draw(p: p5) {
    p.noStroke();
    if (this.color) {
      const c = this.color;
      p.fill(p.red(c), p.green(c), p.blue(c), this.alpha);
    } else {
      p.fill(255, 255, 255, this.alpha);
    }
    p.ellipse(
      this.x,
      this.y,
      this.size * (this.life / this.maxLife),
      this.size * (this.life / this.maxLife)
    );
  }

  isDead() {
    return this.life <= 0;
  }
}

// Background star for parallax effect
class BackgroundStar {
  x: number;
  y: number;
  size: number;
  brightness: number;
  speed: number;

  constructor(p: p5) {
    this.x = p.random(CANVAS_WIDTH);
    this.y = p.random(CANVAS_HEIGHT);
    this.size = p.random(1, 3);
    this.brightness = p.random(100, 200);
    this.speed = p.map(this.size, 1, 3, 0.1, 0.3); // Smaller stars move slower for parallax
  }

  update(p: p5) {
    // Subtle movement for parallax effect
    this.y += this.speed;
    if (this.y > CANVAS_HEIGHT) {
      this.y = 0;
      this.x = p.random(CANVAS_WIDTH);
    }

    // Twinkle effect
    this.brightness = 100 + p.sin(p.frameCount * 0.01 + this.x) * 50 + 50;
  }

  draw(p: p5) {
    p.noStroke();
    p.fill(255, 255, 255, this.brightness);
    p.ellipse(this.x, this.y, this.size, this.size);
  }
}

// Additional class for more complex background effects
class BackgroundEffect {
  x: number;
  y: number;
  size: number;
  life: number;
  maxLife: number;
  speed: number;
  type: string;
  angle: number;
  rotationSpeed: number;

  constructor(p: p5, type: string) {
    this.x = p.random(CANVAS_WIDTH);
    this.y = p.random(CANVAS_HEIGHT);
    this.size = p.random(30, 120);
    this.maxLife = p.random(300, 600);
    this.life = this.maxLife;
    this.speed = p.random(0.1, 0.3);
    this.type = type;
    this.angle = p.random(p.TWO_PI);
    this.rotationSpeed = p.random(-0.01, 0.01);
  }

  update(_p: p5) {
    this.y += this.speed;
    this.angle += this.rotationSpeed;
    this.life--;

    if (this.y > CANVAS_HEIGHT + this.size || this.life <= 0) {
      return true; // Remove effect
    }

    return false;
  }

  draw(p: p5) {
    const alpha = p.map(this.life, 0, this.maxLife, 0, 30);

    p.push();
    p.translate(this.x, this.y);
    p.rotate(this.angle);

    if (this.type === "ring") {
      p.noFill();
      p.stroke(100, 150, 255, alpha);
      p.strokeWeight(2);
      p.ellipse(0, 0, this.size, this.size);
    } else if (this.type === "hex") {
      p.noFill();
      p.stroke(255, 100, 100, alpha);
      p.strokeWeight(2);
      p.beginShape();
      for (let i = 0; i < 6; i++) {
        const angle = p.map(i, 0, 6, 0, p.TWO_PI);
        const x = (Math.cos(angle) * this.size) / 2;
        const y = (Math.sin(angle) * this.size) / 2;
        p.vertex(x, y);
      }
      p.endShape(p.CLOSE);
    } else if (this.type === "grid") {
      p.stroke(150, 255, 150, alpha);
      p.strokeWeight(1);
      const gridSize = this.size / 4;

      for (let x = -this.size / 2; x <= this.size / 2; x += gridSize) {
        p.line(x, -this.size / 2, x, this.size / 2);
      }

      for (let y = -this.size / 2; y <= this.size / 2; y += gridSize) {
        p.line(-this.size / 2, y, this.size / 2, y);
      }
    }

    p.pop();
  }
}

// Function to create explosion particles
function createExplosion(
  p: p5,
  x: number,
  y: number,
  color: p5.Color,
  count: number,
  speed: number
) {
  for (let i = 0; i < count; i++) {
    const angle = p.random(p.TWO_PI);
    const velocity = p.random(0.5, speed);
    const vx = Math.cos(angle) * velocity;
    const vy = Math.sin(angle) * velocity;
    const size = p.random(2, 5);
    const life = p.random(20, 60);
    particles.push(new Particle(x, y, vx, vy, size, life, color));
  }

  // Trigger screen shake
  screenShake = {
    active: true,
    duration: SCREEN_SHAKE_DURATION,
    intensity: SCREEN_SHAKE_INTENSITY,
    startTime: Date.now(),
  };
}

// Create a special effect for boss spawning
function createBossSpawnEffect(p: p5, x: number, y: number) {
  // Create particles in a ring
  const numParticles = 60;
  const radius = 40;

  // Create lightning-like particles
  for (let i = 0; i < numParticles; i++) {
    const angle = p.map(i, 0, numParticles, 0, p.TWO_PI);
    const distance = radius + p.random(-5, 5);
    const particleX = x + Math.cos(angle) * distance;
    const particleY = y + Math.sin(angle) * distance;

    // Calculate velocity - exploding outward
    const vx = Math.cos(angle) * p.random(1, 3);
    const vy = Math.sin(angle) * p.random(1, 3);

    // Create particle
    const bossColor = p.color(255, p.random(0, 100), p.random(0, 100));
    particles.push(
      new Particle(
        particleX,
        particleY,
        vx,
        vy,
        p.random(3, 8),
        p.random(40, 80),
        bossColor
      )
    );
  }

  // Massive screen shake
  screenShake = {
    active: true,
    duration: 800, // longer duration
    intensity: 12, // stronger shake
    startTime: Date.now(),
  };

  // Create additional wave effects
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      if (!p || !p.random) return; // Make sure p5 is still available
      // Ring of particles at increasing distances
      const ringRadius = radius * (i + 2);
      const ringNumParticles = 20 * (i + 1);

      for (let j = 0; j < ringNumParticles; j++) {
        const angle = p.map(j, 0, ringNumParticles, 0, p.TWO_PI);
        const distance = ringRadius + p.random(-5, 5);
        const particleX = x + Math.cos(angle) * distance;
        const particleY = y + Math.sin(angle) * distance;

        // Smaller velocity for second wave
        const vx = Math.cos(angle) * p.random(0.5, 1);
        const vy = Math.sin(angle) * p.random(0.5, 1);

        // Create particle with red-orange color scheme
        const color = p.color(255, p.random(50, 150), p.random(20, 60), 200);

        particles.push(
          new Particle(
            particleX,
            particleY,
            vx,
            vy,
            p.random(2, 6),
            p.random(30, 50),
            color
          )
        );
      }

      // Add small screen shake for each wave
      screenShake = {
        active: true,
        duration: 200,
        intensity: 5 - i,
        startTime: Date.now(),
      };
    }, i * 300); // Stagger waves
  }
}

// Create hit effect when an enemy is damaged
function createHitEffect(x: number, y: number, isBoss: boolean) {
  // Store this information to be processed in the next draw cycle
  hitEffects.push({
    x,
    y,
    time: Date.now(),
    isBoss,
  });
}

// Render hit effect in draw cycle
function renderHitEffect(p: p5, hitEffect: HitEffect) {
  const elapsed = Date.now() - hitEffect.time;
  const maxDuration = 400; // ms

  if (elapsed > maxDuration) return true; // Remove effect

  // Get size and alpha based on elapsed time
  const size = p.map(elapsed, 0, maxDuration, hitEffect.isBoss ? 60 : 30, 0);
  const alpha = p.map(elapsed, 0, maxDuration, 255, 0);

  // Draw hit circle
  p.noFill();
  p.stroke(255, 255, 200, alpha);
  p.strokeWeight(3);
  p.ellipse(hitEffect.x, hitEffect.y, size, size);

  // Draw inner hit
  p.stroke(255, 200, 100, alpha);
  p.strokeWeight(2);
  p.ellipse(hitEffect.x, hitEffect.y, size * 0.7, size * 0.7);

  // Add particles
  if (elapsed < 100 && Math.random() < 0.3) {
    const angle = p.random(p.TWO_PI);
    const distance = size * 0.4;
    const particleX = hitEffect.x + Math.cos(angle) * distance;
    const particleY = hitEffect.y + Math.sin(angle) * distance;

    const color = hitEffect.isBoss
      ? p.color(255, p.random(50, 150), p.random(20, 80)) // Red/orange for boss
      : p.color(255, p.random(150, 250), p.random(100, 200)); // Yellow for minions

    particles.push(
      new Particle(
        particleX,
        particleY,
        p.random(-1, 1),
        p.random(-2, 0),
        p.random(2, 5),
        p.random(20, 40),
        color
      )
    );
  }

  return false; // Keep effect
}

// Create floating damage number
function createDamageNumber(
  x: number,
  y: number,
  amount: number,
  _isBoss: boolean
) {
  // We'll render this in the p5 draw loop
  damageNumbers.push({
    x: x + (Math.random() * 20 - 10), // Add slight horizontal variation
    y: y - 20, // Start above the enemy
    amount,
    time: Date.now(),
    color: null, // Will be initialized in render function
  });
}

// Render floating damage numbers
function renderDamageNumbers(p: p5) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const damage = damageNumbers[i];
    const elapsed = Date.now() - damage.time;
    const lifespan = 1000; // 1 second

    if (elapsed > lifespan) {
      damageNumbers.splice(i, 1);
      continue;
    }

    // Initialize color if needed
    if (!damage.color) {
      damage.color = p.color(255, 255, 100);
    }

    // Update position - float upward
    damage.y -= 0.5;

    // Calculate alpha and scale based on lifetime
    const alpha = p.map(elapsed, 0, lifespan, 255, 0);
    const scale = p.map(elapsed, 0, lifespan * 0.3, 0.8, 1.5); // Grow then shrink

    // Draw damage number with shadow
    p.push();
    p.translate(damage.x, damage.y);
    p.scale(scale);

    // Draw shadow
    p.fill(0, alpha * 0.5);
    p.textSize(16);
    p.text(damage.amount.toString(), 2, 2);

    // Draw text
    p.fill(
      p.red(damage.color),
      p.green(damage.color),
      p.blue(damage.color),
      alpha
    );
    p.stroke(0, alpha * 0.8);
    p.strokeWeight(2);
    p.text(damage.amount.toString(), 0, 0);
    p.pop();
  }
}

// DOM Elements
let nameInput: HTMLInputElement;
let setNameButton: HTMLButtonElement;
let chatInput: HTMLInputElement;
let sendButton: HTMLButtonElement;
let connectionStatusSpan: HTMLElement;
let sketchHolder: HTMLElement;

// --- SpacetimeDB Event Handlers ---
const handleUserInsert = (_ctx: any, user: User) => {
  const userIdHex = user.identity.toHexString();
  // console.log(`User Inserted: ${userIdHex.substring(0, 6)}`);
  const nextUsers = new Map(users);
  nextUsers.set(userIdHex, user);
  users = nextUsers; // Update global state
};

const handleUserUpdate = (_ctx: any, oldUser: User, newUser: User) => {
  const oldUserIdHex = oldUser.identity.toHexString();
  const newUserIdHex = newUser.identity.toHexString();
  // console.log(`User Updated: ${newUserIdHex.substring(0, 6)} (Online: ${newUser.online})`);
  const nextUsers = new Map(users);
  nextUsers.set(newUserIdHex, newUser);
  if (oldUserIdHex !== newUserIdHex) {
    nextUsers.delete(oldUserIdHex);
  }
  users = nextUsers; // Update global state
};

const handleUserDelete = (_ctx: any, user: User) => {
  const userIdHex = user.identity.toHexString();
  // console.log(`User Deleted: ${userIdHex.substring(0, 6)}`);
  const nextUsers = new Map(users);
  nextUsers.delete(userIdHex);
  users = nextUsers; // Update global state
};

const handleMessageInsert = (_ctx: any, message: Message) => {
  if (!message.sender) return;
  const senderHex = message.sender.toHexString();
  const newMessage = { text: message.text, timestamp: Date.now() };

  const nextMessages = new Map(playerMessages);
  const currentMessages = nextMessages.get(senderHex) || [];
  nextMessages.set(senderHex, [...currentMessages, newMessage].slice(-3)); // Keep last 3
  playerMessages = nextMessages; // Update global state

  // Auto-clear message after duration
  setTimeout(() => {
    const cleanupMessages = new Map(playerMessages);
    const current = cleanupMessages.get(senderHex) || [];
    const filtered = current.filter(
      (msg) =>
        !(
          msg.timestamp === newMessage.timestamp && msg.text === newMessage.text
        )
    );
    if (filtered.length > 0) {
      cleanupMessages.set(senderHex, filtered);
    } else {
      cleanupMessages.delete(senderHex);
    }
    playerMessages = cleanupMessages; // Update global state
  }, MESSAGE_DURATION_MS);
};

// Add Projectile Handlers
const handleProjectileInsert = (_ctx: any, projectile: Projectile) => {
  console.log("Raw projectile received:", projectile); // Log the raw object
  // Access nested property for logging
  const spawnTimeMsLog =
    Number(projectile.spawnTime.__timestamp_micros_since_unix_epoch__) / 1000;
  console.log(
    `[Projectile Inserted] ID: ${projectile.id}, Pos: (${projectile.x.toFixed(
      1
    )}, ${projectile.y.toFixed(1)}), Vel: (${projectile.vx.toFixed(
      1
    )}, ${projectile.vy.toFixed(1)}), Spawn: ${spawnTimeMsLog}`
  );
  const nextProjectiles = new Map(projectiles);
  nextProjectiles.set(projectile.id, projectile);
  projectiles = nextProjectiles;
};

const handleProjectileDelete = (_ctx: any, projectile: Projectile) => {
  // console.log(`Projectile Deleted: ${projectile.id}`);
  const nextProjectiles = new Map(projectiles);
  nextProjectiles.delete(projectile.id); // Use bigint projectile.id to delete
  projectiles = nextProjectiles;
};
// Note: We don't handle handleProjectileUpdate for now, assuming projectiles don't change velocity/owner mid-flight.
// Server could update position, but we predict client-side.

// --- Add Enemy Handlers ---
const handleEnemyInsert = (_ctx: any, enemy: Enemy) => {
  console.log(
    `Enemy Inserted: ID=${enemy.id}, Type=${
      enemy.enemyType === EnemyType.Boss ? "Boss" : "Minion"
    }, Name=${enemy.name}`
  );
  const nextEnemies = new Map(enemies);
  nextEnemies.set(enemy.id, enemy);
  enemies = nextEnemies;

  // Create spawn effect for new enemies
  if (enemy.enemyType === EnemyType.Boss) {
    // Create intense boss spawn effect - will be triggered in p5 sketch
    bossSpawnPosition = { x: enemy.x, y: enemy.y };
    bossSpawnTime = Date.now();
    bossSpawning = true;
  }
};

const handleEnemyUpdate = (_ctx: any, oldEnemy: Enemy, newEnemy: Enemy) => {
  console.log(
    `Enemy Updated: ID=${newEnemy.id}, HP=${newEnemy.hp}/${newEnemy.maxHp}`
  );

  // Check if this was a damage update (hp decreased)
  if (newEnemy.hp < oldEnemy.hp) {
    // Create hit effect at enemy position
    createHitEffect(
      newEnemy.x,
      newEnemy.y,
      newEnemy.enemyType === EnemyType.Boss
    );

    // Create floating damage number
    const damageAmount = oldEnemy.hp - newEnemy.hp;
    createDamageNumber(
      newEnemy.x,
      newEnemy.y,
      damageAmount,
      newEnemy.enemyType === EnemyType.Boss
    );
  }

  const nextEnemies = new Map(enemies);
  nextEnemies.set(newEnemy.id, newEnemy);
  enemies = nextEnemies;
};

const handleEnemyDelete = (_ctx: any, enemy: Enemy) => {
  console.log(`Enemy Deleted: ID=${enemy.id}`);

  // Create death effect when enemy is removed
  createDeathEffect(enemy.x, enemy.y, enemy.enemyType === EnemyType.Boss);

  const nextEnemies = new Map(enemies);
  nextEnemies.delete(enemy.id);
  enemies = nextEnemies;
};

// Create death effect when enemy is defeated
function createDeathEffect(x: number, y: number, isBoss: boolean) {
  // Boss gets a more dramatic explosion
  if (isBoss) {
    // Large explosion
    for (let i = 0; i < 120; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 2;
      const size = Math.random() * 8 + 4;
      const life = Math.random() * 80 + 40;

      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      // Create particle with red/orange color
      particles.push(
        new Particle(
          x,
          y,
          vx,
          vy,
          size,
          life,
          p5Instance?.color(255, Math.random() * 100 + 50, Math.random() * 50)
        )
      );
    }

    // Create shockwave effect in next frame
    setTimeout(() => {
      if (!p5Instance) return;

      // Create expanding ring
      for (let i = 0; i < 2; i++) {
        deathRings.push({
          x,
          y,
          radius: 10,
          maxRadius: 150,
          time: Date.now() + i * 100, // Stagger the rings
          color: p5Instance.color(255, 100, 50, 150),
        });
      }

      // Strong screen shake
      screenShake = {
        active: true,
        duration: 800,
        intensity: 15,
        startTime: Date.now(),
      };

      // Float "BOSS DEFEATED!" text
      floatingTexts.push({
        text: "BOSS DEFEATED!",
        x,
        y: y - 30,
        color: p5Instance.color(255, 100, 50),
        fontSize: 24,
        time: Date.now(),
        duration: 3000,
      });
    }, 10);
  } else {
    // Regular minion explosion - smaller
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 3 + 1;
      const size = Math.random() * 5 + 2;
      const life = Math.random() * 30 + 20;

      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      // Create particle with orange/yellow color
      particles.push(
        new Particle(
          x,
          y,
          vx,
          vy,
          size,
          life,
          p5Instance?.color(255, Math.random() * 150 + 100, Math.random() * 100)
        )
      );
    }

    // Small screen shake
    screenShake = {
      active: true,
      duration: 200,
      intensity: 5,
      startTime: Date.now(),
    };
  }
}

// Render expanding death rings
function renderDeathRings(p: p5) {
  for (let i = deathRings.length - 1; i >= 0; i--) {
    const ring = deathRings[i];
    const elapsed = Date.now() - ring.time;

    // Start if it's time
    if (elapsed < 0) continue;

    // Growth rate
    ring.radius += 3;

    // Remove if too big
    if (ring.radius > ring.maxRadius) {
      deathRings.splice(i, 1);
      continue;
    }

    // Calculate alpha based on life
    const progress = ring.radius / ring.maxRadius;
    const alpha = p.map(progress, 0, 1, 200, 0);

    // Draw the ring
    p.noFill();
    p.stroke(p.red(ring.color), p.green(ring.color), p.blue(ring.color), alpha);
    p.strokeWeight(3);
    p.ellipse(ring.x, ring.y, ring.radius * 2);

    // Draw inner ring
    p.strokeWeight(1);
    p.ellipse(ring.x, ring.y, ring.radius * 1.7);
  }
}

// Render floating text
function renderFloatingTexts(p: p5) {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const text = floatingTexts[i];
    const elapsed = Date.now() - text.time;

    if (elapsed > text.duration) {
      floatingTexts.splice(i, 1);
      continue;
    }

    // Update position - float upward slowly
    text.y -= 0.3;

    // Calculate alpha and scale
    const progress = elapsed / text.duration;
    const alpha = p.map(progress, 0, 1, 255, 0);
    const scale =
      progress < 0.2
        ? p.map(progress, 0, 0.2, 0.5, 1.2) // Grow quickly
        : p.map(progress, 0.2, 1, 1.2, 1); // Shrink slowly

    // Draw text with shadow
    p.push();
    p.translate(text.x, text.y);
    p.scale(scale);

    // Glow effect
    p.noStroke();
    for (let j = 5; j > 0; j--) {
      p.fill(
        p.red(text.color),
        p.green(text.color),
        p.blue(text.color),
        alpha * (j / 10)
      );
      p.textSize(text.fontSize + j);
      p.text(text.text, 0, 0);
    }

    // Main text with shadow
    p.fill(0, alpha * 0.6);
    p.textSize(text.fontSize);
    p.text(text.text, 2, 2);

    p.fill(p.red(text.color), p.green(text.color), p.blue(text.color), alpha);
    p.textSize(text.fontSize);
    p.text(text.text, 0, 0);

    p.pop();
  }
}

// --- SpacetimeDB Connection Logic ---
function connectToSpacetimeDB() {
  console.log("Attempting connection...");
  connectionStatusSpan.textContent = "Connecting...";
  isConnected = false;
  localIdentity = null;
  dbConnection = null; // Clear previous connection if any

  DbConnection.builder()
    .withUri(SPACETIME_DB_HOST)
    .withModuleName(SPACETIME_DB_NAME)
    .withToken(localStorage.getItem("auth_token") || "")
    .onConnect((conn, identity, token) => {
      console.log("Connected! ID:", identity.toHexString());
      dbConnection = conn;
      localIdentity = identity;
      isConnected = true;
      localStorage.setItem("auth_token", token);
      connectionStatusSpan.textContent = "Connected";
      updateUIForConnection(true);

      // === Send initial position to server ===
      // p.setup might have updated localPlayerPos based on existing user data
      if (dbConnection?.reducers?.movePlayer) {
        console.log(
          `Sending initial position to server: ${localPlayerPos.x.toFixed(
            1
          )}, ${localPlayerPos.y.toFixed(1)}`
        );
        try {
          dbConnection.reducers.movePlayer(localPlayerPos.x, localPlayerPos.y);
        } catch (e) {
          console.error("Error sending initial movePlayer:", e);
        }
      } else {
        console.warn(
          "Could not send initial position: connection or reducer unavailable."
        );
      }
      // ========================================

      // Register listeners after connection
      try {
        if (conn.db?.user) {
          conn.db.user.onInsert(handleUserInsert);
          conn.db.user.onUpdate(handleUserUpdate);
          conn.db.user.onDelete(handleUserDelete);
          console.log("User listeners attached.");
        } else {
          console.warn("conn.db.user not ready on connect?");
        }
        if (conn.db?.message) {
          conn.db.message.onInsert(handleMessageInsert);
          console.log("Message listener attached.");
        } else {
          console.warn("conn.db.message not ready on connect?");
        }
        // Add Projectile listeners
        if (conn.db?.projectile) {
          conn.db.projectile.onInsert(handleProjectileInsert);
          conn.db.projectile.onDelete(handleProjectileDelete);
          console.log("Projectile listeners attached.");
        } else {
          console.warn("conn.db.projectile not ready on connect?");
        }
        // Add Enemy listeners
        if (conn.db?.enemy) {
          conn.db.enemy.onInsert(handleEnemyInsert);
          conn.db.enemy.onUpdate(handleEnemyUpdate);
          conn.db.enemy.onDelete(handleEnemyDelete);
          console.log("Enemy listeners attached.");
        } else {
          console.warn("conn.db.enemy not ready on connect?");
        }
      } catch (e) {
        console.error("Error registering listeners:", e);
      }

      // Initial subscription
      conn.subscriptionBuilder().subscribe([
        "SELECT * FROM user",
        "SELECT * FROM message",
        "SELECT * FROM projectile",
        "SELECT * FROM enemy", // Add enemy table subscription
      ]);
    })
    .onDisconnect(() => {
      console.log("Disconnected.");
      isConnected = false;
      localIdentity = null;
      connectionStatusSpan.textContent = "Disconnected";
      updateUIForConnection(false);
      // Clear local state on disconnect
      users = new Map();
      playerMessages = new Map();
      projectiles = new Map();
      enemies = new Map();
      dbConnection = null; // Ensure connection is cleared
      // Optionally attempt reconnect here
    })
    .onConnectError((_ctx, err) => {
      console.error("Connection Error:", err);
      isConnected = false;
      localIdentity = null;
      connectionStatusSpan.textContent = `Error: ${err.message}`;
      updateUIForConnection(false);
      dbConnection = null;
    })
    .build();
}

// --- UI Update Logic ---
function updateUIForConnection(connected: boolean) {
  nameInput.disabled = !connected;
  setNameButton.disabled = !connected;
  chatInput.disabled = !connected;
  sendButton.disabled = !connected;

  if (connected && localIdentity) {
    const localUser = users.get(localIdentity.toHexString());
    nameInput.value = localUser?.name || ""; // Set initial name if available
  }
}

// --- p5.js Sketch Definition ---
const sketch = (p: p5) => {
  // Store p5 instance for death effect
  p5Instance = p;

  // Preload assets
  //   let bossSparkle: p5.Graphics;

  p.setup = () => {
    console.log("p5 setup");
    const canvas = p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    canvas.parent(sketchHolder); // Attach canvas to the holder div
    p.textAlign(p.CENTER, p.CENTER);
    p.frameRate(60);

    // Initialize background stars
    for (let i = 0; i < 100; i++) {
      backgroundStars.push(new BackgroundStar(p));
    }

    // Initialize background effects
    for (let i = 0; i < 8; i++) {
      const types = ["ring", "hex", "grid"];
      bgEffects.push(new BackgroundEffect(p, types[i % types.length]));
    }

    // Create boss sparkle effect
    // bossSparkle = p.createGraphics(150, 150);

    // Initialize global local position based on server state if available
    // This helps if reconnecting and server already has a position stored
    if (localIdentity) {
      const user = users.get(localIdentity.toHexString());
      if (user && (user.x !== 0 || user.y !== 0)) {
        // Check if pos is not default 0,0
        console.log(
          `p.setup: Syncing localPlayerPos from existing user data: ${user.x}, ${user.y}`
        );
        localPlayerPos = { x: user.x, y: user.y };
      } else {
        console.log(
          "p.setup: No valid existing user data found, using default center pos for localPlayerPos initially."
        );
        // Keep default center pos if no valid data or it's 0,0
        localPlayerPos = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
      }
    } else {
      console.log(
        "p.setup: No localIdentity yet, using default center pos for localPlayerPos initially."
      );
      // Ensure it's reset to center if no identity yet
      localPlayerPos = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    }
    // The onConnect handler will now send this initial position to the server
  };

  p.draw = () => {
    // Calculate screen shake offset
    let shakeX = 0;
    let shakeY = 0;

    if (screenShake.active) {
      const elapsed = Date.now() - screenShake.startTime;
      if (elapsed < screenShake.duration) {
        const intensity = p.map(
          elapsed,
          0,
          screenShake.duration,
          screenShake.intensity,
          0
        );
        shakeX = p.random(-intensity, intensity);
        shakeY = p.random(-intensity, intensity);
      } else {
        screenShake.active = false;
      }
    }

    // Apply screen shake
    p.push();
    p.translate(shakeX, shakeY);

    // Draw background - dark gradient
    let bgGradient = p.drawingContext as CanvasRenderingContext2D;
    let gradient = bgGradient.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, "#0D1B2A");
    gradient.addColorStop(0.5, "#1B263B");
    gradient.addColorStop(1, "#162447");
    bgGradient.fillStyle = gradient;
    p.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw background effects first
    for (let i = bgEffects.length - 1; i >= 0; i--) {
      if (bgEffects[i].update(p)) {
        // Replace with a new effect
        const types = ["ring", "hex", "grid"];
        bgEffects.splice(
          i,
          1,
          new BackgroundEffect(p, types[Math.floor(p.random(types.length))])
        );
      } else {
        bgEffects[i].draw(p);
      }
    }

    // Add new background effect occasionally
    if (p.frameCount % 120 === 0 && bgEffects.length < 12) {
      const types = ["ring", "hex", "grid"];
      bgEffects.push(
        new BackgroundEffect(p, types[Math.floor(p.random(types.length))])
      );
    }

    // Draw background stars with parallax effect
    backgroundStars.forEach((star) => {
      star.update(p);
      star.draw(p);
    });

    // Draw subtle grid lines
    p.stroke(100, 30);
    p.strokeWeight(1);
    for (let x = 0; x < CANVAS_WIDTH; x += 30) {
      p.line(x, 0, x, CANVAS_HEIGHT);
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += 30) {
      p.line(0, y, CANVAS_WIDTH, y);
    }

    const currentTime = Date.now(); // Get current time for prediction

    // --- Handle Movement Input & Update ---
    handleMovementInput(p);

    // --- Draw trail particles for local player ---
    if (localIdentity) {
      const userPos = localPlayerPos;
      if (Math.random() < 0.2) {
        // 20% chance each frame to create a trail particle
        const trailColor = p.color(100, 150, 255, 120);
        particles.push(
          new Particle(
            userPos.x + p.random(-5, 5),
            userPos.y + p.random(-5, 5),
            p.random(-0.2, 0.2),
            p.random(-0.2, 0.2),
            p.random(2, 8),
            p.random(20, 40),
            trailColor
          )
        );
      }
    }

    // --- Render Enemies ---
    enemies.forEach((enemy) => {
      // Determine size and color based on enemy type
      const isBoss = enemy.enemyType.tag === EnemyType.Boss.tag;
      const enemySize = isBoss ? 50 : PLAYER_SIZE * 0.9;

      // Calculate health percentage
      const healthPercent = enemy.hp / enemy.maxHp;

      // Set color: boss is red with glow, minions are orange
      const enemyColor = isBoss
        ? p.color(255, 30, 60, 220) // Vibrant red for boss
        : p.color(255, 150, 20, 200); // Orange for minions

      // Draw enemy glow
      p.noStroke();
      for (let i = 5; i > 0; i--) {
        const alpha = isBoss ? 100 - i * 15 : 40 - i * 7;
        p.fill(
          p.red(enemyColor),
          p.green(enemyColor),
          p.blue(enemyColor),
          alpha
        );
        p.ellipse(enemy.x, enemy.y, enemySize + i * 4, enemySize + i * 4);
      }

      // Draw enemy main body
      p.fill(enemyColor);
      p.stroke(255, 100);
      p.strokeWeight(2);

      if (isBoss) {
        // Boss has more complex shape with "crown" spikes
        p.push();
        p.translate(enemy.x, enemy.y);

        // Draw pulsating aura
        const pulseSize = 1 + Math.sin(p.frameCount * 0.05) * 0.1;
        for (let i = 3; i > 0; i--) {
          p.fill(255, 30, 60, 15 * i);
          p.ellipse(
            0,
            0,
            enemySize * pulseSize + i * 10,
            enemySize * pulseSize + i * 10
          );
        }

        // Draw spikes/crown
        p.stroke(255, 150);
        p.strokeWeight(2);
        p.fill(255, 30, 60);
        const spikes = 8;
        const outerRadius = enemySize * 0.6;
        const innerRadius = enemySize * 0.4;

        p.beginShape();
        for (let i = 0; i < spikes * 2; i++) {
          const angle = p.map(i, 0, spikes * 2, 0, p.TWO_PI);
          const radius = i % 2 === 0 ? outerRadius : innerRadius;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          p.vertex(x, y);
        }
        p.endShape(p.CLOSE);

        // Draw inner circle
        p.fill(20, 0, 40);
        p.ellipse(0, 0, enemySize * 0.7, enemySize * 0.7);

        // Draw "eye"
        p.fill(255, 100, 100);
        p.noStroke();
        p.ellipse(0, 0, enemySize * 0.3, enemySize * 0.3);

        // Eye shine
        p.fill(255, 200);
        p.ellipse(
          -enemySize * 0.05,
          -enemySize * 0.05,
          enemySize * 0.1,
          enemySize * 0.1
        );

        p.pop();
      } else {
        // Minions have simpler shape but still interesting
        p.push();
        p.translate(enemy.x, enemy.y);

        // Draw outer shape
        p.fill(255, 120, 20);
        p.ellipse(0, 0, enemySize, enemySize);

        // Draw inner details
        p.fill(50, 0, 0);
        p.noStroke();
        p.ellipse(0, 0, enemySize * 0.6, enemySize * 0.6);

        // Draw "eyes"
        p.fill(255, 200, 0);
        const eyeOffset = enemySize * 0.15;
        p.ellipse(-eyeOffset, -eyeOffset, enemySize * 0.2, enemySize * 0.2);
        p.ellipse(eyeOffset, -eyeOffset, enemySize * 0.2, enemySize * 0.2);

        p.pop();
      }

      // Draw name with glowing effect
      p.noStroke();
      if (isBoss) {
        // Boss has fancy name rendering
        const bossNameY = enemy.y - enemySize * 0.9;

        // Glow behind text
        p.fill(255, 30, 60, 100);
        p.textSize(16);
        p.text(enemy.name, enemy.x + 1, bossNameY + 1);
        p.text(enemy.name, enemy.x - 1, bossNameY - 1);
        p.text(enemy.name, enemy.x + 1, bossNameY - 1);
        p.text(enemy.name, enemy.x - 1, bossNameY + 1);

        // Actual text
        p.fill(255);
        p.textSize(16);
        p.text(enemy.name, enemy.x, bossNameY);
      } else {
        p.fill(255, 200);
        p.textSize(10);
        p.text(enemy.name, enemy.x, enemy.y - enemySize * 0.7);
      }

      // Draw fancy health bar with glow
      const barWidth = enemySize * 1.5;
      const barHeight = isBoss ? 8 : 5;
      const barX = enemy.x - barWidth / 2;
      const barY = enemy.y + enemySize * 0.7;

      // Health bar container with glow
      p.noFill();
      p.stroke(200, 50);
      p.strokeWeight(4);
      p.rect(barX - 2, barY - 2, barWidth + 4, barHeight + 4, 4);

      // Health bar background (empty health)
      p.noStroke();
      p.fill(40, 40, 40, 200);
      p.rect(barX, barY, barWidth, barHeight, 3);

      // Health bar foreground (current health) with gradient
      if (healthPercent > 0) {
        // Select color based on health percentage
        let healthColor;
        if (healthPercent > 0.6) {
          healthColor = p.color(30, 220, 30); // Green
        } else if (healthPercent > 0.3) {
          healthColor = p.color(220, 220, 30); // Yellow
        } else {
          healthColor = p.color(220, 30, 30); // Red
        }

        p.fill(healthColor);
        p.rect(barX, barY, barWidth * healthPercent, barHeight, isBoss ? 3 : 2);

        // Add shine to health bar
        p.fill(255, 150);
        p.rect(barX, barY, barWidth * healthPercent, barHeight * 0.3, 1);
      }

      // Add random particles around boss for effect
      if (isBoss && Math.random() < 0.3) {
        const angle = p.random(p.TWO_PI);
        const distance = enemySize * 0.7;
        const particleX = enemy.x + Math.cos(angle) * distance;
        const particleY = enemy.y + Math.sin(angle) * distance;

        const bossParticleColor = p.color(
          255,
          p.random(30, 100),
          p.random(70, 150),
          150
        );
        particles.push(
          new Particle(
            particleX,
            particleY,
            p.random(-0.5, 0.5),
            p.random(-1.5, -0.5),
            p.random(2, 4),
            p.random(20, 40),
            bossParticleColor
          )
        );
      }
    });

    // --- Render Users ---
    users.forEach((user, idHex) => {
      if (!user.online) return;

      const isLocalPlayer = localIdentity?.toHexString() === idHex;
      let currentPos = { x: user.x, y: user.y }; // Default to server position

      // For the local player, ALWAYS use the smoothed local position for rendering
      if (isLocalPlayer) {
        currentPos = localPlayerPos;
      }

      // Draw player glow
      const playerBaseColor = isLocalPlayer
        ? p.color(100, 150, 255) // Blue for local player
        : p.color(100, 255, 150); // Green for other players

      // Draw concentric glow circles
      p.noStroke();
      for (let i = 4; i > 0; i--) {
        const glowColor = p.color(
          p.red(playerBaseColor),
          p.green(playerBaseColor),
          p.blue(playerBaseColor),
          50 - i * 10
        );
        p.fill(glowColor);
        p.ellipse(
          currentPos.x,
          currentPos.y,
          PLAYER_SIZE + i * 5,
          PLAYER_SIZE + i * 5
        );
      }

      // Draw player circle with gradient fill
      const gradient = p.drawingContext.createRadialGradient(
        currentPos.x,
        currentPos.y - PLAYER_SIZE / 4,
        PLAYER_SIZE / 8,
        currentPos.x,
        currentPos.y,
        PLAYER_SIZE / 1.5
      );

      if (isLocalPlayer) {
        gradient.addColorStop(0, "rgba(150, 200, 255, 0.9)");
        gradient.addColorStop(1, "rgba(70, 120, 255, 0.7)");
      } else {
        gradient.addColorStop(0, "rgba(150, 255, 200, 0.9)");
        gradient.addColorStop(1, "rgba(70, 220, 120, 0.7)");
      }

      p.drawingContext.fillStyle = gradient;
      p.strokeWeight(2);
      p.stroke(255, 180);
      p.ellipse(currentPos.x, currentPos.y, PLAYER_SIZE, PLAYER_SIZE);

      // Draw inner highlight
      p.noStroke();
      p.fill(255, 150);
      p.ellipse(
        currentPos.x - PLAYER_SIZE / 4,
        currentPos.y - PLAYER_SIZE / 4,
        PLAYER_SIZE / 3,
        PLAYER_SIZE / 3
      );

      // Draw name with shadow
      const name = user.name ?? `User ${idHex.substring(0, 6)}`;
      p.fill(0, 100);
      p.noStroke();
      p.textSize(11);
      p.text(name, currentPos.x + 1, currentPos.y + PLAYER_SIZE * 0.85 + 1);
      p.fill(255);
      p.text(name, currentPos.x, currentPos.y + PLAYER_SIZE * 0.85);

      // Draw messages for this user with better styling
      const messages = playerMessages.get(idHex) || [];
      messages.forEach((msg, index) => {
        const yOffset = -(PLAYER_SIZE * 0.85 + (index + 1) * 15);
        const age = currentTime - msg.timestamp;
        const alpha = p.map(age, 0, MESSAGE_DURATION_MS, 255, 0, true);
        if (alpha <= 0) return; // Don't draw faded out messages

        // Draw message bubble
        const textWidth = p.textWidth(msg.text);
        const bubbleWidth = textWidth + 10;
        const bubbleHeight = 18;
        const bubbleX = currentPos.x - bubbleWidth / 2;
        const bubbleY = currentPos.y + yOffset - bubbleHeight / 2;

        // Message bubble shadow
        p.fill(0, alpha * 0.3);
        p.rect(bubbleX + 2, bubbleY + 2, bubbleWidth, bubbleHeight, 5);

        // Message bubble
        p.fill(
          isLocalPlayer ? 100 : 50,
          isLocalPlayer ? 130 : 200,
          isLocalPlayer ? 240 : 100,
          alpha * 0.7
        );
        p.rect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 5);

        // Message text
        p.fill(255, alpha);
        p.text(msg.text, currentPos.x, currentPos.y + yOffset);
      });
    });

    // --- Render Projectiles with enhanced effects ---
    let projectilesToDelete = new Set<bigint>();

    projectiles.forEach((proj, id) => {
      // Access nested timestamp and convert bigint micros to number ms
      const spawnTimeMs =
        Number(proj.spawnTime.__timestamp_micros_since_unix_epoch__) / 1000;
      if (isNaN(spawnTimeMs)) {
        console.warn(`Invalid spawnTime for projectile ${id}, deleting.`);
        projectilesToDelete.add(id);
        return;
      }
      // Now calculate time elapsed using milliseconds
      const timeElapsedSeconds = (currentTime - spawnTimeMs) / 1000.0;

      const predictedX = proj.x + proj.vx * timeElapsedSeconds;
      const predictedY = proj.y + proj.vy * timeElapsedSeconds;

      // Add trail particles occasionally
      if (Math.random() < 0.4) {
        const trailColor = p.color(200, 200, 255, 150);
        particles.push(
          new Particle(
            predictedX,
            predictedY,
            p.random(-0.5, 0.5),
            p.random(-0.5, 0.5),
            p.random(2, 4),
            p.random(10, 20),
            trailColor
          )
        );
      }

      // Check bounds/lifetime
      if (
        predictedX < -PLAYER_SIZE ||
        predictedX > CANVAS_WIDTH + PLAYER_SIZE ||
        predictedY < -PLAYER_SIZE ||
        predictedY > CANVAS_HEIGHT + PLAYER_SIZE ||
        timeElapsedSeconds > 10
      ) {
        projectilesToDelete.add(id);
        return;
      }

      // Draw projectile glow
      p.noStroke();
      for (let i = 3; i > 0; i--) {
        p.fill(200, 200, 255, 70 - i * 20);
        p.ellipse(predictedX, predictedY, 5 + i * 4, 5 + i * 4);
      }

      // Draw the projectile core
      p.fill(255);
      p.stroke(100, 200, 255, 200);
      p.strokeWeight(1);
      p.ellipse(predictedX, predictedY, 6, 6);

      // Draw inner highlight
      p.noStroke();
      p.fill(255);
      p.ellipse(predictedX - 1, predictedY - 1, 2, 2);

      // Check for collisions with enemies
      enemies.forEach((enemy) => {
        // Use the enemy's size for hitbox calculation
        const hitboxSize =
          enemy.size || (enemy.enemyType === EnemyType.Boss ? 50 : 20);
        const distance = Math.sqrt(
          Math.pow(predictedX - enemy.x, 2) + Math.pow(predictedY - enemy.y, 2)
        );

        // If collision detected
        if (distance < hitboxSize / 2) {
          // Mark projectile for deletion
          projectilesToDelete.add(id);

          // Call damage_enemy reducer to apply damage on the server
          if (dbConnection?.reducers?.damageEnemy) {
            try {
              console.log(`Projectile hit enemy ${enemy.id}!`);
              dbConnection.reducers.damageEnemy(enemy.id, PROJECTILE_DAMAGE);
            } catch (e) {
              console.error("Error calling damageEnemy reducer:", e);
            }
          }
        }
      });
    });

    // Remove projectiles marked for deletion
    if (projectilesToDelete.size > 0) {
      const nextProjectiles = new Map(projectiles);
      projectilesToDelete.forEach((id) => nextProjectiles.delete(id));
      projectiles = nextProjectiles;
    }

    // --- Update and render particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update(p);
      particles[i].draw(p);
      if (particles[i].isDead()) {
        particles.splice(i, 1);
      }
    }

    // Process boss spawning effect
    if (bossSpawning) {
      const elapsed = Date.now() - bossSpawnTime;
      if (elapsed < 100) {
        // Only trigger once, near the start
        createBossSpawnEffect(p, bossSpawnPosition.x, bossSpawnPosition.y);
        bossSpawning = false; // Effect created, don't re-create
      }
    }

    // After drawing enemies and other game elements, render hit effects
    // Process and render hit effects
    for (let i = hitEffects.length - 1; i >= 0; i--) {
      if (renderHitEffect(p, hitEffects[i])) {
        hitEffects.splice(i, 1);
      }
    }

    // Render damage numbers last (on top)
    renderDamageNumbers(p);

    // Render death rings
    renderDeathRings(p);

    // Render floating texts (on top of everything)
    renderFloatingTexts(p);

    p.pop(); // End screen shake transform
  };

  const handleMovementInput = (p: p5) => {
    if (!isConnected || !localIdentity) return;

    let dx = 0;
    let dy = 0;
    const activeElement = document.activeElement;
    const isTyping = activeElement === nameInput || activeElement === chatInput;

    if (!isTyping) {
      // Use p.keyIsDown() instead of keysDown set
      if (p.keyIsDown(p.LEFT_ARROW) || p.keyIsDown(65)) dx -= 1; // A
      if (p.keyIsDown(p.RIGHT_ARROW) || p.keyIsDown(68)) dx += 1; // D
      if (p.keyIsDown(p.UP_ARROW) || p.keyIsDown(87)) dy -= 1; // W
      if (p.keyIsDown(p.DOWN_ARROW) || p.keyIsDown(83)) dy += 1; // S
    }

    if (dx !== 0 || dy !== 0) {
      // ** Correct Vector Normalization **
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      if (magnitude > 0) {
        // Avoid division by zero
        dx = dx / magnitude;
        dy = dy / magnitude;
        // *** Store the last valid direction ***
        lastMoveDirection = { dx: dx, dy: dy };
      }
      // ** End Normalization **

      const moveX = dx * PLAYER_SPEED;
      const moveY = dy * PLAYER_SPEED;

      const currentPos = localPlayerPos;
      const newX = p.constrain(
        currentPos.x + moveX,
        PLAYER_SIZE / 2,
        CANVAS_WIDTH - PLAYER_SIZE / 2
      );
      const newY = p.constrain(
        currentPos.y + moveY,
        PLAYER_SIZE / 2,
        CANVAS_HEIGHT - PLAYER_SIZE / 2
      );

      if (newX !== currentPos.x || newY !== currentPos.y) {
        localPlayerPos = { x: newX, y: newY };
        const now = Date.now();
        if (now - lastMoveSentTime > MOVE_THROTTLE_MS) {
          if (dbConnection?.reducers?.movePlayer) {
            try {
              dbConnection.reducers.movePlayer(newX, newY);
              lastMoveSentTime = now;
            } catch (e) {
              console.error("Error sending movePlayer:", e);
            }
          }
        }
      }
    }
  };

  // Keep keyPressed mainly for preventing default actions and handling non-movement keys
  p.keyPressed = () => {
    const activeElement = document.activeElement;
    const isTyping = activeElement === nameInput || activeElement === chatInput;

    // Shoot Forward (Space or F)
    if (!isTyping && (p.keyCode === 32 || p.keyCode === 70)) {
      // 32 = Space, 70 = F
      if (isConnected && dbConnection?.reducers?.shoot) {
        // Calculate a target point slightly ahead in the last direction
        const targetX = localPlayerPos.x + lastMoveDirection.dx * 50; // 50 pixels ahead
        const targetY = localPlayerPos.y + lastMoveDirection.dy * 50;
        console.log(
          `Shooting Forward towards ${targetX.toFixed(1)}, ${targetY.toFixed(
            1
          )}`
        );
        try {
          dbConnection.reducers.shoot(targetX, targetY);

          // Create muzzle flash effect at player position
          if (localIdentity) {
            const playerColor = p.color(100, 150, 255);
            createExplosion(
              p,
              localPlayerPos.x,
              localPlayerPos.y,
              playerColor,
              5,
              2
            );
          }
        } catch (e) {
          console.error("Error calling shoot reducer (forward):", e);
        }
      }
      return false; // Prevent default spacebar action (scrolling) or typing 'f'
    }

    // Prevent default for movement keys ONLY WHEN NOT TYPING
    if (
      !isTyping &&
      [
        p.LEFT_ARROW,
        p.RIGHT_ARROW,
        p.UP_ARROW,
        p.DOWN_ARROW,
        65, // A
        68, // D
        83, // S
        87, // W
      ].includes(p.keyCode)
    ) {
      // We still prevent default, but movement is handled by keyIsDown
      return false;
    }

    // Allow default for typing in inputs (unless Escape)
    if (isTyping) {
      if (p.keyCode === p.ESCAPE) {
        (activeElement as HTMLElement)?.blur();
        return false;
      }
      return true;
    }

    // Prevent default for Enter key if not typing
    if (p.keyCode === p.ENTER) {
      return false;
    }

    return true; // Allow other keys
  };

  // Keep keyReleased mainly for preventing default actions
  p.keyReleased = () => {
    const activeElement = document.activeElement;
    const isTyping = activeElement === nameInput || activeElement === chatInput;

    // Only prevent default for movement keys when not typing
    if (
      !isTyping &&
      [
        p.LEFT_ARROW,
        p.RIGHT_ARROW,
        p.UP_ARROW,
        p.DOWN_ARROW,
        32, // Space
        65, // A
        68, // D
        83, // S
        87, // W
      ].includes(p.keyCode)
    ) {
      return false;
    }
    // Handle other key releases here if needed
    return true;
  };

  // --- Input Handlers ---
  p.mousePressed = () => {
    // Shoot only if connected, mouse is on canvas, and not typing
    const activeElement = document.activeElement;
    const isTyping = activeElement === nameInput || activeElement === chatInput;

    if (
      isConnected &&
      dbConnection?.reducers?.shoot &&
      !isTyping &&
      p.mouseX >= 0 &&
      p.mouseX <= CANVAS_WIDTH &&
      p.mouseY >= 0 &&
      p.mouseY <= CANVAS_HEIGHT
    ) {
      console.log(`Shooting towards ${p.mouseX}, ${p.mouseY}`);
      try {
        dbConnection.reducers.shoot(p.mouseX, p.mouseY);

        // Create muzzle flash effect at player position
        if (localIdentity) {
          const playerColor = p.color(100, 150, 255);
          createExplosion(
            p,
            localPlayerPos.x,
            localPlayerPos.y,
            playerColor,
            5,
            2
          );
        }
      } catch (e) {
        console.error("Error calling shoot reducer:", e);
      }
    }
    // Prevent default right-click context menu if needed
    // return false;
  };
};

// --- Initialization Code (runs after DOM is ready) ---
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM Ready");

  // Get DOM elements
  nameInput = document.getElementById("nameInput") as HTMLInputElement;
  setNameButton = document.getElementById("setNameButton") as HTMLButtonElement;
  chatInput = document.getElementById("chatInput") as HTMLInputElement;
  sendButton = document.getElementById("sendButton") as HTMLButtonElement;
  connectionStatusSpan = document.getElementById("connectionStatus")!;
  sketchHolder = document.getElementById("sketch-holder")!;

  // Add UI Event Listeners
  setNameButton.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (isConnected && dbConnection?.reducers?.setName && name) {
      try {
        console.log("Sending setName:", name);
        dbConnection.reducers.setName(name);
      } catch (e) {
        console.error("Error sending setName:", e);
      }
    } else {
      console.warn("Cannot set name: Not connected or name empty");
    }
  });

  const sendMessage = () => {
    const text = chatInput.value.trim();
    if (isConnected && dbConnection?.reducers?.sendMessage && text) {
      try {
        console.log("Sending sendMessage:", text);
        dbConnection.reducers.sendMessage(text);
        chatInput.value = ""; // Clear input
        // Keep focus on the chat input after sending
        chatInput.focus();
      } catch (e) {
        console.error("Error sending sendMessage:", e);
      }
    } else {
      // console.warn("Cannot send message: Not connected or message empty");
    }
  };

  sendButton.addEventListener("click", sendMessage);
  chatInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      sendMessage();
    }
  });

  // Initial UI state
  updateUIForConnection(false);

  // Start SpacetimeDB connection
  connectToSpacetimeDB();

  // Initialize p5.js sketch
  new p5(sketch);
  console.log("p5 sketch initialized");
});
