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

    // 2. Filter by User: Only for the 'famille' user
    const targetUser = (url.searchParams.get("user") || "famille").toLowerCase();
    const payloadUser = (
      body.NotificationUsername ||
      body.NotificationUser ||
      body.UserName ||
      body.user ||
      body.User?.Name ||
      body.Item?.User?.Name ||
      ""
    ).toLowerCase();

    // If a user is identified in the webhook, verify it matches 'famille'
    if (payloadUser && payloadUser !== targetUser) {
      return Response.json({
        success: true,
        action: "ignored_user",
        user: payloadUser,
        message: `Event from user '${payloadUser}' ignored (only watching for user '${targetUser}').`
      });
    }

    // 3. Determine Event Type & Completion
    const notificationType = (
      body.NotificationType ||
      body.Event ||
      body.event ||
      body.ItemType ||
      ""
    );

    // Test check
    if (notificationType === "Test" || body.test) {
      return Response.json({ success: true, message: "Jellyfin webhook test connection successful!" });
    }

    // Check if played to completion or marked as played
    let isCompleted = false;

    if (
      notificationType === "ItemMarkedAsPlayed" ||
      notificationType === "item.rate" ||
      notificationType === "scrobble" ||
      body.PlayedToCompletion === true ||
      body.PlayedToCompletion === "true" ||
      body.PlayedToCompletion === 1
    ) {
      isCompleted = true;
    } else if (notificationType === "PlaybackStop" || notificationType === "playback.stop") {
      // Check playback percentage >= 90%
      if (body.PlaybackPositionTicks && body.RunTimeTicks && body.RunTimeTicks > 0) {
        const ratio = body.PlaybackPositionTicks / body.RunTimeTicks;
        if (ratio >= 0.9) isCompleted = true;
      }
    }

    if (!isCompleted) {
      return Response.json({
        success: true,
        action: "ignored_incomplete",
        message: "Playback stopped before 90% completion."
      });
    }

    // 4. Extract TMDB / IMDb Identifiers
    const tmdbId = (
      body.Provider_tmdb ||
      body.ProviderIds?.Tmdb ||
      body.ProviderIds?.tmdb ||
      body.Item?.ProviderIds?.Tmdb ||
      body.Item?.ProviderIds?.tmdb ||
      body.Item?.Provider_tmdb ||
      null
    );

    const imdbId = (
      body.Provider_imdb ||
      body.ProviderIds?.Imdb ||
      body.ProviderIds?.imdb ||
      body.Item?.ProviderIds?.Imdb ||
      body.Item?.ProviderIds?.imdb ||
      ""
    );

    const title = body.Name || body.Item?.Name || body.ItemName || "Film Inconnu";

    if (!tmdbId && !imdbId) {
      return Response.json({
        success: false,
        message: "No TMDB or IMDb ID found in Jellyfin webhook payload."
      }, { status: 400 });
    }

    // 5. Update Database: Mark movie as Watched (watched = 1)
    let updateResult;
    if (tmdbId) {
      updateResult = await env.DB.prepare(
        "UPDATE movies SET watched = 1 WHERE tmdb_id = ?"
      ).bind(Number(tmdbId)).run();
    }

    if ((!updateResult || updateResult.meta?.changes === 0) && imdbId) {
      updateResult = await env.DB.prepare(
        "UPDATE movies SET watched = 1 WHERE imdb_id IS NOT NULL AND imdb_id != '' AND imdb_id = ?"
      ).bind(imdbId).run();
    }

    const changes = updateResult?.meta?.changes || updateResult?.changes || 0;

    return Response.json({
      success: true,
      action: "marked_watched",
      matchedInDb: changes > 0,
      title,
      tmdbId,
      imdbId,
      user: payloadUser || targetUser,
      message: changes > 0
        ? `Movie '${title}' marked as watched for user '${targetUser}'.`
        : `Movie '${title}' was watched, but not currently in the Films en Famille list.`
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
