/** Simulation runs at a fixed 60 Hz. All timings are authored in ms and converted to ticks. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;
export const ms2t = (ms: number) => Math.round(ms / TICK_MS);
export const t2ms = (t: number) => t * TICK_MS;

/**
 * Player rules. These never change during play (pillar 3: consistent rules).
 * See DESIGN.md "Player kit" for the rationale behind each number.
 */
export const PLAYER = {
  radius: 0.4,
  maxHp: 100,
  maxStamina: 100,
  runSpeed: 4.3, // m/s
  staminaRegen: 52, // per second
  regenDelayMs: 450, // after spending stamina
  exhaustedDelayMs: 900, // if stamina reached 0
  // Dodge roll
  rollMs: 520,
  rollIFrom: 33, // i-frames start (ms from press)
  rollITo: 366, // i-frames end -> 333ms of invulnerability
  rollMoveMs: 400,
  rollDist: 3.0,
  rollCost: 24,
  // Light attack chain (3 hits)
  attacks: [
    { startup: 150, active: 100, cancel: 400, end: 620, damage: 14, stagger: 10, cost: 16, reach: 1.95, half: 1.05, lunge: 0.45 },
    { startup: 150, active: 100, cancel: 400, end: 620, damage: 14, stagger: 10, cost: 16, reach: 1.95, half: 1.05, lunge: 0.45 },
    { startup: 230, active: 120, cancel: 560, end: 760, damage: 24, stagger: 18, cost: 22, reach: 2.1, half: 0.85, lunge: 0.7 },
  ],
  attackTrackMs: 120, // can rotate toward target during first part of startup
  // Clean dodge reward ("Slip")
  slipWindowMs: 1200, // riposte must start within this time after a clean dodge
  slipStaminaRefund: 20,
  slipDamageMult: 1.6,
  slipStaggerMult: 3,
  // Healing draught
  healMs: 1150,
  healApplyMs: 700,
  healAmount: 42,
  healMoveMult: 0.3,
  baseDraughts: 4,
  // Being hit
  hitstunMs: 300,
  hitInvulnMs: 300,
  knockback: 0.7,
  // Input buffer: an action pressed while busy is kept this long (pillar 3)
  bufferMs: 220,
};

/**
 * The "fair view": enemies may only START an attack (or the next step of a combo) where the player can see them.
 * The camera keeps the player CAM_BIAS m above the screen centre and always shows at least 11 m vertically and
 * 19.5 m horizontally (iPhone SE landscape). The thumbs rest in the bottom corners, so the region excludes them:
 * the full width only above the thumbs, a narrower band between them, and a channel at the bottom centre.
 * Coordinates are metres relative to the player, +y is screen-down.
 */
export const CAM_BIAS = 0.9;
export function inFairView(dx: number, dy: number): boolean {
  const sx = Math.abs(dx), sy = dy - CAM_BIAS; // position relative to the screen centre
  if (sx > 6.6 || sy < -4.2) return false;
  if (sy <= 0.6) return true; // above the thumbs: full width
  if (sx <= 4.4 && sy <= 2.0) return true; // between the thumbs
  return sx <= 2.6 && sy <= 4.6; // bottom-centre channel
}
