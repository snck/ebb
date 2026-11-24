import { World } from '../sim/world';
import { TICK_MS, PLAYER } from '../sim/constants';
import type { GameEvent } from '../sim/types';
import { Controls } from './input';
import { Renderer, HudState } from './render';
import { Audio } from './audio';
import { SaveData, loadSave, writeSave, freshSave, clearSave } from './save';
import { BOSS_SUB, LESSONS, deathReason } from './text';

type Screen = 'title' | 'play' | 'pause' | 'dead' | 'ending' | 'rotate';

export class App {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  world!: World;
  save: SaveData;
  controls: Controls;
  renderer: Renderer;
  audio = new Audio();
  screen: Screen = 'title';
  private prevScreen: Screen = 'title';
  private last = performance.now();
  private acc = 0;
  private hitstop = 0; // real ms
  private slow: { scale: number; ms: number } | null = null;
  private dprCap = 2;
  private frameTimes: number[] = [];
  private deathTimer = 0;
  private startPos = { x: 0, y: 0 };
  private saveTimer = 0;
  private endingTimer = -1;
  fps = 60;
  stats = { frames: 0, longFrames: 0, worstMs: 0 };
  hud: HudState = {
    hpShown: 100, hpLag: 100, stamShown: 100, bossLag: 0, noteText: null, noteAlpha: 0, bossCard: null,
    tutorial: { stick: false, attack: false, dodge: false, heal: false }, flashRed: 0, flashWhite: 0, lowHp: 0, centerText: null, dodgeCue: null,
  };

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector('canvas')!;
    this.ui = root.querySelector('#ui')!;
    this.save = loadSave() ?? freshSave();
    this.controls = new Controls(this.canvas, this.save.settings);
    this.controls.onPause = () => { if (this.screen === 'play') this.openPause(); };
    this.controls.onAnyTouch = () => this.audio.unlock();
    this.renderer = new Renderer(this.canvas);
    this.newWorld();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.persist(); this.audio.suspend(); if (this.screen === 'play') this.openPause(); }
      else if (this.screen !== 'play') this.audio.resume(); else this.audio.resume();
    });
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    this.resize();
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
    (window as any).__game = this;
  }

  private newWorld() {
    this.world = new World({ seed: (Date.now() & 0xffff) + 1, progress: this.save.progress });
    this.renderer.cam.x = this.world.player.x; this.renderer.cam.y = this.world.player.y + 0.9;
    this.startPos = { x: this.world.player.x, y: this.world.player.y };
    this.audio.stopBoss();
  }

  persist() { this.save.progress = this.world.progress; writeSave(this.save); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const safe = {
      l: parseFloat(cs.getPropertyValue('--sal')) || 0, r: parseFloat(cs.getPropertyValue('--sar')) || 0,
      t: parseFloat(cs.getPropertyValue('--sat')) || 0, b: parseFloat(cs.getPropertyValue('--sab')) || 0,
    };
    (window as any).__safe = safe;
    this.renderer.resize(w, h, this.dprCap);
    this.controls.layout(w, h, safe);
    const portrait = h > w * 1.05;
    if (portrait && this.screen !== 'rotate') { this.prevScreen = this.screen === 'play' ? 'pause' : this.screen; if (this.screen === 'play') this.openPause(); this.setScreen('rotate'); }
    else if (!portrait && this.screen === 'rotate') { this.setScreen(this.prevScreen); if (this.prevScreen === 'pause') this.openPause(); if (this.prevScreen === 'title') this.showTitle(); }
  }

  // ====================================================================== loop
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = now - this.last;
    this.last = now;
    const dt = Math.min(100, rawDt);
    this.trackPerf(rawDt);
    if (this.screen === 'play' || this.screen === 'dead') {
      if (this.hitstop > 0) this.hitstop -= dt;
      else {
        let scale = 1;
        if (this.slow) { scale = this.slow.scale; this.slow.ms -= dt; if (this.slow.ms <= 0) this.slow = null; }
        this.acc += dt * scale;
        let steps = 0;
        while (this.acc >= TICK_MS && steps < 6) {
          this.renderer.snapshot(this.world);
          this.world.step(this.screen === 'play' ? this.controls.sample() : { mx: 0, my: 0, attack: false, dodge: false, heal: false });
          this.handleEvents(this.world.events);
          this.acc -= TICK_MS; steps++;
        }
        if (steps >= 6) this.acc = 0;
      }
      this.updateHud(dt);
      if (this.screen === 'dead') { this.deathTimer += dt; if (this.deathTimer > 1500 && !this.ui.querySelector('#death')) this.showDeath(); }
      if (this.endingTimer >= 0) { this.endingTimer += dt; if (this.endingTimer > 2600) { this.endingTimer = -1; this.showEnding(); } }
      this.saveTimer += dt;
      if (this.saveTimer > 10000) { this.saveTimer = 0; this.persist(); }
    }
    const alpha = Math.min(1, this.acc / TICK_MS);
    const showHud = this.screen === 'play' || this.screen === 'pause';
    this.renderer.draw(this.world, alpha, dt / 1000, this.screen === 'play' || this.screen === 'pause' ? this.controls : null, this.hud, showHud);
    if ((window as any).__debugFps) {
      const ctx = this.renderer.ctx; ctx.fillStyle = '#0f0'; ctx.font = '12px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`${this.fps.toFixed(0)} fps  dpr ${this.renderer.dpr}`, 10, this.renderer.h - 8);
    }
  }

  private trackPerf(ms: number) {
    this.stats.frames++;
    if (ms > 25) this.stats.longFrames++;
    this.stats.worstMs = Math.max(this.stats.worstMs, ms);
    this.frameTimes.push(ms);
    if (this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.fps = 1000 / avg;
      // adaptive resolution: keep timing smooth on slower phones (smooth timing matters for fairness)
      if (avg > 21 && this.dprCap > 1.25 && this.screen === 'play') { this.dprCap = this.dprCap > 1.6 ? 1.5 : 1.25; this.resize(); }
      this.frameTimes = [];
    }
  }

  private updateHud(dt: number) {
    const w = this.world, p = w.player, t = this.save.tut;
    if (!t.moved && Math.hypot(p.x - this.startPos.x, p.y - this.startPos.y) > 3) { t.moved = true; }
    this.hud.tutorial.stick = !t.moved;
    const near = w.enemies.some((e) => e.alive() && e.aggro && !e.boss && Math.hypot(e.x - p.x, e.y - p.y) < 4.5);
    this.hud.tutorial.attack = !t.attacked && near;
    this.hud.tutorial.dodge = !t.dodged && !!this.hud.dodgeCue;
    this.hud.tutorial.heal = !t.healed && p.hp < 65 && p.draughts > 0 && p.alive;
    this.hud.lowHp = p.alive && p.hp < 30 ? 1 : 0;
    if (this.hud.noteAlpha > 0) this.hud.noteAlpha -= dt / 6000;
  }

  // ====================================================================== events → feel
  private pan(x: number) { return Math.max(-1, Math.min(1, (x - this.world.player.x) / 8)); }
  private vibrate(p: number | number[]) { if (this.save.settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch { /* */ } }

  private handleEvents(evs: GameEvent[]) {
    const r = this.renderer, a = this.audio, w = this.world;
    for (const e of evs) {
      switch (e.t) {
        case 'tell': {
          r.tellFlash.set(e.uid, performance.now());
          a.tell(e.step.sfx, e.step.windup, this.pan(e.x), e.boss);
          if (!this.save.tut.slowmoShown && (e.step.hit || e.step.projectile)) {
            // first tell ever: a moment of slow motion teaches "this glint means: get ready to roll"
            this.save.tut.slowmoShown = true;
            this.slow = { scale: 0.3, ms: e.step.windup / 0.3 * 0.8 };
            this.hud.dodgeCue = { uid: e.uid, t: 0 };
          }
          break;
        }
        case 'active': a.strike(this.pan(e.x), !!w.enemies.find((x) => x.uid === e.uid)?.boss); break;
        case 'playerHit':
          r.addShake(e.dmg > 25 ? 0.7 : 0.45); this.hud.flashRed = e.killed ? 1 : 0.7;
          a.playerHit(); this.vibrate(e.killed ? 0 : 45);
          r.burst(e.x, e.y, 14, '#b04030', 5, 'spark', 0.45, 0.09);
          this.hitstop = Math.max(this.hitstop, 85);
          break;
        case 'enemyHit':
          r.burst(e.x, e.y, e.riposte ? 22 : 10, e.guarded ? '#bbbbbb' : e.riposte ? '#bff0ff' : '#e8e0d0', e.riposte ? 7 : 4.5, 'spark', 0.35, 0.07);
          r.addShake(e.riposte ? 0.35 : e.boss ? 0.18 : 0.14);
          a.enemyHit(this.pan(e.x), e.boss, e.guarded);
          this.vibrate(e.riposte ? 30 : 12);
          this.hitstop = Math.max(this.hitstop, e.riposte ? 110 : e.killed ? 90 : 45);
          if (!this.save.tut.attacked) this.save.tut.attacked = true;
          break;
        case 'slip':
          r.ringFx(e.x, e.y, 'rgba(170,235,255,0.9)', 0.4, 0.4, 5);
          r.burst(e.x, e.y, 10, '#bfefff', 3, 'mote', 0.5, 0.05);
          a.slip(); this.vibrate([8, 30, 8]);
          if (!this.slow) this.slow = { scale: 0.45, ms: 160 };
          this.save.tut.dodged = true; this.hud.dodgeCue = null;
          break;
        case 'swing': a.swing(e.combo, e.riposte); break;
        case 'roll':
          a.roll(); r.burst(w.player.x, w.player.y + 0.2, 5, 'rgba(160,160,150,0.5)', 1.5, 'dust', 0.4, 0.08);
          if (this.hud.dodgeCue && w.player.stats.rolls >= 3) { this.save.tut.dodged = true; this.hud.dodgeCue = null; }
          break;
        case 'healStart': a.heal(); this.save.tut.healed = true; break;
        case 'healDone': a.healDone(); r.burst(w.player.x, w.player.y, 14, '#9fe8c8', 1.5, 'mote', 0.8, 0.06); break;
        case 'healLost': r.burst(w.player.x, w.player.y, 6, '#5a8a78', 2, 'drop', 0.4, 0.05); break;
        case 'reject': this.controls.rejectedAt[e.action] = performance.now(); a.reject(); this.vibrate(10); break;
        case 'enemyDie': r.burst(e.x, e.y, 18, '#bfe8f0', 3, 'mote', 0.9, 0.07); break;
        case 'bossStart': {
          const b = w.fight!.boss;
          a.startBoss(e.kind);
          this.hud.bossCard = { name: b.def.name, sub: BOSS_SUB[e.kind] ?? '', t: e.first ? 0 : 1.2 };
          this.persist();
          break;
        }
        case 'bossPhase': a.bossPhase(); a.bossIntense(); r.addShake(0.6); { const b = w.enemies.find((x) => x.uid === e.uid)!; r.ringFx(b.x, b.y, 'rgba(255,240,220,0.8)', 0.8, 1, 8); } break;
        case 'bossBroken': a.bossBroken(); this.vibrate(60); { const b = w.enemies.find((x) => x.uid === e.uid)!; r.ringFx(b.x, b.y, 'rgba(255,220,150,0.9)', 0.5, 0.8, 6); } this.hitstop = Math.max(this.hitstop, 140); break;
        case 'bossDefeated': {
          a.stopBoss(); a.victory(); this.vibrate([60, 60, 120]);
          this.slow = { scale: 0.25, ms: 1800 };
          this.hud.flashWhite = 0.85;
          r.addShake(1);
          const fell = w.progress.bossDeaths[e.boss] ?? 0;
          const sub = fell === 0 ? 'Unbroken. Not once did you fall.' : fell === 1 ? 'You fell once, and rose again.' : `You fell ${fell} times, and rose again.`;
          this.hud.centerText = { text: 'LAID TO REST', sub: `${w.enemies.find((x) => x.boss && x.markerId === e.boss)?.def.name ?? ''} · ${sub}`, t: 0, color: '#f6e7c1' };
          this.persist();
          break;
        }
        case 'rest': a.rest(); this.hud.centerText = { text: e.name, sub: 'You rest. The water is still.', t: 0.3, color: '#cfe6f2' }; this.persist(); break;
        case 'item': a.item(); this.hud.centerText = { text: 'A drowned cowrie', sub: 'The gourd holds one more draught.', t: 0.3 }; this.persist(); break;
        case 'note': this.hud.noteText = e.text; this.hud.noteAlpha = 1.3; break;
        case 'gate': a.gate(e.open); break;
        case 'lever': r.addShake(0.4); this.hud.centerText = { text: 'Somewhere, a gate lifts.', t: 0.5, color: '#cfc6b4' }; this.persist(); break;
        case 'playerDeath': {
          a.death(); a.stopBoss(); this.vibrate(200);
          this.slow = { scale: 0.35, ms: 1200 };
          this.screen = 'dead'; this.deathTimer = 0;
          const sid = e.cause.stepId;
          if (sid) this.save.deathsBy[sid] = (this.save.deathsBy[sid] ?? 0) + 1;
          this.persist();
          break;
        }
        case 'ending': this.endingTimer = 0; a.ending(); this.hud.flashWhite = 0.3; this.persist(); break;
        case 'ring': a.ring(this.pan(e.x)); break;
        case 'land': a.land(this.pan(e.x)); r.addShake(0.6); r.burst(e.x, e.y, 24, '#8fc8d8', 6, 'drop', 0.6, 0.08); this.vibrate(25); break;
        case 'blink':
          r.burst(e.fromX, e.fromY, 16, 'rgba(220,230,255,0.7)', 2, 'mist', 0.5, 0.12);
          r.burst(e.x, e.y, 16, 'rgba(220,230,255,0.8)', 2, 'mist', 0.5, 0.12);
          a.bell(1318, 0.5, 0.08); // reappearance chime: this is the moment to watch
          break;
        case 'projectile': a.noise(0.25, { f: 1500, to: 600, q: 1, gain: 0.08 }); break;
      }
    }
  }

  // ====================================================================== screens (DOM)
  private setScreen(s: Screen) {
    this.screen = s;
    this.controls.enabled = s === 'play';
    if (s !== 'play') this.controls.clear();
  }
  private overlay(id: string, html: string): HTMLElement {
    this.ui.innerHTML = '';
    const el = document.createElement('div');
    el.id = id; el.className = 'screen'; el.innerHTML = html;
    this.ui.appendChild(el);
    return el;
  }
  private clearOverlay() { this.ui.innerHTML = ''; }
  private btn(el: HTMLElement, sel: string, fn: () => void) {
    el.querySelector(sel)?.addEventListener('click', (e) => { e.stopPropagation(); this.audio.unlock(); this.audio.ui(); fn(); });
  }

  showTitle() {
    this.setScreen('title');
    const has = this.save.progress.playMs > 3000 || this.save.progress.cairn !== 'c0';
    const el = this.overlay('title', `
      <div class="title-wrap">
        <h1>EBB</h1>
        <p class="sub">the drowned abbey of Vesper</p>
        <div class="menu">
          ${has ? '<button id="cont" class="primary">Continue</button><button id="new">Begin anew</button>' : '<button id="begin" class="primary">Begin</button>'}
        </div>
        <p class="hint">Landscape · two thumbs · sound on</p>
      </div>`);
    this.btn(el, '#begin', () => this.startPlay());
    this.btn(el, '#cont', () => this.startPlay());
    this.btn(el, '#new', () => {
      const c = this.overlay('confirm', `<div class="panel"><p>Begin anew? Your progress will be washed away.</p><div class="menu row"><button id="yes">Begin anew</button><button id="no" class="primary">Keep it</button></div></div>`);
      this.btn(c, '#yes', () => { const settings = this.save.settings; clearSave(); this.save = freshSave(); this.save.settings = settings; this.newWorld(); this.startPlay(); });
      this.btn(c, '#no', () => this.showTitle());
    });
  }

  private startPlay() {
    this.clearOverlay();
    this.audio.unlock();
    this.tryFullscreen();
    if (this.world.progress !== this.save.progress) this.world.progress = this.save.progress;
    this.setScreen('play');
    this.last = performance.now(); this.acc = 0;
    if (this.world.fight) this.audio.startBoss(this.world.fight.boss.def.kind);
  }

  private tryFullscreen() {
    const d = document.documentElement as any;
    try {
      if (!document.fullscreenElement && d.requestFullscreen && matchMedia('(pointer: coarse)').matches) {
        d.requestFullscreen({ navigationUI: 'hide' }).then(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
      }
    } catch { /* iOS: use Add to Home Screen */ }
  }

  openPause() {
    if (this.screen !== 'play') return;
    this.setScreen('pause');
    this.persist();
    const s = this.save.settings;
    const el = this.overlay('pause', `
      <div class="panel">
        <div class="ptop"><h2>Still water</h2><div class="menu row"><button id="resume" class="primary">Resume</button><button id="quit">Title</button></div></div>
        <div class="settings">
          <label>Sound <input id="vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"></label>
          <label>Music <input id="mus" type="range" min="0" max="1" step="0.05" value="${s.music}"></label>
          <label>Buttons
            <span class="seg"><button data-s="0.85" class="${s.scale < 0.9 ? 'on' : ''}">S</button><button data-s="1" class="${s.scale === 1 ? 'on' : ''}">M</button><button data-s="1.15" class="${s.scale > 1.1 ? 'on' : ''}">L</button></span></label>
          <label>Left-handed <input id="swap" type="checkbox" ${s.swap ? 'checked' : ''}></label>
          <label>Vibration <input id="hap" type="checkbox" ${s.haptics ? 'checked' : ''}></label>
        </div>
        <p class="stats">Fallen ${this.world.progress.deaths} · ${Math.floor(this.world.progress.playMs / 60000)} min · ${this.world.player.maxDraughts} draughts · progress is saved</p>
      </div>`);
    this.btn(el, '#resume', () => this.resume());
    this.btn(el, '#quit', () => { this.persist(); this.audio.stopBoss(); this.newWorld(); this.showTitle(); });
    el.querySelector<HTMLInputElement>('#vol')!.oninput = (e) => { s.volume = +(e.target as HTMLInputElement).value; this.audio.setVolume(s.volume); };
    el.querySelector<HTMLInputElement>('#mus')!.oninput = (e) => { s.music = +(e.target as HTMLInputElement).value; this.audio.setMusic(s.music); };
    el.querySelector<HTMLInputElement>('#swap')!.onchange = (e) => { s.swap = (e.target as HTMLInputElement).checked; this.resize(); };
    el.querySelector<HTMLInputElement>('#hap')!.onchange = (e) => { s.haptics = (e.target as HTMLInputElement).checked; this.vibrate(20); };
    el.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => b.addEventListener('click', () => {
      s.scale = +b.dataset.s!; this.resize();
      el.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }

  private resume() {
    this.clearOverlay(); this.persist();
    this.audio.resume();
    this.setScreen('play');
    this.last = performance.now(); this.acc = 0;
  }

  private showDeath() {
    const c = this.world.deathCause;
    const n = c?.stepId ? this.save.deathsBy[c.stepId] ?? 0 : 0;
    const lesson = c?.stepId && n >= 2 ? LESSONS[c.stepId] : '';
    const el = this.overlay('death', `
      <div class="death-wrap">
        <div class="tide"></div>
        <p class="dtitle">The tide takes you.</p>
        ${c ? `<p class="cause"><b>${c.attack}</b> · ${c.source}</p><p class="why">${deathReason(c)}</p>` : ''}
        ${lesson ? `<p class="lesson">${lesson}</p>` : ''}
        <button id="rise" class="primary">Rise</button>
      </div>`);
    const rise = () => { this.respawn(); };
    this.btn(el, '#rise', rise);
    // tapping anywhere after a short beat also rises (fast retries)
    setTimeout(() => el.addEventListener('pointerdown', () => { if (this.screen === 'dead') rise(); }, { once: true }), 600);
  }

  private respawn() {
    this.clearOverlay();
    this.world.respawn();
    this.renderer.cam.x = this.world.player.x; this.renderer.cam.y = this.world.player.y;
    this.hud.flashRed = 0; this.hud.centerText = null; this.hud.bossCard = null; this.hud.hpLag = PLAYER.maxHp;
    this.renderer.particles = [];
    this.slow = null; this.hitstop = 0;
    this.persist();
    this.setScreen('play');
    this.last = performance.now(); this.acc = 0;
  }

  private showEnding() {
    this.setScreen('ending');
    const p = this.world.progress;
    const mins = Math.round(p.playMs / 60000);
    const el = this.overlay('ending', `
      <div class="ending-wrap">
        <p class="e1">The tide goes out.</p>
        <p class="e2">For the first time in a hundred years, the abbey stands in open air.<br>The drowned walk down to the low water, and do not come back.</p>
        <p class="e3">${mins} minute${mins === 1 ? '' : 's'} · ${p.deaths === 0 ? 'never fell' : `fell ${p.deaths} time${p.deaths === 1 ? '' : 's'}, and rose every time`}</p>
        <button id="again" class="primary">Begin anew</button>
      </div>`);
    this.btn(el, '#again', () => { const settings = this.save.settings; clearSave(); this.save = freshSave(); this.save.settings = settings; this.newWorld(); this.showTitle(); });
  }
}
