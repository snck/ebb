# EBB: the drowned abbey of Vesper

A short, **hard but fair** action game for phone browsers. One area, five kinds of enemies, three bosses.
You will die. Every death tells you what hit you and what you were doing. Learn it, and you will win with
exactly the strength you had on your first try.

* Mobile web: iOS Safari and Android Chrome, **landscape**, two thumbs. Installable to the home screen and plays offline.
* No backend, no accounts, and no network calls once loaded. Progress saves automatically on the device.
* Everything (art, sound, story, names) is original and procedural. There are no asset files.

## Run it

```bash
npm install
npm run dev
```

Vite prints two URLs:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

### Play on your phone (same Wi-Fi)

1. Connect the phone to the **same Wi-Fi network** as the computer.
2. On the phone, open the **Network** URL that `npm run dev` printed (e.g. `http://192.168.1.23:5173/`).
   * Nothing printed under Network? Find the computer's LAN IP (macOS: `ipconfig getifaddr en0`; Windows:
     `ipconfig`; Linux: `hostname -I`) and open `http://<that-ip>:5173/`.
   * Doesn't load? Allow Node through the computer's firewall, or check the Wi-Fi isn't a "guest" network that isolates devices.
3. Turn the phone **sideways** and tap **Begin**. Turn the sound on, because the attacks have sounds.
4. Optional, for a full-screen app with no browser bars:
   * **iOS Safari**: Share → *Add to Home Screen*, then launch *Ebb* from the home screen.
   * **Android Chrome**: ⋮ → *Add to Home screen* / *Install app*. In the browser it also goes full screen on the first tap.

For the most faithful timing (production build, offline caching enabled):

```bash
npm run build
npm run preview        # then open the Network URL it prints, port 4173
```

The service worker only runs in the production build. Over plain `http://` on a LAN IP, browsers may not
register it. The game works the same either way, it just won't be available offline until it's served over
HTTPS or from `localhost`.

## How to play

| | Touch | Keyboard (desktop testing) |
|---|---|---|
| Move | Left thumb: touch anywhere on the left side and drag (the stick appears under your thumb) | WASD / arrows |
| **Roll** | Big right button. Rolls the way you're pushing, or backwards with no direction | K / Shift |
| Attack | Button left of Roll. Tap up to 3 times for a chain | J / Space |
| Drink (heal) | Small button above Roll. The number is how many draughts are left | L / H |
| Pause & settings | ❚❚ top right (button size, left-handed layout, sound, vibration) | Esc / P |

**The rules, once:**

* A **white glint** means an attack has started. The pose and the sound tell you *which* attack, and so *when* it lands.
* Your roll makes you untouchable for a third of a second. If an attack touches you then, you **slip** it:
  you hear a bell, get stamina back, and your next strike within a second is a heavy **riposte**.
* Many blows **step in late**. Rolling the instant you see the tell often means your roll ends just as the blow
  lands. Wait for it.
* Attacks commit you for 0.4 s. Drinking takes 0.7 s to work and is wasted if you're hit first. Bosses don't flinch.
* Every hit fills a boss's stagger line (gold, under its health bar). Fill it and the boss kneels. Strike then.
* **Cairns** (stone stacks with a pale flame) heal you, refill your draughts and become your return point. Dying
  sends you back to the last one you touched. Regular enemies return, but bosses you've beaten and gates you've opened stay.
* Two **drowned cowries** are hidden off the main path. Each lets your gourd hold one more draught.
* Short on time? Just close the app. It pauses and saves. Every boss door is a few steps from a cairn.

## Project layout

```
src/sim/      deterministic 60 Hz simulation (no DOM): player, enemies, bosses, level, fairness rules
src/game/     browser client: renderer (Canvas 2D), touch controls, WebAudio synth, UI, save
tests/        vitest: combat rules, hit detection, tell timing, fair view, level integrity, world flow
tools/        bots and checks (see below)
DESIGN.md     the design: controls, combat rules, every attack with its tell and reaction window
DEVLOG.md     iteration history, measurements, and the final self-assessment
```

## Testing and tools

```bash
npm test                                   # 27 unit/integration tests
npm run fairness                           # every attack's tell→hit window + fairness rule check
npm run sim [fights=200] [boss]            # bot boss fights: naive / learning / expert / reactor / degenerate / first-timer
npx tsx tools/attack-stats.ts cantor naive # per-attack outcomes for one bot type
npx tsx tools/enemy-sims.ts                # regular enemies one-on-one
npx tsx tools/walkthrough.ts learning 10   # bots play the whole area start → ending (headless)
# these need `npm run dev` running:
npm run mobile-check                       # 3 phone sizes: layout, touch, latency, frame timing, thumbs vs boss
npx tsx tools/touch-playthrough.ts         # the real client played to the end through real touch events
npx tsx tools/moments.ts                   # screenshots of key moments for visual review
```

Debug: append `?fps` to the URL to show the frame rate.
