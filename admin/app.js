/* ESOWOLF team blog admin — single-page app. Loaded only on /admin/. */
import { slugify, youTubeId, isValidSlug, parseChatGPT, seoScore, buildPrompt, preprocessMarkdown, escapeHtml as e, istInputToISO, isoToISTInput, formatIST } from "./shared.mjs?v=6";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
let cfg, r2 = false, me = null, posts = [], livePosts = [], calendar = [];

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const r = await fetch("/api/blog/" + path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-admin": "1" },
    credentials: "same-origin",
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await r.json().catch(() => ({ error: `Server error (${r.status})` }));
  if (r.status === 401 && path !== "login" && path !== "setup" && me) { me = null; render(); }
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}
function toast(msg, kind = "") { const t = $("#toast"); t.textContent = msg; t.className = "toast show " + kind; clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", kind === "bad" ? 6000 : 3200); }
function ask(text, yes = "Yes") { const d = $("#dlg"); $("#dlgText").textContent = text; $("#dlgYes").textContent = yes; d.showModal(); return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true })); }
const raw = p => `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}${p}`;
const coverSrc = (cover, size = "-800") => cover ? `${cover}${size}.webp` : "";
function imgFallback(img, cover, size) { img.onerror = () => { img.onerror = null; img.src = raw(coverSrc(cover, size)); }; }

/* ---------- boot ---------- */
(async function boot() {
  // load settings, calendar and login state at the same time (not one after another)
  const stateP = api("state").catch(err => ({ error: err }));
  [cfg, calendar] = await Promise.all([
    fetch("/admin/blog-config.json?v=" + Date.now()).then(r => r.json()),
    fetch("/admin/calendar.json?v=" + Date.now()).then(r => r.ok ? r.json() : []).catch(() => [])
  ]);
  $("#logout").onclick = async () => { try { await api("logout", { body: {} }); } catch {} me = null; render(); };
  $$("#tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
  addEventListener("hashchange", route);
  try {
    const s = await stateP;
    if (s.error) throw s.error;
    me = s.user; r2 = !!s.r2;
    if (!me && s.needsSetup) return setupView(s);
  } catch (err) { app.innerHTML = `<div class="auth card"><h2>Admin is not ready yet</h2><p class="err">${e(err.message)}</p></div>`; return; }
  render();
})();
function go(tab, extra = "") { location.hash = tab + (extra ? "/" + extra : ""); }
function render() {
  $("#tabs").hidden = $("#who").hidden = !me;
  if (!me) return loginView();
  $("#whoName").textContent = `${me.username} (${me.role})`;
  $$("#tabs [data-owner]").forEach(b => b.hidden = me.role !== "owner");
  route();
}
function route() {
  if (!me) return;
  const [tab, ...rest] = location.hash.slice(1).split("/");
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === (tab === "edit" ? "posts" : tab || "posts")));
  if (tab === "edit") return editView(decodeURIComponent(rest.join("/") || ""));
  if (tab === "calendar") return calendarView();
  if (tab === "team" && me.role === "owner") return teamView();
  if (tab === "stats") return statsView();
  return postsView();
}

/* ---------- setup + login ---------- */
function setupView(s) {
  app.innerHTML = `<div class="auth"><div class="card"><h1>Create the owner account</h1>
  <p class="muted small">One-time setup. Enter the setup code you saved in Cloudflare (SETUP_CODE), then choose your username and password.</p>
  ${s.setupCodeSet ? "" : `<p class="err">SETUP_CODE is not set in Cloudflare yet.</p>`}
  <form id="f"><div class="field"><label>Setup code</label><input type="password" name="code" required autocomplete="off"></div>
  <div class="field"><label>Username <small>(a–z, 0–9, . _ -)</small></label><input type="text" name="username" required pattern="[a-z0-9._-]{3,32}" autocomplete="username" autocapitalize="none"></div>
  <div class="field"><label>Password <small>(at least 10 characters)</small></label><input type="password" name="password" required minlength="10" autocomplete="new-password"></div>
  <button class="btn" style="width:100%">Create owner</button><p class="err" id="err"></p></form></div></div>`;
  $("#f").onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target);
    try { const r = await api("setup", { body: Object.fromEntries(f) }); me = r.user; toast("Owner account created. Now delete SETUP_CODE in Cloudflare.", "good"); render(); }
    catch (err) { $("#err").textContent = err.message; }
  };
}
function loginView() {
  app.innerHTML = `<div class="auth"><div class="card"><h1>Log in</h1><p class="muted small">ESOWOLF team blog</p>
  <form id="f"><div class="field"><label>Username</label><input type="text" name="username" required autocomplete="username" autocapitalize="none" autofocus></div>
  <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password"></div>
  <button class="btn" style="width:100%">Log in</button><p class="err" id="err"></p></form></div></div>`;
  $("#f").onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target);
    const btn = ev.target.querySelector("button"); btn.disabled = true;
    try { const r = await api("login", { body: { username: String(f.get("username")).trim().toLowerCase(), password: f.get("password") } }); me = r.user; if (!location.hash) location.hash = "posts"; render(); }
    catch (err) { $("#err").textContent = err.message; btn.disabled = false; }
  };
}

/* ---------- posts list ---------- */
async function loadPosts(fresh) { const r = await api("posts" + (fresh ? "?fresh=1" : "")); posts = r.posts; livePosts = r.live; return r; }
async function postsView() {
  app.innerHTML = `<div class="row"><div class="grow"><h1>Posts</h1><p class="muted small">Live posts are on <a href="/blog/" target="_blank">esowolf.in/blog/</a>. New posts go live about 2 minutes after publishing.</p></div><button class="btn ghost" id="refresh" title="Re-read posts from GitHub (only needed if someone edited files on GitHub directly)">↻ Refresh</button><button class="btn" id="new">+ New post</button></div>
  <div class="toolbar"><input type="search" id="q" placeholder="Search posts…"><select id="st" style="max-width:180px"><option value="">All</option><option value="live">Live</option><option value="scheduled">Scheduled</option><option value="draft">Draft</option></select></div>
  <div class="plist" id="list"><p class="muted">Loading posts…</p></div>`;
  $("#new").onclick = () => go("edit", "new");
  $("#refresh").onclick = async () => { $("#refresh").disabled = true; try { await loadPosts(true); draw(); toast("Posts refreshed from GitHub.", "good"); } catch (err) { toast(err.message, "bad"); } $("#refresh").disabled = false; };
  try { await loadPosts(); } catch (err) { $("#list").innerHTML = `<p class="err">${e(err.message)}</p>`; return; }
  const draw = () => {
    const q = $("#q").value.toLowerCase().trim(), st = $("#st").value;
    const list = posts.filter(p => (!st || p.status === st) && (!q || (p.title + " " + p.slug + " " + p.keyword).toLowerCase().includes(q)));
    $("#list").innerHTML = list.length ? list.map(p => `<div class="pitem" data-slug="${e(p.slug)}" tabindex="0" role="button">
      ${p.cover ? `<img src="${e(coverSrc(p.cover))}" alt="" loading="lazy" data-cover="${e(p.cover)}">` : `<div class="noimg"></div>`}
      <div><h3>${e(p.title)}</h3><div class="meta"><span class="badge ${p.status}">${p.status === "live" ? "Live" : p.status === "scheduled" ? "Scheduled" : "Draft"}</span>${p.hasDraft ? ` <span class="badge draft">unpublished changes</span>` : ""}
      · ${e(p.status === "draft" ? "saved " + formatIST(p.updated) : formatIST(p.date))} · /blog/${e(p.slug)}/${p.author ? " · " + e(p.author) : ""}</div></div>
      <div class="act row">${p.status === "live" ? `<a class="btn ghost sm" href="/blog/${e(p.slug)}/" target="_blank" onclick="event.stopPropagation()">View</a>` : ""}<button class="btn ghost sm">Edit</button></div></div>`).join("")
      : `<div class="card center muted">${posts.length ? "No posts match." : "No posts yet. Click “+ New post” or pick a topic in the Content calendar."}</div>`;
    $$("#list img[data-cover]").forEach(i => imgFallback(i, i.dataset.cover, "-800"));
    $$("#list .pitem").forEach(el => { el.onclick = () => go("edit", el.dataset.slug); el.onkeydown = ev => { if (ev.key === "Enter") go("edit", el.dataset.slug); }; });
  };
  $("#q").oninput = draw; $("#st").onchange = draw; draw();
}

/* ---------- editor ---------- */
let pending = null; // topic handed over from the calendar
async function editView(slug) {
  const isNew = slug === "new" || !slug;
  app.innerHTML = `<p class="muted">Loading…</p>`;
  let post = { title: "", slug: "", description: "", summary: "", topic: "", keyword: "", keywords: [], short: "", cover: "", coverAlt: "", faqs: [], body: "" };
  let meta = { inRepo: false, repoStatus: null, hasDraft: false };
  try {
    if (!isNew) {   // one request gives the post and the list of other posts
      const r = await api("posts/" + encodeURIComponent(slug)); post = { ...post, ...r.post }; meta = r;
      if (!posts.length) { livePosts = r.live || []; posts = (r.all || []).map(x => ({ ...x, title: "", status: "" })); }
    } else if (!livePosts.length && !posts.length) await loadPosts().catch(() => {});
  } catch (err) { app.innerHTML = `<p class="err">${e(err.message)}</p><button class="btn ghost" onclick="location.hash='posts'">Back</button>`; return; }
  const origSlug = isNew ? "" : slug;
  let slugTouched = !isNew;
  const topicFill = pending; pending = null;
  const owner = me.role === "owner";
  const groupOpts = `<option value="">Choose…</option>` + cfg.groups.map(g => `<option value="${g.id}">${e(g.name)}</option>`).join("");

  app.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="btn ghost sm" id="back">← Posts</button><h1 class="grow" style="margin:0">${isNew ? "New post" : "Edit post"}</h1>
  ${meta.repoStatus ? `<span class="badge ${meta.repoStatus}">${meta.repoStatus === "live" ? "Live" : "Scheduled"}</span>` : `<span class="badge draft">Draft</span>`}${meta.inRepo && meta.hasDraft ? `<span class="badge draft">unpublished changes</span>` : ""}</div>
  <div class="ed"><div>
    <details class="gpt" id="gpt" ${isNew ? "open" : ""}><summary>✨ Write a post with ChatGPT</summary>
      <div class="grid2"><div class="field"><label>Topic / title idea</label><input type="text" id="gTopic"></div><div class="field"><label>Topic group</label><select id="gGroup">${groupOpts}</select></div></div>
      <div class="grid2"><div class="field"><label>Main keyword</label><input type="text" id="gKw"></div><div class="field"><label>Other keywords <small>(separate with ;)</small></label><input type="text" id="gKws"></div></div>
      <div class="field"><label>Notes for ChatGPT <small>(optional)</small></label><input type="text" id="gNotes"></div>
      <div class="field"><label>1. Copy this prompt and paste it into ChatGPT</label><textarea class="code" id="gPrompt" rows="8" readonly></textarea><div class="row" style="margin-top:8px"><button class="btn sm" type="button" id="copy">Copy prompt</button><a class="btn ghost sm" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT ↗</a></div></div>
      <div class="field"><label>2. Paste ChatGPT's whole answer here</label><textarea class="code" id="paste" rows="6" placeholder="TITLE: …"></textarea><div class="row" style="margin-top:8px"><button class="btn sm" type="button" id="fill">Fill the form</button><span class="status" id="fillMsg"></span></div></div>
    </details>
    <div class="card">
      <div class="field"><label>Title <span class="count" id="cTitle"></span></label><input type="text" id="title"></div>
      <div class="field"><label>URL slug</label><div class="row"><span class="muted small">esowolf.in/blog/</span><input type="text" id="slug" class="grow" style="width:auto"><span class="muted small">/</span></div><div class="hint" id="slugHint"></div></div>
      <div class="field"><label>Meta description <span class="count" id="cDesc"></span></label><textarea id="description" rows="2"></textarea></div>
      <div class="field"><label>Summary <small>(for blog cards)</small></label><textarea id="summary" rows="2"></textarea></div>
      <div class="grid2"><div class="field"><label>Topic group</label><select id="topic">${groupOpts}</select></div><div class="field"><label>Main keyword</label><input type="text" id="keyword"></div></div>
      <div class="grid2"><div class="field"><label>Other keywords <small>(separate with ;)</small></label><input type="text" id="keywords"></div><div class="field"><label>Short link code <small>(esowolf.in/go/…)</small></label><input type="text" id="short" placeholder="e.g. amazon-start"></div></div>
      <div class="field"><label>Cover image <small>(JPG/PNG/WebP up to 20 MB — we make a 1600×900 WebP and a 1200×630 share image)</small></label>
        <div class="cover"><img id="coverImg" alt="" hidden><div class="grow"><input type="file" id="coverFile" accept="image/*"><div class="hint" id="coverMsg"></div></div></div></div>
      <div class="field"><label>Cover alt text <small>(describe the picture)</small></label><input type="text" id="coverAlt"></div>
      <div class="field"><label>FAQs <small>(4–6)</small></label><div id="faqs"></div><button class="btn ghost sm" type="button" id="addFaq">+ Add FAQ</button></div>
      <div class="field"><label>Article <small>(Markdown: ## headings, | tables |, [links](/url). A YouTube link on its own line becomes a video, or upload your own below.)</small> <span class="count" id="cWords"></span></label><textarea id="body" class="code" rows="24"></textarea>
        <div class="vup"><input type="file" id="vidFile" accept="video/*" hidden><button class="btn ghost sm" type="button" id="ytBtn">▶ Add YouTube video</button><button class="btn ghost sm" type="button" id="vidBtn">🎬 Upload video</button><span class="hint" id="vidMsg">${r2 ? "MP4 or WebM, any size." : "Big videos are made smaller automatically to fit the website (best for videos up to ~3 minutes; longer ones → YouTube)."} The video goes where the cursor is in the article.</span>
        <div class="row grow" id="ytRow" hidden><input type="url" id="ytUrl" placeholder="https://youtu.be/… or https://youtube.com/shorts/…" class="grow"><button class="btn sm" type="button" id="ytAdd">Add</button></div><div class="vbar" id="vidBar" hidden><i></i></div></div></div>
    </div>
  </div>
  <aside class="side">
    <div class="card"><h2>SEO score</h2><div class="score"><div class="ring" id="ring"><b id="scoreNum">0%</b></div><div class="small muted" id="scoreMsg"></div></div><ul class="checks" id="checks"></ul></div>
    <div class="card"><h2>Google preview</h2><div class="gprev"><div class="u"><i></i><span>esowolf.in › blog › <span id="gpSlug"></span></span></div><div class="t" id="gpTitle"></div><div class="d" id="gpDesc"></div></div></div>
    <div class="card"><h2>Article preview</h2><iframe class="preview" id="prev" sandbox="allow-popups" title="Article preview"></iframe></div>
  </aside></div>
  <div class="actions">
    <button class="btn ghost" id="save">Save draft</button>
    <button class="btn" id="pub">${meta.repoStatus === "live" ? "Update live post" : "Publish now"}</button>
    <span class="row"><label for="when" class="small muted" style="margin:0">India time</label><input type="datetime-local" id="when" style="width:auto"><button class="btn ghost" id="sched">Schedule post</button></span>
    <span class="grow status" id="stat"></span>
    ${owner && (meta.inRepo || meta.hasDraft) ? `${meta.inRepo && meta.hasDraft ? `<button class="btn ghost sm" id="discard">Discard draft changes</button>` : ""}<button class="btn danger sm" id="del">Delete</button>` : ""}
  </div>`;

  const F = id => $("#" + id);
  const set = p => {
    for (const k of ["title", "slug", "description", "summary", "topic", "keyword", "short", "coverAlt", "body"]) if (p[k] !== undefined) F(k).value = p[k] || "";
    if (p.keywords !== undefined) F("keywords").value = (p.keywords || []).join("; ");
    if (p.faqs !== undefined) drawFaqs(p.faqs);
    if (p.cover !== undefined) { post.cover = p.cover; showCover(); }
  };
  const get = () => ({
    ...post,
    title: F("title").value.trim(), slug: F("slug").value.trim(), description: F("description").value.trim(), summary: F("summary").value.trim(),
    topic: F("topic").value, keyword: F("keyword").value.trim().toLowerCase(), keywords: F("keywords").value.split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean),
    short: F("short").value.trim().toLowerCase(), coverAlt: F("coverAlt").value.trim(), body: F("body").value,
    faqs: $$("#faqs .faq").map(r => ({ q: $("[data-q]", r).value.trim(), a: $("[data-a]", r).value.trim() })).filter(f => f.q || f.a)
  });
  function drawFaqs(list) {
    F("faqs").innerHTML = "";
    (list.length ? list : []).forEach(f => addFaqRow(f));
  }
  function addFaqRow(f = { q: "", a: "" }) {
    const d = document.createElement("div"); d.className = "faq";
    d.innerHTML = `<div><input type="text" data-q placeholder="Question" value="${e(f.q)}"><textarea data-a rows="2" placeholder="Answer" style="margin-top:6px">${e(f.a)}</textarea></div><button class="btn ghost sm del" type="button" title="Remove">✕</button>`;
    $(".del", d).onclick = () => { d.remove(); update(); };
    d.oninput = update; F("faqs").appendChild(d);
  }
  function showCover() {
    const img = F("coverImg");
    if (post.cover) { img.hidden = false; img.src = coverSrc(post.cover); imgFallback(img, post.cover, "-800"); } else img.hidden = true;
  }
  set(post); showCover();

  /* ChatGPT helper */
  const others = () => livePosts.filter(p => p.slug !== origSlug);
  const fillPrompt = () => { F("gPrompt").value = buildPrompt(cfg, { title: F("gTopic").value.trim(), topic: F("gGroup").value, keyword: F("gKw").value.trim(), keywords: F("gKws").value.split(";").map(s => s.trim()).filter(Boolean), notes: F("gNotes").value.trim() }, others()); };
  if (topicFill) { F("gTopic").value = topicFill.title || ""; F("gGroup").value = topicFill.group || ""; F("gKw").value = topicFill.keyword || ""; F("gKws").value = (topicFill.keywords || []).join("; "); F("gNotes").value = topicFill.notes || ""; }
  else if (!isNew) { F("gTopic").value = post.title; F("gGroup").value = post.topic; F("gKw").value = post.keyword; F("gKws").value = (post.keywords || []).join("; "); }
  ["gTopic", "gGroup", "gKw", "gKws", "gNotes"].forEach(id => F(id).oninput = fillPrompt); fillPrompt();
  F("copy").onclick = async () => { try { await navigator.clipboard.writeText(F("gPrompt").value); toast("Prompt copied. Paste it into ChatGPT.", "good"); } catch { F("gPrompt").select(); document.execCommand("copy"); toast("Prompt copied."); } };
  F("fill").onclick = () => {
    const r = parseChatGPT(F("paste").value, cfg);
    const got = ["title", "description", "summary", "topic", "keyword", "keywords", "short", "faqs", "body"].filter(k => Array.isArray(r[k]) ? r[k].length : r[k]);
    if (!got.length) { F("fillMsg").textContent = "Could not find the labelled sections (TITLE:, ARTICLE: …). Paste ChatGPT's whole answer."; return; }
    if (!slugTouched && r.title) r.slug = slugify(r.title); else delete r.slug;
    if (!r.topic) delete r.topic;
    set(r);
    F("fillMsg").textContent = `Filled: ${got.length} sections${r.faqs ? `, ${r.faqs.length} FAQs` : ""}. Now add a cover image and check the SEO score.`;
    update(); toast("Form filled from ChatGPT's answer.", "good");
  };

  /* fields */
  F("title").oninput = () => { if (!slugTouched) F("slug").value = slugify(F("title").value); update(); };
  F("slug").oninput = () => { slugTouched = true; update(); };
  F("slug").onblur = () => { F("slug").value = slugify(F("slug").value); update(); };
  ["description", "summary", "topic", "keyword", "keywords", "short", "coverAlt", "body"].forEach(id => F(id).addEventListener("input", update));
  F("topic").onchange = update;
  F("addFaq").onclick = () => { addFaqRow(); update(); };

  /* videos: (a) YouTube link, (b) upload — to R2 when it is connected (any size), otherwise into the site itself
     (compressed in the browser to fit 25 MB). Either way a ![…](video "poster WxH") line goes in at the cursor. */
  const insertAtCursor = (line, at) => {
    const ta = F("body"), v = ta.value; at = at ?? ta.selectionStart ?? v.length;
    const before = v.slice(0, at), after = v.slice(at);
    ta.value = before.replace(/\s*$/, "") + (before.trim() ? "\n\n" : "") + line + "\n\n" + after.replace(/^\s*/, "");
    update();
  };
  F("ytBtn").onclick = () => { F("ytRow").hidden = !F("ytRow").hidden; if (!F("ytRow").hidden) F("ytUrl").focus(); };
  F("ytAdd").onclick = () => {
    const u = F("ytUrl").value.trim();
    if (!youTubeId(u)) { toast("That is not a YouTube link. Copy the link from YouTube's Share button.", "bad"); return; }
    insertAtCursor(u); F("ytUrl").value = ""; F("ytRow").hidden = true; toast("YouTube video added.", "good");
  };
  F("vidBtn").onclick = () => F("vidFile").click();
  F("vidFile").onchange = async () => {
    const file = F("vidFile").files[0]; F("vidFile").value = ""; if (!file) return;
    if (!/^video\//.test(file.type)) { toast("Please choose a video file.", "bad"); return; }
    if (r2 && !/^video\/(mp4|webm)$/.test(file.type)) { toast("Please choose an MP4 or WebM video. iPhone .mov videos: convert to MP4 first.", "bad"); return; }
    const at = F("body").selectionStart ?? F("body").value.length;
    const msg = F("vidMsg"), bar = F("vidBar"), btn = F("vidBtn");
    const show = (t, pct) => { msg.textContent = t; if (pct != null) { bar.hidden = false; bar.firstChild.style.width = pct + "%"; } };
    const raw = (path, data, type) => fetch("/api/blog/" + path, { method: "PUT", headers: { "x-admin": "1", ...(type ? { "content-type": type } : {}) }, credentials: "same-origin", body: data }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Upload error " + r.status); return j; });
    const retry = async fn => { for (let t = 1; ; t++) { try { return await fn(); } catch (err) { if (t >= 3) throw err; await new Promise(r => setTimeout(r, 1500 * t)); } } };
    btn.disabled = true; let start;
    const away = ev => { ev.preventDefault(); ev.returnValue = ""; };
    addEventListener("beforeunload", away);
    try {
      show("Reading the video…", 0);
      const meta = await videoMeta(file);
      let url, poster = "", w = meta.w, h = meta.h;
      if (r2) {
        start = await api("videos/start", { body: { name: file.name, type: file.type, size: file.size } });
        const CH = 20 * 1024 * 1024, n = Math.ceil(file.size / CH), parts = [];
        for (let i = 0; i < n; i++) {
          show(`Uploading video… ${Math.round(i / n * 100)}% (${(file.size / 1048576).toFixed(0)} MB). Keep this tab open.`, i / n * 100);
          const q = `key=${encodeURIComponent(start.key)}&uploadId=${encodeURIComponent(start.uploadId)}`;
          parts.push(await retry(() => raw(`videos/part?${q}&n=${i + 1}`, file.slice(i * CH, (i + 1) * CH))));
        }
        show("Finishing…", 100);
        url = (await api("videos/complete", { body: { key: start.key, uploadId: start.uploadId, parts } })).url;
        if (meta.poster) { try { poster = (await raw(`videos/poster?key=${encodeURIComponent(start.key)}`, meta.poster)).url; } catch {} }
      } else {
        const { compressVideo, SITE_LIMIT } = await import("./video.mjs?v=1");
        let blob = file;
        if (file.size > SITE_LIMIT || file.type !== "video/mp4") {
          show(`Making the video smaller so it fits the website (${(file.size / 1048576).toFixed(0)} MB → under 25 MB). This takes about as long as the video. Keep this tab open…`, 0);
          const out = await compressVideo(file, (p, attempt) => show(`${attempt ? "Second pass — " : ""}Making the video smaller… ${Math.round(p * 100)}%. Keep this tab open.`, p * 100));
          blob = out.blob; w = out.width; h = out.height;
          if (out.lostSound) toast("Note: this browser could not keep the sound. Try Google Chrome on a computer if the video needs sound.", "bad");
        }
        const b64 = async b => { const d = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Could not read the file.")); r.readAsDataURL(b); }); return d.slice(d.indexOf(",") + 1); };
        show(`Uploading video (${(blob.size / 1048576).toFixed(1)} MB)… Keep this tab open.`, 100);
        const vSha = (await retry(async () => raw("videos/blob", await b64(blob), "text/plain"))).sha;
        let pSha = "";
        if (meta.poster) { try { pSha = (await raw("videos/blob", await b64(meta.poster), "text/plain")).sha; } catch {} }
        show("Saving…", 100);
        const saved = await api("videos/save", { body: { sha: vSha, poster: pSha } });
        url = saved.url; poster = saved.poster;
      }
      const label = (F("title").value.trim() || file.name.replace(/\.[^.]+$/, "")).replace(/[\[\]]/g, "");
      const extra = [poster, w ? w + "x" + h : ""].filter(Boolean).join(" ");
      insertAtCursor(`![Video: ${label}](${url}${extra ? ` "${extra}"` : ""})`, at);
      bar.hidden = true;
      show(r2 ? "Video added to the article. You can edit the text after “Video:” to describe it."
              : "Video added to the article. It plays on the live post a minute after you publish (not in the preview here). You can edit the text after “Video:”.");
      toast("Video uploaded.", "good");
    } catch (err) {
      if (start) api("videos/abort", { body: { key: start.key, uploadId: start.uploadId } }).catch(() => {});
      bar.hidden = true; show("Upload failed: " + err.message); toast(err.message, "bad");
    } finally { btn.disabled = false; removeEventListener("beforeunload", away); }
  };

  /* cover upload: convert in the browser, then commit through the API */
  F("coverFile").onchange = async () => {
    const file = F("coverFile").files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { F("coverMsg").textContent = "This file is bigger than 20 MB."; return; }
    F("coverMsg").textContent = "Converting…";
    try {
      const bmp = await createImageBitmap(file);
      const webp = await crop(bmp, 1600, 900, "image/webp", .8), webp800 = await crop(bmp, 800, 450, "image/webp", .8), og = await crop(bmp, 1200, 630, "image/jpeg", .85);
      F("coverImg").hidden = false; F("coverImg").src = URL.createObjectURL(webp800.blob);
      F("coverMsg").textContent = `Uploading (${Math.round((webp.blob.size + webp800.blob.size + og.blob.size) / 1024)} KB)…`;
      const r = await api("images", { body: { webp: webp.b64, webp800: webp800.b64, og: og.b64 } });
      post.cover = r.cover;
      F("coverMsg").textContent = "Cover saved ✓ (" + r.cover + ")";
      if (!F("coverAlt").value) F("coverAlt").focus();
      update();
    } catch (err) { F("coverMsg").textContent = err.message; }
  };

  /* live checks */
  let t;
  function update() { clearTimeout(t); t = setTimeout(refresh, 150); }
  function refresh() {
    const p = get();
    const tl = p.title.length, dl = p.description.length;
    F("cTitle").textContent = tl + " / 30–65"; F("cTitle").className = "count " + (tl >= 30 && tl <= 65 ? "ok" : "bad");
    F("cDesc").textContent = dl + " / 120–160"; F("cDesc").className = "count " + (dl >= 120 && dl <= 160 ? "ok" : "bad");
    F("slugHint").textContent = p.slug && !isValidSlug(p.slug) ? "Only a–z, 0–9 and hyphens." : (posts.some(x => x.slug === p.slug && x.slug !== origSlug) ? "Another post already uses this slug." : "");
    const s = seoScore(p, cfg, others().map(x => x.slug));
    F("cWords").textContent = s.words.toLocaleString("en-IN") + " words";
    const ring = F("ring"); ring.style.setProperty("--p", s.score); ring.style.setProperty("--c", s.score >= cfg.minSeoScore ? "var(--ok)" : s.score >= 60 ? "var(--warn)" : "var(--bad)");
    F("scoreNum").textContent = s.score + "%";
    F("scoreMsg").textContent = s.score >= cfg.minSeoScore ? "Ready to publish." : (owner ? `Below ${cfg.minSeoScore}%. As owner you can still publish.` : `Editors can publish from ${cfg.minSeoScore}%. Fix the items marked ✕.`);
    F("checks").innerHTML = s.checks.sort((a, b) => a.ok - b.ok).map(c => `<li class="${c.ok ? "ok" : "no"}"><span class="i">${c.ok ? "✓" : "✕"}</span><span>${e(c.label)}</span><span class="pt">${c.points}/${c.max}</span>${!c.ok && c.tip ? `<span class="tip">${e(c.tip)}</span>` : ""}</li>`).join("");
    F("gpSlug").textContent = p.slug || "…"; F("gpTitle").textContent = (p.title || "Post title") + " | " + cfg.shortBrand; F("gpDesc").textContent = p.description || "Meta description…";
    const can = owner || s.score >= cfg.minSeoScore;
    F("pub").disabled = F("sched").disabled = !can;
    F("pub").title = F("sched").title = can ? "" : `SEO score must be at least ${cfg.minSeoScore}%`;
    drawPreview(p);
  }
  function drawPreview(p) {
    const md = window.marked ? window.marked.parse(preprocessMarkdown(p.body || "")) : `<pre>${e(p.body)}</pre>`;
    F("prev").srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:18px;background:#0e0e0e;color:#e5e5e5;font:16px/1.7 system-ui,sans-serif}h1{font-size:26px;line-height:1.2}h2{font-size:21px;margin-top:28px}a{color:#ff8c1a}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #333;padding:7px}img,video{max-width:100%}.yt{position:relative;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden}.yt button{all:unset;display:block;width:100%;height:100%}.yt img{width:100%;height:100%;object-fit:cover}.yt-play{position:absolute;left:50%;top:50%;width:64px;height:44px;margin:-22px 0 0 -32px;border-radius:12px;background:#f26a1b}</style>
      ${p.cover ? `<img src="${raw(coverSrc(p.cover))}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px">` : ""}<h1>${e(p.title)}</h1>${md}
      ${p.faqs.length ? `<h2>Frequently asked questions</h2>${p.faqs.map(f => `<p><b>${e(f.q)}</b><br>${e(f.a)}</p>`).join("")}` : ""}`;
  }
  refresh();
  if (!window.marked) addEventListener("load", refresh, { once: true });

  /* actions */
  F("back").onclick = () => go("posts");
  const busy = (on, msg = "") => { $$(".actions button").forEach(b => b.disabled = on); F("stat").textContent = msg; if (!on) refresh(); };
  const check = p => {
    if (!p.title) throw new Error("Add a title.");
    if (!isValidSlug(p.slug)) throw new Error("The URL slug can only use a–z, 0–9 and hyphens.");
  };
  F("save").onclick = async () => {
    const p = get();
    try { check(p); busy(true, "Saving draft…"); const r = await api("drafts", { body: { post: p, oldSlug: origSlug } }); toast("Draft saved.", "good"); busy(false, "Draft saved " + new Date().toLocaleTimeString("en-IN")); if (r.slug !== origSlug) location.replace("#edit/" + r.slug); }
    catch (err) { busy(false); toast(err.message, "bad"); }
  };
  const publish = async (mode) => {
    const p = get();
    try {
      check(p);
      let when = "";
      if (mode === "schedule") { when = istInputToISO(F("when").value); if (!F("when").value) throw new Error("Pick the date and time (India time) first."); if (new Date(when) <= new Date()) throw new Error("Pick a time in the future."); }
      const s = seoScore(p, cfg, others().map(x => x.slug));
      if (s.score < cfg.minSeoScore && !(await ask(`SEO score is ${s.score}% (minimum ${cfg.minSeoScore}%). Publish anyway as owner?`, "Publish anyway"))) return;
      busy(true, mode === "schedule" ? "Scheduling…" : "Publishing…");
      const r = await api("publish", { body: { post: p, oldSlug: origSlug || p.slug, mode, when } });
      toast(r.status === "scheduled" ? `Scheduled for ${formatIST(r.date)} (India time).` : "Published! It will be live in about 2 minutes.", "good");
      busy(false, r.status === "scheduled" ? `Scheduled: ${formatIST(r.date)}` : `Live soon at ${r.url}`);
      await loadPosts().catch(() => {});
      location.replace("#edit/" + r.slug);
    } catch (err) { busy(false); toast(err.message, "bad"); }
  };
  F("pub").onclick = () => publish("now");
  F("sched").onclick = () => publish("schedule");
  if (meta.repoStatus === "scheduled" && post.date) F("when").value = isoToISTInput(post.date);
  if ($("#del")) $("#del").onclick = async () => {
    if (!(await ask(`Delete “${post.title || origSlug}” for good? ${meta.inRepo ? "It will be removed from the website." : ""}`, "Delete"))) return;
    try { busy(true, "Deleting…"); await api("posts/" + encodeURIComponent(origSlug), { method: "DELETE" }); toast("Post deleted.", "good"); go("posts"); }
    catch (err) { busy(false); toast(err.message, "bad"); }
  };
  if ($("#discard")) $("#discard").onclick = async () => {
    if (!(await ask("Throw away the unpublished changes and go back to the live version?", "Discard"))) return;
    try { await api("posts/" + encodeURIComponent(origSlug) + "?what=draft", { method: "DELETE" }); editView(origSlug); }
    catch (err) { toast(err.message, "bad"); }
  };
}
async function crop(bmp, w, h, type, q) {
  const r = Math.max(w / bmp.width, h / bmp.height);
  const sw = w / r, sh = h / r, sx = (bmp.width - sw) / 2, sy = (bmp.height - sh) / 2;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
  if (type === "image/jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); }
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const blob = await new Promise(res => c.toBlob(res, type, q));
  if (!blob || blob.type !== type) throw new Error("This browser cannot make WebP images. Please use Chrome, Edge or Firefox.");
  const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  return { blob, b64 };
}

/* ---------- content calendar ---------- */
async function calendarView() {
  app.innerHTML = `<h1>Content calendar</h1><p class="muted small">Problem-based topics — real searches Amazon, Meesho and Myntra sellers type into Google. 3 posts a week (Mon, Wed, Fri). HUB posts are the big guides; link the smaller posts to them. A topic is marked done when a post's title contains its main keyword.</p><div class="cal" id="cal"><p class="muted">Loading…</p></div>`;
  await loadPosts().catch(() => {});
  const titles = posts.map(p => p.title.toLowerCase());
  const today = new Date().toISOString().slice(0, 10);
  $("#cal").innerHTML = calendar.length ? calendar.map((c, i) => {
    const done = titles.some(t => t.includes(String(c.keyword).toLowerCase()));
    const g = cfg.groups.find(x => x.id === c.group);
    const d = new Date(c.date + "T00:00:00+05:30");
    return `<div class="citem ${done ? "done" : ""}"><div class="d">${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}<small>${d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" })}${c.date === today ? " · today" : ""}</small></div>
    <div><h3>${done ? "✓ " : ""}${e(c.title)}</h3><p><b>${e(g ? g.name : c.group)}</b> · keyword: <b>${e(c.keyword)}</b></p><p>Other: ${e((c.keywords || []).join("; "))}</p>${c.notes ? `<p>Notes: ${e(c.notes)}</p>` : ""}</div>
    <div>${done ? `<span class="badge live">Done</span>` : `<button class="btn sm" data-i="${i}">Write with ChatGPT</button>`}</div></div>`;
  }).join("") : `<p class="muted">No calendar found.</p>`;
  $$("#cal [data-i]").forEach(b => b.onclick = () => { pending = calendar[+b.dataset.i]; go("edit", "new"); });
}

/* read a video's size and grab a frame (at ~1 s) as the poster image */
function videoMeta(file) {
  return new Promise(res => {
    const v = document.createElement("video"), url = URL.createObjectURL(file);
    let done = false; const end = r => { if (done) return; done = true; URL.revokeObjectURL(url); res(r); };
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    setTimeout(() => end({ w: v.videoWidth, h: v.videoHeight }), 15000);
    v.onerror = () => end({});
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = () => {
      const w = v.videoWidth, h = v.videoHeight, s = Math.min(1, 1280 / Math.max(w, h));
      const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
      try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); c.toBlob(b => end({ w, h, poster: b }), "image/jpeg", 0.82); }
      catch { end({ w, h }); }
    };
  });
}

/* ---------- stats (cookie-free counts from /api/t) ---------- */
const TARGETS = [
  [/^engine\.esowolf\.in/, "ESO Hunt Engine sign up"], [/^booking\.closer\.esowolf\.in/, "Book Meeting"], [/^webinar\.esowolf\.in/, "Join Webinar"],
  [/^whatsapp$/, "WhatsApp chat"], [/^call$/, "Phone call"], [/^email$/, "Email"], [/^woochatofficial\.esowolf\.in\/live-demo/, "WOO Chat live demo"],
  [/^bookdemo\.esowolf\.in/, "Book free demo (Meesho/Myntra)"], [/^meesho\.esowolf\.in/, "Meesho Profit sign up"], [/^myntra\.esowolf\.in/, "Myntra Profit sign up"]
];
const SECTIONS = { top: "Hero", amazon: "Amazon slide", meesho: "Meesho slide", myntra: "Myntra slide", whatsapp: "WOO Chat slide", contact: "Contact", nav: "Top menu", footer: "Footer", float: "Floating WhatsApp button", blog: "Blog" };
const targetLabel = t => { for (const [re, l] of TARGETS) if (re.test(t)) return l; return t.startsWith("/") ? "Page " + t : t; };
function splitClick(name) { const r = name.slice(6); const i = r.indexOf(":"); const sec = i > 0 && SECTIONS[r.slice(0, i)] ? r.slice(0, i) : ""; return { sec, target: sec ? r.slice(i + 1) : r }; }
async function statsView(days = +(sessionStorage.getItem("statsDays") || 30)) {
  app.innerHTML = `<div class="row"><h1 class="grow" style="margin:0">Visitors &amp; clicks</h1>${[7, 30, 90].map(d => `<button class="btn sm ${d === days ? "" : "ghost"}" data-d="${d}">${d} days</button>`).join("")}</div>
  <p class="muted small">Counted without cookies (daily totals only, bots skipped). Numbers start from the day this was switched on.</p><div id="st"><p class="muted">Loading…</p></div>`;
  $$("[data-d]").forEach(b => b.onclick = () => { try { sessionStorage.setItem("statsDays", b.dataset.d); } catch {} statsView(+b.dataset.d); });
  let d; try { d = await api("stats?days=" + days); } catch (err) { $("#st").innerHTML = `<p class="err">${e(err.message)}</p>`; return; }
  const sum = pre => d.totals.filter(t => t.name.startsWith(pre)).reduce((a, t) => a + t.n, 0);
  const byTarget = new Map(), rows = [];
  for (const t of d.totals.filter(t => t.name.startsWith("click:"))) { const c = splitClick(t.name), l = targetLabel(c.target); byTarget.set(l, (byTarget.get(l) || 0) + t.n); rows.push({ l, where: SECTIONS[c.sec] || "—", n: t.n }); }
  const kpi = (label, n) => `<div class="kpi"><b>${n.toLocaleString("en-IN")}</b><span>${label}</span></div>`;
  const map = new Map(d.daily.map(x => [x.day, x.n])); const series = [];
  for (let i = days - 1; i >= 0; i--) { const k = new Date(Date.now() + 5.5 * 3600e3 - i * 864e5).toISOString().slice(0, 10); series.push([k, map.get(k) || 0]); }
  const max = Math.max(1, ...series.map(x => x[1]));
  const table = (title, head, list) => `<div class="card"><h2>${title}</h2>${list.length ? `<table class="t"><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>${list.map(r => `<tr>${r.map((c, i) => `<td${i === r.length - 1 ? ' class="num"' : ""}>${e(String(c))}</td>`).join("")}</tr>`).join("")}</table>` : `<p class="muted small">Nothing yet.</p>`}</div>`;
  $("#st").innerHTML = `<div class="kpis">${kpi("Page views", sum("view:"))}${kpi("Hunt Engine sign up clicks", byTarget.get("ESO Hunt Engine sign up") || 0)}${kpi("Book Meeting clicks", byTarget.get("Book Meeting") || 0)}${kpi("Join Webinar clicks", byTarget.get("Join Webinar") || 0)}${kpi("WhatsApp clicks", byTarget.get("WhatsApp chat") || 0)}</div>
  <div class="card"><h2>Page views per day</h2><div class="bars" style="--n:${series.length}">${series.map(([k, n]) => `<i style="height:${Math.round(n / max * 100)}%" title="${k}: ${n}"></i>`).join("")}</div><div class="row small muted"><span class="grow">${series[0][0]}</span><span>${series[series.length - 1][0]}</span></div></div>
  <div class="sgrid">
  ${table("Button &amp; link clicks", ["Button / link", "Where", "Clicks"], rows.map(r => [r.l, r.where, r.n]))}
  ${table("Top pages", ["Page", "Views"], d.totals.filter(t => t.name.startsWith("view:")).slice(0, 20).map(t => [t.name.slice(5), t.n]))}
  ${table("Where visitors came from", ["Website", "Visits"], d.totals.filter(t => t.name.startsWith("ref:")).slice(0, 20).map(t => [t.name.slice(4), t.n]))}
  </div>`;
}

/* ---------- team ---------- */
async function teamView() {
  app.innerHTML = `<h1>Team</h1><p class="muted small">Owners manage the team, delete posts and can publish below the SEO minimum. Editors write, save drafts and publish when the SEO score is ${cfg.minSeoScore}% or more.</p>
  <div class="card" style="margin:14px 0"><h2>Add a member</h2><form id="add" class="row" style="align-items:flex-end">
  <div class="grow"><label>Username <small>(a–z, 0–9, . _ -)</small></label><input type="text" name="username" required pattern="[a-z0-9._-]{3,32}" autocapitalize="none"></div>
  <div class="grow"><label>Password <small>(10+ characters)</small></label><input type="text" name="password" required minlength="10" autocomplete="off"></div>
  <div><label>Role</label><select name="role"><option value="editor">Editor</option><option value="owner">Owner</option></select></div>
  <button class="btn">Add</button></form><p class="hint">Share the username and password with the person yourself (for example on WhatsApp). They cannot change it themselves — use “Reset password”.</p></div>
  <div class="card" style="overflow-x:auto"><table class="t" id="users"><tr><td class="muted">Loading…</td></tr></table></div>`;
  const draw = async () => {
    const { users } = await api("users");
    $("#users").innerHTML = `<tr><th>Username</th><th>Role</th><th>Status</th><th>Added</th><th></th></tr>` + users.map(u => `<tr data-u="${e(u.username)}"><td><b>${e(u.username)}</b>${u.username === me.username ? " (you)" : ""}</td>
      <td><select data-role ${u.username === me.username ? "disabled" : ""}><option value="editor" ${u.role === "editor" ? "selected" : ""}>Editor</option><option value="owner" ${u.role === "owner" ? "selected" : ""}>Owner</option></select></td>
      <td>${u.disabled ? `<span class="badge draft">Disabled</span>` : `<span class="badge live">Active</span>`}</td><td class="small muted">${e(formatIST(u.created))}</td>
      <td class="row end"><button class="btn ghost sm" data-reset>Reset password</button>${u.username === me.username ? "" : `<button class="btn ghost sm" data-dis>${u.disabled ? "Enable" : "Disable"}</button><button class="btn danger sm" data-del>Remove</button>`}</td></tr>`).join("");
    $$("#users tr[data-u]").forEach(tr => {
      const u = tr.dataset.u, row = users.find(x => x.username === u);
      const act = async (fn, msg) => { try { await fn(); toast(msg, "good"); draw(); } catch (err) { toast(err.message, "bad"); draw(); } };
      $("[data-role]", tr).onchange = ev => act(() => api(`users/${u}/role`, { body: { role: ev.target.value } }), "Role changed.");
      $("[data-reset]", tr).onclick = () => { const pw = prompt(`New password for ${u} (10+ characters):`); if (pw) act(() => api(`users/${u}/password`, { body: { password: pw } }), "Password reset. Share it with them."); };
      if ($("[data-dis]", tr)) $("[data-dis]", tr).onclick = () => act(() => api(`users/${u}/disable`, { body: { disabled: !row.disabled } }), row.disabled ? "Enabled." : "Disabled.");
      if ($("[data-del]", tr)) $("[data-del]", tr).onclick = async () => { if (await ask(`Remove ${u} from the team?`, "Remove")) act(() => api(`users/${u}`, { method: "DELETE" }), "Removed."); };
    });
  };
  $("#add").onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    try { await api("users", { body: { ...f, username: f.username.trim().toLowerCase() } }); toast(`${f.username} added.`, "good"); ev.target.reset(); draw(); } catch (err) { toast(err.message, "bad"); }
  };
  draw().catch(err => $("#users").innerHTML = `<tr><td class="err">${e(err.message)}</td></tr>`);
}
