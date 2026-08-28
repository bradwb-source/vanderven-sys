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
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // absolute max cookie life
const SESSION_IDLE_TTL_SEC = 30 * 60; // log out after 30 min inactivity

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
    sendAsName: row.send_as_name != null ? String(row.send_as_name) : "",
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
    const email = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.ca", 160).toLowerCase();
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
  const email = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.ca", 160).toLowerCase();
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

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Prefer PUBLIC_APP_ORIGIN so email links match vanderven.ca (not workers.dev). */
function publicAppOrigin(env, requestOrUrl = "") {
  const configured = cleanText(env?.PUBLIC_APP_ORIGIN || "", 240).replace(/\/+$/, "");
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* ignore bad config */
    }
  }
  try {
    if (requestOrUrl && typeof requestOrUrl === "object" && requestOrUrl.url) {
      return new URL(requestOrUrl.url).origin;
    }
    if (typeof requestOrUrl === "string" && requestOrUrl) {
      return new URL(requestOrUrl).origin;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function originFromRequest(request, env = null) {
  const preferred = publicAppOrigin(env, request);
  if (preferred) return preferred;
  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://app.vanderven.ca";
  }
}

function escapeHtmlMail(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function requestPasswordReset(env, emailRaw, request) {
  const email = cleanText(emailRaw, 160).toLowerCase();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  // Always return the same message so we don't leak whether the account exists.
  const generic = {
    ok: true,
    message: "If that email is on file, we sent a reset link. Check your inbox.",
  };

  try {
    await ensureUsers(env);
    const user = await getUserByEmail(env, email);
    if (!user || !Number(user.active)) return generic;

    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = b64urlEncodeBytes(tokenBytes);
    const tokenHash = await sha256Hex(token);
    const id = newId("pwr");
    const ts = nowIso();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, email, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    )
      .bind(id, user.id, email, tokenHash, expiresAt, ts)
      .run();

    const origin = originFromRequest(request, env);
    const link = `${origin}/login?reset=${encodeURIComponent(token)}`;
    await deliverReminder(env, {
      toEmail: email,
      subject: "Reset your Vanderven CRM password",
      body: [
        `Hi ${user.name || "there"},`,
        "",
        "Use this link to choose a new CRM password (expires in 1 hour):",
        link,
        "",
        "If you didn't ask for this, you can ignore this email.",
      ].join("\n"),
      html: `<p>Hi ${escapeHtmlMail(user.name || "there")},</p>
<p>Use this link to choose a new CRM password (expires in 1 hour):</p>
<p><a href="${link}">Reset password</a></p>
<p>If you didn't ask for this, you can ignore this email.</p>`,
    });
  } catch (err) {
    console.error("requestPasswordReset failed", err);
  }

  return generic;
}

async function confirmPasswordReset(env, tokenRaw, passwordRaw) {
  const token = String(tokenRaw || "").trim();
  const password = String(passwordRaw || "");
  if (!token) return { error: "Reset link is missing or invalid." };
  if (password.length < 6) return { error: "Password must be at least 6 characters." };

  const tokenHash = await sha256Hex(token);
  let row;
  try {
    row = await env.DB.prepare(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL
       LIMIT 1`
    )
      .bind(tokenHash)
      .first();
  } catch {
    return { error: "Password reset is not available yet.", status: 503 };
  }

  if (!row) return { error: "This reset link is invalid or already used.", status: 400 };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: "This reset link has expired. Request a new one.", status: 400 };
  }

  const user = await getUserById(env, row.user_id);
  if (!user || !Number(user.active)) {
    return { error: "Account not found or inactive.", status: 400 };
  }

  const { hash, salt } = await hashPassword(password);
  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`
  )
    .bind(hash, salt, ts, user.id)
    .run();
  await env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`)
    .bind(ts, row.id)
    .run();
  try {
    await env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND id != ?`
    )
      .bind(ts, user.id, row.id)
      .run();
  } catch {
    /* ignore */
  }

  return { ok: true, email: user.email };
}

async function createSessionToken(env, user) {
  const secret = env.SESSION_SECRET || env.CRM_PASSWORD || "dev-secret";
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SEC;
  const payload = b64urlFromString(
    JSON.stringify({
      sub: user?.id || null,
      email: user?.email || null,
      role: user?.role || "member",
      exp,
      last: now,
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
    const now = Math.floor(Date.now() / 1000);
    if (!data.exp || data.exp < now) return null;
    // Missing last = legacy token; force re-login so idle rules apply cleanly.
    if (!data.last || now - Number(data.last) > SESSION_IDLE_TTL_SEC) return null;
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

async function touchSessionCookie(request, env, user) {
  if (!user) return "";
  const token = await createSessionToken(env, user);
  return sessionCookie(token, request.url);
}

function withSessionCookie(response, cookie) {
  if (!response || !cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sessionCookie(token, requestUrl) {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  // Cookie max-age matches idle window so browsers drop stale sessions too.
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_IDLE_TTL_SEC}${secure}`;
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

async function listLeads(env, { stage, q } = {}) {
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
  const noteKind = cleanText(kind || body?.kind || "note", 40) || "note";
  const textMax = noteKind === "call" ? 12000 : 4000;
  const text = cleanText(body?.body ?? body?.note ?? body, textMax);
  if (!text) return { error: "Note text is required." };
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
          : noteKind === "call"
            ? "Call transcript"
            : "Note added";
  await recordActivity(env, leadId, {
    kind:
      noteKind === "revisions_requested" || noteKind === "change_request"
        ? "change_request"
        : noteKind === "request"
          ? "request"
          : noteKind === "call"
            ? "call"
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
  const lead = await getLead(env, id);
  if (!lead) return null;
  const related = await relatedForLead(env, lead);
  const notes = await listLeadNotes(env, id);
  const activity = await listStoredActivity(env, id);
  const timeline = buildTimeline(lead, { notes, activity, ...related });
  const callRecordings = await listCallRecordingsForLead(env, id);
  const deposits = await listDepositsForLead(env, id);
  const depositAvailableCents = await availableDepositCents(env, id);
  const invoices = await Promise.all(
    (related.invoices || []).map((invoice) => enrichInvoicePayments(env, invoice))
  );
  return {
    lead,
    notes,
    activity: timeline,
    quotes: related.quotes,
    jobs: related.jobs,
    invoices,
    reminders: related.reminders,
    callRecordings,
    deposits,
    depositAvailableCents,
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

async function listJobs(env, { from, to, status } = {}) {
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

function resolveQuotePricing(body = {}, existing = null) {
  const title =
    body.title !== undefined ? cleanText(body.title, 160) : existing?.title || "";
  let lineItems;
  if (body.lineItems !== undefined || body.line_items !== undefined) {
    lineItems = parseInvoiceLineItems(body.lineItems ?? body.line_items, "", 0);
  } else if (existing?.line_items_json) {
    lineItems = parseInvoiceLineItems(
      existing.line_items_json,
      existing.title,
      existing.amount_cents
    );
  } else {
    const amountCents =
      body.amountCents !== undefined || body.amount_cents !== undefined
        ? moneyToCents(body.amountCents ?? body.amount_cents, { alreadyCents: true })
        : body.amount !== undefined
          ? moneyToCents(body.amount)
          : Number(existing?.amount_cents) || 0;
    lineItems = parseInvoiceLineItems([], title || "Quoted work", amountCents);
  }
  if (!lineItems.length) {
    lineItems = [{ id: "line_1", description: title || "Quoted work", qty: 1, unitCents: 0 }];
  }
  const totals = invoiceTotals(lineItems, 0);
  const subtotalCents = totals.subtotalCents;
  let discountCents = 0;
  if (body.discountCents !== undefined || body.discount_cents !== undefined) {
    discountCents = moneyToCents(body.discountCents ?? body.discount_cents, { alreadyCents: true });
  } else if (body.discount !== undefined) {
    discountCents = moneyToCents(body.discount);
  } else if (existing?.discount_cents != null) {
    discountCents = Number(existing.discount_cents) || 0;
  }
  discountCents = Math.max(0, Math.min(subtotalCents, Math.round(discountCents) || 0));
  const discountLabel =
    body.discountLabel !== undefined || body.discount_label !== undefined
      ? cleanText(body.discountLabel ?? body.discount_label, 120)
      : existing?.discount_label != null
        ? cleanText(existing.discount_label, 120)
        : "";
  const discountNote =
    body.discountNote !== undefined || body.discount_note !== undefined
      ? cleanText(body.discountNote ?? body.discount_note, 2000)
      : existing?.discount_note != null
        ? cleanText(existing.discount_note, 2000)
        : "";
  return {
    lineItems,
    subtotalCents,
    discountCents,
    discountLabel: discountCents ? discountLabel || "Discount" : discountLabel,
    discountNote,
    amountCents: Math.max(0, subtotalCents - discountCents),
    terms:
      body.terms !== undefined
        ? cleanText(body.terms, 12000)
        : existing?.terms != null
          ? String(existing.terms)
          : "",
    addendums:
      body.addendums !== undefined
        ? cleanText(body.addendums, 12000)
        : existing?.addendums != null
          ? String(existing.addendums)
          : "",
  };
}

function rowToQuote(row, { includeSignature = false } = {}) {
  const hasSignature = Boolean(row.signature_png && String(row.signature_png).length > 40);
  const lineItems = parseInvoiceLineItems(
    row.line_items_json,
    row.title,
    row.amount_cents
  );
  const totals = invoiceTotals(lineItems, 0);
  const storedTotal = Number(row.amount_cents) || 0;
  const subtotalCents = lineItems.length ? totals.subtotalCents : storedTotal;
  const discountCents = Math.max(
    0,
    Math.min(subtotalCents, Number(row.discount_cents) || 0)
  );
  const amountCents = Math.max(0, subtotalCents - discountCents);
  const depositCents =
    row.deposit_cents != null && row.deposit_cents !== ""
      ? Math.max(0, Math.min(amountCents, Math.round(Number(row.deposit_cents) || 0)))
      : null;
  const quote = {
    id: row.id,
    leadId: row.lead_id || null,
    number: row.number,
    title: row.title,
    clientName: row.client_name,
    status: row.status,
    subtotalCents,
    discountCents,
    discountLabel: row.discount_label || "",
    discountNote: row.discount_note || "",
    amountCents,
    depositCents,
    depositDueCents: quoteDepositDueCents({ amountCents, depositCents }),
    lineItems,
    notes: row.notes || "",
    terms: row.terms || "",
    addendums: row.addendums || "",
    sentAt: row.sent_at || null,
    ownerEmail: row.owner_email || "",
    documentIds: [],
    files: [],
    signedAt: row.signed_at || null,
    signedName: row.signed_name || "",
    clientViewedAt: row.client_viewed_at || null,
    signToken: row.sign_token || "",
    hasSignature,
    awaitingSignature:
      (row.status === "sent" || row.status === "revisions_requested") && !hasSignature,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSignature) {
    quote.signaturePng = row.signature_png || "";
    quote.signedIp = row.signed_ip || "";
  }
  return quote;
}

function newSignToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return b64url(bytes);
}

const PRIVACY_POLICY_DOC = {
  id: "doc_privacy",
  slug: "privacy-policy",
  title: "Privacy Policy",
  kind: "privacy",
  summary: "Vanderven Systems Privacy Policy.",
  bodyPlaceholder: "Attached PDF: Vanderven Systems Privacy Policy.",
  attachToEveryQuote: 1,
  sortOrder: 0,
  filePath: "/public/docs/Vanderven-Systems-Privacy-Policy.pdf",
  fileName: "Vanderven-Systems-Privacy-Policy.pdf",
};

const CLIENT_SERVICES_AGREEMENT = {
  id: "doc_client_services",
  slug: "client-services-agreement",
  title: "Client Services Agreement",
  kind: "agreement",
  summary: "Vanderven Systems Client Services Agreement.",
  bodyPlaceholder: "Attached PDF: Vanderven Systems Client Services Agreement.",
  attachToEveryQuote: 1,
  sortOrder: 4,
  filePath: "/public/docs/Vanderven-Systems-Client-Services-Agreement.pdf",
  fileName: "Vanderven-Systems-Client-Services-Agreement.pdf",
};

const MUTUAL_NDA_DOC = {
  id: "doc_mutual_nda",
  slug: "mutual-nda",
  title: "Mutual NDA",
  kind: "nda",
  summary: "Vanderven Systems Mutual Non-Disclosure Agreement.",
  bodyPlaceholder: "Attached PDF: Vanderven Systems Mutual NDA.",
  attachToEveryQuote: 0,
  sortOrder: 5,
  filePath: "/public/docs/Vanderven-Systems-Mutual-NDA.pdf",
  fileName: "Vanderven-Systems-Mutual-NDA.pdf",
};

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
    filePath: row.file_path || "",
    fileName: row.file_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureQuoteDocumentsSeeded(env) {
  if (!env.DB) return;
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM quote_documents").first();
  const ts = nowIso();
  if (!count || Number(count.c) === 0) {
    const docs = [
      [
        PRIVACY_POLICY_DOC.id,
        PRIVACY_POLICY_DOC.slug,
        PRIVACY_POLICY_DOC.title,
        PRIVACY_POLICY_DOC.kind,
        PRIVACY_POLICY_DOC.summary,
        PRIVACY_POLICY_DOC.bodyPlaceholder,
        PRIVACY_POLICY_DOC.attachToEveryQuote,
        PRIVACY_POLICY_DOC.sortOrder,
        PRIVACY_POLICY_DOC.filePath,
        PRIVACY_POLICY_DOC.fileName,
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
        "",
        "",
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
        "",
        "",
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
        "",
        "",
      ],
      [
        CLIENT_SERVICES_AGREEMENT.id,
        CLIENT_SERVICES_AGREEMENT.slug,
        CLIENT_SERVICES_AGREEMENT.title,
        CLIENT_SERVICES_AGREEMENT.kind,
        CLIENT_SERVICES_AGREEMENT.summary,
        CLIENT_SERVICES_AGREEMENT.bodyPlaceholder,
        CLIENT_SERVICES_AGREEMENT.attachToEveryQuote,
        CLIENT_SERVICES_AGREEMENT.sortOrder,
        CLIENT_SERVICES_AGREEMENT.filePath,
        CLIENT_SERVICES_AGREEMENT.fileName,
      ],
      [
        MUTUAL_NDA_DOC.id,
        MUTUAL_NDA_DOC.slug,
        MUTUAL_NDA_DOC.title,
        MUTUAL_NDA_DOC.kind,
        MUTUAL_NDA_DOC.summary,
        MUTUAL_NDA_DOC.bodyPlaceholder,
        MUTUAL_NDA_DOC.attachToEveryQuote,
        MUTUAL_NDA_DOC.sortOrder,
        MUTUAL_NDA_DOC.filePath,
        MUTUAL_NDA_DOC.fileName,
      ],
    ];
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO quote_documents
        (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at, file_path, file_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    );
    try {
      await env.DB.batch(
        docs.map(([id, slug, title, kind, summary, body, every, order, filePath, fileName]) =>
          stmt.bind(id, slug, title, kind, summary, body, every, order, ts, ts, filePath, fileName)
        )
      );
    } catch {
      // Older schema without file_* columns — seed without them.
      const legacy = env.DB.prepare(
        `INSERT OR IGNORE INTO quote_documents
          (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      );
      await env.DB.batch(
        docs.map(([id, slug, title, kind, summary, body, every, order]) =>
          legacy.bind(id, slug, title, kind, summary, body, every, order, ts, ts)
        )
      );
    }
  }
  await ensureFileBackedQuoteDocument(env, PRIVACY_POLICY_DOC, ts);
  await ensureFileBackedQuoteDocument(env, CLIENT_SERVICES_AGREEMENT, ts);
  await ensureFileBackedQuoteDocument(env, MUTUAL_NDA_DOC, ts);
}

async function ensureFileBackedQuoteDocument(env, spec, ts = nowIso()) {
  const existing = await env.DB.prepare("SELECT id, file_path FROM quote_documents WHERE id = ?")
    .bind(spec.id)
    .first()
    .catch(() => null);
  if (!existing) {
    try {
      await env.DB.prepare(
        `INSERT INTO quote_documents
          (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at, file_path, file_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
      )
        .bind(
          spec.id,
          spec.slug,
          spec.title,
          spec.kind,
          spec.summary,
          spec.bodyPlaceholder,
          spec.attachToEveryQuote,
          spec.sortOrder,
          ts,
          ts,
          spec.filePath,
          spec.fileName
        )
        .run();
    } catch {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO quote_documents
          (id, slug, title, kind, summary, body_placeholder, attach_to_every_quote, active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
        .bind(
          spec.id,
          spec.slug,
          spec.title,
          spec.kind,
          spec.summary,
          spec.bodyPlaceholder,
          spec.attachToEveryQuote,
          spec.sortOrder,
          ts,
          ts
        )
        .run();
    }
    return;
  }
  if (existing.file_path !== spec.filePath) {
    try {
      await env.DB.prepare(
        `UPDATE quote_documents
         SET title = ?, summary = ?, body_placeholder = ?, attach_to_every_quote = ?, active = 1,
             file_path = ?, file_name = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(
          spec.title,
          spec.summary,
          spec.bodyPlaceholder,
          spec.attachToEveryQuote ? 1 : 0,
          spec.filePath,
          spec.fileName,
          ts,
          spec.id
        )
        .run();
    } catch {
      /* columns may not exist until migration */
    }
  }
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
  const files = await listQuoteFiles(env, quote.id);
  const deposits = await listDepositsForQuote(env, quote.id);
  return { ...quote, documentIds, files, ...quoteDepositPaymentSummary(deposits) };
}

const QUOTE_FILE_MAX_BYTES = 12 * 1024 * 1024;
const QUOTE_FILE_ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/zip",
]);

function guessQuoteFileContentType(fileName = "", declared = "") {
  const declaredType = cleanText(declared, 120).toLowerCase();
  if (declaredType && declaredType !== "application/octet-stream") return declaredType;
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".zip")) return "application/zip";
  return declaredType || "application/octet-stream";
}

function rowToQuoteFile(row) {
  return {
    id: row.id,
    quoteId: row.quote_id,
    fileName: row.file_name,
    contentType: row.content_type || "application/octet-stream",
    byteSize: Number(row.byte_size) || 0,
    url: `/api/quotes/${encodeURIComponent(row.quote_id)}/files/${encodeURIComponent(row.id)}`,
    createdAt: row.created_at,
  };
}

async function listQuoteFiles(env, quoteId) {
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM quote_files WHERE quote_id = ? ORDER BY created_at ASC"
    )
      .bind(quoteId)
      .all();
    return (result.results || []).map(rowToQuoteFile);
  } catch {
    return [];
  }
}

async function listQuoteFilesByQuoteIds(env, quoteIds) {
  const ids = [...new Set((quoteIds || []).filter(Boolean))];
  const byQuote = Object.fromEntries(ids.map((id) => [id, []]));
  if (!ids.length) return byQuote;
  try {
    const placeholders = ids.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `SELECT * FROM quote_files WHERE quote_id IN (${placeholders}) ORDER BY created_at ASC`
    )
      .bind(...ids)
      .all();
    for (const row of result.results || []) {
      if (!byQuote[row.quote_id]) byQuote[row.quote_id] = [];
      byQuote[row.quote_id].push(rowToQuoteFile(row));
    }
  } catch {
    /* table may not exist until migration */
  }
  return byQuote;
}

async function getQuoteFileRow(env, quoteId, fileId) {
  try {
    return await env.DB.prepare("SELECT * FROM quote_files WHERE id = ? AND quote_id = ?")
      .bind(fileId, quoteId)
      .first();
  } catch {
    return null;
  }
}

async function uploadQuoteFile(env, quoteId, file) {
  if (!env.CALL_AUDIO) {
    return { error: "File storage is not configured (R2).", status: 503 };
  }
  const quote = await getQuote(env, quoteId);
  if (!quote) return { error: "Quote not found.", status: 404 };
  if (!file || typeof file.arrayBuffer !== "function") {
    return { error: "Choose a file to upload.", status: 400 };
  }
  const fileName = cleanText(file.name || "attachment", 180) || "attachment";
  const contentType = guessQuoteFileContentType(fileName, file.type || "");
  if (!QUOTE_FILE_ALLOWED.has(contentType)) {
    return {
      error: "That file type isn’t supported. Use PDF, Word, Excel, images, text, or zip.",
      status: 400,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return { error: "That file is empty.", status: 400 };
  if (bytes.length > QUOTE_FILE_MAX_BYTES) {
    return { error: "Files must be 12 MB or smaller.", status: 400 };
  }
  const id = newId("qfile");
  const r2Key = `quote-files/${quoteId}/${id}-${fileName.replace(/[^\w.\-]+/g, "_").slice(0, 80)}`;
  await env.CALL_AUDIO.put(r2Key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { quoteId, fileId: id, fileName },
  });
  const ts = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO quote_files
        (id, quote_id, file_name, content_type, byte_size, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, quoteId, fileName, contentType, bytes.length, r2Key, ts)
      .run();
  } catch (err) {
    try {
      await env.CALL_AUDIO.delete(r2Key);
    } catch {
      /* ignore */
    }
    return {
      error: "Could not save file metadata. Apply database migrations and try again.",
      status: 503,
    };
  }
  const row = await getQuoteFileRow(env, quoteId, id);
  return { file: rowToQuoteFile(row) };
}

async function deleteQuoteFile(env, quoteId, fileId) {
  const row = await getQuoteFileRow(env, quoteId, fileId);
  if (!row) return { error: "File not found.", status: 404 };
  if (env.CALL_AUDIO && row.r2_key) {
    try {
      await env.CALL_AUDIO.delete(row.r2_key);
    } catch {
      /* continue — still remove DB row */
    }
  }
  await env.DB.prepare("DELETE FROM quote_files WHERE id = ? AND quote_id = ?")
    .bind(fileId, quoteId)
    .run();
  return { ok: true };
}

async function quoteFileAttachmentPayload(env, fileRow) {
  if (!env.CALL_AUDIO || !fileRow?.r2_key) return null;
  try {
    const object = await env.CALL_AUDIO.get(fileRow.r2_key);
    if (!object) return null;
    const buf = await object.arrayBuffer();
    if (!buf.byteLength) return null;
    return {
      filename: fileRow.file_name || "attachment",
      content: toBase64Bytes(buf),
    };
  } catch {
    return null;
  }
}

async function deleteQuoteFilesForQuote(env, quoteId) {
  try {
    const result = await env.DB.prepare("SELECT r2_key FROM quote_files WHERE quote_id = ?")
      .bind(quoteId)
      .all();
    if (env.CALL_AUDIO) {
      await Promise.all(
        (result.results || []).map(async (row) => {
          if (!row.r2_key) return;
          try {
            await env.CALL_AUDIO.delete(row.r2_key);
          } catch {
            /* ignore */
          }
        })
      );
    }
    await env.DB.prepare("DELETE FROM quote_files WHERE quote_id = ?").bind(quoteId).run();
  } catch {
    /* ignore */
  }
}

function formatQuoteLineItemsHtml(lineItems) {
  const rows = (lineItems || [])
    .map((item) => {
      const lineTotal = Math.round(Number(item.qty) * Number(item.unitCents));
      return `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;color:#1c2430;">${escapeHtmlText(item.description)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;white-space:nowrap;color:#3a424c;">${escapeHtmlText(String(item.qty))}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;white-space:nowrap;color:#3a424c;">${escapeHtmlText(formatCadCents(item.unitCents))}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;text-align:right;white-space:nowrap;font-weight:600;color:#1c2430;">${escapeHtmlText(formatCadCents(lineTotal))}</td>
      </tr>`;
    })
    .join("");
  if (!rows) return "";
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">
    <thead>
      <tr>
        <th align="left" style="background:#f4efe4;padding:9px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Item</th>
        <th align="right" style="background:#f4efe4;padding:9px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Qty</th>
        <th align="right" style="background:#f4efe4;padding:9px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Rate</th>
        <th align="right" style="background:#f4efe4;padding:9px 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6570;">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function formatQuotePricingHtml(quote) {
  const subtotal = Number(quote.subtotalCents) || Number(quote.amountCents) || 0;
  const discount = Math.max(0, Math.min(subtotal, Number(quote.discountCents) || 0));
  const total = Math.max(0, subtotal - discount);
  const discountLabel = quote.discountLabel || "Discount";
  const listPriceRow = discount
    ? `<tr>
        <td style="padding:6px 0;font-size:13px;color:#3a424c;">What this costs</td>
        <td align="right" style="padding:6px 0;font-size:13px;color:#3a424c;text-decoration:line-through;white-space:nowrap;">${escapeHtmlText(formatCadCents(subtotal))}</td>
      </tr>`
    : "";
  const discountRow = discount
    ? `<tr>
        <td style="padding:6px 0;font-size:13px;color:#3a424c;">${escapeHtmlText(discountLabel)}</td>
        <td align="right" style="padding:6px 0;font-size:13px;color:#6b5a2e;white-space:nowrap;">−${escapeHtmlText(formatCadCents(discount))}</td>
      </tr>`
    : "";
  const note = quote.discountNote
    ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.45;color:#5c6570;white-space:pre-wrap;">${escapeHtmlText(quote.discountNote)}</p>`
    : "";
  return `<div style="margin-top:18px;padding:16px 18px;background:#f7f2e8;border-radius:10px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${listPriceRow}
      ${discountRow}
    </table>
    ${note}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:${note || discount ? "8" : "0"}px;">
      <tr>
        <td style="padding:10px 0 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7340;font-weight:700;${discount ? "border-top:1px solid #e0d6c4;" : ""}">Investment total</td>
        <td align="right" style="padding:6px 0 0;font-size:24px;font-weight:700;color:#1c2430;white-space:nowrap;${discount ? "border-top:1px solid #e0d6c4;" : ""}">${escapeHtmlText(formatCadCents(total))} <span style="font-size:13px;font-weight:500;color:#5c6570;">CAD</span></td>
      </tr>
    </table>
  </div>`;
}

/** Solid navy — email clients often strip CSS gradients and leave light text on white. */
const EMAIL_BRAND_BG = "#1f3a5f";
const EMAIL_BRAND_FG = "#f4f7fb";
const EMAIL_BRAND_MUTED = "#c5d4e8";

function emailBrandHeaderHtml({
  logoUrl = "",
  kicker = "Quote",
  number = "",
  detailHtml = "",
}) {
  const logoCell = logoUrl
    ? `<td style="vertical-align:middle;padding:0 12px 0 0;width:64px;">
        <img src="${escapeHtmlText(logoUrl)}" alt="Vanderven Systems" width="56" height="56" style="display:block;width:56px;max-width:56px;height:auto;border:0;outline:none;text-decoration:none;" />
      </td>`
    : "";
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" bgcolor="${EMAIL_BRAND_BG}" style="background-color:${EMAIL_BRAND_BG};background:${EMAIL_BRAND_BG};">
      <tr>
        <td bgcolor="${EMAIL_BRAND_BG}" style="padding:22px 24px;background-color:${EMAIL_BRAND_BG};background:${EMAIL_BRAND_BG};">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td valign="top" style="vertical-align:top;padding:0 12px 12px 0;">
                <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                  ${logoCell}
                  <td style="vertical-align:middle;">
                    <div style="font-family:Georgia,Times,serif;font-size:20px;font-weight:700;line-height:1.2;color:${EMAIL_BRAND_FG};mso-line-height-rule:exactly;">
                      Vanderven <span style="font-weight:500;color:#e0c070;">Systems</span>
                    </div>
                  </td>
                </tr></table>
                <p style="margin:10px 0 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.45;color:${EMAIL_BRAND_MUTED};">
                  ${escapeHtmlText(COMPANY.tagline)}<br/>
                  ${escapeHtmlText(COMPANY.location)} · ${escapeHtmlText(COMPANY.email)}
                </p>
              </td>
              <td valign="top" width="42%" style="vertical-align:top;text-align:right;padding:0 0 12px 8px;">
                <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${EMAIL_BRAND_MUTED};">${escapeHtmlText(kicker)}</div>
                <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;margin-top:4px;line-height:1.2;color:${EMAIL_BRAND_FG};">${escapeHtmlText(number)}</div>
                ${
                  detailHtml
                    ? `<div style="margin-top:10px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${EMAIL_BRAND_MUTED};">${detailHtml}</div>`
                    : ""
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

async function logoInlineAttachment(env) {
  const file = await loadQuoteDocumentFile(
    env,
    {
      filePath: "/public/logo-mark-nav-transparent.png",
      fileName: "vanderven-logo.png",
    },
    ""
  );
  if (!file?.content) return null;
  return {
    filename: "vanderven-logo.png",
    content: file.content,
    contentId: "vds-logo",
  };
}

function buildQuoteLetterheadHtml(
  quote,
  documents = [],
  { absoluteLogoUrl = "", signUrl = "", payUrl = "" } = {}
) {
  const attachments = (documents || [])
    .map(
      (doc) =>
        `<li style="margin:0 0 6px;font-size:13px;color:#1c2430;word-break:break-word;"><strong>${escapeHtmlText(
          doc.title
        )}</strong> — ${escapeHtmlText(doc.summary || doc.kind)}</li>`
    )
    .join("");
  const termsBlock = quote.terms
    ? `<div style="margin-top:22px;">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Terms &amp; conditions</div>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.55;color:#3a424c;white-space:pre-wrap;word-break:break-word;">${escapeHtmlText(quote.terms)}</p>
      </div>`
    : "";
  const addendumBlock = quote.addendums
    ? `<div style="margin-top:22px;">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Addendums</div>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.55;color:#3a424c;white-space:pre-wrap;word-break:break-word;">${escapeHtmlText(quote.addendums)}</p>
      </div>`
    : "";
  const header = emailBrandHeaderHtml({
    logoUrl: absoluteLogoUrl,
    kicker: "Quote",
    number: quote.number,
    detailHtml: `Prepared for ${escapeHtmlText(quote.clientName || "Client")}<br/>${escapeHtmlText(formatCadCents(quote.amountCents))}`,
  });
  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quote ${escapeHtmlText(quote.number)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f5;color:#1c2430;">
  <div style="max-width:640px;margin:0 auto;padding:16px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border:1px solid #d7dde6;border-radius:12px;overflow:hidden;">
      <tr><td>${header}</td></tr>
      <tr>
        <td style="padding:24px 20px;">
          <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Proposal</div>
          <h1 style="margin:8px 0 0;font-size:20px;line-height:1.3;color:#1c2430;word-break:break-word;">${escapeHtmlText(quote.title)}</h1>
          <p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:#3a424c;white-space:pre-wrap;word-break:break-word;">
            ${escapeHtmlText(quote.notes || "Scope and deliverables as discussed.")}
          </p>
          ${formatQuoteLineItemsHtml(quote.lineItems)}
          ${formatQuotePricingHtml(quote)}
          ${termsBlock}
          ${addendumBlock}
          ${
            attachments
              ? `<div style="margin-top:24px;">
                  <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Attached with this quote</div>
                  <ul style="margin:10px 0 0;padding-left:18px;">${attachments}</ul>
                  <p style="margin:10px 0 0;font-size:12px;color:#5c6570;">Supporting documents attached with this quote.</p>
                </div>`
              : ""
          }
          ${
            signUrl
              ? `<div style="margin-top:28px;">
                  <a href="${escapeHtmlText(signUrl)}" style="display:block;width:100%;box-sizing:border-box;padding:14px 16px;background:#b8953e;color:#141820;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;text-align:center;">Review &amp; sign to approve</a>
                  <p style="margin:12px 0 0;font-size:12px;color:#5c6570;line-height:1.5;text-align:center;">Please sign first — then you can pay the kickoff deposit.</p>
                </div>`
              : ""
          }
          ${paymentInstructionsBlock({
            baseCents: quoteDepositDueCents(quote),
            payUrl: "",
            number: quote.number,
            heading: "After you sign — deposit due to begin",
            blurb: "Sign above first. Then pay your kickoff deposit (balance is invoiced later). Card payments include 3.5% processing.",
            etransferTitle: "Pay deposit via e-Transfer",
            cardTitle: "Pay deposit by card",
            buttonLabel: "Pay deposit by card",
          }).html}
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e6e1d6;font-size:12px;color:#5c6570;line-height:1.55;">
            Questions? Reply to this email or write <strong style="color:#1c2430;">${escapeHtmlText(COMPANY.email)}</strong>.<br/>
            — ${escapeHtmlText(COMPANY.name)} · ${escapeHtmlText(COMPANY.web)}
          </div>
        </td>
      </tr>
    </table>
  </div>
</body></html>`;
}

function buildQuotePlainText(quote, documents = [], { signUrl = "", payUrl = "" } = {}) {
  const docs = (documents || []).map((d) => `- ${d.title}: ${d.summary || d.kind}`).join("\n");
  const lines = (quote.lineItems || [])
    .map((item) => {
      const total = Math.round(Number(item.qty) * Number(item.unitCents));
      return `- ${item.description} · qty ${item.qty} · ${formatCadCents(item.unitCents)} = ${formatCadCents(total)}`;
    })
    .join("\n");
  const subtotal = Number(quote.subtotalCents) || Number(quote.amountCents) || 0;
  const discount = Math.max(0, Math.min(subtotal, Number(quote.discountCents) || 0));
  return [
    `${COMPANY.name} — Quote ${quote.number}`,
    quote.title,
    "",
    `Prepared for: ${quote.clientName || "Client"}`,
    discount ? `What this costs: ${formatCadCents(subtotal)} CAD` : "",
    discount ? `${quote.discountLabel || "Discount"}: −${formatCadCents(discount)} CAD` : "",
    quote.discountNote ? `Note: ${quote.discountNote}` : "",
    `Investment total: ${formatCadCents(quote.amountCents)} CAD`,
    `Deposit due to begin: ${formatCadCents(quoteDepositDueCents(quote))} CAD`,
    "",
    quote.notes || "Scope and deliverables as discussed.",
    lines ? `\nLine items:\n${lines}` : "",
    quote.terms ? `\nTerms & conditions:\n${quote.terms}` : "",
    quote.addendums ? `\nAddendums:\n${quote.addendums}` : "",
    docs ? `\nAttached:\n${docs}` : "",
    signUrl
      ? `\nReview & sign to approve:\n${signUrl}\n\nPlease sign first — then you can pay the kickoff deposit.`
      : "",
    `\n${paymentInstructionsBlock({
      baseCents: quoteDepositDueCents(quote),
      payUrl: "",
      number: quote.number,
      heading: "After you sign — deposit due to begin",
      blurb: "Sign above first. Then pay your kickoff deposit (balance is invoiced later). Card payments include 3.5% processing.",
      etransferTitle: "Pay deposit via e-Transfer",
      cardTitle: "Pay deposit by card",
      buttonLabel: "Pay deposit by card",
    }).text}`,
    "",
    `— ${COMPANY.name} · ${COMPANY.email}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function toBase64Bytes(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

async function loadQuoteDocumentFile(env, doc, requestUrl = "") {
  const filePath = cleanText(doc.filePath || doc.file_path, 240);
  if (!filePath) return null;
  const filename =
    cleanText(doc.fileName || doc.file_name, 180) ||
    filePath.split("/").filter(Boolean).pop() ||
    "attachment.pdf";
  try {
    if (env.ASSETS) {
      const assetReq = new Request(new URL(filePath, "https://assets.local").toString());
      const res = await env.ASSETS.fetch(assetReq);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength) {
          return { filename, content: toBase64Bytes(buf) };
        }
      }
    }
    const origin = requestUrl ? new URL(requestUrl).origin : "";
    if (origin) {
      const res = await fetch(new URL(filePath, origin).toString());
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength) {
          return { filename, content: toBase64Bytes(buf) };
        }
      }
    }
  } catch {
    /* fall through to text placeholder */
  }
  return null;
}

async function documentAttachmentPayload(env, doc, requestUrl = "") {
  const file = await loadQuoteDocumentFile(env, doc, requestUrl);
  if (file) return file;
  const expectedPath = cleanText(doc.filePath || doc.file_path, 240);
  if (expectedPath) {
    return {
      error: `Could not load attachment “${doc.title || doc.fileName || expectedPath}”.`,
      status: 502,
    };
  }
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
    sendFromEmail: user.email || "",
    sendAsName: user.sendAsName || "",
    ownerEnabled: user.ownerEnabled,
    ownerDays: user.ownerDays,
    clientEnabled: user.clientEnabled,
    clientDays: user.clientDays,
    stopOnClosed: user.stopOnClosed,
    updatedAt: user.updatedAt,
    userId: user.id,
  };
}

/** Format Resend From for a CRM user (login email + optional display name). */
function formatOutboundFrom(user, env) {
  const email = cleanText(user?.email || "", 160).toLowerCase();
  if (!email) {
    return (
      env.REMINDER_FROM_EMAIL ||
      env.NOTIFY_FROM_EMAIL ||
      "Vanderven Systems <brad@vanderven.ca>"
    );
  }
  const name = cleanText(user?.sendAsName || user?.name || "", 80);
  if (name) return `${name} <${email}>`;
  return email;
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
    ownerEmail: cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.ca", 160),
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
    const ownerEmail = cleanText(env.CRM_OWNER_EMAIL || "brad@vanderven.ca", 160);
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
    const sendAsName =
      body.sendAsName !== undefined || body.send_as_name !== undefined
        ? cleanText(body.sendAsName ?? body.send_as_name, 80)
        : existing.send_as_name != null
          ? String(existing.send_as_name)
          : "";
    const ts = nowIso();

    try {
      await env.DB.prepare(
        `UPDATE users SET
          send_as_name = ?,
          owner_enabled = ?, owner_days = ?,
          client_enabled = ?, client_days = ?, stop_on_closed = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(
          sendAsName,
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
          ts,
          user.id
        )
        .run();
    } catch {
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
          ts,
          user.id
        )
        .run();
    }
    const refreshed = await getUserById(env, user.id);
    return {
      settings: await ensureReminderSettings(env, { id: user.id }),
      user: rowToUser(refreshed),
    };
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

async function notifyOwnerNewLead(env, lead, { source = "contact" } = {}) {
  if (!lead?.id) return { channel: "log", status: "skipped", error: "Missing lead." };
  const toEmail = cleanText(env.CRM_OWNER_EMAIL || COMPANY.email || "brad@vanderven.ca", 160).toLowerCase();
  const lines = [
    `New website ${source} lead`,
    ``,
    `Name: ${lead.name || "—"}`,
    `Business: ${lead.business || "—"}`,
    `Email: ${lead.email || "—"}`,
    `Phone: ${lead.phone || "—"}`,
    `Industry: ${lead.industry || "—"}`,
    lead.notes ? `\nMessage:\n${lead.notes}` : "",
    ``,
    `Open in CRM: /app/#clients?id=${lead.id}`,
  ].filter((line) => line !== undefined);

  return deliverReminder(env, {
    toEmail,
    subject: `New lead: ${lead.business || lead.name || "Website inquiry"}`,
    body: lines.join("\n"),
  });
}

async function deliverReminder(env, { toEmail, subject, body, html, attachments, from, replyTo }) {
  if (!toEmail) {
    return { channel: "log", status: "skipped", error: "Missing recipient email." };
  }
  const apiKey = env.RESEND_API_KEY;
  const fromAddress =
    cleanText(from, 200) ||
    env.REMINDER_FROM_EMAIL ||
    env.NOTIFY_FROM_EMAIL ||
    "Vanderven Systems <brad@vanderven.ca>";
  const replyAddress = cleanText(replyTo, 160).toLowerCase();
  if (!apiKey) {
    // No outbound mail until RESEND_API_KEY is set (lead still saved in CRM).
    return {
      channel: "log",
      status: "logged",
      error: "",
      from: fromAddress,
      attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    };
  }
  try {
    const payload = {
      from: fromAddress,
      to: [toEmail],
      subject,
      text: body,
    };
    if (replyAddress) payload.reply_to = replyAddress;
    if (html) payload.html = html;
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments.map((file) => {
        const item = {
          filename: file.filename,
          content: file.content,
        };
        if (file.contentId) {
          item.content_id = file.contentId;
          item.content_disposition = "inline";
        }
        return item;
      });
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "vanderven-sys/1.0",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { channel: "email", status: "failed", error: detail.slice(0, 500), from: fromAddress };
    }
    return {
      channel: "email",
      status: "sent",
      error: "",
      from: fromAddress,
      attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    };
  } catch (err) {
    return {
      channel: "email",
      status: "failed",
      error: String(err?.message || err).slice(0, 500),
      from: fromAddress,
    };
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
      const ownerEmail = cleanText(quote.owner_email || settings.ownerEmail, 160).toLowerCase();
      const ownerRow = ownerEmail ? await getUserByEmail(env, ownerEmail) : null;
      const fromUser = ownerRow ? rowToUser(ownerRow) : null;
      const delivery = await deliverReminder(env, {
        toEmail: job.toEmail,
        subject: copy.subject,
        body: copy.body,
        from: formatOutboundFrom(fromUser, env),
        replyTo: fromUser?.email || ownerEmail || "",
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
  email: "hello@vanderven.ca",
  accountingEmail: "accounting@vanderven.ca",
  location: "Kelowna & Central Okanagan, BC",
  web: "vanderven.ca",
  tagline: "Websites, automation & systems for local businesses",
};

const CARD_FEE_RATE = 0.035;
/** Default deposit asked on quotes (balance billed later on invoice). */
const QUOTE_DEPOSIT_RATE = 0.5;

function cardFeeCents(baseCents) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  return Math.round(base * CARD_FEE_RATE);
}

function cardTotalCents(baseCents) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  return base + cardFeeCents(base);
}

/** Deposit due now for a quote — custom deposit_cents, else 50% of investment total. */
function quoteDepositDueCents(quote) {
  const amount = Math.max(
    0,
    Math.round(Number(quote?.amountCents ?? quote?.amount_cents) || 0)
  );
  const raw = quote?.depositCents ?? quote?.deposit_cents;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const custom = Math.round(Number(raw));
    if (Number.isFinite(custom)) return Math.max(0, Math.min(amount, custom));
  }
  return Math.max(0, Math.round(amount * QUOTE_DEPOSIT_RATE));
}

function resolveQuoteDepositCents(body, amountCents, existing = null) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  if (
    body &&
    (body.depositCents !== undefined ||
      body.deposit_cents !== undefined ||
      body.deposit !== undefined)
  ) {
    const raw = body.depositCents ?? body.deposit_cents ?? body.deposit;
    if (raw === null || raw === "") {
      return Math.round(amount * QUOTE_DEPOSIT_RATE);
    }
    const cents = moneyToCents(raw, {
      alreadyCents: body.depositCents !== undefined || body.deposit_cents !== undefined,
    });
    return Math.max(0, Math.min(amount, cents));
  }
  if (existing && existing.deposit_cents != null && existing.deposit_cents !== "") {
    return Math.max(0, Math.min(amount, Math.round(Number(existing.deposit_cents) || 0)));
  }
  return Math.round(amount * QUOTE_DEPOSIT_RATE);
}

function normalizeDepositMethod(value) {
  const m = String(value || "").toLowerCase().trim();
  return ["card", "etransfer", "manual"].includes(m) ? m : null;
}

function normalizeDepositStatus(value) {
  const s = String(value || "").toLowerCase().trim();
  return ["pending", "received", "applied", "void"].includes(s) ? s : null;
}

function rowToDeposit(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    quoteId: row.quote_id || null,
    invoiceId: row.invoice_id || null,
    amountCents: Number(row.amount_cents) || 0,
    feeCents: Number(row.fee_cents) || 0,
    method: row.method || "manual",
    status: row.status || "pending",
    stripeSessionId: row.stripe_session_id || "",
    stripePaymentIntent: row.stripe_payment_intent || "",
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listDepositsForLead(env, leadId) {
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM client_deposits WHERE lead_id = ? ORDER BY created_at DESC"
    )
      .bind(leadId)
      .all();
    return (result.results || []).map(rowToDeposit);
  } catch {
    return [];
  }
}

async function availableDepositCents(env, leadId) {
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM client_deposits
       WHERE lead_id = ? AND status = 'received'`
    )
      .bind(leadId)
      .first();
    return Math.max(0, Number(row?.total) || 0);
  } catch {
    return 0;
  }
}

async function listDepositsForQuote(env, quoteId) {
  if (!quoteId) return [];
  try {
    const result = await env.DB.prepare(
      `SELECT * FROM client_deposits
       WHERE quote_id = ? AND status IN ('received', 'applied')
       ORDER BY created_at ASC`
    )
      .bind(quoteId)
      .all();
    return (result.results || []).map(rowToDeposit);
  } catch {
    return [];
  }
}

async function listDepositSummariesByQuoteIds(env, quoteIds = []) {
  const ids = [...new Set((quoteIds || []).filter(Boolean))];
  const map = {};
  for (const id of ids) map[id] = [];
  if (!ids.length) return map;
  try {
    const placeholders = ids.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `SELECT * FROM client_deposits
       WHERE quote_id IN (${placeholders}) AND status IN ('received', 'applied')
       ORDER BY created_at ASC`
    )
      .bind(...ids)
      .all();
    for (const row of result.results || []) {
      const dep = rowToDeposit(row);
      if (!map[dep.quoteId]) map[dep.quoteId] = [];
      map[dep.quoteId].push(dep);
    }
  } catch {
    /* ignore */
  }
  return map;
}

function quoteDepositPaymentSummary(deposits = []) {
  const paid = (deposits || []).filter((d) => d.status === "received" || d.status === "applied");
  const depositPaidCents = paid.reduce((sum, d) => sum + (Number(d.amountCents) || 0), 0);
  const depositFeeCents = paid.reduce((sum, d) => sum + (Number(d.feeCents) || 0), 0);
  const latest = paid.length ? paid[paid.length - 1] : null;
  const first = paid.length ? paid[0] : null;
  return {
    deposits: paid,
    depositPaidCents,
    depositFeeCents,
    depositPaidAt: first?.createdAt || null,
    depositPaidLatestAt: latest?.createdAt || null,
    depositPaidMethod: latest?.method || "",
    alreadyPaid: depositPaidCents > 0,
  };
}

async function quoteHasActiveDeposit(env, quoteId) {
  if (!quoteId) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM client_deposits
       WHERE quote_id = ? AND status IN ('received', 'applied')
       LIMIT 1`
    )
      .bind(quoteId)
      .first();
    return Boolean(row?.id);
  } catch {
    return false;
  }
}

async function appliedDepositCentsForInvoice(env, invoiceId) {
  if (!invoiceId) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM client_deposits
       WHERE invoice_id = ? AND status = 'applied'`
    )
      .bind(invoiceId)
      .first();
    return Math.max(0, Number(row?.total) || 0);
  } catch {
    return 0;
  }
}

/** FIFO share of unapplied deposit credit allocated to this open invoice (+ already applied). */
async function allocatedDepositCentsForInvoice(env, invoice) {
  if (!invoice?.leadId || !invoice?.id) return 0;
  const alreadyApplied = await appliedDepositCentsForInvoice(env, invoice.id);
  if (invoice.status === "paid") return alreadyApplied;

  const amount = Math.max(0, invoice.amountCents || 0);
  const room = Math.max(0, amount - alreadyApplied);
  if (room <= 0) return alreadyApplied;

  const available = await availableDepositCents(env, invoice.leadId);
  if (available <= 0) return alreadyApplied;

  let open;
  try {
    open = await env.DB.prepare(
      `SELECT i.id, i.amount_cents,
         COALESCE((
           SELECT SUM(d.amount_cents) FROM client_deposits d
           WHERE d.invoice_id = i.id AND d.status = 'applied'
         ), 0) AS applied_cents
       FROM invoices i
       WHERE i.lead_id = ? AND i.status IN ('draft', 'sent', 'overdue')
       ORDER BY COALESCE(i.issue_date, i.created_at) ASC, i.created_at ASC, i.id ASC`
    )
      .bind(invoice.leadId)
      .all();
  } catch {
    return alreadyApplied + Math.min(available, room);
  }
  let remaining = available;
  for (const row of open.results || []) {
    const amt = Math.max(0, Number(row.amount_cents) || 0);
    const applied = Math.max(0, Number(row.applied_cents) || 0);
    const need = Math.max(0, amt - applied);
    const take = Math.min(remaining, need);
    if (row.id === invoice.id) return alreadyApplied + take;
    remaining -= take;
  }
  return alreadyApplied;
}

/**
 * Apply received deposits to an invoice up to maxCents (FIFO).
 * Splits a deposit when only part of it is needed so leftover credit stays available.
 */
async function applyReceivedDepositsToInvoice(env, leadId, invoiceId, maxCents) {
  const need = Math.max(0, Math.round(Number(maxCents) || 0));
  if (!leadId || !invoiceId || need <= 0) return 0;
  const ts = nowIso();
  let rows;
  try {
    rows = await env.DB.prepare(
      `SELECT * FROM client_deposits
       WHERE lead_id = ? AND status = 'received'
       ORDER BY created_at ASC, id ASC`
    )
      .bind(leadId)
      .all();
  } catch {
    return 0;
  }
  let remaining = need;
  let appliedTotal = 0;
  for (const row of rows.results || []) {
    if (remaining <= 0) break;
    const amount = Math.max(0, Number(row.amount_cents) || 0);
    if (amount <= 0) continue;
    if (amount <= remaining) {
      await env.DB.prepare(
        `UPDATE client_deposits
         SET status = 'applied', invoice_id = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(invoiceId, ts, row.id)
        .run();
      remaining -= amount;
      appliedTotal += amount;
      continue;
    }
    const applyAmount = remaining;
    const leftover = amount - applyAmount;
    const feeOriginal = Math.max(0, Number(row.fee_cents) || 0);
    const feeApplied = amount > 0 ? Math.round((feeOriginal * applyAmount) / amount) : 0;
    const feeLeft = Math.max(0, feeOriginal - feeApplied);
    await env.DB.prepare(
      `UPDATE client_deposits
       SET amount_cents = ?, fee_cents = ?, status = 'applied', invoice_id = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(applyAmount, feeApplied, invoiceId, ts, row.id)
      .run();
    await insertDeposit(env, {
      leadId,
      quoteId: row.quote_id || null,
      amountCents: leftover,
      feeCents: feeLeft,
      method: row.method || "manual",
      status: "received",
      note: cleanText(`Remainder after applying $${(applyAmount / 100).toFixed(2)} to invoice. ${row.note || ""}`, 2000),
    });
    appliedTotal += applyAmount;
    remaining = 0;
  }
  return appliedTotal;
}

async function issueEntityPayToken(env, table, id) {
  try {
    const existing = await env.DB.prepare(`SELECT pay_token FROM ${table} WHERE id = ?`)
      .bind(id)
      .first();
    if (existing?.pay_token) return existing.pay_token;
    const token = newSignToken();
    const ts = nowIso();
    await env.DB.prepare(
      `UPDATE ${table} SET pay_token = ?, pay_token_created_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(token, ts, ts, id)
      .run();
    return token;
  } catch {
    return null;
  }
}

async function getQuoteByPayToken(env, token) {
  const clean = cleanText(token, 80);
  if (!clean) return null;
  try {
    return await env.DB.prepare("SELECT * FROM quotes WHERE pay_token = ?").bind(clean).first();
  } catch {
    return null;
  }
}

async function getInvoiceByPayToken(env, token) {
  const clean = cleanText(token, 80);
  if (!clean) return null;
  try {
    return await env.DB.prepare("SELECT * FROM invoices WHERE pay_token = ?").bind(clean).first();
  } catch {
    return null;
  }
}

async function enrichInvoicePayments(env, invoice) {
  if (!invoice) return null;
  const depositAvailableCents = await allocatedDepositCentsForInvoice(env, invoice);
  const balanceDueCents =
    invoice.status === "paid"
      ? 0
      : Math.max(0, (invoice.amountCents || 0) - depositAvailableCents);
  return {
    ...invoice,
    depositAvailableCents,
    balanceDueCents,
    cardTotalCents: cardTotalCents(balanceDueCents),
    cardFeeCents: cardFeeCents(balanceDueCents),
  };
}

function paymentInstructionsBlock({
  baseCents,
  payUrl = "",
  number = "",
  heading = "How to pay",
  blurb = "",
  etransferTitle = "Pay via e-Transfer",
  cardTitle = "Pay by card",
  buttonLabel = "Pay by card",
}) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  const card = cardTotalCents(base);
  const fee = cardFeeCents(base);
  const memo = number || "your quote/invoice number";
  const cardBtn = payUrl
    ? `<a href="${escapeHtmlText(payUrl)}" style="display:block;width:100%;box-sizing:border-box;margin-top:14px;padding:14px 16px;background:#b8953e;color:#141820;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;text-align:center;">${escapeHtmlText(buttonLabel)}</a>`
    : "";
  const blurbHtml = blurb
    ? `<p style="margin:0 0 12px;font-size:12px;line-height:1.45;color:#5c6570;">${escapeHtmlText(blurb)}</p>`
    : "";
  // Stacked (not side-by-side) so phone/Outlook don't crush text into the button.
  return {
    html: `
      <div style="margin-top:28px;">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;margin-bottom:6px;">${escapeHtmlText(heading)}</div>
        ${blurbHtml}
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 12px;">
          <tr>
            <td style="padding:16px;background:#f7f2e8;border-radius:12px;border:1px solid #e0d6c4;">
              <div style="font-size:15px;font-weight:700;color:#1c2430;">${escapeHtmlText(etransferTitle)}</div>
              <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#3a424c;">No extra fee.</p>
              <p style="margin:12px 0 0;font-size:20px;font-weight:700;color:#1c2430;word-break:break-word;">${escapeHtmlText(formatCadCents(base))}</p>
              <p style="margin:10px 0 0;font-size:13px;line-height:1.55;color:#3a424c;word-break:break-word;">
                Send Interac to <strong style="color:#1c2430;">${escapeHtmlText(COMPANY.accountingEmail)}</strong><br/>
                Memo: <strong style="color:#1c2430;">${escapeHtmlText(memo)}</strong>
              </p>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="padding:16px;background:#f7f2e8;border-radius:12px;border:1px solid #e0d6c4;">
              <div style="font-size:15px;font-weight:700;color:#1c2430;">${escapeHtmlText(cardTitle)}</div>
              <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#3a424c;">Includes 3.5% card processing (${escapeHtmlText(formatCadCents(fee))}).</p>
              <p style="margin:12px 0 0;font-size:20px;font-weight:700;color:#1c2430;word-break:break-word;">${escapeHtmlText(formatCadCents(card))}</p>
              <p style="margin:6px 0 0;font-size:12px;line-height:1.45;color:#5c6570;">${escapeHtmlText(formatCadCents(base))} + 3.5%</p>
              ${cardBtn}
            </td>
          </tr>
        </table>
      </div>`,
    text: [
      `${heading}:`,
      blurb || "",
      "",
      `${etransferTitle} (no fee):`,
      `  Amount: ${formatCadCents(base)}`,
      `  Send to: ${COMPANY.accountingEmail}`,
      `  Memo: ${memo}`,
      "",
      `${cardTitle} (+3.5% processing):`,
      `  Amount: ${formatCadCents(card)} (${formatCadCents(base)} + ${formatCadCents(fee)})`,
      payUrl ? `  Pay here: ${payUrl}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

async function stripeRequest(env, path, params) {
  const key = cleanText(env.STRIPE_SECRET_KEY || "", 200);
  if (!key) return { error: "Stripe is not configured.", status: 503 };
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    body.append(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      error: data?.error?.message || "Stripe request failed.",
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
      data,
    };
  }
  return { data };
}

async function createStripeCheckoutSession(env, {
  kind,
  entityId,
  leadId,
  baseCents,
  number,
  title,
  successUrl,
  cancelUrl,
  customerEmail = "",
}) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  if (base < 50) return { error: "Amount is too small to charge by card.", status: 400 };
  const total = cardTotalCents(base);
  const fee = cardFeeCents(base);
  const email = cleanText(customerEmail, 160).toLowerCase();
  const result = await stripeRequest(env, "/checkout/sessions", {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...(email.includes("@") ? { customer_email: email } : {}),
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "cad",
    "line_items[0][price_data][unit_amount]": String(total),
    "line_items[0][price_data][product_data][name]": `${kind === "invoice" ? "Invoice" : "Deposit"} ${number}`,
    "line_items[0][price_data][product_data][description]": `${title || ""} · includes 3.5% card processing`.trim(),
    "metadata[kind]": kind,
    "metadata[entityId]": entityId,
    "metadata[leadId]": leadId || "",
    "metadata[baseCents]": String(base),
    "metadata[feeCents]": String(fee),
    "metadata[number]": number || "",
    "payment_intent_data[metadata][kind]": kind,
    "payment_intent_data[metadata][entityId]": entityId,
  });
  if (result.error) return result;
  return { session: result.data, baseCents: base, feeCents: fee, totalCents: total };
}

function stripeCheckoutCustomerEmail(session) {
  return cleanText(
    session?.customer_details?.email || session?.customer_email || "",
    160
  ).toLowerCase();
}

function buildPaymentReceiptEmail({
  kind,
  number,
  title,
  clientName,
  baseCents,
  feeCents,
  totalCents,
  paymentRef = "",
  paidAt = "",
}) {
  const isInvoice = kind === "invoice";
  const label = isInvoice ? "Invoice payment" : "Deposit payment";
  const kicker = isInvoice ? "Receipt" : "Deposit receipt";
  const when = paidAt
    ? (() => {
        try {
          return new Intl.DateTimeFormat("en-CA", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/Vancouver",
          }).format(new Date(paidAt));
        } catch {
          return paidAt;
        }
      })()
    : "";
  const header = emailBrandHeaderHtml({
    logoUrl: "cid:vds-logo",
    kicker,
    number: number || "",
    detailHtml: when ? `Paid ${escapeHtmlText(when)}` : "Payment received",
  });
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#eef1f5;color:#1c2430;">
  <div style="max-width:640px;margin:0 auto;padding:16px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border:1px solid #d7dde6;border-radius:12px;overflow:hidden;">
      <tr><td>${header}</td></tr>
      <tr>
        <td style="padding:24px 20px;">
          <p style="margin:0;font-size:15px;line-height:1.55;color:#3a424c;">
            Hi${clientName ? ` ${escapeHtmlText(clientName)}` : ""},
          </p>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#3a424c;">
            Thank you — we received your card payment for
            <strong style="color:#1c2430;">${escapeHtmlText(title || label)} (${escapeHtmlText(number || "")})</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0 0;background:#f7f2e8;border:1px solid #e0d6c4;border-radius:12px;">
            <tr><td style="padding:16px;">
              <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Amount charged</div>
              <div style="margin-top:8px;font-size:28px;font-weight:700;color:#1c2430;">${escapeHtmlText(formatCadCents(totalCents))}</div>
              <p style="margin:12px 0 0;font-size:13px;line-height:1.55;color:#3a424c;">
                ${isInvoice ? "Invoice balance" : "Deposit"}: ${escapeHtmlText(formatCadCents(baseCents))}<br/>
                Card processing (3.5%): ${escapeHtmlText(formatCadCents(feeCents))}
              </p>
              ${
                paymentRef
                  ? `<p style="margin:10px 0 0;font-size:12px;color:#5c6570;">Reference: ${escapeHtmlText(paymentRef)}</p>`
                  : ""
              }
            </td></tr>
          </table>
          <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#5c6570;">
            ${
              isInvoice
                ? "This invoice is marked paid in our records."
                : "This kickoff deposit is on file. The balance will be invoiced separately."
            }
          </p>
          <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e6e1d6;font-size:12px;color:#5c6570;line-height:1.55;">
            Questions? Write <strong style="color:#1c2430;">${escapeHtmlText(COMPANY.email)}</strong>.<br/>
            — ${escapeHtmlText(COMPANY.name)} · ${escapeHtmlText(COMPANY.web)}
          </div>
        </td>
      </tr>
    </table>
  </div>
</body></html>`;
  const text = [
    `${COMPANY.name} — ${label} receipt`,
    "",
    `Hi${clientName ? ` ${clientName}` : ""},`,
    "",
    `Thank you — we received your card payment for ${title || label} (${number || ""}).`,
    "",
    `Amount charged: ${formatCadCents(totalCents)}`,
    `${isInvoice ? "Invoice balance" : "Deposit"}: ${formatCadCents(baseCents)}`,
    `Card processing (3.5%): ${formatCadCents(feeCents)}`,
    paymentRef ? `Reference: ${paymentRef}` : "",
    when ? `Paid: ${when}` : "",
    "",
    isInvoice
      ? "This invoice is marked paid in our records."
      : "This kickoff deposit is on file. The balance will be invoiced separately.",
    "",
    `Questions? ${COMPANY.email}`,
    `— ${COMPANY.name}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    subject: `Receipt · ${number || label} · ${formatCadCents(totalCents)}`,
    html,
    text,
  };
}

async function sendCardPaymentReceipt(env, {
  session,
  kind,
  number,
  title,
  clientName,
  leadId,
  billToEmail = "",
  baseCents,
  feeCents,
}) {
  const totalCents =
    Math.max(0, Math.round(Number(session?.amount_total) || 0)) || cardTotalCents(baseCents);
  const fee = Math.max(0, Math.round(Number(feeCents) || cardFeeCents(baseCents)));
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  let toEmail = stripeCheckoutCustomerEmail(session);
  if (!toEmail.includes("@") && billToEmail) toEmail = cleanText(billToEmail, 160).toLowerCase();
  if (!toEmail.includes("@") && leadId) {
    const lead = await getLead(env, leadId);
    toEmail = cleanText(lead?.email || "", 160).toLowerCase();
  }
  if (!toEmail.includes("@")) {
    return { status: "skipped", error: "No recipient email for receipt." };
  }
  const receipt = buildPaymentReceiptEmail({
    kind,
    number,
    title,
    clientName: clientName || session?.customer_details?.name || "",
    baseCents: base,
    feeCents: fee,
    totalCents,
    paymentRef:
      (typeof session?.payment_intent === "string"
        ? session.payment_intent
        : session?.payment_intent?.id) ||
      session?.id ||
      "",
    paidAt: session?.created
      ? new Date(Number(session.created) * 1000).toISOString()
      : nowIso(),
  });
  const logo = await logoInlineAttachment(env);
  const delivery = await deliverReminder(env, {
    toEmail,
    subject: receipt.subject,
    body: receipt.text,
    html: receipt.html,
    attachments: logo ? [logo] : undefined,
  });

  // Owner copy (best-effort)
  const ownerEmail = cleanText(
    env.CRM_OWNER_EMAIL || COMPANY.email || "",
    160
  ).toLowerCase();
  if (ownerEmail && ownerEmail !== toEmail) {
    await deliverReminder(env, {
      toEmail: ownerEmail,
      subject: `Paid · ${number || kind} · ${formatCadCents(totalCents)}`,
      body: [
        `Card payment received from ${clientName || toEmail}.`,
        "",
        `Type: ${kind === "invoice" ? "Invoice" : "Quote deposit"}`,
        `Number: ${number || "—"}`,
        `Charged: ${formatCadCents(totalCents)} (base ${formatCadCents(base)} + fee ${formatCadCents(fee)})`,
        `Client email: ${toEmail}`,
        "",
        `— ${COMPANY.name}`,
      ].join("\n"),
    }).catch(() => null);
  }
  return { ...delivery, toEmail };
}

async function verifyStripeWebhook(env, rawBody, signatureHeader) {
  const secret = cleanText(env.STRIPE_WEBHOOK_SECRET || "", 200);
  if (!secret) return { error: "Webhook secret not configured.", status: 503 };
  const header = String(signatureHeader || "");
  const timestamp = header
    .split(",")
    .map((p) => p.trim())
    .find((p) => p.startsWith("t="))
    ?.slice(2);
  const v1List = header
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3))
    .filter(Boolean);
  if (!timestamp || !v1List.length) return { error: "Invalid Stripe signature.", status: 400 };
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) {
    return { error: "Stripe signature timestamp too old.", status: 400 };
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`)
  );
  const expected = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const signatureOk = v1List.some((v1) => {
    if (expected.length !== v1.length) return false;
    let ok = 0;
    for (let i = 0; i < expected.length; i += 1) ok |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
    return ok === 0;
  });
  if (!signatureOk) return { error: "Invalid Stripe signature.", status: 400 };
  try {
    return { event: JSON.parse(rawBody) };
  } catch {
    return { error: "Invalid webhook payload.", status: 400 };
  }
}

async function insertDeposit(env, fields) {
  const id = newId("dep");
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO client_deposits
      (id, lead_id, quote_id, invoice_id, amount_cents, fee_cents, method, status,
       stripe_session_id, stripe_payment_intent, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      fields.leadId,
      fields.quoteId || null,
      fields.invoiceId || null,
      Math.max(0, Math.round(Number(fields.amountCents) || 0)),
      Math.max(0, Math.round(Number(fields.feeCents) || 0)),
      fields.method || "manual",
      fields.status || "received",
      fields.stripeSessionId || null,
      fields.stripePaymentIntent || null,
      cleanText(fields.note || "", 2000),
      ts,
      ts
    )
    .run();
  const row = await env.DB.prepare("SELECT * FROM client_deposits WHERE id = ?").bind(id).first();
  return rowToDeposit(row);
}

async function handleStripeCheckoutCompleted(env, session) {
  const meta = session?.metadata || {};
  const kind = cleanText(meta.kind, 20);
  const entityId = cleanText(meta.entityId, 64);
  const baseCents = Math.max(0, Math.round(Number(meta.baseCents) || 0));
  const feeCents = Math.max(0, Math.round(Number(meta.feeCents) || cardFeeCents(baseCents)));
  const sessionId = cleanText(session.id, 120);
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : cleanText(session.payment_intent?.id, 120);
  const paymentStatus = cleanText(session.payment_status, 40);
  if (paymentStatus && paymentStatus !== "paid") {
    return { ok: true, ignored: true, reason: `payment_status=${paymentStatus}` };
  }

  if (sessionId) {
    const existing = await env.DB.prepare(
      "SELECT id FROM client_deposits WHERE stripe_session_id = ?"
    )
      .bind(sessionId)
      .first()
      .catch(() => null);
    if (existing) return { ok: true, duplicate: true };
  }

  if (kind === "quote") {
    const quote = await getQuote(env, entityId);
    if (!quote?.leadId) return { error: "Quote not found for payment.", status: 404 };
    const already = await quoteHasActiveDeposit(env, quote.id);
    if (already) {
      // Don't silently accept a second deposit charge for the same quote.
      await recordActivity(env, quote.leadId, {
        kind: "payment",
        entityType: "quote",
        entityId: quote.id,
        summary: `Duplicate card checkout ignored · quote ${quote.number} already had a deposit (${formatCadCents(baseCents)})`,
        meta: { method: "card", sessionId, paymentIntent, duplicate: true },
        at: nowIso(),
      }).catch(() => null);
      return { ok: true, duplicate: true, reason: "quote_already_has_deposit" };
    }
    const deposit = await insertDeposit(env, {
      leadId: quote.leadId,
      quoteId: quote.id,
      amountCents: baseCents || quote.amountCents,
      feeCents,
      method: "card",
      status: "received",
      stripeSessionId: sessionId,
      stripePaymentIntent: paymentIntent,
      note: `Card deposit for quote ${quote.number}`,
    });
    await recordActivity(env, quote.leadId, {
      kind: "payment",
      entityType: "quote",
      entityId: quote.id,
      summary: `Card deposit received · ${formatCadCents(deposit.amountCents)} (fee ${formatCadCents(deposit.feeCents)})`,
      meta: { depositId: deposit.id, method: "card", sessionId },
      at: nowIso(),
    });
    let receipt = null;
    try {
      receipt = await sendCardPaymentReceipt(env, {
        session,
        kind: "quote",
        number: quote.number,
        title: quote.title,
        clientName: quote.clientName,
        leadId: quote.leadId,
        baseCents: deposit.amountCents,
        feeCents: deposit.feeCents,
      });
    } catch (err) {
      receipt = { status: "failed", error: String(err?.message || err) };
    }
    return { ok: true, deposit, receipt };
  }

  if (kind === "invoice") {
    const invoice = await getInvoice(env, entityId);
    if (!invoice?.leadId) return { error: "Invoice not found for payment.", status: 404 };

    if (invoice.status === "paid") {
      const credit = await insertDeposit(env, {
        leadId: invoice.leadId,
        amountCents: baseCents || 0,
        feeCents,
        method: "card",
        status: "received",
        stripeSessionId: sessionId,
        stripePaymentIntent: paymentIntent,
        note: `Card credit after invoice ${invoice.number} was already paid`,
      });
      await recordActivity(env, invoice.leadId, {
        kind: "payment",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `Card credit on paid invoice ${invoice.number} · ${formatCadCents(credit.amountCents)}`,
        meta: { depositId: credit.id, method: "card", sessionId, overpay: true },
        at: nowIso(),
      });
      let receipt = null;
      try {
        receipt = await sendCardPaymentReceipt(env, {
          session,
          kind: "invoice",
          number: invoice.number,
          title: invoice.title,
          clientName: invoice.clientName || invoice.billToName,
          leadId: invoice.leadId,
          billToEmail: invoice.billToEmail,
          baseCents: credit.amountCents,
          feeCents: credit.feeCents,
        });
      } catch (err) {
        receipt = { status: "failed", error: String(err?.message || err) };
      }
      return { ok: true, overpay: true, deposit: credit, receipt };
    }

    const appliedFromDeposits = await applyReceivedDepositsToInvoice(
      env,
      invoice.leadId,
      invoice.id,
      invoice.amountCents || 0
    );
    const stillDue = Math.max(0, (invoice.amountCents || 0) - appliedFromDeposits);
    const applyCard = Math.min(baseCents, stillDue);
    const leftoverCard = Math.max(0, baseCents - applyCard);
    const feeForApplied =
      baseCents > 0 ? Math.round((feeCents * applyCard) / baseCents) : 0;
    const feeLeft = Math.max(0, feeCents - feeForApplied);

    if (applyCard > 0) {
      await insertDeposit(env, {
        leadId: invoice.leadId,
        invoiceId: invoice.id,
        amountCents: applyCard,
        feeCents: feeForApplied,
        method: "card",
        status: "applied",
        stripeSessionId: leftoverCard > 0 ? null : sessionId,
        stripePaymentIntent: leftoverCard > 0 ? null : paymentIntent,
        note: `Card payment for invoice ${invoice.number}`,
      });
    }
    if (leftoverCard > 0 || (applyCard <= 0 && baseCents > 0)) {
      await insertDeposit(env, {
        leadId: invoice.leadId,
        amountCents: leftoverCard > 0 ? leftoverCard : baseCents,
        feeCents: leftoverCard > 0 ? feeLeft : feeCents,
        method: "card",
        status: "received",
        stripeSessionId: sessionId,
        stripePaymentIntent: paymentIntent,
        note:
          leftoverCard > 0
            ? `Leftover card credit after paying invoice ${invoice.number}`
            : `Card credit — invoice ${invoice.number} covered by deposits`,
      });
    }

    // Mark paid without re-entering deposit application via updateInvoice side-effects.
    await env.DB.prepare(`UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?`)
      .bind(nowIso(), invoice.id)
      .run();
    await recordActivity(env, invoice.leadId, {
      kind: "payment",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `Invoice ${invoice.number} paid by card · ${formatCadCents(baseCents)}`,
      meta: { method: "card", sessionId },
      at: nowIso(),
    });
    let receipt = null;
    try {
      receipt = await sendCardPaymentReceipt(env, {
        session,
        kind: "invoice",
        number: invoice.number,
        title: invoice.title,
        clientName: invoice.clientName || invoice.billToName,
        leadId: invoice.leadId,
        billToEmail: invoice.billToEmail,
        baseCents,
        feeCents,
      });
    } catch (err) {
      receipt = { status: "failed", error: String(err?.message || err) };
    }
    return { ok: true, receipt };
  }

  return { error: "Unknown payment kind.", status: 400 };
}

async function settleInvoiceIfCoveredByDeposits(env, invoice) {
  if (!invoice?.leadId || !invoice?.id || invoice.status === "paid") return invoice;
  if ((invoice.balanceDueCents || 0) > 0) return invoice;
  await applyReceivedDepositsToInvoice(
    env,
    invoice.leadId,
    invoice.id,
    invoice.amountCents || 0
  );
  await env.DB.prepare(`UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ? AND status != 'paid'`)
    .bind(nowIso(), invoice.id)
    .run();
  await recordActivity(env, invoice.leadId, {
    kind: "payment",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `Invoice ${invoice.number} settled from deposit credit`,
    meta: { method: "deposit" },
    at: nowIso(),
  });
  return getInvoice(env, invoice.id);
}

async function publicPayPreview(env, kind, token, requestUrl = "") {
  if (kind === "quote") {
    const row = await getQuoteByPayToken(env, token);
    if (!row) return { error: "This payment link is invalid or expired.", status: 404 };
    const quote = rowToQuote(row);
    const depositDueCents = quote.depositDueCents || quoteDepositDueCents(quote);
    const alreadyPaid = await quoteHasActiveDeposit(env, quote.id);
    const origin = publicAppOrigin(env, requestUrl);
    const signToken = cleanText(row.sign_token || "", 80);
    const signUrl = origin && signToken ? `${origin}/sign/q/${encodeURIComponent(signToken)}` : "";
    return {
      kind: "quote",
      number: quote.number,
      title: quote.title,
      clientName: quote.clientName,
      status: quote.status,
      amountCents: quote.amountCents,
      depositDueCents,
      baseCents: depositDueCents,
      cardFeeCents: cardFeeCents(depositDueCents),
      cardTotalCents: cardTotalCents(depositDueCents),
      accountingEmail: COMPANY.accountingEmail,
      alreadyPaid,
      needsSignature: quote.status !== "approved" && quote.status !== "declined",
      signUrl,
      company: {
        name: COMPANY.name,
        email: COMPANY.email,
        accountingEmail: COMPANY.accountingEmail,
        web: COMPANY.web,
        tagline: COMPANY.tagline,
      },
    };
  }
  if (kind === "invoice") {
    const row = await getInvoiceByPayToken(env, token);
    if (!row) return { error: "This payment link is invalid or expired.", status: 404 };
    let invoice = await enrichInvoicePayments(env, rowToInvoice(row));
    if (invoice.status !== "paid" && invoice.balanceDueCents <= 0) {
      invoice = (await settleInvoiceIfCoveredByDeposits(env, invoice)) || invoice;
    }
    return {
      kind: "invoice",
      number: invoice.number,
      title: invoice.title,
      clientName: invoice.clientName,
      status: invoice.status,
      amountCents: invoice.amountCents,
      depositAvailableCents: invoice.depositAvailableCents,
      baseCents: invoice.balanceDueCents,
      cardFeeCents: invoice.cardFeeCents,
      cardTotalCents: invoice.cardTotalCents,
      accountingEmail: COMPANY.accountingEmail,
      alreadyPaid: invoice.status === "paid" || invoice.balanceDueCents <= 0,
      company: {
        name: COMPANY.name,
        email: COMPANY.email,
        accountingEmail: COMPANY.accountingEmail,
        web: COMPANY.web,
        tagline: COMPANY.tagline,
      },
    };
  }
  return { error: "Unknown payment type.", status: 400 };
}

async function startPublicCheckout(env, body, requestUrl) {
  const kind = cleanText(body.kind, 20);
  const token = cleanText(body.token, 80);
  const preview = await publicPayPreview(env, kind, token, requestUrl);
  if (preview.error) return preview;
  if (preview.alreadyPaid) {
    return { error: "This is already paid — nothing left to charge.", status: 400 };
  }
  if ((preview.baseCents || 0) < 50) {
    return { error: "Amount is too small to charge by card.", status: 400 };
  }
  const origin = publicAppOrigin(env, requestUrl);
  if (!origin) return { error: "Missing request origin.", status: 400 };

  let entityId = "";
  let leadId = "";
  let signToken = "";
  if (kind === "quote") {
    const row = await getQuoteByPayToken(env, token);
    if (!row) return { error: "This payment link is invalid or expired.", status: 404 };
    if (row.status !== "approved") {
      const st = cleanText(row.sign_token || "", 80);
      const signUrl = st ? `${origin}/sign/q/${encodeURIComponent(st)}` : "";
      return {
        error: "Please sign and approve this quote before paying the deposit.",
        status: 400,
        needsSignature: true,
        signUrl,
      };
    }
    entityId = row.id;
    leadId = row.lead_id || "";
    signToken = cleanText(row.sign_token || "", 80);
  } else {
    const row = await getInvoiceByPayToken(env, token);
    if (!row) return { error: "This payment link is invalid or expired.", status: 404 };
    entityId = row.id;
    leadId = row.lead_id || "";
  }
  if (!leadId) {
    return { error: "This payment link is not linked to a client yet.", status: 400 };
  }

  const lead = await getLead(env, leadId);
  let customerEmail = cleanText(lead?.email || "", 160).toLowerCase();
  if (kind === "invoice" && !customerEmail.includes("@")) {
    const invoice = await getInvoice(env, entityId);
    customerEmail = cleanText(invoice?.billToEmail || "", 160).toLowerCase();
  }

  const pathPrefix = kind === "invoice" ? `/pay/i/${encodeURIComponent(token)}` : `/pay/q/${encodeURIComponent(token)}`;
  const quoteReturn = signToken ? `${origin}/sign/q/${encodeURIComponent(signToken)}` : `${origin}${pathPrefix}`;
  const session = await createStripeCheckoutSession(env, {
    kind,
    entityId,
    leadId,
    baseCents: preview.baseCents,
    number: preview.number,
    title: preview.title,
    customerEmail,
    successUrl: kind === "quote" ? `${quoteReturn}?paid=1` : `${origin}${pathPrefix}?paid=1`,
    cancelUrl: kind === "quote" ? `${quoteReturn}?cancelled=1` : `${origin}${pathPrefix}?cancelled=1`,
  });
  if (session.error) return session;
  return { url: session.session.url, sessionId: session.session.id };
}

async function createManualDeposit(env, leadId, body = {}) {
  const lead = await getLead(env, leadId);
  if (!lead) return { error: "Client not found.", status: 404 };
  const amountCents = moneyToCents(body.amountCents ?? body.amount, {
    alreadyCents: body.amountCents !== undefined,
  });
  if (amountCents <= 0) return { error: "Deposit amount must be greater than zero.", status: 400 };
  const method = normalizeDepositMethod(body.method) || "manual";
  const status = normalizeDepositStatus(body.status) || "received";
  const deposit = await insertDeposit(env, {
    leadId,
    quoteId: cleanText(body.quoteId ?? body.quote_id, 64) || null,
    invoiceId: cleanText(body.invoiceId ?? body.invoice_id, 64) || null,
    amountCents,
    feeCents: Math.max(0, Math.round(Number(body.feeCents) || 0)),
    method,
    status,
    note: cleanText(body.note, 2000),
  });
  await recordActivity(env, leadId, {
    kind: "payment",
    entityType: "deposit",
    entityId: deposit.id,
    summary: `Deposit recorded · ${formatCadCents(deposit.amountCents)} · ${deposit.method}`,
    meta: { depositId: deposit.id, method: deposit.method, status: deposit.status },
    at: nowIso(),
  });
  return { deposit };
}

async function updateDeposit(env, id, body = {}) {
  const row = await env.DB.prepare("SELECT * FROM client_deposits WHERE id = ?").bind(id).first();
  if (!row) return { error: "Deposit not found.", status: 404 };
  const amountCents =
    body.amountCents !== undefined || body.amount !== undefined
      ? moneyToCents(body.amountCents ?? body.amount, {
          alreadyCents: body.amountCents !== undefined,
        })
      : Number(row.amount_cents) || 0;
  if (amountCents < 0) return { error: "Amount cannot be negative.", status: 400 };
  const method = body.method !== undefined ? normalizeDepositMethod(body.method) : row.method;
  if (body.method !== undefined && !method) return { error: "Invalid deposit method.", status: 400 };
  const status = body.status !== undefined ? normalizeDepositStatus(body.status) : row.status;
  if (body.status !== undefined && !status) return { error: "Invalid deposit status.", status: 400 };
  const note = body.note !== undefined ? cleanText(body.note, 2000) : row.note || "";
  const invoiceId =
    body.invoiceId !== undefined || body.invoice_id !== undefined
      ? cleanText(body.invoiceId ?? body.invoice_id, 64) || null
      : row.invoice_id;
  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE client_deposits
     SET amount_cents = ?, method = ?, status = ?, note = ?, invoice_id = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(amountCents, method, status, note, invoiceId, ts, id)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM client_deposits WHERE id = ?").bind(id).first();
  return { deposit: rowToDeposit(updated) };
}

async function deleteDeposit(env, id) {
  const row = await env.DB.prepare("SELECT * FROM client_deposits WHERE id = ?").bind(id).first();
  if (!row) return { error: "Deposit not found.", status: 404 };
  await env.DB.prepare("DELETE FROM client_deposits WHERE id = ?").bind(id).run();
  return { ok: true };
}

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

function buildInvoiceLetterheadHtml(invoice, { absoluteLogoUrl = "", payUrl = "" } = {}) {
  const rows = (invoice.lineItems || [])
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e6e1d6;font-size:13px;color:#1c2430;word-break:break-word;">${escapeHtmlText(item.description)}</td>
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
  const header = emailBrandHeaderHtml({
    logoUrl: absoluteLogoUrl,
    kicker: "Invoice",
    number: invoice.number,
    detailHtml: `Issued ${escapeHtmlText(invoice.issueDate || "—")}<br/>Due ${escapeHtmlText(invoice.dueDate || "—")}`,
  });

  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${escapeHtmlText(invoice.number)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f5;color:#1c2430;">
  <div style="max-width:640px;margin:0 auto;padding:16px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border:1px solid #d7dde6;border-radius:12px;overflow:hidden;">
      <tr><td>${header}</td></tr>
      <tr>
        <td style="padding:24px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr>
            <td style="vertical-align:top;width:50%;padding:0 8px 12px 0;">
              <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">Bill to</div>
              <div style="margin-top:8px;font-size:14px;line-height:1.55;font-weight:600;word-break:break-word;">${billTo || "—"}</div>
            </td>
            <td style="vertical-align:top;width:50%;padding:0 0 12px 8px;">
              <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7340;font-weight:700;">For</div>
              <div style="margin-top:8px;font-size:14px;line-height:1.55;word-break:break-word;">${escapeHtmlText(invoice.title)}</div>
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
            <tr><td></td><td style="width:240px;max-width:100%;">
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
                <tr>
                  <td style="padding:6px 0;color:#5c6570;">Subtotal</td>
                  <td style="padding:6px 0;text-align:right;">${escapeHtmlText(formatCadCents(invoice.subtotalCents))}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#5c6570;">Tax (${escapeHtmlText(String(invoice.taxRate))}%)</td>
                  <td style="padding:6px 0;text-align:right;">${escapeHtmlText(formatCadCents(invoice.taxCents))}</td>
                </tr>
                ${
                  Number(invoice.depositAvailableCents) > 0
                    ? `<tr>
                  <td style="padding:6px 0;color:#5c6570;">Deposit applied</td>
                  <td style="padding:6px 0;text-align:right;">−${escapeHtmlText(formatCadCents(invoice.depositAvailableCents))}</td>
                </tr>`
                    : ""
                }
                <tr>
                  <td style="padding:12px 0 0;font-size:15px;font-weight:700;border-top:2px solid #1c2430;">Balance due</td>
                  <td style="padding:12px 0 0;text-align:right;font-size:15px;font-weight:700;border-top:2px solid #1c2430;">${escapeHtmlText(formatCadCents(invoice.balanceDueCents ?? invoice.amountCents))}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${
            invoice.notes
              ? `<div style="margin-top:22px;padding:14px 16px;background:#f7f2e8;border-radius:10px;font-size:12px;line-height:1.5;color:#3a424c;word-break:break-word;"><strong style="display:block;margin-bottom:4px;color:#8a7340;">Notes</strong>${escapeHtmlText(invoice.notes)}</div>`
              : ""
          }
          ${paymentInstructionsBlock({
            baseCents: invoice.balanceDueCents ?? invoice.amountCents,
            payUrl,
            number: invoice.number,
          }).html}
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e6e1d6;font-size:12px;color:#5c6570;line-height:1.55;">
            Thank you for your business — ${escapeHtmlText(COMPANY.name)} · ${escapeHtmlText(COMPANY.web)}
          </div>
        </td>
      </tr>
    </table>
  </div>
</body></html>`;
}

function buildInvoicePlainText(invoice, { payUrl = "" } = {}) {
  const lines = (invoice.lineItems || [])
    .map(
      (item) =>
        `- ${item.description} × ${item.qty} @ ${formatCadCents(item.unitCents)} = ${formatCadCents(Math.round(item.qty * item.unitCents))}`
    )
    .join("\n");
  const balance = invoice.balanceDueCents ?? invoice.amountCents;
  const pay = paymentInstructionsBlock({
    baseCents: balance,
    payUrl,
    number: invoice.number,
  });
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
    `Invoice total: ${formatCadCents(invoice.amountCents)}`,
    Number(invoice.depositAvailableCents) > 0
      ? `Deposit applied: −${formatCadCents(invoice.depositAvailableCents)}`
      : "",
    `Balance due: ${formatCadCents(balance)}`,
    invoice.notes ? `\nNotes: ${invoice.notes}` : "",
    "",
    pay.text,
    `— ${COMPANY.name}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function listQuotes(env, { status } = {}) {
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
  const filesByQuote = await listQuoteFilesByQuoteIds(
    env,
    quotes.map((quote) => quote.id)
  );
  const depositsByQuote = await listDepositSummariesByQuoteIds(
    env,
    quotes.map((quote) => quote.id)
  );
  return quotes.map((quote) => ({
    ...quote,
    documentIds: byQuote[quote.id] || [],
    files: filesByQuote[quote.id] || [],
    ...quoteDepositPaymentSummary(depositsByQuote[quote.id] || []),
  }));
}

async function getQuote(env, id) {
  const row = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(id).first();
  if (!row) return null;
  return enrichQuote(env, rowToQuote(row, { includeSignature: true }));
}

async function issueQuoteSignToken(env, quoteId, { resetSignature = true } = {}) {
  const token = newSignToken();
  const ts = nowIso();
  try {
    if (resetSignature) {
      await env.DB.prepare(
        `UPDATE quotes SET
          sign_token = ?, sign_token_created_at = ?,
          signed_at = NULL, signed_name = '', signature_png = NULL,
          signed_ip = NULL, signed_user_agent = NULL,
          updated_at = ?
         WHERE id = ?`
      )
        .bind(token, ts, ts, quoteId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE quotes SET
          sign_token = ?, sign_token_created_at = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(token, ts, ts, quoteId)
        .run();
    }
  } catch {
    // Columns missing until migration 0019.
    return null;
  }
  return token;
}

/** Keep existing sign token when present; never wipe a completed signature. */
async function ensureQuoteSignToken(env, quote) {
  const existing = cleanText(quote?.signToken || quote?.sign_token || "", 80);
  if (existing) return existing;
  return issueQuoteSignToken(env, quote.id, { resetSignature: false });
}

function isValidSignaturePng(dataUrl) {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/png;base64,")) return false;
  if (raw.length < 800 || raw.length > 180000) return false;
  return true;
}

async function getQuoteBySignToken(env, token) {
  const clean = cleanText(token, 80);
  if (!clean) return null;
  try {
    const row = await env.DB.prepare("SELECT * FROM quotes WHERE sign_token = ?").bind(clean).first();
    return row || null;
  } catch {
    return null;
  }
}

function publicQuotePayload(row, { payUrl = "", signUrl = "", alreadyPaid = false } = {}) {
  const quote = rowToQuote(row, { includeSignature: true });
  const depositDueCents = quote.depositDueCents || quoteDepositDueCents(quote);
  return {
    number: quote.number,
    title: quote.title,
    clientName: quote.clientName,
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    discountLabel: quote.discountLabel || "",
    discountNote: quote.discountNote || "",
    amountCents: quote.amountCents,
    amountLabel: formatCadCents(quote.amountCents),
    depositDueCents,
    depositDueLabel: formatCadCents(depositDueCents),
    cardFeeCents: cardFeeCents(depositDueCents),
    cardTotalCents: cardTotalCents(depositDueCents),
    cardTotalLabel: formatCadCents(cardTotalCents(depositDueCents)),
    payUrl: payUrl || "",
    signUrl: signUrl || "",
    alreadyPaid: Boolean(alreadyPaid),
    accountingEmail: COMPANY.accountingEmail,
    lineItems: quote.lineItems || [],
    notes: quote.notes,
    terms: quote.terms || "",
    addendums: quote.addendums || "",
    status: quote.status,
    signedAt: quote.signedAt,
    signedName: quote.signedName,
    hasSignature: quote.hasSignature,
    signaturePng: quote.hasSignature ? quote.signaturePng : "",
    company: {
      name: COMPANY.name,
      email: COMPANY.email,
      accountingEmail: COMPANY.accountingEmail,
      web: COMPANY.web,
      location: COMPANY.location,
      tagline: COMPANY.tagline,
    },
  };
}

function quoteOwnerNotifyEmail(env, row) {
  return cleanText(
    row?.owner_email || env.CRM_OWNER_EMAIL || COMPANY.email || "brad@vanderven.ca",
    160
  ).toLowerCase();
}

async function notifyQuoteOwnerDecision(env, row, { action, signedName }) {
  const toEmail = quoteOwnerNotifyEmail(env, row);
  if (!toEmail) return;
  const label = action === "approve" ? "approved and signed" : "declined";
  const subject = `Quote ${row.number} ${label}`;
  const amount =
    row.amount_cents != null
      ? formatCadCents(Number(row.amount_cents) || 0)
      : "";
  const body = [
    `Quote ${row.number} — ${row.title || "Quote"}`,
    `Client: ${row.client_name || "Client"}`,
    amount ? `Amount: ${amount}` : "",
    `Status: ${label}`,
    action === "approve" && signedName ? `Signed by: ${signedName}` : "",
    "",
    `Open in CRM: /app/#quotes?id=${row.id}`,
    `— ${COMPANY.name}`,
  ]
    .filter(Boolean)
    .join("\n");
  await deliverReminder(env, { toEmail, subject, body });
}

async function notifyQuoteOwnerFirstView(env, row) {
  const toEmail = quoteOwnerNotifyEmail(env, row);
  if (!toEmail) return;
  const subject = `Quote ${row.number} viewed by client`;
  const body = [
    `Your client opened quote ${row.number} for the first time.`,
    "",
    `Quote: ${row.title || "Quote"}`,
    `Client: ${row.client_name || "Client"}`,
    "",
    `They have not signed yet — you'll get another email when they approve or decline.`,
    "",
    `Open in CRM: /app/#quotes?id=${row.id}`,
    `— ${COMPANY.name}`,
  ].join("\n");
  await deliverReminder(env, { toEmail, subject, body });
}

/** Record first client open of the public sign link and email the owner once. */
async function markQuoteClientViewed(env, row) {
  if (!row?.id || row.client_viewed_at) return row;
  const openStatuses = new Set(["sent", "revisions_requested", "approved", "declined"]);
  if (!openStatuses.has(row.status)) return row;
  const ts = nowIso();
  try {
    const result = await env.DB.prepare(
      `UPDATE quotes
       SET client_viewed_at = ?, updated_at = ?
       WHERE id = ? AND (client_viewed_at IS NULL OR client_viewed_at = '')`
    )
      .bind(ts, ts, row.id)
      .run();
    if (!result.meta?.changes) return row;
  } catch {
    return row;
  }
  const updated = { ...row, client_viewed_at: ts, updated_at: ts };
  if (row.lead_id) {
    try {
      await recordActivity(env, row.lead_id, {
        kind: "quote",
        entityType: "quote",
        entityId: row.id,
        summary: `Quote ${row.number} opened by client`,
        meta: { via: "signature_link", firstView: true },
        at: ts,
      });
    } catch {
      /* ignore */
    }
  }
  try {
    await notifyQuoteOwnerFirstView(env, updated);
  } catch {
    /* ignore notify failures */
  }
  return updated;
}

async function publicQuotePayloadWithPay(env, row, requestUrl = "") {
  const payToken = row.pay_token || (await issueEntityPayToken(env, "quotes", row.id));
  const origin = publicAppOrigin(env, requestUrl);
  const payUrl = origin && payToken ? `${origin}/pay/q/${encodeURIComponent(payToken)}` : "";
  const signToken = cleanText(row.sign_token || "", 80);
  const signUrl = origin && signToken ? `${origin}/sign/q/${encodeURIComponent(signToken)}` : "";
  const alreadyPaid = await quoteHasActiveDeposit(env, row.id);
  return publicQuotePayload(row, { payUrl, signUrl, alreadyPaid });
}

async function signQuotePublic(env, body, request) {
  const token = cleanText(body.token, 80);
  const action = String(body.action || "").toLowerCase().trim();
  if (!token) return { error: "Missing signing link.", status: 400 };
  if (action !== "approve" && action !== "decline") {
    return { error: "Choose approve or decline.", status: 400 };
  }

  const row = await getQuoteBySignToken(env, token);
  if (!row) return { error: "This signing link is invalid or expired.", status: 404 };

  if (row.status === "approved" || row.status === "declined") {
    return {
      ok: true,
      alreadyDone: true,
      quote: await publicQuotePayloadWithPay(env, row, request.url),
    };
  }
  if (row.status !== "sent" && row.status !== "revisions_requested") {
    return { error: "This quote is not open for signature.", status: 400 };
  }

  const ts = nowIso();
  const ip = cleanText(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "", 80);
  const ua = cleanText(request.headers.get("User-Agent") || "", 300);

  if (action === "decline") {
    await env.DB.prepare(
      `UPDATE quotes SET status = 'declined', updated_at = ? WHERE id = ?`
    )
      .bind(ts, row.id)
      .run();
    if (row.lead_id) {
      await recordActivity(env, row.lead_id, {
        kind: "quote_status",
        entityType: "quote",
        entityId: row.id,
        summary: `Quote ${row.number} declined by client`,
        meta: { via: "signature_link" },
        at: ts,
      });
    }
    const updated = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(row.id).first();
    try {
      await notifyQuoteOwnerDecision(env, updated || row, { action: "decline" });
    } catch {
      /* ignore notify failures */
    }
    return { ok: true, quote: await publicQuotePayloadWithPay(env, updated || row, request.url) };
  }

  const signedName = cleanText(body.signedName ?? body.signed_name, 120);
  const signaturePng = String(body.signaturePng ?? body.signature_png ?? "").trim();
  if (!signedName || signedName.length < 2) {
    return { error: "Type your full name to sign.", status: 400 };
  }
  if (!isValidSignaturePng(signaturePng)) {
    return { error: "Draw your signature before approving.", status: 400 };
  }

  await env.DB.prepare(
    `UPDATE quotes SET
      status = 'approved',
      signed_at = ?, signed_name = ?, signature_png = ?,
      signed_ip = ?, signed_user_agent = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(ts, signedName, signaturePng, ip, ua, ts, row.id)
    .run();

  if (row.lead_id) {
    await recordActivity(env, row.lead_id, {
      kind: "quote_status",
      entityType: "quote",
      entityId: row.id,
      summary: `Quote ${row.number} approved & signed by ${signedName}`,
      meta: { via: "signature_link", signedName },
      at: ts,
    });
    try {
      await env.DB.prepare("UPDATE leads SET stage = ?, updated_at = ? WHERE id = ? AND stage != ?")
        .bind("active", ts, row.lead_id, "won")
        .run();
    } catch {
      /* stage update best-effort */
    }
  }

  const updated = await env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(row.id).first();
  try {
    await notifyQuoteOwnerDecision(env, updated || row, { action: "approve", signedName });
  } catch {
    /* ignore */
  }
  return { ok: true, quote: await publicQuotePayloadWithPay(env, updated || row, request.url) };
}

/** Distinctive base so the first quote isn't Q-1 — easy to spot in search/lists. */
const QUOTE_NUMBER_START = 4827;

async function nextQuoteNumber(env) {
  const rows = await env.DB.prepare("SELECT number FROM quotes").all();
  let max = QUOTE_NUMBER_START - 1;
  for (const row of rows.results || []) {
    const match = String(row.number || "").match(/^Q-(\d+)$/i);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `Q-${max + 1}`;
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
  const number = await nextQuoteNumber(env);
  const ownerEmail =
    cleanText(body.ownerEmail ?? body.owner_email, 160) || settings.ownerEmail || "";
  const sentAt = status === "sent" ? ts : null;
  const pricing = resolveQuotePricing(body, null);
  const depositCents = resolveQuoteDepositCents(body, pricing.amountCents, null);
  try {
    await env.DB.prepare(
      `INSERT INTO quotes
        (id, lead_id, number, title, client_name, status, amount_cents, deposit_cents, notes, terms, addendums,
         line_items_json, discount_cents, discount_label, discount_note, sent_at, owner_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        leadId,
        number,
        title,
        cleanText(body.clientName ?? body.client_name, 160),
        status,
        pricing.amountCents,
        depositCents,
        cleanText(body.notes, 4000),
        pricing.terms,
        pricing.addendums,
        JSON.stringify(pricing.lineItems),
        pricing.discountCents,
        pricing.discountLabel,
        pricing.discountNote,
        sentAt,
        ownerEmail,
        ts,
        ts
      )
      .run();
  } catch {
    await env.DB.prepare(
      `INSERT INTO quotes
        (id, lead_id, number, title, client_name, status, amount_cents, notes, terms, addendums,
         line_items_json, discount_cents, discount_label, discount_note, sent_at, owner_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        leadId,
        number,
        title,
        cleanText(body.clientName ?? body.client_name, 160),
        status,
        pricing.amountCents,
        cleanText(body.notes, 4000),
        pricing.terms,
        pricing.addendums,
        JSON.stringify(pricing.lineItems),
        pricing.discountCents,
        pricing.discountLabel,
        pricing.discountNote,
        sentAt,
        ownerEmail,
        ts,
        ts
      )
      .run();
  }
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

  const pricing = resolveQuotePricing(body, existing);
  const depositCents = resolveQuoteDepositCents(body, pricing.amountCents, existing);
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
    amount_cents: pricing.amountCents,
    deposit_cents: depositCents,
    notes: body.notes !== undefined ? cleanText(body.notes, 4000) : existing.notes,
    terms: pricing.terms,
    addendums: pricing.addendums,
    line_items_json: JSON.stringify(pricing.lineItems),
    discount_cents: pricing.discountCents,
    discount_label: pricing.discountLabel,
    discount_note: pricing.discountNote,
    sent_at: sentAt,
    owner_email:
      body.ownerEmail !== undefined || body.owner_email !== undefined
        ? cleanText(body.ownerEmail ?? body.owner_email, 160)
        : existing.owner_email || "",
    updated_at: nowIso(),
  };
  try {
    await env.DB.prepare(
      `UPDATE quotes SET
        lead_id = ?, number = ?, title = ?, client_name = ?, status = ?, amount_cents = ?, deposit_cents = ?,
        notes = ?, terms = ?, addendums = ?, line_items_json = ?,
        discount_cents = ?, discount_label = ?, discount_note = ?,
        sent_at = ?, owner_email = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        updated.lead_id,
        updated.number,
        updated.title,
        updated.client_name,
        updated.status,
        updated.amount_cents,
        updated.deposit_cents,
        updated.notes,
        updated.terms,
        updated.addendums,
        updated.line_items_json,
        updated.discount_cents,
        updated.discount_label,
        updated.discount_note,
        updated.sent_at,
        updated.owner_email,
        updated.updated_at,
        id
      )
      .run();
  } catch {
    await env.DB.prepare(
      `UPDATE quotes SET
        lead_id = ?, number = ?, title = ?, client_name = ?, status = ?, amount_cents = ?,
        notes = ?, terms = ?, addendums = ?, line_items_json = ?,
        discount_cents = ?, discount_label = ?, discount_note = ?,
        sent_at = ?, owner_email = ?, updated_at = ?
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
        updated.terms,
        updated.addendums,
        updated.line_items_json,
        updated.discount_cents,
        updated.discount_label,
        updated.discount_note,
        updated.sent_at,
        updated.owner_email,
        updated.updated_at,
        id
      )
      .run();
  }
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

async function sendQuote(env, id, requestUrl, senderUser = null) {
  const quote = await getQuote(env, id);
  if (!quote) return { error: "Quote not found.", status: 404 };
  if (!quote.leadId) {
    return { error: "Link a client before sending this quote.", status: 400 };
  }
  if (quote.status === "approved") {
    return {
      error:
        "This quote is already approved and signed. Don’t Send again — that would reopen signing. Use Copy pay link if they still need to pay.",
      status: 400,
    };
  }
  if (quote.status === "declined") {
    return {
      error: "This quote was declined. Duplicate it or create a new quote to send another offer.",
      status: 400,
    };
  }
  if (quote.alreadyPaid || (Number(quote.depositPaidCents) || 0) > 0) {
    return {
      error: "A deposit is already on file for this quote. Don’t Send again.",
      status: 400,
    };
  }
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(quote.leadId).first();
  const toEmail = cleanText(lead?.email || "", 160).toLowerCase();
  if (!toEmail) {
    return { error: "Add an email on the client before sending the quote.", status: 400 };
  }

  // Reuse the existing sign token on resend so older email links keep working.
  // Never clear a signature here (approved is blocked above).
  const signToken = await ensureQuoteSignToken(env, quote);
  if (!signToken) {
    return {
      error: "Quote signing is not ready yet. Apply database migrations and try again.",
      status: 503,
    };
  }
  const payToken = await issueEntityPayToken(env, "quotes", id);

  const documents = await documentsForQuote(env, quote);
  const fileRows = await env.DB.prepare("SELECT * FROM quote_files WHERE quote_id = ?")
    .bind(id)
    .all()
    .then((r) => r.results || [])
    .catch(() => []);
  const origin = publicAppOrigin(env, requestUrl);
  const logoInline = await logoInlineAttachment(env);
  const logoUrl = logoInline
    ? "cid:vds-logo"
    : origin
      ? `${origin}/public/logo-mark-nav-transparent.png`
      : "";
  const signUrl = origin ? `${origin}/sign/q/${encodeURIComponent(signToken)}` : "";
  const payUrl =
    origin && payToken ? `${origin}/pay/q/${encodeURIComponent(payToken)}` : "";
  const customDocs = fileRows.map((row) => ({
    title: row.file_name,
    summary: "Additional attachment",
    kind: "file",
  }));
  const html = buildQuoteLetterheadHtml(quote, [...documents, ...customDocs], {
    absoluteLogoUrl: logoUrl,
    signUrl,
    payUrl,
  });
  const text = buildQuotePlainText(quote, [...documents, ...customDocs], { signUrl, payUrl });
  const libraryAttachments = await Promise.all(
    documents.map((doc) => documentAttachmentPayload(env, doc, requestUrl))
  );
  const missingDoc = libraryAttachments.find((item) => item?.error);
  if (missingDoc) {
    return { error: missingDoc.error, status: missingDoc.status || 502 };
  }
  const uploadedAttachments = (
    await Promise.all(fileRows.map((row) => quoteFileAttachmentPayload(env, row)))
  ).filter(Boolean);
  const attachments = [
    ...libraryAttachments,
    ...uploadedAttachments,
    ...(logoInline ? [logoInline] : []),
  ];
  const delivery = await deliverReminder(env, {
    toEmail,
    subject: `Quote ${quote.number} from ${COMPANY.name} — review & sign`,
    body: text,
    html,
    attachments,
    from: formatOutboundFrom(senderUser, env),
    replyTo: senderUser?.email || "",
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
      summary: `Quote ${result.quote.number} sent to ${toEmail} · awaiting signature${
        attachments.length ? ` · ${attachments.length} attachment(s)` : ""
      }`,
      meta: {
        channel: delivery.channel,
        status: delivery.status,
        documentIds: result.quote.documentIds || [],
        signUrl: Boolean(signUrl),
      },
      at: nowIso(),
    });
  }
  return { quote: result.quote, delivery, documents, signUrl, payUrl };
}

async function deleteQuote(env, id) {
  await deleteQuoteFilesForQuote(env, id);
  const result = await env.DB.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Quote not found.", status: 404 };
  return { ok: true };
}

async function listInvoices(env, { status } = {}) {
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
  const invoices = (result.results || []).map(rowToInvoice);
  return Promise.all(invoices.map((invoice) => enrichInvoicePayments(env, invoice)));
}

async function getInvoice(env, id) {
  const row = await env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first();
  return row ? enrichInvoicePayments(env, rowToInvoice(row)) : null;
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
  let invoice = await getInvoice(env, id);
  if (invoice?.leadId && existing.status !== invoice.status) {
    if (invoice.status === "paid") {
      await applyReceivedDepositsToInvoice(
        env,
        invoice.leadId,
        invoice.id,
        invoice.amountCents || 0
      );
      invoice = await getInvoice(env, id);
    }
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

async function sendInvoice(env, id, requestUrl, senderUser = null) {
  const invoice = await getInvoice(env, id);
  if (!invoice) return { error: "Invoice not found.", status: 404 };
  const toEmail = cleanText(invoice.billToEmail, 160).toLowerCase();
  if (!toEmail) {
    return { error: "Add a bill-to email before sending.", status: 400 };
  }
  const payToken = await issueEntityPayToken(env, "invoices", id);
  const origin = publicAppOrigin(env, requestUrl);
  const logoInline = await logoInlineAttachment(env);
  const logoUrl = logoInline
    ? "cid:vds-logo"
    : origin
      ? `${origin}/public/logo-mark-nav-transparent.png`
      : "";
  const payUrl =
    origin && payToken ? `${origin}/pay/i/${encodeURIComponent(payToken)}` : "";
  const html = buildInvoiceLetterheadHtml(invoice, { absoluteLogoUrl: logoUrl, payUrl });
  const text = buildInvoicePlainText(invoice, { payUrl });
  const delivery = await deliverReminder(env, {
    toEmail,
    subject: `Invoice ${invoice.number} from ${COMPANY.name}`,
    body: text,
    html,
    attachments: logoInline ? [logoInline] : [],
    from: formatOutboundFrom(senderUser, env),
    replyTo: senderUser?.email || "",
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
      meta: { channel: delivery.channel, status: delivery.status, payUrl: Boolean(payUrl) },
      at: nowIso(),
    });
  }
  return { invoice: result.invoice, delivery, payUrl };
}

async function deleteInvoice(env, id) {
  const result = await env.DB.prepare("DELETE FROM invoices WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) return { error: "Invoice not found.", status: 404 };
  return { ok: true };
}

/* —— ElevenLabs phone agent ↔ CRM —— */

function normalizePhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function phonesMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const min = Math.min(left.length, right.length);
  if (min < 7) return false;
  return left.slice(-10) === right.slice(-10) || left.endsWith(right) || right.endsWith(left);
}

function getElevenLabsAgentSecret(env) {
  return cleanText(env.ELEVENLABS_AGENT_SECRET || "", 200);
}

function getElevenLabsWebhookSecret(env) {
  return cleanText(env.ELEVENLABS_WEBHOOK_SECRET || env.ELEVENLABS_AGENT_SECRET || "", 200);
}

function verifyAgentSecret(request, env) {
  const expected = getElevenLabsAgentSecret(env);
  if (!expected) return false;
  const header =
    request.headers.get("X-Vanderven-Agent-Secret") ||
    request.headers.get("x-vanderven-agent-secret") ||
    "";
  const auth = request.headers.get("Authorization") || "";
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  return header === expected || bearer === expected;
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyElevenLabsSignature(rawBody, sigHeader, secret) {
  if (!secret || !sigHeader) return false;
  const parts = {};
  for (const piece of String(sigHeader).split(",")) {
    const idx = piece.indexOf("=");
    if (idx === -1) continue;
    parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  const timestamp = parts.t;
  const signature = parts.v0;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 30 * 60) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function findLeadByPhone(env, phone) {
  const want = normalizePhoneDigits(phone);
  if (!want || want.length < 7) return null;
  try {
    const result = await env.DB.prepare("SELECT * FROM leads WHERE IFNULL(phone, '') != ''").all();
    for (const row of result.results || []) {
      if (phonesMatch(row.phone, want)) return rowToLead(row);
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function findLeadByQuery(env, { phone, email, name, business, leadId } = {}) {
  if (leadId) {
    const lead = await getLead(env, cleanText(leadId, 64));
    if (lead) return lead;
  }
  if (phone) {
    const byPhone = await findLeadByPhone(env, phone);
    if (byPhone) return byPhone;
  }
  const mail = cleanText(email, 160).toLowerCase();
  if (mail) {
    try {
      const row = await env.DB.prepare("SELECT * FROM leads WHERE lower(email) = ? LIMIT 1")
        .bind(mail)
        .first();
      if (row) return rowToLead(row);
    } catch {
      /* ignore */
    }
  }
  const q = cleanText(name || business, 120);
  if (q) {
    const leads = await listLeads(env, { q });
    if (leads.length === 1) return leads[0];
    if (leads.length > 1) {
      const lower = q.toLowerCase();
      const exact = leads.find(
        (l) =>
          String(l.name || "").toLowerCase() === lower ||
          String(l.business || "").toLowerCase() === lower
      );
      if (exact) return exact;
      return leads[0];
    }
  }
  return null;
}

function formatLeadNotesBrief(notes, limit = 5) {
  if (!notes?.length) return "No notes on file.";
  return notes
    .slice(0, limit)
    .map((n, i) => {
      const when = n.createdAt ? n.createdAt.slice(0, 10) : "";
      const kind = n.kind && n.kind !== "note" ? `[${n.kind}] ` : "";
      return `${i + 1}. ${when} ${kind}${cleanText(n.body, 400)}`.trim();
    })
    .join("\n");
}

async function buildCallerContext(env, callerId) {
  const phone = cleanText(callerId, 40);
  const emptyVars = {
    lead_found: "no",
    lead_id: "",
    caller_phone: phone || "",
    caller_name: "",
    caller_business: "",
    caller_email: "",
    caller_stage: "",
    caller_industry: "",
    caller_notes: "No matching CRM record for this number.",
    caller_summary: "Unknown caller. Collect name, business, and best callback number.",
    contact_name: "",
    business_name: "",
    industry: "",
    last_contact_date: "",
    last_offer: "",
    stall_reason: "",
    pain_point: "",
    last_price: "",
    agent_name: "Vera",
    booking_link: "https://vanderven.ca/contact.html",
  };

  const lead = phone ? await findLeadByPhone(env, phone) : null;
  if (!lead) {
    return {
      type: "conversation_initiation_client_data",
      dynamic_variables: emptyVars,
    };
  }

  const notes = await listLeadNotes(env, lead.id);
  const notesBrief = formatLeadNotesBrief(notes, 6);
  const latestNote = notes[0] || null;
  const lastContactDate = (latestNote?.createdAt || lead.updatedAt || lead.createdAt || "").slice(0, 10);
  const summary = [
    `${lead.name || "Contact"} at ${lead.business || "unknown business"}`,
    lead.stage ? `Stage: ${lead.stage}` : "",
    lead.industry ? `Industry: ${lead.industry}` : "",
    lead.email ? `Email: ${lead.email}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  // Map structured CRM fields into the agent's prompt variables.
  // Richer sales history (offer / stall / price) lives in notes until those fields exist.
  return {
    type: "conversation_initiation_client_data",
    user_id: lead.id,
    dynamic_variables: {
      lead_found: "yes",
      lead_id: lead.id,
      caller_phone: lead.phone || phone || "",
      caller_name: lead.name || "",
      caller_business: lead.business || "",
      caller_email: lead.email || "",
      caller_stage: lead.stage || "",
      caller_industry: lead.industry || "",
      caller_notes: notesBrief,
      caller_summary: summary,
      contact_name: lead.name || "",
      business_name: lead.business || "",
      industry: lead.industry || "",
      last_contact_date: lastContactDate,
      last_offer: "",
      stall_reason: lead.stage === "lost" ? "Previously marked lost / not proceeding" : "",
      pain_point: cleanText(lead.notes, 400),
      last_price: "",
      agent_name: "Vera",
      booking_link: "https://vanderven.ca/contact.html",
    },
  };
}

function extractToolParams(body = {}) {
  if (body.parameters && typeof body.parameters === "object") return body.parameters;
  return body;
}

function formatTranscriptText(data = {}) {
  const summary = cleanText(data?.analysis?.transcript_summary, 2000);
  const turns = Array.isArray(data?.transcript) ? data.transcript : [];
  const lines = turns
    .map((turn) => {
      const role = cleanText(turn?.role, 20) || "unknown";
      const message = cleanText(turn?.message, 2000);
      if (!message) return "";
      return `${role}: ${message}`;
    })
    .filter(Boolean);
  const transcript = lines.join("\n");
  const parts = [];
  if (summary) parts.push(`Summary:\n${summary}`);
  if (transcript) parts.push(`Transcript:\n${transcript}`);
  if (!parts.length) parts.push("Call completed (no transcript text available).");
  const conversationId = cleanText(data?.conversation_id, 80);
  if (conversationId) parts.unshift(`ElevenLabs conversation: ${conversationId}`);
  return parts.join("\n\n").slice(0, 12000);
}

function extractCallerPhoneFromElevenLabs(data = {}) {
  const meta = data.metadata || {};
  const phone =
    meta.caller_id ||
    meta.from_number ||
    meta.phone_number ||
    meta?.phone_call?.external_number ||
    meta?.phone_call?.agent_number ||
    data?.conversation_initiation_client_data?.dynamic_variables?.caller_phone ||
    data?.conversation_initiation_client_data?.dynamic_variables?.system__caller_id ||
    "";
  return cleanText(phone, 40);
}

function recordingPath(conversationId) {
  return `/api/calls/${cleanText(conversationId, 80)}/audio`;
}

function recordingMarker(conversationId) {
  return `Recording: ${recordingPath(conversationId)}`;
}

function base64ToBytes(b64) {
  const cleaned = String(b64 || "").replace(/\s+/g, "");
  if (!cleaned) return null;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getCallRecording(env, conversationId) {
  const id = cleanText(conversationId, 80);
  if (!id || !env.DB) return null;
  try {
    return await env.DB.prepare("SELECT * FROM call_recordings WHERE conversation_id = ?")
      .bind(id)
      .first();
  } catch {
    return null;
  }
}

async function upsertCallRecording(
  env,
  { conversationId, leadId = null, noteId = null, r2Key = null, contentType = null, byteSize = 0 } = {}
) {
  const idKey = cleanText(conversationId, 80);
  if (!idKey || !env.DB) return null;
  const ts = nowIso();
  const existing = await getCallRecording(env, idKey);
  try {
    if (existing) {
      await env.DB.prepare(
        `UPDATE call_recordings
         SET lead_id = COALESCE(?, lead_id),
             note_id = COALESCE(?, note_id),
             r2_key = COALESCE(?, r2_key),
             content_type = COALESCE(?, content_type),
             byte_size = CASE WHEN ? > 0 THEN ? ELSE byte_size END,
             updated_at = ?
         WHERE conversation_id = ?`
      )
        .bind(
          leadId || null,
          noteId || null,
          r2Key || null,
          contentType || null,
          Number(byteSize) || 0,
          Number(byteSize) || 0,
          ts,
          idKey
        )
        .run();
      return getCallRecording(env, idKey);
    }
    const id = newId("call");
    await env.DB.prepare(
      `INSERT INTO call_recordings
        (id, conversation_id, lead_id, note_id, r2_key, content_type, byte_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        idKey,
        leadId || null,
        noteId || null,
        r2Key || null,
        contentType || "audio/mpeg",
        Number(byteSize) || 0,
        ts,
        ts
      )
      .run();
    return getCallRecording(env, idKey);
  } catch (err) {
    console.error("upsertCallRecording failed", err);
    return null;
  }
}

async function appendRecordingMarkerToNote(env, noteId, conversationId) {
  const id = cleanText(noteId, 64);
  const conv = cleanText(conversationId, 80);
  if (!id || !conv || !env.DB) return;
  const marker = recordingMarker(conv);
  try {
    const row = await env.DB.prepare("SELECT body FROM lead_notes WHERE id = ?").bind(id).first();
    if (!row) return;
    const body = String(row.body || "");
    if (body.includes(marker)) return;
    const next = `${body}\n\n${marker}`.slice(0, 12000);
    await env.DB.prepare("UPDATE lead_notes SET body = ?, updated_at = ? WHERE id = ?")
      .bind(next, nowIso(), id)
      .run();
  } catch {
    /* ignore */
  }
}

async function listCallRecordingsForLead(env, leadId) {
  try {
    const result = await env.DB.prepare(
      `SELECT conversation_id, note_id, r2_key, content_type, byte_size, created_at
       FROM call_recordings
       WHERE lead_id = ? AND IFNULL(r2_key, '') != ''
       ORDER BY created_at DESC`
    )
      .bind(leadId)
      .all();
    return (result.results || []).map((row) => ({
      conversationId: row.conversation_id,
      noteId: row.note_id || "",
      audioUrl: recordingPath(row.conversation_id),
      contentType: row.content_type || "audio/mpeg",
      byteSize: row.byte_size || 0,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

async function handleElevenLabsPostCallAudio(env, data = {}) {
  if (!env.CALL_AUDIO) {
    return json(
      { ok: false, error: "CALL_AUDIO R2 binding is not configured. Enable R2 and redeploy." },
      { status: 503 }
    );
  }
  const conversationId = cleanText(data.conversation_id, 80);
  const audioB64 = data.full_audio || data.audio || "";
  if (!conversationId || !audioB64) {
    return badRequest("conversation_id and full_audio are required.");
  }
  const bytes = base64ToBytes(audioB64);
  if (!bytes?.length) return badRequest("Invalid audio payload.");

  const r2Key = `calls/${conversationId}.mp3`;
  await env.CALL_AUDIO.put(r2Key, bytes, {
    httpMetadata: { contentType: "audio/mpeg" },
    customMetadata: {
      conversationId,
      agentId: cleanText(data.agent_id, 80),
    },
  });

  let existing = await getCallRecording(env, conversationId);
  let leadId = existing?.lead_id || cleanText(data.user_id, 64) || null;
  if (leadId) {
    const lead = await getLead(env, leadId);
    if (!lead) leadId = null;
  }

  const row = await upsertCallRecording(env, {
    conversationId,
    leadId,
    noteId: existing?.note_id || null,
    r2Key,
    contentType: "audio/mpeg",
    byteSize: bytes.length,
  });

  if (row?.note_id) {
    await appendRecordingMarkerToNote(env, row.note_id, conversationId);
  } else if (leadId) {
    const saved = await addLeadNote(
      env,
      leadId,
      {
        body: `Call recording attached.\nElevenLabs conversation: ${conversationId}\n\n${recordingMarker(
          conversationId
        )}`,
        kind: "call",
      },
      { author: "Vera (phone)", kind: "call" }
    );
    if (saved.note?.id) {
      await upsertCallRecording(env, {
        conversationId,
        leadId,
        noteId: saved.note.id,
        r2Key,
        contentType: "audio/mpeg",
        byteSize: bytes.length,
      });
    }
  }

  return json({
    ok: true,
    conversation_id: conversationId,
    lead_id: row?.lead_id || leadId || "",
    bytes: bytes.length,
  });
}

async function handleElevenLabsPostCallTranscript(env, data = {}) {
  const conversationId = cleanText(data.conversation_id, 80);
  const phone = extractCallerPhoneFromElevenLabs(data);
  const lead = await ensureLeadForCall(env, phone, data);
  if (!lead) {
    return json({ ok: false, error: "Could not create CRM lead." }, { status: 500 });
  }

  let body = formatTranscriptText(data);
  const existing = conversationId ? await getCallRecording(env, conversationId) : null;
  if (conversationId && existing?.r2_key) {
    const marker = recordingMarker(conversationId);
    if (!body.includes(marker)) body = `${body}\n\n${marker}`.slice(0, 12000);
  }

  const saved = await addLeadNote(
    env,
    lead.id,
    { body, kind: "call" },
    { author: "Vera (phone)", kind: "call" }
  );
  if (saved.error) {
    return json({ ok: false, error: saved.error }, { status: saved.status || 500 });
  }

  if (conversationId) {
    await upsertCallRecording(env, {
      conversationId,
      leadId: lead.id,
      noteId: saved.note?.id || null,
      r2Key: existing?.r2_key || null,
      contentType: existing?.content_type || null,
      byteSize: existing?.byte_size || 0,
    });
  }

  return json({ ok: true, lead_id: lead.id, note_id: saved.note?.id || "" });
}

async function handleElevenLabsPostCallWebhook(request, env) {
  const secret = getElevenLabsWebhookSecret(env);
  if (!secret) {
    return json({ error: "ELEVENLABS_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }
  const rawBody = await request.text();
  const signature =
    request.headers.get("ElevenLabs-Signature") || request.headers.get("elevenlabs-signature") || "";
  const valid = await verifyElevenLabsSignature(rawBody, signature, secret);
  if (!valid) {
    return json({ error: "Invalid signature." }, { status: 401 });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return badRequest("Invalid JSON body.");
  }
  const type = event?.type || "post_call_transcription";
  const data = event?.data || event || {};
  if (type === "post_call_audio") {
    return handleElevenLabsPostCallAudio(env, data);
  }
  if (type === "post_call_transcription" || !event?.type) {
    return handleElevenLabsPostCallTranscript(env, data);
  }
  return json({ ok: true, ignored: type });
}

async function ensureLeadForCall(env, phone, data = {}) {
  let lead = phone ? await findLeadByPhone(env, phone) : null;
  if (lead) return lead;
  const vars = data?.conversation_initiation_client_data?.dynamic_variables || {};
  const name =
    cleanText(vars.caller_name, 120) ||
    (phone ? `Caller ${normalizePhoneDigits(phone).slice(-4)}` : "Phone caller");
  const business = cleanText(vars.caller_business, 160) || "Inbound call";
  const created = await createLead(
    env,
    {
      name,
      business,
      phone: phone || "",
      email: cleanText(vars.caller_email, 160),
      notes: "Created from ElevenLabs inbound call.",
    },
    { source: "elevenlabs", stage: "new", author: "Vera (phone)" }
  );
  return created.lead || null;
}

async function handleElevenLabsCallerContext(request, env) {
  if (!getElevenLabsAgentSecret(env)) {
    return json({ error: "ELEVENLABS_AGENT_SECRET is not configured." }, { status: 503 });
  }
  if (!verifyAgentSecret(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  let callerId = url.searchParams.get("caller_id") || url.searchParams.get("from_number") || "";
  if (request.method === "POST") {
    try {
      const body = await request.json();
      callerId =
        body.caller_id ||
        body.callerId ||
        body.from_number ||
        body.from ||
        body.parameters?.caller_id ||
        callerId;
    } catch {
      /* query params only */
    }
  }
  const payload = await buildCallerContext(env, callerId);
  return json(payload);
}

async function handleElevenLabsLookupLead(request, env) {
  if (!getElevenLabsAgentSecret(env)) {
    return json({ result: { error: "Agent secret not configured." } }, { status: 503 });
  }
  if (!verifyAgentSecret(request, env)) {
    return json({ result: { error: "Unauthorized." } }, { status: 401 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const params = extractToolParams(body);
  const lead = await findLeadByQuery(env, {
    phone: params.phone || params.caller_id || params.caller_phone,
    email: params.email,
    name: params.name || params.caller_name,
    business: params.business || params.company || params.caller_business,
    leadId: params.lead_id || params.leadId,
  });
  if (!lead) {
    return json({
      result: {
        found: false,
        message: "No matching CRM lead.",
      },
    });
  }
  return json({
    result: {
      found: true,
      lead_id: lead.id,
      name: lead.name,
      business: lead.business,
      email: lead.email,
      phone: lead.phone,
      stage: lead.stage,
      industry: lead.industry,
      notes_summary: cleanText(lead.notes, 800),
    },
  });
}

async function handleElevenLabsGetNotes(request, env) {
  if (!getElevenLabsAgentSecret(env)) {
    return json({ result: { error: "Agent secret not configured." } }, { status: 503 });
  }
  if (!verifyAgentSecret(request, env)) {
    return json({ result: { error: "Unauthorized." } }, { status: 401 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const params = extractToolParams(body);
  const lead = await findLeadByQuery(env, {
    phone: params.phone || params.caller_id || params.caller_phone,
    email: params.email,
    name: params.name,
    business: params.business || params.company,
    leadId: params.lead_id || params.leadId,
  });
  if (!lead) {
    return json({ result: { found: false, message: "No matching CRM lead." } });
  }
  const limit = Math.min(Math.max(Number(params.limit) || 8, 1), 20);
  const notes = await listLeadNotes(env, lead.id);
  return json({
    result: {
      found: true,
      lead_id: lead.id,
      name: lead.name,
      business: lead.business,
      notes: notes.slice(0, limit).map((n) => ({
        kind: n.kind,
        author: n.author,
        created_at: n.createdAt,
        body: cleanText(n.body, 1200),
      })),
      notes_text: formatLeadNotesBrief(notes, limit),
    },
  });
}

async function handleElevenLabsAddNote(request, env) {
  if (!getElevenLabsAgentSecret(env)) {
    return json({ result: { error: "Agent secret not configured." } }, { status: 503 });
  }
  if (!verifyAgentSecret(request, env)) {
    return json({ result: { error: "Unauthorized." } }, { status: 401 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const params = extractToolParams(body);
  const noteText = cleanText(params.note || params.body || params.text, 4000);
  if (!noteText) {
    return json({ result: { ok: false, message: "Note text is required." } });
  }
  let lead = await findLeadByQuery(env, {
    phone: params.phone || params.caller_id || params.caller_phone,
    email: params.email,
    name: params.name,
    business: params.business || params.company,
    leadId: params.lead_id || params.leadId,
  });
  if (!lead) {
    const phone = cleanText(params.phone || params.caller_id || params.caller_phone, 40);
    lead = await ensureLeadForCall(env, phone, {
      conversation_initiation_client_data: {
        dynamic_variables: {
          caller_name: params.name,
          caller_business: params.business || params.company,
          caller_email: params.email,
        },
      },
    });
  }
  if (!lead) {
    return json({ result: { ok: false, message: "Could not find or create a CRM lead." } });
  }
  const saved = await addLeadNote(
    env,
    lead.id,
    { body: noteText, kind: cleanText(params.kind, 40) || "note" },
    { author: "Vera (phone)", kind: cleanText(params.kind, 40) || "note" }
  );
  if (saved.error) {
    return json({ result: { ok: false, message: saved.error } }, { status: saved.status || 400 });
  }
  return json({
    result: {
      ok: true,
      lead_id: lead.id,
      note_id: saved.note?.id || "",
    },
  });
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
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Vanderven-Agent-Secret, ElevenLabs-Signature",
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
    try {
      await notifyOwnerNewLead(env, result.lead, { source: "contact" });
    } catch {
      /* lead is saved even if notify fails */
    }
    return json({ ok: true, id: result.lead.id }, { status: 201 });
  }

  // Public quote signing preview
  if (path === "/api/public/quotes/sign-preview" && method === "GET") {
    const token = url.searchParams.get("token") || "";
    let row = await getQuoteBySignToken(env, token);
    if (!row) return json({ error: "This signing link is invalid or expired." }, { status: 404 });
    row = (await markQuoteClientViewed(env, row)) || row;
    return json({ quote: await publicQuotePayloadWithPay(env, row, request.url) });
  }

  if (path === "/api/public/quotes/sign" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await signQuotePublic(env, body, request);
    if (result.error) {
      return json({ error: result.error }, { status: result.status || 400 });
    }
    return json(result);
  }

  if (path === "/api/public/pay/quote" && method === "GET") {
    const result = await publicPayPreview(env, "quote", url.searchParams.get("token") || "", request.url);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ pay: result });
  }

  if (path === "/api/public/pay/invoice" && method === "GET") {
    const result = await publicPayPreview(env, "invoice", url.searchParams.get("token") || "", request.url);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ pay: result });
  }

  if (path === "/api/public/pay/checkout" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await startPublicCheckout(env, body, request.url);
    if (result.error) {
      return json(
        {
          error: result.error,
          needsSignature: Boolean(result.needsSignature),
          signUrl: result.signUrl || "",
        },
        { status: result.status || 400 }
      );
    }
    return json(result);
  }

  if (path === "/api/stripe/webhook" && method === "POST") {
    const rawBody = await request.text();
    const verified = await verifyStripeWebhook(
      env,
      rawBody,
      request.headers.get("stripe-signature")
    );
    if (verified.error) {
      return json({ error: verified.error }, { status: verified.status || 400 });
    }
    const event = verified.event;
    if (event?.type === "checkout.session.completed") {
      const result = await handleStripeCheckoutCompleted(env, event.data?.object || {});
      if (result.error) {
        return json({ error: result.error }, { status: result.status || 400 });
      }
    }
    return json({ received: true });
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

  // ElevenLabs: load CRM context when a call starts
  if (path === "/api/public/agents/caller-context" && (method === "GET" || method === "POST")) {
    return handleElevenLabsCallerContext(request, env);
  }

  // ElevenLabs tools during a call
  if (path === "/api/public/agents/lookup-lead" && method === "POST") {
    return handleElevenLabsLookupLead(request, env);
  }
  if (path === "/api/public/agents/get-notes" && method === "POST") {
    return handleElevenLabsGetNotes(request, env);
  }
  if (path === "/api/public/agents/add-note" && method === "POST") {
    return handleElevenLabsAddNote(request, env);
  }

  // ElevenLabs post-call transcript → CRM note
  if (path === "/api/public/webhooks/elevenlabs" && method === "POST") {
    return handleElevenLabsPostCallWebhook(request, env);
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

  if (path === "/api/public/password-reset/request" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const result = await requestPasswordReset(env, body.email, request);
    if (result.error) return badRequest(result.error);
    return json(result);
  }

  if (path === "/api/public/password-reset/confirm" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body.");
    }
    const password = String(body.password || body.newPassword || "");
    const confirm = String(body.confirmPassword || body.confirm || password);
    if (password !== confirm) return badRequest("Passwords do not match.");
    const result = await confirmPasswordReset(env, body.token, password);
    if (result.error) return json({ error: result.error }, { status: result.status || 400 });
    return json({ ok: true, email: result.email || "" });
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
    if (!user) {
      return json(
        { authenticated: false, user: null },
        { headers: { "Set-Cookie": clearSessionCookie(request.url) } }
      );
    }
    const refresh = await touchSessionCookie(request, env, user);
    return withSessionCookie(
      json({ authenticated: true, user, idleTimeoutSec: SESSION_IDLE_TTL_SEC }),
      refresh
    );
  }

  const sessionUser = await getSessionUser(request, env);
  if (!sessionUser) {
    return json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Set-Cookie": clearSessionCookie(request.url) } }
    );
  }
  const sessionRefreshCookie = await touchSessionCookie(request, env, sessionUser);
  return withSessionCookie(
    await handleAuthedApi(request, env, sessionUser, url, path, method),
    sessionRefreshCookie
  );
}

async function handleAuthedApi(request, env, sessionUser, url, path, method) {
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

  const callAudioMatch = path.match(/^\/api\/calls\/([^/]+)\/audio$/);
  if (callAudioMatch && method === "GET") {
    const conversationId = decodeURIComponent(callAudioMatch[1] || "");
    const row = await getCallRecording(env, conversationId);
    if (!row?.r2_key) return json({ error: "Recording not found." }, { status: 404 });
    if (!env.CALL_AUDIO) return json({ error: "Audio storage unavailable." }, { status: 503 });
    const object = await env.CALL_AUDIO.get(row.r2_key);
    if (!object) return json({ error: "Recording file missing." }, { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", row.content_type || object.httpMetadata?.contentType || "audio/mpeg");
    headers.set("Cache-Control", "private, max-age=3600");
    if (row.byte_size) headers.set("Content-Length", String(row.byte_size));
    return new Response(object.body, { status: 200, headers });
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

  const leadDepositsMatch = path.match(/^\/api\/leads\/([^/]+)\/deposits$/);
  if (leadDepositsMatch) {
    const leadId = decodeURIComponent(leadDepositsMatch[1]);
    if (method === "GET") {
      const deposits = await listDepositsForLead(env, leadId);
      const depositAvailableCents = await availableDepositCents(env, leadId);
      return json({ deposits, depositAvailableCents });
    }
    if (method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await createManualDeposit(env, leadId, body);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      const detail = await getLeadDetail(env, leadId);
      return json({ deposit: result.deposit, detail }, { status: 201 });
    }
  }

  const depositMatch = path.match(/^\/api\/deposits\/([^/]+)$/);
  if (depositMatch) {
    const id = decodeURIComponent(depositMatch[1]);
    if (method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest("Invalid JSON body.");
      }
      const result = await updateDeposit(env, id, body);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      const detail = result.deposit?.leadId
        ? await getLeadDetail(env, result.deposit.leadId)
        : null;
      return json({ deposit: result.deposit, detail });
    }
    if (method === "DELETE") {
      const row = await env.DB.prepare("SELECT lead_id FROM client_deposits WHERE id = ?")
        .bind(id)
        .first();
      const result = await deleteDeposit(env, id);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      const detail = row?.lead_id ? await getLeadDetail(env, row.lead_id) : null;
      return json({ ok: true, detail });
    }
  }

  const quotePayLinkMatch = path.match(/^\/api\/quotes\/([^/]+)\/pay-link$/);
  if (quotePayLinkMatch && method === "POST") {
    const id = decodeURIComponent(quotePayLinkMatch[1]);
    const quote = await getQuote(env, id);
    if (!quote) return json({ error: "Quote not found." }, { status: 404 });
    if (!quote.leadId) {
      return json({ error: "Link a client before creating a pay link.", status: 400 });
    }
    const token = await issueEntityPayToken(env, "quotes", id);
    if (!token) {
      return json({ error: "Pay links need migration 0029 applied." }, { status: 503 });
    }
    const origin = publicAppOrigin(env, request.url);
    return json({
      token,
      payUrl: `${origin}/pay/q/${encodeURIComponent(token)}`,
    });
  }

  const invoicePayLinkMatch = path.match(/^\/api\/invoices\/([^/]+)\/pay-link$/);
  if (invoicePayLinkMatch && method === "POST") {
    const id = decodeURIComponent(invoicePayLinkMatch[1]);
    const invoice = await getInvoice(env, id);
    if (!invoice) return json({ error: "Invoice not found." }, { status: 404 });
    if (!invoice.leadId) {
      return json({ error: "Link a client before creating a pay link.", status: 400 });
    }
    const token = await issueEntityPayToken(env, "invoices", id);
    if (!token) {
      return json({ error: "Pay links need migration 0029 applied." }, { status: 503 });
    }
    const origin = publicAppOrigin(env, request.url);
    return json({
      token,
      payUrl: `${origin}/pay/i/${encodeURIComponent(token)}`,
    });
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
    const result = await sendQuote(env, id, request.url, sessionUser);
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

  const quoteFileMatch = path.match(/^\/api\/quotes\/([^/]+)\/files(?:\/([^/]+))?$/);
  if (quoteFileMatch) {
    const quoteId = decodeURIComponent(quoteFileMatch[1]);
    const fileId = quoteFileMatch[2] ? decodeURIComponent(quoteFileMatch[2]) : "";
    if (!fileId && method === "GET") {
      const quote = await getQuote(env, quoteId);
      if (!quote) return json({ error: "Quote not found." }, { status: 404 });
      return json({ files: quote.files || [] });
    }
    if (!fileId && method === "POST") {
      let form;
      try {
        form = await request.formData();
      } catch {
        return badRequest("Expected multipart form upload.");
      }
      const file = form.get("file");
      const result = await uploadQuoteFile(env, quoteId, file);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ file: result.file }, { status: 201 });
    }
    if (fileId && method === "GET") {
      const row = await getQuoteFileRow(env, quoteId, fileId);
      if (!row) return json({ error: "File not found." }, { status: 404 });
      if (!env.CALL_AUDIO) return json({ error: "File storage unavailable." }, { status: 503 });
      const object = await env.CALL_AUDIO.get(row.r2_key);
      if (!object) return json({ error: "File missing from storage." }, { status: 404 });
      const headers = new Headers();
      headers.set("Content-Type", row.content_type || "application/octet-stream");
      headers.set(
        "Content-Disposition",
        `inline; filename="${String(row.file_name || "attachment").replace(/"/g, "")}"`
      );
      if (row.byte_size) headers.set("Content-Length", String(row.byte_size));
      return new Response(object.body, { headers });
    }
    if (fileId && method === "DELETE") {
      const result = await deleteQuoteFile(env, quoteId, fileId);
      if (result.error) return json({ error: result.error }, { status: result.status || 400 });
      return json({ ok: true });
    }
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
    const fresh =
      sessionUser?.id != null ? rowToUser(await getUserById(env, sessionUser.id)) : sessionUser;
    return json({ settings, user: fresh || sessionUser });
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
    return json({ settings: result.settings, user: result.user || sessionUser });
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
    const result = await sendInvoice(env, id, request.url, sessionUser);
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

      // Public quote signing page: /sign/q/:token
      const signMatch = pathname.match(/^\/sign\/q\/([^/]+)\/?$/);
      if (signMatch) {
        return serveAsset(request, env, "/sign/quote");
      }
      if (pathname === "/sign/quote" || pathname === "/sign/quote.html") {
        return serveAsset(request, env, "/sign/quote");
      }

      // Public pay pages
      const quotePayMatch = pathname.match(/^\/pay\/q\/([^/]+)\/?$/);
      if (quotePayMatch) {
        return serveAsset(request, env, "/sign/pay-quote");
      }
      const invoicePayMatch = pathname.match(/^\/pay\/i\/([^/]+)\/?$/);
      if (invoicePayMatch) {
        return serveAsset(request, env, "/sign/pay-invoice");
      }
      if (pathname === "/sign/pay-quote" || pathname === "/sign/pay-quote.html") {
        return serveAsset(request, env, "/sign/pay-quote");
      }
      if (pathname === "/sign/pay-invoice" || pathname === "/sign/pay-invoice.html") {
        return serveAsset(request, env, "/sign/pay-invoice");
      }

      if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/")) {
        // Static CRM assets must stay public so login can load CSS/JS.
        // Game player HTML under /app/games/ is also public (iframe host).
        if (
          /\.(css|js|map|png|jpe?g|svg|ico|webp|woff2?)$/i.test(pathname) ||
          (pathname.startsWith("/app/games/") && /\.html$/i.test(pathname))
        ) {
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
