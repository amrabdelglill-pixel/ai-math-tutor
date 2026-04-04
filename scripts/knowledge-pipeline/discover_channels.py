#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 1: Discover Channels
=====================================================
Uses YouTube Data API v3 to find top educational channels
per country × subject × grade.

Requires: YOUTUBE_API_KEY environment variable.

Output: channels.json — list of discovered channels with metadata.
"""

import os
import json
import sys
import time
from googleapiclient.discovery import build
from config import (
    COUNTRIES, SUBJECTS, GRADES, MAX_CHANNELS_PER_QUERY,
    build_search_queries
)

API_KEY = os.environ.get("YOUTUBE_API_KEY")
if not API_KEY:
    print("ERROR: Set YOUTUBE_API_KEY environment variable")
    sys.exit(1)

youtube = build("youtube", "v3", developerKey=API_KEY)

def search_channels(query, max_results=5):
    """Search YouTube for channels matching a query."""
    try:
        response = youtube.search().list(
            q=query,
            part="snippet",
            type="channel",
            maxResults=max_results,
            order="relevance",
            relevanceLanguage="ar",  # Prefer Arabic results
        ).execute()

        channels = []
        for item in response.get("items", []):
            channels.append({
                "channel_id": item["snippet"]["channelId"],
                "title": item["snippet"]["title"],
                "description": item["snippet"]["description"],
            })
        return channels
    except Exception as e:
        print(f"  WARNING: Search failed for '{query}': {e}")
        return []


def get_channel_stats(channel_ids):
    """Get subscriber count and video count for channels."""
    stats = {}
    # YouTube API allows up to 50 channel IDs per request
    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i:i+50]
        try:
            response = youtube.channels().list(
                id=",".join(batch),
                part="statistics,snippet",
            ).execute()
            for item in response.get("items", []):
                stats[item["id"]] = {
                    "subscribers": int(item["statistics"].get("subscriberCount", 0)),
                    "video_count": int(item["statistics"].get("videoCount", 0)),
                    "title": item["snippet"]["title"],
                    "description": item["snippet"]["description"],
                    "custom_url": item["snippet"].get("customUrl", ""),
                }
        except Exception as e:
            print(f"  WARNING: Stats fetch failed: {e}")
    return stats


def discover_all():
    """Main discovery loop: iterate countries × subjects × grades."""
    all_channels = {}  # channel_id -> channel info
    channel_tags = {}  # channel_id -> set of (country, subject, grade) tags

    total_queries = 0
    for country_code in COUNTRIES:
        for subject in SUBJECTS:
            for grade in GRADES:
                queries = build_search_queries(country_code, subject, grade)
                for query in queries[:3]:  # Limit to top 3 queries per combo to save quota
                    total_queries += 1

    print(f"Discovery plan: ~{total_queries} queries across {len(COUNTRIES)} countries × {len(SUBJECTS)} subjects × {len(GRADES)} grades")
    print("=" * 60)

    query_count = 0
    for country_code in COUNTRIES:
        country_name = COUNTRIES[country_code]["name"]
        for subject in SUBJECTS:
            for grade in GRADES:
                queries = build_search_queries(country_code, subject, grade)

                for query in queries[:3]:
                    query_count += 1
                    print(f"[{query_count}/{total_queries}] Searching: {query}")

                    channels = search_channels(query, MAX_CHANNELS_PER_QUERY)

                    for ch in channels:
                        cid = ch["channel_id"]
                        if cid not in all_channels:
                            all_channels[cid] = ch
                            channel_tags[cid] = []

                        tag = {
                            "country": country_code,
                            "subject": subject,
                            "grade": grade,
                        }
                        if tag not in channel_tags[cid]:
                            channel_tags[cid].append(tag)

                    # Respect API rate limits
                    time.sleep(0.2)

    # Enrich with stats
    print(f"\nFetching stats for {len(all_channels)} unique channels...")
    stats = get_channel_stats(list(all_channels.keys()))

    # Build final output
    results = []
    for cid, info in all_channels.items():
        ch_stats = stats.get(cid, {})
        results.append({
            "channel_id": cid,
            "title": ch_stats.get("title", info["title"]),
            "description": ch_stats.get("description", info["description"]),
            "custom_url": ch_stats.get("custom_url", ""),
            "subscribers": ch_stats.get("subscribers", 0),
            "video_count": ch_stats.get("video_count", 0),
            "tags": channel_tags[cid],
        })

    # Sort by subscriber count (most popular first)
    results.sort(key=lambda x: x["subscribers"], reverse=True)

    # Save
    output_path = os.path.join(os.path.dirname(__file__), "channels.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nDiscovered {len(results)} unique channels")
    print(f"Saved to {output_path}")

    # Print top 20
    print("\nTop 20 channels by subscribers:")
    for i, ch in enumerate(results[:20], 1):
        subjects = set(t["subject"] for t in ch["tags"])
        countries = set(t["country"] for t in ch["tags"])
        print(f"  {i:2d}. {ch['title'][:50]:50s} | {ch['subscribers']:>10,} subs | {','.join(subjects)} | {','.join(countries)}")

    return results


if __name__ == "__main__":
    discover_all()
