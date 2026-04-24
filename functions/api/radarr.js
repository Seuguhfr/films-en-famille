export async function onRequest(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      "SELECT tmdb_id FROM movies"
    ).all();

    const radarrFeed = results.map(row => ({
      tmdb_id: parseInt(row.tmdb_id, 10),
      title: "Watchlist ID " + row.tmdb_id 
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
