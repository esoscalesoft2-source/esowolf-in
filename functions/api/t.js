/* Cookie-free visit & click counter (POST /api/t). Stores only daily totals per event name — no IPs, no cookies, no personal data.
   Read the numbers in Blog Admin → Stats. */
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|bingpreview|monitor/i;
const OK = /^(view|click|ref):[a-z0-9:\/._#@+-]{1,110}$/;

function istDay() { return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); }

async function count(db, day, names) {
  const st = db.prepare("INSERT INTO stats (day, name, n) VALUES (?,?,1) ON CONFLICT(day, name) DO UPDATE SET n = n + 1");
  await db.batch(names.map(n => st.bind(day, n)));
}

export async function onRequestPost({ request, env }) {
  const done = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  try {
    if (!env.DB || BOT.test(request.headers.get("user-agent") || "")) return done;
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host) return done;
    const raw = (await request.text()).slice(0, 600);
    let d; try { d = JSON.parse(raw); } catch { return done; }
    const names = (Array.isArray(d.e) ? d.e : [d.e]).map(x => String(x || "").toLowerCase()).filter(x => OK.test(x)).slice(0, 3);
    if (!names.length) return done;
    const day = istDay();
    try { await count(env.DB, day, names); }
    catch (e) {
      if (!/no such table/i.test(String(e && e.message))) return done;
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS stats (day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, name))").run();
      await count(env.DB, day, names);
    }
  } catch {}
  return done;
}
export const onRequest = () => new Response("Method not allowed", { status: 405 });
