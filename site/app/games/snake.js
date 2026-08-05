function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

export function mountSnake(root) {
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
  let dead = false;
  let dir = { x: 1, y: 0 };
  let pending = { x: 1, y: 0 };
  let cols = 24;
  let rows = 16;
  let cell = 16;
  let snake = [];
  let food = { x: 10, y: 8 };
  let tick = 0;
  let speed = 9;

  function layout() {
    cell = Math.floor(Math.min(size.w / 28, size.h / 18));
    cols = Math.max(16, Math.floor(size.w / cell));
    rows = Math.max(12, Math.floor(size.h / cell));
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    snake = [
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
      { x: cx - 3, y: cy },
    ];
    dir = { x: 1, y: 0 };
    pending = { x: 1, y: 0 };
    score = 0;
    dead = false;
    speed = 9;
    placeFood();
  }

  function placeFood() {
    for (let n = 0; n < 200; n++) {
      const x = Math.floor(Math.random() * cols);
      const y = Math.floor(Math.random() * rows);
      if (!snake.some((s) => s.x === x && s.y === y)) {
        food = { x, y };
        return;
      }
    }
  }

  layout();

  const onKey = (e) => {
    const map = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    };
    const next = map[e.key];
    if (!next) return;
    e.preventDefault();
    if (next.x === -dir.x && next.y === -dir.y) return;
    pending = next;
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
    tick += dt;
    const interval = 1000 / speed;
    while (tick >= interval) {
      tick -= interval;
      step();
    }
    draw();
    requestAnimationFrame(frame);
  }

  function step() {
    if (dead) return;
    dir = pending;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) {
      dead = true;
      return;
    }
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      dead = true;
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      speed = Math.min(18, 9 + Math.floor(score / 40));
      placeFood();
    } else {
      snake.pop();
    }
  }

  function draw() {
    const ox = (size.w - cols * cell) / 2;
    const oy = (size.h - rows * cell) / 2;
    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.strokeStyle = "rgba(80,120,90,0.18)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cell, oy);
      ctx.lineTo(ox + x * cell, oy + rows * cell);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * cell);
      ctx.lineTo(ox + cols * cell, oy + y * cell);
      ctx.stroke();
    }

    ctx.fillStyle = "#d4a84b";
    ctx.beginPath();
    ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
    ctx.fill();

    snake.forEach((s, i) => {
      const t = i / Math.max(1, snake.length - 1);
      ctx.fillStyle = i === 0 ? "#7dff9a" : `rgba(46,160,90,${0.95 - t * 0.45})`;
      ctx.fillRect(ox + s.x * cell + 1, oy + s.y * cell + 1, cell - 2, cell - 2);
    });

    hud.textContent = dead ? `Game over · ${score} — press an arrow to restart` : `Score ${score}`;
    if (dead) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${16 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("SNAKE BIT IT", size.w / 2, size.h / 2);
    }
  }

  const restartOnKey = (e) => {
    if (!dead) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(e.key)) return;
    layout();
  };
  window.addEventListener("keydown", restartOnKey);

  requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", restartOnKey);
      window.removeEventListener("resize", onResize);
      root.innerHTML = "";
    },
  };
}
