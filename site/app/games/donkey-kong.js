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
  const ph = 10 * dpr;
  const margin = w * 0.06;
  const span = w - margin * 2;
  // Classic zig-zag girders (sloped platforms)
  const rows = [
    { y: h * 0.84, x: margin, w: span, slope: -0.08 },
    { y: h * 0.68, x: margin + span * 0.06, w: span * 0.88, slope: 0.08 },
    { y: h * 0.52, x: margin, w: span * 0.88, slope: -0.08 },
    { y: h * 0.36, x: margin + span * 0.06, w: span * 0.88, slope: 0.08 },
    { y: h * 0.2, x: margin, w: span, slope: -0.06 },
  ];
  const platforms = rows.map((r) => ({ ...r, h: ph }));
  const ladders = [
    { x: margin + span * 0.2, y1: h * 0.36, y2: h * 0.68 },
    { x: margin + span * 0.55, y1: h * 0.52, y2: h * 0.84 },
    { x: margin + span * 0.78, y1: h * 0.2, y2: h * 0.52 },
    { x: margin + span * 0.38, y1: h * 0.68, y2: h * 0.84 },
  ].map((l) => ({
    x: l.x,
    y: Math.min(l.y1, l.y2),
    w: 16 * dpr,
    h: Math.abs(l.y2 - l.y1),
  }));
  return {
    platforms,
    ladders,
    kong: { x: margin + span * 0.08, y: h * 0.11 },
    goal: { x: margin + span * 0.82, y: h * 0.14 },
  };
}

function platformYAt(p, x) {
  const rel = (x - p.x) / Math.max(1, p.w);
  return p.y + rel * p.w * (p.slope || 0);
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
  let kongFrame = 0;
  const keys = new Set();

  function playerSize() {
    return { w: 14 * size.dpr, h: 22 * size.dpr };
  }

  function resetPlayer() {
    const ps = playerSize();
    const start = layout.platforms[layout.platforms.length - 1];
    const x = start.x + start.w * 0.15;
    player = {
      x,
      y: platformYAt(start, x + ps.w / 2) - ps.h,
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

  function platformUnder(x, y, feet = false) {
    const py = feet ? y + player.h : y + player.h / 2;
    let best = null;
    let bestDy = Infinity;
    for (const p of layout.platforms) {
      const cx = x + player.w / 2;
      if (cx < p.x || cx > p.x + p.w) continue;
      const top = platformYAt(p, cx);
      const dy = py - top;
      if (dy >= -4 * size.dpr && dy <= 18 * size.dpr && dy < bestDy) {
        bestDy = dy;
        best = { p, top };
      }
    }
    return best;
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
    const top = layout.platforms[0];
    barrels.push({
      x: layout.kong.x + 30 * size.dpr,
      y: platformYAt(top, layout.kong.x + 30 * size.dpr) - 10 * size.dpr,
      r: 8 * size.dpr,
      vx: 2.6 * size.dpr,
      vy: 0,
      platformIdx: 0,
      falling: false,
      dir: 1,
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
    kongFrame += dt;
    step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function step(t) {
    if (over || won) return;

    const speed = 2.9 * size.dpr * t;
    const climb = 2.6 * size.dpr * t;
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
      player.vy += 0.44 * size.dpr * t;
      if ((keys.has("ArrowUp") || keys.has("w") || keys.has("Space")) && player.onGround) {
        player.vy = -7.4 * size.dpr;
        player.onGround = false;
      }
    }

    player.x += player.vx;
    player.y += player.vy;

    if (player.x < 4) player.x = 4;
    if (player.x + player.w > size.w - 4) player.x = size.w - 4 - player.w;

    const hit = platformUnder(player.x, player.y, true);
    if (hit && player.vy >= 0) {
      player.y = hit.top - player.h;
      player.vy = 0;
      player.onGround = true;
    } else if (!player.onLadder) {
      player.onGround = !!platformUnder(player.x, player.y, true);
    }

    if (player.y > size.h + 40) loseLife();

    const g = layout.goal;
    if (player.x + player.w > g.x && player.x < g.x + 24 * size.dpr && player.y < g.y + 28 * size.dpr) {
      won = true;
      setTimeout(() => nextLevel(), 900);
    }

    spawnTimer += t;
    const spawnRate = Math.max(65, 120 - level * 7);
    if (spawnTimer > spawnRate) {
      spawnTimer = 0;
      spawnBarrel();
    }

    for (const b of barrels) {
      const p = layout.platforms[b.platformIdx];
      if (!p) continue;

      if (b.falling) {
        b.vy += 0.55 * size.dpr * t;
        b.y += b.vy * t;
        const land = layout.platforms.find((pl) => {
          const top = platformYAt(pl, b.x);
          return b.y + b.r >= top && b.y - b.r <= top + pl.h && b.x >= pl.x && b.x <= pl.x + pl.w;
        });
        if (land) {
          b.falling = false;
          b.vy = 0;
          b.platformIdx = layout.platforms.indexOf(land);
          b.y = platformYAt(land, b.x) - b.r;
          b.vx = (land.slope < 0 ? -1 : 1) * 2.6 * size.dpr;
        }
      } else {
        b.x += b.vx * t;
        b.y = platformYAt(p, b.x) - b.r;
        if (b.x <= p.x + b.r || b.x >= p.x + p.w - b.r) {
          b.falling = true;
          b.vy = 0.5 * size.dpr;
        }
        for (const l of layout.ladders) {
          if (Math.abs(b.x - (l.x + l.w / 2)) < l.w * 1.2 && Math.random() < 0.012 * t) {
            b.falling = true;
            b.vy = 0.45 * size.dpr;
            break;
          }
        }
      }

      if (
        Math.hypot(player.x + player.w / 2 - b.x, player.y + player.h / 2 - b.y) <
        b.r + Math.min(player.w, player.h) * 0.42
      ) {
        loseLife();
        break;
      }
    }

    barrels = barrels.filter((b) => b.y < size.h + 80);
  }

  function drawSlopedPlatform(p) {
    const steps = Math.max(8, Math.floor(p.w / (8 * size.dpr)));
    ctx.fillStyle = "#c41e3a";
    for (let i = 0; i < steps; i++) {
      const x0 = p.x + (p.w * i) / steps;
      const x1 = p.x + (p.w * (i + 1)) / steps;
      const y0 = platformYAt(p, x0);
      const y1 = platformYAt(p, x1);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, y1 + p.h);
      ctx.lineTo(x0, y0 + p.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = i % 2 ? "#a01830" : "#ff6b6b";
      ctx.fillRect(x0 + 2, y0 + 2, Math.max(4, (x1 - x0) - 4), 3);
      ctx.fillStyle = "#c41e3a";
    }
  }

  function drawLadder(l) {
    ctx.fillStyle = "#7cfc00";
    ctx.fillRect(l.x, l.y, 3 * size.dpr, l.h);
    ctx.fillRect(l.x + l.w - 3 * size.dpr, l.y, 3 * size.dpr, l.h);
    for (let y = l.y; y < l.y + l.h; y += 9 * size.dpr) {
      ctx.fillRect(l.x, y, l.w, 2 * size.dpr);
    }
  }

  function drawKong() {
    const k = layout.kong;
    const s = size.dpr;
    const bounce = Math.sin(kongFrame * 0.15) * 2 * s;
    ctx.fillStyle = "#4a2812";
    ctx.fillRect(k.x + 8 * s, k.y + 24 * s + bounce, 12 * s, 14 * s);
    ctx.fillRect(k.x + 24 * s, k.y + 24 * s + bounce, 12 * s, 14 * s);
    ctx.fillStyle = "#8b4513";
    ctx.beginPath();
    ctx.arc(k.x + 22 * s, k.y + 14 * s + bounce, 16 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(k.x + 14 * s, k.y + 10 * s + bounce, 5 * s, 5 * s);
    ctx.fillRect(k.x + 26 * s, k.y + 10 * s + bounce, 5 * s, 5 * s);
    if (Math.floor(kongFrame / 18) % 2 === 0) {
      ctx.fillStyle = "#5c3310";
      ctx.beginPath();
      ctx.arc(k.x + 38 * s, k.y + 20 * s + bounce, 7 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlayer() {
    const { x, y, w, h, facing } = player;
    ctx.fillStyle = "#e63946";
    ctx.fillRect(x + 2, y + 9, w - 4, h - 9);
    ctx.fillStyle = "#1d3557";
    ctx.fillRect(x + 1, y + h - 7, w - 2, 6);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(x + 3, y + 2, w - 6, 7);
    ctx.fillStyle = "#e63946";
    ctx.fillRect(x + (facing > 0 ? w - 3 : 0), y + 11, 3, 7);
  }

  function drawGoal() {
    const g = layout.goal;
    ctx.fillStyle = "#ff69b4";
    ctx.beginPath();
    ctx.arc(g.x + 10 * size.dpr, g.y + 14 * size.dpr, 10 * size.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd700";
    ctx.font = `bold ${11 * size.dpr}px monospace`;
    ctx.fillText("HELP!", g.x - 2 * size.dpr, g.y - 2 * size.dpr);
  }

  function draw() {
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, size.w, size.h);

    for (const l of layout.ladders) drawLadder(l);
    for (const p of layout.platforms) drawSlopedPlatform(p);
    drawKong();
    drawGoal();

    for (const b of barrels) {
      ctx.fillStyle = "#8b4513";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3d2914";
      ctx.lineWidth = 2 * size.dpr;
      ctx.stroke();
    }

    drawPlayer();

    hud.textContent = over
      ? `Game over · ${score} — Space to restart`
      : won
        ? `Level ${level} clear! · ${score}`
        : `Score ${score} · Lives ${lives} · Level ${level}`;

    if (over) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#ffd700";
      ctx.font = `bold ${20 * size.dpr}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", size.w / 2, size.h / 2);
      ctx.textAlign = "left";
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
