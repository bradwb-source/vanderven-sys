function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

export function mountSpaceInvaders(root) {
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
  let dir = 1;
  let cool = 0;
  const keys = new Set();

  const player = { w: 28, h: 12, x: 0, y: 0 };
  let aliens = [];
  let bullets = [];
  let bombs = [];
  let bunkers = [];

  function layout() {
    player.x = size.w / 2 - player.w / 2;
    player.y = size.h * 0.88;
    bunkers = [0.2, 0.4, 0.6, 0.8].map((p) => ({
      x: size.w * p - 22,
      y: size.h * 0.72,
      w: 44,
      h: 22,
      hp: 8,
    }));
    aliens = [];
    const cols = 9;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        aliens.push({
          x: size.w * 0.12 + c * (size.w * 0.085),
          y: size.h * 0.12 + r * 28 * size.dpr,
          w: 18 * size.dpr,
          h: 12 * size.dpr,
          kind: r,
        });
      }
    }
    dir = 1;
    bullets = [];
    bombs = [];
  }

  layout();

  const onKey = (e, down) => {
    if (["ArrowLeft", "ArrowRight", " ", "Space"].includes(e.key)) e.preventDefault();
    const k = e.key === " " ? "Space" : e.key;
    if (down) keys.add(k);
    else keys.delete(k);
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  const onResize = () => {
    size = resize(canvas);
    layout();
  };
  window.addEventListener("resize", onResize);

  let last = performance.now();
  let stepAccum = 0;

  function frame(now) {
    if (!alive) return;
    const dt = Math.min(32, now - last);
    last = now;
    step(dt / 16.67);
    draw();
    requestAnimationFrame(frame);
  }

  function step(t) {
    if (lives <= 0) return;
    if (keys.has("ArrowLeft")) player.x -= 4.2 * t * size.dpr;
    if (keys.has("ArrowRight")) player.x += 4.2 * t * size.dpr;
    player.x = Math.max(8, Math.min(size.w - player.w - 8, player.x));
    if (cool > 0) cool -= t;
    if ((keys.has("Space") || keys.has(" ")) && cool <= 0) {
      bullets.push({ x: player.x + player.w / 2, y: player.y, vy: -7 * size.dpr });
      cool = 12;
    }

    bullets = bullets.filter((b) => {
      b.y += b.vy * t;
      return b.y > 0;
    });
    bombs = bombs.filter((b) => {
      b.y += b.vy * t;
      return b.y < size.h;
    });

    stepAccum += t;
    const cadence = Math.max(6, 18 - Math.floor((54 - aliens.length) / 4));
    if (stepAccum >= cadence) {
      stepAccum = 0;
      let hitEdge = false;
      for (const a of aliens) {
        a.x += dir * 8 * size.dpr;
        if (a.x < 10 || a.x + a.w > size.w - 10) hitEdge = true;
      }
      if (hitEdge) {
        dir *= -1;
        for (const a of aliens) a.y += 14 * size.dpr;
      }
      if (aliens.length && Math.random() < 0.35) {
        const shooter = aliens[Math.floor(Math.random() * aliens.length)];
        bombs.push({
          x: shooter.x + shooter.w / 2,
          y: shooter.y + shooter.h,
          vy: 3.2 * size.dpr,
        });
      }
    }

    bullets = bullets.filter((b) => {
      let hit = false;
      aliens = aliens.filter((a) => {
        if (b.x > a.x && b.x < a.x + a.w && b.y > a.y && b.y < a.y + a.h) {
          hit = true;
          score += 10 + (3 - a.kind) * 10;
          return false;
        }
        return true;
      });
      bunkers.forEach((k) => {
        if (k.hp > 0 && b.x > k.x && b.x < k.x + k.w && b.y > k.y && b.y < k.y + k.h) {
          k.hp -= 1;
          hit = true;
        }
      });
      return !hit;
    });

    bombs = bombs.filter((b) => {
      if (b.x > player.x && b.x < player.x + player.w && b.y > player.y && b.y < player.y + player.h) {
        lives -= 1;
        player.x = size.w / 2 - player.w / 2;
        return false;
      }
      let hit = false;
      bunkers.forEach((k) => {
        if (k.hp > 0 && b.x > k.x && b.x < k.x + k.w && b.y > k.y && b.y < k.y + k.h) {
          k.hp -= 1;
          hit = true;
        }
      });
      return !hit;
    });

    if (aliens.some((a) => a.y + a.h >= player.y)) lives = 0;
    if (!aliens.length) layout();

    hud.innerHTML = `<span>SCORE ${score}</span><span>LIVES ${Math.max(0, lives)}</span>`;
  }

  function draw() {
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, size.w, size.h);

    for (const k of bunkers) {
      if (k.hp <= 0) continue;
      ctx.fillStyle = `rgba(47,107,69,${0.35 + k.hp / 12})`;
      ctx.fillRect(k.x, k.y, k.w, k.h);
    }

    ctx.fillStyle = "#1f7a6c";
    for (const a of aliens) {
      ctx.fillRect(a.x, a.y, a.w, a.h);
      ctx.fillStyle = "#b8efe4";
      ctx.fillRect(a.x + 3, a.y + 3, 3, 3);
      ctx.fillRect(a.x + a.w - 6, a.y + 3, 3, 3);
      ctx.fillStyle = "#1f7a6c";
    }

    ctx.fillStyle = "#f0c56d";
    for (const b of bullets) ctx.fillRect(b.x - 1.5, b.y - 6, 3, 8);
    ctx.fillStyle = "#e07155";
    for (const b of bombs) ctx.fillRect(b.x - 1.5, b.y, 3, 8);

    if (lives > 0) {
      ctx.fillStyle = "#e8edf5";
      ctx.fillRect(player.x, player.y, player.w, player.h);
      ctx.fillRect(player.x + player.w / 2 - 3, player.y - 6, 6, 6);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${18 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("INVADED — back to library to replay", size.w / 2, size.h / 2);
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
