// Repassa a requisição para a API na VPS (ORIGIN) mantendo método, corpo e cabeçalhos.
export async function proxy({ request, env }) {
  if (!env.ORIGIN) return new Response("ORIGIN não configurada", { status: 500 });
  const url = new URL(request.url);
  const target = env.ORIGIN.replace(/\/$/, "") + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  // IP real do visitante, para o limite de tentativas de login não contar o IP da Cloudflare.
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("X-Forwarded-For", ip);

  // Chave combinada com o nginx da VPS: sem ela a origem responde 403.
  if (env.ORIGIN_KEY) headers.set("X-Origin-Key", env.ORIGIN_KEY);

  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

  try {
    return await fetch(target, init);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Servidor indisponível" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
