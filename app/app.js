(() => {
  const STAGES = [
    { id: "new", label: "New" },
    { id: "audit", label: "Audit" },
    { id: "quoted", label: "Quoted" },
    { id: "active", label: "Active" },
    { id: "won", label: "Won" },
    { id: "lost", label: "Lost" },
  ];

  const state = {
    view: "pipeline",
    leads: [],
    query: "",
    activeId: null,
    dragId: null,
  };

  const els = {
    title: document.getElementById("view-title"),
    sub: document.getElementById("view-sub"),
    pipeline: document.getElementById("view-pipeline"),
    leads: document.getElementById("view-leads"),
    search: document.getElementById("search"),
    newLead: document.getElementById("new-lead"),
    mobileNew: document.getElementById("mobile-new"),
    signOut: document.getElementById("sign-out"),
    drawer: document.getElementById("drawer"),
    backdrop: document.getElementById("drawer-backdrop"),
    drawerClose: document.getElementById("drawer-close"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerMeta: document.getElementById("drawer-meta"),
    form: document.getElementById("lead-form"),
    deleteLead: document.getElementById("delete-lead"),
    cancelLead: document.getElementById("cancel-lead"),
    toast: document.getElementById("toast"),
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const formatDate = (iso) => {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
      }).format(new Date(iso));
    } catch {
      return "";
    }
  };

  const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;

  let toastTimer;
  const toast = (message) => {
    els.toast.textContent = message;
    els.toast.classList.add("is-in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-in"), 2200);
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    if (res.status === 401) {
      location.href = "/login?next=/app";
      throw new Error("Unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  const filteredLeads = () => {
    const q = state.query.trim().toLowerCase();
    if (!q) return state.leads;
    return state.leads.filter((lead) => {
      const hay = [lead.name, lead.business, lead.email, lead.industry, lead.notes, lead.stage]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  };

  function setView(view) {
    state.view = view;
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
    const pipeline = view === "pipeline";
    els.pipeline.hidden = !pipeline;
    els.leads.hidden = pipeline;
    els.title.textContent = pipeline ? "Pipeline" : "Leads";
    els.sub.textContent = pipeline
      ? "Move leads through the work."
      : "Everyone in one calm list.";
    render();
  }

  function renderPipeline() {
    const leads = filteredLeads();
    els.pipeline.innerHTML = `<div class="pipeline">${STAGES.map((stage) => {
      const items = leads.filter((l) => l.stage === stage.id);
      return `
        <section class="pipeline-col" data-stage="${stage.id}">
          <div class="pipeline-col__head">
            <h2>${stage.label}</h2>
            <span class="pipeline-col__count">${items.length}</span>
          </div>
          <div class="pipeline-col__list" data-stage-list="${stage.id}">
            ${
              items.length
                ? items
                    .map(
                      (lead) => `
              <article class="lead-card" draggable="true" data-id="${escapeHtml(lead.id)}">
                <p class="lead-card__name">${escapeHtml(lead.name)}</p>
                <p class="lead-card__biz">${escapeHtml(lead.business)}</p>
                <div class="lead-card__meta">
                  ${lead.industry ? `<span class="chip">${escapeHtml(lead.industry)}</span>` : ""}
                  <span class="chip chip-gold">${escapeHtml(formatDate(lead.updatedAt))}</span>
                </div>
              </article>`
                    )
                    .join("")
                : `<div class="empty" style="padding:1rem 0.4rem"><span>Drop leads here</span></div>`
            }
          </div>
        </section>`;
    }).join("")}</div>`;

    els.pipeline.querySelectorAll(".lead-card").forEach((card) => {
      card.addEventListener("click", () => openLead(card.dataset.id));
      card.addEventListener("dragstart", (event) => {
        state.dragId = card.dataset.id;
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.id);
      });
      card.addEventListener("dragend", () => {
        state.dragId = null;
        card.classList.remove("is-dragging");
        els.pipeline.querySelectorAll(".pipeline-col").forEach((col) => col.classList.remove("is-over"));
      });
    });

    els.pipeline.querySelectorAll(".pipeline-col").forEach((col) => {
      col.addEventListener("dragover", (event) => {
        event.preventDefault();
        col.classList.add("is-over");
      });
      col.addEventListener("dragleave", () => col.classList.remove("is-over"));
      col.addEventListener("drop", async (event) => {
        event.preventDefault();
        col.classList.remove("is-over");
        const id = state.dragId || event.dataTransfer.getData("text/plain");
        const stage = col.dataset.stage;
        const lead = state.leads.find((l) => l.id === id);
        if (!lead || lead.stage === stage) return;
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
          toast(err.message || "Could not update stage");
          await loadLeads();
        }
      });
    });
  }

  function renderLeads() {
    const leads = filteredLeads();
    if (!leads.length) {
      els.leads.innerHTML = `
        <div class="leads-panel">
          <div class="empty">
            <strong>No leads match</strong>
            Try another search, or add a new lead.
          </div>
        </div>`;
      return;
    }

    els.leads.innerHTML = `
      <div class="leads-panel">
        <table class="leads-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Business</th>
              <th>Industry</th>
              <th>Stage</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            ${leads
              .map(
                (lead) => `
              <tr data-id="${escapeHtml(lead.id)}">
                <td>
                  <strong>${escapeHtml(lead.name)}</strong>
                  <div class="muted">${escapeHtml(lead.email || "—")}</div>
                </td>
                <td>${escapeHtml(lead.business)}</td>
                <td class="muted">${escapeHtml(lead.industry || "—")}</td>
                <td><span class="chip ${lead.stage === "won" ? "chip-green" : ""}">${escapeHtml(
                  stageLabel(lead.stage)
                )}</span></td>
                <td class="muted">${escapeHtml(formatDate(lead.updatedAt))}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;

    els.leads.querySelectorAll("tbody tr").forEach((row) => {
      row.addEventListener("click", () => openLead(row.dataset.id));
    });
  }

  function render() {
    if (state.view === "pipeline") renderPipeline();
    else renderLeads();
  }

  function upsertLead(lead) {
    const idx = state.leads.findIndex((l) => l.id === lead.id);
    if (idx === -1) state.leads.unshift(lead);
    else state.leads[idx] = lead;
    state.leads.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    render();
  }

  function openDrawer({ create = false } = {}) {
    els.backdrop.hidden = false;
    requestAnimationFrame(() => {
      els.backdrop.classList.add("is-open");
      els.drawer.classList.add("is-open");
      els.drawer.setAttribute("aria-hidden", "false");
    });
    els.deleteLead.hidden = create;
  }

  function closeDrawer() {
    els.backdrop.classList.remove("is-open");
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      els.backdrop.hidden = true;
    }, 200);
    state.activeId = null;
  }

  function openLead(id) {
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) return;
    state.activeId = id;
    els.drawerTitle.textContent = lead.name;
    els.drawerMeta.textContent = `${stageLabel(lead.stage)} · ${lead.source || "manual"}`;
    els.form.id.value = lead.id;
    els.form.name.value = lead.name || "";
    els.form.business.value = lead.business || "";
    els.form.email.value = lead.email || "";
    els.form.phone.value = lead.phone || "";
    els.form.industry.value = lead.industry || "";
    els.form.stage.value = lead.stage || "new";
    els.form.notes.value = lead.notes || "";
    openDrawer({ create: false });
  }

  function openNewLead() {
    state.activeId = null;
    els.drawerTitle.textContent = "New lead";
    els.drawerMeta.textContent = "Starts in New";
    els.form.reset();
    els.form.id.value = "";
    els.form.stage.value = "new";
    openDrawer({ create: true });
    setTimeout(() => els.form.name.focus(), 50);
  }

  async function loadLeads() {
    const data = await api("/api/leads");
    state.leads = data.leads || [];
    render();
  }

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    render();
  });

  els.newLead.addEventListener("click", openNewLead);
  els.mobileNew?.addEventListener("click", openNewLead);
  els.drawerClose.addEventListener("click", closeDrawer);
  els.cancelLead.addEventListener("click", closeDrawer);
  els.backdrop.addEventListener("click", closeDrawer);

  els.signOut.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    location.href = "/login";
  });

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(els.form);
    const payload = {
      name: form.get("name"),
      business: form.get("business"),
      email: form.get("email"),
      phone: form.get("phone"),
      industry: form.get("industry"),
      stage: form.get("stage"),
      notes: form.get("notes"),
    };
    const id = form.get("id");
    const saveBtn = document.getElementById("save-lead");
    saveBtn.disabled = true;
    try {
      if (id) {
        const data = await api(`/api/leads/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        upsertLead(data.lead);
        toast("Lead saved");
      } else {
        const data = await api("/api/leads", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        upsertLead(data.lead);
        toast("Lead created");
      }
      closeDrawer();
    } catch (err) {
      toast(err.message || "Could not save");
    } finally {
      saveBtn.disabled = false;
    }
  });

  els.deleteLead.addEventListener("click", async () => {
    const id = els.form.id.value;
    if (!id) return;
    if (!confirm("Delete this lead?")) return;
    try {
      await api(`/api/leads/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.leads = state.leads.filter((l) => l.id !== id);
      closeDrawer();
      render();
      toast("Lead deleted");
    } catch (err) {
      toast(err.message || "Could not delete");
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.drawer.classList.contains("is-open")) {
      closeDrawer();
    }
  });

  loadLeads().catch((err) => {
    console.error(err);
    toast("Could not load leads");
  });
})();
