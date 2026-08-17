export async function onRequest(context) {
  const { request, env } = context;

  // 1. Authenticate with Secret Token
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const secretHeader = request.headers.get("x-webhook-secret");
  const providedSecret = secretParam || secretHeader;

  if (env.WEBHOOK_SECRET && env.WEBHOOK_SECRET !== "" && providedSecret !== env.WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing secret token." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const result = await env.DB.prepare("UPDATE movies SET watched = 0").run();
    const changes = result?.meta?.changes || result?.changes || 0;

    return Response.json({
      success: true,
      message: `Reset complete. ${changes} movies set to unwatched (watched = 0).`
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
