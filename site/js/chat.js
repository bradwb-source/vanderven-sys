(() => {
  const path = String(location.pathname || "").toLowerCase();
  // Marketing site only — never on CRM or login.
  if (
    path.startsWith("/app") ||
    path === "/login" ||
    path === "/login.html" ||
    document.body?.classList?.contains("login-page")
  ) {
    return;
  }

  const root = document.querySelector("[data-vera-chat]");
  if (!root) return;

  const STORAGE_KEY = "vs_vera_chat_v1";
  const WELCOME =
    "Hey — Vera here. Fire away: what you’re building, what’s broken, or what you’re curious about. I’m all ears.";

  const panel = root.querySelector("[data-vera-panel]");
  const openBtn = root.querySelector("[data-vera-open]");
  const closeBtn = root.querySelector("[data-vera-close]");
  const messagesEl = root.querySelector("[data-vera-messages]");
  const form = root.querySelector("[data-vera-form]");
  const input = root.querySelector("[data-vera-input]");
  const sendBtn = root.querySelector("[data-vera-send]");
  const errorEl = root.querySelector("[data-vera-error]");

  if (!panel || !openBtn || !messagesEl || !form || !input || !sendBtn) return;

  let sessionId = "";
  let messages = [];
  let busy = false;

  function loadState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.messages)) messages = data.messages.slice(-12);
      if (typeof data.sessionId === "string") sessionId = data.sessionId;
    } catch {
      /* ignore */
    }
  }

  function saveState() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sessionId, messages: messages.slice(-12) })
      );
    } catch {
      /* ignore */
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setError(text) {
    if (!errorEl) return;
    if (!text) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = text;
  }

  function renderMessages() {
    const rows = messages.length
      ? messages
      : [{ role: "assistant", content: WELCOME }];

    messagesEl.innerHTML = rows
      .map((msg) => {
        const cls = msg.role === "user" ? "is-user" : "is-vera";
        return `<div class="vera-chat__msg ${cls}"><p>${escapeHtml(msg.content)}</p></div>`;
      })
      .join("");

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setOpen(open) {
    const next = Boolean(open);
    panel.hidden = !next;
    openBtn.setAttribute("aria-expanded", next ? "true" : "false");
    root.classList.toggle("is-open", next);
    if (next) {
      renderMessages();
      setTimeout(() => input.focus(), 80);
    } else {
      openBtn.focus();
    }
  }

  function setBusy(next) {
    busy = next;
    sendBtn.disabled = next;
    input.disabled = next;
    sendBtn.setAttribute("aria-busy", next ? "true" : "false");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showTyping() {
    const typing = document.createElement("div");
    typing.className = "vera-chat__msg is-vera is-typing";
    typing.setAttribute("aria-label", "Vera is typing");
    typing.innerHTML =
      `<p class="vera-chat__dots" aria-hidden="true"><span></span><span></span><span></span></p>`;
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return typing;
  }

  function thinkDelayMs(userText, startedAt) {
    // Always linger a bit so replies don’t feel instant.
    const base = 1200;
    const byLength = Math.min(String(userText || "").length * 18, 1100);
    const target = base + byLength;
    return Math.max(0, target - (Date.now() - startedAt));
  }

  async function sendMessage(text) {
    const content = String(text || "").trim();
    if (!content || busy) return;

    setError("");
    messages.push({ role: "user", content });
    saveState();
    renderMessages();

    const typing = showTyping();
    const startedAt = Date.now();
    setBusy(true);
    try {
      const res = await fetch("/api/public/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          pagePath: location.pathname || "/",
          messages: messages.slice(-12),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.sessionId) sessionId = data.sessionId;

      if (!res.ok) {
        throw new Error(data.error || "Could not reach Vera right now.");
      }

      const reply = String(data.reply || "").trim();
      if (!reply) throw new Error("Vera didn’t send a reply. Try again?");

      await sleep(thinkDelayMs(content, startedAt));
      messages.push({ role: "assistant", content: reply });
      saveState();
      renderMessages();
    } catch (err) {
      await sleep(Math.min(700, thinkDelayMs(content, startedAt)));
      typing.remove();
      setError(err.message || "Something went wrong. You can still start a conversation.");
      // Keep the user message; they can retry or rephrase.
      renderMessages();
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  openBtn.addEventListener("click", () => setOpen(panel.hasAttribute("hidden")));
  closeBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value;
    input.value = "";
    sendMessage(value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });

  loadState();
  renderMessages();

  // Soft entrance so it doesn’t fight the hero.
  const revealDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
  window.setTimeout(() => {
    root.hidden = false;
    root.classList.add("is-ready");
  }, revealDelay);
})();
