export async function onRequest(context) {
  const { env } = context;

  try {
    // We query the D1 database for the TMDB IDs.
    // Pro-tip: We only pull movies where watched = false. 
    // This way, if you mark a movie as "Watched" in your app and delete it from Radarr later, 
    // Radarr won't automatically re-download it the next day!
    const { results } = await env.DB.prepare(
      "SELECT tmdb_id FROM movies WHERE watched = 0"
    ).all();

    // Radarr expects a very specific JSON format: an array of objects with the key "tmdbId"
    // The StevenLu / Radarr API format
    const radarrFeed = results.map(row => ({
      title: "Cloudflare Sync", // Radarr requires a title field, even a fake one
      tmdb_id: parseInt(row.tmdb_id, 10) // Note the underscore! tmdb_id instead of tmdbId
    }));

    // Return the formatted feed to Radarr
    return new Response(JSON.stringify(radarrFeed), {
      headers: {
        "Content-Type": "application/json",
        // Force Cloudflare not to cache this, so Radarr always sees the live database
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
