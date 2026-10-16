# esowolf.in

Cinematic developer portfolio — a single static page (`index.html`) with a full-screen intro video hero.

## Structure
- `index.html` — the whole site (HTML, CSS and JS in one file)
- `assets/intro-720.mp4`, `intro-1080.mp4`, `intro-1440.mp4` — intro video; the page loads the smallest one that is still sharp for the visitor's screen
- `assets/poster.jpg` — first frame shown while the video loads
- `assets/about.jpg` — About section photo

## Edit content
Projects, experience, articles and the marquee words live in the `CONTENT` object near the top of the `<script>` in `index.html`. Name, email and social links are in the HTML.

## Run locally
Any static server works, e.g. `npx serve .` or `python3 -m http.server`.

## Deploy
No build step. On Vercel or Netlify import the repo with framework preset "Other" and output directory `.`; on GitHub Pages serve from the `main` branch root.
