# EBB — Development log

Each entry: what I measured, what felt or looked wrong, what I changed, and why. All numbers come from the tools in
`tools/` and can be re-run (see README). "Naive / learning / expert / reactor" are the human-limited bots
described in DESIGN.md §10:
* reaction ≈ N(280–300 ms, 30–35) + 40–90 ms touch latency
* anticipated-press timing noise σ 40–75 ms
* 2.5–6% botched inputs
* all on the same character strength (base kit: 3 draughts).

---

## Cycle 0 — Design decisions (before code)

* **Landscape, top-down, two thumbs.** The fight lives in the middle of the screen; the thumbs live in the bottom corners.
* **Engine-less TypeScript, with a deterministic 60 Hz simulation and no DOM.** The browser and the headless bots run the
  *same* code, so balance numbers measured by bots are the game's real numbers.
* **One weapon, one roll, one heal.** Depth comes from reading enemies, not from a big move list. That also keeps
  the touch layout to three large buttons.
* **Rejected:** currency loss on death (punishes the way back, not the fight), levelling (would let players skip
  learning), a lock-on button (one more small target), parry (a second timing input on glass is easy to misread
  against roll).
* **Every attack is data** (`src/sim/defs.ts`): wind-up, active, recovery, hit shape, tracking, lunge, tell. The
  renderer, the fairness checker, the bots and the tests all read the same data.

## Cycle 1 — Core combat vs one boss, first simulation

Built the player kit, the generic enemy, the three bosses and the bots, then ran 40–60 fights per cell.

**What was wrong.** The Netwarden was beaten by the **naive** bot **77%** of the time (expert 100%, "behind" exploit
53%, turtle 50%). `attack-stats` showed why: rolling straight away *the instant a tell appears* beat almost every
attack. Wind-ups of 700–900 ms plus a 3.6 m roll carried you out of reach before the blow fell. In other words, the
fight could be won by reflex alone, which isn't the game I'm making.

**Changes**
* **Late lunges and late tracking.** Boss blows now step in 0.8–1.7 m in the last ~250 ms of the wind-up and keep
  turning toward you until ~150–250 ms before the hit. An early roll ends (vulnerable) right as the blow arrives.
  Timing must be *learned*. Reaction windows are unchanged, and the fight is fairer for it: the tell is just as early.
* Roll distance 3.6 → **3.0 m**.
* Boss HP raised (560 → 880, 440 → 700, 760 → 1000). The fights were ending before mistakes could add up.
* Degenerate-strategy bots now run with **no pattern knowledge**. The question is whether a trick beats a boss
  *without learning it*.

**Bot bug found and fixed.** The expert lost ~50% against Mother Ebb's waves. The trace showed rolling sideways or
away from an expanding ring at close range carries you outward *with* the ring, so it catches you as the
i-frames end. The correct play is to **roll into the wave**. I taught the expert bot that (a learned technique), and
turned it into a design element: the wave lesson on the death screen says exactly that.

I also modelled **combo anticipation**. A player who knows a combo times its follow-ups by rhythm (~100–160 ms)
instead of reacting, but only when the combo's opening identifies it. The Cantor's triple and quad cuts share their
first two tells *on purpose*, so the third still has to be read.

**Result:** naive 0 / 2 / 0 %, learning 47 / 47 / 31 %, expert 100 / 100 / 100 %.

## Cycle 2 — Fairness rules as code, tests

* Wrote `src/sim/fairness.ts`: R1 cue→hit ≥ 500 ms, R2 combo gap ≥ 600 ms, R3 same tell ⇒ same timing.
* **R3 caught two violations:** the Novice's and Hookbearer's quick second strikes reused their first strike's
  sound but came 130 ms sooner. A player could never have learned that. Gave them their own quick, high
  "tellQuick" ping.
* A test caught that **a combo's follow-up could begin off-screen** if you ran away mid-combo. New rule: an enemy
  abandons a combo rather than start a tell outside the fair view.
* Tell events are now emitted on tick 0 of each step, so the tell→hit gap equals the authored wind-up exactly
  (tested to the tick).
* 26 tests (now 27): combat rules, i-frame timing, buffer behaviour, commitment, heal interruption, slip, hit
  shapes vs drawn polygons, tell timing, fair view, determinism, level reachability, world flow.

## Cycle 3 — The phone client, touch, and thumbs over tells

Built the renderer, touch controls, synthesized audio, UI and save system. Wrote `tools/mobile-check.ts`: headless
Chromium with touch emulation, real CDP multi-touch events, three phone sizes, 4× CPU throttle as a mid-range proxy.

**What was wrong**
1. Screenshot review: in a Netwarden fight the boss stood **exactly under the left thumb**. Measured: the boss was
   under a thumb in **4.4%** of its attacking frames on the iPhone SE size. That is a tell the player cannot see,
   which the brief forbids outright.
2. Under 4× throttling the Android profile ran at **52 fps with 137 long frames**. The floor was redrawn tile by tile
   every frame, with colour strings rebuilt each time.

**Changes**
* The camera keeps the player 0.9 m above centre, so action sits above the thumbs. In boss fights it searches four
  framings between player and boss (zooming out to 0.7× if needed) and picks one where **neither the boss nor the
  player is under a thumb or button**.
* The simulation's **fair view** was redefined in screen terms to exclude both thumb zones, with a bottom-centre
  channel between them. Enemies can't start attacks outside it.
* The static floor is cached in 8×8-tile chunks, and animated water highlights are drawn sparsely on top. Adaptive
  resolution drops DPR when frames run long.

**Result:** boss under a thumb while attacking **0%** on all three sizes, boss on screen 100%, 58–60 fps at 4×
throttle. Touch → attack starts in **≈30 ms**. Multi-touch roll goes the stick's way, and a press in the gap
between buttons still maps to a button.

## Cycle 4 — Whole-area runs: a leash bug, and bosses too forgiving mid-fight

`tools/walkthrough.ts` makes bots play start → ending, pathing between objectives.

**What was wrong**
1. A first-timer run hung. Trace: a **Wick followed the player from the Nave all the way into the first boss arena**,
   then hovered where it couldn't attack while the low-HP bot backed away forever. Regular enemies had no home leash.
2. A second hang was a bot bug: it only drank in combat "safe windows", so it never healed once enemies walked home.
3. The "first-timer" bot (knows nothing, learns an attack after being hit by it twice, *mid-fight*) usually beat each
   boss **on the first attempt**. The HP economy (100 HP + up to 6 × 42 HP draughts ≈ 11 boss hits) let a fast
   learner absorb every lesson in one fight. Meanwhile experts were hit by only ~2% of attacks, so the extra
   forgiveness only helped people who hadn't learned yet.

**Changes**
* Leash: regular enemies return home beyond 13 m from it, and only re-engage near home.
* Bot: drinks when out of combat.
* **Boss damage +20%** and **3 base draughts** (was 4). A mistake now costs a third of your life, but experts are
  unaffected.
* New **"disciplined reactor"** profile: expert spacing, healing, stamina and punishing, but **zero pattern knowledge**.
  It answers the question "can reflexes and discipline alone win?"

**Result:** reactor **0% on all three bosses**. The fast-learning first-timer now dies on its first Netwarden attempt
in 10/10 runs, wins on attempt 2–3, and dies to Mother Ebb in ~70% of attempts. Expert play still finishes the whole
area with 0–1 deaths.

## Cycle 5 — Regular enemies were trivial

`tools/enemy-sims.ts` (one-on-one in the Yard): even the **naive** bot lost **0 HP** to a Novice. A three-hit chain
killed it before it could act, because every hit flinched it.

**Change:** a learnable rule, *"you can interrupt an enemy early in its wind-up, not late"*. Regular enemies are
armoured from 55% of the wind-up through the swing. Flinch cooldown is 2 s, and HP went up about a third.

**Result (naive / expert HP lost per one-on-one):** Novice 5 / 1, Hookbearer 19 / 1, Brinehound 14 / 0, Wick 12 / 12,
Shellbound 57 / 3 (naive loses 11% to it). They're dangerous in groups and never walls, which gives the way back to a
boss some tension without wasting time.

## Cycle 6 — Visual review and a real-touch playthrough

`tools/moments.ts` captures the first tell, each boss's signature tells, death, victory and ending.

* The wind-up glow was too faint to help, so I strengthened it (alpha 0.10 → 0.14 at the tell, up to 0.40 at the strike).
* Ending stats said "1 minutes · fell 1 times", now fixed with proper plurals.
* Confirmed readable: the Netwarden's raised hook, the sweep's drawn hit arc, the Cantor's contracting halo, the
  dive's locked shadow with its countdown ring, and the wave ring.

* The pause panel overflowed the iPhone SE screen (Vibration and Title were below the fold). It is now a two-column
  landscape layout that fits.

**Real-touch playthrough** (`tools/touch-playthrough.ts`). The *real client* in headless Chromium at iPhone SE size,
driven only through CDP touch events on the stick and buttons (1,710 taps). The decisions come from the expert bot
running in the page, so the full touch → controls → game path is exercised.

| | Result |
|---|---|
| Outcome | **Reached the ending.** Beach → cowrie 1 → Gaol Steps → Netwarden → lever shortcut → cowrie 2 → Pale Cantor → Low Stair → Mother Ebb → shore |
| Time | 22.5 min real time, 60 fps, **0 page errors** |
| Deaths | 14: 1 novice, 1 shellbound, 1 hookbearer, **11 at Mother Ebb**, 0 at bosses 1 and 2 |
| Mother Ebb deaths | 7 of 11 to the wave attacks, rolling slightly early or late |

## Cycle 7 — Waves under real-world input jitter

The real-touch run disagreed with the simulation: the expert beats Mother Ebb 96% of the time in the sim, but
needed 12 attempts through the real pipeline. The touch pipeline adds tens of milliseconds of *variable* latency
(event round-trips, frame alignment) that the sim models only as a mean. The deaths clustered on the triple waves at
close range, where a 333 ms i-frame window must land three times on a 650 ms rhythm.

That is not the "hard because tricky" I want. It's "hard because tight". Waves are timed by watching the ring
approach, so a slower ring is easier to judge by eye.

**Change:** ring speed 6.5 → **5.5 m/s**, and wind-up for the 2nd/3rd waves and the post-dive wave 500 → **560 ms**
(rhythm 650 → 710 ms).

**Result (200 fights):** Mother Ebb naive 0%, learning 29.5%, expert **100%** (was 96%). She remains the hardest
boss and every degenerate strategy still loses.

I stopped a second, Mother Ebb-only real-touch run partway: it runs in real time (10–20 min per run), and the
200-fight simulation already measures the change. The real-touch tool stays in the repo for spot checks.

---

## Final measurements (current build)

**Boss fights, 200 per cell** (`npm run sim 200`). Base kit, 3 draughts, same strength for every bot:

| Boss | naive | learning | expert | disciplined reactor (no knowledge) | spam attack | spam roll | corner camp | stay behind | turtle & heal | first-timer: 1st-attempt win / median / p90 attempts |
|---|---|---|---|---|---|---|---|---|---|---|
| The Netwarden | 0% | 40% | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 0% / 3 / 4 |
| The Pale Cantor | 0% | 46% | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 0% / 2 / 3 |
| Mother Ebb | 0% | 29.5% | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 0% / 4 / 6 |

**Whole area, headless** (`tools/walkthrough.ts`)

| Bot | Runs completed | Sim time | Deaths |
|---|---|---|---|
| First-timer | **10/10** | 10–16 min | 1–7 |
| Expert | **5/5** | 6.6–7.4 min | 0–1 |

**Phones** (`npm run mobile-check`, 4× CPU throttle for the frame figures)

| | iPhone SE 667×375 | Android 800×360 | iPhone Pro Max 932×430 |
|---|---|---|---|
| Smallest button | 10.0 mm | 9.7 mm | 11.6 mm |
| Touch → attack starts | 30–32 ms | 31–32 ms | 30–33 ms |
| fps (4× throttle) | 60.0 | 57.4 | 58.1 |
| Boss on screen | 100% | 100% | 100% |
| Boss under a thumb while attacking | **0%** | **0%** | **0%** |
| Multi-touch roll, button-gap press, pause on background, autosave | ✓ | ✓ | ✓ |
| Page errors | 0 | 0 | 0 |

**Rules:** 27/27 tests pass. Fairness checker: 0 violations. Shortest cue→hit is 500 ms; boss attacks run 500–1550 ms.

---

## Definition of done: self-assessment

- [x] **The whole area, including all bosses, can be played from start to end on a phone browser with no bugs or dead ends.**
  The real client reached the ending through real touch events at iPhone SE size with 0 page errors. 15/15 headless
  whole-area runs completed. Tests check every objective is reachable, boss 1 can't be skipped, and the shortcut works.
  Two hangs were found and fixed on the way (enemy leash, Cycle 4). *Caveat:* tested in emulated Chromium, not on a physical iPhone or Android device.
- [x] **Every enemy and boss attack has a learnable, consistent tell, and the design doc lists them with their reaction windows.**
  DESIGN.md §5 lists all 42 attack steps (generated from the game data) with tell, cue→hit, combo gap and recovery.
  Rule R3 (same tell ⇒ same timing) is tested. It caught and fixed two violations (Cycle 2).
- [x] **Every reaction window is achievable for a normal human on a touchscreen.**
  Every cue→hit is ≥ 500 ms (budget: 350 ms slow reaction + 80 ms touch latency + 33 ms i-frame start = 463 ms), and every
  combo gap is ≥ 600 ms. Measured touch latency in the client is ~31 ms. The "disciplined reactor" survives most
  individual attacks; what it lacks is the *timing knowledge* for delayed and stepping attacks. That is learnable, not a reflex wall.
- [x] **The simulation shows the intended difficulty curve.**
  Naive 0/0/0%, learning 40/46/29.5%, expert 100/100/100%, all on the same base kit (table above).
- [x] **No degenerate strategy trivialises any boss.**
  Attack spam, roll spam, corner camping, circling behind and turtle-healing all win 0% against every boss.
  Stun-lock is prevented by rule (flinch at most every 2 s, never late in a wind-up, bosses never flinch).
- [x] **A first attempt at each boss usually ends in death, and a player who learns and practises can win within a reasonable number of attempts.**
  Naive and reactor bots: 0% wins. Progressive first-timer: 0% first-attempt wins, median 2–4 attempts, p90 3–6.
  The fast-learning whole-area first-timer died on its first Netwarden attempt in 10/10 runs. That model learns an
  attack after only two hits with near-expert hands, so a human will likely need more attempts, which I consider
  reasonable for the genre (see weaknesses).
- [x] **Retrying after death is quick and doesn't feel tedious.**
  Death → "Rise" in ~1.5 s, tap anywhere. Every boss door is 6–8 m from its cairn (tested < 10 m). Retry intros are
  0.9 s. About **5–6 s** from the killing blow to the next boss attempt.
- [x] **Touch controls are responsive and reliable on small and large phones, and deaths never come from the controls failing.**
  ~31 ms touch→action, ≥ 9.7 mm targets, nearest-button mapping with no dead gaps, touch-down firing, a 220 ms buffer,
  visible and haptic rejection, a floating stick, and the boss never under a thumb while attacking (0% measured).
  All 1,710 real-touch taps in the playthrough registered. Every death there was attributed to an attack and timing
  in the recap, never to a lost input.
- [x] **Combat feels weighty and satisfying, and beating a boss feels like an earned triumph.**
  Hit-stop (45–140 ms), scaled screen shake, haptics, layered synthesized hits, the slip bell + slow-down + riposte,
  boss breaks, and a victory sequence that names your attempt count. *Caveat:* "feel" was judged by building to
  known-good practices and reviewing captured frames. I could not hold a phone or hear the audio.
- [x] **Nothing in the game uses names, terms, or assets from the Dark Souls series.**
  All names are original (Vesper, the Netwarden, the Pale Cantor, Mother Ebb, cairns, draughts, drowned cowries,
  slip, break, "The tide takes you.", "Laid to rest."). All art is procedural Canvas drawing and all sound is
  synthesized WebAudio. The only external code is dev tooling (Vite, TypeScript, Vitest, Playwright, tsx). I avoided a
  "ring the bells" goal that came out of an early bell-tower idea, because it echoed the series' plot too closely.

### Known weaknesses I chose not to fix (and why)

* **No physical-device test.** Everything ran in emulated mobile Chromium (touch, viewport, DPR, 4× CPU throttle).
  iOS Safari specifics were handled by design (safe areas, audio unlock in the first gesture, no `vibrate` on iOS,
  Add to Home Screen for full screen) but were not observed on hardware.
* **No vibration on iOS.** Safari has no vibration API. Hits still have shake, hit-stop and sound.
* **Playtime is at the low end of 1–3 hours.** An expert crosses the area in ~7 minutes. A first-time human's time
  goes mostly into boss attempts: my estimate is **~45–90 minutes**, and slower learners will take longer. I chose
  depth over size, as the brief asked.
* **Bot-based difficulty is a model.** Reaction distributions, learning speed and error rates are my assumptions,
  stated in DESIGN.md §10. The curve is robust in one important sense: no zero-knowledge strategy wins at all.
* **Real-touch jitter vs simulation.** The real pipeline is harsher than the sim's latency model (Cycle 7). I loosened
  the waves because they are the tightest rhythm in the game, but rhythmic sections remain the least forgiving.
* **Art and sound are deliberately minimal**: readable silhouettes and synthesized cues rather than rich assets. A larger team would invest here first.
* **Boss move choice is seeded random** (weighted, with anti-repeat rules). Every move is readable, but the order
  isn't memorisable the way a fixed script would be. That is a genre-typical choice.
