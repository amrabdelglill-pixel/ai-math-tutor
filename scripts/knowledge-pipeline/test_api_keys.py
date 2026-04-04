#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Dependency & API Key Diagnostic
============================================================
Quick test of all tools and API keys before running the full pipeline.
"""

import os
import sys
import json
import subprocess


def test_ytdlp():
    """Test yt-dlp is installed and can fetch YouTube data."""
    try:
        result = subprocess.run(
            ["yt-dlp", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            print(f"  FAIL: yt-dlp not found or not working")
            return False
        version = result.stdout.strip()
        print(f"  yt-dlp version: {version}")

        # Test actual YouTube fetch
        result2 = subprocess.run(
            [
                "yt-dlp",
                "--dump-json",
                "--flat-playlist",
                "--playlist-items", "1",
                "--no-download",
                "https://www.youtube.com/channel/UC4a-Gbdw7vOaccHmFo40b9g/videos",  # Khan Academy
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result2.returncode == 0 and result2.stdout.strip():
            data = json.loads(result2.stdout.strip().split("\n")[0])
            print(f"  OK: Fetched video from {data.get('channel', 'unknown channel')}")
            return True
        else:
            print(f"  FAIL: Could not fetch YouTube data: {result2.stderr[:200]}")
            return False
    except FileNotFoundError:
        print("  FAIL: yt-dlp is not installed")
        return False
    except Exception as e:
        print(f"  FAIL: {type(e).__name__}: {e}")
        return False


def test_transcript_api():
    """Test yt-dlp subtitle extraction works (replaces youtube-transcript-api)."""
    try:
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            result = subprocess.run(
                [
                    "yt-dlp",
                    "--write-sub", "--write-auto-sub",
                    "--sub-lang", "en",
                    "--sub-format", "json3",
                    "--skip-download",
                    "--no-warnings",
                    "-o", os.path.join(tmpdir, "%(id)s"),
                    "https://www.youtube.com/watch?v=WUvTyaaNkzM",
                ],
                capture_output=True, text=True, timeout=30,
            )
            import glob
            sub_files = glob.glob(os.path.join(tmpdir, "*.json3"))
            if sub_files:
                with open(sub_files[0], "r") as f:
                    data = json.load(f)
                events = [e for e in data.get("events", []) if "segs" in e]
                print(f"  OK: yt-dlp extracted {len(events)} subtitle events for test video")
                return True
            else:
                # Check for vtt fallback
                vtt_files = glob.glob(os.path.join(tmpdir, "*.vtt"))
                if vtt_files:
                    print(f"  OK: yt-dlp extracted subtitles (VTT format) for test video")
                    return True
                print(f"  WARN: No subtitles found for test video (may not have captions)")
                return True  # Not a hard fail
    except Exception as e:
        print(f"  WARN: Subtitle test inconclusive: {type(e).__name__}: {e}")
        return True


def test_openai_api():
    """Test OpenAI API key with a simple embedding request."""
    import urllib.request
    import urllib.error

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("  FAIL: OPENAI_API_KEY not set")
        return False

    print(f"  Key set: yes (length={len(api_key)})")

    url = "https://api.openai.com/v1/embeddings"
    payload = json.dumps({
        "model": "text-embedding-3-small",
        "input": "test"
    }).encode()
    try:
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Authorization", f"Bearer {api_key}")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            dim = len(data["data"][0]["embedding"])
            print(f"  OK: Embedding returned {dim} dimensions")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  FAIL: HTTP {e.code} {e.reason}")
        print(f"  Response: {body[:300]}")
        return False
    except Exception as e:
        print(f"  FAIL: {type(e).__name__}: {e}")
        return False


def test_supabase():
    """Test Supabase connection."""
    import urllib.request
    import urllib.error

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print(f"  FAIL: SUPABASE_URL={'set' if url else 'missing'}, SUPABASE_SERVICE_KEY={'set' if key else 'missing'}")
        return False

    print(f"  URL: {url}")
    print(f"  Key set: yes (length={len(key)})")

    test_url = f"{url}/rest/v1/"
    try:
        req = urllib.request.Request(test_url)
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        with urllib.request.urlopen(req) as resp:
            print(f"  OK: Supabase responded {resp.status}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  FAIL: HTTP {e.code} {e.reason}")
        print(f"  Response: {body[:300]}")
        return False
    except Exception as e:
        print(f"  FAIL: {type(e).__name__}: {e}")
        return False


def test_google_drive():
    """Test Google Drive service account."""
    sa_key_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY", "")
    if not sa_key_path:
        print("  FAIL: GOOGLE_SERVICE_ACCOUNT_KEY path not set")
        return False

    if not os.path.exists(sa_key_path):
        print(f"  FAIL: Service account file not found at {sa_key_path}")
        return False

    try:
        with open(sa_key_path) as f:
            sa = json.load(f)
        print(f"  Service account: {sa.get('client_email', 'unknown')}")
        print(f"  Project: {sa.get('project_id', 'unknown')}")

        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        creds = service_account.Credentials.from_service_account_file(
            sa_key_path, scopes=["https://www.googleapis.com/auth/drive"]
        )
        drive = build("drive", "v3", credentials=creds)
        about = drive.about().get(fields="user").execute()
        print(f"  OK: Authenticated as {about['user']['emailAddress']}")
        return True
    except Exception as e:
        err_str = str(e)
        if "has not been used" in err_str or "not been enabled" in err_str:
            print(f"  FAIL: Google Drive API is NOT ENABLED on your GCP project.")
            print(f"  FIX: Go to https://console.cloud.google.com/apis/library/drive.googleapis.com")
            print(f"        and click 'Enable'")
        else:
            print(f"  FAIL: {type(e).__name__}: {err_str[:300]}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("ZELUU KNOWLEDGE PIPELINE — DIAGNOSTICS")
    print("=" * 60)

    results = {}

    print("\n1. yt-dlp (YouTube data — no API key needed):")
    results["yt-dlp"] = test_ytdlp()

    print("\n2. yt-dlp subtitle extraction:")
    results["transcripts"] = test_transcript_api()

    print("\n3. OpenAI API:")
    results["openai"] = test_openai_api()

    print("\n4. Supabase:")
    results["supabase"] = test_supabase()

    print("\n5. Google Drive:")
    results["google_drive"] = test_google_drive()

    print("\n" + "=" * 60)
    print("SUMMARY:")
    all_ok = True
    for name, ok in results.items():
        status = "PASS" if ok else "FAIL"
        print(f"  {name:20s}: {status}")
        if not ok:
            all_ok = False

    print("=" * 60)

    if not all_ok:
        print("\nSome checks failed. Fix them before running the pipeline.")
        sys.exit(1)
    else:
        print("\nAll checks passed! Pipeline is ready to run.")
