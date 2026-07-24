/**
 * Vanderven Systems — CRM worker (auth + leads API + route guards)
 */

const STAGES = ["new", "audit", "quoted", "active", "won", "lost"];
const JOB_STATUSES = [
  "unscheduled",
  "rough_draft",
  "architecture",
  "fine_tuning",
  "client_approval",
  "change_request",
  "done",
];
const JOB_STATUS_LABELS = {
  unscheduled: "Backlog",
  rough_draft: "Rough draft",
  architecture: "Architecture",
  fine_tuning: "Fine tuning",
  client_approval: "Waiting on client",
  change_request: "Change request",
  done: "Delivered",
};
const JOB_STATUS_ALIASES = {
  scheduled: "rough_draft",
  discovery: "rough_draft",
  build: "architecture",
  review: "client_approval",
};
const JOB_COLORS = ["slate", "gold", "teal", "rust", "indigo"];
const QUOTE_STATUSES = ["draft", "sent", "revisions_requested", "approved", "declined"];
const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue"];
const ASSIGNEES = ["", "Brad", "Rob", "Riley", "Morgan"];
const REQUEST_FROM_DEFAULT = "Rob";
const REQUEST_TO_DEFAULT = "Brad";
const REWRITE_TONES = ["professional", "casual", "friendly", "clearer", "shorter"];
const REWRITE_CONTEXTS = ["quote", "invoice", "client_note", "request", "build"];
const REWRITE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const REWRITE_MAX_CHARS = 4000;
const CHAT_MODEL = REWRITE_MODEL;
const CHAT_MAX_MESSAGE_CHARS = 800;
const CHAT_MAX_HISTORY = 12;
const CHAT_MAX_TOKENS = 220;
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_COOKIE = "vs_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

const encoder = new TextEncoder();
/** @type {Map<string, number[]>} */
const publicChatHits = new Map();

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

// Cloudflare Workers WebCrypto rejects PBKDF2 iteration counts above 100000.
const PBKDF2_ITERATIONS = 100000;

function b64urlEncodeBytes(bytes) {
  return b64url(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

async function hashPassword(password, saltB64) {
  const salt = saltB64
    ? fromB64url(saltB64)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(password)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { hash: b64urlEncodeBytes(bits), salt: b64urlEncodeBytes(salt) };
}

async function verifyPassword(password, hashB64, saltB64) {
  if (!password || !hashB64 || !saltB64) return false;
  const { hash } = await hashPassword(password, saltB64);
  if (hash.length !== hashB64.length) return false;
  let ok = 0;
  for (let i = 0; i < hash.length; i++) ok |= hash.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return ok === 0;
}

function rowToUser(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  const isOwner = Number(row.is_owner) !== 0;
  const user = {
    id: row.id,
    email: row.email,
    name: row.name || "",
    role: isOwner ? "admin" : row.role || "member",
    active: Number(row.active) !== 0,
    isOwner,
    ownerEnabled: Number(row.owner_enabled) !== 0,
    ownerDays: parseDayList(row.owner_days, [2, 5, 10]),
    clientEnabled: Number(row.client_enabled) !== 0,
    clientDays: parseDayList(row.client_days, [3, 7, 14]),
    stopOnClosed: Number(row.stop_on_closed) !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSecrets) {
    user.passwordHash = row.password_hash;
    user.passwordSalt = row.password_salt;
  }
  return user;
}

async function ensureUsers(env) {
  if (!env.DB) return;
  // Migration may not be applied yet in some environments.
  let hasUsers = false;
  try {
    const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
    hasUsers = !!(count && Number(count.c) > 0);
  } catch {
    return;
  }
  if (!hasUsers) {
    const email = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.systems", 160).toLowerCase();
    const password = String(env.CRM_PASSWORD || "vanderven-demo");
    const { hash, salt } = await hashPassword(password);
    const ts = nowIso();
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users
          (id, email, name, password_hash, password_salt, role, active, is_owner,
           owner_enabled, owner_days, client_enabled, client_days, stop_on_closed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 1, 1, 1, '2,5,10', 1, '3,7,14', 1, ?, ?)`
      )
        .bind(
          newId("user"),
          email,
          email.startsWith("brad@") ? "Brad" : "Admin",
          hash,
          salt,
          ts,
          ts
        )
        .run();
    } catch {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users
          (id, email, name, password_hash, password_salt, role, active,
           owner_enabled, owner_days, client_enabled, client_days, stop_on_closed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 1, 1, '2,5,10', 1, '3,7,14', 1, ?, ?)`
      )
        .bind(
          newId("user"),
          email,
          email.startsWith("brad@") ? "Brad" : "Admin",
          hash,
          salt,
          ts,
          ts
        )
        .run();
    }
  }
  await ensureAccountOwners(env);
}

async function ensureAccountOwners(env) {
  if (!env.DB) return;
  const email = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.systems", 160).toLowerCase();
  const ts = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE users SET is_owner = 1, role = 'admin', active = 1, updated_at = ? WHERE lower(email) = ?`
    )
      .bind(ts, email)
      .run();
  } catch {
    // is_owner column may not exist until migration 0017 is applied.
  }
}

async function getUserByEmail(env, email) {
  await ensureUsers(env);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ? LIMIT 1")
    .bind(String(email || "").trim().toLowerCase())
    .first();
  return row;
}

async function getUserById(env, id) {
  if (!id) return null;
  await ensureUsers(env);
  return env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first();
}

function isAdminUser(user) {
  return !!user && (user.role === "admin" || user.isOwner);
}

function isOwnerUser(user) {
  return !!user && !!user.isOwner;
}

function assertOwnerCanDelete(user) {
  if (!isOwnerUser(user)) {
    return { error: "Only the account owner can delete records.", status: 403 };
  }
  return null;
}

async function listUsers(env) {
  await ensureUsers(env);
  await ensureAccountOwners(env);
  let result;
  try {
    result = await env.DB.prepare(
      `SELECT id, email, name, role, active, is_owner, owner_enabled, owner_days, client_enabled, client_days,
              stop_on_closed, created_at, updated_at
       FROM users ORDER BY email ASC`
    ).all();
  } catch {
    result = await env.DB.prepare(
      `SELECT id, email, name, role, active, owner_enabled, owner_days, client_enabled, client_days,
              stop_on_closed, created_at, updated_at
       FROM users ORDER BY email ASC`
    ).all();
  }
  return (result.results || []).map((row) => rowToUser(row));
}

async function createUserAccount(env, body = {}) {
  await ensureUsers(env);
  const email = cleanText(body.email || "", 160).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "A valid email is required." };
  }
  const password = String(body.password || "");
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  const name = cleanText(body.name || "", 80);
  const role = String(body.role || "member").toLowerCase();
  if (!["admin", "member"].includes(role)) return { error: "Role must be admin or member." };

  const existing = await getUserByEmail(env, email);
  if (existing) return { error: "A user with that email already exists." };

  const { hash, salt } = await hashPassword(password);
  const id = newId("user");
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO users
      (id, email, name, password_hash, password_salt, role, active,
       owner_enabled, owner_days, client_enabled, client_days, stop_on_closed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, '2,5,10', 1, '3,7,14', 1, ?, ?)`
  )
    .bind(id, email, name, hash, salt, role, ts, ts)
    .run();

  const row = await getUserById(env, id);
  return { user: rowToUser(row) };
}

async function updateUserAccount(env, id, body = {}, actor = null) {
  await ensureUsers(env);
  const existing = await getUserById(env, id);
  if (!existing) return { error: "User not found.", status: 404 };

  let name = existing.name || "";
  if (body.name !== undefined) name = cleanText(body.name || "", 80);

  let role = existing.role || "member";
  if (body.role !== undefined) {
    role = String(body.role || "").toLowerCase();
    if (!["admin", "member"].includes(role)) return { error: "Role must be admin or member." };
  }

  let active = Number(existing.active) !== 0 ? 1 : 0;
  if (body.active !== undefined) active = body.active ? 1 : 0;

  let isOwner = Number(existing.is_owner) !== 0 ? 1 : 0;
  if (body.isOwner !== undefined || body.is_owner !== undefined) {
    if (!isOwnerUser(actor)) {
      return { error: "Only an owner can change owner status.", status: 403 };
    }
    isOwner = body.isOwner ?? body.is_owner ? 1 : 0;
  }

  if (Number(existing.is_owner) && !isOwner) {
    const owners = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE is_owner = 1 AND id != ?"
    )
      .bind(id)
      .first();
    if (!owners || Number(owners.c) < 1) {
      return { error: "Keep at least one owner." };
    }
  }

  // Owners remain protected admins — cannot be demoted or deactivated.
  if (isOwner) {
    role = "admin";
    active = 1;
  }

  // Keep at least one active admin.
  if (
    (existing.role === "admin" && role !== "admin" && Number(existing.active)) ||
    (existing.role === "admin" && !active && Number(existing.active))
  ) {
    const admins = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?"
    )
      .bind(id)
      .first();
    if (!admins || Number(admins.c) < 1) {
      return { error: "Keep at least one active admin." };
    }
  }

  if (actor?.id && actor.id === id && !active) {
    return { error: "You can’t deactivate your own account." };
  }

  let passwordHash = existing.password_hash;
  let passwordSalt = existing.password_salt;
  if (body.password !== undefined && body.password !== null && body.password !== "") {
    const password = String(body.password);
    if (password.length < 6) return { error: "Password must be at least 6 characters." };
    const hashed = await hashPassword(password);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  const ts = nowIso();
  try {
    await env.DB.prepare(
      `UPDATE users SET
        name = ?, role = ?, active = ?, is_owner = ?, password_hash = ?, password_salt = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(name, role, active, isOwner, passwordHash, passwordSalt, ts, id)
      .run();
  } catch {
    await env.DB.prepare(
      `UPDATE users SET
        name = ?, role = ?, active = ?, password_hash = ?, password_salt = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(name, role, active, passwordHash, passwordSalt, ts, id)
      .run();
  }

  const row = await getUserById(env, id);
  return { user: rowToUser(row) };
}

async function changeOwnPassword(env, sessionUser, body = {}) {
  if (!sessionUser?.id) return { error: "Unauthorized.", status: 401 };
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const confirmPassword = String(body.confirmPassword || "");

  if (!currentPassword) return { error: "Current password is required." };
  if (newPassword.length < 6) return { error: "New password must be at least 6 characters." };
  if (confirmPassword !== newPassword) return { error: "New passwords do not match." };
  if (currentPassword === newPassword) {
    return { error: "New password must be different from the current one." };
  }

  const row = await getUserById(env, sessionUser.id);
  if (!row || !Number(row.active)) return { error: "Account not found.", status: 404 };

  const valid = await verifyPassword(currentPassword, row.password_hash, row.password_salt);
  if (!valid) return { error: "Current password is incorrect.", status: 400 };

  const { hash, salt } = await hashPassword(newPassword);
  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`
  )
    .bind(hash, salt, ts, sessionUser.id)
    .run();

  return { ok: true };
}

async function createSessionToken(env, user) {
  const secret = env.SESSION_SECRET || env.CRM_PASSWORD || "dev-secret";
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = b64urlFromString(
    JSON.stringify({
      sub: user?.id || null,
      email: user?.email || null,
      role: user?.role || "member",
      exp,
    })
  );
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function readSession(env, token) {
  if (!token || !token.includes(".")) return null;
  const secret = env.SESSION_SECRET || env.CRM_PASSWORD || "dev-secret";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmacSign(secret, payload);
  if (expected.length !== sig.length) return null;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (ok !== 0) return null;
  try {
    const jsonStr = new TextDecoder().decode(fromB64url(payload));
    const data = JSON.parse(jsonStr);
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

async function verifySessionToken(env, token) {
  return !!(await readSession(env, token));
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const session = await readSession(env, cookies[SESSION_COOKIE]);
  if (!session) return null;
  if (session.sub) {
    const row = await getUserById(env, session.sub);
    if (!row || !Number(row.active)) return null;
    return rowToUser(row);
  }
  // Legacy sessions (pre-users) still count as authenticated admin/owner.
  return {
    id: null,
    email: cleanText(env.CRM_OWNER_EMAIL || "", 160),
    name: "Admin",
    role: session.role || "admin",
    active: true,
    isOwner: true,
    ownerEnabled: true,
    ownerDays: [2, 5, 10],
    clientEnabled: true,
    clientDays: [3, 7, 14],
    stopOnClosed: true,
  };
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

function cleanLogoUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Allow http(s) URLs or small data:image uploads (capped).
  if (/^https?:\/\//i.test(raw) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) {
    return raw.slice(0, 180000);
  }
  return "";
}

function formatLeadAddress(parts = {}) {
  return [parts.addressLine, parts.city, parts.region, parts.postalCode, parts.country]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(", ");
}

function googleMapsSearchUrl(query) {
  const q = String(query || "").trim();
  if (!q) return "";
  // /place/ lands on a pinned address (search/?api=1 often opens an unpinned map)
  const slug = encodeURIComponent(q).replace(/%20/g, "+");
  return `https://www.google.com/maps/place/${slug}`;
}

function googleMapsEmbedUrl(query) {
  const q = String(query || "").trim();
  if (!q) return "";
  // q= + iwloc=B keeps the red pin / place balloon in the embed
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&hl=en&ie=UTF8&iwloc=B&output=embed`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readGeocodeCache(env, queryKey) {
  if (!env.DB || !queryKey) return null;
  try {
    return await env.DB.prepare(
      "SELECT query_key, lat, lng, display_name FROM geocode_cache WHERE query_key = ?"
    )
      .bind(queryKey)
      .first();
  } catch {
    return null;
  }
}

async function writeGeocodeCache(env, queryKey, { lat, lng, displayName }) {
  if (!env.DB || !queryKey) return;
  try {
    await env.DB.prepare(
      `INSERT INTO geocode_cache (query_key, lat, lng, display_name, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(query_key) DO UPDATE SET
         lat = excluded.lat,
         lng = excluded.lng,
         display_name = excluded.display_name,
         updated_at = excluded.updated_at`
    )
      .bind(queryKey, lat, lng, displayName || "", nowIso())
      .run();
  } catch {
    /* migration not applied yet */
  }
}

async function geocodeAddress(env, query) {
  const q = cleanText(query, 400);
  if (!q) return null;
  const queryKey = q.toLowerCase();

  const cached = await readGeocodeCache(env, queryKey);
  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
    return {
      query: q,
      lat: cached.lat,
      lng: cached.lng,
      displayName: cached.display_name || q,
      cached: true,
    };
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", q);

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "VandervenSysCRM/1.0 (crm schedule map geocoder)",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let rows;
  try {
    rows = await res.json();
  } catch {
    return null;
  }
  const hit = Array.isArray(rows) ? rows[0] : null;
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const displayName = cleanText(hit.display_name || q, 400);
  await writeGeocodeCache(env, queryKey, { lat, lng, displayName });
  return { query: q, lat, lng, displayName, cached: false };
}

async function geocodeAddressBatch(env, queries) {
  const list = Array.isArray(queries) ? queries : [];
  const unique = [];
  const seen = new Set();
  for (const raw of list) {
    const q = cleanText(raw, 400);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(q);
  }

  const results = {};
  const misses = [];

  const storeResult = (q, hit) => {
    if (!hit) return;
    results[q] = hit;
    results[q.toLowerCase()] = hit;
  };

  for (const q of unique) {
    const cached = await readGeocodeCache(env, q.toLowerCase());
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      storeResult(q, {
        query: q,
        lat: cached.lat,
        lng: cached.lng,
        displayName: cached.display_name || q,
        cached: true,
      });
    } else {
      misses.push(q);
    }
  }

  for (let i = 0; i < misses.length; i++) {
    if (i > 0) await sleep(1100);
    const hit = await geocodeAddress(env, misses[i]);
    storeResult(misses[i], hit);
  }

  return { results, count: unique.filter((q) => results[q]).length, requested: unique.length };
}

function rowToLead(row) {
  const addressLine = row.address_line || "";
  const city = row.city || "";
  const region = row.region || "";
  const postalCode = row.postal_code || "";
  const country = row.country || "Canada";
  const address = formatLeadAddress({ addressLine, city, region, postalCode, country });
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
    requestedBy: row.requested_by || "",
    assignee: row.assignee || "",
    logoUrl: row.logo_url || "",
    addressLine,
    city,
    region,
    postalCode,
    country,
    address,
    mapsUrl: googleMapsSearchUrl(address),
    mapsEmbedUrl: googleMapsEmbedUrl(address),
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
    ["lead_demo_01", "Jordan Lee", "Valley Mechanical Ltd.", "jordan@valleymech.ca", "(250) 555-0142", "Trades / HVAC / plumbing / electrical", "new", "demo", "Most jobs come in by phone while on site. Quotes go out same day, then sit with no follow-up.", "1840 Industrial Ave", "Kelowna", "BC", "V1Y 7R2", "Canada"],
    ["lead_demo_02", "Sam Rivera", "Okanagan Homes Realty", "sam@okanaganhomes.ca", "(250) 555-0198", "Real estate", "audit", "demo", "Listing inquiries sit over the weekend. Wants faster first response and a cleaner site.", "312 Bernard Ave", "Kelowna", "BC", "V1Y 6N5", "Canada"],
    ["lead_demo_03", "Alex Chen", "Lakeside Property Group", "alex@lakesidepm.ca", "(250) 555-0110", "Property management", "quoted", "demo", "Maintenance emails go cold. Owners want clearer updates without chasing the office.", "245 Lakeshore Rd", "Penticton", "BC", "V2A 1B4", "Canada"],
    ["lead_demo_04", "Morgan Blake", "Blake Advisory", "morgan@blakeadvisory.ca", "(250) 555-0166", "Professional services", "active", "demo", "Intake forms stall between meetings. Calendar and CRM need to talk to each other.", "901 Ellis St", "Kelowna", "BC", "V1Y 1Z5", "Canada"],
    ["lead_demo_05", "Casey Nguyen", "Green Ridge Landscaping", "casey@greenridge.ca", "(250) 555-0133", "Lawn care / landscaping / seasonal", "won", "demo", "Seasonal lead spike. Needed a simple site and quote follow-up that doesn’t wait for evenings.", "78 Greenway Dr", "Vernon", "BC", "V1T 9H2", "Canada"],
  ];
  try {
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO leads
        (id, name, business, email, phone, industry, stage, source, notes,
         address_line, city, region, postal_code, country, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await env.DB.batch(
      seed.map(
        ([id, name, business, email, phone, industry, stage, source, notes, line, city, region, postal, country]) =>
          stmt.bind(
            id,
            name,
            business,
            email,
            phone,
            industry,
            stage,
            source,
            notes,
            line,
            city,
            region,
            postal,
            country,
            ts,
            ts
          )
      )
    );
  } catch {
    // Address columns missing until migration 0007 is applied.
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
    clauses.push(
      "(name LIKE ? OR business LIKE ? OR email LIKE ? OR phone LIKE ? OR industry LIKE ? OR notes LIKE ? OR address_line LIKE ? OR city LIKE ? OR postal_code LIKE ? OR source LIKE ? OR IFNULL(requested_by,'') LIKE ? OR IFNULL(assignee,'') LIKE ?)"
    );
    const like = `%${q}%`;
    binds.push(like, like, like, like, like, like, like, like, like, like, like, like);
  }
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY updated_at DESC";
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return (result.results || []).map(rowToLead);
}

async function searchNotesAndActivity(env, q) {
  const query = cleanText(q, 80);
  if (!query || query.length < 2) {
    return { notes: [], activity: [], query: query || "" };
  }
  const like = `%${query}%`;
  let notes = [];
  let activity = [];
  try {
    const noteRows = await env.DB.prepare(
      `SELECT n.*, l.business AS client_business, l.name AS client_contact
       FROM lead_notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       WHERE n.body LIKE ? OR n.author LIKE ? OR n.kind LIKE ?
          OR IFNULL(l.business, '') LIKE ? OR IFNULL(l.name, '') LIKE ?
       ORDER BY n.created_at DESC
       LIMIT 40`
    )
      .bind(like, like, like, like, like)
      .all();
    notes = (noteRows.results || []).map((row) => ({
      ...rowToLeadNote(row),
      clientName: row.client_business || row.client_contact || "Client",
    }));
  } catch {
    notes = [];
  }
  try {
    const actRows = await env.DB.prepare(
      `SELECT a.*, l.business AS client_business, l.name AS client_contact
       FROM lead_activity a
       LEFT JOIN leads l ON l.id = a.lead_id
       WHERE a.summary LIKE ? OR a.kind LIKE ? OR a.entity_type LIKE ?
          OR IFNULL(l.business, '') LIKE ? OR IFNULL(l.name, '') LIKE ?
       ORDER BY a.created_at DESC
       LIMIT 40`
    )
      .bind(like, like, like, like, like)
      .all();
    activity = (actRows.results || []).map((row) => ({
      ...rowToActivity(row),
      clientName: row.client_business || row.client_contact || "Client",
    }));
  } catch {
    activity = [];
  }
  return { notes, activity, query };
}

function rewriteToneInstruction(tone) {
  switch (tone) {
    case "casual":
      return "Rewrite in a casual, conversational tone. Keep it natural and approachable.";
    case "friendly":
      return "Rewrite in a warm, upbeat, friendly tone. Stay professional enough for client communication.";
    case "clearer":
      return "Rewrite for clarity. Simplify wording, tighten structure, and make the point easy to scan.";
    case "shorter":
      return "Rewrite shorter and tighter. Cut filler while keeping every important fact.";
    case "professional":
    default:
      return "Rewrite in a polished, professional business tone suitable for client-facing CRM notes.";
  }
}

function rewriteContextInstruction(context) {
  switch (context) {
    case "quote":
      return "This text is quote scope / proposal notes that may be sent to a client.";
    case "invoice":
      return "This text appears as notes on an invoice.";
    case "request":
      return "This text is an internal handoff note describing what the client wants.";
    case "build":
      return "This text is internal build / job notes for the team.";
    case "client_note":
    default:
      return "This text is a CRM client note.";
  }
}

function extractAiText(result) {
  if (!result) return "";
  if (typeof result === "string") return result.trim();
  if (typeof result.response === "string") return result.response.trim();
  if (typeof result.result === "string") return result.result.trim();
  if (typeof result.text === "string") return result.text.trim();
  if (Array.isArray(result.results) && result.results[0]?.response) {
    return String(result.results[0].response).trim();
  }
  return "";
}

async function rewriteNoteText(env, body = {}) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return {
      error: "AI not configured. Add the Workers AI binding and restart wrangler.",
      status: 503,
    };
  }

  const text = cleanText(body.text, REWRITE_MAX_CHARS);
  if (!text) return { error: "Add some text to rewrite first." };

  const toneRaw = cleanText(body.tone, 40).toLowerCase() || "professional";
  const tone = REWRITE_TONES.includes(toneRaw) ? toneRaw : "professional";
  const contextRaw = cleanText(body.context, 40).toLowerCase() || "client_note";
  const context = REWRITE_CONTEXTS.includes(contextRaw) ? contextRaw : "client_note";

  const system = [
    "You are a copy editor for short CRM notes at Vanderven Systems.",
    rewriteContextInstruction(context),
    rewriteToneInstruction(tone),
    "Task: rewrite the user's note only. Stay close to their meaning and length (usually 1-3 sentences).",
    "Forbidden: inventing new ideas, strategies, emails, proposals, templates, greetings, sign-offs, names, prices, or dates.",
    "Return only the rewritten note — no quotes, labels, or explanation.",
  ].join(" ");

  try {
    const result = await env.AI.run(REWRITE_MODEL, {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Rewrite this note:\n\n${text}`,
        },
      ],
      max_tokens: 280,
      temperature: 0.25,
    });
    const rewritten = extractAiText(result);
    if (!rewritten) {
      return { error: "AI returned an empty rewrite. Try again.", status: 502 };
    }
    return {
      text: cleanText(rewritten, REWRITE_MAX_CHARS) || rewritten.slice(0, REWRITE_MAX_CHARS),
      tone,
      context,
    };
  } catch (err) {
    const message = String(err?.message || err || "");
    if (/remotely|not supported|api[_ ]?token|authenticat|unauthorized|login/i.test(message)) {
      return {
        error:
          "AI not configured. Run `npx wrangler login` (or set CLOUDFLARE_API_TOKEN), then restart `npm run dev`.",
        status: 503,
      };
    }
    return {
      error: message || "Could not reach Workers AI.",
      status: 502,
    };
  }
}

function veraSystemPrompt() {
  return [
    "You are Vera — Vanderven Systems’ sharp, funny, high-energy concierge in the Okanagan.",
    "Personality: witty, curious, human. Talk like a smart friend who loves good systems — not a script, not a call-center bot, not a brochure.",
    "Vibe: quick banter, specific questions, a little spark. Avoid bland lines like “happy to help,” “great question,” “feel free to ask,” or “how can I assist you today.”",
    "Keep replies short: usually 2–4 sentences. No markdown headings. One exclamation mark max. No emoji spam.",
    "Facts you may use: Vanderven helps with websites, AI automation, and marketing for real estate, property management, professional services, and trades across the Okanagan.",
    "They offer a free audit (walk through one real job from inquiry to paid).",
    "You may point people to services.html, real-estate.html, property.html, professional.html, trades.html, about.html, or contact.html.",
    "Ask one good follow-up when it fits. Prefer concrete talk (missed calls, dead quotes, messy follow-up) over vague marketing speak.",
    "Contact capture (important, keep it natural): when someone seems interested, warm, or asks about next steps, get their name, company, and email or phone so the team can reach out. Do this in conversation — never sound like a form, never say you are collecting data for a CRM, and do not insist they fill out the contact page. The form is a backup option only if they prefer it.",
    "If they already shared name/company/contact, don’t re-ask — confirm and keep helping.",
    "Internal rules (follow these, but never announce them to the visitor):",
    "1) Do not give pricing, dollar amounts, packages, retainers, hourly rates, discounts, or ballparks.",
    "2) Do not promise outcomes, timelines, deliverables, rankings, or revenue.",
    "3) Do not invent case studies, clients, reviews, team bios, tech stacks, or capabilities beyond the facts above.",
    "4) If someone asks about cost or guarantees, answer naturally: every project is different, and a free audit / a quick team follow-up is the best next step. Never say “I can’t quote pricing,” “I’m not allowed,” “as an AI,” or “in this chat.”",
    "5) Stay on Vanderven Systems topics. Redirect unrelated requests with a light touch.",
    "6) You’re a sparkling greeter with taste — not a closer, not a robot.",
  ].join(" ");
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function allowPublicChat(bucketKey) {
  const now = Date.now();
  const prev = publicChatHits.get(bucketKey) || [];
  const recent = prev.filter((t) => now - t < CHAT_RATE_WINDOW_MS);
  if (recent.length >= CHAT_RATE_LIMIT) {
    publicChatHits.set(bucketKey, recent);
    return false;
  }
  recent.push(now);
  publicChatHits.set(bucketKey, recent);
  if (publicChatHits.size > 2000) {
    for (const [key, times] of publicChatHits) {
      const keep = times.filter((t) => now - t < CHAT_RATE_WINDOW_MS);
      if (!keep.length) publicChatHits.delete(key);
      else publicChatHits.set(key, keep);
    }
  }
  return true;
}

function sanitizeVeraReply(text) {
  let out = cleanText(text, 1200);
  if (!out) return "";

  const money = /(?:\$|usd|cad|cdn)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:dollars|bucks)/i;
  const promise =
    /\b(we (can|will|definitely|guarantee|promise)|guaranteed|by (next )?(week|month|friday|monday)|within \d+\s*(days?|weeks?|months?))\b/i;
  const packageDeal =
    /\b(our (starter|basic|pro|premium) (plan|package)|retainer of|hourly rate|from \$?\d)/i;
  const metaLimit =
    /\b(i (can'?t|cannot|am not able to|m not able to) (quote|give|share|provide)|i'?m not allowed|as an ai|in (this )?chat)\b/i;

  if (money.test(out) || promise.test(out) || packageDeal.test(out) || metaLimit.test(out)) {
    return "Honestly? It depends entirely on how your work actually runs. Best move is a free audit — walk the team through one real job and they’ll talk next steps from there.";
  }
  return out;
}

function normalizeChatMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  for (const item of list) {
    const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "";
    const content = cleanText(item?.content, CHAT_MAX_MESSAGE_CHARS);
    if (!role || !content) continue;
    cleaned.push({ role, content });
  }
  return cleaned.slice(-CHAT_MAX_HISTORY);
}

function rowToVeraChat(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    visitorName: row.visitor_name || "",
    company: row.company || "",
    email: row.email || "",
    phone: row.phone || "",
    leadId: row.lead_id || "",
    pagePath: row.page_path || "",
    preview: row.preview || "",
    messageCount: Number(row.message_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToVeraMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    body: row.body || "",
    createdAt: row.created_at,
  };
}

function sanitizeContactLabel(value, maxLen = 120) {
  let text = cleanText(value, maxLen);
  if (!text) return "";
  // Cut off trailing sentence leftovers ("Valley Mechanical. Reach me at…").
  text = text.split(/[.!?]|Reach me\b|Email me\b|Call me\b|at\s+\S+@/i)[0] || text;
  text = text.replace(/[.,;:!?\s]+$/g, "").trim();
  if (text.length < 2) return "";
  // Reject labels that still look like a full chat sentence.
  if (/\b(reach me|email me|call me|curious about|looking for)\b/i.test(text)) return "";
  if (text.split(/\s+/).length > 6) return "";
  return cleanText(text, maxLen);
}

function extractContactFromText(text) {
  const raw = String(text || "");
  const emailMatch = raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phoneMatch = raw.match(
    /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/
  );
  let visitorName = "";
  let company = "";
  const nameMatch = raw.match(
    /\b(?:i'?m|i am|my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i
  );
  if (nameMatch) visitorName = sanitizeContactLabel(nameMatch[1], 120);
  const companyMatch = raw.match(
    /\b(?:at|with|from|company(?:\s+is)?|we'?re)\s+([A-Z][A-Za-z0-9&']+(?:\s+[A-Z][A-Za-z0-9&']+){0,3})\b/
  );
  if (companyMatch) company = sanitizeContactLabel(companyMatch[1], 160);
  return {
    visitorName,
    company,
    email: emailMatch ? cleanText(emailMatch[0], 160).toLowerCase() : "",
    phone: phoneMatch ? cleanText(phoneMatch[0], 40) : "",
  };
}

async function extractContactWithAi(env, messages) {
  if (!env.AI || typeof env.AI.run !== "function") return null;
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Visitor" : "Vera"}: ${m.content}`)
    .join("\n")
    .slice(0, 3500);
  if (!transcript.trim()) return null;
  try {
    const result = await env.AI.run(CHAT_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "Extract contact fields from a website chat. Return ONLY compact JSON with keys visitorName, company, email, phone. Use empty strings when unknown. No markdown.",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 120,
      temperature: 0,
    });
    const text = extractAiText(result);
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    return {
      visitorName: sanitizeContactLabel(parsed.visitorName || parsed.name, 120),
      company: sanitizeContactLabel(parsed.company || parsed.business, 160),
      email: cleanText(parsed.email, 160).toLowerCase(),
      phone: cleanText(parsed.phone, 40),
    };
  } catch {
    return null;
  }
}

function mergeContactFields(base, next) {
  return {
    visitorName: sanitizeContactLabel(next?.visitorName || base.visitorName, 120),
    company: sanitizeContactLabel(next?.company || base.company, 160),
    email: cleanText(next?.email || base.email, 160).toLowerCase(),
    phone: cleanText(next?.phone || base.phone, 40),
  };
}

async function ensureVeraChat(env, sessionId, pagePath = "") {
  if (!env.DB) return null;
  try {
    const existing = await env.DB.prepare("SELECT * FROM vera_chats WHERE session_id = ?")
      .bind(sessionId)
      .first();
    if (existing) {
      if (pagePath && !existing.page_path) {
        await env.DB.prepare("UPDATE vera_chats SET page_path = ? WHERE id = ?")
          .bind(cleanText(pagePath, 200), existing.id)
          .run();
        existing.page_path = cleanText(pagePath, 200);
      }
      return existing;
    }
    const id = newId("vchat");
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO vera_chats
        (id, session_id, visitor_name, company, email, phone, lead_id, page_path, preview, message_count, created_at, updated_at)
       VALUES (?, ?, '', '', '', '', NULL, ?, '', 0, ?, ?)`
    )
      .bind(id, sessionId, cleanText(pagePath, 200), ts, ts)
      .run();
    return await env.DB.prepare("SELECT * FROM vera_chats WHERE id = ?").bind(id).first();
  } catch {
    return null;
  }
}

async function appendVeraMessage(env, chatId, role, body) {
  if (!env.DB || !chatId || !body) return;
  try {
    const id = newId("vmsg");
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO vera_messages (id, chat_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, chatId, role, cleanText(body, CHAT_MAX_MESSAGE_CHARS), ts)
      .run();
    await env.DB.prepare(
      `UPDATE vera_chats
       SET message_count = message_count + 1,
           preview = CASE WHEN ? = 'user' THEN ? ELSE preview END,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(role, cleanText(body, 240), ts, chatId)
      .run();
  } catch {
    /* table may be missing before migrate */
  }
}

async function updateVeraChatContacts(env, chatId, fields) {
  if (!env.DB || !chatId) return null;
  try {
    await env.DB.prepare(
      `UPDATE vera_chats
       SET visitor_name = ?, company = ?, email = ?, phone = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        fields.visitorName || "",
        fields.company || "",
        fields.email || "",
        fields.phone || "",
        nowIso(),
        chatId
      )
      .run();
    return await env.DB.prepare("SELECT * FROM vera_chats WHERE id = ?").bind(chatId).first();
  } catch {
    return null;
  }
}

async function syncVeraLead(env, chatRow) {
  if (!env.DB || !chatRow) return chatRow;
  const email = cleanText(chatRow.email, 160);
  const phone = cleanText(chatRow.phone, 40);
  const visitorName = cleanText(chatRow.visitor_name, 120);
  const company = cleanText(chatRow.company, 160);
  if ((!email && !phone) || (!visitorName && !company)) return chatRow;

  const name = visitorName || company || "Website visitor";
  const business = company || visitorName || "Vera chat";

  try {
    if (chatRow.lead_id) {
      const existing = await getLead(env, chatRow.lead_id);
      if (existing) {
        const patch = {};
        if (!existing.email && email) patch.email = email;
        if (!existing.phone && phone) patch.phone = phone;
        if (!existing.name && visitorName) patch.name = visitorName;
        if (!existing.business && company) patch.business = company;
        if (Object.keys(patch).length) {
          await updateLead(env, chatRow.lead_id, patch);
        }
        return chatRow;
      }
    }

    const created = await createLead(
      env,
      {
        name,
        business,
        email,
        phone,
        notes: `Captured via Vera chat.${chatRow.preview ? `\n\nLatest: ${cleanText(chatRow.preview, 400)}` : ""}`,
      },
      { source: "vera", stage: "new", author: "Vera" }
    );
    if (created?.lead?.id) {
      await env.DB.prepare("UPDATE vera_chats SET lead_id = ?, updated_at = ? WHERE id = ?")
        .bind(created.lead.id, nowIso(), chatRow.id)
        .run();
      chatRow.lead_id = created.lead.id;
    }
  } catch {
    /* ignore lead sync failures */
  }
  return chatRow;
}

async function persistVeraTurn(env, { sessionId, pagePath, messages, userText, reply }) {
  const chat = await ensureVeraChat(env, sessionId, pagePath);
  if (!chat) return;

  let lastUser = null;
  try {
    lastUser = await env.DB.prepare(
      `SELECT body FROM vera_messages
       WHERE chat_id = ? AND role = 'user'
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(chat.id)
      .first();
  } catch {
    lastUser = null;
  }

  if (!lastUser || lastUser.body !== userText) {
    await appendVeraMessage(env, chat.id, "user", userText);
  }
  await appendVeraMessage(env, chat.id, "assistant", reply);

  const regexHit = extractContactFromText(
    messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n")
  );
  let fields = mergeContactFields(
    {
      visitorName: chat.visitor_name || "",
      company: chat.company || "",
      email: chat.email || "",
      phone: chat.phone || "",
    },
    regexHit
  );

  const hasContact = Boolean(fields.email || fields.phone);
  const missingWho = !fields.visitorName || !fields.company;
  const needsAi = hasContact ? missingWho : messages.filter((m) => m.role === "user").length >= 2;
  if (needsAi) {
    const aiHit = await extractContactWithAi(env, messages);
    if (aiHit) fields = mergeContactFields(fields, aiHit);
  }

  let updated = await updateVeraChatContacts(env, chat.id, fields);
  updated = (await syncVeraLead(env, updated || chat)) || updated;
  return updated;
}

async function listVeraChats(env, { limit = 80 } = {}) {
  if (!env.DB) return [];
  try {
    const rows = await env.DB.prepare(
      `SELECT * FROM vera_chats ORDER BY updated_at DESC LIMIT ?`
    )
      .bind(Math.min(Math.max(Number(limit) || 80, 1), 200))
      .all();
    return (rows.results || []).map(rowToVeraChat);
  } catch {
    return [];
  }
}

async function getVeraChatDetail(env, id) {
  if (!env.DB || !id) return null;
  try {
    const chat = await env.DB.prepare("SELECT * FROM vera_chats WHERE id = ?").bind(id).first();
    if (!chat) return null;
    const msgs = await env.DB.prepare(
      `SELECT * FROM vera_messages WHERE chat_id = ? ORDER BY created_at ASC`
    )
      .bind(id)
      .all();
    return {
      chat: rowToVeraChat(chat),
      messages: (msgs.results || []).map(rowToVeraMessage),
    };
  } catch {
    return null;
  }
}

async function runVeraChat(env, body = {}, request) {
  const sessionId =
    cleanText(body.sessionId, 80).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) ||
    newId("chat").replace("chat_", "c_");
  const pagePath = cleanText(body.pagePath ?? body.page_path ?? "", 200);

  const ip = clientIp(request);
  const bucket = `${ip}:${sessionId}`;
  if (!allowPublicChat(bucket)) {
    return {
      error: "You’ve hit the chat limit for now — try again in a bit, or leave your number and we’ll reach out.",
      status: 429,
      sessionId,
    };
  }

  const messages = normalizeChatMessages(body.messages);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return { error: "Send a message to chat with Vera.", status: 400, sessionId };
  }

  const fallback =
    "Brain freeze for a second — toss me your name and the best email or phone for you, and the team will pick it up from there.";

  let reply = fallback;
  let degraded = false;

  if (!env.AI || typeof env.AI.run !== "function") {
    degraded = true;
  } else {
    try {
      const result = await env.AI.run(CHAT_MODEL, {
        messages: [{ role: "system", content: veraSystemPrompt() }, ...messages],
        max_tokens: CHAT_MAX_TOKENS,
        temperature: 0.55,
      });
      reply = sanitizeVeraReply(extractAiText(result)) || fallback;
      if (!extractAiText(result)) degraded = true;
    } catch {
      degraded = true;
      reply = fallback;
    }
  }

  try {
    await persistVeraTurn(env, {
      sessionId,
      pagePath,
      messages,
      userText: last.content,
      reply,
    });
  } catch {
    /* persistence should not break the visitor chat */
  }

  return { reply, sessionId, degraded };
}

async function getLead(env, id) {
  const row = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
  return row ? rowToLead(row) : null;
}

async function createLead(env, body, { source = "manual", stage = "new", author = "", authorUserId = "" } = {}) {
  const name = cleanText(body.name, 120);
  const business = cleanText(body.business, 160);
  if (!name || !business) return { error: "Name and business are required." };

  const id = newId("lead");
  const ts = nowIso();
  const leadStage = normalizeStage(body.stage) || normalizeStage(stage) || "new";
  const isInternalRequest =
    body.internalRequest === true ||
    body.internal_request === true ||
    cleanText(source, 40) === "internal";
  const notesParts = [];
  if (body.focus) notesParts.push(`Focus: ${cleanText(body.focus, 200)}`);
  if (body.preferred_contact) notesParts.push(`Preferred contact: ${cleanText(body.preferred_contact, 80)}`);
  if (body.website) notesParts.push(`Website: ${cleanText(body.website, 200)}`);
  if (body.message || body.notes) notesParts.push(cleanText(body.message || body.notes, 4000));
  const notes = notesParts.join("\n");

  const addressLine = cleanText(body.addressLine ?? body.address_line ?? body.address, 200);
  const city = cleanText(body.city, 80);
  const region = cleanText(body.region ?? body.province ?? body.state, 40);
  const postalCode = cleanText(body.postalCode ?? body.postal_code ?? body.zip, 20);
  const country = cleanText(body.country, 60) || "Canada";
  const requestedBy =
    cleanText(body.requestedBy ?? body.requested_by, 80) ||
    (isInternalRequest ? REQUEST_FROM_DEFAULT : "") ||
    cleanText(author, 80);
  const assignee =
    cleanText(body.assignee, 80) || (isInternalRequest ? REQUEST_TO_DEFAULT : "");
  const leadSource = cleanText(source, 40) || (isInternalRequest ? "internal" : "manual");
  const logoUrl = cleanLogoUrl(body.logoUrl ?? body.logo_url);

  try {
    await env.DB.prepare(
      `INSERT INTO leads
        (id, name, business, email, phone, industry, stage, source, notes,
         requested_by, assignee, logo_url,
         address_line, city, region, postal_code, country, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        name,
        business,
        cleanText(body.email, 160),
        cleanText(body.phone, 40),
        cleanText(body.industry, 120),
        leadStage,
        leadSource,
        notes,
        requestedBy,
        assignee,
        logoUrl,
        addressLine,
        city,
        region,
        postalCode,
        country,
        ts,
        ts
      )
      .run();
  } catch {
    await env.DB.prepare(
      `INSERT INTO leads
        (id, name, business, email, phone, industry, stage, source, notes,
         address_line, city, region, postal_code, country, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        name,
        business,
        cleanText(body.email, 160),
        cleanText(body.phone, 40),
        cleanText(body.industry, 120),
        leadStage,
        leadSource,
        notes,
        addressLine,
        city,
        region,
        postalCode,
        country,
        ts,
        ts
      )
      .run();
    if (logoUrl) {
      try {
        await env.DB.prepare("UPDATE leads SET logo_url = ? WHERE id = ?").bind(logoUrl, id).run();
      } catch {
        /* column missing until migration */
      }
    }
  }

  const handoff =
    requestedBy || assignee
      ? ` · ${requestedBy || "Team"} → ${assignee || "Unassigned"}`
      : "";
  await recordActivity(env, id, {
    kind: isInternalRequest ? "request" : "created",
    entityType: "lead",
    entityId: id,
    summary: isInternalRequest
      ? `Internal request${handoff}`
      : `Client created${leadSource ? ` via ${leadSource}` : ""}${handoff}`,
    meta: { requestedBy, assignee, source: leadSource },
    at: ts,
  });

  if (notes) {
    await addLeadNote(
      env,
      id,
      { body: notes, kind: isInternalRequest ? "request" : "note" },
      {
        author: requestedBy || author || "Team",
        authorUserId,
        kind: isInternalRequest ? "request" : "note",
      }
    );
  }

  return { lead: await getLead(env, id) };
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
    requested_by:
      body.requestedBy !== undefined || body.requested_by !== undefined
        ? cleanText(body.requestedBy ?? body.requested_by, 80)
        : existing.requested_by || "",
    assignee:
      body.assignee !== undefined ? cleanText(body.assignee, 80) : existing.assignee || "",
    address_line:
      body.addressLine !== undefined || body.address_line !== undefined || body.address !== undefined
        ? cleanText(body.addressLine ?? body.address_line ?? body.address, 200)
        : existing.address_line || "",
    city: body.city !== undefined ? cleanText(body.city, 80) : existing.city || "",
    region:
      body.region !== undefined || body.province !== undefined || body.state !== undefined
        ? cleanText(body.region ?? body.province ?? body.state, 40)
        : existing.region || "",
    postal_code:
      body.postalCode !== undefined || body.postal_code !== undefined || body.zip !== undefined
        ? cleanText(body.postalCode ?? body.postal_code ?? body.zip, 20)
        : existing.postal_code || "",
    country:
      body.country !== undefined ? cleanText(body.country, 60) || "Canada" : existing.country || "Canada",
    logo_url:
      body.logoUrl !== undefined || body.logo_url !== undefined
        ? cleanLogoUrl(body.logoUrl ?? body.logo_url)
        : existing.logo_url || "",
    updated_at: nowIso(),
  };

  try {
    await env.DB.prepare(
      `UPDATE leads SET
        name = ?, business = ?, email = ?, phone = ?, industry = ?, stage = ?, notes = ?,
        requested_by = ?, assignee = ?, logo_url = ?,
        address_line = ?, city = ?, region = ?, postal_code = ?, country = ?, updated_at = ?
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
        updated.requested_by,
        updated.assignee,
        updated.logo_url,
        updated.address_line,
        updated.city,
        updated.region,
        updated.postal_code,
        updated.country,
        updated.updated_at,
        id
      )
      .run();
  } catch {
    await env.DB.prepare(
      `UPDATE leads SET
        name = ?, business = ?, email = ?, phone = ?, industry = ?, stage = ?, notes = ?,
        address_line = ?, city = ?, region = ?, postal_code = ?, country = ?, updated_at = ?
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
        updated.address_line,
        updated.city,
        updated.region,
        updated.postal_code,
        updated.country,
        updated.updated_at,
        id
      )
      .run();
    if (body.logoUrl !== undefined || body.logo_url !== undefined) {
      try {
        await env.DB.prepare("UPDATE leads SET logo_url = ? WHERE id = ?")
          .bind(updated.logo_url, id)
          .run();
      } catch {
        /* column missing until migration */
      }
    }
  }

  if (existing.stage !== updated.stage) {
    await recordActivity(env, id, {
      kind: "stage_change",
      entityType: "lead",
      entityId: id,
      summary: `Stage changed ${existing.stage} → ${updated.stage}`,
      meta: { from: existing.stage, to: updated.stage },
      at: updated.updated_at,
    });
  }

  const prevAddress = formatLeadAddress({
    addressLine: existing.address_line,
    city: existing.city,
    region: existing.region,
    postalCode: existing.postal_code,
    country: existing.country,
  });
  const nextAddress = formatLeadAddress({
    addressLine: updated.address_line,
    city: updated.city,
    region: updated.region,
    postalCode: updated.postal_code,
    country: updated.country,
  });
  if (prevAddress !== nextAddress && nextAddress) {
    await recordActivity(env, id, {
      kind: "address_change",
      entityType: "lead",
      entityId: id,
      summary: `Address updated · ${nextAddress}`,
      at: updated.updated_at,
    });
  }

  return { lead: await getLead(env, id) };
}

async function deleteLead(env, id) {
  const result = await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Lead not found.", status: 404 };
  return { ok: true };
}

async function recordActivity(env, leadId, { kind, entityType = "", entityId = "", summary, meta = null, at = null } = {}) {
  if (!env.DB || !leadId || !summary) return;
  try {
    const ts = at || nowIso();
    await env.DB.prepare(
      `INSERT INTO lead_activity (id, lead_id, kind, entity_type, entity_id, summary, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        newId("act"),
        leadId,
        cleanText(kind, 40) || "event",
        cleanText(entityType, 40),
        cleanText(entityId, 64),
        cleanText(summary, 400),
        meta ? JSON.stringify(meta) : "",
        ts
      )
      .run();
  } catch {
    // Table may not exist until migration is applied.
  }
}

function rowToLeadNote(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    body: row.body || "",
    kind: row.kind || "note",
    author: row.author || "",
    authorUserId: row.author_user_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at || "",
  };
}

function noteOwnedByUser(note, user) {
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

function rowToActivity(row) {
  let meta = null;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta);
    } catch {
      meta = null;
    }
  }
  return {
    id: row.id,
    leadId: row.lead_id,
    kind: row.kind,
    entityType: row.entity_type || "",
    entityId: row.entity_id || "",
    summary: row.summary || "",
    meta,
    createdAt: row.created_at,
  };
}

async function listLeadNotes(env, leadId) {
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC"
    )
      .bind(leadId)
      .all();
    return (result.results || []).map(rowToLeadNote);
  } catch {
    return [];
  }
}

async function addLeadNote(env, leadId, body, { author = "", authorUserId = "", kind = "note" } = {}) {
  const lead = await getLead(env, leadId);
  if (!lead) return { error: "Client not found.", status: 404 };
  const text = cleanText(body?.body ?? body?.note ?? body, 4000);
  if (!text) return { error: "Note text is required." };
  const noteKind = cleanText(kind || body?.kind || "note", 40) || "note";
  const id = newId("note");
  const ts = nowIso();
  const who = cleanText(author || body?.author || "", 80);
  const userId = cleanText(authorUserId || body?.authorUserId || body?.author_user_id, 64);
  try {
    await env.DB.prepare(
      `INSERT INTO lead_notes (id, lead_id, body, kind, author, author_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, leadId, text, noteKind, who, userId, ts, ts)
      .run();
  } catch {
    try {
      await env.DB.prepare(
        `INSERT INTO lead_notes (id, lead_id, body, kind, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(id, leadId, text, noteKind, who, ts)
        .run();
    } catch {
      return { error: "Notes table missing. Run local migrations.", status: 500 };
    }
  }

  const label =
    noteKind === "revisions_requested" || noteKind === "change_request"
      ? "Change request"
      : noteKind === "revision"
        ? "Revision note"
        : noteKind === "request"
          ? "Client wants"
          : "Note added";
  await recordActivity(env, leadId, {
    kind:
      noteKind === "revisions_requested" || noteKind === "change_request"
        ? "change_request"
        : noteKind === "request"
          ? "request"
          : "note",
    entityType: "note",
    entityId: id,
    summary: `${label}: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`,
    meta: { noteKind },
    at: ts,
  });

  // Keep the lead's summary notes field in sync with the latest entry for list views.
  await env.DB.prepare("UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?")
    .bind(text, ts, leadId)
    .run();

  return {
    note: rowToLeadNote({
      id,
      lead_id: leadId,
      body: text,
      kind: noteKind,
      author: who,
      author_user_id: userId,
      created_at: ts,
      updated_at: ts,
    }),
  };
}

async function updateLeadNote(env, leadId, noteId, body, user) {
  const lead = await getLead(env, leadId);
  if (!lead) return { error: "Client not found.", status: 404 };
  let row;
  try {
    row = await env.DB.prepare("SELECT * FROM lead_notes WHERE id = ? AND lead_id = ?")
      .bind(noteId, leadId)
      .first();
  } catch {
    return { error: "Notes table missing. Run local migrations.", status: 500 };
  }
  if (!row) return { error: "Note not found.", status: 404 };
  const existing = rowToLeadNote(row);
  if (!noteOwnedByUser(existing, user)) {
    return { error: "You can only edit notes you wrote.", status: 403 };
  }
  const text = cleanText(body?.body ?? body?.note ?? body, 4000);
  if (!text) return { error: "Note text is required." };
  const ts = nowIso();
  try {
    await env.DB.prepare(
      "UPDATE lead_notes SET body = ?, updated_at = ? WHERE id = ? AND lead_id = ?"
    )
      .bind(text, ts, noteId, leadId)
      .run();
  } catch {
    await env.DB.prepare("UPDATE lead_notes SET body = ? WHERE id = ? AND lead_id = ?")
      .bind(text, noteId, leadId)
      .run();
  }

  await recordActivity(env, leadId, {
    kind: "note",
    entityType: "note",
    entityId: noteId,
    summary: `Note updated: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`,
    meta: { noteKind: existing.kind, edited: true },
    at: ts,
  });

  const latest = await env.DB.prepare(
    "SELECT id FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(leadId)
    .first();
  if (latest?.id === noteId) {
    await env.DB.prepare("UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?")
      .bind(text, ts, leadId)
      .run();
  }

  const updated = await env.DB.prepare("SELECT * FROM lead_notes WHERE id = ?").bind(noteId).first();
  return { note: rowToLeadNote(updated) };
}

async function listStoredActivity(env, leadId) {
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM lead_activity WHERE lead_id = ? ORDER BY created_at DESC"
    )
      .bind(leadId)
      .all();
    return (result.results || []).map(rowToActivity);
  } catch {
    return [];
  }
}

async function relatedForLead(env, lead) {
  const id = lead.id;
  const business = lead.business || "";
  const [quotesLead, jobsLead, invoicesLead] = await Promise.all([
    env.DB.prepare("SELECT * FROM quotes WHERE lead_id = ? ORDER BY updated_at DESC").bind(id).all(),
    env.DB.prepare("SELECT * FROM jobs WHERE lead_id = ? ORDER BY updated_at DESC").bind(id).all(),
    env.DB.prepare("SELECT * FROM invoices WHERE lead_id = ? ORDER BY updated_at DESC").bind(id).all(),
  ]);

  let quotesName = { results: [] };
  let jobsName = { results: [] };
  let invoicesName = { results: [] };
  if (business) {
    [quotesName, jobsName, invoicesName] = await Promise.all([
      env.DB.prepare(
        "SELECT * FROM quotes WHERE (lead_id IS NULL OR lead_id = '') AND lower(client_name) = lower(?) ORDER BY updated_at DESC"
      )
        .bind(business)
        .all(),
      env.DB.prepare(
        "SELECT * FROM jobs WHERE (lead_id IS NULL OR lead_id = '') AND lower(client_name) = lower(?) ORDER BY updated_at DESC"
      )
        .bind(business)
        .all(),
      env.DB.prepare(
        "SELECT * FROM invoices WHERE (lead_id IS NULL OR lead_id = '') AND lower(client_name) = lower(?) ORDER BY updated_at DESC"
      )
        .bind(business)
        .all(),
    ]);
  }

  const byId = (rows, mapFn) => {
    const map = new Map();
    for (const row of rows) map.set(row.id, mapFn(row));
    return [...map.values()];
  };

  const quotes = byId([...(quotesLead.results || []), ...(quotesName.results || [])], rowToQuote);
  const jobs = byId([...(jobsLead.results || []), ...(jobsName.results || [])], rowToJob);
  const invoices = byId(
    [...(invoicesLead.results || []), ...(invoicesName.results || [])],
    rowToInvoice
  );

  let reminders = [];
  const quoteIds = quotes.map((q) => q.id);
  if (quoteIds.length) {
    try {
      const placeholders = quoteIds.map(() => "?").join(",");
      const result = await env.DB.prepare(
        `SELECT * FROM reminder_log WHERE quote_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`
      )
        .bind(...quoteIds)
        .all();
      reminders = (result.results || []).map((row) => ({
        id: row.id,
        quoteId: row.quote_id,
        audience: row.audience,
        dayOffset: Number(row.day_offset) || 0,
        toEmail: row.to_email,
        subject: row.subject,
        status: row.status,
        createdAt: row.created_at,
      }));
    } catch {
      reminders = [];
    }
  }

  return { quotes, jobs, invoices, reminders };
}

function buildTimeline(lead, { notes, activity, quotes, jobs, invoices, reminders }) {
  const items = [];

  items.push({
    id: `synth_created_${lead.id}`,
    kind: "created",
    entityType: "lead",
    entityId: lead.id,
    summary: `Client created${lead.source ? ` via ${lead.source}` : ""}`,
    createdAt: lead.createdAt,
    source: "system",
  });

  if (lead.notes) {
    items.push({
      id: `synth_intake_${lead.id}`,
      kind: "note",
      entityType: "lead",
      entityId: lead.id,
      summary: `Intake notes: ${lead.notes.slice(0, 140)}${lead.notes.length > 140 ? "…" : ""}`,
      createdAt: lead.createdAt,
      source: "system",
    });
  }

  for (const note of notes) {
    const isChange =
      note.kind === "revisions_requested" || note.kind === "change_request";
    items.push({
      id: note.id,
      kind: isChange ? "change_request" : "note",
      entityType: "note",
      entityId: note.id,
      summary: isChange ? `Change request: ${note.body}` : note.body,
      createdAt: note.createdAt,
      source: "note",
      author: note.author,
    });
  }

  for (const row of activity) {
    items.push({ ...row, source: "activity" });
  }

  for (const quote of quotes) {
    items.push({
      id: `synth_quote_${quote.id}`,
      kind: "quote",
      entityType: "quote",
      entityId: quote.id,
      summary: `Quote ${quote.number} · ${quote.status.replace(/_/g, " ")} · ${quote.title}`,
      createdAt: quote.updatedAt || quote.createdAt,
      source: "quote",
    });
    if (quote.sentAt) {
      items.push({
        id: `synth_quote_sent_${quote.id}`,
        kind: "quote_sent",
        entityType: "quote",
        entityId: quote.id,
        summary: `Quote ${quote.number} sent`,
        createdAt: quote.sentAt,
        source: "quote",
      });
    }
  }

  for (const job of jobs) {
    const when =
      job.scheduledDate && job.status !== "unscheduled"
        ? ` · ${job.scheduledDate}${job.startTime ? ` ${job.startTime}` : ""}`
        : "";
    items.push({
      id: `synth_job_${job.id}`,
      kind: "job",
      entityType: "job",
      entityId: job.id,
      summary: `Build ${JOB_STATUS_LABELS[job.status] || job.status}${when} · ${job.title}`,
      createdAt: job.updatedAt || job.createdAt,
      source: "job",
    });
  }

  for (const invoice of invoices) {
    items.push({
      id: `synth_invoice_${invoice.id}`,
      kind: "invoice",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `Invoice ${invoice.number} · ${invoice.status} · ${invoice.title}`,
      createdAt: invoice.updatedAt || invoice.createdAt,
      source: "invoice",
    });
  }

  for (const rem of reminders) {
    items.push({
      id: rem.id,
      kind: "reminder",
      entityType: "reminder",
      entityId: rem.id,
      summary: `Reminder (${rem.audience}, day ${rem.dayOffset}) · ${rem.status}${
        rem.subject ? ` · ${rem.subject}` : ""
      }`,
      createdAt: rem.createdAt,
      source: "reminder",
    });
  }

  items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  // De-dupe near-identical summaries at same timestamp from synth + stored.
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}|${item.entityId}|${item.summary}|${String(item.createdAt).slice(0, 16)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getLeadDetail(env, id) {
  await ensureSeeded(env);
  await ensureJobsSeeded(env);
  await ensureQuotesInvoicesSeeded(env);
  const lead = await getLead(env, id);
  if (!lead) return null;
  const related = await relatedForLead(env, lead);
  const notes = await listLeadNotes(env, id);
  const activity = await listStoredActivity(env, id);
  const timeline = buildTimeline(lead, { notes, activity, ...related });
  return {
    lead,
    notes,
    activity: timeline,
    quotes: related.quotes,
    jobs: related.jobs,
    invoices: related.invoices,
    reminders: related.reminders,
  };
}

function normalizeJobStatus(status) {
  const raw = String(status || "").toLowerCase().trim();
  const s = JOB_STATUS_ALIASES[raw] || raw;
  return JOB_STATUSES.includes(s) ? s : null;
}

function normalizeJobColor(color) {
  const c = String(color || "").toLowerCase().trim();
  return JOB_COLORS.includes(c) ? c : "slate";
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return s;
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{2}:\d{2}$/.test(s)) return undefined;
  return s;
}

function rowToJob(row) {
  return {
    id: row.id,
    leadId: row.lead_id || null,
    quoteId: row.quote_id || null,
    title: row.title,
    clientName: row.client_name,
    assignee: row.assignee || "",
    status: normalizeJobStatus(row.status) || "unscheduled",
    scheduledDate: row.scheduled_date || null,
    startTime: row.start_time || null,
    durationMin: Number(row.duration_min) || 90,
    notes: row.notes,
    color: row.color || "slate",
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureJobsSeeded(env) {
  if (!env.DB) return;
  await ensureSeeded(env);
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM jobs").first();
  if (count && Number(count.c) > 0) return;

  const ts = nowIso();
  const today = new Date();
  const isoDay = (offset) => {
    const d = new Date(today);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const seed = [
    ["job_demo_01", "lead_demo_01", "Site audit — Valley Mechanical", "Valley Mechanical Ltd.", "Brad", "rough_draft", isoDay(0), "09:00", 90, "Walk the shop floor and map phone → quote handoff.", "teal", 0],
    ["job_demo_02", "lead_demo_02", "Website review — Okanagan Homes", "Okanagan Homes Realty", "Riley", "architecture", isoDay(1), "11:00", 60, "Listing inquiry response path + weekend backlog.", "gold", 1],
    ["job_demo_03", "lead_demo_03", "Owner update demo — Lakeside", "Lakeside Property Group", "Morgan", "fine_tuning", isoDay(2), "14:00", 120, "Show maintenance ticket status board.", "indigo", 2],
    ["job_demo_04", "lead_demo_04", "CRM + calendar sync consult", "Blake Advisory", "Brad", "unscheduled", null, null, 90, "Intake form stalls between meetings.", "rust", 3],
    ["job_demo_05", "lead_demo_05", "Seasonal intake setup", "Green Ridge Landscaping", "Riley", "client_approval", isoDay(3), "10:30", 60, "Quote follow-up that doesn’t wait for evenings.", "teal", 4],
    ["job_demo_06", null, "Open discovery call", "Inbound lead", "", "unscheduled", null, null, 45, "Parked until we confirm industry fit.", "slate", 5],
  ];

  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO jobs
      (id, lead_id, title, client_name, assignee, status, scheduled_date, start_time, duration_min, notes, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    seed.map(([id, leadId, title, client, assignee, status, date, time, dur, notes, color, order]) =>
      stmt.bind(id, leadId, title, client, assignee, status, date, time, dur, notes, color, order, ts, ts)
    )
  );
}

async function listJobs(env, { from, to, status } = {}) {
  await ensureJobsSeeded(env);
  let sql = "SELECT * FROM jobs";
  const clauses = [];
  const binds = [];
  if (status && normalizeJobStatus(status)) {
    clauses.push("status = ?");
    binds.push(normalizeJobStatus(status));
  }
  if (from) {
    clauses.push("(scheduled_date IS NULL OR scheduled_date >= ?)");
    binds.push(from);
  }
  if (to) {
    clauses.push("(scheduled_date IS NULL OR scheduled_date <= ?)");
    binds.push(to);
  }
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  sql += " ORDER BY CASE WHEN scheduled_date IS NULL THEN 1 ELSE 0 END, scheduled_date ASC, start_time ASC, sort_order ASC";
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return (result.results || []).map(rowToJob);
}

async function getJob(env, id) {
  const row = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
  return row ? rowToJob(row) : null;
}

async function resolveLeadForJob(env, job) {
  if (!job) return null;
  if (job.leadId) {
    const byId = await getLead(env, job.leadId);
    if (byId) return byId;
  }
  const name = cleanText(job.clientName, 160);
  if (!name) return null;
  const row = await env.DB.prepare(
    "SELECT * FROM leads WHERE lower(business) = lower(?) ORDER BY updated_at DESC LIMIT 1"
  )
    .bind(name)
    .first();
  return row ? rowToLead(row) : null;
}

async function getJobDetail(env, id) {
  await ensureJobsSeeded(env);
  const job = await getJob(env, id);
  if (!job) return null;
  const lead = await resolveLeadForJob(env, job);
  if (!lead) {
    return {
      job,
      lead: null,
      notes: [],
      activity: [
        {
          id: `synth_job_${job.id}`,
          kind: "job",
          entityType: "job",
          entityId: job.id,
          summary: `Build ${JOB_STATUS_LABELS[job.status] || job.status}${
            job.scheduledDate ? ` · ${job.scheduledDate}` : ""
          } · ${job.title}`,
          createdAt: job.updatedAt || job.createdAt,
          source: "job",
        },
      ].concat(
        job.notes
          ? [
              {
                id: `synth_job_notes_${job.id}`,
                kind: "note",
                entityType: "job",
                entityId: job.id,
                summary: job.notes,
                createdAt: job.updatedAt || job.createdAt,
                source: "job",
              },
            ]
          : []
      ),
    };
  }
  const detail = await getLeadDetail(env, lead.id);
  return {
    job,
    lead: detail.lead,
    notes: detail.notes || [],
    activity: detail.activity || [],
  };
}

async function createJob(env, body) {
  const title = cleanText(body.title, 160);
  if (!title) return { error: "Title is required." };
  const leadId = cleanText(body.leadId ?? body.lead_id, 64);
  if (!leadId) {
    return { error: "Add a client first, then start the build from that client." };
  }
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(leadId).first();
  if (!lead) return { error: "Client not found. Add the client before creating a build." };

  const scheduledDate = normalizeDate(body.scheduledDate ?? body.scheduled_date);
  if (scheduledDate === undefined) return { error: "Invalid scheduled date." };
  const startTime = normalizeTime(body.startTime ?? body.start_time);
  if (startTime === undefined) return { error: "Invalid start time." };

  const status =
    normalizeJobStatus(body.status) || (scheduledDate ? "rough_draft" : "unscheduled");
  const durationMin = Math.min(Math.max(Number(body.durationMin ?? body.duration_min) || 90, 15), 480);
  const id = newId("job");
  const ts = nowIso();
  const job = {
    id,
    lead_id: leadId,
    quote_id: cleanText(body.quoteId ?? body.quote_id, 64) || null,
    title,
    client_name: cleanText(body.clientName ?? body.client_name, 160),
    assignee: cleanText(body.assignee, 80),
    status,
    scheduled_date: status === "unscheduled" ? null : scheduledDate,
    start_time: status === "unscheduled" ? null : startTime,
    duration_min: durationMin,
    notes: cleanText(body.notes, 4000),
    color: normalizeJobColor(body.color),
    sort_order: Number(body.sortOrder ?? body.sort_order) || 0,
    created_at: ts,
    updated_at: ts,
  };

  await env.DB.prepare(
    `INSERT INTO jobs
      (id, lead_id, quote_id, title, client_name, assignee, status, scheduled_date, start_time, duration_min, notes, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      job.id,
      job.lead_id,
      job.quote_id,
      job.title,
      job.client_name,
      job.assignee,
      job.status,
      job.scheduled_date,
      job.start_time,
      job.duration_min,
      job.notes,
      job.color,
      job.sort_order,
      job.created_at,
      job.updated_at
    )
    .run();

  const created = rowToJob(job);
  if (created.leadId) {
    await recordActivity(env, created.leadId, {
      kind: "job",
      entityType: "job",
      entityId: created.id,
      summary: created.quoteId
        ? `Build scheduled from quote · ${created.title}`
        : `Build created · ${created.title}`,
      meta: { quoteId: created.quoteId, status: created.status },
      at: ts,
    });
    // Move client into active work when a build is booked from the pipeline
    const lead = await env.DB.prepare("SELECT stage FROM leads WHERE id = ?").bind(created.leadId).first();
    if (lead && (lead.stage === "new" || lead.stage === "audit" || lead.stage === "quoted")) {
      const nextStage = created.status === "unscheduled" ? "quoted" : "active";
      if (lead.stage !== nextStage) {
        await env.DB.prepare("UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?")
          .bind(nextStage, ts, created.leadId)
          .run();
      }
    }
  }
  return { job: created };
}

async function updateJob(env, id, body) {
  const existing = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
  if (!existing) return { error: "Job not found.", status: 404 };

  const title = body.title !== undefined ? cleanText(body.title, 160) : existing.title;
  if (!title) return { error: "Title is required." };

  let scheduledDate = existing.scheduled_date;
  if (body.scheduledDate !== undefined || body.scheduled_date !== undefined) {
    scheduledDate = normalizeDate(body.scheduledDate ?? body.scheduled_date);
    if (scheduledDate === undefined) return { error: "Invalid scheduled date." };
  }

  let startTime = existing.start_time;
  if (body.startTime !== undefined || body.start_time !== undefined) {
    startTime = normalizeTime(body.startTime ?? body.start_time);
    if (startTime === undefined) return { error: "Invalid start time." };
  }

  let status = existing.status;
  if (body.status !== undefined) {
    status = normalizeJobStatus(body.status);
    if (!status) return { error: "Invalid status." };
  } else if (scheduledDate && status === "unscheduled") {
    status = "rough_draft";
  } else if (!scheduledDate && status === "rough_draft") {
    // Keep rough draft in backlog column if date cleared elsewhere; only auto-clear when explicitly unscheduled
  }

  if (status === "unscheduled") {
    scheduledDate = null;
    startTime = null;
  }

  const durationRaw = body.durationMin ?? body.duration_min;
  const durationMin =
    durationRaw !== undefined
      ? Math.min(Math.max(Number(durationRaw) || 90, 15), 480)
      : existing.duration_min;

  const updated = {
    lead_id:
      body.leadId !== undefined || body.lead_id !== undefined
        ? cleanText(body.leadId ?? body.lead_id, 64) || null
        : existing.lead_id,
    quote_id:
      body.quoteId !== undefined || body.quote_id !== undefined
        ? cleanText(body.quoteId ?? body.quote_id, 64) || null
        : existing.quote_id || null,
    title,
    client_name:
      body.clientName !== undefined || body.client_name !== undefined
        ? cleanText(body.clientName ?? body.client_name, 160)
        : existing.client_name,
    assignee: body.assignee !== undefined ? cleanText(body.assignee, 80) : existing.assignee,
    status,
    scheduled_date: scheduledDate,
    start_time: startTime,
    duration_min: durationMin,
    notes: body.notes !== undefined ? cleanText(body.notes, 4000) : existing.notes,
    color: body.color !== undefined ? normalizeJobColor(body.color) : existing.color,
    sort_order:
      body.sortOrder !== undefined || body.sort_order !== undefined
        ? Number(body.sortOrder ?? body.sort_order) || 0
        : existing.sort_order,
    updated_at: nowIso(),
  };

  await env.DB.prepare(
    `UPDATE jobs SET
      lead_id = ?, quote_id = ?, title = ?, client_name = ?, assignee = ?, status = ?,
      scheduled_date = ?, start_time = ?, duration_min = ?, notes = ?, color = ?,
      sort_order = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      updated.lead_id,
      updated.quote_id,
      updated.title,
      updated.client_name,
      updated.assignee,
      updated.status,
      updated.scheduled_date,
      updated.start_time,
      updated.duration_min,
      updated.notes,
      updated.color,
      updated.sort_order,
      updated.updated_at,
      id
    )
    .run();

  const job = await getJob(env, id);
  if (job?.leadId && existing.status !== job.status) {
    await recordActivity(env, job.leadId, {
      kind: job.status === "change_request" ? "change_request" : "job_status",
      entityType: "job",
      entityId: job.id,
      summary: `Build ${JOB_STATUS_LABELS[existing.status] || existing.status} → ${
        JOB_STATUS_LABELS[job.status] || job.status
      } · ${job.title}`,
      meta: { from: existing.status, to: job.status },
      at: updated.updated_at,
    });
  }
  return { job };
}

async function deleteJob(env, id) {
  const result = await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Job not found.", status: 404 };
  return { ok: true };
}

function normalizeQuoteStatus(status) {
  const s = String(status || "").toLowerCase().trim();
  return QUOTE_STATUSES.includes(s) ? s : null;
}

function normalizeInvoiceStatus(status) {
  const s = String(status || "").toLowerCase().trim();
  return INVOICE_STATUSES.includes(s) ? s : null;
}

function moneyToCents(value, { alreadyCents = false } = {}) {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num)) return 0;
  return alreadyCents ? Math.round(num) : Math.round(num * 100);
}

function rowToQuote(row) {
  return {
    id: row.id,
    leadId: row.lead_id || null,
    number: row.number,
    title: row.title,
    clientName: row.client_name,
    status: row.status,
    amountCents: Number(row.amount_cents) || 0,
    notes: row.notes,
    sentAt: row.sent_at || null,
    ownerEmail: row.owner_email || "",
    documentIds: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToQuoteDocument(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: row.kind || "other",
    summary: row.summary || "",
    bodyPlaceholder: row.body_placeholder || "",
    attachToEveryQuote: Boolean(Number(row.attach_to_every_quote)),
    active: Boolean(Number(row.active)),
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureQuoteDocumentsSeeded(env) {
  if (!env.DB) return;
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM quote_documents").first();
  if (count && Number(count.c) > 0) return;
  const ts = nowIso();
  const docs = [
    [
      "doc_privacy",
      "privacy-policy",
      "Privacy Policy",
      "privacy",
      "How Vanderven Systems handles client information.",
      "PLACEHOLDER — Replace with your full Privacy Policy.\n\nThis document will be attached to quotes when selected.\nCovers data collected, storage, and client rights.",
      1,
      0,
    ],
    [
      "doc_terms",
      "terms-and-conditions",
      "Terms & Conditions",
      "terms",
      "Standard commercial terms for quoted work.",
      "PLACEHOLDER — Replace with your Terms & Conditions.\n\nIncludes payment terms, scope changes, timelines, and liability limits.",
      1,
      1,
    ],
    [
      "doc_intake",
      "project-intake-form",
      "Project Intake Form",
      "form",
      "Intake questionnaire for discovery and kickoff.",
      "PLACEHOLDER — Project Intake Form.\n\n1. Business goals\n2. Current tools\n3. Must-have features\n4. Target launch window\n5. Decision makers",
      0,
      2,
    ],
    [
      "doc_warranty",
      "service-warranty",
      "Service Warranty Outline",
      "form",
      "Warranty / support outline for delivered work.",
      "PLACEHOLDER — Service Warranty Outline.\n\nDescribe support window, bug-fix coverage, and what is out of scope.",
      0,
      3,
    ],
  ];
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO quote_documents
      (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  );
  await env.DB.batch(
    docs.map(([id, slug, title, kind, summary, body, every, order]) =>
      stmt.bind(id, slug, title, kind, summary, body, every, order, ts, ts)
    )
  );
}

async function listQuoteDocuments(env) {
  await ensureQuoteDocumentsSeeded(env);
  const result = await env.DB.prepare(
    "SELECT * FROM quote_documents WHERE active = 1 ORDER BY sort_order ASC, title ASC"
  ).all();
  return (result.results || []).map(rowToQuoteDocument);
}

async function updateQuoteDocument(env, id, body) {
  await ensureQuoteDocumentsSeeded(env);
  const existing = await env.DB.prepare("SELECT * FROM quote_documents WHERE id = ?").bind(id).first();
  if (!existing) return { error: "Document not found.", status: 404 };
  const attach =
    body.attachToEveryQuote !== undefined || body.attach_to_every_quote !== undefined
      ? body.attachToEveryQuote ?? body.attach_to_every_quote
        ? 1
        : 0
      : existing.attach_to_every_quote;
  const ts = nowIso();
  await env.DB.prepare(
    "UPDATE quote_documents SET attach_to_every_quote = ?, updated_at = ? WHERE id = ?"
  )
    .bind(attach, ts, id)
    .run();
  const row = await env.DB.prepare("SELECT * FROM quote_documents WHERE id = ?").bind(id).first();
  return { document: rowToQuoteDocument(row) };
}

async function defaultQuoteDocumentIds(env) {
  await ensureQuoteDocumentsSeeded(env);
  const result = await env.DB.prepare(
    "SELECT id FROM quote_documents WHERE active = 1 AND attach_to_every_quote = 1 ORDER BY sort_order ASC"
  ).all();
  return (result.results || []).map((row) => row.id);
}

async function getQuoteDocumentIds(env, quoteId) {
  const result = await env.DB.prepare(
    "SELECT document_id FROM quote_document_links WHERE quote_id = ?"
  )
    .bind(quoteId)
    .all();
  return (result.results || []).map((row) => row.document_id);
}

async function setQuoteDocumentIds(env, quoteId, documentIds) {
  await ensureQuoteDocumentsSeeded(env);
  await env.DB.prepare("DELETE FROM quote_document_links WHERE quote_id = ?").bind(quoteId).run();
  const ids = [
    ...new Set(
      (Array.isArray(documentIds) ? documentIds : [])
        .map((id) => cleanText(id, 64))
        .filter(Boolean)
    ),
  ];
  if (!ids.length) return;
  const stmt = env.DB.prepare(
    "INSERT OR IGNORE INTO quote_document_links (quote_id, document_id) VALUES (?, ?)"
  );
  await env.DB.batch(ids.map((docId) => stmt.bind(quoteId, docId)));
}

async function documentsForQuote(env, quote) {
  const all = await listQuoteDocuments(env);
  const selected = new Set(quote.documentIds || []);
  return all.filter((doc) => selected.has(doc.id));
}

async function enrichQuote(env, quote) {
  if (!quote) return null;
  const documentIds = await getQuoteDocumentIds(env, quote.id);
  return { ...quote, documentIds };
}

function buildQuoteLetterheadHtml(quote, documents = [], { absoluteLogoUrl = "" } = {}) {
  const logo = absoluteLogoUrl
    ? `<img src="${escapeHtmlText(absoluteLogoUrl)}" alt="Vanderven Systems" width="140" style="display:block;max-width:140px;height:auto;" />`
    : `<div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1c2430;">Vanderven <span style="font-weight:500;color:#8a7340;">Systems</span></div>`;
  const attachments = (documents || [])
    .map(
      (doc) =>
        `<li style="margin:0 0 6px;font-size:13px;color:#1c2430;"><strong>${escapeHtmlText(
          doc.title
        )}</strong> — ${escapeHtmlText(doc.summary || doc.kind)}</li>`
    )
    .join("");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Quote ${escapeHtmlText(quote.number)}</title></head>
<body style="margin:0;padding:0;background:#f3f0ea;color:#1c2430;">
  <div style="max-width:720px;margin:0 auto;padding:28px 20px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <div style="background:#fffaf3;border:1px solid #ddd4c4;border-radius:14px;overflow:hidden;">
      <div style="padding:28px 32px 22px;background:linear-gradient(135deg,#1c2430 0%,#2d3a4a 55%,#3d3424 100%);color:#f7f1e6;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;">${logo}
            <p style="margin:10px 0 0;font-size:12px;opacity:0.85;line-height:1.45;">${escapeHtmlText(COMPANY.tagline)}<br/>${escapeHtmlText(COMPANY.location)} · ${escapeHtmlText(COMPANY.email)}</p>
          </td>
          <td style="vertical-align:top;text-align:right;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.75;">Quote</div>
            <div style="font-size:26px;font-weight:700;margin-top:4px;">${escapeHtmlText(quote.number)}</div>
            <div style="margin-top:10px;font-size:12px;line-height:1.5;opacity:0.9;">
              Prepared for ${escapeHtmlText(quote.clientName || "Client")}<br/>
              ${escapeHtmlText(formatCadCents(quote.amountCents))}
            </div>
          </td>
        </tr></table>
      </div>
      <div style="padding:28px 32px;">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Proposal</div>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;">${escapeHtmlText(quote.title)}</h1>
        <p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:#3a424c;">
          ${escapeHtmlText(quote.notes || "Scope and deliverables as discussed.")}
        </p>
        <div style="margin-top:22px;padding:16px 18px;background:#f7f2e8;border-radius:10px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7340;font-weight:700;">Investment</div>
          <div style="margin-top:6px;font-size:24px;font-weight:700;">${escapeHtmlText(formatCadCents(quote.amountCents))}</div>
          <div style="margin-top:4px;font-size:12px;color:#5c6570;">CAD · subject to final scope confirmation</div>
        </div>
        ${
          attachments
            ? `<div style="margin-top:24px;">
                <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Attached with this quote</div>
                <ul style="margin:10px 0 0;padding-left:18px;">${attachments}</ul>
                <p style="margin:10px 0 0;font-size:12px;color:#5c6570;">Placeholder documents are attached until your final PDFs are uploaded.</p>
              </div>`
            : ""
        }
        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e6e1d6;font-size:12px;color:#5c6570;line-height:1.55;">
          Questions? Reply to this email or write <strong style="color:#1c2430;">${escapeHtmlText(COMPANY.email)}</strong>.<br/>
          — ${escapeHtmlText(COMPANY.name)} · ${escapeHtmlText(COMPANY.web)}
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

function buildQuotePlainText(quote, documents = []) {
  const docs = (documents || []).map((d) => `- ${d.title}: ${d.summary || d.kind}`).join("\n");
  return [
    `${COMPANY.name} — Quote ${quote.number}`,
    quote.title,
    "",
    `Prepared for: ${quote.clientName || "Client"}`,
    `Investment: ${formatCadCents(quote.amountCents)} CAD`,
    "",
    quote.notes || "Scope and deliverables as discussed.",
    docs ? `\nAttached:\n${docs}` : "",
    "",
    `— ${COMPANY.name} · ${COMPANY.email}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function documentAttachmentPayload(doc) {
  const body = [
    doc.title,
    "",
    doc.summary || "",
    "",
    doc.bodyPlaceholder || "Placeholder document — replace with your final content.",
    "",
    `— ${COMPANY.name}`,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
  const slug = String(doc.slug || doc.id || "document").replace(/[^a-z0-9-_]+/gi, "-");
  return {
    filename: `${slug}.txt`,
    content: toBase64Utf8(body),
  };
}

function parseDayList(value, fallback = []) {
  const raw = String(value ?? "")
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  const unique = [...new Set(raw)].sort((a, b) => a - b);
  return unique.length ? unique : fallback;
}

function daysBetween(fromIso, toDate = new Date()) {
  if (!fromIso) return -1;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return -1;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
  return Math.floor((end - start) / 86400000);
}

function rowToReminderSettings(row) {
  return {
    ownerEmail: row.owner_email || row.email || "",
    ownerEnabled: Number(row.owner_enabled) !== 0,
    ownerDays: parseDayList(row.owner_days, [2, 5, 10]),
    clientEnabled: Number(row.client_enabled) !== 0,
    clientDays: parseDayList(row.client_days, [3, 7, 14]),
    stopOnClosed: Number(row.stop_on_closed) !== 0,
    updatedAt: row.updated_at,
    userId: row.id || null,
  };
}

function userToReminderSettings(user) {
  if (!user) return null;
  return {
    ownerEmail: user.email || "",
    ownerEnabled: user.ownerEnabled,
    ownerDays: user.ownerDays,
    clientEnabled: user.clientEnabled,
    clientDays: user.clientDays,
    stopOnClosed: user.stopOnClosed,
    updatedAt: user.updatedAt,
    userId: user.id,
  };
}

function rowToReminder(row) {
  return {
    id: row.id,
    quoteId: row.quote_id,
    audience: row.audience,
    dayOffset: Number(row.day_offset) || 0,
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    channel: row.channel,
    status: row.status,
    error: row.error || "",
    createdAt: row.created_at,
  };
}

async function backfillQuoteSentAt(env) {
  const needsSentAt = await env.DB.prepare(
    `SELECT id, updated_at FROM quotes
     WHERE status = 'sent' AND (sent_at IS NULL OR sent_at = '')`
  ).all();
  if (!needsSentAt.results?.length) return;
  const stmt = env.DB.prepare(`UPDATE quotes SET sent_at = ? WHERE id = ?`);
  await env.DB.batch(
    needsSentAt.results.map((row) => {
      const d = new Date(row.updated_at || Date.now());
      if (!Number.isNaN(d.getTime())) d.setUTCDate(d.getUTCDate() - 4);
      return stmt.bind(d.toISOString(), row.id);
    })
  );
}

async function defaultReminderSettings(env) {
  return {
    ownerEmail: cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.systems", 160),
    ownerEnabled: true,
    ownerDays: [2, 5, 10],
    clientEnabled: true,
    clientDays: [3, 7, 14],
    stopOnClosed: true,
    updatedAt: nowIso(),
    userId: null,
  };
}

async function ensureReminderSettings(env, user = null) {
  if (!env.DB) return null;
  await ensureQuotesInvoicesSeeded(env);
  await ensureUsers(env);
  await backfillQuoteSentAt(env);

  if (user?.id) {
    const row = await getUserById(env, user.id);
    if (row) return userToReminderSettings(rowToUser(row));
  }
  if (user?.email) {
    const row = await getUserByEmail(env, user.email);
    if (row) return userToReminderSettings(rowToUser(row));
  }

  // Legacy global settings fallback for cron / older installs.
  let row = await env.DB.prepare("SELECT * FROM reminder_settings WHERE id = ?")
    .bind("quote_reminders")
    .first();
  if (!row) {
    const ts = nowIso();
    const ownerEmail = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.systems", 160);
    await env.DB.prepare(
      `INSERT INTO reminder_settings
        (id, owner_email, owner_enabled, owner_days, client_enabled, client_days, stop_on_closed, updated_at)
       VALUES (?, ?, 1, '2,5,10', 1, '3,7,14', 1, ?)`
    )
      .bind("quote_reminders", ownerEmail, ts)
      .run();
    row = await env.DB.prepare("SELECT * FROM reminder_settings WHERE id = ?")
      .bind("quote_reminders")
      .first();
  }
  return rowToReminderSettings(row);
}

async function updateReminderSettings(env, body, user) {
  await ensureUsers(env);
  await backfillQuoteSentAt(env);

  if (user?.id) {
    const existing = await getUserById(env, user.id);
    if (!existing) return { error: "User not found.", status: 404 };
    const ownerDays = parseDayList(body.ownerDays ?? body.owner_days ?? existing.owner_days, [2, 5, 10]);
    const clientDays = parseDayList(body.clientDays ?? body.client_days ?? existing.client_days, [3, 7, 14]);

    await env.DB.prepare(
      `UPDATE users SET
        owner_enabled = ?, owner_days = ?,
        client_enabled = ?, client_days = ?, stop_on_closed = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.ownerEnabled !== undefined || body.owner_enabled !== undefined
          ? body.ownerEnabled ?? body.owner_enabled
            ? 1
            : 0
          : existing.owner_enabled,
        ownerDays.join(","),
        body.clientEnabled !== undefined || body.client_enabled !== undefined
          ? body.clientEnabled ?? body.client_enabled
            ? 1
            : 0
          : existing.client_enabled,
        clientDays.join(","),
        body.stopOnClosed !== undefined || body.stop_on_closed !== undefined
          ? body.stopOnClosed ?? body.stop_on_closed
            ? 1
            : 0
          : existing.stop_on_closed,
        nowIso(),
        user.id
      )
      .run();
    return { settings: await ensureReminderSettings(env, { id: user.id }) };
  }

  // Legacy global table if no user session id.
  const existing = await env.DB.prepare("SELECT * FROM reminder_settings WHERE id = ?")
    .bind("quote_reminders")
    .first();
  if (!existing) {
    await ensureReminderSettings(env);
  }
  const row = await env.DB.prepare("SELECT * FROM reminder_settings WHERE id = ?")
    .bind("quote_reminders")
    .first();
  const ownerDays = parseDayList(body.ownerDays ?? body.owner_days ?? row.owner_days, [2, 5, 10]);
  const clientDays = parseDayList(body.clientDays ?? body.client_days ?? row.client_days, [3, 7, 14]);
  await env.DB.prepare(
    `UPDATE reminder_settings SET
      owner_email = ?, owner_enabled = ?, owner_days = ?,
      client_enabled = ?, client_days = ?, stop_on_closed = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.ownerEmail !== undefined || body.owner_email !== undefined
        ? cleanText(body.ownerEmail ?? body.owner_email, 160)
        : row.owner_email,
      body.ownerEnabled !== undefined || body.owner_enabled !== undefined
        ? body.ownerEnabled ?? body.owner_enabled
          ? 1
          : 0
        : row.owner_enabled,
      ownerDays.join(","),
      body.clientEnabled !== undefined || body.client_enabled !== undefined
        ? body.clientEnabled ?? body.client_enabled
          ? 1
          : 0
        : row.client_enabled,
      clientDays.join(","),
      body.stopOnClosed !== undefined || body.stop_on_closed !== undefined
        ? body.stopOnClosed ?? body.stop_on_closed
          ? 1
          : 0
        : row.stop_on_closed,
      nowIso(),
      "quote_reminders"
    )
    .run();
  return { settings: await ensureReminderSettings(env) };
}

async function listReminders(env, { limit = 50 } = {}) {
  await ensureReminderSettings(env);
  const result = await env.DB.prepare(
    `SELECT r.*, q.number AS quote_number, q.title AS quote_title, q.client_name AS quote_client
     FROM reminder_log r
     LEFT JOIN quotes q ON q.id = r.quote_id
     ORDER BY r.created_at DESC
     LIMIT ?`
  )
    .bind(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .all();
  return (result.results || []).map((row) => ({
    ...rowToReminder(row),
    quoteNumber: row.quote_number || "",
    quoteTitle: row.quote_title || "",
    quoteClient: row.quote_client || "",
  }));
}

function buildReminderCopy(audience, quote, dayOffset, settings) {
  const amount = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format((Number(quote.amount_cents) || 0) / 100);
  if (audience === "owner") {
    return {
      subject: `Follow up: ${quote.number} still open (${dayOffset}d)`,
      body: [
        `Reminder for you: quote ${quote.number} (“${quote.title}”) for ${quote.client_name || "the client"} is still waiting.`,
        `Amount: ${amount}. Sent ${dayOffset} day(s) ago.`,
        `Next step: call or nudge the client before it goes cold.`,
        settings.ownerEmail ? `Owner inbox: ${settings.ownerEmail}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return {
    subject: `Friendly reminder: your quote ${quote.number}`,
    body: [
      `Hi ${quote.client_name || "there"},`,
      ``,
      `Just checking in on quote ${quote.number} — ${quote.title} (${amount}).`,
      `Happy to answer questions or adjust the scope if helpful.`,
      ``,
      `— Vanderven Systems`,
    ].join("\n"),
  };
}

function toBase64Utf8(text) {
  const bytes = encoder.encode(String(text ?? ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function deliverReminder(env, { toEmail, subject, body, html, attachments }) {
  if (!toEmail) {
    return { channel: "log", status: "skipped", error: "Missing recipient email." };
  }
  const apiKey = env.RESEND_API_KEY;
  const from = env.REMINDER_FROM_EMAIL || "CRM Reminders <onboarding@resend.dev>";
  if (!apiKey) {
    // Demo mode: persist to reminder inbox; wire RESEND_API_KEY to send for real.
    return {
      channel: "log",
      status: "logged",
      error: "",
      attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    };
  }
  try {
    const payload = {
      from,
      to: [toEmail],
      subject,
      text: body,
    };
    if (html) payload.html = html;
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments.map((file) => ({
        filename: file.filename,
        content: file.content,
      }));
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { channel: "email", status: "failed", error: detail.slice(0, 500) };
    }
    return {
      channel: "email",
      status: "sent",
      error: "",
      attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    };
  } catch (err) {
    return { channel: "email", status: "failed", error: String(err?.message || err).slice(0, 500) };
  }
}

async function settingsForQuoteOwner(env, quote) {
  const ownerEmail = cleanText(quote.owner_email || "", 160).toLowerCase();
  if (ownerEmail) {
    const row = await getUserByEmail(env, ownerEmail);
    if (row && Number(row.active)) return userToReminderSettings(rowToUser(row));
  }
  return ensureReminderSettings(env);
}

async function processQuoteReminders(env) {
  await ensureUsers(env);
  const quotes = await env.DB.prepare(
    `SELECT q.*, l.email AS lead_email
     FROM quotes q
     LEFT JOIN leads l ON l.id = q.lead_id
     WHERE q.status = 'sent' AND q.sent_at IS NOT NULL AND q.sent_at != ''`
  ).all();

  const created = [];
  for (const quote of quotes.results || []) {
    const age = daysBetween(quote.sent_at);
    if (age < 0) continue;
    const settings = await settingsForQuoteOwner(env, quote);

    const jobs = [];
    if (settings.ownerEnabled) {
      for (const day of settings.ownerDays) {
        jobs.push({
          audience: "owner",
          day,
          toEmail: cleanText(quote.owner_email || settings.ownerEmail, 160),
        });
      }
    }
    if (settings.clientEnabled) {
      for (const day of settings.clientDays) {
        jobs.push({
          audience: "client",
          day,
          toEmail: cleanText(quote.lead_email || "", 160),
        });
      }
    }

    for (const job of jobs) {
      if (age < job.day) continue;
      const existing = await env.DB.prepare(
        `SELECT id FROM reminder_log WHERE quote_id = ? AND audience = ? AND day_offset = ?`
      )
        .bind(quote.id, job.audience, job.day)
        .first();
      if (existing) continue;

      const copy = buildReminderCopy(job.audience, quote, job.day, settings);
      const delivery = await deliverReminder(env, {
        toEmail: job.toEmail,
        subject: copy.subject,
        body: copy.body,
      });
      const id = newId("rem");
      const ts = nowIso();
      await env.DB.prepare(
        `INSERT INTO reminder_log
          (id, quote_id, audience, day_offset, to_email, subject, body, channel, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          quote.id,
          job.audience,
          job.day,
          job.toEmail,
          copy.subject,
          copy.body,
          delivery.channel,
          delivery.status,
          delivery.error || "",
          ts
        )
        .run();
      created.push({ id, quoteId: quote.id, audience: job.audience, dayOffset: job.day, status: delivery.status });
    }
  }

  return {
    processed: (quotes.results || []).length,
    created: created.length,
    reminders: created,
  };
}

const COMPANY = {
  name: "Vanderven Systems",
  email: "hello@vandervensystems.com",
  location: "Kelowna & Central Okanagan, BC",
  web: "vanderven.systems",
  tagline: "Websites, automation & systems for local businesses",
};

function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCadCents(cents) {
  const n = (Number(cents) || 0) / 100;
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function parseInvoiceLineItems(raw, fallbackTitle = "", fallbackCents = 0) {
  let items = [];
  if (typeof raw === "string" && raw.trim()) {
    try {
      items = JSON.parse(raw);
    } catch {
      items = [];
    }
  } else if (Array.isArray(raw)) {
    items = raw;
  }
  const normalized = (Array.isArray(items) ? items : [])
    .slice(0, 40)
    .map((item, index) => {
      const description = cleanText(item?.description ?? item?.title ?? "", 240);
      const qtyRaw = Number(item?.qty ?? item?.quantity ?? 1);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(qtyRaw, 9999) : 0;
      let unitCents = 0;
      if (item?.unitCents !== undefined) {
        unitCents = moneyToCents(item.unitCents, { alreadyCents: true });
      } else if (item?.unit_cents !== undefined) {
        unitCents = moneyToCents(item.unit_cents, { alreadyCents: true });
      } else if (item?.unitAmount !== undefined) {
        unitCents = moneyToCents(item.unitAmount);
      } else if (item?.amount !== undefined) {
        unitCents = moneyToCents(item.amount);
      }
      if (!description || qty <= 0) return null;
      return {
        id: cleanText(item?.id, 40) || `line_${index + 1}`,
        description,
        qty,
        unitCents: Math.max(0, unitCents),
      };
    })
    .filter(Boolean);
  if (!normalized.length && (fallbackTitle || fallbackCents)) {
    return [
      {
        id: "line_1",
        description: fallbackTitle || "Services",
        qty: 1,
        unitCents: Math.max(0, Number(fallbackCents) || 0),
      },
    ];
  }
  return normalized;
}

function normalizeTaxRate(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(0, n));
}

function invoiceTotals(lineItems, taxRate) {
  const subtotalCents = (lineItems || []).reduce(
    (sum, item) => sum + Math.round(Number(item.qty) * Number(item.unitCents)),
    0
  );
  const taxCents = Math.round(subtotalCents * (normalizeTaxRate(taxRate) / 100));
  return {
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

function resolveInvoiceDocument(body = {}, existing = null) {
  const title =
    body.title !== undefined ? cleanText(body.title, 160) : existing?.title || "";
  const taxRate =
    body.taxRate !== undefined || body.tax_rate !== undefined
      ? normalizeTaxRate(body.taxRate ?? body.tax_rate, 0)
      : normalizeTaxRate(existing?.tax_rate, 0);

  let lineItems;
  if (body.lineItems !== undefined || body.line_items !== undefined) {
    lineItems = parseInvoiceLineItems(body.lineItems ?? body.line_items, title, 0);
  } else if (existing?.line_items_json) {
    lineItems = parseInvoiceLineItems(existing.line_items_json, existing.title, existing.amount_cents);
  } else {
    const amountCents =
      body.amountCents !== undefined || body.amount_cents !== undefined
        ? moneyToCents(body.amountCents ?? body.amount_cents, { alreadyCents: true })
        : body.amount !== undefined
          ? moneyToCents(body.amount)
          : Number(existing?.amount_cents) || 0;
    lineItems = parseInvoiceLineItems([], title || existing?.title || "Services", amountCents);
  }

  if (!lineItems.length) {
    lineItems = [{ id: "line_1", description: title || "Services", qty: 1, unitCents: 0 }];
  }

  const totals = invoiceTotals(lineItems, taxRate);
  return { title, taxRate, lineItems, ...totals };
}

function rowToInvoice(row) {
  const taxRate = normalizeTaxRate(row.tax_rate, 0);
  const lineItems = parseInvoiceLineItems(row.line_items_json, row.title, row.amount_cents);
  const totals = invoiceTotals(lineItems, taxRate);
  const storedTotal = Number(row.amount_cents) || 0;
  // Prefer computed total when line items exist; fall back to stored for empty legacy rows
  const amountCents = lineItems.length ? totals.totalCents : storedTotal;
  return {
    id: row.id,
    leadId: row.lead_id || null,
    jobId: row.job_id || null,
    quoteId: row.quote_id || null,
    number: row.number,
    title: row.title,
    clientName: row.client_name,
    status: row.status,
    amountCents,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    taxRate,
    dueDate: row.due_date || null,
    issueDate: row.issue_date || (row.created_at || "").slice(0, 10) || null,
    notes: row.notes || "",
    paymentTerms: row.payment_terms || "Net 15",
    billToName: row.bill_to_name || "",
    billToEmail: row.bill_to_email || "",
    billToPhone: row.bill_to_phone || "",
    billToAddress: row.bill_to_address || "",
    lineItems,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildInvoiceLetterheadHtml(invoice, { absoluteLogoUrl = "" } = {}) {
  const logo = absoluteLogoUrl
    ? `<img src="${escapeHtmlText(absoluteLogoUrl)}" alt="Vanderven Systems" width="140" style="display:block;max-width:140px;height:auto;" />`
    : `<div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1c2430;">Vanderven <span style="font-weight:500;color:#8a7340;">Systems</span></div>`;
  const rows = (invoice.lineItems || [])
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;color:#1c2430;">${escapeHtmlText(item.description)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;color:#1c2430;">${escapeHtmlText(String(item.qty))}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;color:#1c2430;">${escapeHtmlText(formatCadCents(item.unitCents))}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;color:#1c2430;font-weight:600;">${escapeHtmlText(formatCadCents(Math.round(item.qty * item.unitCents)))}</td>
      </tr>`
    )
    .join("");
  const billTo = [
    invoice.billToName || invoice.clientName,
    invoice.billToAddress,
    invoice.billToEmail,
    invoice.billToPhone,
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((p) => escapeHtmlText(p))
    .join("<br/>");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Invoice ${escapeHtmlText(invoice.number)}</title></head>
<body style="margin:0;padding:0;background:#f3f0ea;color:#1c2430;">
  <div style="max-width:720px;margin:0 auto;padding:28px 20px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <div style="background:#fffaf3;border:1px solid #ddd4c4;border-radius:14px;overflow:hidden;">
      <div style="padding:28px 32px 22px;background:linear-gradient(135deg,#1c2430 0%,#2d3a4a 55%,#3d3424 100%);color:#f7f1e6;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;">${logo}
            <p style="margin:10px 0 0;font-size:12px;opacity:0.85;line-height:1.45;">${escapeHtmlText(COMPANY.tagline)}<br/>${escapeHtmlText(COMPANY.location)} · ${escapeHtmlText(COMPANY.email)}</p>
          </td>
          <td style="vertical-align:top;text-align:right;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.75;">Invoice</div>
            <div style="font-size:26px;font-weight:700;margin-top:4px;">${escapeHtmlText(invoice.number)}</div>
            <div style="margin-top:10px;font-size:12px;line-height:1.5;opacity:0.9;">
              Issued ${escapeHtmlText(invoice.issueDate || "—")}<br/>
              Due ${escapeHtmlText(invoice.dueDate || "—")}
            </div>
          </td>
        </tr></table>
      </div>
      <div style="padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr>
          <td style="vertical-align:top;width:50%;">
            <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Bill to</div>
            <div style="margin-top:8px;font-size:14px;line-height:1.55;font-weight:600;">${billTo || "—"}</div>
          </td>
          <td style="vertical-align:top;width:50%;text-align:right;">
            <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">For</div>
            <div style="margin-top:8px;font-size:14px;line-height:1.55;">${escapeHtmlText(invoice.title)}</div>
            <div style="margin-top:6px;font-size:12px;color:#5c6570;">Terms: ${escapeHtmlText(invoice.paymentTerms || "Net 15")}</div>
          </td>
        </tr></table>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#f4efe4;">
              <th align="left" style="padding:10px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Description</th>
              <th align="right" style="padding:10px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Qty</th>
              <th align="right" style="padding:10px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Rate</th>
              <th align="right" style="padding:10px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Amount</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
          <tr><td></td><td style="width:240px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr>
                <td style="padding:6px 0;color:#5c6570;">Subtotal</td>
                <td style="padding:6px 0;text-align:right;">${escapeHtmlText(formatCadCents(invoice.subtotalCents))}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5c6570;">Tax (${escapeHtmlText(String(invoice.taxRate))}%)</td>
                <td style="padding:6px 0;text-align:right;">${escapeHtmlText(formatCadCents(invoice.taxCents))}</td>
              </tr>
              <tr>
                <td style="padding:12px 0 0;font-size:15px;font-weight:700;border-top:2px solid #1c2430;">Total due</td>
                <td style="padding:12px 0 0;text-align:right;font-size:15px;font-weight:700;border-top:2px solid #1c2430;">${escapeHtmlText(formatCadCents(invoice.amountCents))}</td>
              </tr>
            </table>
          </td></tr>
        </table>
        ${
          invoice.notes
            ? `<div style="margin-top:22px;padding:14px 16px;background:#f7f2e8;border-radius:10px;font-size:12px;line-height:1.5;color:#3a424c;"><strong style="display:block;margin-bottom:4px;color:#8a7340;">Notes</strong>${escapeHtmlText(invoice.notes)}</div>`
            : ""
        }
        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e6e1d6;font-size:12px;color:#5c6570;line-height:1.55;">
          Please pay by e-transfer or arranged invoice terms to <strong style="color:#1c2430;">${escapeHtmlText(COMPANY.email)}</strong>.<br/>
          Thank you for your business — ${escapeHtmlText(COMPANY.name)} · ${escapeHtmlText(COMPANY.web)}
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

function buildInvoicePlainText(invoice) {
  const lines = (invoice.lineItems || [])
    .map(
      (item) =>
        `- ${item.description} × ${item.qty} @ ${formatCadCents(item.unitCents)} = ${formatCadCents(Math.round(item.qty * item.unitCents))}`
    )
    .join("\n");
  return [
    `${COMPANY.name} — Invoice ${invoice.number}`,
    invoice.title,
    "",
    `Bill to: ${invoice.billToName || invoice.clientName}`,
    invoice.billToEmail ? `Email: ${invoice.billToEmail}` : "",
    invoice.billToAddress ? `Address: ${invoice.billToAddress}` : "",
    "",
    `Issued: ${invoice.issueDate || "—"}`,
    `Due: ${invoice.dueDate || "—"}`,
    `Terms: ${invoice.paymentTerms || "Net 15"}`,
    "",
    lines,
    "",
    `Subtotal: ${formatCadCents(invoice.subtotalCents)}`,
    `Tax (${invoice.taxRate}%): ${formatCadCents(invoice.taxCents)}`,
    `Total due: ${formatCadCents(invoice.amountCents)}`,
    invoice.notes ? `\nNotes: ${invoice.notes}` : "",
    "",
    `Pay to ${COMPANY.email}`,
    `— ${COMPANY.name}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function ensureQuotesInvoicesSeeded(env) {
  if (!env.DB) return;
  await ensureJobsSeeded(env);

  const qCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM quotes").first();
  if (!qCount || Number(qCount.c) === 0) {
    const ts = nowIso();
    const sentAt = (daysAgo) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - daysAgo);
      return d.toISOString();
    };
    const owner = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.systems", 160);
    const quotes = [
      ["quote_demo_01", "lead_demo_01", "Q-1042", "Website + follow-up system", "Valley Mechanical Ltd.", "sent", 480000, "Includes intake form and quote chase sequence.", sentAt(5), owner],
      ["quote_demo_02", "lead_demo_02", "Q-1043", "Listing inquiry overhaul", "Okanagan Homes Realty", "approved", 360000, "Weekend response SLA + cleaner property pages.", sentAt(12), owner],
      ["quote_demo_03", "lead_demo_03", "Q-1044", "Owner update board", "Lakeside Property Group", "draft", 520000, "Maintenance status visible without chasing the office.", null, owner],
      ["quote_demo_04", "lead_demo_04", "Q-1045", "Calendar + CRM sync", "Blake Advisory", "declined", 290000, "Paused — revisiting next quarter.", sentAt(20), owner],
    ];
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO quotes
        (id, lead_id, number, title, client_name, status, amount_cents, notes, sent_at, owner_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await env.DB.batch(
      quotes.map(([id, leadId, number, title, client, status, cents, notes, sent, ownerEmail]) =>
        stmt.bind(id, leadId, number, title, client, status, cents, notes, sent, ownerEmail, ts, ts)
      )
    );
  }

  const iCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM invoices").first();
  if (!iCount || Number(iCount.c) === 0) {
    const ts = nowIso();
    const today = new Date();
    const isoDay = (offset) => {
      const d = new Date(today);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const invoices = [
      ["inv_demo_01", "lead_demo_05", "job_demo_05", "INV-2201", "Seasonal intake setup", "Green Ridge Landscaping", "paid", 180000, isoDay(-10), "Paid on receipt."],
      ["inv_demo_02", "lead_demo_02", "job_demo_02", "INV-2202", "Website review deposit", "Okanagan Homes Realty", "sent", 120000, isoDay(7), "Deposit against approved quote."],
      ["inv_demo_03", "lead_demo_01", "job_demo_01", "INV-2203", "Site audit — Valley Mechanical", "Valley Mechanical Ltd.", "overdue", 95000, isoDay(-3), "Reminder sent once."],
      ["inv_demo_04", "lead_demo_03", null, "INV-2204", "Discovery retainer", "Lakeside Property Group", "draft", 250000, isoDay(14), "Hold until owner board demo."],
    ];
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO invoices
        (id, lead_id, job_id, number, title, client_name, status, amount_cents, due_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await env.DB.batch(
      invoices.map(([id, leadId, jobId, number, title, client, status, cents, due, notes]) =>
        stmt.bind(id, leadId, jobId, number, title, client, status, cents, due, notes, ts, ts)
      )
    );
  }
}

async function listQuotes(env, { status } = {}) {
  await ensureQuotesInvoicesSeeded(env);
  await ensureQuoteDocumentsSeeded(env);
  let sql = "SELECT * FROM quotes";
  const binds = [];
  if (status && normalizeQuoteStatus(status)) {
    sql += " WHERE status = ?";
    binds.push(normalizeQuoteStatus(status));
  }
  sql += " ORDER BY updated_at DESC";
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  const quotes = (result.results || []).map(rowToQuote);
  const links = await env.DB.prepare("SELECT quote_id, document_id FROM quote_document_links").all();
  const byQuote = {};
  for (const row of links.results || []) {
    if (!byQuote[row.quote_id]) byQuote[row.quote_id] = [];
    byQuote[row.quote_id].push(row.document_id);
  }
  return quotes.map((quote) => ({ ...quote, documentIds: byQuote[quote.id] || [] }));
}

async function getQuote(env, id) {
  const row = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(id).first();
  if (!row) return null;
  return enrichQuote(env, rowToQuote(row));
}

async function createQuote(env, body) {
  const title = cleanText(body.title, 160);
  if (!title) return { error: "Title is required." };
  const leadId = cleanText(body.leadId ?? body.lead_id, 64);
  if (!leadId) {
    return { error: "Add a client first, then create the quote from that client." };
  }
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(leadId).first();
  if (!lead) return { error: "Client not found. Add the client before creating a quote." };
  const status = normalizeQuoteStatus(body.status) || "draft";
  const id = newId("quote");
  const ts = nowIso();
  const settings = await ensureReminderSettings(env);
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM quotes").first();
  const number = cleanText(body.number, 40) || `Q-${1040 + Number(count?.c || 0) + 1}`;
  const ownerEmail =
    cleanText(body.ownerEmail ?? body.owner_email, 160) || settings.ownerEmail || "";
  const sentAt = status === "sent" ? ts : null;
  await env.DB.prepare(
    `INSERT INTO quotes
      (id, lead_id, number, title, client_name, status, amount_cents, notes, sent_at, owner_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      leadId,
      number,
      title,
      cleanText(body.clientName ?? body.client_name, 160),
      status,
      body.amountCents !== undefined || body.amount_cents !== undefined
        ? moneyToCents(body.amountCents ?? body.amount_cents, { alreadyCents: true })
        : moneyToCents(body.amount),
      cleanText(body.notes, 4000),
      sentAt,
      ownerEmail,
      ts,
      ts
    )
    .run();
  const documentIds =
    body.documentIds !== undefined || body.document_ids !== undefined
      ? body.documentIds ?? body.document_ids
      : await defaultQuoteDocumentIds(env);
  await setQuoteDocumentIds(env, id, documentIds);
  const quote = await getQuote(env, id);
  if (quote?.leadId) {
    await recordActivity(env, quote.leadId, {
      kind: "quote",
      entityType: "quote",
      entityId: quote.id,
      summary: `Quote ${quote.number} created · ${quote.status.replace(/_/g, " ")}`,
      at: ts,
    });
    const lead = await env.DB.prepare("SELECT stage FROM leads WHERE id = ?").bind(quote.leadId).first();
    if (lead && (lead.stage === "new" || lead.stage === "audit")) {
      await env.DB.prepare("UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?")
        .bind("quoted", ts, quote.leadId)
        .run();
    }
  }
  return { quote };
}

async function updateQuote(env, id, body) {
  const existing = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(id).first();
  if (!existing) return { error: "Quote not found.", status: 404 };
  const title = body.title !== undefined ? cleanText(body.title, 160) : existing.title;
  if (!title) return { error: "Title is required." };
  let status = existing.status;
  if (body.status !== undefined) {
    status = normalizeQuoteStatus(body.status);
    if (!status) return { error: "Invalid status." };
  }
  let sentAt = existing.sent_at || null;
  if (status === "sent" && !sentAt) sentAt = nowIso();
  if (status === "draft") sentAt = existing.sent_at || null;

  const updated = {
    lead_id:
      body.leadId !== undefined || body.lead_id !== undefined
        ? cleanText(body.leadId ?? body.lead_id, 64) || null
        : existing.lead_id,
    number: body.number !== undefined ? cleanText(body.number, 40) || existing.number : existing.number,
    title,
    client_name:
      body.clientName !== undefined || body.client_name !== undefined
        ? cleanText(body.clientName ?? body.client_name, 160)
        : existing.client_name,
    status,
    amount_cents:
      body.amountCents !== undefined || body.amount_cents !== undefined
        ? moneyToCents(body.amountCents ?? body.amount_cents, { alreadyCents: true })
        : body.amount !== undefined
          ? moneyToCents(body.amount)
          : existing.amount_cents,
    notes: body.notes !== undefined ? cleanText(body.notes, 4000) : existing.notes,
    sent_at: sentAt,
    owner_email:
      body.ownerEmail !== undefined || body.owner_email !== undefined
        ? cleanText(body.ownerEmail ?? body.owner_email, 160)
        : existing.owner_email || "",
    updated_at: nowIso(),
  };
  await env.DB.prepare(
    `UPDATE quotes SET
      lead_id = ?, number = ?, title = ?, client_name = ?, status = ?, amount_cents = ?,
      notes = ?, sent_at = ?, owner_email = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      updated.lead_id,
      updated.number,
      updated.title,
      updated.client_name,
      updated.status,
      updated.amount_cents,
      updated.notes,
      updated.sent_at,
      updated.owner_email,
      updated.updated_at,
      id
    )
    .run();
  if (body.documentIds !== undefined || body.document_ids !== undefined) {
    await setQuoteDocumentIds(env, id, body.documentIds ?? body.document_ids);
  }
  const quote = await getQuote(env, id);
  if (quote?.leadId && existing.status !== quote.status) {
    await recordActivity(env, quote.leadId, {
      kind: quote.status === "revisions_requested" ? "revisions_requested" : "quote_status",
      entityType: "quote",
      entityId: quote.id,
      summary: `Quote ${quote.number}: ${existing.status.replace(/_/g, " ")} → ${quote.status.replace(/_/g, " ")}`,
      meta: { from: existing.status, to: quote.status },
      at: updated.updated_at,
    });
  }
  return { quote };
}

async function sendQuote(env, id, requestUrl) {
  const quote = await getQuote(env, id);
  if (!quote) return { error: "Quote not found.", status: 404 };
  if (!quote.leadId) {
    return { error: "Link a client before sending this quote.", status: 400 };
  }
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(quote.leadId).first();
  const toEmail = cleanText(lead?.email || "", 160).toLowerCase();
  if (!toEmail) {
    return { error: "Add an email on the client before sending the quote.", status: 400 };
  }
  const documents = await documentsForQuote(env, quote);
  const origin = requestUrl ? new URL(requestUrl).origin : "";
  const logoUrl = origin ? `${origin}/public/logo-mark-nav.png` : "";
  const html = buildQuoteLetterheadHtml(quote, documents, { absoluteLogoUrl: logoUrl });
  const text = buildQuotePlainText(quote, documents);
  const attachments = documents.map(documentAttachmentPayload);
  const delivery = await deliverReminder(env, {
    toEmail,
    subject: `Quote ${quote.number} from ${COMPANY.name}`,
    body: text,
    html,
    attachments,
  });
  if (delivery.status === "failed") {
    return { error: delivery.error || "Could not send quote email.", status: 502, delivery };
  }
  const result = await updateQuote(env, id, { status: "sent" });
  if (result.error) return result;
  if (result.quote?.leadId) {
    await recordActivity(env, result.quote.leadId, {
      kind: "quote",
      entityType: "quote",
      entityId: result.quote.id,
      summary: `Quote ${result.quote.number} sent to ${toEmail}${
        attachments.length ? ` · ${attachments.length} attachment(s)` : ""
      }`,
      meta: {
        channel: delivery.channel,
        status: delivery.status,
        documentIds: result.quote.documentIds || [],
      },
      at: nowIso(),
    });
  }
  return { quote: result.quote, delivery, documents };
}

async function deleteQuote(env, id) {
  const result = await env.DB.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Quote not found.", status: 404 };
  return { ok: true };
}

async function listInvoices(env, { status } = {}) {
  await ensureQuotesInvoicesSeeded(env);
  let sql = "SELECT * FROM invoices";
  const binds = [];
  if (status && normalizeInvoiceStatus(status)) {
    sql += " WHERE status = ?";
    binds.push(normalizeInvoiceStatus(status));
  }
  sql += " ORDER BY updated_at DESC";
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return (result.results || []).map(rowToInvoice);
}

async function getInvoice(env, id) {
  const row = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  return row ? rowToInvoice(row) : null;
}

async function createInvoice(env, body) {
  const doc = resolveInvoiceDocument(body, null);
  if (!doc.title) return { error: "Title is required." };
  const leadId = cleanText(body.leadId ?? body.lead_id, 64);
  if (!leadId) {
    return { error: "Add a client first, then create the invoice from that client." };
  }
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE id = ?").bind(leadId).first();
  if (!lead) return { error: "Client not found. Add the client before creating an invoice." };
  const status = normalizeInvoiceStatus(body.status) || "draft";
  const dueDate = normalizeDate(body.dueDate ?? body.due_date);
  if (dueDate === undefined) return { error: "Invalid due date." };
  let issueDate = normalizeDate(body.issueDate ?? body.issue_date);
  if (issueDate === undefined) return { error: "Invalid issue date." };
  if (!issueDate) issueDate = nowIso().slice(0, 10);
  const id = newId("inv");
  const ts = nowIso();
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM invoices").first();
  const number = cleanText(body.number, 40) || `INV-${2200 + Number(count?.c || 0) + 1}`;
  const sentAt = status === "sent" || status === "paid" ? ts : null;
  const row = {
    id,
    lead_id: leadId,
    job_id: cleanText(body.jobId ?? body.job_id, 64) || null,
    quote_id: cleanText(body.quoteId ?? body.quote_id, 64) || null,
    number,
    title: doc.title,
    client_name: cleanText(body.clientName ?? body.client_name, 160),
    status,
    amount_cents: doc.totalCents,
    due_date: dueDate,
    notes: cleanText(body.notes, 4000),
    bill_to_name: cleanText(body.billToName ?? body.bill_to_name, 160),
    bill_to_email: cleanText(body.billToEmail ?? body.bill_to_email, 160),
    bill_to_phone: cleanText(body.billToPhone ?? body.bill_to_phone, 40),
    bill_to_address: cleanText(body.billToAddress ?? body.bill_to_address, 400),
    issue_date: issueDate,
    tax_rate: doc.taxRate,
    line_items_json: JSON.stringify(doc.lineItems),
    payment_terms: cleanText(body.paymentTerms ?? body.payment_terms, 120) || "Net 15",
    sent_at: sentAt,
    created_at: ts,
    updated_at: ts,
  };
  await env.DB.prepare(
    `INSERT INTO invoices
      (id, lead_id, job_id, quote_id, number, title, client_name, status, amount_cents, due_date, notes,
       bill_to_name, bill_to_email, bill_to_phone, bill_to_address, issue_date, tax_rate, line_items_json,
       payment_terms, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.lead_id,
      row.job_id,
      row.quote_id,
      row.number,
      row.title,
      row.client_name,
      row.status,
      row.amount_cents,
      row.due_date,
      row.notes,
      row.bill_to_name,
      row.bill_to_email,
      row.bill_to_phone,
      row.bill_to_address,
      row.issue_date,
      row.tax_rate,
      row.line_items_json,
      row.payment_terms,
      row.sent_at,
      row.created_at,
      row.updated_at
    )
    .run();
  const invoice = await getInvoice(env, id);
  if (invoice?.leadId) {
    await recordActivity(env, invoice.leadId, {
      kind: "invoice",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `Invoice ${invoice.number} created · ${formatCadCents(invoice.amountCents)}`,
      at: ts,
    });
  }
  return { invoice };
}

async function updateInvoice(env, id, body) {
  const existing = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  if (!existing) return { error: "Invoice not found.", status: 404 };
  const doc = resolveInvoiceDocument({ ...body, title: body.title ?? existing.title }, existing);
  if (!doc.title) return { error: "Title is required." };
  let status = existing.status;
  if (body.status !== undefined) {
    status = normalizeInvoiceStatus(body.status);
    if (!status) return { error: "Invalid status." };
  }
  let dueDate = existing.due_date;
  if (body.dueDate !== undefined || body.due_date !== undefined) {
    dueDate = normalizeDate(body.dueDate ?? body.due_date);
    if (dueDate === undefined) return { error: "Invalid due date." };
  }
  let issueDate = existing.issue_date || (existing.created_at || "").slice(0, 10) || null;
  if (body.issueDate !== undefined || body.issue_date !== undefined) {
    issueDate = normalizeDate(body.issueDate ?? body.issue_date);
    if (issueDate === undefined) return { error: "Invalid issue date." };
  }
  let sentAt = existing.sent_at || null;
  if ((status === "sent" || status === "paid") && !sentAt) sentAt = nowIso();
  if (status === "draft") sentAt = existing.sent_at || null;

  const updated = {
    lead_id:
      body.leadId !== undefined || body.lead_id !== undefined
        ? cleanText(body.leadId ?? body.lead_id, 64) || null
        : existing.lead_id,
    job_id:
      body.jobId !== undefined || body.job_id !== undefined
        ? cleanText(body.jobId ?? body.job_id, 64) || null
        : existing.job_id,
    quote_id:
      body.quoteId !== undefined || body.quote_id !== undefined
        ? cleanText(body.quoteId ?? body.quote_id, 64) || null
        : existing.quote_id || null,
    number: body.number !== undefined ? cleanText(body.number, 40) || existing.number : existing.number,
    title: doc.title,
    client_name:
      body.clientName !== undefined || body.client_name !== undefined
        ? cleanText(body.clientName ?? body.client_name, 160)
        : existing.client_name,
    status,
    amount_cents: doc.totalCents,
    due_date: dueDate,
    notes: body.notes !== undefined ? cleanText(body.notes, 4000) : existing.notes,
    bill_to_name:
      body.billToName !== undefined || body.bill_to_name !== undefined
        ? cleanText(body.billToName ?? body.bill_to_name, 160)
        : existing.bill_to_name || "",
    bill_to_email:
      body.billToEmail !== undefined || body.bill_to_email !== undefined
        ? cleanText(body.billToEmail ?? body.bill_to_email, 160)
        : existing.bill_to_email || "",
    bill_to_phone:
      body.billToPhone !== undefined || body.bill_to_phone !== undefined
        ? cleanText(body.billToPhone ?? body.bill_to_phone, 40)
        : existing.bill_to_phone || "",
    bill_to_address:
      body.billToAddress !== undefined || body.bill_to_address !== undefined
        ? cleanText(body.billToAddress ?? body.bill_to_address, 400)
        : existing.bill_to_address || "",
    issue_date: issueDate,
    tax_rate: doc.taxRate,
    line_items_json: JSON.stringify(doc.lineItems),
    payment_terms:
      body.paymentTerms !== undefined || body.payment_terms !== undefined
        ? cleanText(body.paymentTerms ?? body.payment_terms, 120) || "Net 15"
        : existing.payment_terms || "Net 15",
    sent_at: sentAt,
    updated_at: nowIso(),
  };
  await env.DB.prepare(
    `UPDATE invoices SET
      lead_id = ?, job_id = ?, quote_id = ?, number = ?, title = ?, client_name = ?, status = ?,
      amount_cents = ?, due_date = ?, notes = ?, bill_to_name = ?, bill_to_email = ?, bill_to_phone = ?,
      bill_to_address = ?, issue_date = ?, tax_rate = ?, line_items_json = ?, payment_terms = ?,
      sent_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      updated.lead_id,
      updated.job_id,
      updated.quote_id,
      updated.number,
      updated.title,
      updated.client_name,
      updated.status,
      updated.amount_cents,
      updated.due_date,
      updated.notes,
      updated.bill_to_name,
      updated.bill_to_email,
      updated.bill_to_phone,
      updated.bill_to_address,
      updated.issue_date,
      updated.tax_rate,
      updated.line_items_json,
      updated.payment_terms,
      updated.sent_at,
      updated.updated_at,
      id
    )
    .run();
  const invoice = await getInvoice(env, id);
  if (invoice?.leadId && existing.status !== invoice.status) {
    await recordActivity(env, invoice.leadId, {
      kind: "invoice",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `Invoice ${invoice.number}: ${existing.status} → ${invoice.status}`,
      meta: { from: existing.status, to: invoice.status },
      at: updated.updated_at,
    });
  }
  return { invoice };
}

async function sendInvoice(env, id, requestUrl) {
  const invoice = await getInvoice(env, id);
  if (!invoice) return { error: "Invoice not found.", status: 404 };
  const toEmail = cleanText(invoice.billToEmail, 160).toLowerCase();
  if (!toEmail) {
    return { error: "Add a bill-to email before sending.", status: 400 };
  }
  const origin = requestUrl ? new URL(requestUrl).origin : "";
  const logoUrl = origin ? `${origin}/public/logo-mark-nav.png` : "";
  const html = buildInvoiceLetterheadHtml(invoice, { absoluteLogoUrl: logoUrl });
  const text = buildInvoicePlainText(invoice);
  const delivery = await deliverReminder(env, {
    toEmail,
    subject: `Invoice ${invoice.number} from ${COMPANY.name}`,
    body: text,
    html,
  });
  if (delivery.status === "failed") {
    return { error: delivery.error || "Could not send invoice email.", status: 502, delivery };
  }
  const result = await updateInvoice(env, id, { status: "sent" });
  if (result.error) return result;
  if (result.invoice?.leadId) {
    await recordActivity(env, result.invoice.leadId, {
      kind: "invoice",
      entityType: "invoice",
      entityId: result.invoice.id,
      summary: `Invoice ${result.invoice.number} sent to ${toEmail}`,
      meta: { channel: delivery.channel, status: delivery.status },
      at: nowIso(),
    });
  }
  return { invoice: result.invoice, delivery };
}

async function deleteInvoice(env, id) {
  const result = await env.DB.prepare("DELETE FROM invoices WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Invoice not found.", status: 404 };
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

  // Public home-page concierge (Vera)
  if (path === "/api/public/chat" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await runVeraChat(env, body, request);
    if (result.error) {
      return json(
        { error: result.error, sessionId: result.sessionId || null },
        { status: result.status || 400 }
      );
    }
    return json({
      reply: result.reply,
      sessionId: result.sessionId,
      degraded: Boolean(result.degraded),
    });
  }

  if (path === "/api/login" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    await ensureUsers(env);
    const password = String(body.password || "");
    const email = cleanText(body.email || body.username || "", 160).toLowerCase();
    if (!password) return json({ error: "Password required." }, { status: 401 });

    let userRow = null;
    if (email) {
      userRow = await getUserByEmail(env, email);
      if (!userRow || !Number(userRow.active)) {
        return json({ error: "Incorrect email or password." }, { status: 401 });
      }
      const valid = await verifyPassword(password, userRow.password_hash, userRow.password_salt);
      if (!valid) return json({ error: "Incorrect email or password." }, { status: 401 });
    } else {
      // Convenience: password-only works when exactly one active user exists.
      const users = await env.DB.prepare(
        "SELECT * FROM users WHERE active = 1 ORDER BY created_at ASC LIMIT 2"
      ).all();
      const rows = users.results || [];
      if (rows.length !== 1) {
        return json({ error: "Email and password required." }, { status: 401 });
      }
      const valid = await verifyPassword(password, rows[0].password_hash, rows[0].password_salt);
      if (!valid) return json({ error: "Incorrect password." }, { status: 401 });
      userRow = rows[0];
    }

    const user = rowToUser(userRow);
    const token = await createSessionToken(env, user);
    return json(
      { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
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
    const user = await getSessionUser(request, env);
    return json({ authenticated: !!user, user });
  }

  const sessionUser = await getSessionUser(request, env);
  if (!sessionUser) return json({ error: "Unauthorized." }, { status: 401 });

  if (path === "/api/account/password" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await changeOwnPassword(env, sessionUser, body);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ ok: true });
  }

  if (path === "/api/search" && method === "GET") {
    const q = cleanText(url.searchParams.get("q") || "", 80);
    const result = await searchNotesAndActivity(env, q);
    return json(result);
  }

  if (path === "/api/vera-chats" && method === "GET") {
    const chats = await listVeraChats(env, {
      limit: Number(url.searchParams.get("limit") || 80),
    });
    return json({ chats });
  }

  const veraChatMatch = path.match(/^\/api\/vera-chats\/([^/]+)$/);
  if (veraChatMatch && method === "GET") {
    const id = decodeURIComponent(veraChatMatch[1]);
    const detail = await getVeraChatDetail(env, id);
    if (!detail) return json({ error: "Chat not found." }, { status: 404 });
    return json(detail);
  }

  if (path === "/api/geocode" && method === "GET") {
    const q = cleanText(url.searchParams.get("q") || "", 400);
    if (!q) return badRequest("Address required.");
    const place = await geocodeAddress(env, q);
    if (!place) return json({ error: "Could not locate address.", place: null }, { status: 404 });
    return json({ place });
  }

  if (path === "/api/geocode/batch" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const queries = Array.isArray(body.queries) ? body.queries.slice(0, 24) : [];
    const result = await geocodeAddressBatch(env, queries);
    return json(result);
  }

  if (path === "/api/rewrite" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await rewriteNoteText(env, body);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ text: result.text, tone: result.tone, context: result.context });
  }

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
    const internal =
      body.internalRequest === true ||
      body.internal_request === true ||
      cleanText(body.source, 40) === "internal";
    const result = await createLead(env, body, {
      source: cleanText(body.source, 40) || (internal ? "internal" : "manual"),
      author: sessionUser?.name || sessionUser?.email || "",
      authorUserId: sessionUser?.id || "",
    });
    if (result.error) return badRequest(result.error);
    return json({ lead: result.lead }, { status: 201 });
  }

  const leadDetailMatch = path.match(/^\/api\/leads\/([^/]+)\/detail$/);
  if (leadDetailMatch && method === "GET") {
    const id = decodeURIComponent(leadDetailMatch[1]);
    const detail = await getLeadDetail(env, id);
    if (!detail) return json({ error: "Client not found." }, { status: 404 });
    return json(detail);
  }

  const leadNotesMatch = path.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (leadNotesMatch && method === "POST") {
    const id = decodeURIComponent(leadNotesMatch[1]);
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await addLeadNote(env, id, body, {
      author: sessionUser?.name || sessionUser?.email || "",
      authorUserId: sessionUser?.id || "",
      kind: body.kind || "note",
    });
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    const detail = await getLeadDetail(env, id);
    return json({ note: result.note, detail }, { status: 201 });
  }

  const leadNoteEditMatch = path.match(/^\/api\/leads\/([^/]+)\/notes\/([^/]+)$/);
  if (leadNoteEditMatch && method === "PATCH") {
    const leadId = decodeURIComponent(leadNoteEditMatch[1]);
    const noteId = decodeURIComponent(leadNoteEditMatch[2]);
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await updateLeadNote(env, leadId, noteId, body, sessionUser);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    const detail = await getLeadDetail(env, leadId);
    return json({ note: result.note, detail });
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
      const denied = assertOwnerCanDelete(sessionUser);
      if (denied) return json({ error: denied.error }, { status: denied.status });
      const result = await deleteLead(env, id);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ ok: true });
    }
  }

  if (path === "/api/jobs" && method === "GET") {
    const from = normalizeDate(url.searchParams.get("from") || "") ?? undefined;
    const to = normalizeDate(url.searchParams.get("to") || "") ?? undefined;
    if (url.searchParams.get("from") && from === undefined) return badRequest("Invalid from date.");
    if (url.searchParams.get("to") && to === undefined) return badRequest("Invalid to date.");
    const status = url.searchParams.get("status") || "";
    const jobs = await listJobs(env, { from: from || "", to: to || "", status });
    return json({
      jobs,
      builds: jobs,
      assignees: ASSIGNEES,
      colors: JOB_COLORS,
      statuses: JOB_STATUSES,
      statusLabels: JOB_STATUS_LABELS,
    });
  }

  if (path === "/api/jobs" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await createJob(env, body);
    if (result.error) return badRequest(result.error);
    return json({ job: result.job }, { status: 201 });
  }

  const jobDetailMatch = path.match(/^\/api\/jobs\/([^/]+)\/detail$/);
  if (jobDetailMatch && method === "GET") {
    const id = decodeURIComponent(jobDetailMatch[1]);
    const detail = await getJobDetail(env, id);
    if (!detail) return json({ error: "Job not found." }, { status: 404 });
    return json(detail);
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch) {
    const id = decodeURIComponent(jobMatch[1]);
    if (method === "GET") {
      const job = await getJob(env, id);
      if (!job) return json({ error: "Job not found." }, { status: 404 });
      return json({ job });
    }
    if (method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await updateJob(env, id, body);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ job: result.job });
    }
    if (method === "DELETE") {
      const denied = assertOwnerCanDelete(sessionUser);
      if (denied) return json({ error: denied.error }, { status: denied.status });
      const result = await deleteJob(env, id);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ ok: true });
    }
  }

  if (path === "/api/quote-documents" && method === "GET") {
    const documents = await listQuoteDocuments(env);
    return json({ documents });
  }

  const quoteDocMatch = path.match(/^\/api\/quote-documents\/([^/]+)$/);
  if (quoteDocMatch && method === "PATCH") {
    const id = decodeURIComponent(quoteDocMatch[1]);
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await updateQuoteDocument(env, id, body);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ document: result.document });
  }

  if (path === "/api/quotes" && method === "GET") {
    const status = url.searchParams.get("status") || "";
    const quotes = await listQuotes(env, { status });
    const documents = await listQuoteDocuments(env);
    return json({ quotes, documents, statuses: QUOTE_STATUSES });
  }

  if (path === "/api/quotes" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await createQuote(env, body);
    if (result.error) return badRequest(result.error);
    return json({ quote: result.quote }, { status: 201 });
  }

  const quoteSendMatch = path.match(/^\/api\/quotes\/([^/]+)\/send$/);
  if (quoteSendMatch && method === "POST") {
    const id = decodeURIComponent(quoteSendMatch[1]);
    const result = await sendQuote(env, id, request.url);
    if (result.error) {
      return json(
        { error: result.error, delivery: result.delivery || null },
        { status: result.status || 400 }
      );
    }
    return json({
      quote: result.quote,
      delivery: result.delivery,
      documents: result.documents,
    });
  }

  const quoteMatch = path.match(/^\/api\/quotes\/([^/]+)$/);
  if (quoteMatch) {
    const id = decodeURIComponent(quoteMatch[1]);
    if (method === "GET") {
      const quote = await getQuote(env, id);
      if (!quote) return json({ error: "Quote not found." }, { status: 404 });
      return json({ quote });
    }
    if (method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await updateQuote(env, id, body);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ quote: result.quote });
    }
    if (method === "DELETE") {
      const denied = assertOwnerCanDelete(sessionUser);
      if (denied) return json({ error: denied.error }, { status: denied.status });
      const result = await deleteQuote(env, id);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ ok: true });
    }
  }

  if (path === "/api/users" && method === "GET") {
    if (!isAdminUser(sessionUser)) return json({ error: "Admin only." }, { status: 403 });
    const users = await listUsers(env);
    return json({ users, roles: ["admin", "member"] });
  }

  if (path === "/api/users" && method === "POST") {
    if (!isAdminUser(sessionUser)) return json({ error: "Admin only." }, { status: 403 });
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await createUserAccount(env, body);
    if (result.error) return badRequest(result.error);
    return json({ user: result.user }, { status: 201 });
  }

  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch) {
    if (!isAdminUser(sessionUser)) return json({ error: "Admin only." }, { status: 403 });
    const id = decodeURIComponent(userMatch[1]);
    if (method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await updateUserAccount(env, id, body, sessionUser);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ user: result.user });
    }
  }

  if (path === "/api/reminder-settings" && method === "GET") {
    const settings = await ensureReminderSettings(env, sessionUser);
    return json({ settings, user: sessionUser });
  }

  if (path === "/api/reminder-settings" && method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await updateReminderSettings(env, body, sessionUser);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ settings: result.settings, user: sessionUser });
  }

  if (path === "/api/reminders" && method === "GET") {
    const reminders = await listReminders(env, {
      limit: Number(url.searchParams.get("limit") || 50),
    });
    return json({ reminders });
  }

  if (path === "/api/reminders/run" && method === "POST") {
    const result = await processQuoteReminders(env);
    return json({ ok: true, ...result });
  }

  if (path === "/api/invoices" && method === "GET") {
    const status = url.searchParams.get("status") || "";
    const invoices = await listInvoices(env, { status });
    return json({ invoices, statuses: INVOICE_STATUSES });
  }

  if (path === "/api/invoices" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await createInvoice(env, body);
    if (result.error) return badRequest(result.error);
    return json({ invoice: result.invoice }, { status: 201 });
  }

  const invoiceSendMatch = path.match(/^\/api\/invoices\/([^/]+)\/send$/);
  if (invoiceSendMatch && method === "POST") {
    const id = decodeURIComponent(invoiceSendMatch[1]);
    const result = await sendInvoice(env, id, request.url);
    if (result.error) {
      return json(
        { error: result.error, delivery: result.delivery || null },
        { status: result.status || 400 }
      );
    }
    return json({ invoice: result.invoice, delivery: result.delivery });
  }

  const invoiceMatch = path.match(/^\/api\/invoices\/([^/]+)$/);
  if (invoiceMatch) {
    const id = decodeURIComponent(invoiceMatch[1]);
    if (method === "GET") {
      const invoice = await getInvoice(env, id);
      if (!invoice) return json({ error: "Invoice not found." }, { status: 404 });
      return json({ invoice });
    }
    if (method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await updateInvoice(env, id, body);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ invoice: result.invoice });
    }
    if (method === "DELETE") {
      const denied = assertOwnerCanDelete(sessionUser);
      if (denied) return json({ error: denied.error }, { status: denied.status });
      const result = await deleteInvoice(env, id);
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
        // Static CRM assets must stay public so login can load CSS/JS.
        if (/\.(css|js|map|png|jpe?g|svg|ico|webp|woff2?)$/i.test(pathname)) {
          return env.ASSETS.fetch(request);
        }
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

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      processQuoteReminders(env).then((result) => {
        console.log("quote reminders", controller.cron, result);
      })
    );
  },
};
