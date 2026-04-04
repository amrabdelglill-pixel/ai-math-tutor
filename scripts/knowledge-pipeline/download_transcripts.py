#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 2: Download Transcripts
========================================================
For each discovered channel, fetches videos using yt-dlp (no API key)
and downloads their transcripts using youtube-transcript-api.

MUST RUN LOCALLY — YouTube blocks subtitle access from cloud IPs.
Steps 3-5 (process, upload, embed) run on GitHub Actions.

NO YouTube Data API key required.

Input:  channels.json (from Step 1)
Output: transcripts/ folder with JSON files per video
"""

import os
import json
import sys
import time
import subprocess
from config import (
    MAX_VIDEOS_PER_CHANNEL,
    MIN_VIDEO_DURATION_SECS,
    MAX_VIDEO_DURATION_SECS,
    TRANSCRIPT_LANGUAGES,
    SEED_CHANNELS,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHANNELS_FILE = os.path.join(SCRIPT_DIR, "channels.json")
TRANSCRIPTS_DIR = os.path.join(SCRIPT_DIR, "transcripts")
PROGRESS_FILE = os.path.join(SCRIPT_DIR, "download_progress.json")


def get_channel_videos(channel_id, max_results=20):
    """Get videos from a channel using yt-dlp (no API key needed)."""
    url = f"https://www.youtube.com/channel/{channel_id}/videos"
    videos = []
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--dump-json",
                "--flat-playlist",
                "--no-download",
                "--playlist-items", f"1:{max_results}",
                url,
            ],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            print(f"  WARNING: yt-dlp failed for channel {channel_id}: {result.stderr[:200]}")
            return []

        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                duration = data.get("duration") or 0
                if duration < MIN_VIDEO_DURATION_SECS or duration > MAX_VIDEO_DURATION_SECS:
                    continue

                videos.append({
                    "video_id": data.get("id", ""),
                    "title": data.get("title", "Unknown"),
                    "description": (data.get("description", "") or "")[:500],
                    "published_at": data.get("upload_date", ""),
                    "duration_secs": duration,
                    "view_count": data.get("view_count", 0) or 0,
                    "channel_id": channel_id,
                })
            except json.JSONDecodeError:
                continue

    except subprocess.TimeoutExpired:
        print(f"  WARNING: Timeout fetching videos for channel {channel_id}")
    except Exception as e:
        print(f"  WARNING: Failed to get videos for channel {channel_id}: {e}")

    # Sort by views (most popular first)
    videos.sort(key=lambda x: x["view_count"], reverse=True)
    return videos[:max_results]


def download_transcript(video_id, _debug_count=[0]):
    """Download transcript using youtube-transcript-api.

    This runs LOCALLY on a residential IP where YouTube does not block
    subtitle requests.  The youtube-transcript-api library is the most
    reliable way to fetch transcripts.
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        ytt = YouTubeTranscriptApi()

        # Try preferred languages first, then fall back to any available
        transcript_obj = None
        detected_lang = None
        is_generated = False

        try:
            transcript_list = ytt.list(video_id)

            # Priority 1: manual transcripts in preferred languages
            for lang in TRANSCRIPT_LANGUAGES:
                for t in transcript_list:
                    if t.language_code.startswith(lang) and not t.is_generated:
                        transcript_obj = t
                        detected_lang = t.language_code
                        is_generated = False
                        break
                if transcript_obj:
                    break

            # Priority 2: auto-generated in preferred languages
            if not transcript_obj:
                for lang in TRANSCRIPT_LANGUAGES:
                    for t in transcript_list:
                        if t.language_code.startswith(lang) and t.is_generated:
                            transcript_obj = t
                            detected_lang = t.language_code
                            is_generated = True
                            break
                    if transcript_obj:
                        break

            # Priority 3: any available transcript
            if not transcript_obj:
                for t in transcript_list:
                    transcript_obj = t
                    detected_lang = t.language_code
                    is_generated = t.is_generated
                    break

        except Exception as e:
            _debug_count[0] += 1
            if _debug_count[0] <= 3:
                print(f"\n  DEBUG: list() failed for {video_id}: {e}")
            return None, None

        if not transcript_obj:
            return None, None

        # Fetch the actual transcript snippets
        snippets = transcript_obj.fetch()

        segments = []
        full_text_parts = []
        for snippet in snippets:
            text = snippet.text.strip()
            if not text or text == "[Music]":
                continue
            segments.append({
                "start": round(snippet.start, 1),
                "duration": round(snippet.duration, 1),
                "text": text,
            })
            full_text_parts.append(text)

        if not segments:
            return None, None

        return {
            "language": detected_lang,
            "is_generated": is_generated,
            "segments": segments,
            "full_text": " ".join(full_text_parts),
        }, detected_lang

    except ImportError:
        print("ERROR: youtube-transcript-api not installed. Run: pip install youtube-transcript-api")
        return None, None
    except Exception as e:
        _debug_count[0] += 1
        if _debug_count[0] <= 5:
            print(f"  WARNING: Transcript failed for {video_id}: {type(e).__name__}: {e}")
        return None, None


def load_progress():
    """Load download progress to support resuming."""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r") as f:
            return json.load(f)
    return {"downloaded": [], "failed": [], "skipped": []}


def save_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


def run():
    """Main: iterate channels, get videos, download transcripts."""
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)

    if not os.path.exists(CHANNELS_FILE):
        print("ERROR: channels.json not found. Run discover_channels.py first.")
        sys.exit(1)

    with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
        channels = json.load(f)

    # Merge seed channels (skip duplicates)
    existing_ids = {ch["channel_id"] for ch in channels}
    seed_added = 0
    for seed in SEED_CHANNELS:
        if seed["channel_id"] not in existing_ids:
            channels.append({
                "channel_id": seed["channel_id"],
                "title": seed["title"],
                "subscribers": 0,
                "tags": seed.get("tags", []),
            })
            existing_ids.add(seed["channel_id"])
            seed_added += 1
    if seed_added:
        print(f"Added {seed_added} seed channels (total: {len(channels)})")
        with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)

    progress = load_progress()
    already_done = set(progress["downloaded"] + progress["failed"] + progress["skipped"])

    total_channels = len(channels)
    total_downloaded = 0
    total_failed = 0
    total_skipped = 0

    print(f"Processing {total_channels} channels, {len(already_done)} videos already processed")
    print("=" * 60)

    for ci, channel in enumerate(channels, 1):
        ch_id = channel["channel_id"]
        ch_title = channel.get("title", "Unknown")[:40]
        tags = channel.get("tags", [])

        print(f"\n[{ci}/{total_channels}] {ch_title} ({channel.get('subscribers', 0):,} subs)")

        videos = get_channel_videos(ch_id, MAX_VIDEOS_PER_CHANNEL)
        print(f"  Found {len(videos)} eligible videos")

        for vi, video in enumerate(videos, 1):
            vid = video["video_id"]

            if vid in already_done:
                continue

            title_preview = video["title"][:50]
            print(f"  [{vi}/{len(videos)}] {title_preview}...", end=" ")

            transcript_data, lang = download_transcript(vid)

            if transcript_data is None:
                print("SKIP (no transcript)")
                progress["skipped"].append(vid)
                total_skipped += 1
            else:
                # Save transcript
                output = {
                    "video_id": vid,
                    "video_title": video["title"],
                    "channel_id": ch_id,
                    "channel_title": channel.get("title", "Unknown"),
                    "published_at": video["published_at"],
                    "duration_secs": video["duration_secs"],
                    "view_count": video["view_count"],
                    "tags": tags,
                    "transcript": transcript_data,
                }

                filepath = os.path.join(TRANSCRIPTS_DIR, f"{vid}.json")
                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(output, f, ensure_ascii=False, indent=2)

                progress["downloaded"].append(vid)
                total_downloaded += 1
                print(f"OK ({lang}, {len(transcript_data['segments'])} segments)")

            save_progress(progress)
            already_done.add(vid)
            time.sleep(1.5)  # Rate limiting — avoid YouTube IP bans

    print(f"\n{'=' * 60}")
    print(f"Done! Downloaded: {total_downloaded}, Skipped: {total_skipped}, Failed: {total_failed}")
    print(f"Transcripts saved to: {TRANSCRIPTS_DIR}")


if __name__ == "__main__":
    run()
