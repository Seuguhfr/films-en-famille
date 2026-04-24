export async function onRequest(context) {
  const { request, env } = context;

  // 1. GET: Load all movies
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM movies ORDER BY id DESC"
    ).all();

    return new Response(JSON.stringify(results), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    });
  }

  // 2. POST: Add a movie (ENRICHED WITH TMDB DATA)
  if (request.method === "POST") {
    const { tmdb_id } = await request.json();
    
    // --- NOUVEAU : On va chercher les infos IMDb et le Titre ---
    let title = "Titre Inconnu";
    let imdb_id = "";
    
    try {
      const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${env.TMDB_KEY}&language=fr-FR`);
      if (tmdbRes.ok) {
        const tmdbData = await tmdbRes.json();
        title = tmdbData.title || tmdbData.original_title || title;
        imdb_id = tmdbData.imdb_id || "";
      }
    } catch (e) {
      console.error("TMDB Fetch Error during POST:", e);
    }
    // ------------------------------------------------------------

    // Insert en incluant le titre et l'imdb_id
    const result = await env.DB.prepare(
      "INSERT INTO movies (tmdb_id, watched, title, imdb_id) VALUES (?, ?, ?, ?)"
    ).bind(tmdb_id, false, title, imdb_id).run();

    const newId = result.meta.last_row_id;
    return Response.json([{ id: newId, tmdb_id, watched: false, title, imdb_id }]);
  }

  // 3. PATCH: Mark as watched/unwatched
  if (request.method === "PATCH") {
    const { id, watched } = await request.json();
    await env.DB.prepare(
      "UPDATE movies SET watched = ? WHERE id = ?"
    ).bind(watched, id).run();
    return Response.json({ success: true });
  }

  // 4. DELETE: Remove a movie
  if (request.method === "DELETE") {
    const { id } = await request.json();
    await env.DB.prepare(
      "DELETE FROM movies WHERE id = ?"
    ).bind(id).run();
    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
