export async function onRequest(context) {
  const { env } = context;

  // 1. Safe Schema Migration: Ensure all columns exist in D1
  const columnsToAdd = [
    "ALTER TABLE movies ADD COLUMN original_title TEXT",
    "ALTER TABLE movies ADD COLUMN poster_path TEXT",
    "ALTER TABLE movies ADD COLUMN backdrop_path TEXT",
    "ALTER TABLE movies ADD COLUMN release_date TEXT",
    "ALTER TABLE movies ADD COLUMN vote_average REAL DEFAULT 0",
    "ALTER TABLE movies ADD COLUMN runtime INTEGER DEFAULT 0",
    "ALTER TABLE movies ADD COLUMN director TEXT",
    "ALTER TABLE movies ADD COLUMN genres TEXT",
    "ALTER TABLE movies ADD COLUMN imdb_id TEXT",
    "ALTER TABLE movies ADD COLUMN title TEXT"
  ];

  const schemaLogs = [];
  for (const sql of columnsToAdd) {
    try {
      await env.DB.prepare(sql).run();
      schemaLogs.push(`Success: ${sql}`);
    } catch (e) {
      // Column likely already exists, which is normal and expected
      schemaLogs.push(`Skipped (already exists or error): ${e.message}`);
    }
  }

  // 2. Data Migration: Enrich movies that lack poster_path or director
  let dataLogs = [];
  let updatedCount = 0;

  try {
    const { results } = await env.DB.prepare(
      "SELECT id, tmdb_id, title FROM movies WHERE poster_path IS NULL OR director IS NULL OR genres IS NULL"
    ).all();

    if (results && results.length > 0) {
      for (const movie of results) {
        try {
          const tmdbUrl = `https://api.themoviedb.org/3/movie/${movie.tmdb_id}?api_key=${env.TMDB_KEY}&language=fr-FR&append_to_response=credits,images&include_image_language=fr,en,null`;
          const res = await fetch(tmdbUrl, { headers: { "Accept": "application/json" } });

          if (res.ok) {
            const data = await res.json();
            const title = data.title || data.original_title || movie.title || "Titre inconnu";
            const original_title = data.original_title || "";
            const imdb_id = data.imdb_id || "";
            let poster_path = data.poster_path || (data.images?.posters?.length > 0 ? data.images.posters[0].file_path : null);
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
            ).bind(
              title, original_title, poster_path, backdrop_path,
              release_date, vote_average, runtime, director, genres, imdb_id, movie.id
            ).run();

            updatedCount++;
          } else {
            dataLogs.push(`TMDB fetch failed for movie ID ${movie.tmdb_id}`);
          }
        } catch (mErr) {
          dataLogs.push(`Error on movie ID ${movie.tmdb_id}: ${mErr.message}`);
        }
      }
    }
  } catch (err) {
    dataLogs.push(`Data migration query error: ${err.message}`);
  }

  return new Response(JSON.stringify({
    success: true,
    message: `Migration completed. Schema updated and ${updatedCount} movies enriched.`,
    schemaLogs,
    updatedCount,
    dataLogs
  }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, max-age=0"
    }
  });
}
