// Cloudflare Pages "advanced mode" worker for NixTime.
// Proxies the Wayback Machine CDX API on the same origin (/api/cdx) so the browser's CORS rules don't block it.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/cdx") return env.ASSETS.fetch(request);

    const target = url.searchParams.get("url");
    if (!target || target.length > 300) return new Response("Bad request", { status: 400 });

    const q = new URLSearchParams({ output: "json", fl: "timestamp,original", filter: "statuscode:200", url: target });
    for (const k of ["collapse", "from", "to"]) {
      const v = url.searchParams.get(k);
      if (v && /^[\w:]{1,20}$/.test(v)) q.set(k, v);
    }

    try {
      const r = await fetch("https://web.archive.org/cdx/search/cdx?" + q, {
        headers: { "User-Agent": "NixTime by Codenix (history previews)" },
        cf: { cacheEverything: true, cacheTtl: 3600 },
      });
      return new Response(r.body, {
        status: r.status,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    } catch (e) {
      return new Response("Archive unavailable", { status: 502 });
    }
  },
};
