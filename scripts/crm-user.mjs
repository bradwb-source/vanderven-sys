#!/usr/bin/env node
/**
 * Terminal user admin for Vanderven CRM (local or remote D1).
 *
 * Examples:
 *   npm run user -- add brad@vanderven.ca --password secret --name Brad --role admin
 *   npm run user -- list
 *   npm run user -- get brad@vanderven.ca
 *   npm run user -- set brad@vanderven.ca --owner-days 1,3,7 --client-days 2,5,14
 *   npm run user -- set brad@vanderven.ca --password newpass --client-enabled false
 *   npm run user -- deactivate other@example.com
 *   npm run user -- add ... --remote
 */

import { spawnSync } from "node:child_process";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DB_NAME = "vanderven-crm";
const PERSIST = join(ROOT, "..", ".vanderven-wrangler-state");
// Must stay ≤ 100000 — Workers WebCrypto rejects higher counts at login time.
const ITERATIONS = 100_000;
const KEY_LEN = 32;

function usage(exitCode = 1) {
  console.log(`Vanderven CRM users

Usage:
  npm run user -- add <email> --password <pass> [--name <name>] [--role admin|member]
  npm run user -- list
  npm run user -- get <email>
  npm run user -- set <email> [--name <name>] [--role admin|member] [--password <pass>]
                              [--active true|false]
                              [--owner-days 2,5,10] [--client-days 3,7,14]
                              [--owner-enabled true|false] [--client-enabled true|false]
                              [--stop-on-closed true|false]
  npm run user -- deactivate <email>
  npm run user -- activate <email>

Flags:
  --remote     Use remote D1 instead of local
  --help       Show this help
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.flags.help = true;
    else if (arg === "--remote") out.flags.remote = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out.flags[key] = true;
      else {
        out.flags[key] = next;
        i++;
      }
    } else out._.push(arg);
  }
  return out;
}

function b64(buf) {
  return Buffer.from(buf).toString("base64url");
}

function hashPassword(password, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, "base64url") : randomBytes(16);
  const hash = pbkdf2Sync(String(password), salt, ITERATIONS, KEY_LEN, "sha256");
  return { hash: b64(hash), salt: b64(salt) };
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function boolFlag(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === "") return true;
  const s = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  throw new Error(`Expected true/false, got ${value}`);
}

function normalizeEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`Invalid email: ${email}`);
  return e;
}

function normalizeDays(value, label) {
  if (value === undefined) return null;
  const days = String(value)
    .split(/[,\s]+/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  if (!days.length) throw new Error(`${label} must include at least one day offset (e.g. 2,5,10)`);
  return [...new Set(days)].sort((a, b) => a - b).join(",");
}

function newId() {
  return `user_${randomBytes(8).toString("hex")}`;
}

function runSql(sql, { remote = false, json = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "crm-user-"));
  const file = join(dir, "cmd.sql");
  writeFileSync(file, sql.endsWith(";") ? sql : `${sql};`, "utf8");
  const args = ["wrangler", "d1", "execute", DB_NAME, "--file", file];
  if (remote) args.push("--remote");
  else args.push("--local", "--persist-to", PERSIST);
  if (json) args.push("--json");

  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npxBin, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  rmSync(dir, { recursive: true, force: true });

  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "wrangler d1 execute failed").trim();
    throw new Error(err);
  }
  const out = (result.stdout || "").trim();
  if (!json) return out;
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`Could not parse wrangler JSON output:\n${out}`);
  }
}

function rowsFromJson(payload) {
  // wrangler --json shape varies; normalize to row objects.
  const blocks = Array.isArray(payload) ? payload : [payload];
  for (const block of blocks) {
    if (Array.isArray(block?.results)) return block.results;
    if (Array.isArray(block?.[0]?.results)) return block[0].results;
    if (Array.isArray(block?.result?.[0]?.results)) return block.result[0].results;
  }
  return [];
}

function printUser(row) {
  console.log(`${row.email}  (${row.id})`);
  console.log(`  name:            ${row.name || "—"}`);
  console.log(`  role:            ${row.role}`);
  console.log(`  active:          ${Number(row.active) ? "yes" : "no"}`);
  console.log(`  owner reminders: ${Number(row.owner_enabled) ? "on" : "off"}  days=${row.owner_days}`);
  console.log(`  client reminders:${Number(row.client_enabled) ? " on" : " off"} days=${row.client_days}`);
  console.log(`  stop on closed:  ${Number(row.stop_on_closed) ? "yes" : "no"}`);
  console.log(`  updated:         ${row.updated_at}`);
}

async function cmdAdd(emailArg, flags) {
  const email = normalizeEmail(emailArg);
  const password = flags.password;
  if (!password || password === true) throw new Error("--password is required");
  const name = flags.name === true ? "" : String(flags.name || "");
  const role = String(flags.role || "member").toLowerCase();
  if (!["admin", "member"].includes(role)) throw new Error("--role must be admin or member");
  const { hash, salt } = hashPassword(password);
  const id = newId();
  const ts = new Date().toISOString();
  const ownerDays = normalizeDays(flags["owner-days"], "owner-days") || "2,5,10";
  const clientDays = normalizeDays(flags["client-days"], "client-days") || "3,7,14";
  const ownerEnabled = boolFlag(flags["owner-enabled"], true) ? 1 : 0;
  const clientEnabled = boolFlag(flags["client-enabled"], true) ? 1 : 0;
  const stopOnClosed = boolFlag(flags["stop-on-closed"], true) ? 1 : 0;

  runSql(
    `INSERT INTO users
      (id, email, name, password_hash, password_salt, role, active,
       owner_enabled, owner_days, client_enabled, client_days, stop_on_closed, created_at, updated_at)
     VALUES (
      ${sqlString(id)}, ${sqlString(email)}, ${sqlString(name)}, ${sqlString(hash)}, ${sqlString(salt)},
      ${sqlString(role)}, 1, ${ownerEnabled}, ${sqlString(ownerDays)}, ${clientEnabled},
      ${sqlString(clientDays)}, ${stopOnClosed}, ${sqlString(ts)}, ${sqlString(ts)}
     )`,
    { remote: !!flags.remote }
  );
  console.log(`Created user ${email} (${role})`);
}

function cmdList(flags) {
  const payload = runSql(
    `SELECT id, email, name, role, active, owner_enabled, owner_days, client_enabled, client_days, stop_on_closed, updated_at
     FROM users ORDER BY email ASC`,
    { remote: !!flags.remote, json: true }
  );
  const rows = rowsFromJson(payload);
  if (!rows.length) {
    console.log("No users yet. Create one with: npm run user -- add you@example.com --password '...'");
    return;
  }
  for (const row of rows) {
    const active = Number(row.active) ? "active" : "inactive";
    console.log(
      `${row.email.padEnd(32)} ${String(row.role).padEnd(8)} ${active.padEnd(10)} owner:${row.owner_days} client:${row.client_days}`
    );
  }
}

function cmdGet(emailArg, flags) {
  const email = normalizeEmail(emailArg);
  const payload = runSql(`SELECT * FROM users WHERE email = ${sqlString(email)} LIMIT 1`, {
    remote: !!flags.remote,
    json: true,
  });
  const row = rowsFromJson(payload)[0];
  if (!row) throw new Error(`User not found: ${email}`);
  printUser(row);
}

function cmdSet(emailArg, flags) {
  const email = normalizeEmail(emailArg);
  const existingPayload = runSql(`SELECT * FROM users WHERE email = ${sqlString(email)} LIMIT 1`, {
    remote: !!flags.remote,
    json: true,
  });
  const existing = rowsFromJson(existingPayload)[0];
  if (!existing) throw new Error(`User not found: ${email}`);

  const sets = [];
  if (flags.name !== undefined && flags.name !== true) sets.push(`name = ${sqlString(flags.name)}`);
  if (flags.role !== undefined && flags.role !== true) {
    const role = String(flags.role).toLowerCase();
    if (!["admin", "member"].includes(role)) throw new Error("--role must be admin or member");
    sets.push(`role = ${sqlString(role)}`);
  }
  if (flags.active !== undefined) sets.push(`active = ${boolFlag(flags.active, true) ? 1 : 0}`);
  if (flags.password && flags.password !== true) {
    const { hash, salt } = hashPassword(flags.password);
    sets.push(`password_hash = ${sqlString(hash)}`);
    sets.push(`password_salt = ${sqlString(salt)}`);
  }
  if (flags["owner-days"] !== undefined) {
    sets.push(`owner_days = ${sqlString(normalizeDays(flags["owner-days"], "owner-days"))}`);
  }
  if (flags["client-days"] !== undefined) {
    sets.push(`client_days = ${sqlString(normalizeDays(flags["client-days"], "client-days"))}`);
  }
  if (flags["owner-enabled"] !== undefined) {
    sets.push(`owner_enabled = ${boolFlag(flags["owner-enabled"], true) ? 1 : 0}`);
  }
  if (flags["client-enabled"] !== undefined) {
    sets.push(`client_enabled = ${boolFlag(flags["client-enabled"], true) ? 1 : 0}`);
  }
  if (flags["stop-on-closed"] !== undefined) {
    sets.push(`stop_on_closed = ${boolFlag(flags["stop-on-closed"], true) ? 1 : 0}`);
  }
  if (!sets.length) throw new Error("Nothing to update. Pass at least one setting flag.");
  sets.push(`updated_at = ${sqlString(new Date().toISOString())}`);

  runSql(`UPDATE users SET ${sets.join(", ")} WHERE email = ${sqlString(email)}`, {
    remote: !!flags.remote,
  });
  console.log(`Updated ${email}`);
  cmdGet(email, flags);
}

function cmdActive(emailArg, flags, active) {
  flags.active = active ? "true" : "false";
  cmdSet(emailArg, flags);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || !args._[0]) usage(args.flags.help ? 0 : 1);
  const [cmd, target] = args._;

  try {
    if (cmd === "add") {
      if (!target) throw new Error("email required");
      await cmdAdd(target, args.flags);
    } else if (cmd === "list") cmdList(args.flags);
    else if (cmd === "get") {
      if (!target) throw new Error("email required");
      cmdGet(target, args.flags);
    } else if (cmd === "set") {
      if (!target) throw new Error("email required");
      cmdSet(target, args.flags);
    } else if (cmd === "deactivate") {
      if (!target) throw new Error("email required");
      cmdActive(target, args.flags, false);
    } else if (cmd === "activate") {
      if (!target) throw new Error("email required");
      cmdActive(target, args.flags, true);
    } else usage(1);
  } catch (err) {
    console.error(`Error: ${err.message || err}`);
    process.exit(1);
  }
}

main();
