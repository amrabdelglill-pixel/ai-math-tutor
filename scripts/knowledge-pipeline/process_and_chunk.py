#!/usr/bin/env python3
"""
Zeluu Knowledge Pipeline — Step 3: Process & Chunk Transcripts
===============================================================
Reads raw transcripts, cleans them, splits into teaching-sized chunks,
and prepares metadata for embedding and storage.

Input:  transcripts/ folder (from Step 2)
Output: chunks.json — processed chunks ready for embedding + Drive upload
"""

import os
import json
import re
import hashlib
from config import CHUNK_SIZE, CHUNK_OVERLAP, COUNTRIES, SUBJECTS

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRANSCRIPTS_DIR = os.path.join(SCRIPT_DIR, "transcripts")
CHUNKS_FILE = os.path.join(SCRIPT_DIR, "chunks.json")


def clean_text(text):
    """Clean transcript text: remove filler, normalize whitespace."""
    # Remove common YouTube auto-caption artifacts
    text = re.sub(r"\[.*?\]", "", text)  # [Music], [Applause], etc.
    text = re.sub(r"\(.*?\)", "", text)  # (inaudible), etc.
    text = re.sub(r"\s+", " ", text)     # Normalize whitespace
    text = text.strip()
    return text


def extract_teaching_segments(segments):
    """Group timestamp segments into coherent teaching blocks (~30s windows)."""
    blocks = []
    current_block = {"start": 0, "text": "", "duration": 0}

    for seg in segments:
        current_block["text"] += " " + seg["text"]
        current_block["duration"] = seg["start"] + seg["duration"] - current_block["start"]

        # Split at ~30 second boundaries (natural teaching segments)
        if current_block["duration"] >= 30:
            current_block["text"] = clean_text(current_block["text"])
            if len(current_block["text"]) > 50:  # Skip very short blocks
                blocks.append(current_block)
            current_block = {
                "start": seg["start"] + seg["duration"],
                "text": "",
                "duration": 0,
            }

    # Don't forget last block
    if current_block["text"].strip():
        current_block["text"] = clean_text(current_block["text"])
        if len(current_block["text"]) > 50:
            blocks.append(current_block)

    return blocks


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks for embedding."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size

        # Try to break at sentence boundary
        if end < len(text):
            # Look for sentence end near the chunk boundary
            for sep in [".", "؟", "!", "？", "\n"]:
                last_sep = text.rfind(sep, start + chunk_size // 2, end)
                if last_sep > 0:
                    end = last_sep + 1
                    break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap
        if start >= len(text):
            break

    return chunks


def detect_topics(text, subject):
    """Simple keyword-based topic detection for a chunk."""
    topics = []

    math_topics = {
        "addition": ["addition", "add", "plus", "جمع", "إضافة"],
        "subtraction": ["subtraction", "subtract", "minus", "طرح"],
        "multiplication": ["multiplication", "multiply", "times", "ضرب"],
        "division": ["division", "divide", "divided", "قسمة"],
        "fractions": ["fraction", "numerator", "denominator", "كسر", "بسط", "مقام"],
        "decimals": ["decimal", "point", "عشري"],
        "geometry": ["triangle", "circle", "square", "angle", "مثلث", "دائرة", "مربع", "زاوية"],
        "algebra": ["equation", "variable", "solve", "معادلة", "متغير", "حل"],
        "percentages": ["percent", "percentage", "نسبة مئوية"],
    }

    science_topics = {
        "physics": ["force", "energy", "motion", "gravity", "قوة", "طاقة", "حركة", "جاذبية"],
        "chemistry": ["element", "compound", "reaction", "atom", "عنصر", "مركب", "تفاعل", "ذرة"],
        "biology": ["cell", "plant", "animal", "body", "خلية", "نبات", "حيوان", "جسم"],
        "earth_science": ["weather", "rock", "water cycle", "طقس", "صخر", "دورة الماء"],
    }

    english_topics = {
        "grammar": ["grammar", "verb", "noun", "tense", "sentence", "قواعد"],
        "vocabulary": ["vocabulary", "word", "meaning", "مفردات", "كلمة"],
        "reading": ["reading", "comprehension", "story", "قراءة", "فهم"],
        "writing": ["writing", "essay", "paragraph", "كتابة", "مقال"],
    }

    topic_map = {
        "math": math_topics,
        "science": science_topics,
        "english": english_topics,
    }

    text_lower = text.lower()
    for topic_name, keywords in topic_map.get(subject, {}).items():
        for kw in keywords:
            if kw.lower() in text_lower:
                topics.append(topic_name)
                break

    return list(set(topics))


def process_all():
    """Main: process all transcript files into chunks."""
    if not os.path.exists(TRANSCRIPTS_DIR):
        print("ERROR: transcripts/ folder not found. Run download_transcripts.py first.")
        return

    transcript_files = [f for f in os.listdir(TRANSCRIPTS_DIR) if f.endswith(".json")]
    print(f"Processing {len(transcript_files)} transcript files...")
    print("=" * 60)

    all_chunks = []
    stats = {"total_transcripts": 0, "total_chunks": 0, "by_subject": {}, "by_country": {}}

    for fi, filename in enumerate(transcript_files, 1):
        filepath = os.path.join(TRANSCRIPTS_DIR, filename)

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        video_id = data["video_id"]
        transcript = data.get("transcript", {})
        full_text = clean_text(transcript.get("full_text", ""))
        segments = transcript.get("segments", [])
        tags = data.get("tags", [])
        language = transcript.get("language", "en")

        if not full_text or len(full_text) < 100:
            continue

        stats["total_transcripts"] += 1

        # Get unique subjects and countries from tags
        tag_subjects = list(set(t["subject"] for t in tags))
        tag_countries = list(set(t["country"] for t in tags))
        tag_grades = list(set(t["grade"] for t in tags))

        # Chunk the full text
        text_chunks = chunk_text(full_text)

        for ci, chunk_text_content in enumerate(text_chunks):
            # Detect topics for this chunk
            topics = []
            for subj in tag_subjects:
                topics.extend(detect_topics(chunk_text_content, subj))
            topics = list(set(topics))

            # Create chunk ID (deterministic)
            chunk_id = hashlib.md5(f"{video_id}:{ci}".encode()).hexdigest()[:16]

            chunk = {
                "chunk_id": chunk_id,
                "video_id": video_id,
                "video_title": data.get("video_title", ""),
                "channel_id": data.get("channel_id", ""),
                "channel_title": data.get("channel_title", ""),
                "chunk_index": ci,
                "text": chunk_text_content,
                "language": language,
                "subjects": tag_subjects,
                "countries": tag_countries,
                "grades": tag_grades,
                "topics": topics,
                "view_count": data.get("view_count", 0),
                "published_at": data.get("published_at", ""),
            }
            all_chunks.append(chunk)

        stats["total_chunks"] += len(text_chunks)
        for s in tag_subjects:
            stats["by_subject"][s] = stats["by_subject"].get(s, 0) + len(text_chunks)
        for c in tag_countries:
            stats["by_country"][c] = stats["by_country"].get(c, 0) + len(text_chunks)

        if fi % 50 == 0 or fi == len(transcript_files):
            print(f"  Processed {fi}/{len(transcript_files)} files, {stats['total_chunks']} chunks so far")

    # Save chunks
    with open(CHUNKS_FILE, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 60}")
    print(f"Total transcripts processed: {stats['total_transcripts']}")
    print(f"Total chunks created: {stats['total_chunks']}")
    print(f"\nBy subject: {json.dumps(stats['by_subject'], indent=2)}")
    print(f"By country: {json.dumps(stats['by_country'], indent=2)}")
    print(f"\nSaved to {CHUNKS_FILE}")

    return all_chunks


if __name__ == "__main__":
    process_all()
