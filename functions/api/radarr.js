export async function onRequest(context) {
  const { env } = context;

  try {
    const { results } = await env.DB.prepare(
      "SELECT tmdb_id FROM movies WHERE watched = 0"
    ).all();

    // The StevenLu Format
    const radarrFeed = results.map(row => ({
      title: "Cloudflare Sync", // Radarr requires a title string to safely parse the object
      tmdb_id: parseInt(row.tmdb_id, 10) // StevenLu specifically uses the underscore format
    }));

    return new Response(JSON.stringify(radarrFeed), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
