(() => {
  const STAGES = [
    { id: "new", label: "New", tone: "slate" },
    { id: "audit", label: "Audit", tone: "indigo" },
    { id: "quoted", label: "Quoted", tone: "gold" },
    { id: "active", label: "Active", tone: "teal" },
    { id: "won", label: "Won", tone: "green" },
    { id: "lost", label: "Lost", tone: "rust" },
  ];

  const QUOTE_STATUSES = [
    { id: "draft", label: "Draft", tone: "slate" },
    { id: "sent", label: "Sent", tone: "indigo" },
    { id: "revisions_requested", label: "Revisions requested", tone: "gold" },
    { id: "approved", label: "Approved", tone: "green" },
    { id: "declined", label: "Declined", tone: "rust" },
  ];

  const INVOICE_STATUSES = [
    { id: "draft", label: "Draft", tone: "slate" },
    { id: "sent", label: "Sent", tone: "gold" },
    { id: "paid", label: "Paid", tone: "green" },
    { id: "overdue", label: "Overdue", tone: "rust" },
  ];

  const JOB_STATUSES = [
    { id: "unscheduled", label: "Backlog", tone: "slate" },
    { id: "rough_draft", label: "Rough draft", tone: "indigo" },
    { id: "architecture", label: "Architecture", tone: "teal" },
    { id: "fine_tuning", label: "Fine tuning", tone: "gold" },
    { id: "client_approval", label: "Waiting on client", tone: "rust" },
    { id: "change_request", label: "Change request", tone: "rust" },
    { id: "done", label: "Delivered", tone: "green" },
  ];

  const JOB_STATUS_ALIASES = {
    scheduled: "rough_draft",
    discovery: "rough_draft",
    build: "architecture",
    review: "client_approval",
  };

  const VIEW_COPY = {
    home: { title: "Home", sub: "What each rep is doing today — appointments, stages, and follow-ups." },
    schedule: {
      title: "Schedule",
      sub: "Week or month — drag builds into slots. Day map pins every site visit.",
    },
    clients: { title: "Clients", sub: "Start here — then quote (optional), build, or invoice from the client." },
    requests: {
      title: "Requests",
      sub: "Internal handoffs — Rob logs what the client wants, Brad picks them up.",
    },
    quotes: {
      title: "Quotes",
      sub: "Optional step after a client — skip anytime and start a build from the client page.",
    },
    jobs: {
      title: "Builds",
      sub: "Starts from a client. Pipeline: backlog → rough draft → architecture → fine tuning → client approval.",
    },
    invoices: { title: "Invoices", sub: "Letterhead invoices by status — drafts, sent, overdue, and paid." },
    pipeline: { title: "Pipeline", sub: "Drag cards between stages to move the work." },
    vera: {
      title: "Vera",
      sub: "Shared sales inbox — every teammate can open website chats and follow up.",
    },
    reminders: { title: "Reminders", sub: "Automated quote follow-ups for you and the client." },
    settings: { title: "Settings", sub: "Password, users, quote attachments, and reminders." },
    games: { title: "Games", sub: "Four quick titles when you need a break." },
  };

  const LIST_VIEWS = new Set(["clients", "requests", "quotes", "jobs", "invoices"]);

  const state = {
    view: "home",
    leads: [],
    jobs: [],
    quotes: [],
    quoteDocuments: [],
    invoices: [],
    reminders: [],
    reminderSettings: null,
    users: [],
    sessionUser: null,
    clientDetail: null,
    jobDetail: null,
    revisionContext: null,
    query: "",
    statusFilter: "all",
    weekStart: startOfWeek(new Date()),
    monthCursor: startOfMonth(new Date()),
    calendarMode: "week",
    scheduleFocusDate: null,
    scheduleMapOpen: (() => {
      try {
        return localStorage.getItem("vs_schedule_map_open") !== "0";
      } catch {
        return true;
      }
    })(),
    scheduleMapFocusKey: "",
    dragId: null,
    dragKind: null,
    searchOpen: false,
    searchRemote: { notes: [], activity: [], query: "" },
    searchRemoteLoading: false,
    clientsSort: { key: "updated", dir: "desc" },
    veraChats: [],
    veraDetail: null,
    gamesActiveId: null,
    gamesHandle: null,
  };

  const SLOT_START_HOUR = 8;
  const SLOT_END_HOUR = 18; // last bookable hour starts at 6pm

  const els = {
    title: document.getElementById("view-title"),
    sub: document.getElementById("view-sub"),
    home: document.getElementById("view-home"),
    pipeline: document.getElementById("view-pipeline"),
    schedule: document.getElementById("view-schedule"),
    clients: document.getElementById("view-clients"),
    requests: document.getElementById("view-requests"),
    quotes: document.getElementById("view-quotes"),
    jobs: document.getElementById("view-jobs"),
    invoices: document.getElementById("view-invoices"),
    vera: document.getElementById("view-vera"),
    reminders: document.getElementById("view-reminders"),
    settings: document.getElementById("view-settings"),
    games: document.getElementById("view-games"),
    search: document.getElementById("search"),
    searchMenu: document.getElementById("search-menu"),
    searchPanel: document.getElementById("search-panel"),
    filterChips: document.getElementById("filter-chips"),
    weekNav: document.getElementById("week-nav"),
    weekPrev: document.getElementById("week-prev"),
    weekNext: document.getElementById("week-next"),
    weekToday: document.getElementById("week-today"),
    weekLabel: document.getElementById("week-label"),
    scheduleMapToggle: document.getElementById("schedule-map-toggle"),
    quickCreate: document.getElementById("quick-create"),
    createPanel: document.getElementById("create-panel"),
    mobileNav: document.getElementById("mobile-nav"),
    mobileNavToggle: document.getElementById("mobile-nav-toggle"),
    mobileNavMenu: document.getElementById("mobile-nav-menu"),
    mobileCreate: document.getElementById("mobile-create"),
    mobileSignOut: document.getElementById("mobile-sign-out"),
    signOut: document.getElementById("sign-out"),
    backdrop: document.getElementById("drawer-backdrop"),
    drawer: document.getElementById("drawer"),
    clientDrawer: document.getElementById("client-drawer"),
    clientDrawerTitle: document.getElementById("client-drawer-title"),
    clientDrawerMeta: document.getElementById("client-drawer-meta"),
    clientDetailBody: document.getElementById("client-detail-body"),
    clientDrawerClose: document.getElementById("client-drawer-close"),
    clientEdit: document.getElementById("client-edit"),
    jobDrawer: document.getElementById("job-drawer"),
    jobContext: document.getElementById("job-context"),
    jobLogRevisions: document.getElementById("job-log-revisions"),
    revisionDrawer: document.getElementById("revision-drawer"),
    revisionForm: document.getElementById("revision-form"),
    revisionDrawerMeta: document.getElementById("revision-drawer-meta"),
    revisionDrawerClose: document.getElementById("revision-drawer-close"),
    cancelRevision: document.getElementById("cancel-revision"),
    quoteDrawer: document.getElementById("quote-drawer"),
    invoiceDrawer: document.getElementById("invoice-drawer"),
    drawerClose: document.getElementById("drawer-close"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerMeta: document.getElementById("drawer-meta"),
    form: document.getElementById("lead-form"),
    jobForm: document.getElementById("job-form"),
    quoteForm: document.getElementById("quote-form"),
    invoiceForm: document.getElementById("invoice-form"),
    jobDrawerClose: document.getElementById("job-drawer-close"),
    jobDrawerTitle: document.getElementById("job-drawer-title"),
    jobDrawerMeta: document.getElementById("job-drawer-meta"),
    quoteDrawerClose: document.getElementById("quote-drawer-close"),
    quoteDrawerTitle: document.getElementById("quote-drawer-title"),
    quoteDrawerMeta: document.getElementById("quote-drawer-meta"),
    quoteLeadPicker: document.getElementById("quote-lead-picker"),
    quoteScheduleBuild: document.getElementById("quote-schedule-build"),
    quoteAttachments: document.getElementById("quote-attachments"),
    quotePreview: document.getElementById("quote-preview"),
    printQuote: document.getElementById("print-quote"),
    sendQuote: document.getElementById("send-quote"),
    invoiceDrawerClose: document.getElementById("invoice-drawer-close"),
    invoiceDrawerTitle: document.getElementById("invoice-drawer-title"),
    invoiceDrawerMeta: document.getElementById("invoice-drawer-meta"),
    invoiceLines: document.getElementById("invoice-lines"),
    invoicePreview: document.getElementById("invoice-preview"),
    invoiceAddLine: document.getElementById("invoice-add-line"),
    printInvoice: document.getElementById("print-invoice"),
    sendInvoice: document.getElementById("send-invoice"),
    invoiceLeadPicker: document.getElementById("invoice-lead-picker"),
    invoiceQuotePicker: document.getElementById("invoice-quote-picker"),
    invoiceJobPicker: document.getElementById("invoice-job-picker"),
    deleteLead: document.getElementById("delete-lead"),
    deleteJob: document.getElementById("delete-job"),
    deleteQuote: document.getElementById("delete-quote"),
    deleteInvoice: document.getElementById("delete-invoice"),
    cancelLead: document.getElementById("cancel-lead"),
    cancelJob: document.getElementById("cancel-job"),
    cancelQuote: document.getElementById("cancel-quote"),
    cancelInvoice: document.getElementById("cancel-invoice"),
    toast: document.getElementById("toast"),
  };

  const COMPANY = {
    name: "Vanderven Systems",
    email: "hello@vanderven.ca",
    location: "Kelowna & Central Okanagan, BC",
    web: "vanderven.ca",
    tagline: "Websites, automation & systems for local businesses",
    logo: "/public/logo-mark-nav.png",
  };

  const viewEls = {
    home: els.home,
    pipeline: els.pipeline,
    schedule: els.schedule,
    clients: els.clients,
    requests: els.requests,
    quotes: els.quotes,
    jobs: els.jobs,
    invoices: els.invoices,
    vera: els.vera,
    reminders: els.reminders,
    settings: els.settings,
    games: els.games,
  };

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function startOfMonth(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    d.setDate(1);
    return d;
  }

  function toIsoDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    return d;
  }

  function weekDays() {
    return Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  }

  function hourSlots() {
    const slots = [];
    for (let h = SLOT_START_HOUR; h <= SLOT_END_HOUR; h++) {
      slots.push(`${String(h).padStart(2, "0")}:00`);
    }
    return slots;
  }

  function slotHour(time) {
    if (!time) return null;
    const match = String(time).match(/^(\d{1,2}):/);
    if (!match) return null;
    return Number(match[1]);
  }

  function normalizeSlotTime(time, { fallback = "08:00" } = {}) {
    const hour = slotHour(time);
    if (hour === null) return fallback;
    if (hour < SLOT_START_HOUR) return `${String(SLOT_START_HOUR).padStart(2, "0")}:00`;
    if (hour > SLOT_END_HOUR) return `${String(SLOT_END_HOUR).padStart(2, "0")}:00`;
    return `${String(hour).padStart(2, "0")}:00`;
  }

  function formatSlotLabel(time) {
    const hour = slotHour(time);
    if (hour === null) return time;
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return new Intl.DateTimeFormat("en-CA", { hour: "numeric" }).format(d);
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const formatDate = (iso) => {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(
        new Date(`${String(iso).slice(0, 10)}T12:00:00`)
      );
    } catch {
      return "";
    }
  };

  const formatMoney = (cents) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(
      (Number(cents) || 0) / 100
    );

  const formatMoneyExact = (cents) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format((Number(cents) || 0) / 100);

  function dollarsFromCents(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2);
  }

  function centsFromInput(value) {
    const num = parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? Math.round(num * 100) : 0;
  }

  const formatWeekLabel = () => {
    const start = state.weekStart;
    const end = addDays(start, 6);
    const opts = { month: "short", day: "numeric" };
    return `${new Intl.DateTimeFormat("en-CA", opts).format(start)} – ${new Intl.DateTimeFormat("en-CA", {
      ...opts,
      year: "numeric",
    }).format(end)}`;
  };

  const formatMonthLabel = () =>
    new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" }).format(state.monthCursor);

  function updateCalendarChrome() {
    document.querySelectorAll("[data-cal-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.calMode === state.calendarMode);
    });
    els.weekLabel.textContent =
      state.calendarMode === "month" ? formatMonthLabel() : formatWeekLabel();
    const mapOpen = state.scheduleMapOpen !== false;
    if (els.scheduleMapToggle) {
      els.scheduleMapToggle.textContent = mapOpen ? "Hide map" : "Show map";
      els.scheduleMapToggle.setAttribute("aria-pressed", mapOpen ? "true" : "false");
      els.scheduleMapToggle.classList.toggle("is-map-hidden", !mapOpen);
    }
  }

  const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;
  function normalizeJobStatusId(status) {
    const raw = String(status || "").toLowerCase().trim();
    return JOB_STATUS_ALIASES[raw] || raw;
  }

  const statusMeta = (list, id) => {
    const resolved = list === JOB_STATUSES ? normalizeJobStatusId(id) : id;
    return list.find((s) => s.id === resolved) || { id: resolved, label: resolved, tone: "slate" };
  };

  let toastTimer;
  const toast = (message) => {
    els.toast.textContent = message;
    els.toast.classList.add("is-in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-in"), 2200);
  };

  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const IDLE_TOUCH_MS = 5 * 60 * 1000;
  let lastActivityAt = Date.now();
  let idleCheckTimer = 0;
  let idleTouchTimer = 0;
  let idleSigningOut = false;

  function markActivity() {
    lastActivityAt = Date.now();
  }

  async function forceIdleSignOut() {
    if (idleSigningOut) return;
    idleSigningOut = true;
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      /* still send them to login */
    }
    location.href = "/login?next=/app/&reason=idle";
  }

  function scheduleIdleWatch() {
    clearTimeout(idleCheckTimer);
    const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt);
    idleCheckTimer = window.setTimeout(() => {
      if (Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) {
        forceIdleSignOut();
        return;
      }
      scheduleIdleWatch();
    }, Math.max(1000, remaining + 25));
  }

  function startIdleWatch() {
    const bump = () => {
      markActivity();
      scheduleIdleWatch();
    };
    ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", "wheel"].forEach((eventName) => {
      window.addEventListener(eventName, bump, { passive: true, capture: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) bump();
    });
    scheduleIdleWatch();
    clearInterval(idleTouchTimer);
    idleTouchTimer = window.setInterval(() => {
      if (Date.now() - lastActivityAt > IDLE_TOUCH_MS) return;
      api("/api/session").catch(() => {});
    }, IDLE_TOUCH_MS);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (res.status === 401) {
      location.href = "/login?next=/app/&reason=idle";
      throw new Error("Unauthorized");
    }
    markActivity();
    scheduleIdleWatch();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  const REWRITE_TONES = [
    { id: "professional", label: "Professional" },
    { id: "casual", label: "Casual" },
    { id: "friendly", label: "Friendly" },
    { id: "clearer", label: "Clearer" },
    { id: "shorter", label: "Shorter" },
  ];

  const rewriteUndoByTextarea = new WeakMap();

  function resolveRewriteContext(textarea) {
    const raw = textarea?.dataset?.rewrite || "client_note";
    if (raw === "lead") {
      return els.form?.internalRequest?.value === "1" ? "request" : "client_note";
    }
    return raw;
  }

  function closeRewriteMenus(except = null) {
    document.querySelectorAll(".rewrite-menu.is-open").forEach((menu) => {
      if (menu === except) return;
      menu.classList.remove("is-open");
      const panel = menu.querySelector(".rewrite-menu__panel");
      const btn = menu.querySelector("[data-rewrite-open]");
      if (panel) panel.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function mountRewriteControl(textarea) {
    if (!textarea || textarea.dataset.rewriteReady === "1") return;
    const field = textarea.closest(".field") || textarea.parentElement;
    if (!field) return;
    textarea.dataset.rewriteReady = "1";

    const toolbar = document.createElement("div");
    toolbar.className = "rewrite-toolbar";
    toolbar.innerHTML = `
      <div class="rewrite-menu">
        <button type="button" class="btn btn-soft rewrite-menu__btn" data-rewrite-open aria-haspopup="menu" aria-expanded="false">
          Rewrite
        </button>
        <div class="rewrite-menu__panel" hidden role="menu">
          ${REWRITE_TONES.map(
            (tone) =>
              `<button type="button" class="rewrite-menu__item" role="menuitem" data-rewrite-tone="${tone.id}">${tone.label}</button>`
          ).join("")}
        </div>
      </div>
      <button type="button" class="btn btn-ghost rewrite-undo" data-rewrite-undo hidden>Undo</button>
    `;

    const label = field.querySelector(":scope > span");
    if (label) {
      const head = document.createElement("div");
      head.className = "field__head";
      head.appendChild(label);
      head.appendChild(toolbar);
      field.insertBefore(head, textarea);
    } else {
      field.insertBefore(toolbar, textarea);
    }

    const menu = toolbar.querySelector(".rewrite-menu");
    const panel = toolbar.querySelector(".rewrite-menu__panel");
    const openBtn = toolbar.querySelector("[data-rewrite-open]");
    const undoBtn = toolbar.querySelector("[data-rewrite-undo]");

    const syncUndo = () => {
      undoBtn.hidden = !rewriteUndoByTextarea.has(textarea);
    };

    openBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = !menu.classList.contains("is-open");
      closeRewriteMenus(menu);
      menu.classList.toggle("is-open", willOpen);
      panel.hidden = !willOpen;
      openBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    toolbar.querySelectorAll("[data-rewrite-tone]").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const tone = btn.dataset.rewriteTone;
        const text = textarea.value.trim();
        if (!text) {
          toast("Add some text to rewrite first");
          return;
        }
        closeRewriteMenus();
        panel.hidden = true;
        openBtn.setAttribute("aria-expanded", "false");
        openBtn.disabled = true;
        openBtn.textContent = "Rewriting…";
        try {
          const data = await api("/api/rewrite", {
            method: "POST",
            body: JSON.stringify({
              text,
              tone,
              context: resolveRewriteContext(textarea),
            }),
          });
          if (!data.text || data.text === text) {
            toast("No changes from rewrite");
            return;
          }
          rewriteUndoByTextarea.set(textarea, text);
          textarea.value = data.text;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          syncUndo();
          toast("Rewritten");
        } catch (err) {
          toast(err.message || "Could not rewrite");
        } finally {
          openBtn.disabled = false;
          openBtn.textContent = "Rewrite";
        }
      });
    });

    undoBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const previous = rewriteUndoByTextarea.get(textarea);
      if (previous == null) return;
      textarea.value = previous;
      rewriteUndoByTextarea.delete(textarea);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      syncUndo();
      toast("Rewrite undone");
    });
  }

  function mountRewriteControls(root = document) {
    root.querySelectorAll("textarea[data-rewrite]").forEach((textarea) => mountRewriteControl(textarea));
  }

  function canEditNote(note) {
    const user = state.sessionUser;
    if (!note || !user) return false;
    if (note.authorUserId && user.id && note.authorUserId === user.id) return true;
    const who = String(note.author || "")
      .trim()
      .toLowerCase();
    if (!who) return false;
    const name = String(user.name || "")
      .trim()
      .toLowerCase();
    const email = String(user.email || "")
      .trim()
      .toLowerCase();
    return (name && who === name) || (email && who === email);
  }

  function noteKindLabel(kind) {
    if (kind === "revisions_requested" || kind === "change_request") return "Change request";
    if (kind === "request") return "Request";
    return "Note";
  }

  function noteCardHtml(note, { showAuthor = true } = {}) {
    const editable = canEditNote(note);
    const isRevision = note.kind === "revisions_requested" || note.kind === "change_request";
    const edited =
      note.updatedAt && note.createdAt && note.updatedAt !== note.createdAt
        ? ` · edited ${formatDateTime(note.updatedAt)}`
        : "";
    return `
      <article class="client-note ${isRevision ? "is-revision" : ""}" data-note-id="${escapeHtml(note.id)}" data-note-lead="${escapeHtml(
        note.leadId || ""
      )}">
        <div class="client-note__meta">
          <span class="chip chip-${isRevision ? "rust" : "slate"}">${escapeHtml(noteKindLabel(note.kind))}</span>
          <div class="client-note__meta-right">
            <time>${escapeHtml(formatDateTime(note.createdAt))}${escapeHtml(edited)}</time>
            ${
              editable
                ? `<button type="button" class="btn btn-ghost client-note__edit" data-edit-note="${escapeHtml(
                    note.id
                  )}">Edit</button>`
                : ""
            }
          </div>
        </div>
        <div class="client-note__body" data-note-body>
          <p>${escapeHtml(note.body)}</p>
        </div>
        ${showAuthor && note.author ? `<p class="muted client-note__author">${escapeHtml(note.author)}</p>` : ""}
      </article>`;
  }

  function bindNoteEdit(root, { leadId, onSaved } = {}) {
    if (!root) return;
    root.querySelectorAll("[data-edit-note]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".client-note");
        if (!card || card.classList.contains("is-editing")) return;
        const noteId = btn.dataset.editNote;
        const bodyEl = card.querySelector("[data-note-body]");
        const current = bodyEl?.querySelector("p")?.textContent || "";
        card.classList.add("is-editing");
        btn.hidden = true;
        bodyEl.innerHTML = `
          <label class="field">
            <span>Edit note</span>
            <textarea name="body" rows="3" data-rewrite="client_note" required>${escapeHtml(current)}</textarea>
          </label>
          <div class="client-note__edit-actions">
            <button type="button" class="btn btn-ghost" data-cancel-note>Cancel</button>
            <button type="button" class="btn btn-primary" data-save-note>Save</button>
          </div>`;
        mountRewriteControls(bodyEl);
        bodyEl.querySelector("[data-cancel-note]")?.addEventListener("click", () => {
          bodyEl.innerHTML = `<p>${escapeHtml(current)}</p>`;
          card.classList.remove("is-editing");
          btn.hidden = false;
        });
        bodyEl.querySelector("[data-save-note]")?.addEventListener("click", async () => {
          const textarea = bodyEl.querySelector("textarea");
          const text = textarea?.value?.trim() || "";
          if (!text) {
            toast("Note text is required");
            return;
          }
          const saveBtn = bodyEl.querySelector("[data-save-note]");
          saveBtn.disabled = true;
          try {
            const targetLead = leadId || card.dataset.noteLead;
            const data = await api(
              `/api/leads/${encodeURIComponent(targetLead)}/notes/${encodeURIComponent(noteId)}`,
              { method: "PATCH", body: JSON.stringify({ body: text }) }
            );
            toast("Note updated");
            if (typeof onSaved === "function") await onSaved(data);
          } catch (err) {
            toast(err.message || "Could not update note");
            saveBtn.disabled = false;
          }
        });
      });
    });
  }

  const matchesQuery = (parts, query = state.query) => {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (!q) return true;
    return parts
      .filter((p) => p != null && p !== "")
      .join(" ")
      .toLowerCase()
      .includes(q);
  };

  const leadSearchParts = (lead) => [
    lead.name,
    lead.business,
    lead.email,
    lead.phone,
    lead.industry,
    lead.notes,
    lead.stage,
    lead.source,
    lead.requestedBy,
    lead.assignee,
    lead.addressLine,
    lead.city,
    lead.region,
    lead.postalCode,
    lead.country,
    lead.address,
    formatClientAddress(lead),
  ];

  const jobSearchParts = (job) => [
    job.title,
    job.clientName,
    job.assignee,
    job.notes,
    job.status,
    normalizeJobStatusId(job.status),
    job.scheduledDate,
    job.startTime,
    job.number,
  ];

  const quoteSearchParts = (quote) => [
    quote.number,
    quote.title,
    quote.clientName,
    quote.notes,
    quote.status,
    quote.ownerEmail,
  ];

  const invoiceSearchParts = (invoice) => [
    invoice.number,
    invoice.title,
    invoice.clientName,
    invoice.notes,
    invoice.status,
    invoice.billToName,
    invoice.billToEmail,
    invoice.billToPhone,
    invoice.billToAddress,
    invoice.paymentTerms,
    invoice.issueDate,
    invoice.dueDate,
  ];

  const reminderSearchParts = (reminder) => [
    reminder.subject,
    reminder.toEmail,
    reminder.audience,
    reminder.quoteNumber,
    reminder.quoteClient,
    reminder.status,
    reminder.body,
  ];

  const filteredLeads = () => state.leads.filter((lead) => matchesQuery(leadSearchParts(lead)));

  const filteredJobs = () =>
    state.jobs.filter((job) => {
      const status = normalizeJobStatusId(job.status);
      if (state.statusFilter !== "all" && status !== normalizeJobStatusId(state.statusFilter)) {
        return false;
      }
      return matchesQuery(jobSearchParts(job));
    });

  const filteredQuotes = () =>
    state.quotes.filter((quote) => {
      if (state.statusFilter !== "all" && quote.status !== state.statusFilter) return false;
      return matchesQuery(quoteSearchParts(quote));
    });

  const filteredInvoices = () =>
    state.invoices.filter((invoice) => {
      if (state.statusFilter !== "all" && invoice.status !== state.statusFilter) return false;
      return matchesQuery(invoiceSearchParts(invoice));
    });

  const requestLeads = () =>
    filteredLeads().filter((l) => l.stage === "new" || l.stage === "audit");

  const SEARCH_SECTION_LIMIT = 6;

  function closeCreateMenu() {
    els.createPanel.classList.remove("is-open");
    els.createPanel.hidden = true;
    els.quickCreate.setAttribute("aria-expanded", "false");
  }

  function openCreateMenu() {
    els.createPanel.hidden = false;
    els.createPanel.classList.add("is-open");
    els.quickCreate.setAttribute("aria-expanded", "true");
  }

  function toggleCreateMenu() {
    if (els.createPanel.classList.contains("is-open")) closeCreateMenu();
    else openCreateMenu();
  }

  function closeMoreSheet() {
    closeMobileNav();
  }

  function closeMobileNav() {
    if (!els.mobileNav || !els.mobileNavMenu || !els.mobileNavToggle) return;
    els.mobileNav.classList.remove("is-open");
    els.mobileNavMenu.hidden = true;
    els.mobileNavToggle.setAttribute("aria-expanded", "false");
    els.mobileNavToggle.setAttribute("aria-label", "Open menu");
  }

  function openMobileNav() {
    if (!els.mobileNav || !els.mobileNavMenu || !els.mobileNavToggle) return;
    closeCreateMenu();
    closeSearchPanel();
    els.mobileNav.classList.add("is-open");
    els.mobileNavMenu.hidden = false;
    els.mobileNavToggle.setAttribute("aria-expanded", "true");
    els.mobileNavToggle.setAttribute("aria-label", "Close menu");
  }

  function toggleMobileNav() {
    if (els.mobileNav?.classList.contains("is-open")) closeMobileNav();
    else openMobileNav();
  }

  function closeSearchPanel() {
    state.searchOpen = false;
    if (els.searchPanel) {
      els.searchPanel.hidden = true;
      els.searchPanel.classList.remove("is-open");
    }
    els.search?.setAttribute("aria-expanded", "false");
  }

  function openSearchPanel() {
    if (!els.searchPanel) return;
    state.searchOpen = true;
    els.searchPanel.hidden = false;
    els.searchPanel.classList.add("is-open");
    els.search?.setAttribute("aria-expanded", "true");
    renderSearchPanel();
  }

  function buildGlobalSearchGroups(query) {
    const q = String(query || "").trim();
    if (!q) return [];

    const clients = state.leads
      .filter((lead) => !(lead.stage === "new" || lead.stage === "audit") && matchesQuery(leadSearchParts(lead), q))
      .map((lead) => ({
        id: lead.id,
        kind: "client",
        title: lead.business || lead.name,
        subtitle: [lead.name, lead.email || lead.phone, stageLabel(lead.stage)].filter(Boolean).join(" · "),
        tone: "indigo",
      }));

    const requests = state.leads
      .filter((lead) => (lead.stage === "new" || lead.stage === "audit") && matchesQuery(leadSearchParts(lead), q))
      .map((lead) => ({
        id: lead.id,
        kind: "client",
        title: lead.business || lead.name,
        subtitle: [lead.name, stageLabel(lead.stage), lead.email || lead.phone].filter(Boolean).join(" · "),
        tone: "slate",
      }));

    const builds = state.jobs
      .filter((job) => matchesQuery(jobSearchParts(job), q))
      .map((job) => ({
        id: job.id,
        kind: "build",
        title: job.title,
        subtitle: [
          job.clientName,
          statusMeta(JOB_STATUSES, normalizeJobStatusId(job.status)).label,
          job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled",
        ]
          .filter(Boolean)
          .join(" · "),
        tone: "teal",
      }));

    const quotes = state.quotes
      .filter((quote) => matchesQuery(quoteSearchParts(quote), q))
      .map((quote) => ({
        id: quote.id,
        kind: "quote",
        title: `${quote.number} · ${quote.title}`,
        subtitle: [quote.clientName, statusMeta(QUOTE_STATUSES, quote.status).label, formatMoney(quote.amountCents)]
          .filter(Boolean)
          .join(" · "),
        tone: "gold",
      }));

    const invoices = state.invoices
      .filter((invoice) => matchesQuery(invoiceSearchParts(invoice), q))
      .map((invoice) => ({
        id: invoice.id,
        kind: "invoice",
        title: `${invoice.number} · ${invoice.title}`,
        subtitle: [
          invoice.clientName || invoice.billToName,
          statusMeta(INVOICE_STATUSES, invoice.status).label,
          formatMoneyExact(invoice.amountCents),
        ]
          .filter(Boolean)
          .join(" · "),
        tone: "rust",
      }));

    const reminders = state.reminders
      .filter((reminder) => matchesQuery(reminderSearchParts(reminder), q))
      .map((reminder) => ({
        id: reminder.id,
        kind: "reminder",
        title: reminder.subject || "Reminder",
        subtitle: [reminder.quoteNumber || reminder.quoteClient, reminder.toEmail, reminder.status]
          .filter(Boolean)
          .join(" · "),
        tone: "gold",
      }));

    const docs = (state.quoteDocuments || [])
      .filter((doc) => matchesQuery([doc.title, doc.summary, doc.kind, doc.slug, doc.bodyPlaceholder], q))
      .map((doc) => ({
        id: doc.id,
        kind: "document",
        title: doc.title,
        subtitle: [doc.kind, doc.attachToEveryQuote ? "Every quote" : "Optional", doc.summary]
          .filter(Boolean)
          .join(" · "),
        tone: "slate",
      }));

    const team = (state.users || [])
      .filter((user) => matchesQuery([user.name, user.email, user.role], q))
      .map((user) => ({
        id: user.id,
        kind: "user",
        title: user.name || user.email,
        subtitle: [user.email, user.role, user.active ? "Active" : "Inactive"].filter(Boolean).join(" · "),
        tone: "indigo",
      }));

    const remoteReady = state.searchRemote.query === q;
    const notes = (remoteReady ? state.searchRemote.notes : [])
      .filter((note) => matchesQuery([note.body, note.author, note.kind, note.clientName], q))
      .map((note) => ({
        id: note.id,
        kind: "note",
        leadId: note.leadId,
        title: String(note.body || "").replace(/\s+/g, " ").slice(0, 80) || "Note",
        subtitle: [note.clientName, note.author || note.kind, formatDate(note.createdAt)].filter(Boolean).join(" · "),
        tone: "teal",
      }));

    const activity = (remoteReady ? state.searchRemote.activity : [])
      .filter((item) => matchesQuery([item.summary, item.kind, item.entityType, item.clientName], q))
      .map((item) => ({
        id: item.id,
        kind: "activity",
        leadId: item.leadId,
        title: item.summary || "Activity",
        subtitle: [item.clientName, item.kind, formatDate(item.createdAt)].filter(Boolean).join(" · "),
        tone: "slate",
      }));

    return [
      { id: "clients", label: "Clients", source: "Clients", view: "clients", tone: "indigo", items: clients },
      { id: "requests", label: "Requests", source: "Requests", view: "requests", tone: "slate", items: requests },
      { id: "builds", label: "Builds", source: "Builds", view: "jobs", tone: "teal", items: builds },
      { id: "quotes", label: "Quotes", source: "Quotes", view: "quotes", tone: "gold", items: quotes },
      { id: "invoices", label: "Invoices", source: "Invoices", view: "invoices", tone: "rust", items: invoices },
      { id: "reminders", label: "Reminders", source: "Reminders", view: "reminders", tone: "gold", items: reminders },
      { id: "notes", label: "Notes", source: "Client notes", view: "clients", tone: "teal", items: notes },
      { id: "activity", label: "Activity", source: "Client history", view: "clients", tone: "slate", items: activity },
      { id: "documents", label: "Quote attachments", source: "Settings", view: "settings", tone: "slate", items: docs },
      { id: "team", label: "Team", source: "Settings · Users", view: "settings", tone: "indigo", items: team },
    ];
  }

  function renderSearchPanel() {
    if (!els.searchPanel) return;
    const q = state.query.trim();
    if (!q) {
      els.searchPanel.innerHTML = `<div class="search-empty">Type to search clients, builds, quotes, invoices, notes, and more.</div>`;
      return;
    }

    const groups = buildGlobalSearchGroups(q);
    const remotePending =
      q.length >= 2 && (state.searchRemoteLoading || state.searchRemote.query !== q);
    const visibleGroups = groups.filter((group) => group.items.length);
    const total = visibleGroups.reduce((sum, g) => sum + g.items.length, 0);

    if (!total && !remotePending) {
      els.searchPanel.innerHTML = `<div class="search-empty">No matches for “${escapeHtml(q)}” across the CRM.</div>`;
      return;
    }

    const remotePlaceholders = remotePending
      ? ["notes", "activity"]
          .filter((id) => !visibleGroups.some((g) => g.id === id))
          .map((id) => {
            const group = groups.find((g) => g.id === id);
            return `
              <section class="search-section">
                <div class="search-section__head">
                  <div>
                    <strong>${escapeHtml(group.label)}</strong>
                    <span class="search-section__source">from ${escapeHtml(group.source)}</span>
                  </div>
                </div>
                <p class="search-section__loading muted">Looking up…</p>
              </section>`;
          })
          .join("")
      : "";

    els.searchPanel.innerHTML = `
      <div class="search-menu__meta">
        <span>${total ? `${total} match${total === 1 ? "" : "es"}` : "Searching…"} for “${escapeHtml(q)}”</span>
        ${remotePending ? `<span class="muted">Checking notes &amp; activity…</span>` : ""}
      </div>
      ${visibleGroups
        .map((group) => {
          const shown = group.items.slice(0, SEARCH_SECTION_LIMIT);
          const more = group.items.length - shown.length;
          return `
            <section class="search-section" data-search-section="${escapeHtml(group.id)}">
              <div class="search-section__head">
                <div>
                  <strong>${escapeHtml(group.label)}</strong>
                  <span class="search-section__source">from ${escapeHtml(group.source)}</span>
                </div>
                <span class="search-section__count">${group.items.length}</span>
              </div>
              <div class="search-section__list">
                ${shown
                  .map(
                    (item) => `
                  <button type="button" class="search-hit tone-${escapeHtml(item.tone)}" data-search-kind="${escapeHtml(
                    item.kind
                  )}" data-search-id="${escapeHtml(item.id)}" ${
                      item.leadId ? `data-search-lead="${escapeHtml(item.leadId)}"` : ""
                    } role="option">
                    <span class="search-hit__bar" aria-hidden="true"></span>
                    <span class="search-hit__text">
                      <span class="search-hit__title">${escapeHtml(item.title)}</span>
                      <span class="search-hit__sub">${escapeHtml(item.subtitle || "")}</span>
                    </span>
                  </button>`
                  )
                  .join("")}
              </div>
              ${
                more > 0 && group.view
                  ? `<button type="button" class="search-section__more" data-search-view="${escapeHtml(
                      group.view
                    )}">View all ${group.items.length} in ${escapeHtml(group.label)} →</button>`
                  : ""
              }
            </section>`;
        })
        .join("")}
      ${remotePlaceholders}`;

    els.searchPanel.querySelectorAll("[data-search-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activateSearchResult({
          kind: btn.dataset.searchKind,
          id: btn.dataset.searchId,
          leadId: btn.dataset.searchLead || "",
        });
      });
    });
    els.searchPanel.querySelectorAll("[data-search-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeSearchPanel();
        setView(btn.dataset.searchView);
      });
    });
  }

  let searchRemoteTimer = null;
  function scheduleRemoteSearch(query) {
    const q = String(query || "").trim();
    clearTimeout(searchRemoteTimer);
    if (q.length < 2) {
      state.searchRemote = { notes: [], activity: [], query: q };
      state.searchRemoteLoading = false;
      if (state.searchOpen) renderSearchPanel();
      return;
    }
    if (state.searchRemote.query === q && !state.searchRemoteLoading) {
      if (state.searchOpen) renderSearchPanel();
      return;
    }
    state.searchRemoteLoading = true;
    if (state.searchOpen) renderSearchPanel();
    searchRemoteTimer = setTimeout(async () => {
      const requested = q;
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(requested)}`);
        if (state.query.trim() !== requested) return;
        state.searchRemote = {
          notes: data.notes || [],
          activity: data.activity || [],
          query: requested,
        };
      } catch {
        if (state.query.trim() !== requested) return;
        state.searchRemote = { notes: [], activity: [], query: requested };
      } finally {
        if (state.query.trim() === requested) state.searchRemoteLoading = false;
        if (state.searchOpen) renderSearchPanel();
      }
    }, 220);
  }

  function activateSearchResult({ kind, id, leadId }) {
    closeSearchPanel();
    closeCreateMenu();
    const go = (view, open) => {
      if (state.view !== view) setView(view);
      else render();
      open?.();
    };
    if (kind === "client") {
      go("clients", () => openLead(id));
      return;
    }
    if (kind === "build") {
      go("jobs", () => openJob(id));
      return;
    }
    if (kind === "quote") {
      go("quotes", () => openQuote(id));
      return;
    }
    if (kind === "invoice") {
      go("invoices", () => openInvoice(id));
      return;
    }
    if (kind === "reminder") {
      go("reminders");
      return;
    }
    if (kind === "note" || kind === "activity") {
      go("clients", () => {
        if (leadId) openLead(leadId);
      });
      return;
    }
    if (kind === "document" || kind === "user") {
      go("settings");
    }
  }

  function timeOfDayGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  function sessionFirstName() {
    const full = (state.sessionUser?.name || "").trim();
    if (full) return full.split(/\s+/)[0];
    const email = (state.sessionUser?.email || "").trim();
    if (email) {
      const local = email.split("@")[0];
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return "";
  }

  function applyViewHeader(view = state.view) {
    const copy = VIEW_COPY[view];
    if (!copy || !els.title || !els.sub) return;
    if (view === "home") {
      const name = sessionFirstName();
      if (name) {
        els.title.textContent = `${timeOfDayGreeting()}, ${name}.`;
        els.title.classList.add("app-top__greeting");
      } else {
        // Keep static Home title until session loads — avoids "there" → name flash.
        els.title.textContent = copy.title;
        els.title.classList.remove("app-top__greeting");
      }
    } else {
      els.title.textContent = copy.title;
      els.title.classList.remove("app-top__greeting");
    }
    els.sub.textContent = copy.sub;
  }

  async function stopActiveGame() {
    if (state.gamesHandle && typeof state.gamesHandle.destroy === "function") {
      try {
        await state.gamesHandle.destroy();
      } catch {
        /* ignore teardown errors */
      }
    }
    state.gamesHandle = null;
  }

  function setView(view) {
    if (!VIEW_COPY[view]) return;
    if (state.view === "games" && view !== "games") {
      stopActiveGame();
      state.gamesActiveId = null;
    }
    state.view = view;
    if (view !== "vera") state.veraDetail = null;
    if (!LIST_VIEWS.has(view) || view === "clients" || view === "requests") {
      if (view !== "quotes" && view !== "jobs" && view !== "invoices") state.statusFilter = "all";
    }
    if (view === "quotes" || view === "jobs" || view === "invoices") {
      // keep filter
    } else {
      state.statusFilter = "all";
    }

    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
    Object.entries(viewEls).forEach(([key, el]) => {
      if (el) el.hidden = key !== view;
    });
    els.weekNav.hidden = view !== "schedule";
    closeMoreSheet();
    closeCreateMenu();
    closeSearchPanel();

    applyViewHeader(view);
    els.search.placeholder = view === "vera" ? "Search Vera chats" : "Search everything";
    els.search.hidden = view === "games";
    if (els.searchMenu) els.searchMenu.hidden = view === "games";

    renderFilters();
    render();
    if (view === "vera") {
      loadVeraChats({ notify: false }).then(() => {
        if (state.view === "vera") renderVera();
      });
    }
  }

  function renderFilters() {
    const map = {
      quotes: QUOTE_STATUSES,
      jobs: JOB_STATUSES,
      invoices: INVOICE_STATUSES,
    };
    const options = map[state.view];
    if (!options) {
      els.filterChips.hidden = true;
      els.filterChips.innerHTML = "";
      return;
    }
    els.filterChips.hidden = false;
    els.filterChips.innerHTML = `
      <button type="button" data-filter="all" class="${state.statusFilter === "all" ? "is-active" : ""}">All</button>
      ${options
        .map(
          (s) =>
            `<button type="button" data-filter="${s.id}" class="${state.statusFilter === s.id ? "is-active" : ""}">${s.label}</button>`
        )
        .join("")}`;
    els.filterChips.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.statusFilter = btn.dataset.filter;
        renderFilters();
        render();
      });
    });
  }

  function emptyPanel(title, body) {
    return `<div class="leads-panel"><div class="empty"><strong>${title}</strong>${body}</div></div>`;
  }

  function listTable(headers, rowsHtml) {
    return `
      <div class="leads-panel">
        <table class="leads-table">
          <thead><tr>${headers.map((h) => (String(h).includes("<") ? h : `<th>${h}</th>`)).join("")}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  function clientsSortValue(lead, key) {
    if (key === "client") return String(lead.business || lead.name || "").trim();
    if (key === "contact") return String(lead.name || "").trim();
    if (key === "location") {
      return String(
        [lead.city, lead.region].filter(Boolean).join(", ") || formatClientAddress(lead) || ""
      ).trim();
    }
    if (key === "stage") return String(lead.stage || "");
    return String(lead.updatedAt || lead.createdAt || "");
  }

  function sortedClientLeads(leads) {
    const { key, dir } = state.clientsSort || { key: "updated", dir: "desc" };
    const mult = dir === "asc" ? 1 : -1;
    return leads.slice().sort((a, b) => {
      const av = clientsSortValue(a, key);
      const bv = clientsSortValue(b, key);
      let cmp = 0;
      if (key === "updated") {
        cmp = av.localeCompare(bv);
      } else if (key === "stage") {
        cmp = STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
        if (!Number.isFinite(cmp)) cmp = 0;
        if (!cmp) cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      } else {
        cmp = av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true });
      }
      if (!cmp) {
        cmp = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        return cmp;
      }
      return cmp * mult;
    });
  }

  function clientsSortHeader(label, key, { showTri = false } = {}) {
    const active = state.clientsSort.key === key;
    const dir = state.clientsSort.dir;
    const tri = active ? (dir === "asc" ? "▲" : "▼") : showTri ? "▽" : "";
    const aria =
      key === "client"
        ? active
          ? `Sort clients ${dir === "asc" ? "Z to A" : "A to Z"}`
          : "Sort clients A to Z"
        : active
          ? `Sorted by ${label}`
          : `Sort by ${label}`;
    return `<th class="leads-table__th ${active ? "is-sorted" : ""} ${
      showTri || active ? "is-sortable" : "is-sortable"
    }" scope="col">
      <button type="button" class="th-sort" data-clients-sort="${escapeHtml(key)}" aria-label="${escapeHtml(
      aria
    )}">
        <span>${escapeHtml(label)}</span>
        ${
          showTri || active
            ? `<span class="th-sort__tri ${active ? "is-on" : ""}" aria-hidden="true">${tri || "▽"}</span>`
            : `<span class="th-sort__tri" aria-hidden="true"></span>`
        }
      </button>
    </th>`;
  }

  function cycleClientsSort(key) {
    const cur = state.clientsSort;
    if (key === "client") {
      if (cur.key !== "client") state.clientsSort = { key: "client", dir: "asc" };
      else if (cur.dir === "asc") state.clientsSort = { key: "client", dir: "desc" };
      else state.clientsSort = { key: "updated", dir: "desc" };
      return;
    }
    if (cur.key === key) {
      state.clientsSort = { key, dir: cur.dir === "asc" ? "desc" : "asc" };
    } else {
      state.clientsSort = { key, dir: key === "updated" ? "desc" : "asc" };
    }
  }

  function formatDurationLabel(mins) {
    const m = Number(mins) || 0;
    if (m <= 0) return "0m";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  function compareJobStart(a, b) {
    return String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99"));
  }

  function homeRepNames() {
    const defaults = ["Brad", "Rob", "Riley", "Morgan"];
    const fromUsers = (state.users || [])
      .filter((u) => u.active !== false)
      .map((u) => String(u.name || "").trim())
      .filter(Boolean);
    const fromJobs = state.jobs.map((j) => String(j.assignee || "").trim()).filter(Boolean);
    return [...new Set([...defaults, ...fromUsers, ...fromJobs])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  function renderRepDayCard(name, jobs) {
    const sorted = [...jobs].sort(compareJobStart);
    const minutes = sorted.reduce((sum, j) => sum + (Number(j.durationMin) || 0), 0);
    const next = sorted[0];
    const stageCounts = {};
    for (const job of sorted) {
      const key = job.status || "scheduled";
      stageCounts[key] = (stageCounts[key] || 0) + 1;
    }
    const stageBits = Object.entries(stageCounts)
      .map(([id, count]) => {
        const meta = statusMeta(JOB_STATUSES, id);
        return `<span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}${
          count > 1 ? ` · ${count}` : ""
        }</span>`;
      })
      .join("");

    const body = sorted.length
      ? sorted
          .map((job) => {
            const meta = statusMeta(JOB_STATUSES, job.status);
            return `
          <button type="button" class="rep-appt" data-open-job="${escapeHtml(job.id)}">
            <span class="rep-appt__time">${escapeHtml(job.startTime || "TBD")}</span>
            <span class="rep-appt__body">
              <strong>${escapeHtml(job.title)}</strong>
              <small>${escapeHtml(job.clientName || "No client")} · ${escapeHtml(meta.label)} · ${escapeHtml(
              formatDurationLabel(job.durationMin)
            )}</small>
            </span>
          </button>`;
          })
          .join("")
      : `<div class="rep-card__empty">No appointments today</div>`;

    return `
      <article class="rep-card ${sorted.length ? "has-appts" : "is-clear"}">
        <header class="rep-card__head">
          <div>
            <h3>${escapeHtml(name)}</h3>
            <p class="rep-card__summary">
              ${
                sorted.length
                  ? `${sorted.length} appointment${sorted.length === 1 ? "" : "s"} · ${escapeHtml(
                      formatDurationLabel(minutes)
                    )} booked`
                  : "Clear day"
              }
            </p>
          </div>
          ${
            next
              ? `<div class="rep-card__next">
                  <span>Next</span>
                  <strong>${escapeHtml(next.startTime || "TBD")}</strong>
                </div>`
              : `<div class="rep-card__next is-free"><span>Status</span><strong>Free</strong></div>`
          }
        </header>
        ${stageBits ? `<div class="rep-card__stages">${stageBits}</div>` : ""}
        <div class="rep-card__list">${body}</div>
      </article>`;
  }

  function renderHome() {
    const today = toIsoDate(new Date());
    const todayJobs = state.jobs
      .filter((j) => j.scheduledDate === today && j.status !== "unscheduled")
      .sort(compareJobStart);
    const unscheduled = state.jobs.filter((j) => j.status === "unscheduled" || !j.scheduledDate);
    const openRequests = state.leads.filter((l) => l.stage === "new" || l.stage === "audit");
    const awaitingQuotes = state.quotes.filter((q) => q.status === "sent");
    const moneyDue = state.invoices
      .filter((i) => i.status === "sent" || i.status === "overdue")
      .reduce((sum, i) => sum + (i.amountCents || 0), 0);
    const overdue = state.invoices.filter((i) => i.status === "overdue");
    const changeRequests = state.jobs.filter((j) => j.status === "change_request");

    const byRep = new Map();
    for (const name of homeRepNames()) byRep.set(name, []);
    const unassigned = [];
    for (const job of todayJobs) {
      const name = String(job.assignee || "").trim();
      if (!name) {
        unassigned.push(job);
        continue;
      }
      if (!byRep.has(name)) byRep.set(name, []);
      byRep.get(name).push(job);
    }
    const repsWorking = [...byRep.values()].filter((list) => list.length).length + (unassigned.length ? 1 : 0);
    const minutesBooked = todayJobs.reduce((sum, j) => sum + (Number(j.durationMin) || 0), 0);

    const repCards = [
      ...[...byRep.entries()].map(([name, jobs]) => renderRepDayCard(name, jobs)),
      ...(unassigned.length ? [renderRepDayCard("Unassigned", unassigned)] : []),
    ].join("");

    els.home.innerHTML = `
      <div class="home-grid">
        <button type="button" class="stat-card" data-jump="schedule">
          <span class="stat-card__label">Today’s appointments</span>
          <strong>${todayJobs.length}</strong>
          <span class="stat-card__meta">${escapeHtml(formatDurationLabel(minutesBooked))} on the books</span>
        </button>
        <button type="button" class="stat-card" data-jump="schedule">
          <span class="stat-card__label">Reps working</span>
          <strong>${repsWorking}</strong>
          <span class="stat-card__meta">With something today</span>
        </button>
        <button type="button" class="stat-card" data-jump="requests">
          <span class="stat-card__label">Open requests</span>
          <strong>${openRequests.length}</strong>
          <span class="stat-card__meta">Rob → Brad handoffs</span>
        </button>
        <button type="button" class="stat-card" data-jump="quotes">
          <span class="stat-card__label">Quotes waiting</span>
          <strong>${awaitingQuotes.length}</strong>
          <span class="stat-card__meta">${changeRequests.length} change request${
            changeRequests.length === 1 ? "" : "s"
          }</span>
        </button>
        <button type="button" class="stat-card" data-jump="invoices">
          <span class="stat-card__label">Outstanding</span>
          <strong>${formatMoney(moneyDue)}</strong>
          <span class="stat-card__meta">${overdue.length} overdue</span>
        </button>
      </div>

      <section class="home-panel home-panel--wide">
        <div class="home-panel__head">
          <div>
            <h2>Reps today</h2>
            <p class="home-panel__sub">Appointments and build stages for ${escapeHtml(today)}</p>
          </div>
          <button type="button" class="btn btn-soft" data-jump="schedule">Full schedule</button>
        </div>
        <div class="rep-board">
          ${repCards || `<div class="drop-hint"><span>No reps on file yet</span></div>`}
        </div>
      </section>

      <div class="home-columns">
        <section class="home-panel">
          <div class="home-panel__head">
            <h2>Day timeline</h2>
            <button type="button" class="btn btn-soft" data-jump="schedule">Schedule</button>
          </div>
          <div class="home-list">
            ${
              todayJobs.length
                ? todayJobs
                    .map((job) => {
                      const meta = statusMeta(JOB_STATUSES, job.status);
                      return `
              <button type="button" class="home-row" data-open-job="${escapeHtml(job.id)}">
                <span class="home-row__time">${escapeHtml(job.startTime || "Anytime")}</span>
                <span>
                  <strong>${escapeHtml(job.title)}</strong>
                  <small>${escapeHtml(job.assignee || "Unassigned")} · ${escapeHtml(
                        job.clientName || "No client"
                      )} · ${escapeHtml(meta.label)}</small>
                </span>
              </button>`;
                    })
                    .join("")
                : `<div class="drop-hint"><span>Nothing booked today</span></div>`
            }
          </div>
        </section>

        <section class="home-panel">
          <div class="home-panel__head">
            <h2>Needs attention</h2>
            <button type="button" class="btn btn-soft" data-jump="jobs">Builds</button>
          </div>
          <div class="home-list">
            ${
              [
                ...changeRequests.slice(0, 3).map(
                  (job) => `
              <button type="button" class="home-row" data-open-job="${escapeHtml(job.id)}">
                <span class="chip chip-rust">Change request</span>
                <span><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(
                    job.assignee || "Unassigned"
                  )} · ${escapeHtml(job.clientName || "")}</small></span>
              </button>`
                ),
                ...unscheduled.slice(0, 3).map(
                  (job) => `
              <button type="button" class="home-row" data-open-job="${escapeHtml(job.id)}">
                <span class="chip chip-slate">Unscheduled</span>
                <span><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(
                    job.assignee || "Unassigned"
                  )} · ${escapeHtml(job.clientName || "")}</small></span>
              </button>`
                ),
                ...overdue.slice(0, 2).map(
                  (inv) => `
              <button type="button" class="home-row" data-open-invoice="${escapeHtml(inv.id)}">
                <span class="chip chip-rust">Overdue</span>
                <span><strong>${escapeHtml(inv.number)}</strong><small>${formatMoney(
                    inv.amountCents
                  )} · ${escapeHtml(inv.clientName)}</small></span>
              </button>`
                ),
                ...openRequests.slice(0, 2).map(
                  (lead) => `
              <button type="button" class="home-row" data-open-lead="${escapeHtml(lead.id)}">
                <span class="chip chip-gold">${escapeHtml(lead.requestedBy || "Rob")}→${escapeHtml(
                    lead.assignee || "Brad"
                  )}</span>
                <span><strong>${escapeHtml(lead.business)}</strong><small>${escapeHtml(
                    (lead.notes || lead.name || "").slice(0, 48)
                  )}</small></span>
              </button>`
                ),
              ].join("") || `<div class="drop-hint"><span>You’re caught up</span></div>`
            }
          </div>
        </section>
      </div>

      <div class="home-actions">
        <button type="button" class="btn btn-primary" data-create="request">New request</button>
        <button type="button" class="btn btn-soft" data-create="client">New client</button>
        <button type="button" class="btn btn-soft" data-jump="requests">Open requests</button>
        <button type="button" class="btn btn-soft" data-jump="pipeline">Sales pipeline</button>
      </div>`;

    els.home.querySelectorAll("[data-jump]").forEach((btn) =>
      btn.addEventListener("click", () => setView(btn.dataset.jump))
    );
    els.home.querySelectorAll("[data-create]").forEach((btn) =>
      btn.addEventListener("click", () => createItem(btn.dataset.create))
    );
    els.home.querySelectorAll("[data-open-job]").forEach((btn) =>
      btn.addEventListener("click", () => openJob(btn.dataset.openJob))
    );
    els.home.querySelectorAll("[data-open-invoice]").forEach((btn) =>
      btn.addEventListener("click", () => openInvoice(btn.dataset.openInvoice))
    );
    els.home.querySelectorAll("[data-open-lead]").forEach((btn) =>
      btn.addEventListener("click", () => openLead(btn.dataset.openLead))
    );
  }

  function bindLeadCard(card) {
    card.addEventListener("click", () => openLead(card.dataset.id));
    card.addEventListener("dragstart", (event) => {
      state.dragId = card.dataset.id;
      state.dragKind = "lead";
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `lead:${card.dataset.id}`);
    });
    card.addEventListener("dragend", () => {
      state.dragId = null;
      state.dragKind = null;
      card.classList.remove("is-dragging");
      els.pipeline.querySelectorAll(".pipeline-col").forEach((col) => col.classList.remove("is-over"));
    });
  }

  function bindJobCard(card) {
    card.addEventListener("click", () => openJob(card.dataset.id));
    card.addEventListener("dragstart", (event) => {
      state.dragId = card.dataset.id;
      state.dragKind = "job";
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `job:${card.dataset.id}`);
      document.body.classList.add("is-dragging-job");
    });
    card.addEventListener("dragend", () => {
      state.dragId = null;
      state.dragKind = null;
      card.classList.remove("is-dragging");
      document.body.classList.remove("is-dragging-job");
      document
        .querySelectorAll(".schedule-day, .unscheduled-list, .time-slot, .month-day")
        .forEach((el) => el.classList.remove("is-over"));
    });
  }

  function leadLogoUrl(leadOrId) {
    if (!leadOrId) return "";
    if (typeof leadOrId === "object") return String(leadOrId.logoUrl || "").trim();
    const lead = state.leads.find((l) => l.id === leadOrId);
    return String(lead?.logoUrl || "").trim();
  }

  function jobLeadLogo(job) {
    if (!job) return "";
    const byId = leadLogoUrl(job.leadId);
    if (byId) return byId;
    const name = String(job.clientName || "").trim().toLowerCase();
    if (!name) return "";
    const lead = state.leads.find(
      (l) =>
        String(l.business || "").trim().toLowerCase() === name ||
        String(l.name || "").trim().toLowerCase() === name
    );
    return String(lead?.logoUrl || "").trim();
  }

  function jobCardHtml(job, { compact = false, mini = false } = {}) {
    const time = job.startTime ? job.startTime : "Anytime";
    const logo = jobLeadLogo(job);
    if (mini) {
      return `
        <article class="job-card job-card--mini tone-${escapeHtml(job.color || "slate")}" draggable="true" data-id="${escapeHtml(job.id)}">
          ${logo ? `<img class="job-card__logo" src="${escapeHtml(logo)}" alt="" loading="lazy" />` : ""}
          <span class="job-card__time">${escapeHtml(time)}</span>
          <p class="job-card__title">${escapeHtml(job.title)}</p>
        </article>`;
    }
    return `
      <article class="job-card tone-${escapeHtml(job.color || "slate")}" draggable="true" data-id="${escapeHtml(job.id)}">
        <div class="job-card__top">
          <span class="job-card__time">${escapeHtml(time)} · ${escapeHtml(String(job.durationMin || 90))}m</span>
          ${job.assignee ? `<span class="job-card__who">${escapeHtml(job.assignee)}</span>` : `<span class="job-card__who is-open">Open</span>`}
        </div>
        <div class="job-card__main">
          ${logo ? `<img class="job-card__logo" src="${escapeHtml(logo)}" alt="" loading="lazy" />` : ""}
          <div class="job-card__copy">
            <p class="job-card__title">${escapeHtml(job.title)}</p>
            ${compact ? "" : `<p class="job-card__client">${escapeHtml(job.clientName || "No client")}</p>`}
          </div>
        </div>
      </article>`;
  }

  async function rescheduleJob(job, payload) {
    const same =
      job.scheduledDate === payload.scheduledDate &&
      (job.startTime || null) === (payload.startTime || null) &&
      job.status === payload.status;
    if (same) return;
    const snapshot = { ...job };
    Object.assign(job, payload);
    render();
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      upsertJob(data.job);
      if (payload.status === "unscheduled") toast("Moved to unscheduled");
      else toast(`Build booked ${formatDate(payload.scheduledDate)} · ${payload.startTime || "8:00"}`);
    } catch (err) {
      Object.assign(job, snapshot);
      toast(err.message || "Could not reschedule");
      await loadJobs();
      render();
    }
  }

  function bindScheduleDrops(root) {
    root.querySelectorAll(".job-card").forEach(bindJobCard);
    root.querySelectorAll("[data-drop]").forEach((zone) => {
      zone.addEventListener("dragover", (event) => {
        if (state.dragKind && state.dragKind !== "job") return;
        event.preventDefault();
        zone.classList.add("is-over");
      });
      zone.addEventListener("dragleave", (event) => {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
      });
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.classList.remove("is-over");
        const id = state.dragId || event.dataTransfer.getData("text/plain").replace(/^job:/, "");
        const job = state.jobs.find((j) => j.id === id);
        if (!job) return;
        const drop = zone.dataset.drop;
        let payload;
        if (drop === "unscheduled") {
          payload = { status: "unscheduled", scheduledDate: null, startTime: null };
        } else if (drop === "slot") {
          payload = {
            status:
              job.status === "done"
                ? "done"
                : job.status === "unscheduled"
                  ? "rough_draft"
                  : normalizeJobStatusId(job.status),
            scheduledDate: zone.dataset.date,
            startTime: zone.dataset.time,
          };
          if (zone.dataset.date) state.scheduleFocusDate = zone.dataset.date;
        } else {
          payload = {
            status:
              job.status === "done"
                ? "done"
                : job.status === "unscheduled"
                  ? "rough_draft"
                  : normalizeJobStatusId(job.status),
            scheduledDate: zone.dataset.date,
            startTime: normalizeSlotTime(job.startTime, { fallback: "08:00" }),
          };
          if (zone.dataset.date) state.scheduleFocusDate = zone.dataset.date;
        }
        await rescheduleJob(job, payload);
      });
    });
  }

  function renderPipeline() {
    const leads = filteredLeads();
    els.pipeline.innerHTML = `<div class="pipeline">${STAGES.map((stage) => {
      const items = leads.filter((l) => l.stage === stage.id);
      return `
        <section class="pipeline-col tone-${stage.tone}" data-stage="${stage.id}">
          <div class="pipeline-col__head">
            <h2>${stage.label}</h2>
            <span class="pipeline-col__count">${items.length}</span>
          </div>
          <div class="pipeline-col__list">
            ${
              items.length
                ? items
                    .map(
                      (lead) => `
              <article class="lead-card" draggable="true" data-id="${escapeHtml(lead.id)}">
                <div class="lead-card__grip" aria-hidden="true"></div>
                <p class="lead-card__name">${escapeHtml(lead.name)}</p>
                <p class="lead-card__biz">${escapeHtml(lead.business)}</p>
                <div class="lead-card__meta">
                  ${lead.industry ? `<span class="chip">${escapeHtml(lead.industry)}</span>` : ""}
                  <span class="chip chip-gold">${escapeHtml(formatDate(lead.updatedAt))}</span>
                </div>
              </article>`
                    )
                    .join("")
                : `<div class="drop-hint"><span>Drop here</span></div>`
            }
          </div>
        </section>`;
    }).join("")}</div>`;

    els.pipeline.querySelectorAll(".lead-card").forEach(bindLeadCard);
    els.pipeline.querySelectorAll(".pipeline-col").forEach((col) => {
      col.addEventListener("dragover", (event) => {
        if (state.dragKind && state.dragKind !== "lead") return;
        event.preventDefault();
        col.classList.add("is-over");
      });
      col.addEventListener("dragleave", () => col.classList.remove("is-over"));
      col.addEventListener("drop", async (event) => {
        event.preventDefault();
        col.classList.remove("is-over");
        const id = state.dragId || event.dataTransfer.getData("text/plain").replace(/^lead:/, "");
        const stage = col.dataset.stage;
        const lead = state.leads.find((l) => l.id === id);
        if (!lead || lead.stage === stage) return;
        const prev = lead.stage;
        lead.stage = stage;
        render();
        try {
          const data = await api(`/api/leads/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ stage }),
          });
          upsertLead(data.lead);
          toast(`Moved to ${stageLabel(stage)}`);
        } catch (err) {
          lead.stage = prev;
          toast(err.message || "Could not update stage");
          await loadLeads();
        }
      });
    });
  }

  function unscheduledRailHtml(unscheduled) {
    return `
      <aside class="unscheduled">
        <div class="unscheduled__head">
          <div>
            <h2>Backlog</h2>
            <p>${state.calendarMode === "week" ? "Drag builds onto a time slot" : "Drag builds onto a day"}</p>
          </div>
          <span class="pipeline-col__count">${unscheduled.length}</span>
        </div>
        <div class="unscheduled-list" data-drop="unscheduled">
          ${
            unscheduled.length
              ? unscheduled.map((job) => jobCardHtml(job)).join("")
              : `<div class="drop-hint"><span>Inbox is clear</span></div>`
          }
        </div>
      </aside>`;
  }

  function renderWeekSchedule(jobs) {
    const days = weekDays();
    const dayKeys = days.map(toIsoDate);
    const slots = hourSlots();
    const todayKey = toIsoDate(new Date());
    const focusDate = ensureScheduleFocusDate();
    const unscheduled = jobs.filter((j) => !j.scheduledDate || j.status === "unscheduled");
    const scheduled = jobs.filter((j) => j.scheduledDate && j.status !== "unscheduled");

    const byCell = {};
    const overflow = { early: {}, late: {} };
    dayKeys.forEach((key) => {
      overflow.early[key] = [];
      overflow.late[key] = [];
    });

    scheduled.forEach((job) => {
      if (!dayKeys.includes(job.scheduledDate)) return;
      const hour = slotHour(job.startTime);
      if (hour === null || hour < SLOT_START_HOUR) {
        overflow.early[job.scheduledDate].push(job);
        return;
      }
      if (hour > SLOT_END_HOUR) {
        overflow.late[job.scheduledDate].push(job);
        return;
      }
      const time = normalizeSlotTime(job.startTime);
      const cellKey = `${job.scheduledDate}|${time}`;
      if (!byCell[cellKey]) byCell[cellKey] = [];
      byCell[cellKey].push(job);
    });

    return `
      <div class="schedule schedule--week ${state.scheduleMapOpen === false ? "schedule--map-collapsed" : ""}">
        ${unscheduledRailHtml(unscheduled)}
        <div class="schedule-board">
          <div class="schedule-grid" style="--days:${days.length}">
            <div class="schedule-grid__corner"></div>
            ${days
              .map((day, i) => {
                const key = dayKeys[i];
                return `
                <button type="button" class="schedule-grid__dayhead ${key === todayKey ? "is-today" : ""} ${
                  key === focusDate ? "is-map-focus" : ""
                }" data-map-date="${key}" title="Show day map">
                  <span>${new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(day)}</span>
                  <strong>${day.getDate()}</strong>
                </button>`;
              })
              .join("")}
            ${
              dayKeys.some((k) => overflow.early[k].length)
                ? `
              <div class="schedule-grid__timelabel">Early</div>
              ${dayKeys
                .map((key) => {
                  const items = overflow.early[key];
                  return `<div class="time-slot time-slot--overflow ${
                    key === focusDate ? "is-map-focus" : ""
                  }" data-drop="slot" data-date="${key}" data-time="08:00">
                    ${items.map((job) => jobCardHtml(job, { mini: true })).join("") || ""}
                  </div>`;
                })
                .join("")}`
                : ""
            }
            ${slots
              .map(
                (time) => `
              <div class="schedule-grid__timelabel">${formatSlotLabel(time)}</div>
              ${dayKeys
                .map((key) => {
                  const items = byCell[`${key}|${time}`] || [];
                  return `
                  <div class="time-slot ${key === todayKey ? "is-today" : ""} ${
                    key === focusDate ? "is-map-focus" : ""
                  }" data-drop="slot" data-date="${key}" data-time="${time}">
                    ${items.map((job) => jobCardHtml(job, { mini: true })).join("")}
                  </div>`;
                })
                .join("")}`
              )
              .join("")}
            ${
              dayKeys.some((k) => overflow.late[k].length)
                ? `
              <div class="schedule-grid__timelabel">Later</div>
              ${dayKeys
                .map((key) => {
                  const items = overflow.late[key];
                  return `<div class="time-slot time-slot--overflow ${
                    key === focusDate ? "is-map-focus" : ""
                  }" data-drop="slot" data-date="${key}" data-time="${String(SLOT_END_HOUR).padStart(2, "0")}:00">
                    ${items.map((job) => jobCardHtml(job, { mini: true })).join("") || ""}
                  </div>`;
                })
                .join("")}`
                : ""
            }
          </div>
        </div>
        ${scheduleDayMapHtml(jobs)}
      </div>`;
  }

  function renderMonthSchedule(jobs) {
    const monthStart = startOfMonth(state.monthCursor);
    const gridStart = startOfWeek(monthStart);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const todayKey = toIsoDate(new Date());
    const focusDate = ensureScheduleFocusDate();
    const month = monthStart.getMonth();
    const unscheduled = jobs.filter((j) => !j.scheduledDate || j.status === "unscheduled");
    const byDay = {};
    jobs.forEach((job) => {
      if (!job.scheduledDate || job.status === "unscheduled") return;
      if (!byDay[job.scheduledDate]) byDay[job.scheduledDate] = [];
      byDay[job.scheduledDate].push(job);
    });

    return `
      <div class="schedule schedule--month ${state.scheduleMapOpen === false ? "schedule--map-collapsed" : ""}">
        ${unscheduledRailHtml(unscheduled)}
        <div class="month-board">
          <div class="month-dow">
            ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span>${d}</span>`).join("")}
          </div>
          <div class="month-grid">
            ${days
              .map((day) => {
                const key = toIsoDate(day);
                const items = (byDay[key] || []).slice().sort((a, b) =>
                  String(a.startTime || "").localeCompare(String(b.startTime || ""))
                );
                const inMonth = day.getMonth() === month;
                return `
                <section class="month-day ${key === todayKey ? "is-today" : ""} ${
                  key === focusDate ? "is-map-focus" : ""
                } ${inMonth ? "" : "is-outside"}" data-drop="day" data-date="${key}" data-map-date="${key}">
                  <div class="month-day__head">
                    <strong>${day.getDate()}</strong>
                    ${items.length ? `<span class="pipeline-col__count">${items.length}</span>` : ""}
                  </div>
                  <div class="month-day__list">
                    ${items
                      .slice(0, 3)
                      .map((job) => jobCardHtml(job, { mini: true }))
                      .join("")}
                    ${items.length > 3 ? `<div class="month-day__more">+${items.length - 3} more</div>` : ""}
                  </div>
                </section>`;
              })
              .join("")}
          </div>
        </div>
        ${scheduleDayMapHtml(jobs)}
      </div>`;
  }

  function renderSchedule() {
    const jobs = state.jobs.filter((job) =>
      matchesQuery([job.title, job.clientName, job.assignee, job.notes, job.status])
    );
    ensureScheduleFocusDate();
    updateCalendarChrome();
    els.schedule.innerHTML =
      state.calendarMode === "month" ? renderMonthSchedule(jobs) : renderWeekSchedule(jobs);
    bindScheduleDrops(els.schedule);
    bindScheduleMap(els.schedule, jobs);

    els.schedule.querySelectorAll(".month-day__head strong").forEach((el) => {
      el.addEventListener("dblclick", (event) => {
        const day = event.currentTarget.closest(".month-day");
        if (!day?.dataset.date) return;
        state.scheduleFocusDate = day.dataset.date;
        state.calendarMode = "week";
        state.weekStart = startOfWeek(new Date(`${day.dataset.date}T12:00:00`));
        render();
      });
    });
  }

  function renderClients() {
    const leads = sortedClientLeads(filteredLeads());
    if (!leads.length) {
      els.clients.innerHTML = emptyPanel("No clients match", "Try another search, or create a client.");
      return;
    }
    const headers = [
      clientsSortHeader("Client", "client", { showTri: true }),
      clientsSortHeader("Contact", "contact"),
      clientsSortHeader("Location", "location"),
      clientsSortHeader("Stage", "stage"),
      clientsSortHeader("Updated", "updated"),
    ];
    els.clients.innerHTML = listTable(
      headers,
      leads
        .map((lead) => {
          const address = formatClientAddress(lead);
          const mapsUrl = mapsUrlForLead(lead);
          return `
        <tr data-id="${escapeHtml(lead.id)}" data-kind="lead">
          <td><strong>${escapeHtml(lead.business)}</strong><div class="muted">${escapeHtml(lead.source || "manual")}</div></td>
          <td>${escapeHtml(lead.name)}<div class="muted">${escapeHtml(lead.email || lead.phone || "—")}</div></td>
          <td class="muted">${
            address
              ? `<a class="maps-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" data-stop-row>${escapeHtml(
                  [lead.city, lead.region].filter(Boolean).join(", ") || address
                )}</a>`
              : "—"
          }</td>
          <td><span class="chip chip-${statusMeta(STAGES, lead.stage).tone}">${escapeHtml(stageLabel(lead.stage))}</span></td>
          <td class="muted">${escapeHtml(formatDate(lead.updatedAt))}</td>
        </tr>`;
        })
        .join("")
    );
    els.clients.querySelectorAll("[data-clients-sort]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleClientsSort(btn.dataset.clientsSort);
        renderClients();
      });
    });
    els.clients.querySelectorAll("[data-stop-row]").forEach((link) => {
      link.addEventListener("click", (event) => event.stopPropagation());
    });
    els.clients.querySelectorAll("tbody tr").forEach((row) =>
      row.addEventListener("click", () => openLead(row.dataset.id))
    );
  }

  function renderRequests() {
    const leads = requestLeads();
    if (!leads.length) {
      els.requests.innerHTML = emptyPanel(
        "No open requests",
        "When Rob logs a client handoff for Brad, it shows up here with notes on what they want."
      );
      return;
    }
    els.requests.innerHTML = `
      <div class="request-board">
        <div class="request-board__intro">
          <p class="muted" style="margin:0">
            Internal inbox · <strong>Rob → Brad</strong> · notes capture what the client wants before quote or build.
          </p>
          <button type="button" class="btn btn-primary" data-create-request>+ New request</button>
        </div>
        <div class="request-board__list">
          ${leads
            .map((lead) => {
              const from = lead.requestedBy || "Rob";
              const to = lead.assignee || "Brad";
              const wants = String(lead.notes || "").trim();
              const meta = statusMeta(STAGES, lead.stage);
              return `
            <article class="request-card tone-${meta.tone}" data-open-request="${escapeHtml(lead.id)}">
              <div class="request-card__handoff">
                <span class="request-card__from">${escapeHtml(from)}</span>
                <span class="request-card__arrow" aria-hidden="true">→</span>
                <span class="request-card__to">${escapeHtml(to)}</span>
                <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
              </div>
              <h3 class="request-card__title">${escapeHtml(lead.business || lead.name)}</h3>
              <p class="request-card__contact">${escapeHtml(lead.name)}${
                lead.phone || lead.email
                  ? ` · ${escapeHtml(lead.phone || lead.email)}`
                  : ""
              }</p>
              <div class="request-card__wants">
                <span class="request-card__wants-label">What the client wants</span>
                <p>${escapeHtml(wants || "No notes yet — add what Rob heard from the client.")}</p>
              </div>
              <div class="request-card__foot">
                <span class="muted">Updated ${escapeHtml(formatDate(lead.updatedAt))}</span>
                <span class="muted">${escapeHtml(lead.source === "internal" ? "Internal" : lead.source || "manual")}</span>
              </div>
            </article>`;
            })
            .join("")}
        </div>
      </div>`;
    els.requests.querySelector("[data-create-request]")?.addEventListener("click", () => openNewRequest());
    els.requests.querySelectorAll("[data-open-request]").forEach((card) => {
      card.addEventListener("click", () => openLead(card.dataset.openRequest));
    });
  }

  function quoteCardHtml(quote) {
    const meta = statusMeta(QUOTE_STATUSES, quote.status);
    const canSchedule = quote.status !== "declined";
    const sentLine =
      quote.status === "sent" && quote.sentAt ? `Sent ${formatDate(quote.sentAt)}` : `Updated ${formatDate(quote.updatedAt)}`;
    return `
      <article class="doc-card tone-${meta.tone}" data-open-quote="${escapeHtml(quote.id)}">
        <div class="doc-card__top">
          <strong>${escapeHtml(quote.number)}</strong>
          <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
        </div>
        <p class="doc-card__title">${escapeHtml(quote.title)}</p>
        <p class="doc-card__client">${escapeHtml(quote.clientName || "No client")}</p>
        <div class="doc-card__foot">
          <span class="doc-card__amount">${escapeHtml(formatMoney(quote.amountCents))}</span>
          <span class="doc-card__meta">${escapeHtml(sentLine)}</span>
        </div>
        ${
          canSchedule
            ? `<button type="button" class="btn btn-soft doc-card__action" data-schedule-quote="${escapeHtml(
                quote.id
              )}">Schedule build</button>`
            : ""
        }
      </article>`;
  }

  function renderQuotes() {
    const quotes = filteredQuotes();
    const all = state.quotes.filter((quote) =>
      matchesQuery([quote.number, quote.title, quote.clientName, quote.status, quote.notes])
    );
    const waiting = all.filter((q) => q.status === "sent" || q.status === "revisions_requested");
    const approved = all.filter((q) => q.status === "approved");
    const pipelineCents = waiting.reduce((sum, q) => sum + (q.amountCents || 0), 0);
    const approvedCents = approved.reduce((sum, q) => sum + (q.amountCents || 0), 0);

    if (!quotes.length) {
      els.quotes.innerHTML = `
        <div class="money-workspace">
          <div class="money-stats">
            <button type="button" class="money-stat" data-filter-jump="sent">
              <span class="money-stat__label">Waiting</span>
              <strong>${waiting.length}</strong>
              <span class="money-stat__meta">${escapeHtml(formatMoney(pipelineCents))} out</span>
            </button>
            <button type="button" class="money-stat" data-filter-jump="approved">
              <span class="money-stat__label">Approved</span>
              <strong>${approved.length}</strong>
              <span class="money-stat__meta">${escapeHtml(formatMoney(approvedCents))} ready to build</span>
            </button>
            <button type="button" class="money-stat" data-create="request">
              <span class="money-stat__label">New client</span>
              <strong>+</strong>
              <span class="money-stat__meta">Then quote or skip to build</span>
            </button>
          </div>
          ${emptyPanel(
            "No quotes match",
            "Open a client first — quote is optional; you can skip straight to a build."
          )}
        </div>`;
      bindMoneyWorkspace(els.quotes);
      return;
    }

    const columns =
      state.statusFilter === "all"
        ? QUOTE_STATUSES
        : QUOTE_STATUSES.filter((s) => s.id === state.statusFilter);

    els.quotes.innerHTML = `
      <div class="money-workspace">
        <div class="money-stats">
          <button type="button" class="money-stat" data-filter-jump="all">
            <span class="money-stat__label">In view</span>
            <strong>${quotes.length}</strong>
            <span class="money-stat__meta">${escapeHtml(
              formatMoney(quotes.reduce((sum, q) => sum + (q.amountCents || 0), 0))
            )}</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="sent">
            <span class="money-stat__label">Awaiting decision</span>
            <strong>${waiting.length}</strong>
            <span class="money-stat__meta">${escapeHtml(formatMoney(pipelineCents))}</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="approved">
            <span class="money-stat__label">Approved</span>
            <strong>${approved.length}</strong>
            <span class="money-stat__meta">Schedule builds next</span>
          </button>
          <button type="button" class="money-stat" data-create="request">
            <span class="money-stat__label">Start</span>
            <strong>+</strong>
            <span class="money-stat__meta">New client first</span>
          </button>
        </div>
        <div class="money-board" style="--cols:${columns.length}">
          ${columns
            .map((status) => {
              const items = quotes
                .filter((q) => q.status === status.id)
                .slice()
                .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
              const total = items.reduce((sum, q) => sum + (q.amountCents || 0), 0);
              return `
              <section class="money-col tone-${status.tone}">
                <div class="money-col__head">
                  <div>
                    <h2>${escapeHtml(status.label)}</h2>
                    <p>${items.length} · ${escapeHtml(formatMoney(total))}</p>
                  </div>
                  <span class="pipeline-col__count">${items.length}</span>
                </div>
                <div class="money-col__list">
                  ${
                    items.length
                      ? items.map(quoteCardHtml).join("")
                      : `<div class="drop-hint"><span>None here</span></div>`
                  }
                </div>
              </section>`;
            })
            .join("")}
        </div>
      </div>`;
    bindMoneyWorkspace(els.quotes);
  }

  function buildPipelineCardHtml(job) {
    const meta = statusMeta(JOB_STATUSES, job.status);
    const when =
      job.status === "unscheduled" || !job.scheduledDate
        ? "Not on calendar"
        : `${formatDate(job.scheduledDate)}${job.startTime ? ` · ${job.startTime}` : ""}`;
    return `
      <article class="build-card tone-${meta.tone}" draggable="true" data-id="${escapeHtml(job.id)}">
        <div class="build-card__grip" aria-hidden="true"></div>
        <div class="build-card__top">
          <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
          <span class="build-card__who">${escapeHtml(job.assignee || "Open")}</span>
        </div>
        <p class="build-card__title">${escapeHtml(job.title)}</p>
        <p class="build-card__client">${escapeHtml(job.clientName || "No client")}</p>
        <div class="build-card__meta">
          <span>${escapeHtml(when)}</span>
          <span>${escapeHtml(String(job.durationMin || 90))}m</span>
        </div>
      </article>`;
  }

  function renderJobsList() {
    const jobs = filteredJobs().map((job) => ({
      ...job,
      status: normalizeJobStatusId(job.status),
    }));
    const all = state.jobs
      .filter((job) => matchesQuery([job.title, job.clientName, job.assignee, job.notes, job.status]))
      .map((job) => ({ ...job, status: normalizeJobStatusId(job.status) }));

    const backlog = all.filter((j) => j.status === "unscheduled").length;
    const inFlight = all.filter(
      (j) => j.status === "rough_draft" || j.status === "architecture" || j.status === "fine_tuning"
    ).length;
    const waiting = all.filter(
      (j) => j.status === "client_approval" || j.status === "change_request"
    ).length;
    const delivered = all.filter((j) => j.status === "done").length;

    const columns =
      state.statusFilter === "all"
        ? JOB_STATUSES
        : JOB_STATUSES.filter((s) => s.id === normalizeJobStatusId(state.statusFilter));

    els.jobs.innerHTML = `
      <div class="money-workspace">
        <div class="money-stats">
          <button type="button" class="money-stat" data-filter-jump="unscheduled">
            <span class="money-stat__label">Backlog</span>
            <strong>${backlog}</strong>
            <span class="money-stat__meta">Not started</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="rough_draft">
            <span class="money-stat__label">In production</span>
            <strong>${inFlight}</strong>
            <span class="money-stat__meta">Draft → architecture → polish</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="client_approval">
            <span class="money-stat__label">With client</span>
            <strong>${waiting}</strong>
            <span class="money-stat__meta">Approval or changes</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="done">
            <span class="money-stat__label">Delivered</span>
            <strong>${delivered}</strong>
            <span class="money-stat__meta">Shipped</span>
          </button>
          <button type="button" class="money-stat" data-create="request">
            <span class="money-stat__label">Start</span>
            <strong>+</strong>
            <span class="money-stat__meta">New client first</span>
          </button>
        </div>
        ${
          jobs.length
            ? `<div class="build-pipeline" style="--cols:${columns.length}">
          ${columns
            .map((status) => {
              const items = jobs
                .filter((j) => j.status === status.id)
                .slice()
                .sort((a, b) =>
                  String(a.scheduledDate || "9999").localeCompare(String(b.scheduledDate || "9999"))
                );
              return `
              <section class="money-col tone-${status.tone}" data-build-stage="${status.id}">
                <div class="money-col__head">
                  <div>
                    <h2>${escapeHtml(status.label)}</h2>
                    <p>Drag builds between stages</p>
                  </div>
                  <span class="pipeline-col__count">${items.length}</span>
                </div>
                <div class="money-col__list" data-build-drop="${status.id}">
                  ${
                    items.length
                      ? items.map(buildPipelineCardHtml).join("")
                      : `<div class="drop-hint"><span>Drop here</span></div>`
                  }
                </div>
              </section>`;
            })
            .join("")}
        </div>`
            : emptyPanel(
                "No builds match",
                "Add a client first, then start a build from their page (quote is optional)."
              )
        }
      </div>`;

    bindMoneyWorkspace(els.jobs);
    bindBuildPipeline(els.jobs);
  }

  function bindBuildPipeline(root) {
    if (!root) return;
    root.querySelectorAll(".build-card").forEach((card) => {
      card.addEventListener("click", () => openJob(card.dataset.id));
      card.addEventListener("dragstart", (event) => {
        state.dragId = card.dataset.id;
        state.dragKind = "job";
        card.classList.add("is-dragging");
        document.body.classList.add("is-dragging-job");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `job:${card.dataset.id}`);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        document.body.classList.remove("is-dragging-job");
        root.querySelectorAll(".money-col").forEach((col) => col.classList.remove("is-over"));
      });
    });

    root.querySelectorAll("[data-build-drop]").forEach((zone) => {
      const col = zone.closest(".money-col");
      zone.addEventListener("dragover", (event) => {
        if (state.dragKind && state.dragKind !== "job") return;
        event.preventDefault();
        col?.classList.add("is-over");
      });
      zone.addEventListener("dragleave", (event) => {
        if (!zone.contains(event.relatedTarget)) col?.classList.remove("is-over");
      });
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        col?.classList.remove("is-over");
        const id = state.dragId || event.dataTransfer.getData("text/plain").replace(/^job:/, "");
        const nextStatus = zone.dataset.buildDrop;
        const job = state.jobs.find((j) => j.id === id);
        if (!job || !nextStatus) return;
        const prev = job.status;
        if (normalizeJobStatusId(prev) === nextStatus) return;
        const payload = { status: nextStatus };
        if (nextStatus === "unscheduled") {
          payload.scheduledDate = null;
          payload.startTime = null;
        } else if (!job.scheduledDate && nextStatus !== "done") {
          // Keep date if present; backlog → first stage can stay unscheduled on calendar
        }
        job.status = nextStatus;
        if (nextStatus === "unscheduled") {
          job.scheduledDate = null;
          job.startTime = null;
        }
        render();
        try {
          const data = await api(`/api/jobs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          upsertJob(data.job);
          toast(`Moved to ${statusMeta(JOB_STATUSES, nextStatus).label}`);
        } catch (err) {
          job.status = prev;
          toast(err.message || "Could not move build");
          await loadJobs();
          render();
        }
      });
    });
  }

  function invoiceDueLabel(invoice) {
    if (!invoice.dueDate) return "No due date";
    const today = toIsoDate(new Date());
    if (invoice.status === "paid") return `Paid · was due ${formatDate(invoice.dueDate)}`;
    if (invoice.status === "overdue" || (invoice.status === "sent" && invoice.dueDate < today)) {
      return `Overdue · due ${formatDate(invoice.dueDate)}`;
    }
    if (invoice.dueDate === today) return "Due today";
    return `Due ${formatDate(invoice.dueDate)}`;
  }

  function invoiceCardHtml(invoice) {
    const meta = statusMeta(INVOICE_STATUSES, invoice.status);
    const due = invoiceDueLabel(invoice);
    const urgent =
      invoice.status === "overdue" ||
      (invoice.status === "sent" && invoice.dueDate && invoice.dueDate <= toIsoDate(new Date()));
    return `
      <article class="doc-card tone-${meta.tone} ${urgent ? "is-urgent" : ""}" data-open-invoice="${escapeHtml(
        invoice.id
      )}">
        <div class="doc-card__top">
          <strong>${escapeHtml(invoice.number)}</strong>
          <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
        </div>
        <p class="doc-card__title">${escapeHtml(invoice.title)}</p>
        <p class="doc-card__client">${escapeHtml(invoice.clientName || "No client")}</p>
        <div class="doc-card__foot">
          <span class="doc-card__amount">${escapeHtml(formatMoneyExact(invoice.amountCents))}</span>
          <span class="doc-card__meta ${urgent ? "is-urgent" : ""}">${escapeHtml(due)}</span>
        </div>
        ${
          invoice.billToEmail
            ? `<span class="doc-card__sub">Bill to ${escapeHtml(invoice.billToEmail)}</span>`
            : `<span class="doc-card__sub">Open to send on letterhead</span>`
        }
      </article>`;
  }

  function renderInvoices() {
    const invoices = filteredInvoices();
    const all = state.invoices.filter((invoice) =>
      matchesQuery([invoice.number, invoice.title, invoice.clientName, invoice.status, invoice.notes])
    );
    const outstanding = all.filter((i) => i.status === "sent" || i.status === "overdue");
    const overdue = all.filter((i) => i.status === "overdue");
    const drafts = all.filter((i) => i.status === "draft");
    const paid = all.filter((i) => i.status === "paid");
    const outstandingCents = outstanding.reduce((sum, i) => sum + (i.amountCents || 0), 0);
    const paidCents = paid.reduce((sum, i) => sum + (i.amountCents || 0), 0);

    if (!invoices.length) {
      els.invoices.innerHTML = `
        <div class="money-workspace">
          <div class="money-stats">
            <button type="button" class="money-stat" data-filter-jump="sent">
              <span class="money-stat__label">Outstanding</span>
              <strong>${escapeHtml(formatMoney(outstandingCents))}</strong>
              <span class="money-stat__meta">${outstanding.length} open</span>
            </button>
            <button type="button" class="money-stat" data-filter-jump="overdue">
              <span class="money-stat__label">Overdue</span>
              <strong>${overdue.length}</strong>
              <span class="money-stat__meta">Need a chase</span>
            </button>
            <button type="button" class="money-stat" data-create="request">
              <span class="money-stat__label">New client</span>
              <strong>+</strong>
              <span class="money-stat__meta">Then invoice from client</span>
            </button>
          </div>
          ${emptyPanel("No invoices match", "Create an invoice from a client or quote.")}
        </div>`;
      bindMoneyWorkspace(els.invoices);
      return;
    }

    const columns =
      state.statusFilter === "all"
        ? INVOICE_STATUSES
        : INVOICE_STATUSES.filter((s) => s.id === state.statusFilter);

    els.invoices.innerHTML = `
      <div class="money-workspace">
        <div class="money-stats">
          <button type="button" class="money-stat" data-filter-jump="sent">
            <span class="money-stat__label">Outstanding</span>
            <strong>${escapeHtml(formatMoney(outstandingCents))}</strong>
            <span class="money-stat__meta">${outstanding.length} open invoices</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="overdue">
            <span class="money-stat__label">Overdue</span>
            <strong>${overdue.length}</strong>
            <span class="money-stat__meta">Past due</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="draft">
            <span class="money-stat__label">Drafts</span>
            <strong>${drafts.length}</strong>
            <span class="money-stat__meta">Ready to send</span>
          </button>
          <button type="button" class="money-stat" data-filter-jump="paid">
            <span class="money-stat__label">Paid</span>
            <strong>${escapeHtml(formatMoney(paidCents))}</strong>
            <span class="money-stat__meta">${paid.length} collected</span>
          </button>
          <button type="button" class="money-stat" data-create="request">
            <span class="money-stat__label">Start</span>
            <strong>+</strong>
            <span class="money-stat__meta">New client first</span>
          </button>
        </div>
        <div class="money-board" style="--cols:${columns.length}">
          ${columns
            .map((status) => {
              const items = invoices
                .filter((inv) => inv.status === status.id)
                .slice()
                .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
              const total = items.reduce((sum, inv) => sum + (inv.amountCents || 0), 0);
              return `
              <section class="money-col tone-${status.tone}">
                <div class="money-col__head">
                  <div>
                    <h2>${escapeHtml(status.label)}</h2>
                    <p>${items.length} · ${escapeHtml(formatMoney(total))}</p>
                  </div>
                  <span class="pipeline-col__count">${items.length}</span>
                </div>
                <div class="money-col__list">
                  ${
                    items.length
                      ? items.map(invoiceCardHtml).join("")
                      : `<div class="drop-hint"><span>None here</span></div>`
                  }
                </div>
              </section>`;
            })
            .join("")}
        </div>
      </div>`;
    bindMoneyWorkspace(els.invoices);
  }

  function bindMoneyWorkspace(root) {
    if (!root) return;
    root.querySelectorAll("[data-filter-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.statusFilter = btn.dataset.filterJump || "all";
        renderFilters();
        render();
      });
    });
    root.querySelectorAll("[data-create]").forEach((btn) => {
      btn.addEventListener("click", () => createItem(btn.dataset.create));
    });
    root.querySelectorAll("[data-open-quote]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-schedule-quote]")) return;
        openQuote(card.dataset.openQuote);
      });
    });
    root.querySelectorAll("[data-schedule-quote]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        scheduleBuildFromQuote(btn.dataset.scheduleQuote);
      });
    });
    root.querySelectorAll("[data-open-invoice]").forEach((card) => {
      card.addEventListener("click", () => openInvoice(card.dataset.openInvoice));
    });
  }

  function veraChatLabel(chat) {
    return (
      chat.company ||
      chat.visitorName ||
      (chat.email ? chat.email.split("@")[0] : "") ||
      "Website visitor"
    );
  }

  function veraContactLine(chat) {
    return [chat.email, chat.phone].filter(Boolean).join(" · ") || "No contact yet";
  }

  function veraChatCardHtml(chat) {
    const label = veraChatLabel(chat);
    const who = [chat.visitorName, chat.company].filter(Boolean).join(" · ");
    const preview = String(chat.preview || "").trim();
    return `
      <button type="button" class="vera-card" data-vera-chat="${escapeHtml(chat.id)}">
        <div class="vera-card__top">
          <strong>${escapeHtml(label)}</strong>
          ${
            chat.leadId
              ? `<span class="chip chip-teal">Client linked</span>`
              : `<span class="chip chip-slate">Lead pending</span>`
          }
        </div>
        ${who && who !== label ? `<p class="vera-card__who">${escapeHtml(who)}</p>` : ""}
        <p class="vera-card__contact">${escapeHtml(veraContactLine(chat))}</p>
        <p class="vera-card__preview">${escapeHtml(preview || "No preview yet")}</p>
        <div class="vera-card__foot">
          <span>${escapeHtml(chat.pagePath || "/")}</span>
          <span>${escapeHtml(formatDate(chat.updatedAt))} · ${escapeHtml(
            String(chat.messageCount || 0)
          )} msgs</span>
        </div>
      </button>`;
  }

  async function openVeraChat(id) {
    try {
      const data = await api(`/api/vera-chats/${encodeURIComponent(id)}`);
      state.veraDetail = data;
      renderVera();
    } catch (err) {
      toast(err.message || "Could not open chat");
    }
  }

  function renderVera() {
    if (!els.vera) return;
    const q = state.query.trim().toLowerCase();
    const chats = (state.veraChats || []).filter((chat) => {
      if (!q) return true;
      return matchesQuery(
        [
          chat.visitorName,
          chat.company,
          chat.email,
          chat.phone,
          chat.preview,
          chat.pagePath,
          veraChatLabel(chat),
        ],
        q
      );
    });

    if (state.veraDetail?.chat) {
      const { chat, messages } = state.veraDetail;
      els.vera.innerHTML = `
        <div class="vera-inbox">
          <div class="vera-inbox__toolbar">
            <button type="button" class="btn btn-soft" data-vera-back>← All chats</button>
            ${
              chat.leadId
                ? `<button type="button" class="btn btn-primary" data-vera-lead="${escapeHtml(
                    chat.leadId
                  )}">Open client</button>`
                : `<span class="muted">No client linked yet</span>`
            }
          </div>
          <div class="vera-inbox__detail">
            <div class="vera-inbox__meta">
              <h3>${escapeHtml(veraChatLabel(chat))}</h3>
              <p class="muted">${escapeHtml(veraContactLine(chat))}</p>
              <p class="muted">${escapeHtml(chat.pagePath || "/")} · ${escapeHtml(
                formatDate(chat.updatedAt)
              )} · ${escapeHtml(String(chat.messageCount || messages?.length || 0))} messages</p>
            </div>
            <div class="vera-transcript">
              ${(messages || [])
                .map(
                  (msg) => `
                <div class="vera-transcript__msg is-${escapeHtml(msg.role)}">
                  <span class="vera-transcript__who">${msg.role === "user" ? "Visitor" : "Vera"}</span>
                  <p>${escapeHtml(msg.body)}</p>
                </div>`
                )
                .join("") || `<p class="muted">No messages saved.</p>`}
            </div>
          </div>
        </div>`;
      els.vera.querySelector("[data-vera-back]")?.addEventListener("click", () => {
        state.veraDetail = null;
        renderVera();
      });
      els.vera.querySelector("[data-vera-lead]")?.addEventListener("click", (event) => {
        openLead(event.currentTarget.dataset.veraLead);
      });
      return;
    }

    els.vera.innerHTML = `
      <div class="vera-inbox">
        <div class="vera-inbox__toolbar">
          <p class="vera-inbox__intro muted">
            Shared sales inbox — website chats from Vera. Anyone on the team can open and follow up.
          </p>
          <button type="button" class="btn btn-soft" data-vera-refresh>Refresh</button>
        </div>
        ${
          chats.length
            ? `<div class="vera-card-list">${chats.map((chat) => veraChatCardHtml(chat)).join("")}</div>`
            : emptyPanel(
                "No Vera chats yet",
                "When someone talks to Vera on the site, the transcript shows up here for the whole team."
              )
        }
      </div>`;

    els.vera.querySelector("[data-vera-refresh]")?.addEventListener("click", async () => {
      await loadVeraChats({ notify: true });
      renderVera();
    });
    els.vera.querySelectorAll("[data-vera-chat]").forEach((row) => {
      row.addEventListener("click", () => openVeraChat(row.dataset.veraChat));
    });
  }

  function renderReminders() {
    const reminders = state.reminders.filter((r) => matchesQuery(reminderSearchParts(r)));
    const settings = state.reminderSettings;

    els.reminders.innerHTML = `
      <div class="reminders-toolbar">
        <div>
          <p class="muted" style="margin:0">
            Owner days: <strong>${escapeHtml((settings?.ownerDays || []).join(", ") || "—")}</strong>
            · Client days: <strong>${escapeHtml((settings?.clientDays || []).join(", ") || "—")}</strong>
          </p>
        </div>
        <div class="reminders-toolbar__actions">
          <button type="button" class="btn btn-soft" data-jump="settings">Edit settings</button>
          <button type="button" class="btn btn-primary" id="run-reminders">Run reminders now</button>
        </div>
      </div>
      ${
        reminders.length
          ? listTable(
              ["When", "Audience", "Quote", "To", "Status"],
              reminders
                .map(
                  (r) => `
              <tr>
                <td class="muted">${escapeHtml(formatDate(r.createdAt))} · +${escapeHtml(String(r.dayOffset))}d</td>
                <td><span class="chip chip-${r.audience === "owner" ? "gold" : "teal"}">${escapeHtml(r.audience)}</span></td>
                <td><strong>${escapeHtml(r.quoteNumber || "—")}</strong><div class="muted">${escapeHtml(r.subject)}</div></td>
                <td class="muted">${escapeHtml(r.toEmail || "—")}</td>
                <td><span class="chip chip-${r.status === "failed" ? "rust" : r.status === "sent" ? "green" : "slate"}">${escapeHtml(r.status)}</span></td>
              </tr>`
                )
                .join("")
            )
          : emptyPanel(
              "No reminders yet",
              "Sent quotes trigger owner + client nudges on your day offsets. Click “Run reminders now” to process due ones."
            )
      }`;

    els.reminders.querySelector("[data-jump='settings']")?.addEventListener("click", () => setView("settings"));
    els.reminders.querySelector("#run-reminders")?.addEventListener("click", async () => {
      const btn = els.reminders.querySelector("#run-reminders");
      btn.disabled = true;
      btn.textContent = "Running…";
      try {
        const data = await api("/api/reminders/run", { method: "POST", body: "{}" });
        await loadReminders();
        render();
        toast(`Created ${data.created || 0} reminder(s)`);
      } catch (err) {
        toast(err.message || "Could not run reminders");
      } finally {
        btn.disabled = false;
        btn.textContent = "Run reminders now";
      }
    });
  }

  function renderSettings() {
    const s = state.reminderSettings || {
      ownerEmail: "",
      ownerEnabled: true,
      ownerDays: [2, 5, 10],
      clientEnabled: true,
      clientDays: [3, 7, 14],
      stopOnClosed: true,
    };
    const isAdmin = state.sessionUser?.role === "admin" || state.sessionUser?.isOwner;
    const isOwner = !!state.sessionUser?.isOwner;
    const users = state.users || [];

    els.settings.innerHTML = `
      <div class="settings-panel">
        <section class="settings-block">
          <h2>Password</h2>
          <p class="muted">
            Change the password for
            <strong>${escapeHtml(state.sessionUser?.email || "your account")}</strong>.
          </p>
          <form class="password-change-form" id="change-password-form" autocomplete="off">
            <div class="autofill-trap" aria-hidden="true">
              <input type="text" name="username" tabindex="-1" autocomplete="username" value="" />
              <input type="password" name="password" tabindex="-1" autocomplete="current-password" value="" />
            </div>
            <label class="field">
              <span>Current password</span>
              <input
                type="password"
                name="currentPassword"
                required
                autocomplete="off"
                data-lpignore="true"
                data-1p-ignore
                data-bwignore
                readonly
                placeholder="Current password"
              />
            </label>
            <div class="field-row">
              <label class="field">
                <span>New password</span>
                <input
                  type="password"
                  name="newPassword"
                  required
                  minlength="6"
                  autocomplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore
                  data-bwignore
                  placeholder="At least 6 characters"
                />
              </label>
              <label class="field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  required
                  minlength="6"
                  autocomplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore
                  data-bwignore
                  placeholder="Repeat new password"
                />
              </label>
            </div>
            <div class="settings-actions">
              <button type="submit" class="btn btn-primary">Update password</button>
            </div>
          </form>
        </section>

        ${
          isAdmin
            ? `
        <section class="settings-block">
          <h2>Users</h2>
          <p class="muted">
            Admins manage users. The account <strong>owner</strong> can’t be demoted or deactivated, and only the owner can delete CRM records.
          </p>

          <form class="user-add-form" id="add-user-form">
            <p class="field-group__label">Add user</p>
            <div class="field-row">
              <label class="field">
                <span>Email</span>
                <input type="email" name="email" required placeholder="teammate@vanderven.ca" autocomplete="off" />
              </label>
              <label class="field">
                <span>Name</span>
                <input name="name" placeholder="Riley" autocomplete="off" />
              </label>
            </div>
            <div class="field-row">
              <label class="field">
                <span>Password</span>
                <input type="password" name="password" required minlength="6" placeholder="At least 6 characters" autocomplete="new-password" />
              </label>
              <label class="field">
                <span>Role</span>
                <select name="role">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <div class="settings-actions">
              <button type="submit" class="btn btn-primary">Add user</button>
            </div>
          </form>

          <div class="user-list" id="user-list">
            ${
              users.length
                ? users
                    .map((user) => {
                      const self = state.sessionUser?.id && user.id === state.sessionUser.id;
                      const userIsOwner = !!user.isOwner;
                      return `
                <article class="user-row ${user.active ? "" : "is-inactive"}" data-user-id="${escapeHtml(user.id)}">
                  <div class="user-row__main">
                    <strong>${escapeHtml(user.name || user.email)}</strong>
                    <span class="user-row__email">${escapeHtml(user.email)}</span>
                  </div>
                  <div class="user-row__meta">
                    ${userIsOwner ? `<span class="chip chip-gold">Owner</span>` : ""}
                    <span class="chip chip-${user.role === "admin" || userIsOwner ? "gold" : "slate"}">${
                      userIsOwner ? "admin" : escapeHtml(user.role)
                    }</span>
                    <span class="chip chip-${user.active ? "teal" : "rust"}">${user.active ? "Active" : "Inactive"}</span>
                    ${self ? `<span class="chip chip-indigo">You</span>` : ""}
                  </div>
                  <div class="user-row__actions">
                    ${
                      userIsOwner
                        ? `<span class="muted">${self ? "Signed in · protected" : "Protected"}</span>`
                        : `
                      <label class="user-role-field">
                        <span class="visually-hidden">Role</span>
                        <select data-user-role="${escapeHtml(user.id)}" aria-label="Role for ${escapeHtml(user.name || user.email)}">
                          <option value="member" ${user.role === "member" ? "selected" : ""}>Member</option>
                          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
                        </select>
                      </label>
                      ${
                        self
                          ? `<span class="muted">Signed in</span>`
                          : `<button type="button" class="btn btn-soft" data-user-toggle="${escapeHtml(user.id)}" data-active="${
                              user.active ? "0" : "1"
                            }">${user.active ? "Deactivate" : "Activate"}</button>`
                      }
                      ${
                        isOwner && !self
                          ? `<button type="button" class="btn btn-soft" data-user-owner="${escapeHtml(user.id)}">Make owner</button>`
                          : ""
                      }`
                    }
                  </div>
                </article>`;
                    })
                    .join("")
                : `<div class="drop-hint"><span>No users loaded</span></div>`
            }
          </div>
        </section>`
            : `
        <section class="settings-block">
          <h2>Users</h2>
          <p class="muted">Only admins can add or manage users. You’re signed in as <strong>${escapeHtml(
            state.sessionUser?.email || "member"
          )}</strong>${isOwner ? " (owner)" : ""}.</p>
        </section>`
        }

        <section class="settings-block" id="quote-docs-settings">
          <h2>Quote attachments</h2>
          <p class="muted">
            Placeholder forms attached with every send (privacy, terms, intake, etc.).
            Turn on <strong>Every quote</strong> for defaults on new quotes — you can still change the set on each quote.
          </p>
          <div class="quote-docs-list" id="quote-docs-list">
            ${
              (state.quoteDocuments || []).length
                ? state.quoteDocuments
                    .map(
                      (doc) => `
              <article class="quote-docs-row" data-doc-id="${escapeHtml(doc.id)}">
                <div class="quote-docs-row__main">
                  <strong>${escapeHtml(doc.title)}</strong>
                  <span class="muted">${escapeHtml(doc.summary || doc.kind || "Placeholder")}</span>
                </div>
                <label class="checkbox-field">
                  <input type="checkbox" data-doc-every="${escapeHtml(doc.id)}" ${
                        doc.attachToEveryQuote ? "checked" : ""
                      } />
                  <span>Every quote</span>
                </label>
              </article>`
                    )
                    .join("")
                : `<div class="drop-hint"><span>No quote documents loaded yet</span></div>`
            }
          </div>
        </section>

        <form id="reminder-settings-form">
          <div class="settings-block">
            <h2>Quote reminders</h2>
            <p class="muted">Automated follow-ups after a quote is marked <strong>Sent</strong>. These settings apply to your user account.</p>

            <h3 class="settings-block__subhead">Internal (you)</h3>
            <label class="checkbox-field">
              <input type="checkbox" name="ownerEnabled" ${s.ownerEnabled ? "checked" : ""} />
              <span>Email me when a sent quote still needs follow-up</span>
            </label>
            <div class="field-row">
              <label class="field">
                <span>Your login email</span>
                <input type="email" value="${escapeHtml(s.ownerEmail || "")}" readonly />
              </label>
              <label class="field">
                <span>Days after sent</span>
                <input name="ownerDays" value="${escapeHtml((s.ownerDays || []).join(", "))}" placeholder="2, 5, 10" />
              </label>
            </div>
            <p class="field-help">Comma-separated day offsets. Example: <code>2, 5, 10</code>.</p>

            <h3 class="settings-block__subhead">Client</h3>
            <label class="checkbox-field">
              <input type="checkbox" name="clientEnabled" ${s.clientEnabled ? "checked" : ""} />
              <span>Email the client a polite nudge</span>
            </label>
            <div class="field-row">
              <label class="field">
                <span>Days after sent</span>
                <input name="clientDays" value="${escapeHtml((s.clientDays || []).join(", "))}" placeholder="3, 7, 14" />
              </label>
            </div>
            <p class="field-help">Uses the linked client’s email from Requests/Clients. Skips if no email on file.</p>

            <label class="checkbox-field settings-block__rule">
              <input type="checkbox" name="stopOnClosed" ${s.stopOnClosed ? "checked" : ""} />
              <span>Stop reminders once a quote is approved or declined</span>
            </label>
            <p class="field-help">Daily cron processes due reminders. Without <code>RESEND_API_KEY</code>, messages are logged in Reminders (demo mode).</p>

            <div class="settings-actions">
              <button type="submit" class="btn btn-primary">Save settings</button>
              <button type="button" class="btn btn-soft" data-jump="reminders">View reminder log</button>
            </div>
          </div>
        </form>
      </div>`;

    els.settings.querySelector("[data-jump='reminders']")?.addEventListener("click", () => setView("reminders"));

    const changePasswordForm = els.settings.querySelector("#change-password-form");
    const currentPasswordInput = changePasswordForm?.querySelector('[name="currentPassword"]');
    currentPasswordInput?.addEventListener("focus", () => {
      currentPasswordInput.removeAttribute("readonly");
    });
    currentPasswordInput?.addEventListener("blur", () => {
      if (!currentPasswordInput.value) currentPasswordInput.setAttribute("readonly", "");
    });
    changePasswordForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const currentPassword = String(form.querySelector('[name="currentPassword"]')?.value || "");
      const newPassword = String(form.querySelector('[name="newPassword"]')?.value || "");
      const confirmPassword = String(form.querySelector('[name="confirmPassword"]')?.value || "");
      if (newPassword !== confirmPassword) {
        toast("New passwords do not match");
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api("/api/account/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        });
        form.reset();
        currentPasswordInput?.setAttribute("readonly", "");
        toast("Password updated");
      } catch (err) {
        toast(err.message || "Could not update password");
      } finally {
        btn.disabled = false;
      }
    });

    els.settings.querySelectorAll("[data-doc-every]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.getAttribute("data-doc-every");
        const attachToEveryQuote = input.checked;
        input.disabled = true;
        try {
          const data = await api(`/api/quote-documents/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ attachToEveryQuote }),
          });
          const idx = state.quoteDocuments.findIndex((d) => d.id === id);
          if (idx >= 0) state.quoteDocuments[idx] = data.document;
          else state.quoteDocuments.push(data.document);
          toast(attachToEveryQuote ? "Attached by default on new quotes" : "Removed from new-quote defaults");
        } catch (err) {
          input.checked = !attachToEveryQuote;
          toast(err.message || "Could not update document");
        } finally {
          input.disabled = false;
        }
      });
    });

    els.settings.querySelector("#add-user-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const payload = {
        email: data.get("email"),
        name: data.get("name"),
        password: data.get("password"),
        role: data.get("role"),
      };
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const res = await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
        state.users = [...state.users.filter((u) => u.id !== res.user.id), res.user].sort((a, b) =>
          String(a.email).localeCompare(String(b.email))
        );
        form.reset();
        toast(`Added ${res.user.email}`);
        render();
      } catch (err) {
        toast(err.message || "Could not add user");
      } finally {
        btn.disabled = false;
      }
    });

    async function patchUser(id, payload, successMessage) {
      const res = await api(`/api/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const idx = state.users.findIndex((u) => u.id === id);
      if (idx !== -1) state.users[idx] = res.user;
      if (state.sessionUser?.id === id) state.sessionUser = { ...state.sessionUser, ...res.user };
      toast(successMessage);
      render();
    }

    els.settings.querySelectorAll("[data-user-role]").forEach((select) => {
      select.addEventListener("change", async () => {
        const id = select.dataset.userRole;
        const role = select.value;
        select.disabled = true;
        try {
          await patchUser(id, { role }, role === "admin" ? "User is now an admin" : "User is now a member");
        } catch (err) {
          const prev = state.users.find((u) => u.id === id);
          if (prev) select.value = prev.role === "admin" ? "admin" : "member";
          toast(err.message || "Could not update role");
          select.disabled = false;
        }
      });
    });

    els.settings.querySelectorAll("[data-user-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.userToggle;
        const active = btn.dataset.active === "1";
        btn.disabled = true;
        try {
          await patchUser(id, { active }, active ? "User activated" : "User deactivated");
        } catch (err) {
          toast(err.message || "Could not update user");
          btn.disabled = false;
        }
      });
    });

    els.settings.querySelectorAll("[data-user-owner]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.userOwner;
        const user = state.users.find((u) => u.id === id);
        if (
          !confirm(
            `Make ${user?.name || user?.email || "this user"} an owner? Owners can’t be demoted or deactivated, and can delete CRM records.`
          )
        ) {
          return;
        }
        btn.disabled = true;
        try {
          await patchUser(id, { isOwner: true, role: "admin" }, "User is now an owner");
        } catch (err) {
          toast(err.message || "Could not update owner");
          btn.disabled = false;
        }
      });
    });

    els.settings.querySelector("#reminder-settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = {
        ownerEnabled: form.get("ownerEnabled") === "on",
        ownerDays: form.get("ownerDays"),
        clientEnabled: form.get("clientEnabled") === "on",
        clientDays: form.get("clientDays"),
        stopOnClosed: form.get("stopOnClosed") === "on",
      };
      const btn = event.currentTarget.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const data = await api("/api/reminder-settings", {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        state.reminderSettings = data.settings;
        if (data.user) state.sessionUser = data.user;
        toast("Reminder settings saved");
        render();
      } catch (err) {
        toast(err.message || "Could not save settings");
      } finally {
        btn.disabled = false;
      }
    });
  }

  function render() {
    const map = {
      home: renderHome,
      pipeline: renderPipeline,
      schedule: renderSchedule,
      clients: renderClients,
      requests: renderRequests,
      quotes: renderQuotes,
      jobs: renderJobsList,
      invoices: renderInvoices,
      vera: renderVera,
      reminders: renderReminders,
      settings: renderSettings,
      games: renderGames,
    };
    (map[state.view] || renderHome)();
  }

  const GAMES_CATALOG = [
    {
      id: "asteroids",
      title: "Asteroids",
      blurb: "Spin, thrust, and clear the field.",
      tone: "slate",
      cover: "/app/games/covers/asteroids.jpg",
      controls: "Left/Right rotate · Up thrust · Space fire",
    },
    {
      id: "missile-command",
      title: "Missile Command",
      blurb: "Defend the cities from inbound warheads.",
      tone: "rust",
      cover: "/app/games/covers/missile-command.jpg",
      controls: "Mouse / tap to aim · Click to fire",
    },
    {
      id: "pokemon-red",
      title: "Pokémon Red",
      blurb: "Load a .gb / .gbc / .gba ROM once — remembered in this browser with saves.",
      tone: "gold",
      cover: "/app/games/covers/pokemon-red.jpg",
      controls: "Arrows · Z A · X B · Enter Start · Shift Select · saves stay in this browser",
    },
    {
      id: "space-invaders",
      title: "Space Invaders",
      blurb: "Hold the line against the descending fleet.",
      tone: "teal",
      cover: "/app/games/covers/space-invaders.jpg",
      controls: "Left/Right move · Space fire",
    },
  ];

  function renderGames() {
    if (!els.games) return;
    if (state.gamesActiveId) {
      const game = GAMES_CATALOG.find((g) => g.id === state.gamesActiveId);
      const already =
        state.gamesHandle &&
        els.games.querySelector("#games-stage") &&
        els.games.dataset.activeGame === state.gamesActiveId;
      if (already) return;

      els.games.dataset.activeGame = state.gamesActiveId;
      els.games.innerHTML = `
        <div class="games-player">
          <div class="games-player__bar">
            <button type="button" class="btn btn-soft games-back-btn" data-games-back>Back to library</button>
            <div class="games-player__meta">
              <strong>${escapeHtml(game?.title || "Game")}</strong>
              <p class="muted">${escapeHtml(game?.controls || "")}</p>
            </div>
          </div>
          <div class="games-player__stage" id="games-stage" tabindex="0"></div>
        </div>`;
      els.games.querySelector("[data-games-back]")?.addEventListener("click", async () => {
        await stopActiveGame();
        state.gamesActiveId = null;
        delete els.games.dataset.activeGame;
        renderGames();
      });
      const stage = els.games.querySelector("#games-stage");
      mountGame(state.gamesActiveId, stage);
      return;
    }

    delete els.games.dataset.activeGame;
    els.games.innerHTML = `
      <div class="games-library">
        <p class="games-library__lead">Pick a title. Arcade clones run instantly; Pokémon Red needs a ROM you own.</p>
        <div class="games-grid">
          ${GAMES_CATALOG.map(
            (g) => `
            <button type="button" class="games-tile tone-${g.tone}" data-game-open="${g.id}">
              <span class="games-tile__media">
                <img src="${escapeHtml(g.cover)}" alt="" width="480" height="360" loading="lazy" decoding="async" />
              </span>
              <span class="games-tile__body">
                <span class="games-tile__eyebrow">Play</span>
                <strong>${escapeHtml(g.title)}</strong>
                <span class="games-tile__blurb">${escapeHtml(g.blurb)}</span>
              </span>
            </button>`
          ).join("")}
        </div>
      </div>`;
    els.games.querySelectorAll("[data-game-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.gamesActiveId = btn.dataset.gameOpen;
        renderGames();
      });
    });
  }

  async function mountGame(id, stage) {
    if (!stage) return;
    await stopActiveGame();
    state.gamesActiveId = id;
    stage.innerHTML = `<div class="games-loading">Loading ${escapeHtml(
      GAMES_CATALOG.find((g) => g.id === id)?.title || "game"
    )}…</div>`;
    try {
      const mod = await import(`/app/games/index.js?v=7`);
      if (state.gamesActiveId !== id) return;
      const handle = await mod.mountGame(id, stage);
      if (state.gamesActiveId !== id) {
        if (handle?.destroy) await handle.destroy();
        return;
      }
      state.gamesHandle = handle;
      stage.focus({ preventScroll: true });
    } catch (err) {
      console.error(err);
      stage.innerHTML = `<div class="games-error">Could not start this game. ${escapeHtml(
        err?.message || "Try again."
      )}</div>`;
    }
  }

  function upsertLead(lead, { silent = false } = {}) {
    const idx = state.leads.findIndex((l) => l.id === lead.id);
    if (idx === -1) state.leads.unshift(lead);
    else state.leads[idx] = lead;
    state.leads.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!silent) render();
  }

  function upsertJob(job, { silent = false } = {}) {
    const idx = state.jobs.findIndex((j) => j.id === job.id);
    if (idx === -1) state.jobs.unshift(job);
    else state.jobs[idx] = job;
    if (!silent) render();
  }

  function upsertQuote(quote, { silent = false } = {}) {
    const idx = state.quotes.findIndex((q) => q.id === quote.id);
    if (idx === -1) state.quotes.unshift(quote);
    else state.quotes[idx] = quote;
    if (!silent) render();
  }

  function upsertInvoice(invoice) {
    const idx = state.invoices.findIndex((i) => i.id === invoice.id);
    if (idx === -1) state.invoices.unshift(invoice);
    else state.invoices[idx] = invoice;
    render();
  }

  const allDrawers = () => [
    els.clientDrawer,
    els.drawer,
    els.jobDrawer,
    els.revisionDrawer,
    els.quoteDrawer,
    els.invoiceDrawer,
  ].filter(Boolean);

  function openRevisionModal({ leadId = "", jobId = "", clientName = "" } = {}) {
    if (!els.revisionForm || !leadId) {
      toast("Link a client before logging a change request");
      return;
    }
    state.revisionContext = { leadId, jobId, clientName };
    els.revisionForm.reset();
    els.revisionForm.leadId.value = leadId;
    els.revisionForm.jobId.value = jobId || "";
    if (els.revisionForm.markBuild) els.revisionForm.markBuild.checked = !!jobId;
    if (els.revisionForm.markQuote) els.revisionForm.markQuote.checked = true;
    if (els.revisionDrawerMeta) {
      els.revisionDrawerMeta.textContent = clientName
        ? `${clientName} · saves to notes history`
        : "Saves to client notes history";
    }
    openOnly(els.revisionDrawer);
    setTimeout(() => els.revisionForm.body?.focus(), 50);
  }

  function openBackdrop() {
    els.backdrop.hidden = false;
    requestAnimationFrame(() => els.backdrop.classList.add("is-open"));
  }

  function closeDrawers() {
    els.backdrop.classList.remove("is-open");
    allDrawers().forEach((d) => {
      d.classList.remove("is-open");
      d.setAttribute("aria-hidden", "true");
    });
    setTimeout(() => {
      if (allDrawers().every((d) => !d.classList.contains("is-open"))) els.backdrop.hidden = true;
    }, 200);
  }

  function openOnly(drawer, { create = false, deleteBtn } = {}) {
    allDrawers().forEach((d) => {
      d.classList.remove("is-open");
      d.setAttribute("aria-hidden", "true");
    });
    openBackdrop();
    requestAnimationFrame(() => {
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
    });
    if (deleteBtn) deleteBtn.hidden = create || !state.sessionUser?.isOwner;
    if (drawer) mountRewriteControls(drawer);
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return formatDate(iso);
    }
  }

  function activityTone(kind) {
    const map = {
      note: "slate",
      created: "indigo",
      stage_change: "teal",
      address_change: "teal",
      quote: "gold",
      quote_sent: "indigo",
      quote_status: "gold",
      revisions_requested: "rust",
      change_request: "rust",
      job: "teal",
      job_status: "teal",
      invoice: "gold",
      reminder: "slate",
    };
    return map[kind] || "slate";
  }

  function formatClientAddress(lead) {
    if (lead?.address) return lead.address;
    return [lead?.addressLine, lead?.city, lead?.region, lead?.postalCode, lead?.country]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join(", ");
  }

  function mapsUrlForLead(lead) {
    if (lead?.mapsUrl) return lead.mapsUrl;
    const address = formatClientAddress(lead);
    if (!address) return "";
    const slug = encodeURIComponent(address).replace(/%20/g, "+");
    return `https://www.google.com/maps/place/${slug}`;
  }

  function mapsEmbedForLead(lead) {
    if (lead?.mapsEmbedUrl) return lead.mapsEmbedUrl;
    const address = formatClientAddress(lead);
    if (!address) return "";
    return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=16&hl=en&ie=UTF8&iwloc=B&output=embed`;
  }

  function leadForJob(job) {
    if (!job) return null;
    if (job.leadId) {
      const byId = state.leads.find((l) => l.id === job.leadId);
      if (byId) return byId;
    }
    const name = String(job.clientName || "")
      .trim()
      .toLowerCase();
    if (!name) return null;
    return (
      state.leads.find((l) => String(l.business || "").trim().toLowerCase() === name) ||
      state.leads.find((l) => String(l.name || "").trim().toLowerCase() === name) ||
      null
    );
  }

  function ensureScheduleFocusDate() {
    const today = toIsoDate(new Date());
    if (!state.scheduleFocusDate) state.scheduleFocusDate = today;
    if (state.calendarMode === "week") {
      const keys = weekDays().map(toIsoDate);
      if (!keys.includes(state.scheduleFocusDate)) {
        state.scheduleFocusDate = keys.includes(today) ? today : keys[0];
      }
    }
    return state.scheduleFocusDate;
  }

  function jobsForScheduleDay(isoDate, jobs = state.jobs) {
    return jobs
      .filter((j) => j.scheduledDate === isoDate && j.status !== "unscheduled")
      .slice()
      .sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")));
  }

  function scheduleDayPlaces(isoDate, jobs = state.jobs) {
    const seen = new Set();
    const places = [];
    for (const job of jobsForScheduleDay(isoDate, jobs)) {
      const lead = leadForJob(job);
      const address = formatClientAddress(lead);
      if (!address) continue;
      const key = address.toLowerCase();
      if (seen.has(key)) {
        const existing = places.find((p) => p.address.toLowerCase() === key);
        if (existing) existing.jobs.push(job);
        continue;
      }
      seen.add(key);
      places.push({
        address,
        lead,
        jobs: [job],
        mapsUrl: mapsUrlForLead(lead),
        label: job.clientName || lead?.business || lead?.name || "Stop",
      });
    }
    return places;
  }

  function googleMapsDayRouteUrl(places) {
    if (!places.length) return "";
    if (places.length === 1) return places[0].mapsUrl || "";
    const path = places
      .map((p) => encodeURIComponent(p.address).replace(/%20/g, "+"))
      .join("/");
    return `https://www.google.com/maps/dir/${path}`;
  }

  function placeKey(address) {
    return String(address || "")
      .trim()
      .toLowerCase();
  }

  let scheduleMapInstance = null;
  let scheduleMapMarkers = new Map();
  let scheduleMapMountGen = 0;
  let leafletLoader = null;

  function loadExternalStylesheet(href) {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error("Could not load map styles"));
      document.head.appendChild(link);
    });
  }

  function loadExternalScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) {
      return new Promise((resolve) => {
        if (window.L) resolve();
        else {
          const check = () => (window.L ? resolve() : setTimeout(check, 40));
          check();
        }
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load map library"));
      document.head.appendChild(script);
    });
  }

  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletLoader) {
      leafletLoader = Promise.all([
        loadExternalStylesheet("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"),
        loadExternalScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"),
      ]).then(() => window.L);
    }
    return leafletLoader;
  }

  function destroyScheduleMap() {
    if (scheduleMapInstance) {
      scheduleMapInstance.remove();
      scheduleMapInstance = null;
    }
    scheduleMapMarkers = new Map();
  }

  function schedulePinIcon(L, { index = 1, tone = "teal", active = false } = {}) {
    return L.divIcon({
      className: `schedule-pin tone-${tone}${active ? " is-active" : ""}`,
      html: `<span class="schedule-pin__dot">${index}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }

  function focusScheduleMapPlace(key) {
    const marker = scheduleMapMarkers.get(key);
    if (!marker || !scheduleMapInstance) return;
    state.scheduleMapFocusKey = key;
    scheduleMapMarkers.forEach((m, k) => {
      const meta = m._vsMeta || {};
      m.setIcon(
        schedulePinIcon(window.L, {
          index: meta.index,
          tone: meta.tone,
          active: k === key,
        })
      );
    });
    scheduleMapInstance.setView(marker.getLatLng(), Math.max(scheduleMapInstance.getZoom(), 14), {
      animate: true,
    });
    marker.openPopup();
    document.querySelectorAll(".schedule-map__stop[data-place-key]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.placeKey === key);
    });
  }

  async function mountScheduleDayMap(root, places) {
    const canvas = root.querySelector("#schedule-map-canvas");
    const statusEl = root.querySelector("#schedule-map-status");
    if (!canvas) return;

    const gen = ++scheduleMapMountGen;
    destroyScheduleMap();

    if (!places.length) {
      if (statusEl) statusEl.textContent = "Add client addresses to pin today’s builds.";
      return;
    }

    if (statusEl) statusEl.textContent = "Locating pins…";

    let L;
    try {
      L = await ensureLeaflet();
    } catch {
      if (statusEl) statusEl.textContent = "Map library failed to load.";
      return;
    }
    if (gen !== scheduleMapMountGen || !root.contains(canvas)) return;

    let payload;
    try {
      payload = await api("/api/geocode/batch", {
        method: "POST",
        body: JSON.stringify({ queries: places.map((p) => p.address) }),
      });
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || "Could not locate pins.";
      return;
    }
    if (gen !== scheduleMapMountGen || !root.contains(canvas)) return;

    const results = payload.results || {};
    const located = places
      .map((place, index) => {
        const hit = results[place.address] || results[placeKey(place.address)];
        if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return null;
        return { place, index: index + 1, lat: hit.lat, lng: hit.lng };
      })
      .filter(Boolean);

    if (!located.length) {
      if (statusEl) {
        statusEl.textContent =
          "Couldn’t place pins for these addresses yet — try Google Maps, or check the client address.";
      }
      return;
    }

    const map = L.map(canvas, {
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const bounds = [];
    const focusKey = state.scheduleMapFocusKey;
    located.forEach(({ place, index, lat, lng }) => {
      const key = placeKey(place.address);
      const tone = place.jobs?.[0]?.color || "teal";
      const marker = L.marker([lat, lng], {
        icon: schedulePinIcon(L, {
          index,
          tone,
          active: focusKey ? key === focusKey : index === 1,
        }),
        title: place.label,
      }).addTo(map);
      marker.bindPopup(
        `<strong>${escapeHtml(place.label)}</strong><br/><span>${escapeHtml(place.address)}</span>`
      );
      marker._vsMeta = { index, tone, key };
      marker.on("click", () => {
        state.scheduleMapFocusKey = key;
        focusScheduleMapPlace(key);
      });
      scheduleMapMarkers.set(key, marker);
      bounds.push([lat, lng]);
    });

    scheduleMapInstance = map;
    if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
    }
    setTimeout(() => {
      if (scheduleMapInstance === map) map.invalidateSize();
    }, 60);

    const missingGeo = places.length - located.length;
    if (statusEl) {
      statusEl.textContent =
        located.length === places.length
          ? `${located.length} pin${located.length === 1 ? "" : "s"} on the map.`
          : `${located.length} of ${places.length} pins found${
              missingGeo ? ` · ${missingGeo} address${missingGeo === 1 ? "" : "es"} couldn’t be placed` : ""
            }.`;
    }

    const preferred =
      (focusKey && scheduleMapMarkers.has(focusKey) && focusKey) ||
      placeKey(located[0].place.address);
    if (preferred) focusScheduleMapPlace(preferred);
  }

  function setScheduleMapOpen(open) {
    state.scheduleMapOpen = Boolean(open);
    try {
      localStorage.setItem("vs_schedule_map_open", state.scheduleMapOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function scheduleDayMapHtml(jobs) {
    if (state.scheduleMapOpen === false) {
      destroyScheduleMap();
      return "";
    }

    const focusDate = ensureScheduleFocusDate();
    const dayJobs = jobsForScheduleDay(focusDate, jobs);
    const places = scheduleDayPlaces(focusDate, jobs);
    const routeUrl = googleMapsDayRouteUrl(places);
    const focusLabel = formatDate(focusDate) || focusDate;
    const missing = dayJobs.filter((job) => !formatClientAddress(leadForJob(job))).length;
    const activeKey = state.scheduleMapFocusKey;

    return `
      <aside class="schedule-map" aria-label="Day map" data-map-places="${places.length}">
        <div class="schedule-map__head">
          <div>
            <h2>Day map</h2>
            <p>${escapeHtml(focusLabel)} · ${places.length} pin${places.length === 1 ? "" : "s"}${
              missing ? ` · ${missing} missing address` : ""
            }</p>
          </div>
          <div class="schedule-map__actions">
            ${
              routeUrl
                ? `<a class="btn btn-soft" href="${escapeHtml(routeUrl)}" target="_blank" rel="noopener noreferrer">Google Maps</a>`
                : ""
            }
            <button type="button" class="btn btn-soft schedule-map__toggle" data-toggle-map aria-expanded="true">
              Hide map
            </button>
          </div>
        </div>
        <div class="schedule-map__body" id="schedule-map-body">
          <div class="schedule-map__stops">
            ${
              dayJobs.length
                ? dayJobs
                    .map((job) => {
                      const lead = leadForJob(job);
                      const address = formatClientAddress(lead);
                      const key = placeKey(address);
                      const mapsUrl = mapsUrlForLead(lead);
                      const isActive = key && key === activeKey;
                      return `
                <button type="button" class="schedule-map__stop ${address ? "" : "is-missing"} ${
                  isActive ? "is-active" : ""
                }" data-open-job="${escapeHtml(job.id)}" ${
                        key ? `data-place-key="${escapeHtml(key)}"` : ""
                      } ${mapsUrl ? `data-maps-url="${escapeHtml(mapsUrl)}"` : ""}>
                  <span class="schedule-map__stop-time">${escapeHtml(job.startTime || "TBD")}</span>
                  <span class="schedule-map__stop-body">
                    <strong>${escapeHtml(job.title)}</strong>
                    <small>${escapeHtml(job.clientName || "No client")}${
                        address ? ` · ${escapeHtml(address)}` : " · No address on file"
                      }</small>
                  </span>
                </button>`;
                    })
                    .join("")
                : `<div class="drop-hint"><span>No builds on this day</span></div>`
            }
          </div>
          ${
            places.length
              ? `<div class="schedule-map__canvas-wrap">
                  <div id="schedule-map-canvas" class="schedule-map__canvas" role="img" aria-label="Map of site visits for ${escapeHtml(
                    focusLabel
                  )}"></div>
                  <p class="schedule-map__hint" id="schedule-map-status">Locating pins…</p>
                </div>`
              : `<div class="schedule-map__empty">
                  <p>${
                    dayJobs.length
                      ? "Add client addresses to pin today’s builds on the map."
                      : "Pick a day on the calendar to map its builds."
                  }</p>
                </div>`
          }
        </div>
      </aside>`;
  }

  function bindScheduleMap(root, jobs = state.jobs) {
    root.querySelector("[data-toggle-map]")?.addEventListener("click", () => {
      setScheduleMapOpen(false);
      destroyScheduleMap();
      renderSchedule();
    });
    root.querySelectorAll(".schedule-grid__dayhead[data-map-date]").forEach((el) => {
      el.addEventListener("click", () => {
        state.scheduleFocusDate = el.dataset.mapDate;
        state.scheduleMapFocusKey = "";
        renderSchedule();
      });
    });
    root.querySelectorAll(".month-day[data-map-date]").forEach((el) => {
      el.addEventListener("click", (event) => {
        if (event.target.closest(".job-card")) return;
        state.scheduleFocusDate = el.dataset.mapDate;
        state.scheduleMapFocusKey = "";
        if (state.calendarMode === "month" && event.target.closest(".month-day__head")) {
          // keep month view; map follows the clicked day
          renderSchedule();
          return;
        }
        renderSchedule();
      });
    });
    root.querySelectorAll(".schedule-map__stop[data-open-job]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.placeKey || "";
        if (key) {
          state.scheduleMapFocusKey = key;
          focusScheduleMapPlace(key);
        }
        openJob(btn.dataset.openJob);
      });
    });

    if (root.querySelector("#schedule-map-canvas")) {
      const focusDate = ensureScheduleFocusDate();
      mountScheduleDayMap(root, scheduleDayPlaces(focusDate, jobs));
    }
  }

  function setLeadFormMode({ internalRequest = false } = {}) {
    if (els.form.internalRequest) els.form.internalRequest.value = internalRequest ? "1" : "";
    const handoff = document.getElementById("request-handoff-fields");
    if (handoff) handoff.hidden = !internalRequest;
    const notesLabel = document.getElementById("lead-notes-label");
    if (notesLabel) {
      notesLabel.textContent = internalRequest ? "What the client wants" : "Notes";
    }
    if (els.form.notes) {
      els.form.notes.placeholder = internalRequest
        ? "Scope, goals, must-haves, timeline — what Rob heard from the client…"
        : "What’s going on…";
    }
  }

  const LOGO_UPLOAD_MAX_BYTES = 120 * 1024;

  function syncLeadLogoPreview(url) {
    const wrap = document.getElementById("lead-logo-preview");
    const img = document.getElementById("lead-logo-preview-img");
    const value = String(url || "").trim();
    if (!wrap || !img) return;
    if (!value) {
      wrap.hidden = true;
      img.removeAttribute("src");
      return;
    }
    img.src = value;
    wrap.hidden = false;
  }

  function readLogoFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }
      if (!String(file.type || "").startsWith("image/")) {
        reject(new Error("Logo must be an image"));
        return;
      }
      if (file.size > LOGO_UPLOAD_MAX_BYTES) {
        reject(new Error("Logo must be under 120 KB — try a smaller PNG or JPEG"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read logo file"));
      reader.readAsDataURL(file);
    });
  }

  function fillLeadForm(lead) {
    els.form.id.value = lead.id;
    els.form.name.value = lead.name || "";
    els.form.business.value = lead.business || "";
    els.form.email.value = lead.email || "";
    els.form.phone.value = lead.phone || "";
    if (els.form.addressLine) els.form.addressLine.value = lead.addressLine || "";
    if (els.form.city) els.form.city.value = lead.city || "";
    if (els.form.region) els.form.region.value = lead.region || "";
    if (els.form.postalCode) els.form.postalCode.value = lead.postalCode || "";
    if (els.form.country) els.form.country.value = lead.country || "Canada";
    els.form.industry.value = lead.industry || "";
    els.form.stage.value = lead.stage || "new";
    els.form.notes.value = lead.notes || "";
    if (els.form.logoUrl) els.form.logoUrl.value = lead.logoUrl || "";
    if (els.form.logoFile) els.form.logoFile.value = "";
    syncLeadLogoPreview(lead.logoUrl || "");
    if (els.form.requestedBy) els.form.requestedBy.value = lead.requestedBy || "Rob";
    if (els.form.assignee) els.form.assignee.value = lead.assignee || "Brad";
    const isRequest =
      lead.source === "internal" ||
      ((lead.stage === "new" || lead.stage === "audit") && (!!lead.requestedBy || !!lead.assignee));
    setLeadFormMode({ internalRequest: isRequest });
  }

  function renderClientDetailBody(detail) {
    const lead = detail.lead;
    const notes = detail.notes || [];
    const activity = detail.activity || [];
    const quotes = detail.quotes || [];
    const jobs = detail.jobs || [];
    const invoices = detail.invoices || [];
    const revisions = quotes.filter((q) => q.status === "revisions_requested");
    const address = formatClientAddress(lead);
    const mapsUrl = mapsUrlForLead(lead);
    const mapsEmbed = mapsEmbedForLead(lead);

    const logo = String(lead.logoUrl || "").trim();
    els.clientDetailBody.innerHTML = `
      <div class="client-summary">
        ${
          logo
            ? `<div class="client-summary__logo">
                <img src="${escapeHtml(logo)}" alt="${escapeHtml(lead.business || lead.name || "Company")} logo" />
              </div>`
            : ""
        }
        <div class="client-summary__contact">
          <p><strong>${escapeHtml(lead.name)}</strong></p>
          <p class="muted">${escapeHtml(lead.email || "No email")} · ${escapeHtml(lead.phone || "No phone")}</p>
          <p class="muted">${escapeHtml(lead.industry || "No industry")} · ${escapeHtml(lead.source || "manual")}</p>
          ${
            address
              ? `<p class="client-summary__address">
                  <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(address)}</a>
                </p>`
              : `<p class="muted">No address on file</p>`
          }
        </div>
        <div class="client-summary__chips">
          <span class="chip chip-${statusMeta(STAGES, lead.stage).tone}">${escapeHtml(stageLabel(lead.stage))}</span>
          ${
            lead.requestedBy || lead.assignee
              ? `<span class="chip chip-gold">${escapeHtml(lead.requestedBy || "Team")} → ${escapeHtml(
                  lead.assignee || "Unassigned"
                )}</span>`
              : ""
          }
          ${
            revisions.length
              ? `<span class="chip chip-rust">${revisions.length} revision${revisions.length === 1 ? "" : "s"} open</span>`
              : ""
          }
        </div>
      </div>

      ${
        lead.notes
          ? `<div class="client-wants">
              <h3>What the client wants</h3>
              <p>${escapeHtml(lead.notes)}</p>
            </div>`
          : ""
      }

      ${
        mapsEmbed
          ? `<div class="client-map">
              <div class="client-map__head">
                <h3>Location</h3>
                <a class="btn btn-soft" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
              </div>
              <iframe
                class="client-map__frame"
                title="Google Map for ${escapeHtml(lead.business || lead.name)}"
                loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
                src="${escapeHtml(mapsEmbed)}"
              ></iframe>
            </div>`
          : ""
      }

      <div class="client-actions">
        <button type="button" class="btn btn-soft" data-client-action="quote">New quote</button>
        <button type="button" class="btn btn-primary" data-client-action="job">Skip quote · Start build</button>
        <button type="button" class="btn btn-soft" data-client-action="invoice">New invoice</button>
        <button type="button" class="btn btn-soft" data-client-action="revisions">Log change request</button>
      </div>
      <p class="client-actions__hint">Pipeline: client → quote (optional) → build → invoice. Skip any middle step you don’t need.</p>

      <div class="client-columns">
        <section class="client-panel">
          <div class="client-panel__head">
            <h3>Notes</h3>
            <span class="pipeline-col__count">${notes.length}</span>
          </div>
          <form id="client-note-form" class="client-note-form">
            <label class="field">
              <span>Add a note</span>
              <textarea name="body" rows="3" required data-rewrite="client_note" placeholder="Call summary, next step, what they asked for…"></textarea>
            </label>
            <div class="settings-actions">
              <button type="submit" class="btn btn-primary">Add note</button>
            </div>
          </form>
          <div class="client-notes">
            ${
              notes.length
                ? notes.map((note) => noteCardHtml(note)).join("")
                : `<div class="drop-hint"><span>No notes yet — add the first one above</span></div>`
            }
          </div>
        </section>

        <section class="client-panel">
          <div class="client-panel__head">
            <h3>Activity</h3>
            <span class="pipeline-col__count">${activity.length}</span>
          </div>
          <div class="client-timeline">
            ${
              activity.length
                ? activity
                    .map(
                      (item) => `
              <article class="timeline-item tone-${activityTone(item.kind)}" data-entity="${escapeHtml(
                item.entityType || ""
              )}" data-entity-id="${escapeHtml(item.entityId || "")}">
                <span class="timeline-item__dot"></span>
                <div>
                  <p>${escapeHtml(item.summary)}</p>
                  <time>${escapeHtml(formatDateTime(item.createdAt))}</time>
                </div>
              </article>`
                    )
                    .join("")
                : `<div class="drop-hint"><span>No activity yet</span></div>`
            }
          </div>
        </section>
      </div>

      <section class="client-panel client-panel--full">
        <div class="client-panel__head">
          <h3>Related work</h3>
        </div>
        <div class="client-related">
          <div>
            <h4>Quotes <span class="pipeline-col__count">${quotes.length}</span></h4>
            ${
              quotes.length
                ? quotes
                    .map((q) => {
                      const meta = statusMeta(QUOTE_STATUSES, q.status);
                      return `<div class="client-related__item">
                        <button type="button" class="client-related__row" data-open-quote="${escapeHtml(q.id)}">
                          <strong>${escapeHtml(q.number)}</strong>
                          <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
                          <span class="muted">${escapeHtml(formatMoney(q.amountCents))}</span>
                        </button>
                        ${
                          q.status !== "declined"
                            ? `<button type="button" class="btn btn-soft client-related__action" data-schedule-quote="${escapeHtml(
                                q.id
                              )}">Schedule build</button>`
                            : ""
                        }
                      </div>`;
                    })
                    .join("")
                : `<p class="muted">No quotes</p>`
            }
          </div>
          <div>
            <h4>Builds <span class="pipeline-col__count">${jobs.length}</span></h4>
            ${
              jobs.length
                ? jobs
                    .map((j) => {
                      const meta = statusMeta(JOB_STATUSES, j.status);
                      return `<button type="button" class="client-related__row" data-open-job="${escapeHtml(j.id)}">
                        <strong>${escapeHtml(j.title)}</strong>
                        <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
                        <span class="muted">${
                          j.scheduledDate ? escapeHtml(formatDate(j.scheduledDate)) : "Unscheduled"
                        }</span>
                      </button>`;
                    })
                    .join("")
                : `<p class="muted">No builds</p>`
            }
          </div>
          <div>
            <h4>Invoices <span class="pipeline-col__count">${invoices.length}</span></h4>
            ${
              invoices.length
                ? invoices
                    .map((inv) => {
                      const meta = statusMeta(INVOICE_STATUSES, inv.status);
                      return `<button type="button" class="client-related__row" data-open-invoice="${escapeHtml(inv.id)}">
                        <strong>${escapeHtml(inv.number)}</strong>
                        <span class="chip chip-${meta.tone}">${escapeHtml(meta.label)}</span>
                        <span class="muted">${escapeHtml(formatMoney(inv.amountCents))}</span>
                      </button>`;
                    })
                    .join("")
                : `<p class="muted">No invoices</p>`
            }
          </div>
        </div>
      </section>`;

    bindClientDetailEvents(lead.id);
    mountRewriteControls(els.clientDetailBody);
    bindNoteEdit(els.clientDetailBody, {
      leadId: lead.id,
      onSaved: async (data) => {
        if (data.detail) {
          state.clientDetail = data.detail;
          if (data.detail.lead) upsertLead(data.detail.lead, { silent: true });
          renderClientDetailBody(data.detail);
        }
      },
    });
  }

  function bindClientDetailEvents(leadId) {
    els.clientDetailBody.querySelector("#client-note-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = new FormData(form).get("body");
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const data = await api(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
          method: "POST",
          body: JSON.stringify({ body, kind: "note" }),
        });
        state.clientDetail = data.detail;
        if (data.detail?.lead) upsertLead(data.detail.lead, { silent: true });
        renderClientDetailBody(data.detail);
        toast("Note added");
      } catch (err) {
        toast(err.message || "Could not add note");
      } finally {
        btn.disabled = false;
      }
    });

    els.clientDetailBody.querySelectorAll("[data-client-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.clientAction;
        const lead = state.clientDetail?.lead;
        if (!lead) return;
        if (action === "quote") {
          openNewQuote({ leadId: lead.id, clientName: lead.business });
          return;
        }
        if (action === "job") {
          openNewJob({ leadId: lead.id, clientName: lead.business });
          return;
        }
        if (action === "invoice") {
          openNewInvoice({ leadId: lead.id, clientName: lead.business });
          return;
        }
        if (action === "revisions") {
          const linkedBuild =
            (state.clientDetail.jobs || []).find((j) =>
              ["architecture", "fine_tuning", "client_approval", "build", "review"].includes(
                normalizeJobStatusId(j.status)
              )
            ) ||
            (state.clientDetail.jobs || []).find((j) => j.status !== "done" && j.status !== "unscheduled") ||
            (state.clientDetail.jobs || [])[0];
          openRevisionModal({
            leadId: lead.id,
            jobId: linkedBuild?.id || "",
            clientName: lead.business || lead.name,
          });
        }
      });
    });

    els.clientDetailBody.querySelectorAll("[data-open-quote]").forEach((btn) =>
      btn.addEventListener("click", () => openQuote(btn.dataset.openQuote))
    );
    els.clientDetailBody.querySelectorAll("[data-schedule-quote]").forEach((btn) =>
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        scheduleBuildFromQuote(btn.dataset.scheduleQuote);
      })
    );
    els.clientDetailBody.querySelectorAll("[data-open-job]").forEach((btn) =>
      btn.addEventListener("click", () => openJob(btn.dataset.openJob))
    );
    els.clientDetailBody.querySelectorAll("[data-open-invoice]").forEach((btn) =>
      btn.addEventListener("click", () => openInvoice(btn.dataset.openInvoice))
    );
    els.clientDetailBody.querySelectorAll(".timeline-item[data-entity='quote']").forEach((el) => {
      if (!el.dataset.entityId) return;
      el.style.cursor = "pointer";
      el.addEventListener("click", () => openQuote(el.dataset.entityId));
    });
  }

  async function openLead(id) {
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) return;
    state.clientDetail = { lead, notes: [], activity: [], quotes: [], jobs: [], invoices: [] };
    els.clientDrawerTitle.textContent = lead.business || lead.name;
    els.clientDrawerMeta.textContent = `${stageLabel(lead.stage)} · Loading history…`;
    els.clientDetailBody.innerHTML = `<p class="muted">Loading client history…</p>`;
    openOnly(els.clientDrawer);
    try {
      const detail = await api(`/api/leads/${encodeURIComponent(id)}/detail`);
      state.clientDetail = detail;
      upsertLead(detail.lead, { silent: true });
      els.clientDrawerTitle.textContent = detail.lead.business || detail.lead.name;
      els.clientDrawerMeta.textContent = `${stageLabel(detail.lead.stage)} · ${detail.activity?.length || 0} events`;
      renderClientDetailBody(detail);
    } catch (err) {
      els.clientDrawerMeta.textContent = stageLabel(lead.stage);
      els.clientDetailBody.innerHTML = `<p class="muted">${escapeHtml(err.message || "Could not load client")}</p>
        <button type="button" class="btn btn-soft" id="client-fallback-edit">Edit details</button>`;
      els.clientDetailBody.querySelector("#client-fallback-edit")?.addEventListener("click", () =>
        openLeadEdit(id)
      );
    }
  }

  function openLeadEdit(id) {
    const lead = state.leads.find((l) => l.id === id) || state.clientDetail?.lead;
    if (!lead) return;
    els.drawerTitle.textContent = lead.business || lead.name;
    els.drawerMeta.textContent = `${stageLabel(lead.stage)} · ${lead.source || "manual"}`;
    fillLeadForm(lead);
    openOnly(els.drawer, { create: false, deleteBtn: els.deleteLead });
  }

  function openNewLead() {
    state.clientDetail = null;
    els.drawerTitle.textContent = "New client";
    els.drawerMeta.textContent = "Full client record — quote or build when ready";
    els.form.reset();
    els.form.id.value = "";
    els.form.stage.value = "new";
    if (els.form.country) els.form.country.value = "Canada";
    if (els.form.requestedBy) els.form.requestedBy.value = "";
    if (els.form.assignee) els.form.assignee.value = "";
    syncLeadLogoPreview("");
    setLeadFormMode({ internalRequest: false });
    openOnly(els.drawer, { create: true, deleteBtn: els.deleteLead });
    setTimeout(() => els.form.name.focus(), 50);
  }

  function openNewRequest() {
    state.clientDetail = null;
    els.drawerTitle.textContent = "New request";
    els.drawerMeta.textContent = "Internal handoff · Rob → Brad";
    els.form.reset();
    els.form.id.value = "";
    els.form.stage.value = "new";
    if (els.form.country) els.form.country.value = "Canada";
    if (els.form.requestedBy) els.form.requestedBy.value = "Rob";
    if (els.form.assignee) els.form.assignee.value = "Brad";
    syncLeadLogoPreview("");
    setLeadFormMode({ internalRequest: true });
    openOnly(els.drawer, { create: true, deleteBtn: els.deleteLead });
    setTimeout(() => els.form.notes?.focus() || els.form.name.focus(), 50);
  }

  function clearJobContext() {
    if (!els.jobContext) return;
    els.jobContext.hidden = true;
    els.jobContext.innerHTML = "";
    els.jobDrawer?.classList.remove("drawer--modal-lg");
  }

  function renderJobContext(detail) {
    if (!els.jobContext) return;
    const lead = detail?.lead;
    const notes = detail?.notes || [];
    const activity = (detail?.activity || []).slice(0, 24);
    const leadId = lead?.id || detail?.job?.leadId || "";

    els.jobDrawer?.classList.add("drawer--modal-lg");
    els.jobContext.hidden = false;
    els.jobContext.innerHTML = `
      <div class="job-context__head">
        <h3>${lead ? escapeHtml(lead.business || lead.name) : "History"}</h3>
        <div class="job-context__head-actions">
          ${
            leadId
              ? `<button type="button" class="btn btn-soft" data-log-revision>Log change request</button>
                 <button type="button" class="btn btn-soft" data-open-client="${escapeHtml(leadId)}">Open client</button>`
              : ""
          }
        </div>
      </div>
      ${
        lead
          ? `<p class="muted">${escapeHtml(lead.name)} · ${escapeHtml(lead.email || lead.phone || "No contact")}${
              lead.address ? ` · ${escapeHtml(lead.city || lead.address)}` : ""
            }</p>`
          : `<p class="muted">No linked client — showing job history only.</p>`
      }
      <form id="job-note-form" class="client-note-form" ${leadId ? "" : "hidden"}>
        <label class="field">
          <span>Add client note</span>
          <textarea name="body" rows="2" required data-rewrite="client_note" placeholder="Call notes, revisions, next step…"></textarea>
        </label>
        <div class="settings-actions">
          <button type="submit" class="btn btn-soft">Add note</button>
        </div>
      </form>
      <div>
        <div class="client-panel__head">
          <h3>Notes</h3>
          <span class="pipeline-col__count">${notes.length}</span>
        </div>
        <div class="job-context__list">
          ${
            notes.length
              ? notes
                  .slice(0, 8)
                  .map((note) => noteCardHtml(note, { showAuthor: false }))
                  .join("")
              : `<div class="drop-hint"><span>No client notes yet</span></div>`
          }
        </div>
      </div>
      <div>
        <div class="client-panel__head">
          <h3>Activity</h3>
          <span class="pipeline-col__count">${activity.length}</span>
        </div>
        <div class="job-context__list">
          ${
            activity.length
              ? activity
                  .map(
                    (item) => `
            <article class="timeline-item tone-${activityTone(item.kind)}">
              <span class="timeline-item__dot"></span>
              <div>
                <p>${escapeHtml(item.summary)}</p>
                <time>${escapeHtml(formatDateTime(item.createdAt))}</time>
              </div>
            </article>`
                  )
                  .join("")
              : `<div class="drop-hint"><span>No activity yet</span></div>`
          }
        </div>
      </div>`;

    els.jobContext.querySelector("[data-open-client]")?.addEventListener("click", () => {
      const id = els.jobContext.querySelector("[data-open-client]")?.dataset.openClient;
      if (id) openLead(id);
    });
    els.jobContext.querySelector("[data-log-revision]")?.addEventListener("click", () => {
      openRevisionModal({
        leadId,
        jobId: detail.job?.id || "",
        clientName: lead?.business || lead?.name || detail.job?.clientName || "",
      });
    });

    els.jobContext.querySelector("#job-note-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!leadId) return;
      const form = event.currentTarget;
      const body = new FormData(form).get("body");
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
          method: "POST",
          body: JSON.stringify({ body, kind: "note" }),
        });
        const refreshed = await api(`/api/jobs/${encodeURIComponent(detail.job.id)}/detail`);
        state.jobDetail = refreshed;
        renderJobContext(refreshed);
        toast("Note added");
      } catch (err) {
        toast(err.message || "Could not add note");
      } finally {
        btn.disabled = false;
      }
    });

    mountRewriteControls(els.jobContext);
    bindNoteEdit(els.jobContext, {
      leadId,
      onSaved: async () => {
        if (!detail.job?.id) return;
        const refreshed = await api(`/api/jobs/${encodeURIComponent(detail.job.id)}/detail`);
        state.jobDetail = refreshed;
        renderJobContext(refreshed);
      },
    });
  }

  async function loadJobContext(job) {
    if (!els.jobContext || !job?.id) {
      clearJobContext();
      return;
    }
    els.jobDrawer?.classList.add("drawer--modal-lg");
    els.jobContext.hidden = false;
    els.jobContext.innerHTML = `<p class="muted">Loading notes &amp; history…</p>`;
    try {
      const detail = await api(`/api/jobs/${encodeURIComponent(job.id)}/detail`);
      state.jobDetail = detail;
      if (detail.job?.leadId && els.jobForm.leadId) els.jobForm.leadId.value = detail.job.leadId;
      renderJobContext(detail);
    } catch (err) {
      els.jobContext.innerHTML = `<p class="muted">${escapeHtml(err.message || "Could not load history")}</p>`;
    }
  }

  function fillQuoteLeadPicker(selectedId = "") {
    if (!els.quoteLeadPicker) return;
    els.quoteLeadPicker.innerHTML =
      `<option value="">Select a client…</option>` +
      state.leads
        .map(
          (lead) =>
            `<option value="${escapeHtml(lead.id)}" ${lead.id === selectedId ? "selected" : ""}>${escapeHtml(
              lead.business || lead.name
            )}</option>`
        )
        .join("");
  }

  function setQuoteScheduleBuildVisible(show) {
    if (!els.quoteScheduleBuild) return;
    els.quoteScheduleBuild.hidden = !show;
  }

  function scheduleBuildFromQuote(quoteId) {
    const quote = state.quotes.find((q) => q.id === quoteId);
    if (!quote) {
      toast("Quote not found");
      return;
    }
    if (!quote.leadId) {
      toast("This quote has no client — open the client and link it first");
      return;
    }
    const lead = state.leads.find((l) => l.id === quote.leadId);
    openNewJob({
      leadId: quote.leadId,
      clientName: quote.clientName || lead?.business || lead?.name || "",
      title: quote.title || "",
      notes: quote.notes
        ? `From quote ${quote.number}: ${quote.notes}`
        : `From quote ${quote.number}`,
      quoteId: quote.id,
      status: "rough_draft",
      scheduledDate: toIsoDate(addDays(new Date(), 1)),
      startTime: "09:00",
    });
  }

  function openJob(id) {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return;
    els.jobDrawerTitle.textContent = job.title;
    const stage = statusMeta(JOB_STATUSES, job.status).label;
    els.jobDrawerMeta.textContent = job.scheduledDate
      ? `${stage} · ${formatDate(job.scheduledDate)}${job.startTime ? ` · ${job.startTime}` : ""}`
      : stage;
    els.jobForm.id.value = job.id;
    els.jobForm.title.value = job.title || "";
    els.jobForm.clientName.value = job.clientName || "";
    if (els.jobForm.leadId) els.jobForm.leadId.value = job.leadId || "";
    if (els.jobForm.quoteId) els.jobForm.quoteId.value = job.quoteId || "";
    els.jobForm.assignee.value = job.assignee || "";
    els.jobForm.scheduledDate.value = job.scheduledDate || "";
    els.jobForm.startTime.value = job.startTime || "";
    els.jobForm.durationMin.value = job.durationMin || 90;
    els.jobForm.color.value = job.color || "slate";
    els.jobForm.status.value = job.status || "unscheduled";
    els.jobForm.notes.value = job.notes || "";
    openOnly(els.jobDrawer, { create: false, deleteBtn: els.deleteJob });
    loadJobContext(job);
  }

  function requireClientFirst(actionLabel = "continue") {
    toast(`Add a client first, then ${actionLabel} from their page`);
    openNewLead();
  }

  function openNewJob({
    leadId = "",
    clientName = "",
    title = "",
    notes = "",
    quoteId = "",
    status = "unscheduled",
    scheduledDate = "",
    startTime = "08:00",
  } = {}) {
    if (!leadId) {
      requireClientFirst("start a build");
      return;
    }
    els.jobDrawerTitle.textContent = quoteId ? "Schedule build" : "Start build";
    els.jobDrawerMeta.textContent = quoteId
      ? "From quote — set the date to put it on the calendar"
      : "Quote skipped — book the work and move through build stages";
    els.jobForm.reset();
    els.jobForm.id.value = "";
    els.jobForm.durationMin.value = 90;
    els.jobForm.color.value = "gold";
    els.jobForm.status.value = status || "unscheduled";
    els.jobForm.startTime.value = startTime || "08:00";
    if (els.jobForm.leadId) els.jobForm.leadId.value = leadId || "";
    if (els.jobForm.quoteId) els.jobForm.quoteId.value = quoteId || "";
    if (clientName) els.jobForm.clientName.value = clientName;
    if (title) els.jobForm.title.value = title;
    if (notes) els.jobForm.notes.value = notes;
    if (scheduledDate) els.jobForm.scheduledDate.value = scheduledDate;
    clearJobContext();
    state.jobDetail = null;
    els.jobDrawer?.classList.add("drawer--modal-lg");
    els.jobContext.hidden = false;
    els.jobContext.innerHTML = `<p class="muted">${
      quoteId
        ? "Linked from quote — save to put this build on the schedule and day map."
        : "Started from the client (quote skipped). History appears after you save."
    }</p>
      <button type="button" class="btn btn-soft" data-open-client="${escapeHtml(leadId)}">Open client</button>`;
    els.jobContext.querySelector("[data-open-client]")?.addEventListener("click", () => openLead(leadId));
    openOnly(els.jobDrawer, { create: true, deleteBtn: els.deleteJob });
    setTimeout(() => {
      if (scheduledDate) els.jobForm.scheduledDate.focus();
      else els.jobForm.title.focus();
    }, 50);
  }

  function defaultQuoteDocumentIds() {
    return (state.quoteDocuments || []).filter((d) => d.attachToEveryQuote).map((d) => d.id);
  }

  function readSelectedDocumentIds() {
    if (!els.quoteAttachments) return [];
    return [...els.quoteAttachments.querySelectorAll('input[name="documentId"]:checked')].map(
      (input) => input.value
    );
  }

  function renderQuoteAttachments(selectedIds) {
    if (!els.quoteAttachments) return;
    const docs = state.quoteDocuments || [];
    const selected = new Set(selectedIds || []);
    if (!docs.length) {
      els.quoteAttachments.innerHTML = `<p class="muted">No attachment placeholders yet. Open Settings after refresh.</p>`;
      return;
    }
    els.quoteAttachments.innerHTML = docs
      .map(
        (doc) => `
      <label class="quote-attach-row">
        <input type="checkbox" name="documentId" value="${escapeHtml(doc.id)}" ${
          selected.has(doc.id) ? "checked" : ""
        } />
        <span class="quote-attach-row__body">
          <strong>${escapeHtml(doc.title)}</strong>
          <span class="muted">${escapeHtml(doc.summary || "Placeholder form")}</span>
        </span>
        ${
          doc.attachToEveryQuote
            ? `<span class="chip chip-gold">Every quote</span>`
            : `<span class="chip chip-slate">Optional</span>`
        }
      </label>`
      )
      .join("");
    els.quoteAttachments.querySelectorAll('input[name="documentId"]').forEach((input) => {
      input.addEventListener("change", refreshQuotePreview);
    });
  }

  function collectQuoteDraft() {
    if (!els.quoteForm) return null;
    const form = new FormData(els.quoteForm);
    const documentIds = readSelectedDocumentIds();
    const documents = (state.quoteDocuments || []).filter((d) => documentIds.includes(d.id));
    return {
      id: form.get("id") || "",
      number: String(form.get("number") || "").trim() || "Q-DRAFT",
      title: String(form.get("title") || "").trim(),
      clientName: String(form.get("clientName") || "").trim(),
      status: form.get("status") || "draft",
      amountCents: centsFromInput(form.get("amount")),
      notes: String(form.get("notes") || "").trim(),
      ownerEmail: String(form.get("ownerEmail") || "").trim(),
      leadId: form.get("leadId") || "",
      documentIds,
      documents,
    };
  }

  function collectQuotePayload() {
    const draft = collectQuoteDraft();
    if (!draft) return null;
    return {
      number: draft.number === "Q-DRAFT" ? "" : draft.number,
      title: draft.title,
      clientName: draft.clientName,
      leadId: draft.leadId || null,
      status: draft.status,
      amount: dollarsFromCents(draft.amountCents),
      ownerEmail: draft.ownerEmail,
      notes: draft.notes,
      documentIds: draft.documentIds,
    };
  }

  function renderQuoteDocumentHtml(quote, { forPrint = false } = {}) {
    const docs = quote.documents || [];
    const attachList = docs
      .map(
        (doc) =>
          `<li><strong>${escapeHtml(doc.title)}</strong> — ${escapeHtml(doc.summary || doc.kind || "Placeholder")}</li>`
      )
      .join("");
    return `
      <article class="invoice-sheet quote-sheet${forPrint ? " is-print" : ""}">
        <header class="invoice-sheet__brand">
          <div class="invoice-sheet__brand-left">
            <img src="${escapeHtml(COMPANY.logo)}" alt="" width="120" height="72" />
            <div>
              <strong>Vanderven</strong><span>Systems</span>
              <p>${escapeHtml(COMPANY.tagline)}</p>
            </div>
          </div>
          <div class="invoice-sheet__brand-right">
            <span class="invoice-sheet__kicker">Quote</span>
            <h2>${escapeHtml(quote.number || "Q-DRAFT")}</h2>
            <p>Prepared for ${escapeHtml(quote.clientName || "Client")}<br/>${escapeHtml(
              formatMoneyExact(quote.amountCents)
            )}</p>
          </div>
        </header>
        <div class="invoice-sheet__meta">
          <div>
            <span class="invoice-sheet__label">Proposal</span>
            <p><strong>${escapeHtml(quote.title || "Untitled quote")}</strong></p>
            <p class="muted">${escapeHtml(quote.notes || "Scope and deliverables as discussed.")}</p>
          </div>
          <div class="invoice-sheet__meta-right">
            <span class="invoice-sheet__label">Investment</span>
            <p><strong>${escapeHtml(formatMoneyExact(quote.amountCents))}</strong></p>
            <p class="muted">CAD · subject to final scope</p>
            <p class="muted">${escapeHtml(COMPANY.location)} · ${escapeHtml(COMPANY.email)}</p>
          </div>
        </div>
        ${
          attachList
            ? `<div class="invoice-sheet__notes quote-sheet__attachments">
                <span class="invoice-sheet__label">Attached with this quote</span>
                <ul>${attachList}</ul>
                <p class="muted">Placeholder documents until final PDFs are uploaded.</p>
              </div>`
            : `<div class="invoice-sheet__notes"><p class="muted">No attachments selected for this quote.</p></div>`
        }
        <footer class="invoice-sheet__foot">
          Questions? Write <strong>${escapeHtml(COMPANY.email)}</strong>.
          — ${escapeHtml(COMPANY.name)} · ${escapeHtml(COMPANY.web)}
        </footer>
      </article>`;
  }

  function refreshQuotePreview() {
    if (!els.quotePreview) return;
    const draft = collectQuoteDraft();
    if (!draft) {
      els.quotePreview.innerHTML = "";
      return;
    }
    els.quotePreview.innerHTML = renderQuoteDocumentHtml(draft);
  }

  function printQuoteDocument() {
    const draft = collectQuoteDraft();
    if (!draft) return;
    const html = renderQuoteDocumentHtml(draft, { forPrint: true });
    const styles = `
      body{margin:0;background:#fff;color:#1c2430;font-family:Segoe UI,Helvetica,Arial,sans-serif;}
      .invoice-sheet{max-width:760px;margin:0 auto;padding:28px;}
      .invoice-sheet__brand{display:flex;justify-content:space-between;gap:1rem;padding:1.25rem 1.35rem;background:linear-gradient(135deg,#1c2430,#2d3a4a 55%,#3d3424);color:#f7f1e6;border-radius:12px;}
      .invoice-sheet__brand-left{display:flex;gap:0.75rem;align-items:center;}
      .invoice-sheet__brand-left img{width:72px;height:auto;background:#fff;border-radius:8px;padding:0.25rem;}
      .invoice-sheet__brand-left strong{display:block;font-size:1.2rem;}
      .invoice-sheet__brand-left span{opacity:0.85;}
      .invoice-sheet__brand-left p{margin:0.35rem 0 0;font-size:0.78rem;opacity:0.8;max-width:16rem;}
      .invoice-sheet__brand-right{text-align:right;}
      .invoice-sheet__kicker{font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.75;}
      .invoice-sheet__brand-right h2{margin:0.2rem 0;font-size:1.6rem;}
      .invoice-sheet__brand-right p{margin:0.35rem 0 0;font-size:0.85rem;opacity:0.9;}
      .invoice-sheet__meta{display:flex;justify-content:space-between;gap:1.5rem;margin:1.4rem 0;}
      .invoice-sheet__label{display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;margin-bottom:0.35rem;}
      .invoice-sheet__meta p{margin:0;line-height:1.5;font-size:0.92rem;}
      .invoice-sheet__meta-right{text-align:right;}
      .invoice-sheet__notes{margin-top:1.25rem;padding:0.85rem 1rem;background:#f7f2e8;border-radius:10px;}
      .invoice-sheet__notes ul{margin:0.4rem 0 0;padding-left:1.1rem;}
      .invoice-sheet__notes p{margin:0.35rem 0 0;font-size:0.86rem;line-height:1.45;}
      .invoice-sheet__foot{margin-top:1.5rem;padding-top:0.9rem;border-top:1px solid #e6e1d6;font-size:0.82rem;color:#5c6570;line-height:1.5;}
      .muted{color:#5c6570;}
      @media print{body{background:#fff}.invoice-sheet{padding:0}}
    `;
    const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
    if (!win) {
      toast("Allow pop-ups to print the quote");
      return;
    }
    win.document.write(
      `<!DOCTYPE html><html><head><title>${escapeHtml(draft.number)} — ${escapeHtml(
        COMPANY.name
      )}</title><style>${styles}</style></head><body>${html}<script>window.onload=()=>{window.focus();window.print();}</script></body></html>`
    );
    win.document.close();
  }

  async function saveQuoteRecord({ keepOpen = false } = {}) {
    const payload = collectQuotePayload();
    if (!payload) throw new Error("Quote form missing");
    if (!payload.title?.trim()) throw new Error("Title is required");
    const id = els.quoteForm.id.value;
    if (!id && !payload.leadId) throw new Error("Add a client first, then create the quote from their page");
    const data = id
      ? await api(`/api/quotes/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        })
      : await api("/api/quotes", { method: "POST", body: JSON.stringify(payload) });
    upsertQuote(data.quote, { silent: keepOpen });
    els.quoteForm.id.value = data.quote.id;
    els.quoteForm.number.value = data.quote.number || "";
    els.quoteDrawerTitle.textContent = data.quote.number;
    els.quoteDrawerMeta.textContent = statusMeta(QUOTE_STATUSES, data.quote.status).label;
    renderQuoteAttachments(data.quote.documentIds || defaultQuoteDocumentIds());
    refreshQuotePreview();
    setQuoteScheduleBuildVisible(data.quote.status !== "declined");
    if (!keepOpen) {
      closeDrawers();
      render();
    } else {
      openOnly(els.quoteDrawer, { create: false, deleteBtn: els.deleteQuote });
    }
    return data.quote;
  }

  function openQuote(id) {
    const quote = state.quotes.find((q) => q.id === id);
    if (!quote) return;
    els.quoteDrawerTitle.textContent = quote.number;
    els.quoteDrawerMeta.textContent = statusMeta(QUOTE_STATUSES, quote.status).label;
    els.quoteForm.id.value = quote.id;
    els.quoteForm.number.value = quote.number || "";
    els.quoteForm.title.value = quote.title || "";
    els.quoteForm.clientName.value = quote.clientName || "";
    els.quoteForm.status.value = quote.status || "draft";
    els.quoteForm.amount.value = ((quote.amountCents || 0) / 100).toFixed(2);
    els.quoteForm.ownerEmail.value = quote.ownerEmail || state.reminderSettings?.ownerEmail || "";
    els.quoteForm.notes.value = quote.notes || "";
    if (els.quoteForm.leadId) els.quoteForm.leadId.value = quote.leadId || "";
    fillQuoteLeadPicker(quote.leadId || "");
    setQuoteScheduleBuildVisible(quote.status !== "declined");
    renderQuoteAttachments(quote.documentIds || []);
    refreshQuotePreview();
    openOnly(els.quoteDrawer, { create: false, deleteBtn: els.deleteQuote });
  }

  function openNewQuote({ leadId = "", clientName = "" } = {}) {
    if (!leadId) {
      requireClientFirst("create a quote");
      return;
    }
    els.quoteDrawerTitle.textContent = "New quote";
    els.quoteDrawerMeta.textContent = "Optional step — you can skip this and start a build instead";
    els.quoteForm.reset();
    els.quoteForm.id.value = "";
    els.quoteForm.status.value = "draft";
    els.quoteForm.ownerEmail.value = state.reminderSettings?.ownerEmail || "";
    if (els.quoteForm.leadId) els.quoteForm.leadId.value = leadId || "";
    if (clientName) els.quoteForm.clientName.value = clientName;
    fillQuoteLeadPicker(leadId || "");
    setQuoteScheduleBuildVisible(false);
    renderQuoteAttachments(defaultQuoteDocumentIds());
    refreshQuotePreview();
    openOnly(els.quoteDrawer, { create: true, deleteBtn: els.deleteQuote });
    setTimeout(() => els.quoteForm.title.focus(), 50);
  }

  function emptyInvoiceLine(overrides = {}) {
    return {
      id: `line_${Math.random().toString(36).slice(2, 8)}`,
      description: "",
      qty: 1,
      unitCents: 0,
      ...overrides,
    };
  }

  function readInvoiceLinesFromDom() {
    if (!els.invoiceLines) return [];
    return [...els.invoiceLines.querySelectorAll(".invoice-line")].map((row, index) => {
      const description = row.querySelector('[name="lineDesc"]')?.value || "";
      const qty = parseFloat(row.querySelector('[name="lineQty"]')?.value || "1");
      const unitCents = centsFromInput(row.querySelector('[name="lineAmount"]')?.value);
      return {
        id: row.dataset.lineId || `line_${index + 1}`,
        description: description.trim(),
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unitCents,
      };
    }).filter((line) => line.description);
  }

  function renderInvoiceLines(lines) {
    if (!els.invoiceLines) return;
    const list = lines?.length ? lines : [emptyInvoiceLine()];
    els.invoiceLines.innerHTML = list
      .map(
        (line) => `
      <div class="invoice-line" data-line-id="${escapeHtml(line.id)}">
        <label class="field invoice-line__desc">
          <span>Description</span>
          <input name="lineDesc" value="${escapeHtml(line.description || "")}" placeholder="Discovery workshop" />
        </label>
        <label class="field">
          <span>Qty</span>
          <input name="lineQty" type="number" min="0.25" step="0.25" value="${escapeHtml(String(line.qty || 1))}" />
        </label>
        <label class="field">
          <span>Rate (CAD)</span>
          <input name="lineAmount" type="number" min="0" step="0.01" value="${escapeHtml(
            dollarsFromCents(line.unitCents)
          )}" />
        </label>
        <button type="button" class="btn btn-ghost invoice-line__remove" aria-label="Remove line">×</button>
      </div>`
      )
      .join("");
    els.invoiceLines.querySelectorAll(".invoice-line__remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".invoice-line");
        row?.remove();
        if (!els.invoiceLines.querySelector(".invoice-line")) {
          renderInvoiceLines([emptyInvoiceLine()]);
        }
        refreshInvoicePreview();
      });
    });
    els.invoiceLines.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", refreshInvoicePreview);
    });
    refreshInvoicePreview();
  }

  function fillInvoicePickers({ leadId = "", quoteId = "", jobId = "" } = {}) {
    if (els.invoiceLeadPicker) {
      els.invoiceLeadPicker.innerHTML =
        `<option value="">Select a client…</option>` +
        state.leads
          .map(
            (lead) =>
              `<option value="${escapeHtml(lead.id)}" ${lead.id === leadId ? "selected" : ""}>${escapeHtml(
                lead.business || lead.name
              )}</option>`
          )
          .join("");
    }
    const quotes = state.quotes.filter((q) => !leadId || q.leadId === leadId);
    if (els.invoiceQuotePicker) {
      els.invoiceQuotePicker.innerHTML =
        `<option value="">Optional</option>` +
        quotes
          .map(
            (q) =>
              `<option value="${escapeHtml(q.id)}" ${q.id === quoteId ? "selected" : ""}>${escapeHtml(
                q.number
              )} · ${escapeHtml(q.title)}</option>`
          )
          .join("");
    }
    const jobs = state.jobs.filter((j) => !leadId || j.leadId === leadId);
    if (els.invoiceJobPicker) {
      els.invoiceJobPicker.innerHTML =
        `<option value="">Optional</option>` +
        jobs
          .map(
            (j) =>
              `<option value="${escapeHtml(j.id)}" ${j.id === jobId ? "selected" : ""}>${escapeHtml(
                j.title
              )}</option>`
          )
          .join("");
    }
  }

  function applyLeadToInvoice(leadId, { keepTitle = false } = {}) {
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead || !els.invoiceForm) return;
    els.invoiceForm.leadId.value = lead.id;
    els.invoiceForm.clientName.value = lead.business || lead.name || "";
    els.invoiceForm.billToName.value = lead.name || lead.business || "";
    els.invoiceForm.billToEmail.value = lead.email || "";
    els.invoiceForm.billToPhone.value = lead.phone || "";
    els.invoiceForm.billToAddress.value = formatClientAddress(lead) || "";
    if (!keepTitle && !els.invoiceForm.title.value) {
      els.invoiceForm.title.value = `${lead.business || lead.name} — services`;
    }
    fillInvoicePickers({
      leadId: lead.id,
      quoteId: els.invoiceForm.quoteId.value,
      jobId: els.invoiceForm.jobId.value,
    });
    refreshInvoicePreview();
  }

  function applyQuoteToInvoice(quoteId) {
    const quote = state.quotes.find((q) => q.id === quoteId);
    if (!quote || !els.invoiceForm) return;
    els.invoiceForm.quoteId.value = quote.id;
    if (quote.leadId) {
      els.invoiceForm.leadId.value = quote.leadId;
      applyLeadToInvoice(quote.leadId, { keepTitle: true });
    }
    els.invoiceForm.title.value = quote.title || els.invoiceForm.title.value;
    els.invoiceForm.clientName.value = quote.clientName || els.invoiceForm.clientName.value;
    if (quote.notes && !els.invoiceForm.notes.value) els.invoiceForm.notes.value = quote.notes;
    renderInvoiceLines([
      emptyInvoiceLine({
        description: quote.title || "Quoted work",
        qty: 1,
        unitCents: quote.amountCents || 0,
      }),
    ]);
    fillInvoicePickers({
      leadId: els.invoiceForm.leadId.value,
      quoteId: quote.id,
      jobId: els.invoiceForm.jobId.value,
    });
  }

  function applyJobToInvoice(jobId) {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job || !els.invoiceForm) return;
    els.invoiceForm.jobId.value = job.id;
    if (job.leadId) {
      els.invoiceForm.leadId.value = job.leadId;
      applyLeadToInvoice(job.leadId, { keepTitle: true });
    }
    els.invoiceForm.title.value = job.title || els.invoiceForm.title.value;
    els.invoiceForm.clientName.value = job.clientName || els.invoiceForm.clientName.value;
    const lines = readInvoiceLinesFromDom();
    if (!lines.length || (lines.length === 1 && !lines[0].unitCents)) {
      renderInvoiceLines([
        emptyInvoiceLine({
          description: job.title || "Build work",
          qty: 1,
          unitCents: 0,
        }),
      ]);
    }
    fillInvoicePickers({
      leadId: els.invoiceForm.leadId.value,
      quoteId: els.invoiceForm.quoteId.value,
      jobId: job.id,
    });
    refreshInvoicePreview();
  }

  function collectInvoiceDraft() {
    const form = els.invoiceForm;
    if (!form) return null;
    const lineItems = readInvoiceLinesFromDom();
    const taxRate = parseFloat(form.taxRate?.value || "0");
    const subtotalCents = lineItems.reduce((sum, line) => sum + Math.round(line.qty * line.unitCents), 0);
    const safeTax = Number.isFinite(taxRate) ? Math.min(30, Math.max(0, taxRate)) : 0;
    const taxCents = Math.round(subtotalCents * (safeTax / 100));
    return {
      id: form.id.value || "",
      number: form.number.value || "INV-DRAFT",
      title: form.title.value || "Untitled invoice",
      status: form.status.value || "draft",
      clientName: form.clientName.value || "",
      billToName: form.billToName.value || form.clientName.value || "",
      billToEmail: form.billToEmail.value || "",
      billToPhone: form.billToPhone.value || "",
      billToAddress: form.billToAddress.value || "",
      issueDate: form.issueDate.value || toIsoDate(new Date()),
      dueDate: form.dueDate.value || "",
      paymentTerms: form.paymentTerms.value || "Net 15",
      taxRate: safeTax,
      notes: form.notes.value || "",
      leadId: form.leadId.value || null,
      jobId: form.jobId.value || null,
      quoteId: form.quoteId.value || null,
      lineItems,
      subtotalCents,
      taxCents,
      amountCents: subtotalCents + taxCents,
    };
  }

  function collectInvoicePayload() {
    const draft = collectInvoiceDraft();
    if (!draft) return null;
    return {
      number: draft.number === "INV-DRAFT" ? "" : draft.number,
      title: draft.title,
      status: draft.status,
      clientName: draft.clientName,
      billToName: draft.billToName,
      billToEmail: draft.billToEmail,
      billToPhone: draft.billToPhone,
      billToAddress: draft.billToAddress,
      issueDate: draft.issueDate || null,
      dueDate: draft.dueDate || null,
      paymentTerms: draft.paymentTerms,
      taxRate: draft.taxRate,
      notes: draft.notes,
      leadId: draft.leadId,
      jobId: draft.jobId,
      quoteId: draft.quoteId,
      lineItems: draft.lineItems.length
        ? draft.lineItems
        : [{ description: draft.title, qty: 1, unitCents: 0 }],
    };
  }

  function renderInvoiceDocumentHtml(invoice, { forPrint = false } = {}) {
    const billLines = [
      invoice.billToName || invoice.clientName,
      invoice.billToAddress,
      invoice.billToEmail,
      invoice.billToPhone,
    ]
      .map((p) => String(p || "").trim())
      .filter(Boolean);
    const rows = (invoice.lineItems || [])
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.description)}</td>
          <td class="num">${escapeHtml(String(item.qty))}</td>
          <td class="num">${escapeHtml(formatMoneyExact(item.unitCents))}</td>
          <td class="num">${escapeHtml(formatMoneyExact(Math.round(item.qty * item.unitCents)))}</td>
        </tr>`
      )
      .join("");

    return `
      <article class="invoice-sheet${forPrint ? " is-print" : ""}">
        <header class="invoice-sheet__brand">
          <div class="invoice-sheet__brand-left">
            <img src="${escapeHtml(COMPANY.logo)}" alt="" width="120" height="72" />
            <div>
              <strong>Vanderven</strong><span>Systems</span>
              <p>${escapeHtml(COMPANY.tagline)}</p>
            </div>
          </div>
          <div class="invoice-sheet__brand-right">
            <span class="invoice-sheet__kicker">Invoice</span>
            <h2>${escapeHtml(invoice.number || "INV-DRAFT")}</h2>
            <p>Issued ${escapeHtml(invoice.issueDate || "—")}<br/>Due ${escapeHtml(invoice.dueDate || "—")}</p>
          </div>
        </header>
        <div class="invoice-sheet__meta">
          <div>
            <span class="invoice-sheet__label">Bill to</span>
            <p>${billLines.map((l) => escapeHtml(l)).join("<br/>") || "—"}</p>
          </div>
          <div class="invoice-sheet__meta-right">
            <span class="invoice-sheet__label">For</span>
            <p>${escapeHtml(invoice.title || "—")}</p>
            <p class="muted">Terms: ${escapeHtml(invoice.paymentTerms || "Net 15")}</p>
            <p class="muted">${escapeHtml(COMPANY.location)} · ${escapeHtml(COMPANY.email)}</p>
          </div>
        </div>
        <table class="invoice-sheet__table">
          <thead>
            <tr>
              <th>Description</th>
              <th class="num">Qty</th>
              <th class="num">Rate</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows ||
              `<tr><td colspan="4" class="muted">Add line items to build this invoice</td></tr>`
            }
          </tbody>
        </table>
        <div class="invoice-sheet__totals">
          <div><span>Subtotal</span><strong>${escapeHtml(formatMoneyExact(invoice.subtotalCents))}</strong></div>
          <div><span>Tax (${escapeHtml(String(invoice.taxRate || 0))}%)</span><strong>${escapeHtml(
            formatMoneyExact(invoice.taxCents)
          )}</strong></div>
          <div class="is-total"><span>Total due</span><strong>${escapeHtml(
            formatMoneyExact(invoice.amountCents)
          )}</strong></div>
        </div>
        ${
          invoice.notes
            ? `<div class="invoice-sheet__notes"><span class="invoice-sheet__label">Notes</span><p>${escapeHtml(
                invoice.notes
              )}</p></div>`
            : ""
        }
        <footer class="invoice-sheet__foot">
          Please pay by e-transfer or arranged terms to <strong>${escapeHtml(COMPANY.email)}</strong>.
          Thank you for your business — ${escapeHtml(COMPANY.name)}.
        </footer>
      </article>`;
  }

  function refreshInvoicePreview() {
    if (!els.invoicePreview) return;
    const draft = collectInvoiceDraft();
    if (!draft) {
      els.invoicePreview.innerHTML = "";
      return;
    }
    els.invoicePreview.innerHTML = renderInvoiceDocumentHtml(draft);
  }

  function printInvoiceDocument() {
    const draft = collectInvoiceDraft();
    if (!draft) return;
    const html = renderInvoiceDocumentHtml(draft, { forPrint: true });
    const styles = `
      body{margin:0;background:#fff;color:#1c2430;font-family:Segoe UI,Helvetica,Arial,sans-serif;}
      .invoice-sheet{max-width:760px;margin:0 auto;padding:28px;}
      .invoice-sheet__brand{display:flex;justify-content:space-between;gap:1rem;padding:1.25rem 1.35rem;background:linear-gradient(135deg,#1c2430,#2d3a4a 55%,#3d3424);color:#f7f1e6;border-radius:12px;}
      .invoice-sheet__brand-left{display:flex;gap:0.75rem;align-items:center;}
      .invoice-sheet__brand-left img{width:72px;height:auto;background:#fff;border-radius:8px;padding:0.25rem;}
      .invoice-sheet__brand-left strong{display:block;font-size:1.2rem;}
      .invoice-sheet__brand-left span{opacity:0.85;}
      .invoice-sheet__brand-left p{margin:0.35rem 0 0;font-size:0.78rem;opacity:0.8;max-width:16rem;}
      .invoice-sheet__brand-right{text-align:right;}
      .invoice-sheet__kicker{font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.75;}
      .invoice-sheet__brand-right h2{margin:0.2rem 0;font-size:1.6rem;}
      .invoice-sheet__brand-right p{margin:0.35rem 0 0;font-size:0.85rem;opacity:0.9;}
      .invoice-sheet__meta{display:flex;justify-content:space-between;gap:1.5rem;margin:1.4rem 0;}
      .invoice-sheet__label{display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;margin-bottom:0.35rem;}
      .invoice-sheet__meta p{margin:0;line-height:1.5;font-size:0.92rem;}
      .invoice-sheet__meta-right{text-align:right;}
      .invoice-sheet__table{width:100%;border-collapse:collapse;margin-top:0.5rem;}
      .invoice-sheet__table th{background:#f4efe4;font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;padding:0.65rem 0.5rem;text-align:left;}
      .invoice-sheet__table td{padding:0.7rem 0.5rem;border-bottom:1px solid #e6e1d6;font-size:0.9rem;}
      .invoice-sheet__table .num,.invoice-sheet__totals .num{text-align:right;}
      .invoice-sheet__totals{margin:1.1rem 0 0 auto;width:min(100%,16rem);display:grid;gap:0.4rem;}
      .invoice-sheet__totals div{display:flex;justify-content:space-between;gap:1rem;font-size:0.9rem;}
      .invoice-sheet__totals .is-total{margin-top:0.35rem;padding-top:0.55rem;border-top:2px solid #1c2430;font-size:1rem;}
      .invoice-sheet__notes{margin-top:1.25rem;padding:0.85rem 1rem;background:#f7f2e8;border-radius:10px;}
      .invoice-sheet__notes p{margin:0.25rem 0 0;font-size:0.86rem;line-height:1.45;}
      .invoice-sheet__foot{margin-top:1.5rem;padding-top:0.9rem;border-top:1px solid #e6e1d6;font-size:0.82rem;color:#5c6570;line-height:1.5;}
      .muted{color:#5c6570;}
      @media print{body{background:#fff}.invoice-sheet{padding:0}}
    `;
    const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
    if (!win) {
      toast("Allow pop-ups to print the invoice");
      return;
    }
    win.document.write(
      `<!DOCTYPE html><html><head><title>${escapeHtml(draft.number)} — ${escapeHtml(
        COMPANY.name
      )}</title><style>${styles}</style></head><body>${html}<script>window.onload=()=>{window.focus();window.print();}</script></body></html>`
    );
    win.document.close();
  }

  async function saveInvoiceRecord({ keepOpen = false, markSent = false } = {}) {
    const payload = collectInvoicePayload();
    if (!payload) throw new Error("Invoice form missing");
    if (!payload.title?.trim()) throw new Error("Title is required");
    if (markSent) payload.status = "sent";
    const id = els.invoiceForm.id.value;
    const data = id
      ? await api(`/api/invoices/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        })
      : await api("/api/invoices", { method: "POST", body: JSON.stringify(payload) });
    upsertInvoice(data.invoice);
    els.invoiceForm.id.value = data.invoice.id;
    els.invoiceForm.number.value = data.invoice.number || "";
    els.invoiceDrawerTitle.textContent = data.invoice.number;
    els.invoiceDrawerMeta.textContent = statusMeta(INVOICE_STATUSES, data.invoice.status).label;
    if (!keepOpen) {
      closeDrawers();
      render();
    } else {
      openOnly(els.invoiceDrawer, { create: false, deleteBtn: els.deleteInvoice });
      refreshInvoicePreview();
    }
    return data.invoice;
  }

  function openInvoice(id) {
    const invoice = state.invoices.find((i) => i.id === id);
    if (!invoice) return;
    els.invoiceDrawerTitle.textContent = invoice.number;
    els.invoiceDrawerMeta.textContent = statusMeta(INVOICE_STATUSES, invoice.status).label;
    els.invoiceForm.reset();
    els.invoiceForm.id.value = invoice.id;
    els.invoiceForm.leadId.value = invoice.leadId || "";
    els.invoiceForm.jobId.value = invoice.jobId || "";
    els.invoiceForm.quoteId.value = invoice.quoteId || "";
    els.invoiceForm.number.value = invoice.number || "";
    els.invoiceForm.title.value = invoice.title || "";
    els.invoiceForm.clientName.value = invoice.clientName || "";
    els.invoiceForm.status.value = invoice.status || "draft";
    els.invoiceForm.issueDate.value = invoice.issueDate || (invoice.createdAt || "").slice(0, 10) || "";
    els.invoiceForm.dueDate.value = invoice.dueDate || "";
    els.invoiceForm.paymentTerms.value = invoice.paymentTerms || "Net 15";
    els.invoiceForm.taxRate.value = invoice.taxRate ?? 0;
    els.invoiceForm.billToName.value = invoice.billToName || invoice.clientName || "";
    els.invoiceForm.billToEmail.value = invoice.billToEmail || "";
    els.invoiceForm.billToPhone.value = invoice.billToPhone || "";
    els.invoiceForm.billToAddress.value = invoice.billToAddress || "";
    els.invoiceForm.notes.value = invoice.notes || "";
    fillInvoicePickers({
      leadId: invoice.leadId || "",
      quoteId: invoice.quoteId || "",
      jobId: invoice.jobId || "",
    });
    const lead = invoice.leadId ? state.leads.find((l) => l.id === invoice.leadId) : null;
    if (lead) {
      if (!els.invoiceForm.billToEmail.value) els.invoiceForm.billToEmail.value = lead.email || "";
      if (!els.invoiceForm.billToPhone.value) els.invoiceForm.billToPhone.value = lead.phone || "";
      if (!els.invoiceForm.billToAddress.value) {
        els.invoiceForm.billToAddress.value = formatClientAddress(lead) || "";
      }
      if (!els.invoiceForm.billToName.value) {
        els.invoiceForm.billToName.value = lead.name || lead.business || "";
      }
    }
    const lines =
      invoice.lineItems?.length
        ? invoice.lineItems
        : [
            emptyInvoiceLine({
              description: invoice.title || "Services",
              qty: 1,
              unitCents: invoice.subtotalCents || invoice.amountCents || 0,
            }),
          ];
    renderInvoiceLines(lines);
    openOnly(els.invoiceDrawer, { create: false, deleteBtn: els.deleteInvoice });
  }

  function openNewInvoice({ leadId = "", clientName = "", quoteId = "", jobId = "" } = {}) {
    if (!leadId) {
      requireClientFirst("create an invoice");
      return;
    }
    els.invoiceDrawerTitle.textContent = "New invoice";
    els.invoiceDrawerMeta.textContent = "Company letterhead · autofills from the client";
    els.invoiceForm.reset();
    els.invoiceForm.id.value = "";
    els.invoiceForm.leadId.value = leadId || "";
    els.invoiceForm.jobId.value = jobId || "";
    els.invoiceForm.quoteId.value = quoteId || "";
    els.invoiceForm.status.value = "draft";
    els.invoiceForm.paymentTerms.value = "Net 15";
    els.invoiceForm.taxRate.value = "5";
    els.invoiceForm.issueDate.value = toIsoDate(new Date());
    els.invoiceForm.dueDate.value = toIsoDate(addDays(new Date(), 14));
    els.invoiceForm.clientName.value = clientName || "";
    els.invoiceForm.notes.value = `E-transfer to ${COMPANY.email}. Thank you.`;
    fillInvoicePickers({ leadId, quoteId, jobId });
    renderInvoiceLines([emptyInvoiceLine({ description: clientName ? `${clientName} — services` : "" })]);
    if (leadId) applyLeadToInvoice(leadId);
    if (quoteId) applyQuoteToInvoice(quoteId);
    if (jobId) applyJobToInvoice(jobId);
    openOnly(els.invoiceDrawer, { create: true, deleteBtn: els.deleteInvoice });
    setTimeout(() => els.invoiceForm.title.focus(), 50);
  }

  function createItem(kind) {
    closeCreateMenu();
    closeMoreSheet();
    if (kind === "request") openNewRequest();
    else if (kind === "client") openNewLead();
    else if (kind === "job") requireClientFirst("start a build");
    else if (kind === "quote") requireClientFirst("create a quote");
    else if (kind === "invoice") requireClientFirst("create an invoice");
  }

  async function loadLeads() {
    const data = await api("/api/leads");
    state.leads = data.leads || [];
  }

  async function loadJobs() {
    const data = await api("/api/jobs");
    state.jobs = data.jobs || [];
  }

  async function loadQuotes() {
    const data = await api("/api/quotes");
    state.quotes = data.quotes || [];
    if (data.documents) state.quoteDocuments = data.documents;
  }

  async function loadQuoteDocuments() {
    try {
      const data = await api("/api/quote-documents");
      state.quoteDocuments = data.documents || [];
    } catch {
      state.quoteDocuments = state.quoteDocuments || [];
    }
  }

  async function loadInvoices() {
    const data = await api("/api/invoices");
    state.invoices = data.invoices || [];
  }

  async function loadReminders() {
    const data = await api("/api/reminders?limit=100");
    state.reminders = data.reminders || [];
  }

  async function loadVeraChats({ notify = false } = {}) {
    try {
      const data = await api("/api/vera-chats?limit=100");
      state.veraChats = data.chats || [];
      if (notify) toast(`Loaded ${state.veraChats.length} Vera chat${state.veraChats.length === 1 ? "" : "s"}`);
    } catch (err) {
      state.veraChats = [];
      if (notify) toast(err.message || "Could not load Vera chats");
    }
  }

  async function loadReminderSettings() {
    const data = await api("/api/reminder-settings");
    state.reminderSettings = data.settings || null;
    if (data.user) {
      state.sessionUser = data.user;
      if (state.view === "home") applyViewHeader("home");
    }
  }

  async function loadSession() {
    const data = await api("/api/session");
    if (data.user) state.sessionUser = data.user;
    if (state.view === "home") applyViewHeader("home");
  }

  async function loadUsers() {
    try {
      const data = await api("/api/users");
      state.users = data.users || [];
    } catch {
      state.users = [];
    }
  }

  async function refresh() {
    await Promise.all([loadSession(), loadReminderSettings()]);
    await Promise.all([
      loadLeads(),
      loadJobs(),
      loadQuotes(),
      loadQuoteDocuments(),
      loadInvoices(),
      loadVeraChats(),
      loadReminders(),
      loadUsers(),
    ]);
    render();
  }

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    if (state.query.trim()) openSearchPanel();
    else closeSearchPanel();
    scheduleRemoteSearch(state.query);
    render();
  });
  els.search.addEventListener("focus", () => {
    if (state.query.trim()) openSearchPanel();
    else if (els.searchPanel) {
      state.searchOpen = true;
      els.searchPanel.hidden = false;
      els.searchPanel.classList.add("is-open");
      els.search.setAttribute("aria-expanded", "true");
      renderSearchPanel();
    }
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSearchPanel();
      els.search.blur();
    }
  });

  els.quickCreate.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSearchPanel();
    toggleCreateMenu();
  });
  els.createPanel.querySelectorAll("[data-create]").forEach((btn) => {
    btn.addEventListener("click", () => createItem(btn.dataset.create));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".create-menu")) closeCreateMenu();
    if (!event.target.closest(".search-menu")) closeSearchPanel();
    if (!event.target.closest(".rewrite-menu")) closeRewriteMenus();
    if (!event.target.closest(".mobile-nav")) closeMobileNav();
  });

  els.mobileNavToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMobileNav();
  });
  els.mobileNavMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  els.mobileNavMenu?.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => closeMobileNav());
  });
  els.mobileCreate?.addEventListener("click", () => {
    closeMobileNav();
    openCreateMenu();
  });

  document.querySelectorAll("[data-cal-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.calendarMode = btn.dataset.calMode === "month" ? "month" : "week";
      if (state.calendarMode === "week") {
        state.weekStart = startOfWeek(state.monthCursor);
      } else {
        state.monthCursor = startOfMonth(state.weekStart);
      }
      render();
    });
  });

  els.weekPrev.addEventListener("click", () => {
    if (state.calendarMode === "month") state.monthCursor = addMonths(state.monthCursor, -1);
    else state.weekStart = addDays(state.weekStart, -7);
    render();
  });
  els.weekNext.addEventListener("click", () => {
    if (state.calendarMode === "month") state.monthCursor = addMonths(state.monthCursor, 1);
    else state.weekStart = addDays(state.weekStart, 7);
    render();
  });
  els.weekToday.addEventListener("click", () => {
    state.scheduleFocusDate = toIsoDate(new Date());
    const today = new Date();
    state.weekStart = startOfWeek(today);
    state.monthCursor = startOfMonth(today);
    render();
  });

  els.scheduleMapToggle?.addEventListener("click", () => {
    setScheduleMapOpen(state.scheduleMapOpen === false);
    renderSchedule();
  });

  [
    els.clientDrawerClose,
    els.drawerClose,
    els.cancelLead,
    els.jobDrawerClose,
    els.cancelJob,
    els.revisionDrawerClose,
    els.cancelRevision,
    els.quoteDrawerClose,
    els.cancelQuote,
    els.invoiceDrawerClose,
    els.cancelInvoice,
  ].forEach((btn) => btn?.addEventListener("click", closeDrawers));
  els.backdrop.addEventListener("click", closeDrawers);
  els.clientEdit?.addEventListener("click", () => {
    const id = state.clientDetail?.lead?.id;
    if (id) openLeadEdit(id);
  });
  els.jobLogRevisions?.addEventListener("click", () => {
    const jobId = els.jobForm?.id?.value || state.jobDetail?.job?.id || "";
    const leadId =
      els.jobForm?.leadId?.value || state.jobDetail?.lead?.id || state.jobDetail?.job?.leadId || "";
    if (!leadId) {
      toast("Link a client on this build first");
      return;
    }
    openRevisionModal({
      leadId,
      jobId,
      clientName:
        els.jobForm?.clientName?.value ||
        state.jobDetail?.lead?.business ||
        state.jobDetail?.job?.clientName ||
        "",
    });
  });

  els.revisionForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(els.revisionForm);
    const leadId = form.get("leadId");
    const jobId = form.get("jobId");
    const body = String(form.get("body") || "").trim();
    const markBuild = form.get("markBuild") === "on";
    const markQuote = form.get("markQuote") === "on";
    if (!leadId || !body) return;
    const saveBtn = document.getElementById("save-revision");
    if (saveBtn) saveBtn.disabled = true;
    try {
      const noteRes = await api(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
        method: "POST",
        body: JSON.stringify({ body, kind: "change_request" }),
      });
      if (markBuild && jobId) {
        const jobRes = await api(`/api/jobs/${encodeURIComponent(jobId)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "change_request", leadId }),
        });
        upsertJob(jobRes.job, { silent: true });
        if (els.jobForm?.id?.value === jobId) els.jobForm.status.value = "change_request";
      }
      if (markQuote) {
        const quotes =
          noteRes.detail?.quotes ||
          state.clientDetail?.quotes ||
          state.quotes.filter((q) => q.leadId === leadId || q.clientName === form.get("clientName"));
        const openQuote =
          quotes.find((q) => q.status === "sent" || q.status === "revisions_requested") || quotes[0];
        if (openQuote) {
          const quoteRes = await api(`/api/quotes/${encodeURIComponent(openQuote.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "revisions_requested", leadId }),
          });
          upsertQuote(quoteRes.quote, { silent: true });
        }
      }
      if (noteRes.detail?.lead) upsertLead(noteRes.detail.lead, { silent: true });
      if (state.clientDetail?.lead?.id === leadId && noteRes.detail) {
        state.clientDetail = noteRes.detail;
      }
      toast("Change request saved to history");
      if (jobId) {
        await openJob(jobId);
      } else if (leadId) {
        await openLead(leadId);
      } else {
        closeDrawers();
        render();
      }
    } catch (err) {
      toast(err.message || "Could not save change request");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  async function signOut() {
    await api("/api/logout", { method: "POST", body: "{}" });
    location.href = "/login";
  }
  els.signOut?.addEventListener("click", () => signOut());
  els.mobileSignOut?.addEventListener("click", () => signOut());

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(els.form);
    const internalRequest = form.get("internalRequest") === "1";
    const payload = Object.fromEntries(
      [
        "name",
        "business",
        "email",
        "phone",
        "addressLine",
        "city",
        "region",
        "postalCode",
        "country",
        "industry",
        "stage",
        "notes",
        "requestedBy",
        "assignee",
        "logoUrl",
      ].map((k) => [k, form.get(k)])
    );
    if (internalRequest) {
      payload.internalRequest = true;
      payload.source = "internal";
      if (!payload.requestedBy) payload.requestedBy = "Rob";
      if (!payload.assignee) payload.assignee = "Brad";
    } else {
      const handoff = document.getElementById("request-handoff-fields");
      if (handoff?.hidden) {
        delete payload.requestedBy;
        delete payload.assignee;
      }
    }
    const id = form.get("id");
    const saveBtn = document.getElementById("save-lead");
    saveBtn.disabled = true;
    try {
      const logoFile = els.form.logoFile?.files?.[0];
      if (logoFile) {
        payload.logoUrl = await readLogoFileAsDataUrl(logoFile);
      } else {
        payload.logoUrl = String(payload.logoUrl || "").trim();
      }
      const data = id
        ? await api(`/api/leads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/leads", { method: "POST", body: JSON.stringify(payload) });
      upsertLead(data.lead, { silent: true });
      toast(
        id
          ? "Saved"
          : internalRequest
            ? `Request logged · ${data.lead.requestedBy || "Rob"} → ${data.lead.assignee || "Brad"}`
            : "Client created — next: New quote"
      );
      await openLead(data.lead.id);
    } catch (err) {
      toast(err.message || "Could not save");
    } finally {
      saveBtn.disabled = false;
    }
  });

  const leadLogoUrlInput = document.getElementById("lead-logo-url");
  const leadLogoFileInput = document.getElementById("lead-logo-file");
  leadLogoUrlInput?.addEventListener("input", () => {
    if (leadLogoFileInput) leadLogoFileInput.value = "";
    syncLeadLogoPreview(leadLogoUrlInput.value);
  });
  leadLogoFileInput?.addEventListener("change", async () => {
    const file = leadLogoFileInput.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readLogoFileAsDataUrl(file);
      if (leadLogoUrlInput) leadLogoUrlInput.value = dataUrl;
      syncLeadLogoPreview(dataUrl);
    } catch (err) {
      leadLogoFileInput.value = "";
      toast(err.message || "Could not load logo");
    }
  });

  els.jobForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(els.jobForm);
    const status = form.get("status");
    const scheduledDate = status === "unscheduled" ? null : form.get("scheduledDate") || null;
    const rawStart = form.get("startTime");
    const startTime =
      status === "unscheduled" ? null : rawStart || (scheduledDate ? "08:00" : null);
    const payload = {
      title: form.get("title"),
      clientName: form.get("clientName"),
      leadId: form.get("leadId") || null,
      quoteId: form.get("quoteId") || null,
      assignee: form.get("assignee"),
      scheduledDate,
      startTime,
      durationMin: Number(form.get("durationMin")) || 90,
      color: form.get("color"),
      status,
      notes: form.get("notes"),
    };
    const id = form.get("id");
    const saveBtn = document.getElementById("save-job");
    const returnLeadId = form.get("leadId");
    const fromQuote = Boolean(form.get("quoteId"));
    if (!id && !payload.leadId) {
      toast("Add a client first, then start the build from their page");
      return;
    }
    saveBtn.disabled = true;
    try {
      const data = id
        ? await api(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/jobs", { method: "POST", body: JSON.stringify(payload) });
      upsertJob(data.job);
      if (!id && data.job.scheduledDate && data.job.status !== "unscheduled") {
        state.scheduleFocusDate = data.job.scheduledDate;
        state.weekStart = startOfWeek(new Date(`${data.job.scheduledDate}T12:00:00`));
        state.calendarMode = "week";
        toast(fromQuote ? "Build scheduled from quote" : "Build booked on the schedule");
        closeDrawers();
        await loadLeads();
        setView("schedule");
      } else {
        toast(id ? "Build saved" : "Build created");
        if (id) await openJob(id);
        else if (returnLeadId) await openLead(returnLeadId);
        else closeDrawers();
      }
    } catch (err) {
      toast(err.message || "Could not save build");
    } finally {
      saveBtn.disabled = false;
    }
  });

  els.quoteLeadPicker?.addEventListener("change", () => {
    const leadId = els.quoteLeadPicker.value;
    els.quoteForm.leadId.value = leadId || "";
    if (!leadId) {
      refreshQuotePreview();
      return;
    }
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return;
    if (!els.quoteForm.clientName.value) {
      els.quoteForm.clientName.value = lead.business || lead.name || "";
    }
    if (!els.quoteForm.title.value) {
      els.quoteForm.title.value = `${lead.business || lead.name} — services`;
    }
    refreshQuotePreview();
  });

  els.quoteScheduleBuild?.addEventListener("click", async () => {
    const id = els.quoteForm.id.value;
    if (!id) {
      toast("Save the quote first");
      return;
    }
    try {
      const quote = await saveQuoteRecord({ keepOpen: true });
      scheduleBuildFromQuote(quote.id);
    } catch (err) {
      toast(err.message || "Could not open build from quote");
    }
  });

  els.quoteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveBtn = document.getElementById("save-quote");
    const wasNew = !els.quoteForm.id.value;
    const returnLeadId = els.quoteForm.leadId?.value;
    saveBtn.disabled = true;
    try {
      const quote = await saveQuoteRecord({ keepOpen: true });
      if (returnLeadId) {
        const lead = state.leads.find((l) => l.id === returnLeadId);
        if (lead && (lead.stage === "new" || lead.stage === "audit")) {
          lead.stage = "quoted";
        }
      }
      toast(wasNew ? "Quote created — next: Schedule build when ready" : "Quote saved");
      render();
    } catch (err) {
      toast(err.message || "Could not save quote");
    } finally {
      saveBtn.disabled = false;
    }
  });

  els.quoteForm.addEventListener("input", () => refreshQuotePreview());
  els.quoteForm.addEventListener("change", () => refreshQuotePreview());

  els.printQuote?.addEventListener("click", () => printQuoteDocument());

  els.sendQuote?.addEventListener("click", async () => {
    const sendBtn = els.sendQuote;
    sendBtn.disabled = true;
    try {
      const draft = collectQuoteDraft();
      if (!draft?.leadId) {
        toast("Link a client before sending");
        return;
      }
      const lead = state.leads.find((l) => l.id === draft.leadId);
      if (!lead?.email) {
        toast("Add an email on the client before sending the quote");
        return;
      }
      if (!draft.title) {
        toast("Add a title before sending");
        return;
      }
      const quote = await saveQuoteRecord({ keepOpen: true });
      const data = await api(`/api/quotes/${encodeURIComponent(quote.id)}/send`, {
        method: "POST",
        body: "{}",
      });
      upsertQuote(data.quote);
      els.quoteForm.status.value = data.quote.status || "sent";
      els.quoteDrawerMeta.textContent = statusMeta(QUOTE_STATUSES, data.quote.status).label;
      renderQuoteAttachments(data.quote.documentIds || []);
      refreshQuotePreview();
      const n = (data.documents || []).length;
      const channel = data.delivery?.channel;
      toast(
        channel === "email"
          ? `Quote emailed to ${lead.email}${n ? ` · ${n} attachment(s)` : ""}`
          : `Quote marked sent (demo inbox — wire RESEND to email ${lead.email})${
              n ? ` · ${n} attachment(s)` : ""
            }`
      );
      render();
    } catch (err) {
      toast(err.message || "Could not send quote");
    } finally {
      sendBtn.disabled = false;
    }
  });

  els.invoiceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveBtn = document.getElementById("save-invoice");
    saveBtn.disabled = true;
    try {
      const wasNew = !els.invoiceForm.id.value;
      await saveInvoiceRecord({ keepOpen: false });
      toast(wasNew ? "Invoice created" : "Invoice saved");
    } catch (err) {
      toast(err.message || "Could not save invoice");
    } finally {
      saveBtn.disabled = false;
    }
  });

  els.invoiceForm.addEventListener("input", () => refreshInvoicePreview());
  els.invoiceForm.addEventListener("change", () => refreshInvoicePreview());

  els.invoiceAddLine?.addEventListener("click", () => {
    const lines = readInvoiceLinesFromDom();
    lines.push(emptyInvoiceLine());
    renderInvoiceLines(lines);
  });

  els.invoiceLeadPicker?.addEventListener("change", () => {
    const leadId = els.invoiceLeadPicker.value;
    els.invoiceForm.leadId.value = leadId || "";
    if (leadId) applyLeadToInvoice(leadId);
    else fillInvoicePickers({ leadId: "", quoteId: "", jobId: "" });
    refreshInvoicePreview();
  });

  els.invoiceQuotePicker?.addEventListener("change", () => {
    const quoteId = els.invoiceQuotePicker.value;
    els.invoiceForm.quoteId.value = quoteId || "";
    if (quoteId) applyQuoteToInvoice(quoteId);
    refreshInvoicePreview();
  });

  els.invoiceJobPicker?.addEventListener("change", () => {
    const jobId = els.invoiceJobPicker.value;
    els.invoiceForm.jobId.value = jobId || "";
    if (jobId) applyJobToInvoice(jobId);
    refreshInvoicePreview();
  });

  els.printInvoice?.addEventListener("click", () => printInvoiceDocument());

  els.sendInvoice?.addEventListener("click", async () => {
    const sendBtn = els.sendInvoice;
    sendBtn.disabled = true;
    try {
      const draft = collectInvoiceDraft();
      if (!draft?.billToEmail) {
        toast("Add a bill-to email before sending");
        return;
      }
      if (!draft.lineItems.length) {
        toast("Add at least one line item");
        return;
      }
      const invoice = await saveInvoiceRecord({ keepOpen: true, markSent: false });
      const data = await api(`/api/invoices/${encodeURIComponent(invoice.id)}/send`, {
        method: "POST",
        body: "{}",
      });
      upsertInvoice(data.invoice);
      els.invoiceForm.status.value = data.invoice.status || "sent";
      els.invoiceDrawerMeta.textContent = statusMeta(INVOICE_STATUSES, data.invoice.status).label;
      refreshInvoicePreview();
      const channel = data.delivery?.channel;
      toast(
        channel === "email"
          ? `Invoice emailed to ${draft.billToEmail}`
          : `Invoice marked sent (demo inbox — wire RESEND to email ${draft.billToEmail})`
      );
      render();
    } catch (err) {
      toast(err.message || "Could not send invoice");
    } finally {
      sendBtn.disabled = false;
    }
  });

  async function removeEntity(kind) {
    const map = {
      lead: { form: els.form, path: "/api/leads", list: "leads", label: "Client" },
      job: { form: els.jobForm, path: "/api/jobs", list: "jobs", label: "Job" },
      quote: { form: els.quoteForm, path: "/api/quotes", list: "quotes", label: "Quote" },
      invoice: { form: els.invoiceForm, path: "/api/invoices", list: "invoices", label: "Invoice" },
    };
    const cfg = map[kind];
    const id = cfg.form.id.value;
    if (!id || !confirm(`Delete this ${cfg.label.toLowerCase()}?`)) return;
    try {
      await api(`${cfg.path}/${encodeURIComponent(id)}`, { method: "DELETE" });
      state[cfg.list] = state[cfg.list].filter((item) => item.id !== id);
      closeDrawers();
      render();
      toast(`${cfg.label} deleted`);
    } catch (err) {
      toast(err.message || "Could not delete");
    }
  }

  els.deleteLead.addEventListener("click", () => removeEntity("lead"));
  els.deleteJob.addEventListener("click", () => removeEntity("job"));
  els.deleteQuote.addEventListener("click", () => removeEntity("quote"));
  els.deleteInvoice.addEventListener("click", () => removeEntity("invoice"));

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawers();
      closeCreateMenu();
      closeMoreSheet();
    }
  });

  mountRewriteControls(document);
  startIdleWatch();
  loadSession()
    .then(() => {
      setView("home");
      return refresh();
    })
    .catch((err) => {
      console.error(err);
      setView("home");
      toast("Could not load CRM data");
    });
})();
