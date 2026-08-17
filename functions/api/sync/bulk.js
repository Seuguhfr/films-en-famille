export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

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
    const body = await request.json();
    const rawMovies = Array.isArray(body) ? body : (body.movies || body.results || []);

    if (!rawMovies || rawMovies.length === 0) {
      return Response.json({ success: true, imported: 0, message: "No movies provided in payload." });
    }

    // 2. Fetch all existing TMDB IDs from D1
    const { results: existingRows } = await env.DB.prepare("SELECT tmdb_id FROM movies").all();
    const existingSet = new Set((existingRows || []).map(r => Number(r.tmdb_id)));

    // 3. Filter for items not yet in D1
    const toImport = [];
    for (const item of rawMovies) {
      const tmdbId = Number(typeof item === "number" ? item : (item.tmdb_id || item.tmdbId));
      if (tmdbId && !existingSet.has(tmdbId)) {
        toImport.push({
          tmdb_id: tmdbId,
          title: item.title || "Titre Inconnu",
          imdb_id: item.imdb_id || item.imdbId || "",
          watched: !!item.watched
        });
        existingSet.add(tmdbId); // Prevent duplicate within same payload
      }
    }

    let importedCount = 0;
    const errors = [];

    // 4. Process and enrich each missing movie
    for (const item of toImport) {
      let title = item.title;
      let original_title = "";
      let imdb_id = item.imdb_id;
      let poster_path = null;
      let backdrop_path = null;
      let release_date = null;
      let vote_average = 0;
      let runtime = 0;
      let director = "Inconnu";
      let genres = "[]";

      if (env.TMDB_KEY) {
        try {
          const tmdbUrl = `https://api.themoviedb.org/3/movie/${item.tmdb_id}?api_key=${env.TMDB_KEY}&language=fr-FR&append_to_response=credits,images&include_image_language=fr,en,null`;
          const res = await fetch(tmdbUrl, { headers: { "Accept": "application/json" } });

          if (res.ok) {
            const data = await res.json();
            title = data.title || data.original_title || title;
            original_title = data.original_title || "";
            imdb_id = data.imdb_id || imdb_id;
            poster_path = data.poster_path || (data.images?.posters?.length > 0 ? data.images.posters[0].file_path : null);
            backdrop_path = data.backdrop_path || null;
            release_date = data.release_date || null;
            vote_average = data.vote_average || 0;
            runtime = data.runtime || 0;

            const dirObj = data.credits?.crew?.find(p => p.job === "Director");
            if (dirObj) director = dirObj.name;

            genres = JSON.stringify(data.genres || []);
          }
        } catch (tmdbErr) {
          console.error(`TMDB fetch failed for ${item.tmdb_id}:`, tmdbErr);
        }
      }

      // Insert into D1
      try {
        await env.DB.prepare(
          `INSERT INTO movies (
            tmdb_id, watched, title, original_title, poster_path, backdrop_path,
            release_date, vote_average, runtime, director, genres, imdb_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.tmdb_id, item.watched ? 1 : 0, title, original_title, poster_path, backdrop_path,
          release_date, vote_average, runtime, director, genres, imdb_id
        ).run();

        importedCount++;
      } catch (insertErr) {
        // Fallback for minimal schema
        try {
          await env.DB.prepare(
            "INSERT INTO movies (tmdb_id, watched, title, imdb_id) VALUES (?, ?, ?, ?)"
          ).bind(item.tmdb_id, item.watched ? 1 : 0, title, imdb_id).run();
          importedCount++;
        } catch (err2) {
          errors.push(`Error inserting movie ${item.tmdb_id} (${title}): ${err2.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      totalReceived: rawMovies.length,
      alreadyInLibrary: rawMovies.length - toImport.length,
      imported: importedCount,
      errors
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
