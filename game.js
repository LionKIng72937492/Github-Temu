(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cv = $('game'), ctx = cv.getContext('2d');
  const mm = $('minimap'), mctx = mm.getContext('2d');
  const pv = $('preview'), pctx = pv.getContext('2d');

  const WORLD = 3000, SP = 7, AI_COUNT = 20, FOOD_MAX = 900, TAU = Math.PI * 2;
  const COLORS = ['#ff4d6d','#4cc9f0','#ffd166','#06d6a0','#b388ff','#ff9f1c','#7cff6b','#ff6bd6'];
  const FOOD_COLORS = ['#ffd166','#06d6a0','#ff4d6d','#4cc9f0','#b388ff','#ff9f1c'];
  const NAMES = ['Viper','Nyx','Kairo','Mamba','Rune','Zed','Sable','Pixel','Orbit','Ash',
                 'Vex','Luna','Blitz','Echo','Frost','Nova','Ghost','Titan','Raze','Ember'];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (from, to) => {
    let d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  let W = 0, H = 0, dpr = 1;
  let state = 'menu';                       // menu | playing | paused | dead
  const settings = Object.assign({ fps: false, particles: true, sens: 1 }, store.get('nx_settings', {}));
  let sens = settings.sens;
  let best = store.get('nx_best', 0);
  let selColor = store.get('nx_color', COLORS[0]);
  if (!COLORS.includes(selColor)) selColor = COLORS[0];
  let snakes = [], player = null, food = [], parts = [];
  const mouse = { x: 0, y: 0, on: false, id: -1 };
  let boostKey = false, boostTouch = false;
  let camX = 0, camY = 0, scale = 1, userZoom = 1;
  let last = 0, fpsAcc = 0, fpsN = 0, hudT = 0, boardT = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  addEventListener('resize', resize);

  // ---------- Schlangen ----------
  const bodyR = s => Math.min(20, 7 + s.body.length * 0.035);

  function makeSnake(x, y, color, name, isPlayer, pers) {
    const a = rnd(0, TAU), body = [];
    for (let i = 0; i < 12; i++) body.push({ x: x - Math.cos(a) * i * SP, y: y - Math.sin(a) * i * SP });
    return { body, angle: a, target: a, color, name, isPlayer, pers, score: 0, kills: 0, alive: true,
             boost: false, boostWant: false, boostCD: 0, grow: 0, think: 0, respawn: 0 };
  }

  function makeAI() {
    let x, y, tries = 0;
    do {
      x = rnd(150, WORLD - 150); y = rnd(150, WORLD - 150); tries++;
    } while (tries < 15 && player && player.alive && Math.hypot(x - player.body[0].x, y - player.body[0].y) < 600);
    const pers = { speed: rnd(100, 130), turn: rnd(2.6, 3.8), aggr: Math.random(), greed: rnd(0.7, 1.3) };
    return makeSnake(x, y, pick(COLORS), pick(NAMES), false, pers);
  }

  function respawn(old) {
    const i = snakes.indexOf(old);
    if (i >= 0) snakes[i] = makeAI();
  }

  function aliveCount() { let n = 0; for (const s of snakes) if (s.alive) n++; return n; }
  function rankOf(s) { let r = 1; for (const o of snakes) if (o !== s && o.alive && o.score > s.score) r++; return r; }

  function update(s, dt, isPlayer) {
    if (!s.alive) {
      if (!isPlayer) { s.respawn -= dt; if (s.respawn <= 0) respawn(s); }
      return;
    }
    if (!isPlayer) aiThink(s, dt);

    const turn = (isPlayer ? 3.4 * sens : s.pers.turn) * (1 - Math.min(0.4, s.body.length * 0.0008));
    s.angle += clamp(angDiff(s.angle, s.target), -turn * dt, turn * dt);

    const want = isPlayer ? (boostKey || boostTouch) : s.boostWant;
    s.boost = want && s.body.length > 12;
    if (s.boost) {
      s.boostCD -= dt;
      if (s.boostCD <= 0) { // Boost kostet Länge
        s.boostCD = 0.25;
        const t = s.body.pop();
        addFood(t.x, t.y, s.color, 1);
      }
    }

    const sp = (isPlayer ? 130 : s.pers.speed) * (s.boost ? 1.8 : 1);
    const h = s.body[0];
    h.x += Math.cos(s.angle) * sp * dt;
    h.y += Math.sin(s.angle) * sp * dt;
    for (let i = 1; i < s.body.length; i++) {
      const p = s.body[i], q = s.body[i - 1];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d > SP) { const k = (d - SP) / d; p.x += dx * k; p.y += dy * k; }
    }
    while (s.grow >= 1) {
      s.grow -= 1;
      const t = s.body[s.body.length - 1];
      s.body.push({ x: t.x, y: t.y });
    }
    if (h.x < 0 || h.y < 0 || h.x > WORLD || h.y > WORLD) { kill(s, null); return; }
    eat(s);
  }

  function checkDeath(s) {
    const h = s.body[0], rs = bodyR(s) * 0.95;
    for (const o of snakes) {
      if (!o.alive) continue;
      const ro = bodyR(o) * 0.85;
      for (let j = o === s ? 10 : 0; j < o.body.length; j++) {
        const p = o.body[j], dx = h.x - p.x, dy = h.y - p.y, lim = rs + ro;
        if (dx * dx + dy * dy < lim * lim) {
          if (o !== s && j === 0) { kill(s, null); kill(o, null); }   // Kopf an Kopf
          else kill(s, o === s ? null : o);
          return;
        }
      }
    }
  }

  function kill(s, killer) {
    if (!s.alive) return;
    s.alive = false;
    if (killer) { killer.kills++; killer.score += 50; }
    for (let i = 0; i < s.body.length; i += 2) {
      const p = s.body[i];
      addFood(p.x + rnd(-6, 6), p.y + rnd(-6, 6), s.color, 2);
    }
    burst(s.body[0].x, s.body[0].y, s.color, 28);
    if (s.isPlayer) endGame(killer);
    else s.respawn = 2.5;
  }

  function eat(s) {
    const h = s.body[0], lim = bodyR(s) + 6;
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i], dx = f.x - h.x, dy = f.y - h.y;
      if (dx * dx + dy * dy < lim * lim) {
        s.grow += f.v; s.score += f.v * 10;
        if (s.isPlayer) burst(f.x, f.y, f.c, 3);
        food[i] = food[food.length - 1]; food.pop();
      }
    }
  }

  // ---------- KI ----------
  function blocked(x, y, self) {
    for (const o of snakes) {
      if (!o.alive) continue;
      const from = o === self ? 10 : 0, lim = bodyR(o) + 8;
      for (let j = from; j < o.body.length; j++) {
        const p = o.body[j], dx = x - p.x, dy = y - p.y;
        if (dx * dx + dy * dy < lim * lim) return true;
      }
    }
    return false;
  }

  function aiThink(s, dt) {
    s.think -= dt;
    if (s.think > 0) return;
    s.think = rnd(0.18, 0.32);
    const h = s.body[0], p = s.pers;
    let tx = WORLD / 2, ty = WORLD / 2, best = null, bd = (420 * p.greed) ** 2;
    for (const f of food) {
      const dx = f.x - h.x, dy = f.y - h.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = f; }
    }
    if (best) { tx = best.x; ty = best.y; }
    s.boostWant = false;
    if (player && player.alive) {
      const ph = player.body[0], dp = Math.hypot(ph.x - h.x, ph.y - h.y);
      if (s.body.length > player.body.length * 1.15 && p.aggr > 0.6 && dp < 650) {
        // Vorausberechneter Abfangpunkt vor dem Spieler
        tx = ph.x + Math.cos(player.angle) * 140;
        ty = ph.y + Math.sin(player.angle) * 140;
        s.boostWant = dp < 320;
      } else if (s.body.length < player.body.length * 0.85 && dp < 300 && p.aggr < 0.7) {
        tx = 2 * h.x - ph.x; ty = 2 * h.y - ph.y;     // ausweichen
      }
    }
    const base = Math.atan2(ty - h.y, tx - h.x) + rnd(-0.1, 0.1);
    let bestA = s.angle, bestS = -1e9;
    for (let k = -5; k <= 5; k++) {
      const a = base + k * 0.2;
      const lx = h.x + Math.cos(a) * 110, ly = h.y + Math.sin(a) * 110;
      let sc = -Math.abs(angDiff(s.angle, a)) * 1.2 - Math.abs(k) * 0.1;
      if (lx < 40 || ly < 40 || lx > WORLD - 40 || ly > WORLD - 40 || blocked(lx, ly, s)) sc -= 1000;
      if (sc > bestS) { bestS = sc; bestA = a; }
    }
    s.target = bestA;
  }

  // ---------- Nahrung & Partikel ----------
  function addFood(x, y, c, v) { food.push({ x, y, c: c || pick(FOOD_COLORS), v: v || 1 }); }
  function fillFood() { while (food.length < FOOD_MAX) addFood(rnd(20, WORLD - 20), rnd(20, WORLD - 20)); }

  function burst(x, y, c, n) {
    if (!settings.particles) return;
    for (let i = 0; i < n && parts.length < 400; i++) {
      const a = rnd(0, TAU), v = rnd(40, 200);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c });
    }
  }

  function updateParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      const f = Math.max(0, 1 - 3 * dt); p.vx *= f; p.vy *= f;
      p.life -= dt * 1.6;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); }
    }
  }

  // ---------- Spielfluss ----------
  function startGame() {
    const name = ($('nameInput').value.trim() || 'Gast').slice(0, 14);
    store.set('nx_name', name); store.set('nx_color', selColor);
    if (document.activeElement) document.activeElement.blur();
    player = makeSnake(WORLD / 2, WORLD / 2, selColor, name, true, null);
    snakes = [player];
    for (let i = 0; i < AI_COUNT; i++) snakes.push(makeAI());
    food = []; parts = []; fillFood();
    camX = WORLD / 2; camY = WORLD / 2; scale = 1;
    mouse.on = false; mouse.x = W / 2; mouse.y = H / 2;
    boostKey = boostTouch = false;
    state = 'playing';
    ['menu', 'gameover', 'pause', 'settings'].forEach(id => show(id, false));
    ['hud', 'minimap', 'board'].forEach(id => show(id, true));
    show('boostBtn', isTouch);
    hudT = 0; boardT = 0;
  }

  function endGame(killer) {
    state = 'dead';
    const sc = Math.floor(player.score);
    if (sc > best) { best = sc; store.set('nx_best', best); }
    $('goStats').textContent = `Punkte ${sc} · Länge ${player.body.length} · Rang ${rankOf(player)} · ` +
      `Kills ${player.kills} · Bestwert ${best}` + (killer ? ` · Gefressen von ${killer.name}` : '');
    show('boostBtn', false);
    show('gameover', true);
  }

  function setPause(on) {
    if (on && state !== 'playing') return;
    if (!on && state !== 'paused') return;
    state = on ? 'paused' : 'playing';
    boostKey = false;
    show('pause', on);
  }

  function toMenu() {
    state = 'menu'; boostKey = false; boostTouch = false;
    ['hud', 'board', 'minimap', 'boostBtn', 'pause', 'gameover', 'settings'].forEach(id => show(id, false));
    show('menu', true);
  }

  function saveSettings() {
    settings.fps = $('optFps').checked;
    settings.particles = $('optParticles').checked;
    settings.sens = +$('optSens').value;
    sens = settings.sens;
    store.set('nx_settings', settings);
  }

  function step(dt) {
    if (player.alive && mouse.on) {
      const dx = mouse.x - W / 2, dy = mouse.y - H / 2;
      if (dx * dx + dy * dy > 144) player.target = Math.atan2(dy, dx);
    }
    for (const s of snakes) update(s, dt, s === player);
    for (const s of snakes) if (s.alive) checkDeath(s);
    fillFood();
    updateParticles(dt);

    const h = player.body[0];
    camX += (h.x - camX) * Math.min(1, dt * 8);
    camY += (h.y - camY) * Math.min(1, dt * 8);
    const base = clamp(Math.min(W, H) / 600, 0.7, 1.2);
    const tgt = base * userZoom * (1 - Math.min(0.35, player.body.length * 0.0006));
    scale += (tgt - scale) * Math.min(1, dt * 3);

    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(); }
    boardT -= dt;
    if (boardT <= 0) { boardT = 0.5; updateBoard(); drawMini(); }
    show('fps', settings.fps);
  }

  function updateHud() {
    $('sScore').textContent = Math.floor(player.score);
    $('sLen').textContent = player.body.length;
    $('sKills').textContent = player.kills;
    $('sRank').textContent = rankOf(player) + ' / ' + aliveCount();
  }

  function updateBoard() {
    const list = snakes.filter(s => s.alive).sort((a, b) => b.score - a.score).slice(0, 10);
    const ol = $('boardList');
    ol.textContent = '';
    for (const s of list) {
      const li = document.createElement('li');
      if (s.isPlayer) li.className = 'me';
      const dot = document.createElement('i'); dot.style.background = s.color;
      const nm = document.createElement('span'); nm.textContent = s.name;
      const sc = document.createElement('b'); sc.textContent = Math.floor(s.score);
      li.append(dot, nm, sc);
      ol.appendChild(li);
    }
  }

  function drawMini() {
    const S = mm.width, k = S / WORLD;
    mctx.clearRect(0, 0, S, S);
    mctx.fillStyle = 'rgba(8,10,24,0.85)'; mctx.fillRect(0, 0, S, S);
    for (const s of snakes) {
      if (!s.alive) continue;
      const h = s.body[0];
      mctx.fillStyle = s.color;
      mctx.beginPath(); mctx.arc(h.x * k, h.y * k, s.isPlayer ? 3.5 : 1.8, 0, TAU); mctx.fill();
    }
    mctx.strokeStyle = 'rgba(255,255,255,0.5)';
    mctx.strokeRect((camX - W / 2 / scale) * k, (camY - H / 2 / scale) * k, (W / scale) * k, (H / scale) * k);
  }

  // ---------- Zeichnen ----------
  function spine(c, pts, w, col) {
    c.beginPath();
    c.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    for (let i = pts.length - 2; i >= 0; i--) c.lineTo(pts[i].x, pts[i].y);
    c.lineWidth = w; c.strokeStyle = col; c.stroke();
  }

  function drawBody(c, pts, r, col, striped) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    spine(c, pts, r * 2 + 4, 'rgba(0,0,0,0.45)');
    spine(c, pts, r * 2, col);
    c.setLineDash(striped ? [r * 0.9, r * 0.9] : []);
    spine(c, pts, r * 0.7, striped ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.2)');
    c.setLineDash([]);
  }

  function drawHead(c, s, r) {
    const h = s.body[0], a = s.angle, ca = Math.cos(a), sa = Math.sin(a);
    c.fillStyle = s.color;
    c.beginPath(); c.arc(h.x, h.y, r * 1.15, 0, TAU); c.fill();
    for (const side of [-1, 1]) {
      const ex = h.x + ca * r * 0.5 - sa * side * r * 0.5;
      const ey = h.y + sa * r * 0.5 + ca * side * r * 0.5;
      c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(ex, ey, r * 0.36, 0, TAU); c.fill();
      c.fillStyle = '#0b0d1f';
      c.beginPath(); c.arc(ex + ca * r * 0.12, ey + sa * r * 0.12, r * 0.18, 0, TAU); c.fill();
    }
  }

  function drawPreview(t) {
    pctx.clearRect(0, 0, pv.width, pv.height);
    const pts = [];
    for (let i = 0; i < 22; i++) {
      pts.push({ x: pv.width * 0.5 + 100 - i * 9, y: pv.height * 0.5 + Math.sin(t * 2.2 - i * 0.45) * 12 });
    }
    drawBody(pctx, pts, 8, selColor, false);
    drawHead(pctx, { body: pts, angle: 0, color: selColor }, 8);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080a18';
    ctx.fillRect(0, 0, W, H);
    if (state === 'menu' || !player) return;

    const sc = scale;
    const left = camX - W / 2 / sc, right = camX + W / 2 / sc;
    const top = camY - H / 2 / sc, bottom = camY + H / 2 / sc;
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (W / 2 - camX * sc), dpr * (H / 2 - camY * sc));

    // Raster
    const g = 80;
    ctx.strokeStyle = 'rgba(120,140,255,0.08)';
    ctx.lineWidth = 1 / sc;
    ctx.beginPath();
    for (let x = Math.max(0, Math.floor(left / g) * g); x <= Math.min(WORLD, right); x += g) {
      ctx.moveTo(x, Math.max(0, top)); ctx.lineTo(x, Math.min(WORLD, bottom));
    }
    for (let y = Math.max(0, Math.floor(top / g) * g); y <= Math.min(WORLD, bottom); y += g) {
      ctx.moveTo(Math.max(0, left), y); ctx.lineTo(Math.min(WORLD, right), y);
    }
    ctx.stroke();

    // Arenagrenze
    ctx.strokeStyle = 'rgba(255,77,109,0.25)'; ctx.lineWidth = 16; ctx.strokeRect(0, 0, WORLD, WORLD);
    ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, WORLD, WORLD);

    // Nahrung
    for (const f of food) {
      if (f.x < left || f.x > right || f.y < top || f.y > bottom) continue;
      const r = 2.5 + Math.min(f.v, 3) * 0.7;
      ctx.globalAlpha = 0.22; ctx.fillStyle = f.c;
      ctx.beginPath(); ctx.arc(f.x, f.y, r * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill();
    }

    // Partikel
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1 + 2.5 * p.life, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Schlangen
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive) continue;
      const r = bodyR(s), h = s.body[0];
      if (s.boost) { ctx.globalAlpha = 0.25; spine(ctx, s.body, r * 3, s.color); ctx.globalAlpha = 1; }
      drawBody(ctx, s.body, r, s.color, i % 2 === 1);
      drawHead(ctx, s, r);
      ctx.font = `600 ${Math.max(14, r * 1.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(s.name, h.x, h.y - r * 1.6 - 6);
      ctx.fillStyle = s.isPlayer ? '#ffffff' : 'rgba(225,230,255,0.75)';
      ctx.fillText(s.name, h.x, h.y - r * 1.6 - 6);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) { $('sFps').textContent = Math.round(fpsN / fpsAcc); fpsN = 0; fpsAcc = 0; }
    if (state === 'playing') step(dt);
    if (state === 'menu') drawPreview(now / 1000);
    render();
  }

  // ---------- Eingaben ----------
  cv.addEventListener('pointerdown', e => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; mouse.id = e.pointerId;
    if (state === 'playing' && e.pointerType === 'mouse' && e.button === 0) boostKey = true;
  });
  cv.addEventListener('pointermove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.pointerId === mouse.id) mouse.on = true;
  });
  addEventListener('pointerup', e => {
    if (e.pointerId === mouse.id) mouse.on = false;
    if (e.pointerType === 'mouse') boostKey = false;
  });
  addEventListener('pointercancel', e => {
    if (e.pointerId === mouse.id) mouse.on = false;
    boostKey = false;
  });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    userZoom = clamp(userZoom * (e.deltaY < 0 ? 1.08 : 0.92), 0.5, 1.8);
  }, { passive: false });

  addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if (state === 'playing') setPause(true);
      else if (state === 'paused') setPause(false);
    }
    if (e.code === 'Space' && state === 'playing') { e.preventDefault(); boostKey = true; }
  });
  addEventListener('keyup', e => { if (e.code === 'Space') boostKey = false; });

  const bb = $('boostBtn');
  bb.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); boostTouch = true; bb.classList.add('on'); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t =>
    bb.addEventListener(t, () => { boostTouch = false; bb.classList.remove('on'); }));

  document.addEventListener('touchmove', e => { if (state === 'playing') e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());

  // ---------- Menü ----------
  const sw = $('swatches');
  function markSw() { [...sw.children].forEach((d, i) => d.classList.toggle('on', COLORS[i] === selColor)); }
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'sw'; d.style.background = c; d.style.color = c; d.title = c;
    d.onclick = () => { selColor = c; markSw(); };
    sw.appendChild(d);
  });
  markSw();

  $('nameInput').value = store.get('nx_name', '');
  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
  $('playBtn').onclick = startGame;
  $('restartBtn').onclick = startGame;
  $('pauseBtn').onclick = () => setPause(true);
  $('resumeBtn').onclick = () => setPause(false);
  $('quitBtn').onclick = toMenu;
  $('goMenuBtn').onclick = toMenu;
  $('settingsBtn').onclick = () => { show('menu', false); show('settings', true); };
  $('settingsBack').oncl
