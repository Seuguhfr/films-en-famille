export async function onRequest(context) {
  const { env } = context;

  // 1. On cherche tous les films qui n'ont pas encore d'ID IMDb
  const { results } = await env.DB.prepare(
    "SELECT id, tmdb_id FROM movies WHERE imdb_id IS NULL OR imdb_id = ''"
  ).all();

  if (!results || results.length === 0) {
    return new Response("Tous les films sont déjà à jour ! Vous pouvez supprimer ce script.");
  }

  let updatedCount = 0;
  let errors = [];

  // 2. On boucle sur chaque film pour aller chercher ses infos
  for (const movie of results) {
    try {
      // On interroge l'API TMDB avec ta clé
      const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.tmdb_id}?api_key=${env.TMDB_KEY}&language=fr-FR`);
      
      if (tmdbRes.ok) {
        const tmdbData = await tmdbRes.json();
        const title = tmdbData.title || tmdbData.original_title || "Titre Inconnu";
        const imdb_id = tmdbData.imdb_id || "";

        // 3. On met à jour la ligne précise dans ta base D1
        await env.DB.prepare(
          "UPDATE movies SET title = ?, imdb_id = ? WHERE id = ?"
        ).bind(title, imdb_id, movie.id).run();

        updatedCount++;
      } else {
        errors.push(`TMDB n'a pas répondu pour le film ID: ${movie.tmdb_id}`);
      }
    } catch (err) {
      errors.push(`Erreur logicielle pour le film ID ${movie.tmdb_id}: ${err.message}`);
    }
  }

  // 4. On renvoie un rapport complet
  return new Response(JSON.stringify({
    message: `Migration réussie ! ${updatedCount} films ont été mis à jour dans la base de données.`,
    erreurs: errors
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
