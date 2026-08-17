#!/usr/bin/env python3
"""
Films en Famille <-> Jellyfin Two-Way Watched Status Sync
=========================================================
This script runs locally on your home server (via cron or manually) to keep
the watched status synchronized between your Films en Famille webapp and Jellyfin:

1. Webapp -> Jellyfin: If a movie was marked "Vu" on the website, mark it played in Jellyfin for user 'famille'.
2. Jellyfin -> Webapp: If a movie was watched in Jellyfin for user 'famille', mark it "Vu" on the website.

Usage:
  python3 scripts/cron_sync_watched.py

Cron example (run every 15 minutes):
  */15 * * * * /usr/bin/python3 /path/to/films-en-famille/scripts/cron_sync_watched.py --jellyfin-key "YOUR_KEY" --secret "YOUR_SECRET" >> /tmp/films_sync.log 2>&1
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


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
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {prefix}{msg}{suffix}")


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Two-way sync of watched status between Films en Famille and Jellyfin."
    )
    parser.add_argument(
        "--jellyfin-url",
        default=os.getenv("JELLYFIN_URL", "http://192.168.1.50:8096"),
        help="Jellyfin server URL (default: http://192.168.1.50:8096)",
    )
    parser.add_argument(
        "--jellyfin-key",
        default=os.getenv("JELLYFIN_API_KEY", ""),
        help="Jellyfin API key (created in Dashboard > Advanced > API Keys)",
    )
    parser.add_argument(
        "--user",
        default="famille",
        help="Target Jellyfin username (default: famille)",
    )
    parser.add_argument(
        "--webapp-url",
        default=os.getenv(
            "WEBAPP_URL", "https://v2.filmsfamiliaux.pages.dev"
        ),
        help="Films en Famille base URL",
    )
    parser.add_argument(
        "--secret",
        default=os.getenv("WEBHOOK_SECRET", ""),
        help="Shared Webhook Secret configured in Cloudflare Pages",
    )
    return parser.parse_args()


# ─── API Helpers ─────────────────────────────────────────────────────────────

def fetch_webapp_movies(webapp_url):
    url = f"{webapp_url.rstrip('/')}/api/movies?t={int(datetime.now().timestamp())}"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "FilmsEnFamille-Cron/2.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return data if isinstance(data, list) else data.get("media", data.get("results", []))
    except Exception as e:
        log(f"Error fetching movies from webapp ({url}): {e}", color="red")
        return []


def mark_webapp_movie_watched(webapp_url, secret, user, tmdb_id, imdb_id, title):
    url = f"{webapp_url.rstrip('/')}/api/webhooks/jellyfin?secret={urllib.parse.quote(secret)}&user={urllib.parse.quote(user)}"
    payload = {
        "NotificationType": "ItemMarkedAsPlayed",
        "NotificationUsername": user,
        "Name": title,
        "Provider_tmdb": str(tmdb_id) if tmdb_id else None,
        "Provider_imdb": imdb_id or None,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Webhook-Secret": secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status == 200
    except Exception:
        return False


def fetch_jellyfin_user_id(jellyfin_url, jellyfin_key, username):
    url = f"{jellyfin_url.rstrip('/')}/Users"
    req = urllib.request.Request(
        url,
        headers={"X-Emby-Token": jellyfin_key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status == 200:
                users = json.loads(res.read().decode("utf-8"))
                for u in users:
                    if u.get("Name", "").lower() == username.lower():
                        return u.get("Id")
    except Exception as e:
        log(f"Error connecting to Jellyfin Users API: {e}", color="red")
    return None


def fetch_jellyfin_movies(jellyfin_url, jellyfin_key, user_id):
    url = f"{jellyfin_url.rstrip('/')}/Users/{user_id}/Items?includeItemTypes=Movie&recursive=true&fields=ProviderIds,UserData"
    req = urllib.request.Request(
        url,
        headers={"X-Emby-Token": jellyfin_key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return data.get("Items", [])
    except Exception as e:
        log(f"Error fetching Jellyfin items: {e}", color="red")
        return []


def mark_jellyfin_played(jellyfin_url, jellyfin_key, user_id, item_id):
    now_iso = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    url = f"{jellyfin_url.rstrip('/')}/Users/{user_id}/PlayedItems/{item_id}?DatePlayed={now_iso}"
    req = urllib.request.Request(
        url,
        headers={"X-Emby-Token": jellyfin_key, "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status in (200, 204)
    except Exception as e:
        log(f"Error marking item {item_id} played in Jellyfin: {e}", color="red")
        return False


# ─── Main Execution ──────────────────────────────────────────────────────────

def main():
    args = parse_arguments()

    jellyfin_url = args.jellyfin_url.strip()
    jellyfin_key = args.jellyfin_key.strip()
    target_user = args.user.strip()
    webapp_url = args.webapp_url.strip()
    secret = args.secret.strip()

    if not jellyfin_key:
        log("Missing --jellyfin-key. Aborting.", color="red")
        sys.exit(1)

    # 1. Fetch User ID
    user_id = fetch_jellyfin_user_id(jellyfin_url, jellyfin_key, target_user)
    if not user_id:
        log(f"User '{target_user}' not found on Jellyfin server.", color="red")
        sys.exit(1)

    # 2. Fetch movies from both sources
    webapp_movies = fetch_webapp_movies(webapp_url)
    jellyfin_movies = fetch_jellyfin_movies(jellyfin_url, jellyfin_key, user_id)

    if not webapp_movies and not jellyfin_movies:
        log("Could not load movies from either source. Exiting.", color="yellow")
        sys.exit(1)

    # Build lookup maps by TMDB ID and IMDb ID
    # Webapp movies lookup:
    webapp_by_tmdb = {}
    webapp_by_imdb = {}
    for m in webapp_movies:
        t_id = m.get("tmdb_id")
        i_id = m.get("imdb_id")
        if t_id:
            webapp_by_tmdb[str(t_id)] = m
        if i_id:
            webapp_by_imdb[str(i_id)] = m

    synced_to_jellyfin = 0
    synced_to_webapp = 0

    # 3. Compare Jellyfin items with Webapp
    for j_item in jellyfin_movies:
        j_id = j_item.get("Id")
        title = j_item.get("Name", "Inconnu")
        pids = j_item.get("ProviderIds", {})
        tmdb_id = str(pids.get("Tmdb") or pids.get("tmdb") or "")
        imdb_id = str(pids.get("Imdb") or pids.get("imdb") or "")
        is_played_in_jellyfin = j_item.get("UserData", {}).get("Played", False)

        # Find corresponding webapp movie
        w_movie = webapp_by_tmdb.get(tmdb_id) or (webapp_by_imdb.get(imdb_id) if imdb_id else None)

        if not w_movie:
            continue

        is_watched_in_webapp = bool(w_movie.get("watched"))

        # Case A: Marked watched on website, but unplayed in Jellyfin -> Mark played in Jellyfin
        if is_watched_in_webapp and not is_played_in_jellyfin:
            ok = mark_jellyfin_played(jellyfin_url, jellyfin_key, user_id, j_id)
            if ok:
                synced_to_jellyfin += 1
                log(f"-> Synced to Jellyfin (marked played): {title}", color="green")

        # Case B: Marked played in Jellyfin, but unwatched on website -> Mark watched in Webapp
        elif is_played_in_jellyfin and not is_watched_in_webapp:
            ok = mark_webapp_movie_watched(webapp_url, secret, target_user, tmdb_id, imdb_id, title)
            if ok:
                synced_to_webapp += 1
                log(f"<- Synced to Webapp (marked watched): {title}", color="green")

    if synced_to_jellyfin > 0 or synced_to_webapp > 0:
        log(f"Two-Way Sync Summary: {synced_to_jellyfin} -> Jellyfin, {synced_to_webapp} -> Webapp", color="bold")
    else:
        log("Two-Way Sync: Everything is already in sync.", color="cyan")


if __name__ == "__main__":
    main()
