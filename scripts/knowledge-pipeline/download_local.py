#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — LOCAL Transcript Download
=====================================================
Run this script on your LOCAL machine (not cloud/CI) to download
YouTube transcripts. YouTube blocks subtitle access from cloud IPs
(GitHub Actions, AWS, Azure, etc.), so this step must run locally.

Usage:
  pip install yt-dlp
  python download_local.py

After this completes:
  git add transcripts/ channels.json download_progress.json
  git commit -m "Add downloaded transcripts"
  git push

Then trigger the GitHub Actions pipeline (Steps 3-5) to process,
upload to Drive, and store embeddings in Supabase.
"""

import os
import sys

# Add script dir to path for imports
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from discover_channels import discover_all
from download_transcripts import run as download_run


def main():
    print("=" * 60)
    print("  ZELUU LOCAL DOWNLOAD")
    print("  Run this on your LOCAL machine (residential IP)")
    print("=" * 60)

    # Step 1: Discover channels
    print("\n--- Step 1: Discovering channels ---")
    discover_all()

    # Step 2: Download transcripts
    print("\n--- Step 2: Downloading transcripts ---")
    download_run()

    # Summary
    transcripts_dir = os.path.join(SCRIPT_DIR, "transcripts")
    if os.path.exists(transcripts_dir):
        count = len([f for f in os.listdir(transcripts_dir) if f.endswith(".json")])
    else:
        count = 0

    print("\n" + "=" * 60)
    print(f"  DONE! Downloaded {count} transcripts.")
    print()
    print("  Next steps:")
    print("  1. git add transcripts/ channels.json download_progress.json")
    print('  2. git commit -m "Add downloaded transcripts"')
    print("  3. git push")
    print("  4. Trigger GitHub Actions pipeline (runs Steps 3-5)")
    print("=" * 60)


if __name__ == "__main__":
    main()
