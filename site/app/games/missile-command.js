function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

export function mountMissileCommand(root) {
  const canvas = document.createElement("canvas");
  const hud = document.createElement("div");
  hud.className = "games-hud";
  root.innerHTML = "";
  root.appendChild(canvas);
  root.appendChild(hud);
  const ctx = canvas.getContext("2d");
  let size = resize(canvas);
  let alive = true;
  let score = 0;
  let wave = 1;
  let ammo = 30;
  let cities = [0, 1, 2, 3, 4, 5].map(() => true);
  let missiles = [];
  let shots = [];
  let blasts = [];
  let spawnTimer = 0;
  let pointer = { x: size.w / 2, y: size.h / 2 };

  const groundY = () => size.h * 0.88;
  const silo = () => ({ x: size.w / 2, y: groundY() - 8 });

  function cityX(i) {
    return size.w * (0.12 + i * 0.15);
  }

  function spawnMissile() {
    const targetCities = cities.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    if (!targetCities.length) return;
    const target = targetCities[Math.floor(Math.random() * targetCities.length)];
    const x0 = Math.random() * size.w;
    const y0 = -10;
    const x1 = cityX(target);
    const y1 = groundY();
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const spd = (1.1 + wave * 0.12) * size.dpr;
    missiles.push({
      x: x0,
      y: y0,
      vx: ((x1 - x0) / dist) * spd,
      vy: ((y1 - y0) / dist) * spd,
      trail: [{ x: x0, y: y0 }],
      target,
    });
  }

  function fire() {
    if (ammo <= 0 || !cities.some(Boolean)) return;
    ammo -= 1;
    const s = silo();
    const dx = pointer.x - s.x;
    const dy = pointer.y - s.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const spd = 6.5 * size.dpr;
    shots.push({
      x: s.x,
      y: s.y,
      vx: (dx / dist) * spd,
      vy: (dy / dist) * spd,
      tx: pointer.x,
      ty: pointer.y,
    });
  }

  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    pointer.x = ((src.clientX - rect.left) / rect.width) * size.w;
    pointer.y = ((src.clientY - rect.top) / rect.height) * size.h;
  };
  const onClick = (e) => {
    e.preventDefault();
    onMove(e);
    fire();
  };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("touchmove", onMove, { passive: true });
  canvas.addEventListener("mousedown", onClick);
  canvas.addEventListener("touchstart", onClick, { passive: false });
  const onResize = () => {
    size = resize(canvas);
  };
  window.addEventListener("resize", onResize);

  let last = performance.now();
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(32, now - last) / 16.67;
    last = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function step(t) {
    if (!cities.some(Boolean)) return;
    spawnTimer -= t;
    if (spawnTimer <= 0) {
      spawnMissile();
      spawnTimer = Math.max(18, 70 - wave * 6);
    }

    missiles = missiles.filter((m) => {
      m.x += m.vx * t;
      m.y += m.vy * t;
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > 18) m.trail.shift();
      if (m.y >= groundY()) {
        cities[m.target] = false;
        blasts.push({ x: m.x, y: groundY(), r: 8, max: 36, grow: 1.6 });
        return false;
      }
      return true;
    });

    shots = shots.filter((s) => {
      s.x += s.vx * t;
      s.y += s.vy * t;
      if (Math.hypot(s.x - s.tx, s.y - s.ty) < 8 * size.dpr || s.y < 0) {
        blasts.push({ x: s.tx, y: s.ty, r: 4, max: 42, grow: 1.4 });
        return false;
      }
      return true;
    });

    blasts = blasts.filter((b) => {
      b.r += b.grow * t;
      missiles = missiles.filter((m) => {
        if (Math.hypot(m.x - b.x, m.y - b.y) < b.r) {
          score += 25;
          return false;
        }
        return true;
      });
      return b.r < b.max;
    });

    if (ammo <= 0 && !shots.length && !missiles.length) {
      wave += 1;
      ammo = 30 + wave * 2;
      spawnTimer = 40;
    }

    const left = cities.filter(Boolean).length;
    hud.innerHTML = `<span>SCORE ${score}</span><span>WAVE ${wave}</span><span>AMMO ${ammo}</span><span>CITIES ${left}</span>`;
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, size.h);
    g.addColorStop(0, "#10182a");
    g.addColorStop(1, "#1a1020");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size.w, size.h);

    ctx.fillStyle = "#2a3348";
    ctx.fillRect(0, groundY(), size.w, size.h - groundY());

    for (let i = 0; i < 6; i++) {
      if (!cities[i]) continue;
      const x = cityX(i);
      ctx.fillStyle = "#8f7430";
      ctx.fillRect(x - 14, groundY() - 18, 28, 18);
      ctx.fillStyle = "#d7b56a";
      ctx.fillRect(x - 8, groundY() - 28, 7, 10);
      ctx.fillRect(x + 2, groundY() - 34, 7, 16);
    }

    const s = silo();
    ctx.fillStyle = "#c9d2e3";
    ctx.beginPath();
    ctx.moveTo(s.x - 16, groundY());
    ctx.lineTo(s.x, s.y - 16);
    ctx.lineTo(s.x + 16, groundY());
    ctx.closePath();
    ctx.fill();

    for (const m of missiles) {
      ctx.strokeStyle = "#e07155";
      ctx.beginPath();
      m.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.fillStyle = "#ffd2c4";
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    }

    ctx.strokeStyle = "#9fb0ff";
    for (const sh of shots) {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(sh.x, sh.y);
      ctx.stroke();
    }

    for (const b of blasts) {
      ctx.strokeStyle = `rgba(240,197,109,${1 - b.r / b.max})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(pointer.x - 8, pointer.y);
    ctx.lineTo(pointer.x + 8, pointer.y);
    ctx.moveTo(pointer.x, pointer.y - 8);
    ctx.lineTo(pointer.x, pointer.y + 8);
    ctx.stroke();

    if (!cities.some(Boolean)) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${18 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("CITIES LOST — back to library to replay", size.w / 2, size.h / 2);
    }
  }

  requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("mousedown", onClick);
      canvas.removeEventListener("touchstart", onClick);
      window.removeEventListener("resize", onResize);
      root.innerHTML = "";
    },
  };
}
