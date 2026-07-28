function createCanvas(root) {
  const canvas = document.createElement("canvas");
  root.innerHTML = "";
  root.appendChild(canvas);
  const hud = document.createElement("div");
  hud.className = "games-hud";
  root.appendChild(hud);
  return { canvas, hud };
}

function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

export function mountAsteroids(root) {
  const { canvas, hud } = createCanvas(root);
  const ctx = canvas.getContext("2d");
  let size = resize(canvas);
  let alive = true;
  let score = 0;
  let lives = 3;
  let wave = 1;
  const keys = new Set();

  const ship = {
    x: size.w / 2,
    y: size.h / 2,
    a: -Math.PI / 2,
    vx: 0,
    vy: 0,
    cool: 0,
  };
  let bullets = [];
  let rocks = [];
  let flash = 0;

  function spawnWave(n) {
    rocks = [];
    for (let i = 0; i < n; i++) {
      const side = Math.floor(Math.random() * 4);
      let x = Math.random() * size.w;
      let y = Math.random() * size.h;
      if (side === 0) y = -20;
      if (side === 1) y = size.h + 20;
      if (side === 2) x = -20;
      if (side === 3) x = size.w + 20;
      rocks.push(makeRock(x, y, 34 + Math.random() * 10, 1));
    }
  }

  function makeRock(x, y, r, gen) {
    const a = Math.random() * Math.PI * 2;
    const spd = (0.6 + Math.random() * 0.9) * (size.dpr || 1);
    return {
      x,
      y,
      r,
      gen,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      spin: (Math.random() - 0.5) * 0.04,
      rot: Math.random() * Math.PI * 2,
      pts: 8 + Math.floor(Math.random() * 4),
    };
  }

  function wrap(o) {
    if (o.x < -o.r) o.x = size.w + o.r;
    if (o.x > size.w + o.r) o.x = -o.r;
    if (o.y < -o.r) o.y = size.h + o.r;
    if (o.y > size.h + o.r) o.y = -o.r;
  }

  function resetShip() {
    ship.x = size.w / 2;
    ship.y = size.h / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.a = -Math.PI / 2;
    flash = 90;
  }

  spawnWave(3);
  resetShip();

  const onKey = (e, down) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", " ", "Space"].includes(e.key)) e.preventDefault();
    const k = e.key === " " ? "Space" : e.key;
    if (down) keys.add(k);
    else keys.delete(k);
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  const onResize = () => {
    const prev = size;
    size = resize(canvas);
    ship.x *= size.w / prev.w;
    ship.y *= size.h / prev.h;
  };
  window.addEventListener("resize", onResize);

  let last = performance.now();
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(32, now - last);
    last = now;
    step(dt / 16.67);
    draw();
    requestAnimationFrame(frame);
  }

  function step(t) {
    if (keys.has("ArrowLeft")) ship.a -= 0.07 * t;
    if (keys.has("ArrowRight")) ship.a += 0.07 * t;
    if (keys.has("ArrowUp")) {
      ship.vx += Math.cos(ship.a) * 0.18 * t;
      ship.vy += Math.sin(ship.a) * 0.18 * t;
    }
    ship.vx *= 0.99;
    ship.vy *= 0.99;
    ship.x += ship.vx * t;
    ship.y += ship.vy * t;
    wrap(ship);
    if (ship.cool > 0) ship.cool -= t;
    if ((keys.has("Space") || keys.has(" ")) && ship.cool <= 0) {
      bullets.push({
        x: ship.x + Math.cos(ship.a) * 14,
        y: ship.y + Math.sin(ship.a) * 14,
        vx: Math.cos(ship.a) * 9 + ship.vx,
        vy: Math.sin(ship.a) * 9 + ship.vy,
        // Long enough to cross most of a large CRM stage before fading.
        life: 120,
      });
      ship.cool = 7;
    }
    if (flash > 0) flash -= t;

    bullets = bullets.filter((b) => {
      b.x += b.vx * t;
      b.y += b.vy * t;
      b.life -= t;
      wrap(b);
      return b.life > 0;
    });

    for (const r of rocks) {
      r.x += r.vx * t;
      r.y += r.vy * t;
      r.rot += r.spin * t;
      wrap(r);
    }

    const nextRocks = [];
    const keepBullets = [];
    for (const b of bullets) {
      let hit = false;
      for (const r of rocks) {
        const dx = b.x - r.x;
        const dy = b.y - r.y;
        if (dx * dx + dy * dy < r.r * r.r) {
          hit = true;
          score += r.gen === 1 ? 20 : r.gen === 2 ? 50 : 100;
          if (r.r > 16) {
            nextRocks.push(makeRock(r.x, r.y, r.r * 0.55, r.gen + 1));
            nextRocks.push(makeRock(r.x, r.y, r.r * 0.55, r.gen + 1));
          }
          r.dead = true;
          break;
        }
      }
      if (!hit) keepBullets.push(b);
    }
    bullets = keepBullets;
    rocks = rocks.filter((r) => !r.dead).concat(nextRocks);

    if (flash <= 0) {
      for (const r of rocks) {
        const dx = ship.x - r.x;
        const dy = ship.y - r.y;
        if (dx * dx + dy * dy < (r.r + 10) * (r.r + 10)) {
          lives -= 1;
          if (lives <= 0) {
            lives = 0;
          } else {
            resetShip();
          }
          break;
        }
      }
    }

    if (!rocks.length && lives > 0) {
      wave += 1;
      spawnWave(Math.min(7, 2 + wave));
    }

    hud.innerHTML = `<span>SCORE ${score}</span><span>WAVE ${wave}</span><span>LIVES ${lives}</span>`;
  }

  function draw() {
    ctx.fillStyle = "#070a10";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.strokeStyle = "#c9d2e3";
    ctx.lineWidth = 1.5 * size.dpr;

    for (const r of rocks) {
      ctx.beginPath();
      for (let i = 0; i < r.pts; i++) {
        const ang = r.rot + (i / r.pts) * Math.PI * 2;
        const rad = r.r * (0.75 + ((i * 37) % 5) * 0.05);
        const x = r.x + Math.cos(ang) * rad;
        const y = r.y + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.fillStyle = "#f0c56d";
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2 * size.dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (lives > 0 && (flash <= 0 || Math.floor(flash / 6) % 2 === 0)) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.a);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-10, 9);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-10, -9);
      ctx.closePath();
      ctx.strokeStyle = "#f4f7fb";
      ctx.stroke();
      if (keys.has("ArrowUp")) {
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(-14 - Math.random() * 6, 0);
        ctx.strokeStyle = "#b8953e";
        ctx.stroke();
      }
      ctx.restore();
    }

    if (lives <= 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${18 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER — refresh library tile to replay", size.w / 2, size.h / 2);
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
