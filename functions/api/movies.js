export async function onRequest(context) {
  const { request, env } = context;

  // 1. GET: Load all movies
  if (request.method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM movies ORDER BY id DESC"
      ).all();

      return new Response(JSON.stringify(results || []), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // 2. POST: Add a movie (ENRICHED WITH TMDB DATA)
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const tmdb_id = body.tmdb_id;

      if (!tmdb_id) {
        return new Response(JSON.stringify({ error: "Missing tmdb_id" }), { status: 400 });
      }

      // Fetch rich TMDB data
      let title = "Titre Inconnu";
      let original_title = "";
      let imdb_id = "";
      let poster_path = null;
      let backdrop_path = null;
      let release_date = null;
      let vote_average = 0;
      let runtime = 0;
      let director = "Inconnu";
      let genres = "[]";

      try {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${env.TMDB_KEY}&language=fr-FR&append_to_response=credits,images&include_image_language=fr,en,null`;
        const tmdbRes = await fetch(tmdbUrl, { headers: { "Accept": "application/json" } });
        if (tmdbRes.ok) {
          const data = await tmdbRes.json();
          title = data.title || data.original_title || title;
          original_title = data.original_title || "";
          imdb_id = data.imdb_id || "";
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
        console.error("TMDB Fetch Error during POST:", e);
      }

      let newId;
      try {
        // Attempt full insert with all rich columns
        const result = await env.DB.prepare(
          `INSERT INTO movies (
            tmdb_id, watched, title, original_title, poster_path, backdrop_path, 
            release_date, vote_average, runtime, director, genres, imdb_id
          ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          tmdb_id, title, original_title, poster_path, backdrop_path,
          release_date, vote_average, runtime, director, genres, imdb_id
        ).run();

        newId = result.meta?.last_row_id || result.lastRowId || result.id || Date.now();
      } catch (insertErr) {
        // Fallback for tables that haven't added the new columns yet
        console.warn("Full insert failed, trying minimal columns:", insertErr.message);
        try {
          const result = await env.DB.prepare(
            "INSERT INTO movies (tmdb_id, watched, title, imdb_id) VALUES (?, 0, ?, ?)"
          ).bind(tmdb_id, title, imdb_id).run();
          newId = result.meta?.last_row_id || result.lastRowId || result.id || Date.now();
        } catch (minimalErr) {
          const result = await env.DB.prepare(
            "INSERT INTO movies (tmdb_id, watched) VALUES (?, 0)"
          ).bind(tmdb_id).run();
          newId = result.meta?.last_row_id || result.lastRowId || result.id || Date.now();
        }
      }

      return Response.json([{
        id: newId,
        tmdb_id,
        watched: 0,
        title,
        original_title,
        poster_path,
        backdrop_path,
        release_date,
        vote_average,
        runtime,
        director,
        genres,
        imdb_id
      }]);
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // 3. PATCH: Mark watched or migrate old data
  if (request.method === "PATCH") {
    try {
      const body = await request.json();

      if (body.action === "migrate_old_data") {
        const oldMovies = await env.DB.prepare("SELECT id, tmdb_id FROM movies WHERE poster_path IS NULL OR director IS NULL").all();
        if (!oldMovies.results || oldMovies.results.length === 0) {
          return Response.json({ success: true, migrated: 0 });
        }

        let migrated = 0;
        for (const m of oldMovies.results) {
          try {
            const url = `https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=${env.TMDB_KEY}&language=fr-FR&append_to_response=credits,images&include_image_language=fr,en,null`;
            const res = await fetch(url, { headers: { "Accept": "application/json" } });
            if (!res.ok) continue;

            const data = await res.json();
            const title = data.title || data.original_title || "Titre inconnu";
            const original_title = data.original_title || "";
            const imdb_id = data.imdb_id || "";
            let poster_path = data.poster_path || null;
            if (!poster_path && data.images?.posters?.length > 0) poster_path = data.images.posters[0].file_path;
            const backdrop_path = data.backdrop_path || null;
            const release_date = data.release_date || null;
            const vote_average = data.vote_average || 0;
            const runtime = data.runtime || 0;
            let director = "Inconnu";
            const dirObj = data.credits?.crew?.find(p => p.job === "Director");
            if (dirObj) director = dirObj.name;
            const genres = JSON.stringify(data.genres || []);

            await env.DB.prepare(
              `UPDATE movies SET title = ?, original_title = ?, poster_path = ?, backdrop_path = ?, release_date = ?, vote_average = ?, runtime = ?, director = ?, genres = ?, imdb_id = ? WHERE id = ?`
            ).bind(title, original_title, poster_path, backdrop_path, release_date, vote_average, runtime, director, genres, imdb_id, m.id).run();

            migrated++;
          } catch (e) {
            console.error("Migration error on movie id " + m.id, e);
          }
        }
        return Response.json({ success: true, migrated });
      }

      const { id, watched } = body;
      await env.DB.prepare(
        "UPDATE movies SET watched = ? WHERE id = ?"
      ).bind(watched ? 1 : 0, id).run();

      return Response.json({ success: true });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // 4. DELETE: Remove a movie
  if (request.method === "DELETE") {
    try {
      const { id } = await request.json();
      await env.DB.prepare(
        "DELETE FROM movies WHERE id = ?"
      ).bind(id).run();
      return Response.json({ success: true });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
