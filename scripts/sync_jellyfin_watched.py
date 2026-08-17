#!/usr/bin/env python3
"""
Films en Famille - Jellyfin Watched Status Sync Script
======================================================
This script connects to your Jellyfin instance, finds all movies actually
watched by the user 'famille', and updates their status to 'watched' in Films en Famille.

Usage:
  python3 scripts/sync_jellyfin_watched.py

Optional Arguments / Environment Variables:
  --jellyfin-url    Jellyfin base URL (default: http://192.168.1.50:8096 or $JELLYFIN_URL)
  --jellyfin-key    Jellyfin API Key (created in Dashboard > Advanced > API Keys)
  --user            Target username (default: famille)
  --webapp-url      Films en Famille base URL (default: https://v2.filmsfamiliaux.pages.dev)
  --secret          Webhook Secret token
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
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
        description="Sync watched movies from Jellyfin for user 'famille'."
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
        help="Jellyfin username to sync watched status from (default: famille)",
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
    return parser.parse_args()


def fetch_jellyfin_users(jellyfin_url, jellyfin_key):
    url = f"{jellyfin_url.rstrip('/')}/Users"
    req = urllib.request.Request(
        url,
        headers={
            "X-Emby-Token": jellyfin_key,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status == 200:
                return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        log(f"Error connecting to Jellyfin: {e}", color="red")
        return None


def fetch_watched_movies(jellyfin_url, jellyfin_key, user_id):
    url = f"{jellyfin_url.rstrip('/')}/Users/{user_id}/Items?includeItemTypes=Movie&isPlayed=true&recursive=true&fields=ProviderIds"
    req = urllib.request.Request(
        url,
        headers={
            "X-Emby-Token": jellyfin_key,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status == 200:
                data = json.loads(res.read().decode("utf-8"))
                return data.get("Items", [])
    except Exception as e:
        log(f"Error fetching watched movies from Jellyfin: {e}", color="red")
        return []


def mark_movie_watched_in_webapp(webapp_url, secret, user, tmdb_id, imdb_id, title):
    url = f"{webapp_url.rstrip('/')}/api/webhooks/jellyfin?secret={urllib.parse.quote(secret)}&user={urllib.parse.quote(user)}"
    payload = {
        "NotificationType": "ItemMarkedAsPlayed",
        "NotificationUsername": user,
        "Name": title,
        "Provider_tmdb": str(tmdb_id) if tmdb_id else None,
        "Provider_imdb": imdb_id or None,
    }

    payload_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload_bytes,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Secret": secret,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status == 200
    except Exception:
        return False


def main():
    log("\n=======================================================", color="cyan")
    log("  📺 Films en Famille - Jellyfin Watched Status Sync", color="bold")
    log("=======================================================\n", color="cyan")

    args = parse_arguments()

    jellyfin_url = args.jellyfin_url.strip()
    jellyfin_key = args.jellyfin_key.strip()
    target_user = args.user.strip()
    webapp_url = args.webapp_url.strip()
    secret = args.secret.strip()

    if not jellyfin_key:
        try:
            jellyfin_key = input("Enter your Jellyfin API Key: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(1)

    if not jellyfin_key:
        log("Error: Jellyfin API Key is required.", color="red")
        sys.exit(1)

    if not secret:
        try:
            secret = input("Enter your Webhook Secret (or press Enter if none): ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(1)

    log(f"Connecting to Jellyfin at: {jellyfin_url}...", color="yellow")
    users = fetch_jellyfin_users(jellyfin_url, jellyfin_key)

    if not users:
        log("Could not find any users on Jellyfin. Please verify your URL and API Key.", color="red")
        sys.exit(1)

    user_obj = next((u for u in users if u.get("Name", "").lower() == target_user.lower()), None)

    if not user_obj:
        available = [u.get("Name") for u in users]
        log(f"User '{target_user}' not found. Available users: {', '.join(available)}", color="red")
        sys.exit(1)

    user_id = user_obj.get("Id")
    log(f"Found user '{user_obj.get('Name')}' (ID: {user_id})", color="green")

    log("Fetching watched movies...", color="yellow")
    watched_items = fetch_watched_movies(jellyfin_url, jellyfin_key, user_id)
    log(f"Found {len(watched_items)} watched movies for user '{target_user}' in Jellyfin.", color="green")

    if not watched_items:
        log("No watched movies found in Jellyfin.", color="yellow")
        sys.exit(0)

    marked_count = 0
    for idx, item in enumerate(watched_items, 1):
        title = item.get("Name", "Inconnu")
        pids = item.get("ProviderIds", {})
        tmdb_id = pids.get("Tmdb") or pids.get("tmdb")
        imdb_id = pids.get("Imdb") or pids.get("imdb")

        if tmdb_id or imdb_id:
            ok = mark_movie_watched_in_webapp(webapp_url, secret, target_user, tmdb_id, imdb_id, title)
            if ok:
                marked_count += 1
                log(f" [{idx}/{len(watched_items)}] Marked watched: {title}", color="green")
            else:
                log(f" [{idx}/{len(watched_items)}] Skipped (not in webapp list): {title}", color="yellow")

    print()
    log("=======================================================", color="cyan")
    log("🎉 Jellyfin Watched Sync Complete!", color="bold")
    log(f"   Total Jellyfin Watched:   {len(watched_items)}")
    log(f"   Synced to Films en Famille: {marked_count}", color="green")
    log("=======================================================\n", color="cyan")


if __name__ == "__main__":
    main()
