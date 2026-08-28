function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

// 0 wall · 1 pellet · 2 empty · 3 power  (all rows length 19)
const RAW = [
  "###################",
  "#........#........#",
  "#o##.###.#.###.##o#",
  "#.................#",
  "#.##.#.#####.#.##.#",
  "#....#...#...#....#",
  "####.### # ###.####",
  "   #.#       #.#   ",
  "####.# ## ## #.####",
  ".....# # g # #.....",
  "####.# ##### #.####",
  "   #.#       #.#   ",
  "####.#.#####.#.####",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#o.#...........#.o#",
  "##.#.#.#####.#.#.##",
  "#....#...P...#....#",
  "#.######.#.######.#",
  "#.................#",
  "###################",
];

export function mountPacMan(root) {
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
  let cell = 16;
  let ox = 0;
  let oy = 0;
  let grid = [];
  let rows = 0;
  let cols = 0;
  let pac = null;
  let ghosts = [];
  let mouth = 0;
  let fright = 0;
  let pending = null;
  let pacTile = { x: 9, y: 17 };

  function parseLevel() {
    grid = RAW.map((row) =>
      [...row].map((ch) => {
        if (ch === "#") return 0;
        if (ch === "o") return 3;
        if (ch === "." ) return 1;
        return 2;
      })
    );
    rows = grid.length;
    cols = grid[0].length;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (RAW[y][x] === "P") pacTile = { x, y };
      }
    }
  }

  function tileCenter(tx, ty) {
    return { x: ox + tx * cell + cell / 2, y: oy + ty * cell + cell / 2 };
  }

  function resetActors() {
    const start = tileCenter(pacTile.x, pacTile.y);
    pac = { x: start.x, y: start.y, dir: { x: -1, y: 0 }, speed: 2.05 };
    const spots = [
      { x: 8, y: 9, color: "#e07155" },
      { x: 9, y: 9, color: "#f4a8c8" },
      { x: 10, y: 9, color: "#4ecdc4" },
      { x: 9, y: 8, color: "#f4a261" },
    ];
    ghosts = spots.map((s) => {
      const c = tileCenter(s.x, s.y);
      return { x: c.x, y: c.y, dir: { x: 1, y: 0 }, color: s.color };
    });
    fright = 0;
    pending = null;
  }

  function layout() {
    parseLevel();
    cell = Math.floor(Math.min(size.w / cols, size.h / rows));
    ox = (size.w - cols * cell) / 2;
    oy = (size.h - rows * cell) / 2;
    resetActors();
  }

  function tileAt(px, py) {
    return {
      x: Math.floor((px - ox) / cell),
      y: Math.floor((py - oy) / cell),
    };
  }

  function isWall(tx, ty) {
    if (ty < 0 || ty >= rows || tx < 0 || tx >= cols) return true;
    return grid[ty][tx] === 0;
  }

  function canMove(px, py, dir) {
    const look = cell * 0.42;
    const t = tileAt(px + dir.x * look, py + dir.y * look);
    return !isWall(t.x, t.y);
  }

  function centered(px, py) {
    const t = tileAt(px, py);
    const c = tileCenter(t.x, t.y);
    return Math.abs(px - c.x) < 2.4 * size.dpr && Math.abs(py - c.y) < 2.4 * size.dpr;
  }

  function snap(actor) {
    const t = tileAt(actor.x, actor.y);
    const c = tileCenter(t.x, t.y);
    actor.x = c.x;
    actor.y = c.y;
  }

  layout();

  const onKey = (e) => {
    const map = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    if ((over || won) && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      score = 0;
      lives = 3;
      over = false;
      won = false;
      layout();
      return;
    }
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    pending = d;
  };
  const onResize = () => {
    size = resize(canvas);
    layout();
  };
  window.addEventListener("keydown", onKey);
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

  function moveActor(actor, speed, isGhost) {
    if (centered(actor.x, actor.y)) {
      snap(actor);
      if (!isGhost && pending && canMove(actor.x, actor.y, pending)) {
        actor.dir = pending;
        pending = null;
      }
      if (!canMove(actor.x, actor.y, actor.dir)) {
        if (isGhost) {
          const options = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
          ].filter((d) => !(d.x === -actor.dir.x && d.y === -actor.dir.y) && canMove(actor.x, actor.y, d));
          if (options.length) actor.dir = options[Math.floor(Math.random() * options.length)];
          else actor.dir = { x: -actor.dir.x, y: -actor.dir.y };
        } else {
          actor.dir = { x: 0, y: 0 };
        }
      } else if (isGhost && Math.random() < 0.18) {
        const options = [
          { x: 1, y: 0 },
          { x: -1, y: 0 },
          { x: 0, y: 1 },
          { x: 0, y: -1 },
        ].filter((d) => canMove(actor.x, actor.y, d));
        if (options.length) actor.dir = options[Math.floor(Math.random() * options.length)];
      }
    }
    if (actor.dir.x || actor.dir.y) {
      actor.x += actor.dir.x * speed;
      actor.y += actor.dir.y * speed;
    }
    if (actor.x < ox - cell) actor.x = ox + cols * cell - 2;
    if (actor.x > ox + cols * cell + cell) actor.x = ox + 2;
  }

  function step(t) {
    if (over || won) return;
    mouth += t * 0.35;
    if (fright > 0) fright -= t;
    moveActor(pac, pac.speed * size.dpr * t, false);

    const tPac = tileAt(pac.x, pac.y);
    if (tPac.y >= 0 && tPac.y < rows && tPac.x >= 0 && tPac.x < cols) {
      if (grid[tPac.y][tPac.x] === 1) {
        grid[tPac.y][tPac.x] = 2;
        score += 10;
      } else if (grid[tPac.y][tPac.x] === 3) {
        grid[tPac.y][tPac.x] = 2;
        score += 50;
        fright = 420;
      }
    }

    const gSpd = (fright > 0 ? 1.3 : 1.8) * size.dpr * t;
    for (const g of ghosts) {
      moveActor(g, gSpd, true);
      const dx = g.x - pac.x;
      const dy = g.y - pac.y;
      if (dx * dx + dy * dy < (cell * 0.55) ** 2) {
        if (fright > 0) {
          score += 200;
          const home = tileCenter(9, 9);
          g.x = home.x;
          g.y = home.y;
        } else {
          lives--;
          if (lives <= 0) over = true;
          else resetActors();
          return;
        }
      }
    }

    let pellets = 0;
    for (const row of grid) for (const c of row) if (c === 1 || c === 3) pellets++;
    if (pellets === 0) {
      won = true;
      score += 500;
    }
  }

  function draw() {
    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, size.w, size.h);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[y][x];
        const px = ox + x * cell;
        const py = oy + y * cell;
        if (RAW[y][x] === "#") {
          ctx.fillStyle = "#1a3a6e";
          ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          ctx.strokeStyle = "#3d7cff";
          ctx.lineWidth = Math.max(1, size.dpr);
          ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
        } else if (v === 1) {
          ctx.fillStyle = "#f0d9a0";
          ctx.beginPath();
          ctx.arc(px + cell / 2, py + cell / 2, Math.max(1.5, cell * 0.1), 0, Math.PI * 2);
          ctx.fill();
        } else if (v === 3) {
          ctx.fillStyle = "#f0d9a0";
          ctx.beginPath();
          ctx.arc(px + cell / 2, py + cell / 2, cell * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    for (const g of ghosts) {
      ctx.fillStyle = fright > 0 ? (Math.floor(fright / 20) % 2 ? "#2a4a9a" : "#9ab0ff") : g.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, cell * 0.38, Math.PI, 0);
      ctx.lineTo(g.x + cell * 0.38, g.y + cell * 0.38);
      ctx.lineTo(g.x + cell * 0.18, g.y + cell * 0.22);
      ctx.lineTo(g.x, g.y + cell * 0.38);
      ctx.lineTo(g.x - cell * 0.18, g.y + cell * 0.22);
      ctx.lineTo(g.x - cell * 0.38, g.y + cell * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(g.x - cell * 0.12, g.y - cell * 0.05, cell * 0.08, 0, Math.PI * 2);
      ctx.arc(g.x + cell * 0.12, g.y - cell * 0.05, cell * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }

    const bite = (Math.sin(mouth) * 0.35 + 0.35) * Math.PI;
    let ang = 0;
    if (pac.dir.x === 1) ang = 0;
    if (pac.dir.x === -1) ang = Math.PI;
    if (pac.dir.y === -1) ang = -Math.PI / 2;
    if (pac.dir.y === 1) ang = Math.PI / 2;
    ctx.fillStyle = "#f4d35e";
    ctx.beginPath();
    ctx.moveTo(pac.x, pac.y);
    ctx.arc(pac.x, pac.y, cell * 0.4, ang + bite / 2, ang + Math.PI * 2 - bite / 2);
    ctx.closePath();
    ctx.fill();

    hud.textContent = over
      ? `Game over · ${score} — Enter to restart`
      : won
        ? `You cleared the maze · ${score} — Enter to replay`
        : `Score ${score} · Lives ${lives}${fright > 0 ? " · POWER" : ""}`;

    if (over || won) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${16 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(won ? "MAZE CLEARED" : "GHOSTED", size.w / 2, size.h / 2);
    }
  }

  requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      root.innerHTML = "";
    },
  };
}
