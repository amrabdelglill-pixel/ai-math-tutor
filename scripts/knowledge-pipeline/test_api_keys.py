#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — API Key Diagnostic
===============================================
Quick test of all API keys before running the full pipeline.
Prints exact error messages to help debug 403/auth issues.
"""

import os
import sys
import json

def test_youtube_api():
    """Test YouTube Data API v3 key with a simple search."""
    api_key = os.environ.get("YOUTUBE_API_KEY", "")
    if not api_key:
        print("  FAIL: YOUTUBE_API_KEY not set")
        return False

    print(f"  Key prefix: {api_key[:10]}...")

    # Test 1: Raw HTTP request to see exact error
    import urllib.request
    import urllib.error
    url = f"https://www.googleapis.com/youtube/v3/search?part=snippet&q=math&maxResults=1&type=channel&key={api_key}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            items = data.get("items", [])
            print(f"  OK: Search returned {len(items)} result(s)")
            if items:
                print(f"  Sample: {items[0]['snippet']['title']}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  FAIL: HTTP {e.code} {e.reason}")
        print(f"  Response body: {body[:1000]}")
        return False
    except Exception as e:
        print(f"  FAIL: {type(e).__name__}: {e}")
        return False


def test_openai_api():
    """Test OpenAI API key with a simple embedding request."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("  FAIL: OPENAI_API_KEY not set")
        return False

    print(f"  Key prefix: {api_key[:12]}...")

    import urllib.request
    import urllib.error
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
        print(f"  Response body: {body[:500]}")
        return False
    except Exception as e:
        print(f"  FAIL: {type(e).__name__}: {e}")
        return False


def test_supabase():
    """Test Supabase connection."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print(f"  FAIL: SUPABASE_URL={'set' if url else 'missing'}, SUPABASE_SERVICE_KEY={'set' if key else 'missing'}")
        return False

    print(f"  URL: {url}")
    print(f"  Key prefix: {key[:12]}...")

    import urllib.request
    import urllib.error
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
        print(f"  Response body: {body[:500]}")
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
        print(f"  FAIL: {type(e).__name__}: {e}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("ZELUU KNOWLEDGE PIPELINE — API KEY DIAGNOSTICS")
    print("=" * 60)

    results = {}

    print("\n1. YouTube Data API v3:")
    results["youtube"] = test_youtube_api()

    print("\n2. OpenAI API:")
    results["openai"] = test_openai_api()

    print("\n3. Supabase:")
    results["supabase"] = test_supabase()

    print("\n4. Google Drive:")
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
        print("\nSome API keys failed. Fix them before running the pipeline.")
        sys.exit(1)
    else:
        print("\nAll API keys OK! Pipeline is ready to run.")
