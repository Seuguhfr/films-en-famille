export async function onRequest(context) {
  // 1. Extract parameters sent from your frontend
  const url = new URL(context.request.url);
  const endpoint = url.searchParams.get('endpoint'); // e.g., "movie/550"
  const params = url.searchParams.get('params') || ''; // e.g., "&append_to_response=..."
  const lang = url.searchParams.get('lang') || 'fr-FR';

  // 2. Get the Secret Key (securely stored in Cloudflare)
  const apiKey = context.env.TMDB_KEY;

  if (!endpoint) {
    return new Response(JSON.stringify({ error: "No endpoint provided" }), { status: 400 });
  }

  // 3. Construct the real URL to TMDB
  // We append the Secret Key here, on the server side
  const targetUrl = `https://api.themoviedb.org/3/${endpoint}?api_key=${apiKey}&language=${lang}${params}`;

  try {
    const response = await fetch(targetUrl, {
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();

    // 4. Return the data to your frontend
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch from TMDB" }), { status: 500 });
  }
}