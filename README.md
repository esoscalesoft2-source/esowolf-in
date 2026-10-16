# esowolf.in

Website for **ESOWOLF (Ezy Sell Online)**, a company of MV Inc, Thiruvarur, Tamil Nadu.
Static site — no build step. Hosted on Cloudflare Pages (project `esowolf-in`).

## Files
| File | What it is |
|---|---|
| `index.html` | Main site: 6 vertical slides — intro video, Amazon (Wolf hunt method), Meesho Profit, Myntra Profit, WOO Chat (WhatsApp Business API), Contact |
| `policies.html` | About us, Privacy, Terms, Refund and Return policies (`#about`, `#privacy`, `#terms`, `#refund`, `#return`) |
| `404.html` | Not-found page |
| `robots.txt`, `sitemap.xml` | Search engine files |
| `assets/` | Logos, favicon, intro videos (720p/1080p/1440p), poster, social share image (`og-image.jpg`) |

## Common edits
- **Amazon "Sign Up" link** — `SIGNUP_URL` in the script of `index.html`.
- **Book Demo (top menu)** — `https://booking.closer.esowolf.in/book`.
- **Meesho / Myntra demo** — `https://bookdemo.esowolf.in/?platform=Meesho#book` / `?platform=Myntra#book`.
- **WOO Chat** — Sign Up / Sign In go to `https://woochatofficial.esowolf.in/login`.

## Run locally
```
python3 -m http.server 3010
```
then open http://localhost:3010

## Deploy
Push to `main`, then trigger the Cloudflare Pages deploy hook (Git connection is currently disconnected in Cloudflare).
