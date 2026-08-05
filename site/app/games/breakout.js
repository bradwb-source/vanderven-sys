function resize(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  return { w: canvas.width, h: canvas.height, dpr };
}

export function mountBreakout(root) {
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
  let bricks = [];
  let paddle = { x: 0, y: 0, w: 90, h: 12 };
  let ball = { x: 0, y: 0, r: 6, vx: 0, vy: 0, launched: false };
  const keys = new Set();
  let pointerX = null;

  const palette = ["#e07155", "#f4a261", "#f4d35e", "#7bed9f", "#4ecdc4", "#4d9de0"];

  function layoutBricks() {
    bricks = [];
    const rows = 6;
    const cols = 10;
    const gap = 4 * size.dpr;
    const top = size.h * 0.12;
    const side = size.w * 0.06;
    const bw = (size.w - side * 2 - gap * (cols - 1)) / cols;
    const bh = 14 * size.dpr;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        bricks.push({
          x: side + c * (bw + gap),
          y: top + r * (bh + gap),
          w: bw,
          h: bh,
          hp: 1,
          color: palette[r % palette.length],
        });
      }
    }
  }

  function resetBall(launch = false) {
    ball.r = 6 * size.dpr;
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - ball.r - 2;
    ball.vx = 0;
    ball.vy = 0;
    ball.launched = launch;
    if (launch) {
      const a = (-Math.PI / 2) + (Math.random() - 0.5) * 0.7;
      const spd = 5.2 * size.dpr;
      ball.vx = Math.cos(a) * spd;
      ball.vy = Math.sin(a) * spd;
    }
  }

  function layout() {
    paddle.w = 96 * size.dpr;
    paddle.h = 12 * size.dpr;
    paddle.y = size.h * 0.88;
    paddle.x = size.w / 2 - paddle.w / 2;
    layoutBricks();
    resetBall(false);
  }

  layout();

  const onKey = (e, down) => {
    if (["ArrowLeft", "ArrowRight", " ", "Space"].includes(e.key)) e.preventDefault();
    const k = e.key === " " ? "Space" : e.key;
    if (down) keys.add(k);
    else keys.delete(k);
    if (down && (k === "Space" || k === "Enter") && !ball.launched && lives > 0) resetBall(true);
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    pointerX = ((clientX - rect.left) / rect.width) * size.w;
  };
  const onClick = () => {
    if (!ball.launched && lives > 0) resetBall(true);
  };
  const onResize = () => {
    size = resize(canvas);
    layout();
  };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("resize", onResize);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("touchmove", onMove, { passive: true });
  canvas.addEventListener("mousedown", onClick);
  canvas.addEventListener("touchstart", onClick, { passive: true });

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
    if (lives <= 0) return;
    const spd = 7 * size.dpr * t;
    if (keys.has("ArrowLeft")) paddle.x -= spd;
    if (keys.has("ArrowRight")) paddle.x += spd;
    if (pointerX != null) paddle.x = pointerX - paddle.w / 2;
    paddle.x = Math.max(8, Math.min(size.w - paddle.w - 8, paddle.x));

    if (!ball.launched) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 2;
      return;
    }

    ball.x += ball.vx * t;
    ball.y += ball.vy * t;

    if (ball.x < ball.r) {
      ball.x = ball.r;
      ball.vx *= -1;
    }
    if (ball.x > size.w - ball.r) {
      ball.x = size.w - ball.r;
      ball.vx *= -1;
    }
    if (ball.y < ball.r) {
      ball.y = ball.r;
      ball.vy *= -1;
    }

    if (
      ball.vy > 0 &&
      ball.y + ball.r >= paddle.y &&
      ball.y - ball.r <= paddle.y + paddle.h &&
      ball.x >= paddle.x &&
      ball.x <= paddle.x + paddle.w
    ) {
      const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      const ang = (-Math.PI / 2) + hit * 1.05;
      const spdBall = Math.hypot(ball.vx, ball.vy) * 1.02;
      ball.vx = Math.cos(ang) * spdBall;
      ball.vy = Math.sin(ang) * spdBall;
      ball.y = paddle.y - ball.r - 1;
    }

    for (const b of bricks) {
      if (b.hp <= 0) continue;
      if (
        ball.x + ball.r > b.x &&
        ball.x - ball.r < b.x + b.w &&
        ball.y + ball.r > b.y &&
        ball.y - ball.r < b.y + b.h
      ) {
        b.hp = 0;
        score += 10;
        const overlapX = Math.min(ball.x + ball.r - b.x, b.x + b.w - (ball.x - ball.r));
        const overlapY = Math.min(ball.y + ball.r - b.y, b.y + b.h - (ball.y - ball.r));
        if (overlapX < overlapY) ball.vx *= -1;
        else ball.vy *= -1;
        break;
      }
    }

    if (bricks.every((b) => b.hp <= 0)) {
      layoutBricks();
      resetBall(false);
      score += 100;
    }

    if (ball.y > size.h + 20) {
      lives--;
      resetBall(false);
    }
  }

  function draw() {
    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, size.w, size.h);

    for (const b of bricks) {
      if (b.hp <= 0) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(b.x, b.y, b.w, 3);
    }

    ctx.fillStyle = "#e8edf5";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(paddle.x + 4, paddle.y + 2, paddle.w - 8, 3);

    ctx.fillStyle = "#f4f7fb";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    hud.textContent =
      lives <= 0
        ? `Game over · ${score} — Space to restart`
        : `Score ${score} · Lives ${lives}${ball.launched ? "" : " · Space / click to serve"}`;

    if (lives <= 0) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = `${16 * size.dpr}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("BRICKS WIN", size.w / 2, size.h / 2);
    }
  }

  const restart = (e) => {
    if (lives > 0) return;
    if (e.key !== " " && e.key !== "Space" && e.key !== "Enter") return;
    score = 0;
    lives = 3;
    layout();
  };
  window.addEventListener("keydown", restart);

  requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("keydown", restart);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("mousedown", onClick);
      canvas.removeEventListener("touchstart", onClick);
      root.innerHTML = "";
    },
  };
}
