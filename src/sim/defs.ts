import { HitShape } from './shapes';

/** Visual pose family used during a step's wind-up. Every attack step gets a unique (pose, sound) pair = its tell. */
export type Pose =
  | 'swipe' | 'sweepR' | 'sweepL' | 'overhead' | 'overheadHold' | 'thrust' | 'charge' | 'throw'
  | 'pounce' | 'bite' | 'cast' | 'stomp' | 'wave' | 'dive' | 'blink' | 'evade' | 'hymn' | 'burst' | 'slamShell' | 'sweepShell';

/** How an attacker reaching the player should ideally be avoided. Used ONLY by bots that "know" the attack. */
export type DodgeHint = 'away' | 'side' | 'through';

export interface StepDef {
  id: string;
  name: string;
  /** ms from the tell (start of this step's wind-up pose + sound) to the first active frame */
  windup: number;
  /** ms the hitbox is live */
  active: number;
  /** ms after the active window: recovery for the last step, gap before the next step otherwise */
  after: number;
  pose: Pose;
  sfx: string;
  hit?: HitShape;
  damage: number;
  /** attacker keeps turning toward the player until this many ms into the wind-up */
  trackUntil?: number;
  turnRate?: number; // rad/s while tracking
  /** forward movement (negative = backwards) between `from` and `to` ms of the step */
  lunge?: { from: number; to: number; dist: number };
  /** during the active window the attacker charges forward with the hitbox */
  charge?: { speed: number };
  /** leap: the landing marker follows the player until lockAt ms, attacker lands at the active frame */
  leap?: { jumpAt: number; lockAt: number };
  /** vanish at `at` ms, reappear `dist` m beyond the player (opposite side) */
  blink?: { at: number; dist: number };
  /** expanding ring spawned at the first active frame */
  ring?: { speed: number; maxR: number; width: number };
  /** projectile spawned at the first active frame */
  projectile?: { speed: number; r: number; ttl: number; root?: number };
  knockback?: number;
  /** cannot be flinched during this step (bosses are always armoured) */
  armor?: boolean;
  dodge: DodgeHint;
}

export interface AttackDef {
  id: string;
  steps: StepDef[];
  minRange: number;
  maxRange: number;
  weight: number;
  cooldown: number; // ms before this attack can be chosen again
  phase?: 1 | 2; // only in this phase (undefined = both)
  /** chosen with priority when the player is hugging (within maxRange) and this many ms passed since last use */
  antiHug?: boolean;
  /** non-attack reposition move */
  evade?: boolean;
}

export interface EnemyDef {
  kind: string;
  name: string;
  hp: number;
  radius: number;
  speed: number;
  sight: number;
  boss?: boolean;
  /** damage multiplier taken from the front (within ±70°) unless the enemy is recovering */
  frontGuard?: number;
  /** regular enemies flinch when hit (max once per flinchCooldown) unless armoured */
  flinch: boolean;
  preferDist: number;
  idleMs: [number, number];
  idleMsP2?: [number, number];
  attacks: AttackDef[];
  phase2At?: number;
  staggerMax?: number;
  /** boss: hits within window that trigger an evade */
  evadeAfterHits?: number;
  mass: number;
  floats?: boolean;
}

const deg = (d: number) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- regular enemies

export const NOVICE: EnemyDef = {
  kind: 'novice', name: 'Drowned Novice', hp: 56, radius: 0.45, speed: 1.7, sight: 7, flinch: true,
  preferDist: 1.3, idleMs: [500, 900], mass: 1,
  attacks: [
    {
      id: 'novice.claw', minRange: 0, maxRange: 1.9, weight: 3, cooldown: 0,
      steps: [{ id: 'novice.claw', name: 'Novice claw', windup: 650, active: 120, after: 750, pose: 'swipe', sfx: 'tellSoft',
        hit: { kind: 'arc', r: 1.75, half: deg(55) }, damage: 15, trackUntil: 450, turnRate: 5, lunge: { from: 520, to: 700, dist: 0.5 }, dodge: 'away' }],
    },
    {
      id: 'novice.double', minRange: 0, maxRange: 1.8, weight: 1, cooldown: 2500,
      steps: [
        { id: 'novice.double1', name: 'Novice double claw', windup: 650, active: 120, after: 220, pose: 'swipe', sfx: 'tellSoft2',
          hit: { kind: 'arc', r: 1.75, half: deg(55) }, damage: 13, trackUntil: 450, turnRate: 5, lunge: { from: 520, to: 700, dist: 0.5 }, dodge: 'away' },
        { id: 'novice.double2', name: 'Novice double claw (2nd)', windup: 520, active: 120, after: 900, pose: 'swipe', sfx: 'tellQuick',
          hit: { kind: 'arc', r: 1.75, half: deg(55) }, damage: 13, trackUntil: 300, turnRate: 5, lunge: { from: 400, to: 560, dist: 0.6 }, dodge: 'away' },
      ],
    },
  ],
};

export const HOOKBEARER: EnemyDef = {
  kind: 'hook', name: 'Hookbearer', hp: 80, radius: 0.45, speed: 2.3, sight: 8, flinch: true,
  preferDist: 2.6, idleMs: [500, 1000], mass: 1.2,
  attacks: [
    {
      id: 'hook.thrust', minRange: 1.0, maxRange: 3.2, weight: 3, cooldown: 0,
      steps: [{ id: 'hook.thrust', name: 'Hook thrust', windup: 600, active: 120, after: 700, pose: 'thrust', sfx: 'tellMetal',
        hit: { kind: 'rect', from: 0, to: 3.0, halfW: 0.35 }, damage: 18, trackUntil: 400, turnRate: 4, lunge: { from: 520, to: 700, dist: 0.6 }, dodge: 'side' }],
    },
    {
      id: 'hook.double', minRange: 1.0, maxRange: 3.0, weight: 1, cooldown: 3000,
      steps: [
        { id: 'hook.double1', name: 'Hook double thrust', windup: 600, active: 110, after: 200, pose: 'thrust', sfx: 'tellMetal2',
          hit: { kind: 'rect', from: 0, to: 3.0, halfW: 0.35 }, damage: 15, trackUntil: 400, turnRate: 4, lunge: { from: 520, to: 700, dist: 0.5 }, dodge: 'side' },
        { id: 'hook.double2', name: 'Hook double thrust (2nd)', windup: 520, active: 120, after: 950, pose: 'thrust', sfx: 'tellQuick',
          hit: { kind: 'rect', from: 0, to: 3.1, halfW: 0.35 }, damage: 15, trackUntil: 300, turnRate: 4, lunge: { from: 420, to: 600, dist: 0.6 }, dodge: 'side' },
      ],
    },
    {
      id: 'hook.sweep', minRange: 0, maxRange: 1.4, weight: 2, cooldown: 1500,
      steps: [{ id: 'hook.sweep', name: 'Hook haft sweep', windup: 560, active: 120, after: 700, pose: 'sweepR', sfx: 'tellSoft2',
        hit: { kind: 'arc', r: 1.8, half: deg(80) }, damage: 12, trackUntil: 350, turnRate: 5, dodge: 'away' }],
    },
  ],
};

export const HOUND: EnemyDef = {
  kind: 'hound', name: 'Brinehound', hp: 42, radius: 0.4, speed: 4.4, sight: 8, flinch: true,
  preferDist: 3.4, idleMs: [700, 1300], mass: 0.7,
  attacks: [
    {
      id: 'hound.pounce', minRange: 2.2, maxRange: 4.6, weight: 3, cooldown: 0,
      steps: [{ id: 'hound.pounce', name: 'Brinehound pounce', windup: 540, active: 300, after: 900, pose: 'pounce', sfx: 'tellGrowl',
        hit: { kind: 'circle', r: 0.6, fwd: 0.35 }, damage: 14, trackUntil: 360, turnRate: 6, charge: { speed: 13 }, dodge: 'side' }],
    },
    {
      id: 'hound.bite', minRange: 0, maxRange: 1.4, weight: 2, cooldown: 800,
      steps: [{ id: 'hound.bite', name: 'Brinehound bite', windup: 500, active: 100, after: 650, pose: 'bite', sfx: 'tellSnap',
        hit: { kind: 'arc', r: 1.3, half: deg(45) }, damage: 10, trackUntil: 320, turnRate: 6, lunge: { from: 420, to: 560, dist: 0.5 }, dodge: 'away' }],
    },
  ],
};

export const WICK: EnemyDef = {
  kind: 'wick', name: 'Wick', hp: 30, radius: 0.35, speed: 2.0, sight: 8.5, flinch: true, floats: true,
  preferDist: 5.5, idleMs: [1100, 1700], mass: 0.4,
  attacks: [
    {
      id: 'wick.ember', minRange: 2.5, maxRange: 7.2, weight: 1, cooldown: 0,
      steps: [{ id: 'wick.ember', name: 'Wick ember', windup: 700, active: 50, after: 900, pose: 'cast', sfx: 'tellFlame',
        damage: 12, trackUntil: 600, turnRate: 6, projectile: { speed: 7.5, r: 0.25, ttl: 2000 }, dodge: 'side' }],
    },
  ],
};

export const SHELLBOUND: EnemyDef = {
  kind: 'shell', name: 'Shellbound', hp: 130, radius: 0.62, speed: 1.4, sight: 7, flinch: false, frontGuard: 0.25,
  preferDist: 1.8, idleMs: [600, 1000], mass: 3,
  attacks: [
    {
      id: 'shell.slam', minRange: 0.5, maxRange: 2.6, weight: 2, cooldown: 0,
      steps: [{ id: 'shell.slam', name: 'Shellbound slam', windup: 1000, active: 150, after: 1250, pose: 'slamShell', sfx: 'tellHeavy',
        hit: { kind: 'rect', from: 0, to: 2.7, halfW: 0.75 }, damage: 30, trackUntil: 700, turnRate: 3, armor: true, dodge: 'side' }],
    },
    {
      id: 'shell.sweep', minRange: 0, maxRange: 2.0, weight: 2, cooldown: 1200,
      steps: [{ id: 'shell.sweep', name: 'Shellbound sweep', windup: 760, active: 150, after: 950, pose: 'sweepShell', sfx: 'tellHeavy2',
        hit: { kind: 'arc', r: 2.25, half: deg(85) }, damage: 22, trackUntil: 500, turnRate: 3.5, armor: true, dodge: 'away' }],
    },
  ],
};

// ---------------------------------------------------------------- bosses

/** Boss 1 — the gaoler of the drowned. Slow, heavy, honest. Teaches "don't roll too early": his blows step in late. */
export const NETWARDEN: EnemyDef = {
  kind: 'netwarden', name: 'The Netwarden', hp: 880, radius: 1.0, speed: 2.6, sight: 30, flinch: false, boss: true,
  preferDist: 2.6, idleMs: [400, 800], idleMsP2: [250, 600], phase2At: 0.5, staggerMax: 100, mass: 8,
  attacks: [
    {
      id: 'nw.sweep', minRange: 0, maxRange: 3.4, weight: 3, cooldown: 0,
      steps: [{ id: 'nw.sweep', name: 'Hook sweep', windup: 700, active: 150, after: 800, pose: 'sweepR', sfx: 'tellChain',
        hit: { kind: 'arc', r: 3.2, half: deg(75) }, damage: 31, trackUntil: 520, turnRate: 3.2, lunge: { from: 480, to: 760, dist: 1.0 }, armor: true, dodge: 'away' }],
    },
    {
      id: 'nw.slam', minRange: 1.0, maxRange: 4.2, weight: 3, cooldown: 0,
      steps: [{ id: 'nw.slam', name: 'Overhead slam', windup: 1000, active: 130, after: 1150, pose: 'overhead', sfx: 'tellHeavy',
        hit: { kind: 'rect', from: 0, to: 3.8, halfW: 0.75 }, damage: 43, trackUntil: 840, turnRate: 2.6, lunge: { from: 780, to: 1000, dist: 1.7 }, armor: true, dodge: 'side' }],
    },
    {
      id: 'nw.heldslam', minRange: 1.0, maxRange: 4.2, weight: 3, cooldown: 2500, phase: 2,
      steps: [{ id: 'nw.heldslam', name: 'Held slam (delayed)', windup: 1550, active: 130, after: 1150, pose: 'overheadHold', sfx: 'tellGrowl',
        hit: { kind: 'rect', from: 0, to: 3.8, halfW: 0.75 }, damage: 46, trackUntil: 1380, turnRate: 2.4, lunge: { from: 1330, to: 1550, dist: 1.7 }, armor: true, dodge: 'side' }],
    },
    {
      id: 'nw.charge', minRange: 4.0, maxRange: 11, weight: 2, cooldown: 3000,
      steps: [{ id: 'nw.charge', name: 'Shoulder charge', windup: 750, active: 600, after: 950, pose: 'charge', sfx: 'tellStomp',
        hit: { kind: 'circle', r: 1.2, fwd: 0.4 }, damage: 36, trackUntil: 640, turnRate: 3.5, charge: { speed: 13 }, armor: true, knockback: 2, dodge: 'side' }],
    },
    {
      id: 'nw.net', minRange: 5.0, maxRange: 11, weight: 2, cooldown: 4000,
      steps: [{ id: 'nw.net', name: 'Net throw', windup: 650, active: 50, after: 700, pose: 'throw', sfx: 'tellWhirl',
        damage: 10, trackUntil: 560, turnRate: 4, projectile: { speed: 9, r: 0.55, ttl: 1400, root: 700 }, armor: true, dodge: 'side' }],
    },
    {
      id: 'nw.shove', minRange: 0, maxRange: 1.9, weight: 2, cooldown: 3500, antiHug: true,
      steps: [{ id: 'nw.shove', name: 'Stomp shove', windup: 560, active: 120, after: 700, pose: 'stomp', sfx: 'tellStomp2',
        hit: { kind: 'circle', r: 2.3 }, damage: 17, armor: true, knockback: 2.6, dodge: 'through' }],
    },
    {
      id: 'nw.sweep2', minRange: 0, maxRange: 3.4, weight: 2, cooldown: 3000, phase: 2,
      steps: [
        { id: 'nw.sweep2a', name: 'Return sweep (1st)', windup: 700, active: 150, after: 260, pose: 'sweepR', sfx: 'tellChain2',
          hit: { kind: 'arc', r: 3.2, half: deg(75) }, damage: 29, trackUntil: 520, turnRate: 3.2, lunge: { from: 480, to: 760, dist: 1.0 }, armor: true, dodge: 'away' },
        { id: 'nw.sweep2b', name: 'Return sweep (slow 2nd)', windup: 840, active: 150, after: 950, pose: 'sweepL', sfx: 'tellChain',
          hit: { kind: 'arc', r: 3.2, half: deg(75) }, damage: 29, trackUntil: 660, turnRate: 3.2, lunge: { from: 600, to: 860, dist: 1.0 }, armor: true, dodge: 'away' },
      ],
    },
  ],
};

/** Boss 2 — a duelist who sings. Fast, rhythmic, a held note that ends exactly on the strike, a vanishing step. */
export const CANTOR: EnemyDef = {
  kind: 'cantor', name: 'The Pale Cantor', hp: 700, radius: 0.6, speed: 3.4, sight: 30, flinch: false, boss: true,
  preferDist: 2.6, idleMs: [380, 750], idleMsP2: [260, 560], phase2At: 0.55, staggerMax: 90, evadeAfterHits: 4, mass: 3,
  attacks: [
    {
      id: 'ca.lunge', minRange: 2.8, maxRange: 7, weight: 3, cooldown: 1200,
      steps: [{ id: 'ca.lunge', name: 'Needle lunge', windup: 620, active: 300, after: 700, pose: 'thrust', sfx: 'tellNeedle',
        hit: { kind: 'rect', from: 0, to: 1.7, halfW: 0.4 }, damage: 26, trackUntil: 480, turnRate: 4, charge: { speed: 14 }, armor: true, dodge: 'side' }],
    },
    {
      id: 'ca.triple', minRange: 0, maxRange: 2.6, weight: 3, cooldown: 1500,
      steps: [
        { id: 'ca.cut1', name: 'Cantor cut (1st)', windup: 540, active: 110, after: 200, pose: 'sweepR', sfx: 'tellNote1',
          hit: { kind: 'arc', r: 2.2, half: deg(65) }, damage: 19, trackUntil: 380, turnRate: 5, lunge: { from: 360, to: 600, dist: 0.8 }, armor: true, dodge: 'away' },
        { id: 'ca.cut2', name: 'Cantor cut (2nd)', windup: 500, active: 110, after: 200, pose: 'sweepL', sfx: 'tellNote2',
          hit: { kind: 'arc', r: 2.2, half: deg(65) }, damage: 19, trackUntil: 340, turnRate: 5, lunge: { from: 320, to: 560, dist: 0.8 }, armor: true, dodge: 'away' },
        { id: 'ca.cut3', name: 'Cantor cut (late 3rd)', windup: 950, active: 120, after: 850, pose: 'overhead', sfx: 'tellNote3',
          hit: { kind: 'arc', r: 2.4, half: deg(50) }, damage: 24, trackUntil: 780, turnRate: 4, lunge: { from: 700, to: 960, dist: 1.5 }, armor: true, dodge: 'side' },
      ],
    },
    {
      id: 'ca.hymn', minRange: 0, maxRange: 3.4, weight: 2, cooldown: 3500,
      steps: [{ id: 'ca.hymn', name: 'Held hymn (strikes as the note ends)', windup: 1500, active: 120, after: 1000, pose: 'hymn', sfx: 'tellHymn',
        hit: { kind: 'arc', r: 3.0, half: deg(80) }, damage: 36, trackUntil: 1280, turnRate: 3, lunge: { from: 1280, to: 1520, dist: 1.2 }, armor: true, dodge: 'side' }],
    },
    {
      id: 'ca.blink', minRange: 2.0, maxRange: 9, weight: 2, cooldown: 4500,
      steps: [{ id: 'ca.blink', name: 'Vanishing cut', windup: 950, active: 120, after: 750, pose: 'blink', sfx: 'tellBlink',
        hit: { kind: 'arc', r: 2.2, half: deg(70) }, damage: 24, trackUntil: 720, turnRate: 4, blink: { at: 300, dist: 2.3 }, lunge: { from: 760, to: 960, dist: 0.8 }, armor: true, dodge: 'away' }],
    },
    {
      id: 'ca.burst', minRange: 0, maxRange: 2.4, weight: 2, cooldown: 4000, phase: 2, antiHug: true,
      steps: [{ id: 'ca.burst', name: 'Choir burst', windup: 800, active: 150, after: 900, pose: 'burst', sfx: 'tellChoir',
        hit: { kind: 'circle', r: 3.4 }, damage: 29, armor: true, knockback: 1.5, dodge: 'through' }],
    },
    {
      id: 'ca.quad', minRange: 0, maxRange: 2.6, weight: 3, cooldown: 2500, phase: 2,
      steps: [
        { id: 'ca.q1', name: 'Cantor cut (1st)', windup: 540, active: 110, after: 200, pose: 'sweepR', sfx: 'tellNote1',
          hit: { kind: 'arc', r: 2.2, half: deg(65) }, damage: 19, trackUntil: 380, turnRate: 5, lunge: { from: 360, to: 600, dist: 0.8 }, armor: true, dodge: 'away' },
        { id: 'ca.q2', name: 'Cantor cut (2nd)', windup: 500, active: 110, after: 200, pose: 'sweepL', sfx: 'tellNote2',
          hit: { kind: 'arc', r: 2.2, half: deg(65) }, damage: 19, trackUntil: 340, turnRate: 5, lunge: { from: 320, to: 560, dist: 0.8 }, armor: true, dodge: 'away' },
        { id: 'ca.q3', name: 'Cantor cut (quick 3rd)', windup: 540, active: 110, after: 200, pose: 'sweepR', sfx: 'tellNote1',
          hit: { kind: 'arc', r: 2.2, half: deg(65) }, damage: 19, trackUntil: 380, turnRate: 5, lunge: { from: 360, to: 600, dist: 0.8 }, armor: true, dodge: 'away' },
        { id: 'ca.q4', name: 'Cantor cut (late 4th)', windup: 950, active: 120, after: 950, pose: 'overhead', sfx: 'tellNote3',
          hit: { kind: 'arc', r: 2.4, half: deg(50) }, damage: 24, trackUntil: 780, turnRate: 4, lunge: { from: 700, to: 960, dist: 1.5 }, armor: true, dodge: 'side' },
      ],
    },
    {
      id: 'ca.evade', minRange: 0, maxRange: 99, weight: 0, cooldown: 2500, evade: true,
      steps: [{ id: 'ca.evade', name: 'Backstep', windup: 120, active: 0, after: 380, pose: 'evade', sfx: 'tellStep',
        damage: 0, lunge: { from: 0, to: 320, dist: -3.0 }, armor: true, dodge: 'away' }],
    },
  ],
};

/** Boss 3 — the abbess who holds the tide. Huge, slow, owns space. Waves you roll through on rhythm; a dive you read by its shadow. */
export const ABBESS: EnemyDef = {
  kind: 'abbess', name: 'Mother Ebb', hp: 1000, radius: 1.3, speed: 2.0, sight: 40, flinch: false, boss: true,
  preferDist: 3.0, idleMs: [450, 900], idleMsP2: [320, 650], phase2At: 0.5, staggerMax: 120, mass: 12,
  attacks: [
    {
      id: 'ab.wave', minRange: 0, maxRange: 9, weight: 3, cooldown: 2000,
      steps: [{ id: 'ab.wave', name: 'Tide wave', windup: 900, active: 60, after: 800, pose: 'wave', sfx: 'tellWave',
        damage: 29, ring: { speed: 6.5, maxR: 11, width: 0.7 }, armor: true, dodge: 'through' }],
    },
    {
      id: 'ab.triple', minRange: 0, maxRange: 9, weight: 2, cooldown: 5000,
      steps: [
        { id: 'ab.tw1', name: 'Three waves (1st)', windup: 900, active: 60, after: 90, pose: 'wave', sfx: 'tellWave3',
          damage: 24, ring: { speed: 6.5, maxR: 11, width: 0.7 }, armor: true, dodge: 'through' },
        { id: 'ab.tw2', name: 'Three waves (2nd)', windup: 500, active: 60, after: 90, pose: 'wave', sfx: 'tellWaveS',
          damage: 24, ring: { speed: 6.5, maxR: 11, width: 0.7 }, armor: true, dodge: 'through' },
        { id: 'ab.tw3', name: 'Three waves (3rd)', windup: 500, active: 60, after: 1100, pose: 'wave', sfx: 'tellWaveS',
          damage: 24, ring: { speed: 6.5, maxR: 11, width: 0.7 }, armor: true, dodge: 'through' },
      ],
    },
    {
      id: 'ab.claw', minRange: 0, maxRange: 4.0, weight: 3, cooldown: 0,
      steps: [{ id: 'ab.claw', name: 'Reef claw', windup: 850, active: 160, after: 900, pose: 'sweepR', sfx: 'tellCoral',
        hit: { kind: 'arc', r: 3.8, half: deg(100) }, damage: 34, trackUntil: 660, turnRate: 2.6, lunge: { from: 620, to: 860, dist: 1.3 }, armor: true, dodge: 'away' }],
    },
    {
      id: 'ab.dive', minRange: 3.0, maxRange: 12, weight: 2, cooldown: 5000,
      steps: [{ id: 'ab.dive', name: 'Undertow dive', windup: 1900, active: 150, after: 1350, pose: 'dive', sfx: 'tellDive',
        hit: { kind: 'circle', r: 2.6 }, damage: 41, leap: { jumpAt: 500, lockAt: 1300 }, armor: true, dodge: 'away' }],
    },
    {
      id: 'ab.swell', minRange: 0, maxRange: 2.4, weight: 2, cooldown: 3500, antiHug: true,
      steps: [{ id: 'ab.swell', name: 'Swell', windup: 600, active: 130, after: 750, pose: 'burst', sfx: 'tellSwell',
        hit: { kind: 'circle', r: 2.7 }, damage: 19, armor: true, knockback: 3, dodge: 'through' }],
    },
    {
      id: 'ab.divewave', minRange: 3.0, maxRange: 12, weight: 2, cooldown: 6000, phase: 2,
      steps: [
        { id: 'ab.dw1', name: 'Undertow dive', windup: 1900, active: 150, after: 50, pose: 'dive', sfx: 'tellDive2',
          hit: { kind: 'circle', r: 2.6 }, damage: 36, leap: { jumpAt: 500, lockAt: 1300 }, armor: true, dodge: 'away' },
        { id: 'ab.dw2', name: 'Wave after the dive', windup: 500, active: 60, after: 1250, pose: 'wave', sfx: 'tellWaveS',
          damage: 26, ring: { speed: 6.5, maxR: 11, width: 0.7 }, armor: true, dodge: 'through' },
      ],
    },
    {
      id: 'ab.riptide', minRange: 0, maxRange: 4.0, weight: 2, cooldown: 3000, phase: 2,
      steps: [
        { id: 'ab.rt1', name: 'Riptide (1st claw)', windup: 750, active: 160, after: 240, pose: 'sweepR', sfx: 'tellCoral2',
          hit: { kind: 'arc', r: 3.8, half: deg(100) }, damage: 29, trackUntil: 560, turnRate: 2.6, lunge: { from: 520, to: 760, dist: 1.0 }, armor: true, dodge: 'away' },
        { id: 'ab.rt2', name: 'Riptide (late 2nd claw)', windup: 900, active: 160, after: 1000, pose: 'sweepL', sfx: 'tellCoral',
          hit: { kind: 'arc', r: 3.8, half: deg(100) }, damage: 29, trackUntil: 700, turnRate: 2.6, lunge: { from: 660, to: 910, dist: 1.2 }, armor: true, dodge: 'away' },
      ],
    },
  ],
};

export const ENEMY_DEFS: Record<string, EnemyDef> = {
  novice: NOVICE, hook: HOOKBEARER, hound: HOUND, wick: WICK, shell: SHELLBOUND,
  netwarden: NETWARDEN, cantor: CANTOR, abbess: ABBESS,
};

export const BOSS_KINDS = ['netwarden', 'cantor', 'abbess'] as const;
export type BossKind = typeof BOSS_KINDS[number];

export function allSteps(def: EnemyDef): StepDef[] {
  const seen = new Map<string, StepDef>();
  for (const a of def.attacks) for (const s of a.steps) seen.set(s.id, s);
  return [...seen.values()];
}
