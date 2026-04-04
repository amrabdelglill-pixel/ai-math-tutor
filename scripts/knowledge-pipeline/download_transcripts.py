#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 2: Download Transcripts (Multi-Lane)
=====================================================================
For each discovered channel, fetches videos using yt-dlp (no API key)
and downloads their transcripts using a 3-lane fallback strategy:

  Lane A: yt-dlp subtitle extraction (with cookies if available)
  Lane B: youtube-transcript-api (with proxy if configured)
  Lane C: Whisper local transcription (download audio → transcribe)

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
import random
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
COOKIES_FILE = os.path.join(SCRIPT_DIR, "cookies.txt")
AUDIO_TMP_DIR = os.path.join(SCRIPT_DIR, ".audio_tmp")

# Delays between requests (seconds)
DELAY_BETWEEN_REQUESTS = 5  # 5s base delay
DELAY_JITTER = 3            # +0-3s random jitter
BATCH_PAUSE_EVERY = 15      # Extra pause every N videos
BATCH_PAUSE_SECS = 30       # Extra pause duration


# ---------------------------------------------------------------------------
#  Video discovery (yt-dlp)
# ---------------------------------------------------------------------------

def get_channel_videos(channel_id, max_results=20):
    """Get videos from a channel using yt-dlp (no API key needed)."""
    url = f"https://www.youtube.com/channel/{channel_id}/videos"
    videos = []
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--flat-playlist",
        "--no-download",
        "--playlist-items", f"1:{max_results}",
        "--remote-components", "ejs:github",
    ]
    # Use cookies if available
    if os.path.exists(COOKIES_FILE):
        cmd.extend(["--cookies", COOKIES_FILE])
    cmd.append(url)

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
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


# ---------------------------------------------------------------------------
#  Lane A: yt-dlp subtitle extraction
# ---------------------------------------------------------------------------

def _lane_a_ytdlp_subs(video_id):
    """Extract subtitles via yt-dlp --write-sub / --write-auto-sub."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    sub_dir = os.path.join(SCRIPT_DIR, ".sub_tmp")
    os.makedirs(sub_dir, exist_ok=True)

    # Clean up any previous files for this video
    for f in os.listdir(sub_dir):
        if f.startswith(video_id):
            os.remove(os.path.join(sub_dir, f))

    langs = ",".join(TRANSCRIPT_LANGUAGES)
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--write-sub",
        "--write-auto-sub",
        "--sub-lang", langs,
        "--sub-format", "json3",
        "--convert-subs", "json3",
        "--remote-components", "ejs:github",
        "-o", os.path.join(sub_dir, "%(id)s.%(ext)s"),
    ]
    if os.path.exists(COOKIES_FILE):
        cmd.extend(["--cookies", COOKIES_FILE])
    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return None, None
    except Exception:
        return None, None

    # Look for the downloaded subtitle file
    for lang in TRANSCRIPT_LANGUAGES:
        for suffix in [f".{lang}.json3", f".{lang}.json"]:
            sub_path = os.path.join(sub_dir, f"{video_id}{suffix}")
            if os.path.exists(sub_path):
                return _parse_json3_file(sub_path, lang)

    # Check for any subtitle file that was downloaded
    for f in sorted(os.listdir(sub_dir)):
        if f.startswith(video_id) and (f.endswith(".json3") or f.endswith(".json")):
            # Extract language from filename
            parts = f.replace(".json3", "").replace(".json", "").split(".")
            lang = parts[-1] if len(parts) > 1 else "en"
            return _parse_json3_file(os.path.join(sub_dir, f), lang)

    return None, None


def _parse_json3_file(filepath, lang):
    """Parse a json3 subtitle file into our transcript format."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        events = data.get("events", [])
        segments = []
        full_text_parts = []

        for event in events:
            segs = event.get("segs", [])
            text = "".join(s.get("utf8", "") for s in segs).strip()
            if not text or text in ("[Music]", "\n"):
                continue

            start_ms = event.get("tStartMs", 0)
            duration_ms = event.get("dDurationMs", 0)

            segments.append({
                "start": round(start_ms / 1000, 1),
                "duration": round(duration_ms / 1000, 1),
                "text": text,
            })
            full_text_parts.append(text)

        if not segments:
            return None, None

        return {
            "language": lang,
            "is_generated": True,  # yt-dlp auto-sub
            "source": "ytdlp_subtitle",
            "segments": segments,
            "full_text": " ".join(full_text_parts),
        }, lang

    except Exception:
        return None, None
    finally:
        try:
            os.remove(filepath)
        except OSError:
            pass


# ---------------------------------------------------------------------------
#  Lane B: youtube-transcript-api
# ---------------------------------------------------------------------------

def _lane_b_transcript_api(video_id):
    """Download transcript via youtube-transcript-api."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        ytt = YouTubeTranscriptApi()

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

            # Priority 3: any available
            if not transcript_obj:
                for t in transcript_list:
                    transcript_obj = t
                    detected_lang = t.language_code
                    is_generated = t.is_generated
                    break

        except Exception:
            return None, None

        if not transcript_obj:
            return None, None

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
            "source": "youtube_transcript_api",
            "segments": segments,
            "full_text": " ".join(full_text_parts),
        }, detected_lang

    except ImportError:
        return None, None
    except Exception:
        return None, None


# ---------------------------------------------------------------------------
#  Lane C: Whisper local transcription (fallback)
# ---------------------------------------------------------------------------

def _lane_c_whisper(video_id):
    """Download audio and transcribe with Whisper locally."""
    os.makedirs(AUDIO_TMP_DIR, exist_ok=True)
    audio_path = os.path.join(AUDIO_TMP_DIR, f"{video_id}.mp3")

    # Step 1: Download audio via yt-dlp
    url = f"https://www.youtube.com/watch?v={video_id}"
    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",  # lower quality = smaller file
        "--remote-components", "ejs:github",
        "-o", audio_path,
        "--no-playlist",
    ]
    if os.path.exists(COOKIES_FILE):
        cmd.extend(["--cookies", COOKIES_FILE])
    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode != 0:
            return None, None
    except (subprocess.TimeoutExpired, Exception):
        return None, None

    # yt-dlp may add extra extension
    if not os.path.exists(audio_path):
        # Look for the actual file
        for f in os.listdir(AUDIO_TMP_DIR):
            if f.startswith(video_id):
                audio_path = os.path.join(AUDIO_TMP_DIR, f)
                break
        else:
            return None, None

    # Step 2: Transcribe with Whisper
    try:
        import whisper
        model = whisper.load_model("base")  # "base" is fast + decent quality
        result = model.transcribe(audio_path, verbose=False)

        detected_lang = result.get("language", "en")
        whisper_segments = result.get("segments", [])

        segments = []
        full_text_parts = []
        for seg in whisper_segments:
            text = seg.get("text", "").strip()
            if not text:
                continue
            segments.append({
                "start": round(seg.get("start", 0), 1),
                "duration": round(seg.get("end", 0) - seg.get("start", 0), 1),
                "text": text,
            })
            full_text_parts.append(text)

        if not segments:
            return None, None

        return {
            "language": detected_lang,
            "is_generated": True,
            "source": "whisper_local",
            "segments": segments,
            "full_text": " ".join(full_text_parts),
        }, detected_lang

    except ImportError:
        print("  WARNING: Whisper not installed. Run: pip3 install openai-whisper")
        return None, None
    except Exception as e:
        print(f"  WARNING: Whisper failed for {video_id}: {e}")
        return None, None
    finally:
        # Clean up audio file
        try:
            os.remove(audio_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
#  Multi-lane download orchestrator
# ---------------------------------------------------------------------------

_ip_blocked = False  # Global flag to skip Lane B after first block


def download_transcript(video_id, _stats={"a": 0, "b": 0, "c": 0, "fail": 0}):
    """Download transcript using multi-lane fallback strategy.

    Lane A: yt-dlp subtitle extraction (cookies if available)
    Lane B: youtube-transcript-api (skip if IP blocked)
    Lane C: Whisper local transcription (audio download + transcribe)
    """
    global _ip_blocked

    # Lane A: yt-dlp subtitles
    transcript, lang = _lane_a_ytdlp_subs(video_id)
    if transcript:
        _stats["a"] += 1
        return transcript, lang

    # Lane B: youtube-transcript-api (skip if already IP blocked)
    if not _ip_blocked:
        transcript, lang = _lane_b_transcript_api(video_id)
        if transcript:
            _stats["b"] += 1
            return transcript, lang
        # Check if we got IP blocked
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            ytt = YouTubeTranscriptApi()
            ytt.list(video_id)
        except Exception as e:
            if "IpBlocked" in type(e).__name__ or "IpBlocked" in str(e):
                _ip_blocked = True
                print("\n  ⚠ IP blocked — disabling Lane B, using Whisper fallback")

    # Lane C: Whisper
    transcript, lang = _lane_c_whisper(video_id)
    if transcript:
        _stats["c"] += 1
        return transcript, lang

    _stats["fail"] += 1
    return None, None


# ---------------------------------------------------------------------------
#  Progress tracking
# ---------------------------------------------------------------------------

def load_progress():
    """Load download progress to support resuming."""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r") as f:
            return json.load(f)
    return {"downloaded": [], "failed": [], "skipped": []}


def save_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


# ---------------------------------------------------------------------------
#  Main orchestrator
# ---------------------------------------------------------------------------

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
    already_done = set(progress["downloaded"] + progress.get("failed", []) + progress.get("skipped", []))

    # Check for cookies
    if os.path.exists(COOKIES_FILE):
        print("Using cookies.txt for authenticated requests")
    else:
        print("No cookies.txt found — running without authentication")
        print("  (For better results: export cookies from Chrome incognito YouTube session)")

    # Check for Whisper
    whisper_available = False
    try:
        import whisper
        whisper_available = True
        print("Whisper available — Lane C fallback enabled")
    except ImportError:
        print("Whisper not installed — Lane C disabled (pip3 install openai-whisper)")

    total_channels = len(channels)
    video_count = 0
    stats = {"a": 0, "b": 0, "c": 0, "fail": 0}

    print(f"\nProcessing {total_channels} channels, {len(already_done)} videos already done")
    print(f"Strategy: Lane A (yt-dlp subs) → Lane B (transcript API) → Lane C (Whisper)")
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
            print(f"  [{vi}/{len(videos)}] {title_preview}...", end=" ", flush=True)

            transcript_data, lang = download_transcript(vid, stats)

            if transcript_data is None:
                print("SKIP (all lanes failed)")
                progress["skipped"].append(vid)
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
                source = transcript_data.get("source", "unknown")
                print(f"OK [{source}] ({lang}, {len(transcript_data['segments'])} segs)")

            save_progress(progress)
            already_done.add(vid)
            video_count += 1

            # Throttle: base delay + jitter
            delay = DELAY_BETWEEN_REQUESTS + random.uniform(0, DELAY_JITTER)
            time.sleep(delay)

            # Extra batch pause every N videos
            if video_count % BATCH_PAUSE_EVERY == 0:
                print(f"\n  --- Batch pause ({BATCH_PAUSE_SECS}s to avoid rate limits) ---")
                time.sleep(BATCH_PAUSE_SECS)

    # Final summary
    print(f"\n{'=' * 60}")
    print(f"  DOWNLOAD COMPLETE")
    print(f"  Lane A (yt-dlp subs): {stats['a']}")
    print(f"  Lane B (transcript API): {stats['b']}")
    print(f"  Lane C (Whisper): {stats['c']}")
    print(f"  Failed (all lanes): {stats['fail']}")
    total_new = stats['a'] + stats['b'] + stats['c']
    total_all = len([f for f in os.listdir(TRANSCRIPTS_DIR) if f.endswith('.json')])
    print(f"  New this run: {total_new}, Total transcripts: {total_all}")
    print(f"  Transcripts saved to: {TRANSCRIPTS_DIR}")


if __name__ == "__main__":
    run()
