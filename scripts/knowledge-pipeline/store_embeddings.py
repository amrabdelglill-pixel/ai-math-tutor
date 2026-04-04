#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 4b: Store Embeddings in Supabase
=================================================================
Reads chunks.json, generates OpenAI embeddings (text-embedding-3-small),
and upserts into Supabase knowledge_chunks table with pgvector.

Also stores channel + transcript metadata in their respective tables.

Requires:
  OPENAI_API_KEY          — OpenAI API key for embeddings
  SUPABASE_URL            — Supabase project URL
  SUPABASE_SERVICE_KEY    — Supabase service role key (bypasses RLS)
"""

import os
import json
import sys
import time
import hashlib
from config import (
    SUPABASE_CHANNELS_TABLE,
    SUPABASE_TRANSCRIPTS_TABLE,
    SUPABASE_CHUNKS_TABLE,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHANNELS_FILE = os.path.join(SCRIPT_DIR, "channels.json")
CHUNKS_FILE = os.path.join(SCRIPT_DIR, "chunks.json")

# Embedding model config
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
BATCH_SIZE = 100  # OpenAI allows up to 2048 inputs per request


def get_supabase_client():
    """Initialize Supabase client."""
    try:
        from supabase import create_client
    except ImportError:
        print("ERROR: Install supabase-py: pip install supabase --break-system-packages")
        sys.exit(1)

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables")
        sys.exit(1)

    return create_client(url, key)


def get_openai_client():
    """Initialize OpenAI client."""
    try:
        from openai import OpenAI
    except ImportError:
        print("ERROR: Install openai: pip install openai --break-system-packages")
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: Set OPENAI_API_KEY environment variable")
        sys.exit(1)

    return OpenAI(api_key=api_key)


def generate_embeddings(openai_client, texts, batch_size=BATCH_SIZE):
    """Generate embeddings for a list of texts in batches."""
    all_embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        print(f"  Embedding batch {i // batch_size + 1}/{(len(texts) - 1) // batch_size + 1} ({len(batch)} texts)...")

        try:
            response = openai_client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=batch,
                dimensions=EMBEDDING_DIMENSIONS,
            )
            batch_embeddings = [item.embedding for item in response.data]
            all_embeddings.extend(batch_embeddings)
        except Exception as e:
            print(f"  ERROR generating embeddings: {e}")
            # Fill with None for failed batch
            all_embeddings.extend([None] * len(batch))

        # Rate limiting
        if i + batch_size < len(texts):
            time.sleep(0.5)

    return all_embeddings


def store_channels(supabase, channels):
    """Upsert channel metadata into Supabase."""
    print(f"\nStoring {len(channels)} channels...")
    success_count = 0
    fail_count = 0

    for i in range(0, len(channels), 20):
        batch = channels[i : i + 20]
        rows = []
        for ch in batch:
            rows.append({
                "channel_id": ch["channel_id"],
                "title": (ch.get("title") or "")[:500],
                "description": (ch.get("description") or "")[:2000],
                "custom_url": ch.get("custom_url", ""),
                "subscribers": ch.get("subscribers", 0) or 0,
                "video_count": ch.get("video_count", 0) or 0,
                "tags": ch.get("tags", []),
            })

        try:
            supabase.table(SUPABASE_CHANNELS_TABLE).upsert(
                rows, on_conflict="channel_id"
            ).execute()
            success_count += len(rows)
        except Exception as e:
            print(f"  ERROR: Channel batch {i//20+1} upsert failed: {type(e).__name__}: {e}")
            # Try one by one to identify the bad row
            for row in rows:
                try:
                    supabase.table(SUPABASE_CHANNELS_TABLE).upsert(
                        [row], on_conflict="channel_id"
                    ).execute()
                    success_count += 1
                except Exception as e2:
                    print(f"    SKIP channel {row['channel_id']}: {e2}")
                    fail_count += 1

    print(f"  Done — {success_count} channels stored, {fail_count} failed")


def _parse_published_at(raw):
    """Convert yt-dlp date format (YYYYMMDD or '') to ISO-8601 or None."""
    if not raw:
        return None
    raw = str(raw).strip()
    if len(raw) == 8 and raw.isdigit():
        # YYYYMMDD → YYYY-MM-DD
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    if "T" in raw or "-" in raw:
        return raw  # Already ISO-ish
    return None


def store_transcripts_metadata(supabase, chunks):
    """Extract unique video metadata from chunks and upsert into transcripts table."""
    # Deduplicate by video_id
    videos = {}
    for chunk in chunks:
        vid = chunk["video_id"]
        if vid not in videos:
            grades_raw = chunk.get("grades", [])
            # Ensure grades are integers for int4[] column
            grades = [int(g) for g in grades_raw if str(g).isdigit()]

            videos[vid] = {
                "video_id": vid,
                "video_title": (chunk.get("video_title") or "")[:500],
                "channel_id": chunk.get("channel_id", ""),
                "language": chunk.get("language", "ar"),
                "view_count": chunk.get("view_count", 0) or 0,
                "published_at": _parse_published_at(chunk.get("published_at")),
                "subjects": chunk.get("subjects", []),
                "countries": chunk.get("countries", []),
                "grades": grades,
            }

    print(f"\nStoring {len(videos)} transcript records...")
    success_count = 0
    fail_count = 0

    video_list = list(videos.values())
    for i in range(0, len(video_list), 20):
        batch = video_list[i : i + 20]
        try:
            supabase.table(SUPABASE_TRANSCRIPTS_TABLE).upsert(
                batch, on_conflict="video_id"
            ).execute()
            success_count += len(batch)
        except Exception as e:
            print(f"  ERROR: Transcript batch {i//20+1} upsert failed: {type(e).__name__}: {e}")
            # Try one by one
            for row in batch:
                try:
                    supabase.table(SUPABASE_TRANSCRIPTS_TABLE).upsert(
                        [row], on_conflict="video_id"
                    ).execute()
                    success_count += 1
                except Exception as e2:
                    print(f"    SKIP transcript {row['video_id']}: {e2}")
                    fail_count += 1

    print(f"  Done — {success_count} transcripts stored, {fail_count} failed")


def store_chunks_with_embeddings(supabase, openai_client, chunks):
    """Generate embeddings and store chunks in Supabase."""
    print(f"\nProcessing {len(chunks)} chunks for embedding + storage...")

    # Check which chunks already exist
    existing_ids = set()
    try:
        # Fetch existing chunk_ids in pages
        offset = 0
        page_size = 1000
        while True:
            result = (
                supabase.table(SUPABASE_CHUNKS_TABLE)
                .select("chunk_id")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            if not result.data:
                break
            existing_ids.update(row["chunk_id"] for row in result.data)
            if len(result.data) < page_size:
                break
            offset += page_size
    except Exception as e:
        print(f"  NOTE: Could not fetch existing chunk IDs: {type(e).__name__}: {e}")

    # Filter to only new chunks
    new_chunks = [c for c in chunks if c["chunk_id"] not in existing_ids]
    print(f"  {len(existing_ids)} existing chunks, {len(new_chunks)} new chunks to process")

    if not new_chunks:
        print("  No new chunks to embed")
        return

    # Extract texts for embedding
    texts = [c["text"] for c in new_chunks]

    # Generate embeddings
    print(f"\nGenerating embeddings for {len(texts)} chunks...")
    embeddings = generate_embeddings(openai_client, texts)

    # Upsert chunks with embeddings
    print(f"\nUpserting {len(new_chunks)} chunks to Supabase...")
    success_count = 0
    fail_count = 0

    for i in range(0, len(new_chunks), 50):
        batch_chunks = new_chunks[i : i + 50]
        batch_embeddings = embeddings[i : i + 50]

        rows = []
        for chunk, emb in zip(batch_chunks, batch_embeddings):
            grades_raw = chunk.get("grades", [])
            grades = [int(g) for g in grades_raw if str(g).isdigit()]

            row = {
                "chunk_id": chunk["chunk_id"],
                "video_id": chunk["video_id"],
                "chunk_index": chunk["chunk_index"],
                "text": chunk["text"],
                "language": chunk.get("language", "ar"),
                "subjects": chunk.get("subjects", []),
                "countries": chunk.get("countries", []),
                "grades": grades,
                "topics": chunk.get("topics", []),
                "embedding": emb,
            }
            rows.append(row)

        try:
            supabase.table(SUPABASE_CHUNKS_TABLE).upsert(
                rows, on_conflict="chunk_id"
            ).execute()
            success_count += len(rows)
        except Exception as e:
            print(f"  ERROR: Chunk batch upsert failed: {type(e).__name__}: {e}")
            # Try one by one to identify bad rows
            for row in rows:
                try:
                    supabase.table(SUPABASE_CHUNKS_TABLE).upsert(
                        [row], on_conflict="chunk_id"
                    ).execute()
                    success_count += 1
                except Exception as e2:
                    print(f"    SKIP chunk {row['chunk_id']}: {e2}")
                    fail_count += 1

        if (i + 50) % 200 == 0 or i + 50 >= len(new_chunks):
            print(f"  Progress: {min(i + 50, len(new_chunks))}/{len(new_chunks)}")

    print(f"\n  Stored: {success_count}, Failed: {fail_count}")


def run():
    """Main: store channels, transcripts, and embedded chunks in Supabase."""
    print("Initializing clients...")
    supabase = get_supabase_client()
    openai_client = get_openai_client()

    # Store channels
    if os.path.exists(CHANNELS_FILE):
        with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
            channels = json.load(f)
        store_channels(supabase, channels)
    else:
        print("WARNING: channels.json not found, skipping channel storage")

    # Load chunks
    if not os.path.exists(CHUNKS_FILE):
        print("ERROR: chunks.json not found. Run process_and_chunk.py first.")
        return

    with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
        chunks = json.load(f)

    print(f"Loaded {len(chunks)} chunks from {CHUNKS_FILE}")

    # Store transcript metadata
    store_transcripts_metadata(supabase, chunks)

    # Generate embeddings and store chunks
    store_chunks_with_embeddings(supabase, openai_client, chunks)

    print(f"\n{'=' * 60}")
    print("Supabase storage complete!")
    print(f"  Channels table: {SUPABASE_CHANNELS_TABLE}")
    print(f"  Transcripts table: {SUPABASE_TRANSCRIPTS_TABLE}")
    print(f"  Chunks table: {SUPABASE_CHUNKS_TABLE}")


if __name__ == "__main__":
    run()
