#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Orchestrator
=========================================
Runs the full pipeline: discover → download → process → upload → embed.

Usage:
  python run_pipeline.py              # Run full pipeline
  python run_pipeline.py --step 1     # Run only step 1 (discover)
  python run_pipeline.py --step 2     # Run only step 2 (download)
  python run_pipeline.py --step 3     # Run only step 3 (process)
  python run_pipeline.py --step 4a    # Run only step 4a (upload to Drive)
  python run_pipeline.py --step 4b    # Run only step 4b (store embeddings)
  python run_pipeline.py --from 3     # Run from step 3 onwards

Required environment variables:
  YOUTUBE_API_KEY           — YouTube Data API v3 key
  GOOGLE_SERVICE_ACCOUNT_KEY — Path to Google service account JSON key
    or GOOGLE_CREDENTIALS_JSON — Inline JSON credentials
  OPENAI_API_KEY            — OpenAI API key (for embeddings)
  SUPABASE_URL              — Supabase project URL
  SUPABASE_SERVICE_KEY      — Supabase service role key
"""

import os
import sys
import time
import argparse
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def check_env():
    """Verify required environment variables are set."""
    required = {
        "YOUTUBE_API_KEY": "YouTube Data API v3 — needed for steps 1-2",
        "OPENAI_API_KEY": "OpenAI — needed for step 4b (embeddings)",
        "SUPABASE_URL": "Supabase project URL — needed for step 4b",
        "SUPABASE_SERVICE_KEY": "Supabase service role key — needed for step 4b",
    }
    drive_keys = ["GOOGLE_SERVICE_ACCOUNT_KEY", "GOOGLE_CREDENTIALS_JSON"]

    missing = []
    for key, desc in required.items():
        if not os.environ.get(key):
            missing.append(f"  {key} — {desc}")

    if not any(os.environ.get(k) for k in drive_keys):
        missing.append(f"  GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_CREDENTIALS_JSON — needed for step 4a (Drive upload)")

    if missing:
        print("WARNING: Missing environment variables:")
        for m in missing:
            print(m)
        print()
    return len(missing) == 0


def run_step(step_name, module_name, func_name="run"):
    """Import and run a pipeline step."""
    print(f"\n{'=' * 60}")
    print(f"STEP: {step_name}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'=' * 60}\n")

    start = time.time()
    try:
        # Add script dir to path so imports work
        if SCRIPT_DIR not in sys.path:
            sys.path.insert(0, SCRIPT_DIR)

        module = __import__(module_name)

        # Use the appropriate function name
        if func_name == "run" and hasattr(module, "run"):
            module.run()
        elif hasattr(module, "discover_all"):
            module.discover_all()
        elif hasattr(module, "process_all"):
            module.process_all()
        else:
            func = getattr(module, func_name)
            func()

        elapsed = time.time() - start
        print(f"\n✓ {step_name} completed in {elapsed:.1f}s")
        return True

    except Exception as e:
        elapsed = time.time() - start
        print(f"\n✗ {step_name} FAILED after {elapsed:.1f}s: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Zeluu Knowledge Pipeline Orchestrator")
    parser.add_argument("--step", type=str, help="Run only a specific step (1, 2, 3, 4a, 4b)")
    parser.add_argument("--from", dest="from_step", type=str, help="Run from a specific step onwards")
    parser.add_argument("--skip-env-check", action="store_true", help="Skip environment variable check")
    args = parser.parse_args()

    print("=" * 60)
    print("  ZELUU KNOWLEDGE PIPELINE")
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    if not args.skip_env_check:
        check_env()

    steps = [
        ("1", "Step 1: Discover YouTube Channels", "discover_channels", "discover_all"),
        ("2", "Step 2: Download Transcripts", "download_transcripts", "run"),
        ("3", "Step 3: Process & Chunk Transcripts", "process_and_chunk", "process_all"),
        ("4a", "Step 4a: Upload to Google Drive", "upload_to_drive", "run"),
        ("4b", "Step 4b: Store Embeddings in Supabase", "store_embeddings", "run"),
    ]

    # Filter steps based on args
    if args.step:
        steps = [(s, n, m, f) for s, n, m, f in steps if s == args.step]
        if not steps:
            print(f"ERROR: Unknown step '{args.step}'. Valid: 1, 2, 3, 4a, 4b")
            sys.exit(1)
    elif args.from_step:
        step_ids = [s[0] for s in steps]
        if args.from_step not in step_ids:
            print(f"ERROR: Unknown step '{args.from_step}'. Valid: 1, 2, 3, 4a, 4b")
            sys.exit(1)
        idx = step_ids.index(args.from_step)
        steps = steps[idx:]

    pipeline_start = time.time()
    results = {}

    for step_id, step_name, module_name, func_name in steps:
        success = run_step(step_name, module_name, func_name)
        results[step_id] = success
        if not success:
            print(f"\nPipeline stopped at step {step_id} due to error.")
            if step_id in ("1", "2"):
                print(f"Fix the issue and resume with: python run_pipeline.py --from {step_id}")
            break

    # Summary
    total_time = time.time() - pipeline_start
    print(f"\n{'=' * 60}")
    print("  PIPELINE SUMMARY")
    print(f"{'=' * 60}")
    for step_id, success in results.items():
        status = "✓ PASS" if success else "✗ FAIL"
        print(f"  Step {step_id}: {status}")
    print(f"\n  Total time: {total_time:.1f}s ({total_time / 60:.1f} min)")
    print(f"  Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()
