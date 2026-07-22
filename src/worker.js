/**
 * Vanderven Systems — CRM worker (auth + leads API + route guards)
 */

const STAGES = ["new", "audit", "quoted", "active", "won", "lost"];
const SESSION_COOKIE = "vs_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

const encoder = new TextEncoder();

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function badRequest(message, status = 400) {
  return json({ error: message }, { status });
}

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "lead") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function b64url(bytes) {
  let str = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlFromString(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return b64url(sig);
}

async function createSessionToken(env) {
  const secret = env.SESSION_SECRET || env.CRM_PASSWORD || "dev-secret";
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = b64urlFromString(JSON.stringify({ role: "admin", exp }));
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function verifySessionToken(env, token) {
  if (!token || !token.includes(".")) return false;
  const secret = env.SESSION_SECRET || env.CRM_PASSWORD || "dev-secret";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await hmacSign(secret, payload);
  if (expected.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (ok !== 0) return false;
  try {
    const jsonStr = new TextDecoder().decode(fromB64url(payload));
    const data = JSON.parse(jsonStr);
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function sessionCookie(token, requestUrl) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`;
}

function clearSessionCookie(requestUrl) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function isAuthed(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return verifySessionToken(env, cookies[SESSION_COOKIE]);
}

function normalizeStage(stage) {
  const s = String(stage || "new").toLowerCase().trim();
  return STAGES.includes(s) ? s : null;
}

function cleanText(value, max = 2000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function rowToLead(row) {
  return {
    id: row.id,
    name: row.name,
    business: row.business,
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    stage: row.stage,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureSeeded(env) {
  if (!env.DB) return;
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM leads").first();
  if (count && Number(count.c) > 0) return;
  const ts = nowIso();
  const seed = [
    ["lead_demo_01", "Jordan Lee", "Valley Mechanical Ltd.", "jordan@valleymech.ca", "(250) 555-0142", "Trades / HVAC / plumbing / electrical", "new", "demo", "Most jobs come in by phone while on site. Quotes go out same day, then sit with no follow-up."],
    ["lead_demo_02", "Sam Rivera", "Okanagan Homes Realty", "sam@okanaganhomes.ca", "(250) 555-0198", "Real estate", "audit", "demo", "Listing inquiries sit over the weekend. Wants faster first response and a cleaner site."],
    ["lead_demo_03", "Alex Chen", "Lakeside Property Group", "alex@lakesidepm.ca", "(250) 555-0110", "Property management", "quoted", "demo", "Maintenance emails go cold. Owners want clearer updates without chasing the office."],
    ["lead_demo_04", "Morgan Blake", "Blake Advisory", "morgan@blakeadvisory.ca", "(250) 555-0166", "Professional services", "active", "demo", "Intake forms stall between meetings. Calendar and CRM need to talk to each other."],
    ["lead_demo_05", "Casey Nguyen", "Green Ridge Landscaping", "casey@greenridge.ca", "(250) 555-0133", "Lawn care / landscaping / seasonal", "won", "demo", "Seasonal lead spike. Needed a simple site and quote follow-up that doesn’t wait for evenings."],
  ];
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO leads (id, name, business, email, phone, industry, stage, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    seed.map(([id, name, business, email, phone, industry, stage, source, notes]) =>
      stmt.bind(id, name, business, email, phone, industry, stage, source, notes, ts, ts)
    )
  );
}

async function listLeads(env, { stage, q } = {}) {
  await ensureSeeded(env);
  let sql = "SELECT * FROM leads";
  const clauses = [];
  const binds = [];
  if (stage && normalizeStage(stage)) {
    clauses.push("stage = ?");
    binds.push(normalizeStage(stage));
  }
  if (q) {
    clauses.push("(name LIKE ? OR business LIKE ? OR email LIKE ? OR industry LIKE ? OR notes LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY updated_at DESC";
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return (result.results || []).map(rowToLead);
}

async function getLead(env, id) {
  const row = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
  return row ? rowToLead(row) : null;
}

async function createLead(env, body, { source = "manual", stage = "new" } = {}) {
  const name = cleanText(body.name, 120);
  const business = cleanText(body.business, 160);
  if (!name || !business) return { error: "Name and business are required." };

  const id = newId("lead");
  const ts = nowIso();
  const leadStage = normalizeStage(body.stage) || normalizeStage(stage) || "new";
  const notesParts = [];
  if (body.focus) notesParts.push(`Focus: ${cleanText(body.focus, 200)}`);
  if (body.preferred_contact) notesParts.push(`Preferred contact: ${cleanText(body.preferred_contact, 80)}`);
  if (body.website) notesParts.push(`Website: ${cleanText(body.website, 200)}`);
  if (body.message || body.notes) notesParts.push(cleanText(body.message || body.notes, 4000));

  const lead = {
    id,
    name,
    business,
    email: cleanText(body.email, 160),
    phone: cleanText(body.phone, 40),
    industry: cleanText(body.industry, 120),
    stage: leadStage,
    source: cleanText(source, 40) || "manual",
    notes: notesParts.join("\n"),
    created_at: ts,
    updated_at: ts,
  };

  await env.DB.prepare(
    `INSERT INTO leads (id, name, business, email, phone, industry, stage, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      lead.id,
      lead.name,
      lead.business,
      lead.email,
      lead.phone,
      lead.industry,
      lead.stage,
      lead.source,
      lead.notes,
      lead.created_at,
      lead.updated_at
    )
    .run();

  return { lead: rowToLead(lead) };
}

async function updateLead(env, id, body) {
  const existing = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
  if (!existing) return { error: "Lead not found.", status: 404 };

  const stage = body.stage !== undefined ? normalizeStage(body.stage) : existing.stage;
  if (body.stage !== undefined && !stage) return { error: "Invalid stage." };

  const name = body.name !== undefined ? cleanText(body.name, 120) : existing.name;
  const business = body.business !== undefined ? cleanText(body.business, 160) : existing.business;
  if (!name || !business) return { error: "Name and business are required." };

  const updated = {
    name,
    business,
    email: body.email !== undefined ? cleanText(body.email, 160) : existing.email,
    phone: body.phone !== undefined ? cleanText(body.phone, 40) : existing.phone,
    industry: body.industry !== undefined ? cleanText(body.industry, 120) : existing.industry,
    stage: stage || existing.stage,
    notes: body.notes !== undefined ? cleanText(body.notes, 4000) : existing.notes,
    updated_at: nowIso(),
  };

  await env.DB.prepare(
    `UPDATE leads SET name = ?, business = ?, email = ?, phone = ?, industry = ?, stage = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      updated.name,
      updated.business,
      updated.email,
      updated.phone,
      updated.industry,
      updated.stage,
      updated.notes,
      updated.updated_at,
      id
    )
    .run();

  return { lead: await getLead(env, id) };
}

async function deleteLead(env, id) {
  const result = await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Lead not found.", status: 404 };
  return { ok: true };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  // Public contact intake
  if (path === "/api/public/leads" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await createLead(env, body, { source: "contact", stage: "new" });
    if (result.error) return badRequest(result.error);
    return json({ ok: true, id: result.lead.id }, { status: 201 });
  }

  if (path === "/api/login" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const password = String(body.password || "");
    const expected = env.CRM_PASSWORD || "vanderven-demo";
    if (!password || password !== expected) {
      return json({ error: "Incorrect password." }, { status: 401 });
    }
    const token = await createSessionToken(env);
    return json(
      { ok: true },
      {
        status: 200,
        headers: { "Set-Cookie": sessionCookie(token, request.url) },
      }
    );
  }

  if (path === "/api/logout" && method === "POST") {
    return json(
      { ok: true },
      {
        status: 200,
        headers: { "Set-Cookie": clearSessionCookie(request.url) },
      }
    );
  }

  if (path === "/api/session" && method === "GET") {
    const authed = await isAuthed(request, env);
    return json({ authenticated: authed });
  }

  const authed = await isAuthed(request, env);
  if (!authed) return json({ error: "Unauthorized." }, { status: 401 });

  if (path === "/api/leads" && method === "GET") {
    const stage = url.searchParams.get("stage") || "";
    const q = cleanText(url.searchParams.get("q") || "", 80);
    const leads = await listLeads(env, { stage, q });
    return json({ leads, stages: STAGES });
  }

  if (path === "/api/leads" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await createLead(env, body, { source: body.source || "manual" });
    if (result.error) return badRequest(result.error);
    return json({ lead: result.lead }, { status: 201 });
  }

  const leadMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadMatch) {
    const id = decodeURIComponent(leadMatch[1]);
    if (method === "GET") {
      const lead = await getLead(env, id);
      if (!lead) return json({ error: "Lead not found." }, { status: 404 });
      return json({ lead });
    }
    if (method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await updateLead(env, id, body);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ lead: result.lead });
    }
    if (method === "DELETE") {
      const result = await deleteLead(env, id);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ ok: true });
    }
  }

  return json({ error: "Not found." }, { status: 404 });
}

async function serveAsset(request, env, pathOverride) {
  if (!env.ASSETS) return new Response("Assets binding missing.", { status: 500 });
  if (pathOverride) {
    const url = new URL(request.url);
    url.pathname = pathOverride;
    // Avoid Cloudflare's .html → clean-URL redirect loop by fetching the
    // extensionless/public path the assets router expects.
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname.startsWith("/api/")) {
        return await handleApi(request, env);
      }

      const authed = await isAuthed(request, env);

      if (pathname === "/login" || pathname === "/login.html") {
        if (authed) return redirect("/app/");
        // Request the clean URL so ASSETS serves login.html with 200 (not 307).
        const loginUrl = new URL("/login", request.url);
        return env.ASSETS.fetch(new Request(loginUrl.toString(), request));
      }

      if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/")) {
        if (!authed) return redirect(`/login?next=${encodeURIComponent("/app/")}`);
        if (pathname === "/app") return redirect("/app/");
        if (pathname === "/app/") {
          const appUrl = new URL("/app/", request.url);
          return env.ASSETS.fetch(new Request(appUrl.toString(), request));
        }
        return env.ASSETS.fetch(request);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: "Server error.", detail: String(err?.message || err) }, { status: 500 });
    }
  },
};
