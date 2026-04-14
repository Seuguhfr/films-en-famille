export async function onRequest(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      "SELECT tmdb_id FROM movies"
    ).all();

    // Radarr's Custom List STRICTLY wants 'tmdbId' exactly like this:
    const radarrFeed = results.map(row => ({
      tmdbId: parseInt(row.tmdb_id, 10)
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
