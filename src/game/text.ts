import type { DeathCause } from '../sim/types';

/** All player-facing words live here: the game is mostly wordless, and every word is original. */
export const BOSS_SUB: Record<string, string> = {
  netwarden: 'Keeper of the Gaol',
  cantor: 'Who Sings the Hours',
  abbess: 'Who Holds the Tide',
};

/** Shown on the death screen after the same attack has killed you twice. One quiet sentence, never a tutorial. */
export const LESSONS: Record<string, string> = {
  'novice.claw': 'Novices lunge as they claw. Roll as the arm comes down, not when it rises.',
  'novice.double1': 'The first claw has a twin. Expect it.',
  'novice.double2': 'The second claw comes quickly after the first.',
  'hook.thrust': 'A thrust is narrow. Roll to the side, not away.',
  'hook.double1': 'Two thrusts. The second is quicker.',
  'hook.double2': 'Two thrusts. The second is quicker.',
  'hook.sweep': 'Up close, the haft sweeps wide.',
  'hound.pounce': 'A hound leaps along a straight line. Step off it.',
  'hound.bite': 'Hounds bite when you stand too close.',
  'wick.ember': 'Embers fly straight. Roll across their path.',
  'shell.slam': 'A shell is weakest after it strikes. Strike it then, or from behind.',
  'shell.sweep': 'It sweeps wide when you circle it closely.',
  'nw.sweep': 'The hook reaches far and he steps into it. Roll as it swings, not as he draws back.',
  'nw.slam': 'He steps in as the hook falls. Roll late, and to the side.',
  'nw.heldslam': 'When he growls with the hook held high, wait. The blow falls as the growl ends.',
  'nw.charge': 'He charges where you stood. Roll sideways as he lowers his shoulder.',
  'nw.net': 'The net flies straight. Roll across it.',
  'nw.shove': 'He stomps when you stay against him. Roll through it, or keep a step away.',
  'nw.sweep2a': 'After the first sweep he returns it, more slowly.',
  'nw.sweep2b': 'The return sweep is slower than the first. Wait for it.',
  'ca.lunge': 'Her lunge is long and straight. Roll to the side.',
  'ca.cut1': 'Her cuts come in a rhythm. Learn it.',
  'ca.cut2': 'Her cuts come in a rhythm. Learn it.',
  'ca.cut3': 'The last cut is late. Do not roll on the beat.',
  'ca.q1': 'Sometimes there are four cuts.',
  'ca.q2': 'Sometimes there are four cuts.',
  'ca.q3': 'Sometimes there are four cuts.',
  'ca.q4': 'The last cut is late. Do not roll on the beat.',
  'ca.hymn': 'She strikes the moment the note ends. Listen.',
  'ca.blink': 'When she vanishes, wait for her to return. Then roll.',
  'ca.burst': 'When light gathers around her, roll through it or be elsewhere.',
  'ab.wave': 'Roll into the wave as it reaches you. Rolling away only lets it catch you.',
  'ab.tw1': 'Three waves. Roll into each.',
  'ab.tw2': 'Three waves, one after another. Keep the rhythm.',
  'ab.tw3': 'Three waves, one after another. Keep the rhythm.',
  'ab.claw': 'Her claw reaches far and comes late.',
  'ab.dive': 'Her shadow follows you, then stops. Roll when it stops.',
  'ab.dw1': 'Her shadow follows you, then stops. Roll when it stops.',
  'ab.dw2': 'She rises with a wave. Be ready to roll into it.',
  'ab.swell': 'She pushes away those who stay too close.',
  'ab.rt1': 'Two claws. The second comes late.',
  'ab.rt2': 'The second claw comes late. Wait for it.',
};

export function deathReason(c: DeathCause): string {
  switch (c.doing) {
    case 'attacking': return 'You were mid-swing.';
    case 'healing': return 'You were drinking.';
    case 'stunned': return 'You were still reeling from the last blow.';
    case 'rolling-late': return 'Your roll came a moment too late.';
    case 'rolling-early': {
      const s = (c.rollEndedBeforeMs ?? 0) / 1000;
      return s > 0.02 ? `Your roll ended ${s.toFixed(2)} s before the blow. Too early.` : 'Your roll ended just before the blow.';
    }
    case 'recovering': return 'You were still recovering.';
    default: return 'You did not roll.';
  }
}

export const NOTES_TITLE = 'EBB';
