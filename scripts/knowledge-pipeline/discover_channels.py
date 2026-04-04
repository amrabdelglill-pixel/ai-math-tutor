#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 1: Discover Channels
=====================================================
Uses yt-dlp (NO API key needed) to validate seed channels
and discover new channels via YouTube search.

No YouTube Data API key required — fully free and unlimited.

Output: channels.json — list of channels with metadata.
"""

import os
import json
import sys
import subprocess
import time
from config import (
    COUNTRIES, SUBJECTS, GRADES, SEED_CHANNELS,
    MAX_CHANNELS_PER_QUERY,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def get_channel_info(channel_id):
    """Get channel metadata using yt-dlp."""
    url = f"https://www.youtube.com/channel/{channel_id}/videos"
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--dump-single-json",
                "--playlist-items", "1",
                "--flat-playlist",
                "--no-download",
                url,
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            return {
                "channel_id": channel_id,
                "title": data.get("channel", data.get("uploader", "Unknown")),
                "description": data.get("description", ""),
                "subscribers": data.get("channel_follower_count", 0) or 0,
                "video_count": data.get("playlist_count", 0) or 0,
            }
        return None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
        print(f"  WARNING: Failed to get info for channel {channel_id}: {e}")
        return None


def search_channels_ytdlp(query, max_results=3):
    """Search YouTube for channels matching a query using yt-dlp."""
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                f"ytsearch{max_results}:{query}",
                "--dump-json",
                "--flat-playlist",
                "--no-download",
            ],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return []

        channels = {}
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                ch_id = data.get("channel_id")
                if ch_id and ch_id not in channels:
                    channels[ch_id] = {
                        "channel_id": ch_id,
                        "title": data.get("channel", data.get("uploader", "Unknown")),
                        "description": "",
                        "subscribers": data.get("channel_follower_count", 0) or 0,
                        "video_count": 0,
                    }
            except json.JSONDecodeError:
                continue

        return list(channels.values())
    except (subprocess.TimeoutExpired, Exception) as e:
        print(f"  WARNING: Search failed for '{query}': {e}")
        return []


def discover_all():
    """Main discovery: start with seed channels, then search for more."""
    all_channels = {}   # channel_id -> channel info
    channel_tags = {}   # channel_id -> list of tag dicts

    # Phase 1: Validate and enrich seed channels
    print(f"Phase 1: Validating {len(SEED_CHANNELS)} seed channels...")
    print("=" * 60)

    for i, seed in enumerate(SEED_CHANNELS, 1):
        ch_id = seed["channel_id"]
        print(f"  [{i}/{len(SEED_CHANNELS)}] {seed['title']}...", end=" ")

        info = get_channel_info(ch_id)
        if info:
            all_channels[ch_id] = info
        else:
            # Still include seed channel with basic info
            all_channels[ch_id] = {
                "channel_id": ch_id,
                "title": seed["title"],
                "description": "",
                "subscribers": 0,
                "video_count": 0,
            }

        # Parse seed tags into structured format
        tags = seed.get("tags", [])
        subjects = [t for t in tags if t in ("math", "science", "english")]
        countries = [t for t in tags if t in COUNTRIES or t == "all_countries"]
        grades = [t for t in tags if t.isdigit() or t == "all_grades"]

        if "all_countries" in countries:
            countries = list(COUNTRIES.keys())
        if "all_grades" in grades:
            grades = [str(g) for g in range(1, 10)]

        channel_tags[ch_id] = []
        for subject in (subjects or ["math"]):
            for country in (countries or list(COUNTRIES.keys())):
                for grade in (grades or [str(g) for g in range(1, 10)]):
                    tag = {"country": country, "subject": subject, "grade": int(grade) if grade.isdigit() else grade}
                    if tag not in channel_tags[ch_id]:
                        channel_tags[ch_id].append(tag)

        status = f"OK ({all_channels[ch_id].get('subscribers', 0):,} subs)" if info else "FALLBACK (seed data)"
        print(status)
        time.sleep(0.5)

    # Phase 2: Search for additional channels
    print(f"\nPhase 2: Searching for additional channels...")
    print("=" * 60)

    # Build targeted search queries
    search_queries = []
    for subject in SUBJECTS:
        ar_keywords = SUBJECTS[subject].get("ar", [])
        if ar_keywords:
            search_queries.append((f"{ar_keywords[0]} شرح دروس", subject))
            search_queries.append((f"{ar_keywords[0]} تعليم", subject))
        en_keywords = SUBJECTS[subject].get("en", [])
        if en_keywords:
            search_queries.append((f"{en_keywords[0]} tutorial for kids", subject))
            search_queries.append((f"{en_keywords[0]} explained grade school", subject))

    total_new = 0
    for qi, (query, subject_match) in enumerate(search_queries, 1):
        print(f"  [{qi}/{len(search_queries)}] Searching: {query}")
        results = search_channels_ytdlp(query, max_results=MAX_CHANNELS_PER_QUERY)
        for ch in results:
            ch_id = ch["channel_id"]
            if ch_id not in all_channels:
                all_channels[ch_id] = ch
                channel_tags[ch_id] = [{
                    "country": c,
                    "subject": subject_match,
                    "grade": g
                } for c in COUNTRIES.keys() for g in range(1, 10)]
                total_new += 1
                print(f"    NEW: {ch['title']}")
        time.sleep(1)

    # Build final output
    results = []
    for cid, info in all_channels.items():
        results.append({
            "channel_id": cid,
            "title": info.get("title", "Unknown"),
            "description": info.get("description", ""),
            "custom_url": "",
            "subscribers": info.get("subscribers", 0),
            "video_count": info.get("video_count", 0),
            "tags": channel_tags.get(cid, []),
        })

    results.sort(key=lambda x: x["subscribers"], reverse=True)

    output_path = os.path.join(SCRIPT_DIR, "channels.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nDiscovered {len(results)} channels ({len(SEED_CHANNELS)} seed + {total_new} new)")
    print(f"Saved to {output_path}")

    print(f"\nAll channels:")
    for i, ch in enumerate(results, 1):
        subjects = set(t.get("subject", "?") for t in ch["tags"][:5])
        print(f"  {i:2d}. {ch['title'][:50]:50s} | {ch['subscribers']:>10,} subs | {','.join(subjects)}")

    return results


if __name__ == "__main__":
    discover_all()
