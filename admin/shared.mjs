/* Shared blog logic — used by the admin app (browser), the API (Cloudflare Pages Function)
   and the build script (Node). Plain ES module, no dependencies. */

export const FIELDS = ["title", "slug", "description", "summary", "topic", "keyword", "keywords", "short", "cover", "coverAlt", "date", "updated", "author", "faqs"];

/* ---------- small helpers ---------- */
export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
export function isValidSlug(s) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s || "") && s.length <= 80; }
export function isValidUsername(u) { return /^[a-z0-9._-]{3,32}$/.test(u || ""); }
export function isValidShort(c) { return c === "" || /^[a-z0-9-]{2,40}$/.test(c || ""); }

/* India time (UTC+05:30) — the site's time zone for scheduling. */
export function toISTISO(date) {
  const d = new Date(date);
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 19) + "+05:30";
}
export function istInputToISO(v) { // "2026-11-03T10:00" (India time) → ISO with offset
  if (!v) return "";
  return (v.length === 16 ? v + ":00" : v.slice(0, 19)) + "+05:30";
}
export function isoToISTInput(iso) { return iso ? toISTISO(iso).slice(0, 16) : ""; }
export function formatIST(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ---------- post file format: Markdown with JSON-valued YAML frontmatter ---------- */
export function serializePost(p) {
  const lines = ["---"];
  for (const k of FIELDS) {
    if (p[k] === undefined || p[k] === null || p[k] === "") continue;
    if (Array.isArray(p[k]) && !p[k].length) continue;
    lines.push(`${k}: ${JSON.stringify(p[k])}`);
  }
  lines.push("---", "");
  return lines.join("\n") + String(p.body || "").replace(/\r\n?/g, "\n").trim() + "\n";
}
export function parsePost(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const post = { body: m ? m[2].trim() : src.trim() };
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i < 1) continue;
      const k = line.slice(0, i).trim(), raw = line.slice(i + 1).trim();
      try { post[k] = JSON.parse(raw); } catch { post[k] = raw.replace(/^["']|["']$/g, ""); }
    }
  }
  post.keywords = Array.isArray(post.keywords) ? post.keywords : (post.keywords ? String(post.keywords).split(/[;,]/).map(s => s.trim()).filter(Boolean) : []);
  post.faqs = Array.isArray(post.faqs) ? post.faqs.filter(f => f && (f.q || f.a)) : [];
  return post;
}

/* ---------- ChatGPT answer → form fields ---------- */
const LABELS = ["TITLE", "META DESCRIPTION", "SUMMARY", "TOPIC GROUP", "MAIN KEYWORD", "OTHER KEYWORDS", "SHORT LINK CODE", "FAQ", "ARTICLE", "END OF ARTICLE"];
export function parseChatGPT(text, cfg) {
  let s = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[​﻿]/g, "");
  // drop code fences (with or without a language), keep their content
  s = s.replace(/^\s*```[a-z]*\s*$/gim, "");
  const out = { faqs: [] };
  // normalise label lines: "**TITLE:**", "## TITLE:", "Title :" → "TITLE:"
  const labelRe = new RegExp("^[\\s>*#_`-]*(" + LABELS.map(l => l.replace(/ /g, "\\s+")).join("|") + "|Q|A)\\s*[*_]*\\s*[:：]\\s*[*_]*", "i");
  const lines = s.split("\n");
  let cur = null, buf = [], inArticle = false, article = [], faq = null;
  const flush = () => {
    if (!cur) return;
    const v = buf.join("\n").trim();
    const key = cur.toUpperCase().replace(/\s+/g, " ");
    if (key === "Q") { faq = { q: clean(v), a: "" }; out.faqs.push(faq); }
    else if (key === "A") { if (faq) faq.a = clean(v); else out.faqs.push({ q: "", a: clean(v) }); }
    else if (key === "TITLE") out.title = clean(v);
    else if (key === "META DESCRIPTION") out.description = clean(v);
    else if (key === "SUMMARY") out.summary = clean(v);
    else if (key === "TOPIC GROUP") out.topic = matchGroup(clean(v), cfg);
    else if (key === "MAIN KEYWORD") out.keyword = clean(v).toLowerCase();
    else if (key === "OTHER KEYWORDS") out.keywords = clean(v).split(/[;,\n]/).map(x => x.trim().replace(/^[-•*]\s*/, "").toLowerCase()).filter(Boolean);
    else if (key === "SHORT LINK CODE") out.short = slugify(clean(v));
    buf = [];
  };
  for (const line of lines) {
    if (inArticle) {
      if (/^[\s*_#`>-]*END\s+OF\s+ARTICLE[\s*_:.]*$/i.test(line)) { inArticle = false; continue; }
      article.push(line); continue;
    }
    const m = line.match(labelRe);
    if (m) {
      flush();
      const lab = m[1].toUpperCase().replace(/\s+/g, " ");
      const rest = line.slice(m[0].length);
      if (lab === "ARTICLE") { inArticle = true; cur = null; if (rest.trim()) article.push(rest); continue; }
      if (lab === "END OF ARTICLE" || lab === "FAQ") { cur = null; continue; }
      cur = lab; buf = [rest];
      continue;
    }
    if (cur) buf.push(line);
  }
  flush();
  if (article.length) {
    let body = article.join("\n").replace(/^\s+|\s+$/g, "");
    body = body.replace(/^#\s+[^\n]*\n+/, ""); // no "# Title" line
    out.body = body;
  }
  out.faqs = out.faqs.filter(f => f.q || f.a);
  if (out.title && !out.slug) out.slug = slugify(out.title);
  return out;
}
function clean(v) {
  return String(v || "").replace(/^[\s*_`"“”]+|[\s*_`"“”]+$/g, "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}
function matchGroup(v, cfg) {
  const t = String(v || "").toLowerCase();
  const g = (cfg && cfg.groups || []).find(g => g.id === t || g.name.toLowerCase() === t || t.includes(g.name.toLowerCase()) || t.includes(g.id));
  return g ? g.id : "";
}

/* ---------- Markdown extras: YouTube lines and .mp4 "images" ---------- */
export function youTubeId(url) {
  const m = String(url).match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}
export function preprocessMarkdown(md) {
  return String(md || "").replace(/\r\n?/g, "\n").split("\n").map(line => {
    const t = line.trim();
    const id = /^https?:\/\/\S+$/.test(t) ? youTubeId(t) : "";
    if (id) return `\n<div class="yt" data-id="${id}"><button type="button" aria-label="Play video"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="yt-play" aria-hidden="true"></span></button></div>\n`;
    // ![description](video.mp4 "poster.jpg 1080x1920")  — poster image and size are optional
    const v = t.match(/^!\[([^\]]*)\]\(([^)\s]+\.(?:mp4|webm))(?:\s+"([^"]*)")?\)$/i);
    if (v) {
      const extra = String(v[3] || ""), poster = (extra.match(/(\S+\.(?:jpe?g|webp|png))/i) || [])[1], size = extra.match(/(\d{2,5})x(\d{2,5})/);
      const tall = size && +size[2] > +size[1];
      return `\n<video class="post-video${tall ? " tall" : ""}" src="${escapeHtml(v[2])}"${poster ? ` poster="${escapeHtml(poster)}"` : ""}${size ? ` width="${size[1]}" height="${size[2]}"` : ""} controls preload="${poster ? "none" : "metadata"}" playsinline aria-label="${escapeHtml(v[1])}"></video>\n`;
    }
    return line;
  }).join("\n");
}
export function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------- text helpers for the SEO checks ---------- */
export function plainText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
export function wordCount(md) { const t = plainText(md); return t ? t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length : 0; }
export function headings(md) { return String(md || "").split(/\r?\n/).filter(l => /^##\s+\S/.test(l) && !/^###/.test(l)).map(l => l.replace(/^##\s+/, "").trim()); }
export function hasTable(md) {
  const L = String(md || "").split(/\r?\n/);
  for (let i = 0; i < L.length - 1; i++) if (/^\s*\|.*\|\s*$/.test(L[i]) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(L[i + 1])) return true;
  return false;
}
export function links(md) {
  const out = []; const re = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g; let m;
  while ((m = re.exec(String(md || "")))) if (!m[1]) out.push(m[3]);
  return out;
}
export function normUrl(u, site) {
  let s = String(u || "").trim();
  if (site && s.startsWith(site)) s = s.slice(site.length) || "/";
  s = s.replace(/^https?:\/\/(www\.)?esowolf\.in(?=\/|$)/, "") || s;
  if (s === "") s = "/";
  if (s === "/#signup") s = "/#amazon";   // old name of the Amazon slide
  return s;
}
export function isInternal(u, site) {
  const s = String(u || "");
  return s.startsWith("/") || /^https?:\/\/([a-z0-9-]+\.)*esowolf\.in(\/|$|\?|#)/i.test(s) || (site && s.startsWith(site));
}
function firstSentences(md, n) {
  const paras = String(md || "").split(/\n\s*\n/).map(p => p.trim()).filter(p => p && !/^#/.test(p) && !/^\|/.test(p) && !/^<(div|video)/.test(p));
  const t = plainText(paras.slice(0, 3).join(" "));
  return t.split(/(?<=[.!?])\s+/).slice(0, n).join(" ");
}

/* ---------- SEO score ---------- */
export function seoScore(p, cfg, existingSlugs = []) {
  const kw = String(p.keyword || "").trim().toLowerCase();
  const title = String(p.title || "").trim(), desc = String(p.description || "").trim(), body = String(p.body || "");
  const checks = [];
  const add = (id, label, ok, max, tip, partial) => checks.push({ id, label, ok: !!ok, max, points: ok ? max : (partial || 0), tip });

  add("title-len", `Title is 30–65 characters (now ${title.length})`, title.length >= 30 && title.length <= 65, 10, title.length < 30 ? "Make the title longer and more specific." : "Shorten the title so Google shows all of it.");
  const ki = kw ? title.toLowerCase().indexOf(kw) : -1;
  add("title-kw", "Main keyword near the start of the title", kw && ki > -1 && ki <= 25, 5, kw ? (ki < 0 ? `Put “${kw}” in the title.` : "Move the main keyword closer to the start of the title.") : "Fill in the main keyword.", kw && ki > -1 ? 2 : 0);
  add("desc-len", `Meta description is 120–160 characters (now ${desc.length})`, desc.length >= 120 && desc.length <= 160, 8, desc.length < 120 ? "Write a longer meta description (one or two full sentences)." : "Shorten the meta description to 160 characters.");
  add("desc-kw", "Main keyword in the meta description", kw && desc.toLowerCase().includes(kw), 4, "Use the main keyword once in the meta description.");
  add("intro-kw", "Main keyword in the first 2–3 sentences", kw && firstSentences(body, 3).toLowerCase().includes(kw), 8, "Answer the question directly in the first sentences and use the main keyword there.");
  const h = headings(body).length;
  add("headings", `4–8 “##” headings (now ${h})`, h >= 4 && h <= 8, 8, h < 4 ? "Split the article into more sections with ## headings." : "Merge some sections — use at most 8 ## headings.", h >= 2 ? 3 : 0);
  const wc = wordCount(body);
  const wcOk = (wc >= 1000 && wc <= 1500) || (wc >= 1600 && wc <= 2200);
  add("words", `Word count 1,000–1,500 (or 1,600–2,200 for a big guide) — now ${wc.toLocaleString("en-IN")}`, wcOk, 10, wc < 1000 ? "The article is too short — add useful detail, examples or steps." : "Trim the article to the target length.", wc >= 700 ? 5 : 0);
  add("table", "At least one table", hasTable(body), 6, "Add one simple table (for example a comparison or a checklist).");

  const site = cfg && cfg.site || "";
  const allowed = new Set([...(cfg && cfg.links || []).map(l => normUrl(l.url, site)), ...existingSlugs.map(s => `/blog/${s}/`)]);
  const internal = links(body).filter(u => isInternal(u, site)).map(u => normUrl(u, site));
  const bad = internal.filter(u => !allowed.has(u) && !allowed.has(u.replace(/\/$/, "")) && !allowed.has(u + "/"));
  const group = (cfg && cfg.groups || []).find(g => g.id === p.topic);
  const guide = group ? normUrl(group.guide, site) : "";
  const n = internal.length;
  add("links-count", `4–8 internal links (now ${n})`, n >= 4 && n <= 8, 6, n < 4 ? "Add links to our pages from the allowed list." : "Use at most 8 internal links.", n >= 2 ? 3 : 0);
  add("links-allowed", "Internal links only from the allowed list", n > 0 && bad.length === 0, 3, bad.length ? `Not on the allowed list: ${bad.slice(0, 3).join(", ")}` : "Add internal links from the allowed list.");
  add("links-guide", "Links to the topic group's main guide", !!guide && internal.some(u => u === guide || u.replace(/\/$/, "") === guide.replace(/\/$/, "")), 3, group ? `Add a link to ${group.guide}` : "Choose a topic group first.");

  const fq = (p.faqs || []).filter(f => f.q && f.a).length;
  add("faqs", `4–6 FAQs (now ${fq})`, fq >= 4 && fq <= 6, 8, fq < 4 ? "Add more questions and answers." : "Keep at most 6 FAQs.", fq >= 2 ? 4 : 0);
  add("cover", "Cover image with alt text", !!p.cover && String(p.coverAlt || "").trim().length >= 5, 7, !p.cover ? "Upload a cover image." : "Describe the cover image in the alt text.", p.cover ? 3 : 0);

  const all = [title, desc, p.summary, body, ...(p.faqs || []).flatMap(f => [f.q, f.a])].join("\n").toLowerCase();
  const found = (cfg && cfg.banned || []).filter(w => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(all));
  add("banned", "No banned words", found.length === 0, 6, `Remove: ${found.join(", ")}`);
  let priceHits = [];
  if (cfg && cfg.noPrices) {
    const brandRe = /(esowolf|\beso\b|woo chat|hunt engine|meesho profit|myntra profit|our (webinar|software|tool|plan|service|course|team)|\bwe\b|\bus\b)/i;
    const priceRe = /(₹|rs\.?|inr)\s?\d|\d[\d,]*\s?(rupees|\/-|\/month|per month)/i;
    priceHits = plainText([body, desc, p.summary, ...(p.faqs || []).map(f => f.a)].join(". ")).split(/(?<=[.!?])\s+/).filter(s => priceRe.test(s) && brandRe.test(s));
  }
  add("prices", "No prices for ESOWOLF products", priceHits.length === 0, 6, priceHits.length ? `Remove our price from: “${priceHits[0].slice(0, 90)}…” — link to the website or a meeting instead.` : "");
  add("summary", "Summary for the blog cards", String(p.summary || "").trim().length >= 40, 2, "Write a 1–2 sentence summary.");

  const score = Math.round(checks.reduce((a, c) => a + c.points, 0));
  return { score, checks, words: wc };
}

/* ---------- the ChatGPT prompt ---------- */
export function buildPrompt(cfg, t = {}, posts = []) {
  const groups = cfg.groups.map(g => `- ${g.name} (TOPIC GROUP value: ${g.id}) — main guide: ${abs(g.guide, cfg)}`).join("\n");
  const linksList = cfg.links.map(l => `- ${abs(l.url, cfg)} — ${l.label}`).join("\n");
  const postList = posts.length ? posts.map(p => `- ${p.title} — ${cfg.site}/blog/${p.slug}/`).join("\n") : "- (no posts yet)";
  const group = cfg.groups.find(g => g.id === t.topic);
  return `You are writing a blog post for ${cfg.brand} (${cfg.site}).

ABOUT THE BUSINESS
${cfg.business}

WHO READS THE BLOG
${cfg.audience}

TOPIC FOR THIS POST
- Topic / title idea: ${t.title || "[write the topic here]"}
- Main keyword: ${t.keyword || "[main keyword]"}
- Other keywords: ${(t.keywords || []).join("; ") || "[other keywords]"}
- Topic group: ${group ? `${group.name} (${group.id})` : "[choose one from the list below]"}
- Notes from our team: ${t.notes || "-"}

FACTS YOU MAY USE (use ONLY these facts about ${cfg.shortBrand})
${cfg.facts.map(f => "- " + f).join("\n")}

NEVER CLAIM
${cfg.neverClaim.map(f => "- " + f).join("\n")}
Do not invent statistics, studies, reviews, testimonials, awards, customer numbers or prices. If you are not sure a fact is true, leave it out. You may explain how Amazon, Meesho, Myntra, Shopify, GST or WhatsApp work in general, but do not quote exact fees or numbers you are not sure about — tell the reader to check the platform's latest seller help page.

WRITING RULES
- Plain, friendly English for Indian readers whose first language is not English. Short sentences, short paragraphs (2–3 sentences).
- Answer the main question directly in the first 2–3 sentences and use the main keyword there.
- Title: 30–65 characters, main keyword near the start.
- Meta description: 120–160 characters, includes the main keyword.
- Article: 1,000–1,500 words (1,600–2,200 only for a big guide).
- 4–8 sections with "##" headings (no "#" title line, use "###" only inside a section).
- Include exactly one simple Markdown table.
- Use Indian context where useful (₹ for platform fees, Indian festivals and seasons, GST, Indian marketplaces). Never mention ${cfg.shortBrand}'s own prices.
- Add 4–8 internal links in Markdown format [text](url), ONLY to URLs from the allowed list below, and always include the main guide of the topic group. Never write a bare URL like https://esowolf.in/… — every link must be [words](url).
- If the article has steps, put them under ONE "##" section and use "### Step 1: …", "### Step 2: …" for each step (do not give each step its own "##").
- Add a short, honest "How ${cfg.shortBrand} helps" section near the end, using only the facts above.
- End with one clear next step for the reader.
- 4–6 FAQs with short, direct answers.
- Never use these words: ${cfg.banned.join(", ")}.
- A YouTube link on its own line becomes a video. Do not add images.

TOPIC GROUPS AND THEIR MAIN GUIDES
${groups}

ALLOWED INTERNAL LINKS
${linksList}

EXISTING BLOG POSTS (you may link to these too)
${postList}

OUTPUT FORMAT
Reply with ONE code block only, exactly in this format (keep the labels in capitals):

\`\`\`
TITLE:
META DESCRIPTION:
SUMMARY:
TOPIC GROUP:
MAIN KEYWORD:
OTHER KEYWORDS: (separated by semicolons)
SHORT LINK CODE: (2–4 words, lowercase, joined with hyphens)
FAQ:
Q:
A:
Q:
A:
ARTICLE:
(Markdown, ## headings, no # title line)
END OF ARTICLE
\`\`\``;
}
function abs(u, cfg) { return u.startsWith("/") ? cfg.site + u : u; }

/* ---------- SEO auto-fix (runs after "Fill the form" and from the "Auto-fix" button) ----------
   Fixes the things ChatGPT most often gets wrong, without rewriting the article:
   1. plain esowolf.in URLs → proper [label](url) links
   2. links to pages that are not on the allowed list → plain text
   3. too many "##" headings → numbered/step headings become "###" sub-headings
   4. missing main-guide link / fewer than 4 internal links → a short "Helpful links" list at the end
   Returns { post, fixes } — fixes is a list of plain-English notes for the editor. */
export function autoFixSeo(p, cfg, existingSlugs = []) {
  const site = cfg && cfg.site || "";
  const fixes = [];
  let body = String(p.body || "").replace(/\r\n?/g, "\n");
  const linkCfg = (cfg && cfg.links || []).map(l => ({ ...l, n: normUrl(l.url, site) }));
  const allowed = new Set([...linkCfg.map(l => l.n), ...existingSlugs.map(s => `/blog/${s}/`)]);
  const isAllowed = u => { const n = normUrl(u, site); return allowed.has(n) || allowed.has(n.replace(/\/$/, "")) || allowed.has(n + "/"); };
  const labelFor = u => { const n = normUrl(u, site); const l = linkCfg.find(x => x.n === n || x.n === n.replace(/\/$/, "") || x.n + "/" === n); return l ? l.label : ""; };

  // 1. bare URLs (not already inside a markdown link or angle brackets) → links
  let bare = 0;
  body = body.split("\n").map(line => {
    if (/^\s*https?:\/\/\S+\s*$/.test(line) && youTubeId(line.trim())) return line;   // YouTube line = video
    return line.replace(/(^|[^(\[<"'\w/])((?:https?:\/\/)(?:[a-z0-9-]+\.)*esowolf\.in(?:\/[^\s)<>\]]*)?)/gi, (m, pre, url) => {
      let u = url.replace(/[.,;:!?]+$/, ""); const tail = url.slice(u.length);
      if (!isAllowed(u)) return m;
      bare++;
      const label = labelFor(u) || u.replace(/^https?:\/\//, "");
      return `${pre}[${label}](${isInternal(u, site) && /^https?:\/\/(www\.)?esowolf\.in/i.test(u) ? normUrl(u, site) : u})${tail}`;
    });
  }).join("\n");
  if (bare) fixes.push(`Turned ${bare} plain website address${bare > 1 ? "es" : ""} into proper links.`);

  // 2. internal links that are not allowed → keep the words, drop the link
  let dropped = 0;
  body = body.replace(/(^|[^!])\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m, pre, text, url) => {
    if (isInternal(url, site) && !isAllowed(url)) { dropped++; return pre + text; }
    return m;
  });
  if (dropped) fixes.push(`Removed ${dropped} link${dropped > 1 ? "s" : ""} to pages that are not on the allowed list (the words are kept).`);

  // 3. too many ## headings → "Step N" headings become ### sub-headings (only if that leaves 4–8 sections)
  if (headings(body).length > 8) {
    const isStep = l => /^##\s+(?:\d+[.)]\s*)?step\s*\d+\b/i.test(l);
    const L = body.split("\n"), steps = L.filter(isStep).length, after = headings(body).length - steps;
    if (steps && after >= 4) {
      body = L.map(l => isStep(l) ? l.replace(/^##\s+(?:\d+[.)]\s*)?/, "### ") : l).join("\n").replace(/^##\s+\d+[.)]\s+/gm, "## ");
      fixes.push(`Made ${steps} "Step" heading${steps > 1 ? "s" : ""} into sub-headings (###) so there are at most 8 main sections.`);
    }
  }

  // 4. make sure the main guide is linked and there are at least 4 internal links
  const group = (cfg && cfg.groups || []).find(g => g.id === p.topic);
  const guide = group ? normUrl(group.guide, site) : "";
  const current = () => links(body).filter(u => isInternal(u, site)).map(u => normUrl(u, site));
  const has = u => current().some(x => x === u || x.replace(/\/$/, "") === u.replace(/\/$/, ""));
  const want = [];
  if (guide && !has(guide)) want.push({ url: guide, label: group.guideLabel || group.name });
  const pool = ["https://webinar.esowolf.in/", "https://booking.closer.esowolf.in/book/amazon-increase-sales", "/blog/", "/#contact", "/policies.html#about"]
    .map(u => ({ url: u, label: labelFor(u) || u })).filter(x => isAllowed(x.url));
  for (const x of pool) { if (current().length + want.length >= 5) break; if (!has(normUrl(x.url, site)) && !want.some(w => w.url === x.url)) want.push(x); }
  if (current().length + want.length > 8) want.splice(Math.max(0, 8 - current().length));
  if (want.length) {
    const list = "\n\n**Helpful links:**\n\n" + want.map(w => `- [${w.label}](${w.url})`).join("\n") + "\n";
    // put it before a closing "Next step" line if there is one, otherwise at the very end
    const m = body.match(/\n\n(\*\*?(?:your )?next step[^\n]*\*?\*?[^\n]*(?:\n(?!\n)[^\n]*)*)\s*$/i);
    body = m ? body.slice(0, m.index) + list + "\n" + m[0].replace(/^\n+/, "\n") : body.replace(/\s*$/, "") + list;
    fixes.push(`Added ${want.length} helpful link${want.length > 1 ? "s" : ""}${guide && want.some(w => w.url === guide) ? " (including the main guide)" : ""} near the end.`);
  }

  // things only a person can fix — report them
  const s = seoScore({ ...p, body }, cfg, existingSlugs);
  const left = s.checks.filter(c => !c.ok && c.id !== "cover").map(c => c.label);
  return { post: { ...p, body }, fixes, left };
}
