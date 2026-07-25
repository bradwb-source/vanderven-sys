function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
};
const COLORS = {
  I: "#4ecdc4",
  O: "#f4d35e",
  T: "#9b5de5",
  S: "#7bed9f",
  Z: "#e07155",
  J: "#4d9de0",
  L: "#f4a261",
};
const BAG = Object.keys(SHAPES);

export function mountTetris(root) {
  const canvas = document.createElement("canvas");
  const hud = document.createElement("div");
  hud.className = "games-hud";
  root.innerHTML = "";
  root.appendChild(canvas);
  root.appendChild(hud);
  const ctx = canvas.getContext("2d");
  let size = resize(canvas);
  let alive = true;
  const cols = 10;
  const rows = 20;
  let grid = [];
  let piece = null;
  let nextKey = BAG[0];
  let score = 0;
  let lines = 0;
  let level = 1;
  let over = false;
  let dropMs = 700;
  let dropAcc = 0;
  let cell = 20;

  function emptyGrid() {
    grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  }

  function rotate(m) {
    const h = m.length;
    const w = m[0].length;
    const out = Array.from({ length: w }, () => Array(h).fill(0));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x][h - 1 - y] = m[y][x];
    return out;
  }

  function spawn() {
    const key = nextKey;
    nextKey = BAG[Math.floor(Math.random() * BAG.length)];
    const shape = SHAPES[key].map((r) => r.slice());
    piece = {
      key,
      shape,
      x: Math.floor((cols - shape[0].length) / 2),
      y: 0,
    };
    if (collides(piece.shape, piece.x, piece.y)) over = true;
  }

  function collides(shape, ox, oy) {
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        const gx = ox + x;
        const gy = oy + y;
        if (gx < 0 || gx >= cols || gy >= rows) return true;
        if (gy >= 0 && grid[gy][gx]) return true;
      }
    }
    return false;
  }

  function lock() {
    for (let y = 0; y < piece.shape.length; y++) {
      for (let x = 0; x < piece.shape[y].length; x++) {
        if (!piece.shape[y][x]) continue;
        const gy = piece.y + y;
        const gx = piece.x + x;
        if (gy >= 0) grid[gy][gx] = piece.key;
      }
    }
    let cleared = 0;
    for (let y = rows - 1; y >= 0; y--) {
      if (grid[y].every(Boolean)) {
        grid.splice(y, 1);
        grid.unshift(Array(cols).fill(null));
        cleared++;
        y++;
      }
    }
    if (cleared) {
      lines += cleared;
      score += [0, 100, 300, 500, 800][cleared] * level;
      level = 1 + Math.floor(lines / 10);
      dropMs = Math.max(120, 700 - (level - 1) * 55);
    }
    spawn();
  }

  function hardDrop() {
    if (over || !piece) return;
    while (!collides(piece.shape, piece.x, piece.y + 1)) piece.y++;
    score += 2;
    lock();
  }

  function reset() {
    emptyGrid();
    score = 0;
    lines = 0;
    level = 1;
    dropMs = 700;
    dropAcc = 0;
    over = false;
    nextKey = BAG[Math.floor(Math.random() * BAG.length)];
    spawn();
  }

  function layout() {
    cell = Math.floor(Math.min((size.w * 0.55) / cols, (size.h * 0.9) / rows));
  }

  reset();
  layout();

  const onKey = (e) => {
    if (over && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      reset();
      return;
    }
    if (!piece || over) return;
    if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "Space"].includes(e.key)) e.preventDefault();
    if (e.key === "ArrowLeft" && !collides(piece.shape, piece.x - 1, piece.y)) piece.x--;
    if (e.key === "ArrowRight" && !collides(piece.shape, piece.x + 1, piece.y)) piece.x++;
    if (e.key === "ArrowDown") {
      if (!collides(piece.shape, piece.x, piece.y + 1)) {
        piece.y++;
        score += 1;
      } else lock();
    }
    if (e.key === "ArrowUp") {
      const rot = rotate(piece.shape);
      if (!collides(rot, piece.x, piece.y)) piece.shape = rot;
      else if (!collides(rot, piece.x - 1, piece.y)) {
        piece.x--;
        piece.shape = rot;
      } else if (!collides(rot, piece.x + 1, piece.y)) {
        piece.x++;
        piece.shape = rot;
      }
    }
    if (e.key === " " || e.key === "Space") hardDrop();
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
    const dt = Math.min(48, now - last);
    last = now;
    if (!over && piece) {
      dropAcc += dt;
      if (dropAcc >= dropMs) {
        dropAcc = 0;
        if (!collides(piece.shape, piece.x, piece.y + 1)) piece.y++;
        else lock();
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function drawCell(x, y, color, ox, oy) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(ox + x * cell + 1, oy + y * cell + 1, cell - 2, 3);
  }

  function draw() {
    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, size.w, size.h);
    const boardW = cols * cell;
    const boardH = rows * cell;
    const ox = Math.floor(size.w * 0.08);
    const oy = Math.floor((size.h - boardH) / 2);

    ctx.fillStyle = "#121820";
    ctx.fillRect(ox - 4, oy - 4, boardW + 8, boardH + 8);
    ctx.strokeStyle = "rgba(180,160,100,0.35)";
    ctx.strokeRect(ox - 4.5, oy - 4.5, boardW + 9, boardH + 9);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x]) drawCell(x, y, COLORS[grid[y][x]], ox, oy);
      }
    }
    if (piece) {
      for (let y = 0; y < piece.shape.length; y++) {
        for (let x = 0; x < piece.shape[y].length; x++) {
          if (!piece.shape[y][x]) continue;
          drawCell(piece.x + x, piece.y + y, COLORS[piece.key], ox, oy);
        }
      }
    }

    const nx = ox + boardW + 28 * size.dpr;
    ctx.fillStyle = "#e8edf5";
    ctx.font = `${13 * size.dpr}px Outfit, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("NEXT", nx, oy + 18 * size.dpr);
    const ns = SHAPES[nextKey];
    for (let y = 0; y < ns.length; y++) {
      for (let x = 0; x < ns[y].length; x++) {
        if (ns[y][x]) drawCell(x, y, COLORS[nextKey], nx, oy + 28 * size.dpr);
      }
    }
    ctx.fillText(`Score ${score}`, nx, oy + 120 * size.dpr);
    ctx.fillText(`Lines ${lines}`, nx, oy + 142 * size.dpr);
    ctx.fillText(`Level ${level}`, nx, oy + 164 * size.dpr);

    hud.textContent = over ? "Game over · Enter / Space to restart" : `Score ${score} · Level ${level}`;
    if (over) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(ox, oy, boardW, boardH);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${16 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("STACKED OUT", ox + boardW / 2, oy + boardH / 2);
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
