#!/usr/bin/env python3
"""
Films en Famille - Radarr Library Bulk Sync Script
==================================================
This script connects to your local Radarr instance, extracts your movie library,
and syncs any missing movies to your Films en Famille Cloudflare Pages webapp.

Usage:
  python3 scripts/sync_radarr.py

Optional Arguments / Environment Variables:
  --radarr-url    Radarr base URL (default: http://localhost:7878 or $RADARR_URL)
  --radarr-key    Radarr API Key (or $RADARR_API_KEY)
  --webapp-url    Films en Famille base URL (e.g. https://v2.filmsfamiliaux.pages.dev or $WEBAPP_URL)
  --secret        Webhook Secret token (or $WEBHOOK_SECRET)
  --batch-size    Batch size per sync request (default: 30)

Zero external dependencies required (uses standard Python library).
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def log(msg, color=""):
    colors = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "red": "\033[91m",
        "cyan": "\033[96m",
        "bold": "\033[1m",
        "reset": "\033[0m",
    }
    prefix = colors.get(color, "")
    suffix = colors["reset"] if color else ""
    print(f"{prefix}{msg}{suffix}")


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Sync existing Radarr library to Films en Famille."
    )
    parser.add_argument(
        "--radarr-url",
        default=os.getenv("RADARR_URL", "http://192.168.1.50:7878"),
        help="Radarr server URL (default: http://192.168.1.50:7878)",
    )
    parser.add_argument(
        "--radarr-key",
        default=os.getenv("RADARR_API_KEY", ""),
        help="Radarr API key (found in Radarr Settings > General > Security)",
    )
    parser.add_argument(
        "--webapp-url",
        default=os.getenv(
            "WEBAPP_URL", "https://v2.filmsfamiliaux.pages.dev"
        ),
        help="Films en Famille base URL (e.g. https://v2.filmsfamiliaux.pages.dev)",
    )
    parser.add_argument(
        "--secret",
        default=os.getenv("WEBHOOK_SECRET", ""),
        help="Shared Webhook Secret configured in Cloudflare Pages",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=30,
        help="Number of movies per sync batch (default: 30)",
    )
    return parser.parse_args()


def fetch_radarr_movies(radarr_url, radarr_key):
    radarr_url = radarr_url.rstrip("/")
    api_endpoint = f"{radarr_url}/api/v3/movie"

    req = urllib.request.Request(
        api_endpoint,
        headers={
            "X-Api-Key": radarr_key,
            "Accept": "application/json",
            "User-Agent": "FilmsEnFamille-Sync/2.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                return data
            else:
                log(
                    f"Radarr returned HTTP status {response.status}",
                    color="red",
                )
                return None
    except urllib.error.HTTPError as e:
        log(f"HTTP Error connecting to Radarr: {e.code} {e.reason}", color="red")
        return None
    except urllib.error.URLError as e:
        log(f"Connection Error: Unable to reach Radarr at {radarr_url} ({e.reason})", color="red")
        return None


def send_batch_to_webapp(webapp_url, secret, batch):
    webapp_url = webapp_url.rstrip("/")
    endpoint = f"{webapp_url}/api/sync/bulk"
    if secret:
        endpoint += f"?secret={urllib.parse.quote(secret)}"

    payload_bytes = json.dumps({"movies": batch}).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=payload_bytes,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Secret": secret,
            "User-Agent": "FilmsEnFamille-Sync/2.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        log(
            f"HTTP Error {e.code} from Webapp: {body or e.reason}", color="red"
        )
        return None
    except Exception as e:
        log(f"Error communicating with webapp: {e}", color="red")
        return None


def main():
    log("\n=======================================================", color="cyan")
    log("  🍿 Films en Famille - Radarr Library Sync", color="bold")
    log("=======================================================\n", color="cyan")

    args = parse_arguments()

    # Prompt for missing required values
    radarr_url = args.radarr_url.strip()
    radarr_key = args.radarr_key.strip()
    webapp_url = args.webapp_url.strip()
    secret = args.secret.strip()

    if not radarr_key:
        try:
            radarr_key = input("Enter your Radarr API Key: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(1)

    if not radarr_key:
        log("Error: Radarr API Key is required.", color="red")
        sys.exit(1)

    if not webapp_url:
        try:
            webapp_url = input(
                "Enter your Webapp URL (default: https://v2.filmsfamiliaux.pages.dev): "
            ).strip() or "https://v2.filmsfamiliaux.pages.dev"
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(1)

    if not secret:
        try:
            secret = input("Enter your Webhook Secret (or press Enter if none): ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(1)

    log(f"Connecting to Radarr at: {radarr_url}...", color="yellow")
    radarr_movies = fetch_radarr_movies(radarr_url, radarr_key)

    if radarr_movies is None:
        log("Failed to fetch movies from Radarr. Please check your URL and API Key.", color="red")
        sys.exit(1)

    total_radarr = len(radarr_movies)
    log(f"Successfully retrieved {total_radarr} movies from Radarr!", color="green")

    # Map Radarr objects to simple sync format (watched defaults to False)
    formatted = []
    for m in radarr_movies:
        tmdb_id = m.get("tmdbId")
        if tmdb_id:
            formatted.append({
                "tmdb_id": tmdb_id,
                "title": m.get("title", "Titre Inconnu"),
                "imdb_id": m.get("imdbId", ""),
                "watched": False,
            })

    log(f"Valid movies with TMDB IDs: {len(formatted)}", color="cyan")
    log(f"Target Webapp: {webapp_url}", color="cyan")
    print()

    # Process in batches
    batch_size = args.batch_size
    total_imported = 0
    total_existing = 0

    for i in range(0, len(formatted), batch_size):
        batch = formatted[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(formatted) + batch_size - 1) // batch_size

        log(
            f"Syncing batch {batch_num}/{total_batches} ({len(batch)} movies)...",
            color="yellow",
        )
        res = send_batch_to_webapp(webapp_url, secret, batch)

        if res and res.get("success"):
            imported = res.get("imported", 0)
            existing = res.get("alreadyInLibrary", 0)
            total_imported += imported
            total_existing += existing
            log(f"  -> Batch {batch_num}: +{imported} imported, {existing} already present.", color="green")
        else:
            log(f"  -> Batch {batch_num} failed or returned error.", color="red")

    print()
    log("=======================================================", color="cyan")
    log("🎉 Library Sync Finished!", color="bold")
    log(f"   Total Radarr Movies:      {len(formatted)}")
    log(f"   Newly Imported to D1:     {total_imported}", color="green")
    log(f"   Already in Library:       {total_existing}", color="yellow")
    log("=======================================================\n", color="cyan")


if __name__ == "__main__":
    main()
