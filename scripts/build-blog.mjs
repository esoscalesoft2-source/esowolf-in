/* Builds the public blog from content/blog/*.md (run by the GitHub Action, or locally: node scripts/build-blog.mjs)
   Writes: blog/index.html, blog/<slug>/index.html, blog/rss.xml, sitemap.xml, llms.txt, _redirects (/go/ short links)
   Only posts whose date has passed are published. Prints the changed URLs for IndexNow. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { parsePost, preprocessMarkdown, escapeHtml as e, slugify, headings, formatIST } from "../admin/shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "admin/blog-config.json"), "utf8"));
const SITE = cfg.site.replace(/\/$/, "");
const NOW = new Date(process.env.BUILD_NOW || Date.now());
const STATE_FILE = path.join(ROOT, "scripts/.build-state.json");

/* ---------- read posts ---------- */
const dir = path.join(ROOT, cfg.postsDir);
const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".md")).map(f => {
  const p = parsePost(fs.readFileSync(path.join(dir, f), "utf8"));
  p.slug = f.slice(0, -3);
  return p;
}) : [];
const live = all.filter(p => p.title && p.date && !isNaN(new Date(p.date)) && new Date(p.date) <= NOW)
  .sort((a, b) => new Date(b.date) - new Date(a.date));
const groupOf = id => cfg.groups.find(g => g.id === id);
const abs = u => (u.startsWith("/") ? SITE + u : u);
const iso = d => new Date(d).toISOString();

/* ---------- Markdown ---------- */
let usedIds;
marked.use({
  gfm: true,
  renderer: {
    heading(text, level, raw) {
      if (level === 1) level = 2;
      let id = slugify(raw.replace(/<[^>]+>/g, "")) || "section";
      while (usedIds.has(id)) id += "-2";
      usedIds.add(id);
      return `<h${level} id="${id}">${text}</h${level}>\n`;
    },
    link(href, title, text) {
      const ext = /^https?:\/\//.test(href) && !/^https?:\/\/(www\.)?esowolf\.in(\/|$)/.test(href);
      return `<a href="${e(href)}"${title ? ` title="${e(title)}"` : ""}${ext ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
    },
    image(href, title, text) {
      return `<img src="${e(href)}" alt="${e(text)}" loading="lazy" decoding="async"${title ? ` title="${e(title)}"` : ""}>`;
    },
    table(header, body) { return `<div class="tbl"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`; }
  }
});
function renderBody(md) { usedIds = new Set(); return marked.parse(preprocessMarkdown(md)); }

/* ---------- shared page parts ---------- */
const CSS = `@font-face{font-family:"Big Shoulders Display";src:url(/assets/fonts/big-shoulders-display.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Manrope";src:url(/assets/fonts/manrope.woff2) format("woff2");font-weight:200 800;font-display:swap}
:root{--bg:#0e0e0e;--panel:#171717;--line:#2a2a2a;--text:#ececec;--muted:#a3a3a3;--ember:#f26a1b;--ember2:#ff8c1a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--text);font:400 17px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
a{color:var(--ember2)}img,video{max-width:100%;height:auto}
.wrap{width:min(100% - 32px,1120px);margin-inline:auto}.narrow{width:min(100% - 32px,760px);margin-inline:auto}
.top{position:sticky;top:0;z-index:5;background:rgba(14,14,14,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:18px;height:64px}.top .logo img{height:38px;width:auto;display:block}
.top nav{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:15px}.top nav .btn{min-height:40px;padding:0 18px;white-space:nowrap}.top nav a{color:var(--text);text-decoration:none}.top nav a:hover{color:var(--ember2)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:999px;background:var(--ember);color:#160b00!important;font-weight:700;text-decoration:none;border:0}
.btn:hover{background:var(--ember2)}.btn.ghost{background:transparent;border:1.5px solid var(--ember);color:var(--text)!important}
.crumbs{font-size:14px;color:var(--muted);margin:28px 0 14px}.crumbs a{color:var(--muted);text-decoration:none}.crumbs a:hover{color:var(--ember2)}.crumbs span{margin:0 6px}
h1,h2,h3,.card h3{font-family:Manrope,system-ui,sans-serif;font-weight:800}
h1{font-size:clamp(30px,5vw,46px);line-height:1.15;letter-spacing:-.02em;margin:0 0 14px}
h2{font-size:clamp(23px,3.2vw,30px);line-height:1.25;margin:44px 0 12px;letter-spacing:-.01em;scroll-margin-top:84px}h3{font-size:20px;margin:28px 0 8px;scroll-margin-top:84px}
.meta{color:var(--muted);font-size:15px;margin-bottom:24px}.tag{display:inline-block;padding:3px 12px;border-radius:999px;background:rgba(242,106,27,.14);color:var(--ember2);font-size:13px;font-weight:600;text-decoration:none}
.cover{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;background:#1b1b1b;margin:6px 0 28px}
.toc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 22px;margin:0 0 30px}.toc b{display:block;margin-bottom:6px}.toc ol{margin:0;padding-left:20px}.toc li{margin:4px 0}.toc a{color:var(--text);text-decoration:none}.toc a:hover{color:var(--ember2)}
article p,article li{color:#dcdcdc}article blockquote{margin:22px 0;padding:6px 20px;border-left:3px solid var(--ember);color:var(--muted)}
.tbl{overflow-x:auto;margin:24px 0;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:11px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#1b1b1b}tr:last-child td{border-bottom:0}
code{background:#1f1f1f;padding:2px 6px;border-radius:6px;font-size:.9em}pre{background:#1a1a1a;padding:16px;border-radius:12px;overflow-x:auto}pre code{background:none;padding:0}
.yt{position:relative;margin:26px 0;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000}.yt button{all:unset;cursor:pointer;display:block;width:100%;height:100%}.yt img{width:100%;height:100%;object-fit:cover;display:block}
.yt-play{position:absolute;left:50%;top:50%;width:72px;height:50px;margin:-25px 0 0 -36px;border-radius:14px;background:var(--ember)}.yt-play:after{content:"";position:absolute;left:29px;top:15px;border-style:solid;border-width:10px 0 10px 17px;border-color:transparent transparent transparent #fff}.yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.post-video{display:block;width:100%;height:auto;border-radius:14px;margin:24px auto;background:#000}.post-video.tall{width:auto;max-width:100%;max-height:80vh;aspect-ratio:9/16}
.box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin:36px 0}
.faq details{border-bottom:1px solid var(--line);padding:14px 0}.faq summary{cursor:pointer;font-weight:700;font-size:17px}.faq details p{margin:10px 0 0}
.guide{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}.guide p{margin:0}
.trust{display:inline-flex;align-items:center;gap:8px;margin:0 0 6px;padding:5px 12px 5px 9px;border-radius:999px;border:1px solid rgba(242,106,27,.45);font-size:14px;font-weight:600;color:var(--text)}.trust svg{width:16px;height:16px;color:var(--ember);flex:none}
.cta{background:linear-gradient(135deg,rgba(242,106,27,.22),rgba(242,106,27,.06));border-color:rgba(242,106,27,.4)}.cta h2{margin-top:0}.cta .row{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px;margin:22px 0 40px}
.card{position:relative;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;text-decoration:none;color:var(--text);transition:border-color .25s,transform .25s,box-shadow .25s}
.card:hover{border-color:rgba(242,106,27,.7);transform:translateY(-4px);box-shadow:0 18px 40px -18px rgba(242,106,27,.45)}
.card .ph{overflow:hidden;aspect-ratio:16/9;background:#1b1b1b}.card img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s}.card:hover img{transform:scale(1.04)}
.card .in{display:flex;flex-direction:column;flex:1;padding:18px 20px 20px}.card h3{margin:10px 0 8px;font-size:19px;line-height:1.3;letter-spacing:-.01em}
.card p{margin:0;color:var(--muted);font-size:15px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card .foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:16px;font-size:13.5px;color:var(--muted)}
.card .go{color:var(--ember2);font-weight:700;white-space:nowrap}.card:hover .go{text-decoration:underline}
.card .top-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.card.feat{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}.card.feat .ph{aspect-ratio:auto;min-height:100%}.card.feat .in{padding:30px 34px}
.card.feat h3{font-size:clamp(24px,2.6vw,32px);line-height:1.2;margin:14px 0 12px}.card.feat p{font-size:16.5px;-webkit-line-clamp:4}
.new{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--ember);color:#160b00;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.bhero{position:relative;margin:8px 0 34px;padding:44px 40px;border:1px solid var(--line);border-radius:24px;overflow:hidden;background:radial-gradient(120% 140% at 100% 0%,rgba(242,106,27,.28),rgba(242,106,27,0) 55%),linear-gradient(180deg,#151515,#111)}
.bhero:after{content:"";position:absolute;right:-60px;bottom:-80px;width:320px;height:320px;border-radius:50%;border:1px solid rgba(242,106,27,.25);box-shadow:0 0 0 40px rgba(242,106,27,.04),0 0 0 80px rgba(242,106,27,.03)}
.bhero .eb{font:700 12px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--ember2)}
.bhero h1{font-family:"Big Shoulders Display",Manrope,sans-serif;font-weight:900;font-size:clamp(42px,7vw,76px);line-height:.95;letter-spacing:0;text-transform:uppercase;margin:14px 0 14px;max-width:14ch}
.bhero h1 span{color:var(--ember)}.bhero p{max-width:58ch;color:#cfcfcf;margin:0;font-size:17px}
.bhero .chips{position:relative;z-index:1;margin-top:22px}.bhero .chips a{padding:7px 14px;font-size:14px;border:1px solid rgba(242,106,27,.35)}.bhero .chips a:hover{background:rgba(242,106,27,.25)}
.sec-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:40px 0 0}.sec-h h2{margin:0}.sec-h small{color:var(--muted);font-size:14px}
.band{margin:30px 0 10px;padding:30px 32px;border-radius:20px;border:1px solid rgba(242,106,27,.4);background:linear-gradient(135deg,rgba(242,106,27,.22),rgba(242,106,27,.05));display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.band h2{margin:0 0 6px;font-size:clamp(22px,2.6vw,28px)}.band p{margin:0;color:#d6d6d6}.band .row{display:flex;gap:12px;flex-wrap:wrap}
@media (max-width:820px){.card.feat{display:flex}.card.feat .ph{aspect-ratio:16/9;min-height:0}.card.feat .in{padding:20px}.bhero{padding:30px 22px;border-radius:20px}}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}
footer{border-top:1px solid var(--line);margin-top:56px;padding:28px 0 40px;color:var(--muted);font-size:14px}footer a{color:var(--muted)}footer .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between}
@media (max-width:420px){.top nav .hide-xs{display:none}}
@media (max-width:380px){.top .logo img{height:28px}.top nav .btn{padding:0 10px;font-size:13px}}
@media (max-width:640px){body{font-size:16px}.top nav{gap:10px;font-size:14px}.top nav .btn{min-height:36px;padding:0 12px;font-size:13.5px}.top nav .hide-s{display:none}.top .logo img{height:32px}.box{padding:18px}}`;

function head({ title, description, url, image, type = "website", extra = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${e(url)}">
<meta name="theme-color" content="#0e0e0e">
<meta name="generator" content="ESOWOLF blog">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${e(cfg.shortBrand)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="alternate" type="application/rss+xml" title="${e(cfg.shortBrand)} blog" href="${SITE}/blog/rss.xml">
${extra}<style>${CSS}</style>
</head>`;
}
const topBar = `<header class="top"><div class="wrap"><a class="logo" href="/" aria-label="${e(cfg.brand)} home"><img src="/assets/eso-logo-light-300.webp" alt="${e(cfg.brand)}" width="300" height="144"></a>
<nav aria-label="Main"><a class="hide-xs" href="/blog/">Blog</a><a class="hide-s" href="/#contact">Contact</a><a class="btn ghost" href="${e(cfg.cta.primary.url)}" target="_blank" rel="noopener">${e(cfg.cta.primary.label)}</a><a class="btn" href="${e(cfg.cta.secondary.url)}" target="_blank" rel="noopener">${e(cfg.cta.secondary.label)}</a></nav></div></header>`;
const footer = `<footer><div class="wrap"><span>© ${NOW.getFullYear()} ${e(cfg.shortBrand)} is a company of MV Inc. All rights reserved.</span>
<span><a href="/">Home</a> · <a href="/blog/">Blog</a> · <a href="/blog/rss.xml">RSS</a> · <a href="/policies.html#privacy">Privacy</a> · <a href="/#contact">Contact</a></span></div></footer>`;
const SHIELD = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ogFallback = `${SITE}/assets/og-image.jpg`;
const coverImg = (p, cls, sizes, eager) => p.cover
  ? `<img class="${cls}" src="${e(p.cover)}.webp" srcset="${e(p.cover)}-800.webp 800w, ${e(p.cover)}.webp 1600w" sizes="${sizes}" width="1600" height="900" alt="${e(p.coverAlt || p.title)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`
  : "";
const readMin = p => Math.max(1, Math.round(String(p.body || "").split(/\s+/).filter(Boolean).length / 200));
const shortDate = d => { try { return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }); } catch { return ""; } };
const card = (p, opts = {}) => { const g = groupOf(p.topic); const img = coverImg(p, "", opts.feat ? "(max-width:820px) 100vw, 620px" : "(max-width:640px) 100vw, 360px", !!opts.feat) || '<img src="/assets/og-image.jpg" alt="" loading="lazy" width="1200" height="630">';
  return `<a class="card${opts.feat ? " feat" : ""}" href="/blog/${p.slug}/"><div class="ph">${img}</div><div class="in"><div class="top-row">${opts.feat ? '<span class="new">Latest</span>' : ""}${g ? `<span class="tag">${e(g.name)}</span>` : ""}</div><h3>${e(p.title)}</h3><p>${e(p.summary || p.description || "")}</p><div class="foot"><span>${e(shortDate(p.date))} · ${readMin(p)} min read</span><span class="go">Read guide →</span></div></div></a>`; };
const ld = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>\n`;
const ytScript = `<script>document.addEventListener("click",function(e){var b=e.target.closest(".yt button");if(!b)return;var d=b.parentNode,f=document.createElement("iframe");f.src="https://www.youtube-nocookie.com/embed/"+d.dataset.id+"?autoplay=1&rel=0";f.allow="autoplay; encrypted-media; picture-in-picture";f.allowFullscreen=true;f.title="YouTube video";d.innerHTML="";d.appendChild(f)})</script>`;

/* ---------- post page ---------- */
function postPage(p) {
  const url = `${SITE}/blog/${p.slug}/`;
  const g = groupOf(p.topic);
  const html = renderBody(p.body);
  const hs = headings(p.body);
  const ids = [...usedIds];
  const toc = hs.length >= 4 ? `<nav class="toc" aria-label="In this article"><b>In this article</b><ol>${[...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(m => `<li><a href="#${m[1]}">${m[2].replace(/<[^>]+>/g, "")}</a></li>`).join("")}</ol></nav>` : "";
  const faqs = (p.faqs || []).filter(f => f.q && f.a);
  const related = live.filter(x => x.slug !== p.slug && x.topic === p.topic).concat(live.filter(x => x.slug !== p.slug && x.topic !== p.topic)).slice(0, 3);
  const img = p.cover ? `${SITE}${p.cover}-og.jpg` : ogFallback;
  const published = iso(p.date), modified = iso(p.updated || p.date);
  const schema = [
    { "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, description: p.description, image: [img, ...(p.cover ? [`${SITE}${p.cover}.webp`] : [])], datePublished: published, dateModified: modified, mainEntityOfPage: url, url, inLanguage: "en-IN", keywords: [p.keyword, ...(p.keywords || [])].filter(Boolean).join(", "), articleSection: g ? g.name : undefined, author: { "@type": "Organization", name: cfg.shortBrand, url: SITE + "/" }, publisher: { "@type": "Organization", name: cfg.brand, url: SITE + "/", logo: { "@type": "ImageObject", url: `${SITE}/assets/eso-icon.png` } } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" }, { "@type": "ListItem", position: 2, name: "Blog", item: SITE + "/blog/" }, { "@type": "ListItem", position: 3, name: p.title, item: url }] }
  ];
  // uploaded videos → VideoObject (helps them show in Google video results)
  for (const m of String(p.body || "").matchAll(/^\s*!\[([^\]]*)\]\((\/(?:media|assets\/blog\/video)\/[^)\s]+\.(?:mp4|webm))(?:\s+"([^"]*)")?\)\s*$/gim)) {
    const poster = (String(m[3] || "").match(/(\S+\.(?:jpe?g|webp|png))/i) || [])[1];
    schema.push({ "@context": "https://schema.org", "@type": "VideoObject", name: m[1] || p.title, description: p.description, uploadDate: published, contentUrl: SITE + m[2], thumbnailUrl: poster ? (poster.startsWith("/") ? SITE + poster : poster) : img, embedUrl: url });
  }
  if (faqs.length) schema.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const extra = `<meta property="article:published_time" content="${published}">\n<meta property="article:modified_time" content="${modified}">\n${p.cover ? `<link rel="preload" as="image" href="${e(p.cover)}-800.webp" imagesrcset="${e(p.cover)}-800.webp 800w, ${e(p.cover)}.webp 1600w" imagesizes="(max-width:820px) 100vw, 760px">\n` : ""}${schema.map(ld).join("")}`;
  return `${head({ title: `${p.title} | ${cfg.shortBrand}`, description: p.description || p.summary || "", url, image: img, type: "article", extra })}
<body>
${topBar}
<main class="narrow">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>›</span><a href="/blog/">Blog</a><span>›</span>${g ? `<a href="${e(g.guide)}">${e(g.name)}</a><span>›</span>` : ""}<span aria-current="page" style="margin:0">${e(p.title)}</span></nav>
<article>
<h1>${e(p.title)}</h1>
<p class="meta">${g ? `<a class="tag" href="${e(g.guide)}">${e(g.name)}</a> · ` : ""}<time datetime="${published}">${e(formatIST(p.date).replace(/,? \d{1,2}:\d{2}.*$/, ""))}</time>${p.updated ? ` · Updated <time datetime="${modified}">${e(formatIST(p.updated).replace(/,? \d{1,2}:\d{2}.*$/, ""))}</time>` : ""}</p>
${coverImg(p, "cover", "(max-width:820px) 100vw, 760px", true)}
${toc}
${html}
${faqs.length ? `<section class="faq box" aria-labelledby="faq"><h2 id="faq" style="margin-top:0">Frequently asked questions</h2>${faqs.map(f => `<details><summary>${e(f.q)}</summary><p>${e(f.a)}</p></details>`).join("")}</section>` : ""}
</article>
${g ? `<aside class="box guide"><p><b>Main guide:</b> ${e(g.guideLabel || g.name)}</p><a class="btn ghost" href="${e(g.guide)}">Read the guide →</a></aside>` : ""}
<aside class="box cta"><h2>${e(cfg.cta.title)}</h2>${cfg.trustLine && (cfg.trustLine.groups || []).includes(p.topic) ? `<p class="trust">${SHIELD}${e(cfg.trustLine.text)}</p>` : ""}<p>${e(cfg.cta.text)}</p><div class="row"><a class="btn" href="${e(cfg.cta.primary.url)}" target="_blank" rel="noopener">${e(cfg.cta.primary.label)} →</a><a class="btn ghost" href="${e(cfg.cta.secondary.url)}" target="_blank" rel="noopener">${e(cfg.cta.secondary.label)}</a></div></aside>
${related.length ? `<section aria-labelledby="rel"><h2 id="rel">Related guides</h2><div class="cards">${related.map(p => card(p)).join("")}</div></section>` : ""}
</main>
${footer}
${html.includes('class="yt"') ? ytScript : ""}
<script src="/assets/t.js" defer></script>
</body>
</html>
`;
}

/* ---------- blog index ---------- */
function indexPage() {
  const url = `${SITE}/blog/`;
  const title = `${cfg.shortBrand} Blog — Amazon, Meesho & Myntra selling guides`;
  const description = "Simple, practical guides for Indian online sellers: selling on Amazon, Meesho and Myntra profit, WhatsApp automation and e-commerce basics.";
  const used = cfg.groups.filter(g => live.some(p => p.topic === g.id));
  const schema = { "@context": "https://schema.org", "@type": "Blog", name: title, url, description, publisher: { "@type": "Organization", name: cfg.brand, url: SITE + "/" }, blogPost: live.slice(0, 20).map(p => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE}/blog/${p.slug}/`, datePublished: iso(p.date) })) };
  return `${head({ title, description, url, image: ogFallback, extra: ld(schema) })}
<body>
${topBar}
<main class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>›</span><span aria-current="page" style="margin:0">Blog</span></nav>
<section class="bhero" aria-labelledby="bh"><span class="eb">${e(cfg.shortBrand)} Blog · ${live.length} guide${live.length === 1 ? "" : "s"}</span>
<h1 id="bh">Fix your <span>Amazon</span> sales problems</h1>
<p>${e(description)}</p>
${used.length > 1 ? `<div class="chips">${used.map(g => `<a class="tag" href="#${g.id}">${e(g.name)}</a>`).join("")}</div>` : ""}</section>
${live.length ? `<div class="cards">${card(live[0], { feat: true })}</div>` + (used.length > 1
    ? used.map(g => { const list = live.slice(1).filter(p => p.topic === g.id); return list.length ? `<section aria-labelledby="${g.id}"><div class="sec-h"><h2 id="${g.id}">${e(g.name)}</h2><small>${list.length} guide${list.length === 1 ? "" : "s"}</small></div><div class="cards">${list.map(p => card(p)).join("")}</div></section>` : `<span id="${g.id}"></span>`; }).join("") + (live.slice(1).some(p => !groupOf(p.topic)) ? `<section><div class="sec-h"><h2>More guides</h2></div><div class="cards">${live.slice(1).filter(p => !groupOf(p.topic)).map(p => card(p)).join("")}</div></section>` : "")
    : (live.length > 1 ? `<section aria-labelledby="more"><div class="sec-h"><h2 id="more">More guides</h2><small>${live.length - 1} guide${live.length === 2 ? "" : "s"}</small></div><div class="cards">${live.slice(1).map(p => card(p)).join("")}</div></section>` : ""))
    : `<div class="box"><p>Our first guides are on the way. Meanwhile, join our live webinar.</p></div>`}
<aside class="band"><div><h2>${e(cfg.cta.title)}</h2>${cfg.trustLine ? `<p class="trust" style="margin:6px 0 8px">${SHIELD}${e(cfg.trustLine.text)}</p>` : ""}<p>${e(cfg.cta.text)}</p></div><div class="row"><a class="btn" href="${e(cfg.cta.primary.url)}" target="_blank" rel="noopener">${e(cfg.cta.primary.label)} →</a><a class="btn ghost" href="${e(cfg.cta.secondary.url)}" target="_blank" rel="noopener">${e(cfg.cta.secondary.label)}</a></div></aside>
</main>
${footer}
<script src="/assets/t.js" defer></script>
</body>
</html>
`;
}

/* ---------- feeds and helper files ---------- */
const x = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
function rss() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${x(cfg.shortBrand)} Blog</title>
<link>${SITE}/blog/</link>
<atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml"/>
<description>Guides for Indian online sellers from ${x(cfg.brand)}</description>
<language>en-in</language>
${live.length ? `<lastBuildDate>${new Date(live[0].updated || live[0].date).toUTCString()}</lastBuildDate>\n` : ""}${live.slice(0, 50).map(p => `<item><title>${x(p.title)}</title><link>${SITE}/blog/${p.slug}/</link><guid isPermaLink="true">${SITE}/blog/${p.slug}/</guid><pubDate>${new Date(p.date).toUTCString()}</pubDate><description>${x(p.description || p.summary)}</description></item>`).join("\n")}
</channel>
</rss>
`;
}
function sitemap() {
  const today = NOW.toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, pr: "1.0" },
    { loc: `${SITE}/policies.html`, pr: "0.5" },
    { loc: `${SITE}/blog/`, pr: "0.8", lm: live[0] ? iso(live[0].updated || live[0].date).slice(0, 10) : today },
    ...live.map(p => ({ loc: `${SITE}/blog/${p.slug}/`, pr: "0.7", lm: iso(p.updated || p.date).slice(0, 10) }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${x(u.loc)}</loc><lastmod>${u.lm || today}</lastmod><priority>${u.pr}</priority></url>`).join("\n")}
</urlset>
`;
}
function llms() {
  return `# ${cfg.brand}

> ${cfg.business}

Website: ${SITE}/
Blog: ${SITE}/blog/
Contact: support@esowolf.in · +91 97515 51117 (phone/WhatsApp) · Mon–Sat 9am–6pm IST

## What we offer
${cfg.facts.map(f => "- " + f).join("\n")}

## Main pages
${cfg.links.map(l => `- [${l.label}](${abs(l.url)})`).join("\n")}

## Blog posts
${live.length ? live.map(p => `- [${p.title}](${SITE}/blog/${p.slug}/): ${p.summary || p.description || ""}`).join("\n") : "- (no posts yet)"}
`;
}
function redirects() {
  const lines = ["# Generated by scripts/build-blog.mjs — short links for Instagram (/go/<code>). Edit posts in /admin/, not this file."];
  for (const p of live) if (p.short) lines.push(`/go/${p.short} /blog/${p.slug}/?utm_source=instagram&utm_medium=social&utm_campaign=${encodeURIComponent(p.short)} 302`);
  return lines.join("\n") + "\n";
}

/* ---------- write everything, report changed URLs ---------- */
const out = new Map();
out.set("blog/index.html", { html: indexPage(), url: `${SITE}/blog/` });
for (const p of live) out.set(`blog/${p.slug}/index.html`, { html: postPage(p), url: `${SITE}/blog/${p.slug}/` });
out.set("blog/rss.xml", { html: rss() });
out.set("sitemap.xml", { html: sitemap() });
out.set("llms.txt", { html: llms() });
out.set("_redirects", { html: redirects() });

const prev = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { pages: {} };
const next = { pages: {} };
const changed = [];
for (const [file, { html, url }] of out) {
  const full = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const old = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  if (old !== html) fs.writeFileSync(full, html);
  if (url) {
    const h = crypto.createHash("sha256").update(html.replace(/© \d{4}/, "")).digest("hex").slice(0, 16);
    next.pages[url] = h;
    if (prev.pages[url] !== h) changed.push(url);
  }
}
// remove pages of posts that are no longer live (deleted, unpublished or renamed)
const blogDir = path.join(ROOT, "blog");
for (const d of fs.readdirSync(blogDir, { withFileTypes: true })) {
  if (d.isDirectory() && !live.some(p => p.slug === d.name)) {
    fs.rmSync(path.join(blogDir, d.name), { recursive: true, force: true });
    changed.push(`${SITE}/blog/${d.name}/`);
  }
}
fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
const scheduled = all.filter(p => p.date && new Date(p.date) > NOW).map(p => `${p.slug} @ ${p.date}`);
console.log(`Built ${live.length} live post(s). Scheduled: ${scheduled.length ? scheduled.join(", ") : "none"}.`);
console.log(`Changed URLs: ${changed.length ? changed.join(" ") : "none"}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.join(" ")}\n`);
