# Blog admin — hand-over

**Admin:** https://esowolf.in/admin/  ·  **Blog:** https://esowolf.in/blog/

## How it works
1. Writers log in at /admin/, write with ChatGPT, paste the answer, add a cover, check the SEO score.
2. **Save draft** keeps the post private (Cloudflare D1 database — drafts are *not* in the public GitHub repo).
3. **Publish now / Schedule post** saves the post as `content/blog/<slug>.md` (+ cover in `assets/blog/`) in one GitHub commit — "(by <username> via team admin)".
4. The GitHub Action **Blog build** (`.github/workflows/blog.yml`) turns the posts into pages (`blog/…`, `sitemap.xml`, `blog/rss.xml`, `llms.txt`, `_redirects`), commits them, starts the Cloudflare deploy hook and pings IndexNow. Live in about 2 minutes.
5. The same Action runs **every hour**, so scheduled posts appear on time (within the hour).

## Settings that live outside the code
| Where | Name | What |
|---|---|---|
| Cloudflare → Workers & Pages → esowolf-in → Settings → Bindings | `DB` (D1 database `esowolf-blog`) | users, sessions, drafts |
| Cloudflare → … → Settings → Variables and Secrets (Production) | `GITHUB_TOKEN` (secret) | fine-grained token: only this repo, Contents read/write, 1 year |
| same | `SETUP_CODE` (secret) | one-time code for the first owner — **delete it after setup** |
| GitHub → repo → Settings → Secrets and variables → Actions | `CF_DEPLOY_HOOK` | the Cloudflare Pages deploy hook URL |

### Renewing the GitHub token (once a year)
GitHub → your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → the "esowolf blog admin" token → **Regenerate token** → copy → Cloudflare → esowolf-in → Settings → Variables and Secrets → `GITHUB_TOKEN` → Edit → paste → Save → Deployments → **Retry deployment** on the latest one. Until then publishing shows "GitHub 401".

## Team
Owner → **Team** tab → Add a member (username + password, role Editor or Owner). Share the password yourself. Reset password / Disable / Remove are on the same page.
Editors can publish only when the SEO score is ≥ 80%. Owners can publish anyway and delete posts.
Locked out? 6 wrong passwords lock a username for 15 minutes (20 per network). Wait, or have an owner reset the password.

## Roll back a bad change
- **Whole site:** Cloudflare → esowolf-in → Deployments → pick the last good one → ⋯ → **Rollback to this deployment**.
- **One post:** open it in /admin/, fix it and **Update live post** — or as owner **Delete** it.

## Change topics, links or facts
Edit `admin/blog-config.json` (business facts, allowed internal links, topic groups and their main guide, banned words, CTA) and `admin/calendar.json` (30-day content calendar). Committing these rebuilds the blog.

## Keep in mind
- GitHub pauses hourly Actions in public repos after 60 days with no commits — publishing a post resets that. If scheduled posts stop appearing, open GitHub → Actions → Blog build → **Enable workflow**.
- Cloudflare adds its own lines to robots.txt (Content Signals). If Cloudflare "Block AI bots" is ON, AI search tools cannot read the blog.
