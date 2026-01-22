export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. GET: Load all movies
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM movies ORDER BY id DESC"
    ).all();

    // We return a new Response with explicit headers
    return new Response(JSON.stringify(results), {
      headers: {
        "Content-Type": "application/json",
        // This line is crucial:
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    });
  }

  // 2. POST: Add a movie
  if (request.method === "POST") {
    const { tmdb_id } = await request.json();
    
    // Insert and return the new row (to get the ID)
    const result = await env.DB.prepare(
      "INSERT INTO movies (tmdb_id, watched) VALUES (?, ?)"
    ).bind(tmdb_id, false).run();

    // In SQLite/D1, we have to fetch the last inserted ID manually if we want it back immediately
    // or just return success. Here we construct the object to send back.
    // result.meta.last_row_id contains the new ID.
    const newId = result.meta.last_row_id;
    
    return Response.json([{ id: newId, tmdb_id, watched: false }]);
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