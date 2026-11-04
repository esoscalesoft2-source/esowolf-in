/* Serves uploaded blog videos and their poster images from the R2 bucket (binding MEDIA) at /media/*.
   Supports HTTP Range requests so videos can start playing and seek without downloading the whole file. */
export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const key = (params.path || []).map(decodeURIComponent).join("/");
  if (!env.MEDIA || !/^videos\/[0-9-]+-[a-f0-9]{8}\.(mp4|webm|jpg)$/.test(key)) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  let r2range;
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) r2range = m[1] ? { offset: +m[1], ...(m[2] ? { length: +m[2] - +m[1] + 1 } : {}) } : { suffix: +m[2] };
  }
  const obj = request.method === "HEAD" ? await env.MEDIA.head(key) : await env.MEDIA.get(key, r2range ? { range: r2range } : {});
  if (!obj) return new Response("Not found", { status: 404 });

  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=31536000, immutable");
  h.set("x-content-type-options", "nosniff");
  if (request.method === "HEAD") { h.set("content-length", obj.size); return new Response(null, { headers: h }); }
  if (r2range && obj.range) {
    const start = obj.range.offset ?? (obj.size - obj.range.suffix), len = obj.range.length ?? (obj.size - start);
    h.set("content-range", `bytes ${start}-${start + len - 1}/${obj.size}`);
    h.set("content-length", len);
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", obj.size);
  return new Response(obj.body, { headers: h });
}
