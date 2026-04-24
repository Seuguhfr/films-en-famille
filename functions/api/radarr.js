export async function onRequest(context) {
  const { env } = context;
  try {
    // On ne sélectionne que les films qui ont bien un ID IMDb valide
    const { results } = await env.DB.prepare(
      "SELECT title, imdb_id FROM movies WHERE imdb_id IS NOT NULL AND imdb_id != ''"
    ).all();

    // Le format StevenLu exige EXACTEMENT ces deux clés, rien de plus.
    const radarrFeed = results.map(row => ({
      title: row.title,
      imdb_id: row.imdb_id
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
