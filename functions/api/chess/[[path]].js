// Proxies the few chess.com Published-Data API endpoints the app needs.
// Adds the descriptive User-Agent chess.com asks for, and caches briefly.
const ALLOWED = /^player\/[a-z0-9_-]{2,40}\/games\/(archives|\d{4}\/\d{2}(\/pgn)?)$/i;

export async function onRequestGet({ params, env }) {
  const path = [].concat(params.path || []).join("/");
  if (!ALLOWED.test(path)) return new Response("Not allowed", { status: 400 });

  const contact = env.CONTACT_EMAIL ? ` (${env.CONTACT_EMAIL})` : "";
  const upstream = await fetch(`https://api.chess.com/pub/${path}`, {
    headers: { "User-Agent": `chess-coach-personal/1.0${contact}`, Accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
