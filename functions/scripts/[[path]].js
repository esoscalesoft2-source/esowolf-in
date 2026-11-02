// Source files in the repo are not part of the website.
export const onRequest = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "x-robots-tag": "noindex" } });
