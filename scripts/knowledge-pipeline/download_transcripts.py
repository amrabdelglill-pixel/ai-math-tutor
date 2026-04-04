#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 2: Download Transcripts
========================================================
For each discovered channel, fetches videos using yt-dlp (no API key)
and downloads their transcripts using yt-dlp subtitle extraction.
Fully yt-dlp based — works on cloud IPs (GitHub Actions, AWS, etc).

NO YouTube Data API key required.

Input:  channels.json (from Step 1)
Output: transcripts/ folder with JSON files per video
"""

import os
import json
import sys
import time
import glob
import tempfile
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


def _parse_json3(filepath):
    """Parse yt-dlp json3 subtitle format into segments."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = []
    full_text = []

    for event in data.get("events", []):
        if "segs" not in event:
            continue
        start_ms = event.get("tStartMs", 0)
        duration_ms = event.get("dDurationMs", 0)
        text = "".join(seg.get("utf8", "") for seg in event["segs"]).strip()
        if not text or text == "\n":
            continue

        segments.append({
            "start": round(start_ms / 1000, 1),
            "duration": round(duration_ms / 1000, 1),
            "text": text,
        })
        full_text.append(text)

    return segments, " ".join(full_text)


def _parse_vtt(filepath):
    """Parse WebVTT subtitle format into segments (fallback)."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    segments = []
    full_text = []
    import re

    # Match VTT cues: timestamp --> timestamp \n text
    pattern = r"(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*\n(.+?)(?=\n\n|\Z)"
    for match in re.finditer(pattern, content, re.DOTALL):
        start_str, end_str, text = match.groups()
        # Remove VTT tags like <c> </c> and alignment tags
        text = re.sub(r"<[^>]+>", "", text).strip()
        if not text:
            continue

        # Parse timestamp to seconds
        parts = start_str.split(":")
        start_secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        end_parts = end_str.split(":")
        end_secs = int(end_parts[0]) * 3600 + int(end_parts[1]) * 60 + float(end_parts[2])

        segments.append({
            "start": round(start_secs, 1),
            "duration": round(end_secs - start_secs, 1),
            "text": text,
        })
        full_text.append(text)

    return segments, " ".join(full_text)


def download_transcript(video_id):
    """Download transcript using yt-dlp subtitles (works on cloud IPs unlike youtube-transcript-api)."""
    lang_str = ",".join(TRANSCRIPT_LANGUAGES)
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        output_tmpl = os.path.join(tmpdir, "%(id)s")

        # Download both manual and auto-generated subs in preferred languages
        result = subprocess.run(
            [
                "yt-dlp",
                "--write-sub", "--write-auto-sub",
                "--sub-lang", lang_str,
                "--sub-format", "json3",
                "--skip-download",
                "--no-warnings",
                "-o", output_tmpl,
                url,
            ],
            capture_output=True, text=True, timeout=60,
        )

        # Find downloaded subtitle files (json3 or vtt fallback)
        sub_files = glob.glob(os.path.join(tmpdir, f"{video_id}*"))
        sub_files = [f for f in sub_files if f.endswith((".json3", ".vtt", ".srt"))]

        if not sub_files:
            return None, None

        # Pick best subtitle file: prefer preferred languages in order (ar > en > fr)
        best_file = None
        detected_lang = None
        is_generated = False

        for lang in TRANSCRIPT_LANGUAGES:
            # Prefer manual subs (no "auto" in filename) over auto-generated
            manual = [f for f in sub_files if f".{lang}." in f and ".auto." not in os.path.basename(f)]
            auto = [f for f in sub_files if f".{lang}." in f and ".auto." in os.path.basename(f)]
            if manual:
                best_file = manual[0]
                detected_lang = lang
                is_generated = False
                break
            elif auto:
                best_file = auto[0]
                detected_lang = lang
                is_generated = True
                break

        # Fallback: any available subtitle file
        if not best_file:
            best_file = sub_files[0]
            basename = os.path.basename(best_file)
            parts = basename.split(".")
            detected_lang = parts[1] if len(parts) >= 3 else "unknown"
            is_generated = ".auto." in basename

        # Parse subtitle file
        try:
            if best_file.endswith(".json3"):
                segments, full_text = _parse_json3(best_file)
            elif best_file.endswith(".vtt"):
                segments, full_text = _parse_vtt(best_file)
            else:
                return None, None

            if not segments:
                return None, None

            return {
                "language": detected_lang,
                "is_generated": is_generated,
                "segments": segments,
                "full_text": full_text,
            }, detected_lang

        except Exception as e:
            print(f"  WARNING: Failed to parse subtitle for {video_id}: {e}")
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
            time.sleep(0.3)  # Rate limiting

    print(f"\n{'=' * 60}")
    print(f"Done! Downloaded: {total_downloaded}, Skipped: {total_skipped}, Failed: {total_failed}")
    print(f"Transcripts saved to: {TRANSCRIPTS_DIR}")


if __name__ == "__main__":
    run()
