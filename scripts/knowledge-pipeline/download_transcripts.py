#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 2: Download Transcripts
========================================================
For each discovered channel, fetches recent/popular videos
and downloads their transcripts using youtube-transcript-api.

Requires: YOUTUBE_API_KEY environment variable.

Input:  channels.json (from Step 1)
Output: transcripts/ folder with JSON files per video
"""

import os
import json
import sys
import time
import re
from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)
from config import (
    MAX_VIDEOS_PER_CHANNEL,
    MIN_VIDEO_DURATION_SECS,
    MAX_VIDEO_DURATION_SECS,
    TRANSCRIPT_LANGUAGES,
    SEED_CHANNELS,
)

API_KEY = os.environ.get("YOUTUBE_API_KEY")
if not API_KEY:
    print("ERROR: Set YOUTUBE_API_KEY environment variable")
    sys.exit(1)

youtube = build("youtube", "v3", developerKey=API_KEY)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHANNELS_FILE = os.path.join(SCRIPT_DIR, "channels.json")
TRANSCRIPTS_DIR = os.path.join(SCRIPT_DIR, "transcripts")
PROGRESS_FILE = os.path.join(SCRIPT_DIR, "download_progress.json")


def parse_duration(duration_str):
    """Parse ISO 8601 duration (PT1H2M3S) to seconds."""
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration_str)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def get_channel_videos(channel_id, max_results=20):
    """Get recent videos from a channel, sorted by view count."""
    videos = []
    try:
        # Get uploads playlist
        ch_response = youtube.channels().list(
            id=channel_id,
            part="contentDetails",
        ).execute()

        if not ch_response.get("items"):
            return []

        uploads_id = ch_response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

        # Get videos from uploads playlist
        next_page = None
        fetched = 0
        while fetched < max_results:
            pl_response = youtube.playlistItems().list(
                playlistId=uploads_id,
                part="snippet,contentDetails",
                maxResults=min(50, max_results - fetched),
                pageToken=next_page,
            ).execute()

            video_ids = [item["contentDetails"]["videoId"] for item in pl_response.get("items", [])]

            if not video_ids:
                break

            # Get video details (duration, views)
            vd_response = youtube.videos().list(
                id=",".join(video_ids),
                part="contentDetails,statistics,snippet",
            ).execute()

            for item in vd_response.get("items", []):
                duration = parse_duration(item["contentDetails"].get("duration", "PT0S"))
                if duration < MIN_VIDEO_DURATION_SECS or duration > MAX_VIDEO_DURATION_SECS:
                    continue

                videos.append({
                    "video_id": item["id"],
                    "title": item["snippet"]["title"],
                    "description": item["snippet"].get("description", "")[:500],
                    "published_at": item["snippet"]["publishedAt"],
                    "duration_secs": duration,
                    "view_count": int(item["statistics"].get("viewCount", 0)),
                    "channel_id": channel_id,
                })

            fetched += len(pl_response.get("items", []))
            next_page = pl_response.get("nextPageToken")
            if not next_page:
                break

    except Exception as e:
        print(f"  WARNING: Failed to get videos for channel {channel_id}: {e}")

    # Sort by views (most popular first)
    videos.sort(key=lambda x: x["view_count"], reverse=True)
    return videos[:max_results]


def download_transcript(video_id):
    """Download transcript for a video. Accepts Arabic, English, French, or any available language."""
    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        # Priority 1: manually created in preferred languages (ar > en > fr)
        transcript = None
        for lang in TRANSCRIPT_LANGUAGES:
            try:
                transcript = transcript_list.find_manually_created_transcript([lang])
                break
            except NoTranscriptFound:
                pass

        # Priority 2: auto-generated in preferred languages
        if not transcript:
            for lang in TRANSCRIPT_LANGUAGES:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    break
                except NoTranscriptFound:
                    pass

        # Priority 3: ANY available transcript (manual first, then auto)
        if not transcript:
            try:
                all_transcripts = list(transcript_list)
                manual = [t for t in all_transcripts if not t.is_generated]
                auto = [t for t in all_transcripts if t.is_generated]
                transcript = (manual or auto or [None])[0]
            except Exception:
                pass

        if not transcript:
            return None, None

        entries = transcript.fetch()
        language = transcript.language_code

        # Build full text and timestamped segments
        segments = []
        full_text = []
        for entry in entries:
            segments.append({
                "start": round(entry.start, 1),
                "duration": round(entry.duration, 1),
                "text": entry.text,
            })
            full_text.append(entry.text)

        return {
            "language": language,
            "is_generated": transcript.is_generated,
            "segments": segments,
            "full_text": " ".join(full_text),
        }, language

    except (TranscriptsDisabled, VideoUnavailable):
        return None, None
    except Exception as e:
        print(f"  WARNING: Transcript failed for {video_id}: {e}")
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
        # Save updated channels list
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
        ch_title = channel["title"][:40]
        tags = channel.get("tags", [])

        print(f"\n[{ci}/{total_channels}] {ch_title} ({channel['subscribers']:,} subs)")

        videos = get_channel_videos(ch_id, MAX_VIDEOS_PER_CHANNEL)
        print(f"  Found {len(videos)} eligible videos")

        for vi, video in enumerate(videos, 1):
            vid = video["video_id"]

            if vid in already_done:
                continue

            print(f"  [{vi}/{len(videos)}] {video['title'][:50]}...", end=" ")

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
                    "channel_title": channel["title"],
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
            time.sleep(0.3)  # Rate limiting

    print(f"\n{'=' * 60}")
    print(f"Done! Downloaded: {total_downloaded}, Skipped: {total_skipped}, Failed: {total_failed}")
    print(f"Transcripts saved to: {TRANSCRIPTS_DIR}")


if __name__ == "__main__":
    run()
