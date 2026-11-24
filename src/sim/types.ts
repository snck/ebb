import type { StepDef } from './defs';

/** One tick of player intent. `attack`/`dodge`/`heal` are edge-triggered presses. */
export interface Input {
  mx: number; // stick -1..1
  my: number;
  attack: boolean;
  dodge: boolean;
  heal: boolean;
}
export const NO_INPUT: Input = { mx: 0, my: 0, attack: false, dodge: false, heal: false };

export type Action = 'attack' | 'dodge' | 'heal';

export interface DeathCause {
  source: string; // enemy name
  attack: string; // step name
  /** what the player was doing when the killing blow landed */
  doing: 'attacking' | 'healing' | 'rolling-late' | 'rolling-early' | 'recovering' | 'stunned' | 'idle';
  /** ms between the end of the last roll's invulnerability and the hit (positive: roll ended before the hit) */
  rollEndedBeforeMs?: number;
  /** ms between the hit and when a roll would have been needed (for late rolls) */
  rollStartedAfterMs?: number;
  stepId?: string;
}

export type GameEvent =
  | { t: 'tell'; uid: number; step: StepDef; boss: boolean; x: number; y: number }
  | { t: 'active'; uid: number; step: StepDef; x: number; y: number }
  | { t: 'playerHit'; dmg: number; source: string; step?: StepDef; x: number; y: number; killed: boolean }
  | { t: 'enemyHit'; uid: number; dmg: number; x: number; y: number; riposte: boolean; guarded: boolean; killed: boolean; boss: boolean; broke: boolean }
  | { t: 'slip'; x: number; y: number }
  | { t: 'swing'; combo: number; riposte: boolean }
  | { t: 'roll' }
  | { t: 'healStart' } | { t: 'healDone'; amount: number } | { t: 'healLost' }
  | { t: 'reject'; action: Action; reason: 'stamina' | 'empty' }
  | { t: 'enemyDie'; uid: number; kind: string; x: number; y: number }
  | { t: 'bossStart'; boss: string; kind: string; first: boolean }
  | { t: 'bossPhase'; uid: number }
  | { t: 'bossBroken'; uid: number }
  | { t: 'bossDefeated'; boss: string; kind: string }
  | { t: 'rest'; cairn: string; name: string }
  | { t: 'item'; id: string; kind: string }
  | { t: 'note'; id: string; text: string }
  | { t: 'gate'; id: string; open: boolean }
  | { t: 'lever'; id: string }
  | { t: 'playerDeath'; cause: DeathCause }
  | { t: 'ending' }
  | { t: 'ring'; x: number; y: number }
  | { t: 'projectile'; x: number; y: number }
  | { t: 'land'; uid: number; x: number; y: number }
  | { t: 'blink'; uid: number; fromX: number; fromY: number; x: number; y: number }
  | { t: 'charge'; uid: number }
  | { t: 'footstep'; heavy: boolean };
