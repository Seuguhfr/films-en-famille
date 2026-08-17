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

    // 2. Determine Event Type (Radarr or Overseerr/Jellyseerr)
    const eventType = body.eventType || body.event || "Unknown";

    // Test webhook check
    if (eventType === "Test" || eventType === "TEST_NOTIFICATION") {
      return Response.json({ success: true, message: "Radarr webhook test connection successful!" });
    }

    // 3. Extract Movie Identifiers
    const movieObj = body.movie || body.remoteMovie || body.media || body;
    const tmdbId = movieObj.tmdbId || movieObj.tmdb_id || body.tmdbId || body.tmdb_id;
    const imdbId = movieObj.imdbId || movieObj.imdb_id || body.imdbId || body.imdb_id || "";
    const rawTitle = movieObj.title || body.title || "Titre Inconnu";

    if (!tmdbId && !imdbId) {
      return Response.json({
        success: false,
        message: "No valid TMDB or IMDb ID found in webhook payload."
      }, { status: 400 });
    }

    // 4. Handle Deletion Events (Movie deleted in Radarr)
    if (
      eventType === "MovieDelete" ||
      eventType === "MovieFileDelete" ||
      eventType === "MEDIA_DELETED"
    ) {
      let deleteQuery = "DELETE FROM movies WHERE tmdb_id = ?";
      let bindVal = tmdbId;

      if (!tmdbId && imdbId) {
        deleteQuery = "DELETE FROM movies WHERE imdb_id = ?";
        bindVal = imdbId;
      }

      await env.DB.prepare(deleteQuery).bind(bindVal).run();
      return Response.json({
        success: true,
        action: "deleted",
        tmdbId,
        message: `Movie ${rawTitle} removed from library.`
      });
    }

    // 5. Handle Addition Events (Movie added / imported / requested)
    // Check if already in D1 database
    let existing;
    if (tmdbId) {
      existing = await env.DB.prepare("SELECT id FROM movies WHERE tmdb_id = ?").bind(tmdbId).first();
    } else if (imdbId) {
      existing = await env.DB.prepare("SELECT id FROM movies WHERE imdb_id = ?").bind(imdbId).first();
    }

    if (existing) {
      return Response.json({
        success: true,
        action: "already_exists",
        id: existing.id,
        tmdbId,
        message: `Movie ${rawTitle} already exists in library.`
      });
    }

    // 6. Fetch Full Rich Metadata from TMDB
    let title = rawTitle;
    let original_title = "";
    let finalImdbId = imdbId;
    let poster_path = null;
    let backdrop_path = null;
    let release_date = null;
    let vote_average = 0;
    let runtime = 0;
    let director = "Inconnu";
    let genres = "[]";

    if (tmdbId && env.TMDB_KEY) {
      try {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${env.TMDB_KEY}&language=fr-FR&append_to_response=credits,images&include_image_language=fr,en,null`;
        const tmdbRes = await fetch(tmdbUrl, { headers: { "Accept": "application/json" } });

        if (tmdbRes.ok) {
          const data = await tmdbRes.json();
          title = data.title || data.original_title || title;
          original_title = data.original_title || "";
          finalImdbId = data.imdb_id || finalImdbId;
          poster_path = data.poster_path || (data.images?.posters?.length > 0 ? data.images.posters[0].file_path : null);
          backdrop_path = data.backdrop_path || null;
          release_date = data.release_date || null;
          vote_average = data.vote_average || 0;
          runtime = data.runtime || 0;

          const dirObj = data.credits?.crew?.find(p => p.job === "Director");
          if (dirObj) director = dirObj.name;

          genres = JSON.stringify(data.genres || []);
        }
      } catch (e) {
        console.error("TMDB Fetch Error during Radarr Webhook:", e);
      }
    }

    // 7. Insert into D1 Database (with fallback for schema variations)
    let newId;
    try {
      const result = await env.DB.prepare(
        `INSERT INTO movies (
          tmdb_id, watched, title, original_title, poster_path, backdrop_path,
          release_date, vote_average, runtime, director, genres, imdb_id
        ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        tmdbId, title, original_title, poster_path, backdrop_path,
        release_date, vote_average, runtime, director, genres, finalImdbId
      ).run();

      newId = result.meta?.last_row_id || result.lastRowId || result.id || Date.now();
    } catch (insertErr) {
      console.warn("Full insert fallback in webhook:", insertErr.message);
      try {
        const result = await env.DB.prepare(
          "INSERT INTO movies (tmdb_id, watched, title, imdb_id) VALUES (?, 0, ?, ?)"
        ).bind(tmdbId, title, finalImdbId).run();
        newId = result.meta?.last_row_id || result.lastRowId || result.id || Date.now();
      } catch (fallbackErr) {
        const result = await env.DB.prepare(
          "INSERT INTO movies (tmdb_id, watched) VALUES (?, 0)"
        ).bind(tmdbId).run();
        newId = result.meta?.last_row_id || result.lastRowId || result.id || Date.now();
      }
    }

    return Response.json({
      success: true,
      action: "added",
      id: newId,
      tmdb_id: tmdbId,
      title,
      director,
      message: `Movie ${title} added to library via Radarr webhook.`
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
