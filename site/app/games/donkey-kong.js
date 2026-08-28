function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

function platformLayout(w, h, dpr) {
  const pw = 12 * dpr;
  const gap = 8 * dpr;
  const left = w * 0.08;
  const right = w * 0.92;
  const fullW = right - left;
  const rows = [
    { y: h * 0.82, segments: [[left, fullW]] },
    { y: h * 0.66, segments: [[left + fullW * 0.08, fullW * 0.84]] },
    { y: h * 0.5, segments: [[left, fullW * 0.84]] },
    { y: h * 0.34, segments: [[left + fullW * 0.08, fullW * 0.84]] },
    { y: h * 0.18, segments: [[left, fullW]] },
  ];
  const platforms = rows.flatMap((row) =>
    row.segments.map(([x, width]) => ({ x, y: row.y, w: width, h: pw }))
  );
  const ladders = [
    { x: left + fullW * 0.18, y: h * 0.34, h: h * 0.48 - h * 0.34 },
    { x: left + fullW * 0.72, y: h * 0.5, h: h * 0.66 - h * 0.5 },
    { x: left + fullW * 0.42, y: h * 0.18, h: h * 0.34 - h * 0.18 },
    { x: left + fullW * 0.58, y: h * 0.66, h: h * 0.82 - h * 0.66 },
  ].map((l) => ({ x: l.x, y: l.y, w: 18 * dpr, h: l.h }));
  return { platforms, ladders, kong: { x: left + fullW * 0.12, y: h * 0.1 }, goal: { x: right - 36 * dpr, y: h * 0.14 } };
}

export function mountDonkeyKong(root) {
  root.style.position = "relative";
  root.style.width = "100%";
  root.style.height = "100%";
  root.style.minHeight = "inherit";
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
  let lives = 3;
  let over = false;
  let won = false;
  let level = 1;
  let layout = platformLayout(size.w, size.h, size.dpr);
  let player = { x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0, onGround: false, onLadder: false, facing: 1 };
  let barrels = [];
  let spawnTimer = 0;
  let kongTimer = 0;
  const keys = new Set();

  function playerSize() {
    return { w: 14 * size.dpr, h: 22 * size.dpr };
  }

  function resetPlayer() {
    const ps = playerSize();
    const start = layout.platforms[0];
    player = {
      x: start.x + start.w * 0.5,
      y: start.y - ps.h,
      w: ps.w,
      h: ps.h,
      vx: 0,
      vy: 0,
      onGround: true,
      onLadder: false,
      facing: 1,
    };
  }

  function relayout() {
    layout = platformLayout(size.w, size.h, size.dpr);
    barrels = [];
    spawnTimer = 0;
    resetPlayer();
  }

  relayout();

  function onPlatform(x, y, feet = false) {
    const py = feet ? y + player.h : y;
    for (const p of layout.platforms) {
      if (x + player.w > p.x && x < p.x + p.w && py >= p.y - 2 && py <= p.y + p.h + 2) return p;
    }
    return null;
  }

  function onLadder(x, y) {
    const cx = x + player.w / 2;
    const cy = y + player.h / 2;
    for (const l of layout.ladders) {
      if (cx >= l.x && cx <= l.x + l.w && cy >= l.y && cy <= l.y + l.h) return l;
    }
    return null;
  }

  function spawnBarrel() {
    const p = layout.platforms[layout.platforms.length - 1];
    barrels.push({
      x: layout.kong.x + 24 * size.dpr,
      y: p.y - 10 * size.dpr,
      r: 9 * size.dpr,
      vx: 2.4 * size.dpr * (Math.random() > 0.5 ? 1 : -1),
      vy: 0,
      platformIdx: layout.platforms.length - 1,
      falling: false,
    });
  }

  const onKey = (e, down) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Space", "w", "a", "s", "d"].includes(e.key)) {
      e.preventDefault();
    }
    const k = e.key === " " ? "Space" : e.key;
    if (down) keys.add(k);
    else keys.delete(k);
    if (down && over && (k === "Space" || k === "Enter")) restart();
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  const onResize = () => {
    size = resize(canvas);
    relayout();
  };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("resize", onResize);

  function restart() {
    score = 0;
    lives = 3;
    level = 1;
    over = false;
    won = false;
    relayout();
  }

  function nextLevel() {
    level++;
    score += 500;
    won = false;
    barrels = [];
    spawnTimer = 0;
    resetPlayer();
  }

  function loseLife() {
    lives--;
    barrels = [];
    spawnTimer = 0;
    if (lives <= 0) over = true;
    else resetPlayer();
  }

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
    if (over || won) return;

    const speed = 2.8 * size.dpr * t;
    const climb = 2.5 * size.dpr * t;
    const ladder = onLadder(player.x, player.y);
    player.onLadder = !!ladder;

    if (keys.has("ArrowLeft") || keys.has("a")) {
      player.vx = -speed;
      player.facing = -1;
    } else if (keys.has("ArrowRight") || keys.has("d")) {
      player.vx = speed;
      player.facing = 1;
    } else {
      player.vx = 0;
    }

    if (player.onLadder) {
      player.vy = 0;
      if (keys.has("ArrowUp") || keys.has("w")) player.y -= climb;
      if (keys.has("ArrowDown") || keys.has("s")) player.y += climb;
      player.onGround = false;
    } else {
      player.vy += 0.42 * size.dpr * t;
      if ((keys.has("ArrowUp") || keys.has("w") || keys.has("Space")) && player.onGround) {
        player.vy = -7.2 * size.dpr;
        player.onGround = false;
      }
    }

    player.x += player.vx;
    player.y += player.vy;

    if (player.x < 4) player.x = 4;
    if (player.x + player.w > size.w - 4) player.x = size.w - 4 - player.w;

    const plat = onPlatform(player.x, player.y + player.vy, true);
    if (plat && player.vy >= 0) {
      player.y = plat.y - player.h;
      player.vy = 0;
      player.onGround = true;
    } else if (!player.onLadder) {
      player.onGround = !!onPlatform(player.x, player.y, true);
    }

    if (player.y > size.h + 40) loseLife();

    const gx = layout.goal.x;
    const gy = layout.goal.y;
    if (
      player.x + player.w > gx &&
      player.x < gx + 28 * size.dpr &&
      player.y < gy + 30 * size.dpr
    ) {
      won = true;
      setTimeout(() => nextLevel(), 900);
    }

    spawnTimer += t;
    kongTimer += t;
    const spawnRate = Math.max(70, 130 - level * 8);
    if (spawnTimer > spawnRate) {
      spawnTimer = 0;
      spawnBarrel();
    }

    for (const b of barrels) {
      if (b.falling) {
        b.vy += 0.5 * size.dpr * t;
        b.y += b.vy * t;
        const hit = layout.platforms.find(
          (p) => b.y + b.r >= p.y && b.y - b.r <= p.y + p.h && b.x >= p.x && b.x <= p.x + p.w
        );
        if (hit) {
          b.falling = false;
          b.vy = 0;
          b.y = hit.y - b.r;
          b.platformIdx = layout.platforms.indexOf(hit);
          b.vx = Math.sign(b.vx || 1) * 2.4 * size.dpr;
        }
      } else {
        b.x += b.vx * t;
        const p = layout.platforms[b.platformIdx];
        if (!p) continue;
        b.y = p.y - b.r;
        if (b.x - b.r <= p.x || b.x + b.r >= p.x + p.w) {
          b.falling = true;
          b.vy = 0.5 * size.dpr;
        }
        for (const l of layout.ladders) {
          if (Math.abs(b.x - (l.x + l.w / 2)) < l.w && Math.random() < 0.008 * t) {
            b.falling = true;
            b.vy = 0.4 * size.dpr;
            break;
          }
        }
      }

      if (
        Math.hypot(player.x + player.w / 2 - b.x, player.y + player.h / 2 - b.y) <
        b.r + Math.min(player.w, player.h) * 0.45
      ) {
        loseLife();
        break;
      }
    }

    barrels = barrels.filter((b) => b.y < size.h + 60);
  }

  function drawPlatform(p) {
    ctx.fillStyle = "#c41e3a";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = "#8b1528";
    for (let x = p.x; x < p.x + p.w; x += 14 * size.dpr) {
      ctx.fillRect(x, p.y + 2, 10 * size.dpr, p.h - 4);
    }
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(p.x, p.y, p.w, 3);
  }

  function drawLadder(l) {
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(l.x, l.y, 3 * size.dpr, l.h);
    ctx.fillRect(l.x + l.w - 3 * size.dpr, l.y, 3 * size.dpr, l.h);
    for (let y = l.y; y < l.y + l.h; y += 10 * size.dpr) {
      ctx.fillRect(l.x, y, l.w, 2 * size.dpr);
    }
  }

  function drawKong() {
    const k = layout.kong;
    const s = size.dpr;
    ctx.fillStyle = "#6b3f1f";
    ctx.fillRect(k.x, k.y, 34 * s, 28 * s);
    ctx.fillStyle = "#4a2812";
    ctx.fillRect(k.x + 4 * s, k.y + 20 * s, 10 * s, 14 * s);
    ctx.fillRect(k.x + 20 * s, k.y + 20 * s, 10 * s, 14 * s);
    ctx.fillStyle = "#8b4513";
    ctx.beginPath();
    ctx.arc(k.x + 17 * s, k.y + 12 * s, 14 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f7fb";
    ctx.fillRect(k.x + 10 * s, k.y + 8 * s, 5 * s, 5 * s);
    ctx.fillRect(k.x + 20 * s, k.y + 8 * s, 5 * s, 5 * s);
    if (kongTimer % 40 < 20) {
      ctx.fillStyle = "#5c3310";
      ctx.fillRect(k.x + 28 * s, k.y + 18 * s, 14 * s, 8 * s);
    }
  }

  function drawPlayer() {
    const { x, y, w, h, facing } = player;
    ctx.fillStyle = "#e07155";
    ctx.fillRect(x + 2, y + 8, w - 4, h - 8);
    ctx.fillStyle = "#1a56db";
    ctx.fillRect(x + 1, y + h - 8, w - 2, 7);
    ctx.fillStyle = "#f4c4a0";
    ctx.fillRect(x + 3, y + 2, w - 6, 8);
    ctx.fillStyle = "#e07155";
    ctx.fillRect(x + (facing > 0 ? w - 4 : 0), y + 10, 4, 8);
  }

  function drawGoal() {
    const g = layout.goal;
    ctx.fillStyle = "#f4a8c8";
    ctx.beginPath();
    ctx.arc(g.x + 14 * size.dpr, g.y + 16 * size.dpr, 12 * size.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd700";
    ctx.font = `${10 * size.dpr}px Outfit, sans-serif`;
    ctx.fillText("HELP!", g.x - 4 * size.dpr, g.y - 4 * size.dpr);
  }

  function draw() {
    const grd = ctx.createLinearGradient(0, 0, 0, size.h);
    grd.addColorStop(0, "#141820");
    grd.addColorStop(1, "#0b1016");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size.w, size.h);

    for (const l of layout.ladders) drawLadder(l);
    for (const p of layout.platforms) drawPlatform(p);
    drawKong();
    drawGoal();

    for (const b of barrels) {
      ctx.fillStyle = "#8b4513";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5c3310";
      ctx.lineWidth = 2 * size.dpr;
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(b.x - b.r * 0.6, b.y - 2, b.r * 1.2, 3);
    }

    drawPlayer();

    hud.textContent = over
      ? `Game over · ${score} — Space to restart`
      : won
        ? `Level ${level} clear! · ${score}`
        : `Score ${score} · Lives ${lives} · Level ${level} · Arrows move/climb · Space jump`;

    if (over) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${18 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", size.w / 2, size.h / 2);
    }
  }

  requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("resize", onResize);
      root.innerHTML = "";
    },
  };
}
