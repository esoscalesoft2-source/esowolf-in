/* ESOWOLF team blog admin — API (Cloudflare Pages Function at /api/blog/*)
   Bindings (set in Cloudflare Pages → Settings):
     DB            D1 database   (users, sessions, login attempts, drafts, cache)
     GITHUB_TOKEN  secret        fine-grained token: this repo only, Contents read/write
     SETUP_CODE    secret        one-time code to create the first owner (delete it after use)
   Optional: GITHUB_API (tests only). Nothing secret is ever sent to the browser. */

import cfg from "../../../admin/blog-config.json";
import { parsePost, serializePost, seoScore, isValidSlug, isValidUsername, isValidShort, toISTISO } from "../../../admin/shared.mjs";

const SESSION_DAYS = 14;
const PBKDF2_ITER = 100000; // Workers' maximum
const WINDOW = 15 * 60 * 1000;
const COOKIE = "eso_admin";
const enc = new TextEncoder();

/* ---------- tiny utils ---------- */
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", ...headers }
});
const fail = (status, error) => json({ error }, status);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256));
}
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function cookieOf(req, name) { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")); return m ? m[1] : ""; }
const b64 = s => { const bytes = enc.encode(s); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));

/* ---------- database ---------- */
let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, pw TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS attempts (k TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS drafts (slug TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT NOT NULL, author TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS cache (sha TEXT PRIMARY KEY, data TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS posts_index (slug TEXT PRIMARY KEY, data TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, name))")
  ]);
  ready = true;
}

/* ---------- GitHub (Git Data API → one commit per save) ---------- */
function gh(env) {
  const base = env.GITHUB_API || "https://api.github.com";
  const call = async (path, opts = {}) => {
    if (!env.GITHUB_TOKEN) throw new HttpError(500, "GITHUB_TOKEN is not set in Cloudflare yet.");
    const r = await fetch(base + path, { ...opts, headers: { "authorization": "Bearer " + env.GITHUB_TOKEN, "accept": "application/vnd.github+json", "user-agent": "esowolf-blog-admin", "x-github-api-version": "2022-11-28", ...(opts.body ? { "content-type": "application/json" } : {}) } });
    if (!r.ok) { const t = await r.text(); const e = new HttpError(r.status === 404 ? 404 : 502, `GitHub ${r.status}: ${t.slice(0, 200)}`); e.gh = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  };
  const repo = `/repos/${cfg.repo}`;
  return {
    async tree() {
      const ref = await call(`${repo}/git/ref/heads/${cfg.branch}`);
      return call(`${repo}/git/trees/${ref.object.sha}?recursive=1`);
    },
    blob: sha => call(`${repo}/git/blobs/${sha}`),
    /* files: [{path, content (utf-8) | base64, delete:true}] */
    async commit(message, files) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ref = await call(`${repo}/git/ref/heads/${cfg.branch}`);
        const head = await call(`${repo}/git/commits/${ref.object.sha}`);
        const tree = [];
        for (const f of files) {
          if (f.delete) { tree.push({ path: f.path, mode: "100644", type: "blob", sha: null }); continue; }
          const blob = await call(`${repo}/git/blobs`, { method: "POST", body: JSON.stringify(f.base64 ? { content: f.base64, encoding: "base64" } : { content: b64(f.content), encoding: "base64" }) });
          tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
        }
        const t = await call(`${repo}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
        const c = await call(`${repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: [head.sha] }) });
        try { await call(`${repo}/git/refs/heads/${cfg.branch}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) }); return c.sha; }
        catch (e) { if (e.gh === 422 && attempt < 2) continue; throw e; } // someone else pushed — retry on the new head
      }
    }
  };
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* posts that live in the repo (published or scheduled).
   Fast path: a copy kept in D1 (posts_index), updated by every publish/delete from the admin.
   Slow path (first run or "Refresh"): read the repo from GitHub and rebuild that copy. */
async function repoPosts(env, fresh = false) {
  if (!fresh) {
    const [built, rows] = await env.DB.batch([
      env.DB.prepare("SELECT v FROM meta WHERE k='index_built'"),
      env.DB.prepare("SELECT data FROM posts_index")
    ]);
    if (built.results.length) return rows.results.map(r => JSON.parse(r.data));
  }
  const posts = await repoPostsFromGitHub(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM posts_index"),
    ...posts.map(p => env.DB.prepare("INSERT OR REPLACE INTO posts_index (slug, data) VALUES (?, ?)").bind(p.slug, JSON.stringify(p))),
    env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('index_built', ?)").bind(new Date().toISOString())
  ]);
  return posts;
}
const indexPut = (env, p) => env.DB.prepare("INSERT OR REPLACE INTO posts_index (slug, data) VALUES (?, ?)").bind(p.slug, JSON.stringify(p));
const indexDel = (env, slug) => env.DB.prepare("DELETE FROM posts_index WHERE slug=?").bind(slug);
async function repoPostsFromGitHub(env) {
  const g = gh(env);
  const tree = await g.tree();
  const prefix = cfg.postsDir.replace(/\/$/, "") + "/";
  const files = tree.tree.filter(f => f.type === "blob" && f.path.startsWith(prefix) && f.path.endsWith(".md") && !f.path.slice(prefix.length).includes("/"));
  const out = [];
  await Promise.all(files.map(async f => {
    let row = await env.DB.prepare("SELECT data FROM cache WHERE sha=?").bind(f.sha).first();
    let post;
    if (row) post = JSON.parse(row.data);
    else {
      const blob = await g.blob(f.sha);
      post = parsePost(unb64(blob.content));
      await env.DB.prepare("INSERT OR REPLACE INTO cache (sha, data) VALUES (?, ?)").bind(f.sha, JSON.stringify(post)).run();
    }
    post.slug = f.path.slice(prefix.length, -3);
    post._path = f.path;
    out.push(post);
  }));
  return out;
}
const statusOf = p => p._draft ? "draft" : (new Date(p.date) > new Date() ? "scheduled" : "live");
const summaryOf = p => ({ slug: p.slug, title: p.title || "(untitled)", status: statusOf(p), date: p.date || "", updated: p.updated || p._updated || "", cover: p.cover || "", topic: p.topic || "", keyword: p.keyword || "", short: p.short || "", author: p.author || "", hasDraft: !!p._hasDraft });

/* ---------- auth ---------- */
async function currentUser(req, env) {
  const tok = cookieOf(req, COOKIE); if (!tok) return null;
  const id = await sha256(tok);
  const row = await env.DB.prepare("SELECT u.username, u.role, u.disabled, s.expires FROM sessions s JOIN users u ON u.username=s.username WHERE s.id=?").bind(id).first();
  if (!row || row.disabled || row.expires < Date.now()) return null;
  return { username: row.username, role: row.role };
}
async function attempt(env, k) { return env.DB.prepare("SELECT n, first, locked_until FROM attempts WHERE k=?").bind(k).first(); }
async function bump(env, k, limit) {
  const now = Date.now(); const a = await attempt(env, k);
  let n = 1, first = now;
  if (a && now - a.first < WINDOW) { n = a.n + 1; first = a.first; }
  const locked = n >= limit ? now + WINDOW : 0;
  await env.DB.prepare("INSERT OR REPLACE INTO attempts (k, n, first, locked_until) VALUES (?,?,?,?)").bind(k, n, first, locked).run();
}
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/api/blog; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
async function newSession(env, username) {
  const token = randHex(32);
  await env.DB.prepare("INSERT INTO sessions (id, username, expires) VALUES (?,?,?)").bind(await sha256(token), username, Date.now() + SESSION_DAYS * 864e5).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(Date.now()).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}
function checkPassword(pw) { if (typeof pw !== "string" || pw.length < 10) throw new HttpError(400, "Password must be at least 10 characters."); if (pw.length > 200) throw new HttpError(400, "Password is too long."); }

/* ---------- post validation ---------- */
function cleanPost(p) {
  const s = v => String(v ?? "").trim();
  return {
    title: s(p.title).slice(0, 200), slug: s(p.slug).toLowerCase(), description: s(p.description).slice(0, 400), summary: s(p.summary).slice(0, 600),
    topic: s(p.topic), keyword: s(p.keyword).toLowerCase().slice(0, 120),
    keywords: (Array.isArray(p.keywords) ? p.keywords : String(p.keywords || "").split(/[;,]/)).map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20),
    short: s(p.short).toLowerCase(), cover: s(p.cover), coverAlt: s(p.coverAlt).slice(0, 250),
    faqs: (Array.isArray(p.faqs) ? p.faqs : []).map(f => ({ q: s(f && f.q).slice(0, 300), a: s(f && f.a).slice(0, 2000) })).filter(f => f.q || f.a).slice(0, 12),
    body: String(p.body || "").replace(/\r\n?/g, "\n").slice(0, 200000),
    date: s(p.date), updated: s(p.updated), author: s(p.author)
  };
}

/* ---------- routes ---------- */
export async function onRequest(ctx) {
  if (!ctx.env.DB) return fail(500, "The D1 database (binding name DB) is not connected yet.");
  try { return await handle(ctx); }
  catch (e) {   // tables are created only when missing (first run / new version), not on every request
    if (/no such table/i.test(String(e && e.message))) { await init(ctx.env.DB); return handle(ctx); }
    return fail(500, "Server error: " + (e && e.message || e));
  }
}
async function handle(ctx) {
  const { request: req, env, params } = ctx;
  try {
    const parts = (params.path || []).map(decodeURIComponent);
    const route = parts.join("/"), method = req.method;
    if (method !== "GET" && method !== "HEAD") {
      if (req.headers.get("x-admin") !== "1") return fail(403, "Bad request origin.");
      const origin = req.headers.get("origin"); if (origin && new URL(origin).host !== new URL(req.url).host) return fail(403, "Bad request origin.");
    }
    const rawBody = route === "videos/part" || route === "videos/poster";   // binary uploads, not JSON
    const body = !rawBody && (method === "POST" || method === "PUT") ? await req.json().catch(() => ({})) : {};
    const ip = req.headers.get("cf-connecting-ip") || "local";

    /* public: state, setup, login */
    if (route === "state" && method === "GET") {
      const [c, u] = await env.DB.batch([env.DB.prepare("SELECT COUNT(*) AS n FROM users"), env.DB.prepare("SELECT v FROM meta WHERE k='setup_used'")]);
      const n = c.results[0].n, used = u.results[0];
      return json({ needsSetup: n === 0 && !used, setupCodeSet: !!env.SETUP_CODE, user: await currentUser(req, env), minSeoScore: cfg.minSeoScore });
    }
    if (route === "setup" && method === "POST") {
      const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
      const used = await env.DB.prepare("SELECT v FROM meta WHERE k='setup_used'").first();
      if (n > 0 || used) return fail(403, "Setup is already done.");
      const ipA = await attempt(env, "ip:" + ip); if (ipA && ipA.locked_until > Date.now()) return fail(429, "Too many tries. Wait 15 minutes.");
      if (!env.SETUP_CODE || String(env.SETUP_CODE).length < 8) return fail(500, "SETUP_CODE is not set in Cloudflare (at least 8 characters).");
      if (!safeEqual(String(body.code || ""), String(env.SETUP_CODE))) { await bump(env, "ip:" + ip, 20); return fail(401, "Wrong setup code."); }
      const u = String(body.username || "").trim().toLowerCase();
      if (!isValidUsername(u)) return fail(400, "Username: 3–32 characters, only a–z, 0–9, . _ -");
      checkPassword(body.password);
      const salt = randHex(16);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (username, pw, salt, role, disabled, created) VALUES (?,?,?,?,0,?)").bind(u, await pbkdf2(body.password, salt), salt, "owner", new Date().toISOString()),
        env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('setup_used', ?)").bind(new Date().toISOString())
      ]);
      return json({ ok: true, user: { username: u, role: "owner" } }, 200, { "set-cookie": await newSession(env, u) });
    }
    if (route === "login" && method === "POST") {
      const u = String(body.username || "").trim().toLowerCase(), pw = String(body.password || "");
      const now = Date.now();
      const [ua, ia] = [await attempt(env, "u:" + u), await attempt(env, "ip:" + ip)];
      if ((ua && ua.locked_until > now) || (ia && ia.locked_until > now)) return fail(429, "Too many wrong tries. This login is locked for 15 minutes.");
      const row = isValidUsername(u) ? await env.DB.prepare("SELECT * FROM users WHERE username=?").bind(u).first() : null;
      const ok = row && !row.disabled && safeEqual(await pbkdf2(pw, row.salt), row.pw);
      if (!row) await pbkdf2(pw, "00112233445566778899aabbccddeeff"); // same timing for unknown users
      if (!ok) {
        if (u) await bump(env, "u:" + u, 6);
        await bump(env, "ip:" + ip, 20);
        return fail(401, row && row.disabled ? "This account is disabled." : "Wrong username or password.");
      }
      await env.DB.prepare("DELETE FROM attempts WHERE k=?").bind("u:" + u).run();
      return json({ ok: true, user: { username: row.username, role: row.role } }, 200, { "set-cookie": await newSession(env, row.username) });
    }
    if (route === "logout" && method === "POST") {
      const tok = cookieOf(req, COOKIE);
      if (tok) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(await sha256(tok)).run();
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
    }

    /* everything below needs a login */
    const me = await currentUser(req, env);
    if (!me) return fail(401, "Please log in.");
    const owner = me.role === "owner";

    if (route === "me") return json({ user: me });

    /* visit & click counts (written by /api/t) */
    if (route === "stats" && method === "GET") {
      const days = Math.min(365, Math.max(1, parseInt(new URL(req.url).searchParams.get("days"), 10) || 30));
      const from = new Date(Date.now() + 5.5 * 3600e3 - (days - 1) * 864e5).toISOString().slice(0, 10);
      const [tot, daily] = await env.DB.batch([
        env.DB.prepare("SELECT name, SUM(n) AS n FROM stats WHERE day >= ? GROUP BY name ORDER BY n DESC LIMIT 300").bind(from),
        env.DB.prepare("SELECT day, SUM(n) AS n FROM stats WHERE day >= ? AND name LIKE 'view:%' GROUP BY day ORDER BY day").bind(from)
      ]);
      return json({ days, from, totals: tot.results, daily: daily.results });
    }

    /* team (owner only) */
    if (parts[0] === "users") {
      if (!owner) return fail(403, "Only the owner can manage the team.");
      if (parts.length === 1 && method === "GET") {
        const r = await env.DB.prepare("SELECT username, role, disabled, created FROM users ORDER BY created").all();
        return json({ users: r.results });
      }
      if (parts.length === 1 && method === "POST") {
        const u = String(body.username || "").trim().toLowerCase(), role = body.role === "owner" ? "owner" : "editor";
        if (!isValidUsername(u)) return fail(400, "Username: 3–32 characters, only a–z, 0–9, . _ -");
        checkPassword(body.password);
        if (await env.DB.prepare("SELECT 1 FROM users WHERE username=?").bind(u).first()) return fail(409, "That username already exists.");
        const salt = randHex(16);
        await env.DB.prepare("INSERT INTO users (username, pw, salt, role, disabled, created) VALUES (?,?,?,?,0,?)").bind(u, await pbkdf2(body.password, salt), salt, role, new Date().toISOString()).run();
        return json({ ok: true });
      }
      const u = parts[1];
      const row = await env.DB.prepare("SELECT * FROM users WHERE username=?").bind(u).first();
      if (!row) return fail(404, "No such user.");
      const owners = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND disabled=0").first()).n;
      if (parts[2] === "password" && method === "POST") {
        checkPassword(body.password);
        const salt = randHex(16);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET pw=?, salt=? WHERE username=?").bind(await pbkdf2(body.password, salt), salt, u),
          env.DB.prepare("DELETE FROM sessions WHERE username=?").bind(u),
          env.DB.prepare("DELETE FROM attempts WHERE k=?").bind("u:" + u)
        ]);
        return json({ ok: true });
      }
      if (parts[2] === "disable" && method === "POST") {
        const dis = body.disabled ? 1 : 0;
        if (dis && u === me.username) return fail(400, "You cannot disable yourself.");
        if (dis && row.role === "owner" && owners <= 1) return fail(400, "Keep at least one active owner.");
        await env.DB.batch([env.DB.prepare("UPDATE users SET disabled=? WHERE username=?").bind(dis, u), env.DB.prepare("DELETE FROM sessions WHERE username=?").bind(u)]);
        return json({ ok: true });
      }
      if (parts[2] === "role" && method === "POST") {
        const role = body.role === "owner" ? "owner" : "editor";
        if (row.role === "owner" && role !== "owner" && owners <= 1) return fail(400, "Keep at least one active owner.");
        await env.DB.prepare("UPDATE users SET role=? WHERE username=?").bind(role, u).run();
        return json({ ok: true });
      }
      if (parts.length === 2 && method === "DELETE") {
        if (u === me.username) return fail(400, "You cannot remove yourself.");
        if (row.role === "owner" && owners <= 1) return fail(400, "Keep at least one active owner.");
        await env.DB.batch([env.DB.prepare("DELETE FROM users WHERE username=?").bind(u), env.DB.prepare("DELETE FROM sessions WHERE username=?").bind(u)]);
        return json({ ok: true });
      }
      return fail(404, "Not found.");
    }

    /* posts */
    if (route === "posts" && method === "GET") {
      const [repo, drafts] = await Promise.all([repoPosts(env, new URL(req.url).searchParams.get("fresh") === "1"), env.DB.prepare("SELECT slug, data, updated, author FROM drafts").all().then(r => r.results)]);
      const bySlug = new Map(repo.map(p => [p.slug, p]));
      const list = repo.map(summaryOf);
      for (const d of drafts) {
        const p = JSON.parse(d.data);
        if (bySlug.has(d.slug)) { const s = list.find(x => x.slug === d.slug); s.hasDraft = true; continue; }
        list.push(summaryOf({ ...p, slug: d.slug, _draft: true, _updated: d.updated, author: p.author || d.author }));
      }
      list.sort((a, b) => String(b.date || b.updated).localeCompare(String(a.date || a.updated)));
      return json({ posts: list, live: repo.filter(p => statusOf(p) === "live").map(p => ({ slug: p.slug, title: p.title, keyword: p.keyword })) });
    }
    if (parts[0] === "posts" && parts.length === 2 && method === "GET") {
      const slug = parts[1];
      const [d, repo] = await Promise.all([env.DB.prepare("SELECT data, updated FROM drafts WHERE slug=?").bind(slug).first(), repoPosts(env)]);
      const live = repo.find(p => p.slug === slug);
      if (!d && !live) return fail(404, "Post not found.");
      const post = d ? { ...JSON.parse(d.data), slug } : live;
      return json({ post, inRepo: !!live, repoStatus: live ? statusOf(live) : null, hasDraft: !!d, draftUpdated: d ? d.updated : null,
        all: repo.map(x => ({ slug: x.slug, short: x.short || "" })), live: repo.filter(x => statusOf(x) === "live").map(x => ({ slug: x.slug, title: x.title, keyword: x.keyword })) });
    }
    if (route === "drafts" && method === "POST") {
      const p = cleanPost(body.post || {});
      const oldSlug = String(body.oldSlug || "");
      if (!isValidSlug(p.slug)) return fail(400, "The URL slug can only use a–z, 0–9 and hyphens.");
      if (!p.title) return fail(400, "Add a title first.");
      if (oldSlug && oldSlug !== p.slug) {
        const repo = await repoPosts(env);
        if (repo.some(x => x.slug === oldSlug)) return fail(400, "This post is already on the site — publish it to change its URL.");
        if (repo.some(x => x.slug === p.slug)) return fail(409, "Another post already uses this URL slug.");
        await env.DB.prepare("DELETE FROM drafts WHERE slug=?").bind(oldSlug).run();
      }
      p.author = p.author || me.username;
      await env.DB.prepare("INSERT OR REPLACE INTO drafts (slug, data, updated, author) VALUES (?,?,?,?)").bind(p.slug, JSON.stringify(p), new Date().toISOString(), me.username).run();
      return json({ ok: true, slug: p.slug });
    }
    if (route === "images" && method === "POST") {
      const files = [["webp", ".webp"], ["webp800", "-800.webp"], ["og", "-og.jpg"]];
      for (const [k] of files) if (typeof body[k] !== "string" || !/^[A-Za-z0-9+/=]+$/.test(body[k])) return fail(400, "Image data is missing.");
      if (files.reduce((a, [k]) => a + body[k].length, 0) > 12e6) return fail(413, "The image is too big after conversion.");
      const id = (new Date().toISOString().slice(0, 10)) + "-" + randHex(4);
      const base = `${cfg.imagesDir}/${id}`;
      await gh(env).commit(`Blog: cover image (by ${me.username} via team admin)`, files.map(([k, ext]) => ({ path: base + ext, base64: body[k] })));
      return json({ ok: true, cover: "/" + base });
    }
    /* videos → R2 bucket (binding MEDIA), uploaded in parts so any size works */
    if (parts[0] === "videos") {
      if (!env.MEDIA) return fail(500, "Video storage is not connected yet (R2 bucket binding MEDIA).");
      const q = new URL(req.url).searchParams;
      const okKey = k => /^videos\/[0-9-]+-[a-f0-9]{8}\.(mp4|webm)$/.test(k || "");
      if (route === "videos/start" && method === "POST") {
        const ext = { "video/mp4": "mp4", "video/webm": "webm" }[body.type];
        if (!ext) return fail(400, "Please upload an MP4 or WebM video. (iPhone .mov files: export or convert to MP4 first.)");
        if (!(body.size > 0) || body.size > 2e9) return fail(413, "The video must be smaller than 2 GB.");
        const key = `videos/${new Date().toISOString().slice(0, 10)}-${randHex(4)}.${ext}`;
        const up = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: body.type }, customMetadata: { by: me.username, name: String(body.name || "").slice(0, 120) } });
        return json({ key, uploadId: up.uploadId });
      }
      const key = q.get("key") || body.key, uploadId = q.get("uploadId") || body.uploadId;
      if (!okKey(key)) return fail(400, "Bad video key.");
      if (route === "videos/part" && method === "PUT") {
        const n = parseInt(q.get("n"), 10);
        if (!(n >= 1 && n <= 10000) || !uploadId) return fail(400, "Bad part.");
        const buf = await req.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > 95e6) return fail(413, "Bad part size.");
        const part = await env.MEDIA.resumeMultipartUpload(key, uploadId).uploadPart(n, buf);
        return json({ partNumber: part.partNumber, etag: part.etag });
      }
      if (route === "videos/complete" && method === "POST") {
        const list = (Array.isArray(body.parts) ? body.parts : []).map(p => ({ partNumber: +p.partNumber, etag: String(p.etag) }));
        if (!list.length) return fail(400, "No parts uploaded.");
        await env.MEDIA.resumeMultipartUpload(key, uploadId).complete(list);
        return json({ ok: true, url: "/media/" + key });
      }
      if (route === "videos/abort" && method === "POST") {
        try { await env.MEDIA.resumeMultipartUpload(key, uploadId).abort(); } catch {}
        return json({ ok: true });
      }
      if (route === "videos/poster" && method === "PUT") {
        const buf = await req.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > 3e6) return fail(413, "Poster image is too big.");
        const pkey = key.replace(/\.(mp4|webm)$/, ".jpg");
        await env.MEDIA.put(pkey, buf, { httpMetadata: { contentType: "image/jpeg" } });
        return json({ ok: true, url: "/media/" + pkey });
      }
      return fail(404, "Not found.");
    }

    if (route === "publish" && method === "POST") {
      const p = cleanPost(body.post || {});
      const oldSlug = String(body.oldSlug || p.slug);
      if (!p.title) return fail(400, "Add a title first.");
      if (!isValidSlug(p.slug)) return fail(400, "The URL slug can only use a–z, 0–9 and hyphens.");
      if (!isValidShort(p.short)) return fail(400, "Short link code: 2–40 characters, a–z, 0–9 and hyphens.");
      if (!p.body.trim()) return fail(400, "The article is empty.");
      const repo = await repoPosts(env);
      const existing = repo.find(x => x.slug === oldSlug);
      const clash = repo.find(x => x.slug === p.slug && x.slug !== oldSlug);
      if (clash) return fail(409, "Another post already uses this URL slug.");
      if (p.short && repo.some(x => x.short === p.short && x.slug !== oldSlug)) return fail(409, "Another post already uses this short link code.");
      const others = repo.filter(x => x.slug !== oldSlug && statusOf(x) === "live").map(x => x.slug);
      const { score } = seoScore(p, cfg, others);
      if (!owner && score < cfg.minSeoScore) return fail(403, `SEO score is ${score}%. Editors can publish from ${cfg.minSeoScore}%. Fix the checklist or ask the owner.`);
      const now = new Date();
      if (body.mode === "schedule") {
        const when = new Date(body.when || "");
        if (isNaN(when) || when <= now) return fail(400, "Pick a date and time in the future (India time).");
        p.date = toISTISO(when); p.updated = "";
      } else {
        const wasLive = existing && statusOf(existing) === "live";
        p.date = wasLive ? existing.date : toISTISO(now);
        p.updated = wasLive ? toISTISO(now) : "";
      }
      p.author = (existing && existing.author) || p.author || me.username;
      const dir = cfg.postsDir.replace(/\/$/, "");
      const files = [{ path: `${dir}/${p.slug}.md`, content: serializePost(p) }];
      if (existing && oldSlug !== p.slug) files.push({ path: existing._path, delete: true });
      const verb = body.mode === "schedule" ? `schedule for ${p.date}` : (existing ? "update" : "publish");
      await gh(env).commit(`Blog: ${verb} "${p.title.replace(/"/g, "'")}" (by ${me.username} via team admin)`, files);
      const saved = { ...p, slug: p.slug, _path: `${dir}/${p.slug}.md` }; delete saved.body; saved.body = p.body;
      await env.DB.batch([env.DB.prepare("DELETE FROM drafts WHERE slug=?").bind(p.slug), env.DB.prepare("DELETE FROM drafts WHERE slug=?").bind(oldSlug),
        ...(oldSlug !== p.slug ? [indexDel(env, oldSlug)] : []), indexPut(env, saved)]);
      return json({ ok: true, slug: p.slug, date: p.date, score, status: new Date(p.date) > now ? "scheduled" : "live", url: `${cfg.site}/blog/${p.slug}/` });
    }
    if (parts[0] === "posts" && parts.length === 2 && method === "DELETE") {
      if (!owner) return fail(403, "Only the owner can delete posts.");
      const slug = parts[1];
      const repo = await repoPosts(env);
      const p = repo.find(x => x.slug === slug);
      const what = String(new URL(req.url).searchParams.get("what") || "all"); // "draft" = only discard unpublished changes
      await env.DB.prepare("DELETE FROM drafts WHERE slug=?").bind(slug).run();
      if (p && what !== "draft") {
        const files = [{ path: p._path, delete: true }];
        if (p.cover && p.cover.startsWith("/" + cfg.imagesDir + "/") && !repo.some(x => x !== p && x.cover === p.cover)) {
          const tree = await gh(env).tree(); const base = p.cover.slice(1);
          for (const ext of [".webp", "-800.webp", "-og.jpg"]) if (tree.tree.some(f => f.path === base + ext)) files.push({ path: base + ext, delete: true });
        }
        await gh(env).commit(`Blog: delete "${String(p.title || slug).replace(/"/g, "'")}" (by ${me.username} via team admin)`, files);
        await indexDel(env, slug).run();
      }
      return json({ ok: true });
    }
    return fail(404, "Not found.");
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message);
    if (/no such table/i.test(String(e && e.message))) throw e;
    return fail(500, "Server error: " + (e && e.message || e));
  }
}
