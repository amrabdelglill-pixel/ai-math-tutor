"""
Zeluu Knowledge Pipeline — Configuration
==========================================
Defines countries, subjects, grade levels, and search queries
for discovering educational YouTube content.
"""

# Countries to cover (Wave 1 + UAE + Egypt)
COUNTRIES = {
    "BH": {"name": "Bahrain", "lang": ["ar", "en"], "search_suffix": "البحرين"},
    "KW": {"name": "Kuwait", "lang": ["ar", "en"], "search_suffix": "الكويت"},
    "JO": {"name": "Jordan", "lang": ["ar"], "search_suffix": "الأردن"},
    "LB": {"name": "Lebanon", "lang": ["ar", "en", "fr"], "search_suffix": "لبنان"},
    "MA": {"name": "Morocco", "lang": ["ar", "fr"], "search_suffix": "المغرب"},
    "AE": {"name": "UAE", "lang": ["ar", "en"], "search_suffix": "الإمارات"},
    "EG": {"name": "Egypt", "lang": ["ar"], "search_suffix": "مصر"},
}

# Subjects
SUBJECTS = {
    "math": {
        "en": ["math", "mathematics", "algebra", "geometry", "arithmetic"],
        "ar": ["رياضيات", "حساب", "جبر", "هندسة"],
    },
    "science": {
        "en": ["science", "physics", "chemistry", "biology"],
        "ar": ["علوم", "فيزياء", "كيمياء", "أحياء"],
    },
    "english": {
        "en": ["english language", "english grammar", "reading comprehension"],
        "ar": ["لغة إنجليزية", "قواعد اللغة الإنجليزية"],
    },
}

# Grade levels (1-9)
GRADES = list(range(1, 10))

# Grade terms for search queries
GRADE_TERMS = {
    "en": {
        1: "grade 1", 2: "grade 2", 3: "grade 3",
        4: "grade 4", 5: "grade 5", 6: "grade 6",
        7: "grade 7", 8: "grade 8", 9: "grade 9",
    },
    "ar": {
        1: "الصف الأول", 2: "الصف الثاني", 3: "الصف الثالث",
        4: "الصف الرابع", 5: "الصف الخامس", 6: "الصف السادس",
        7: "الصف السابع", 8: "الصف الثامن", 9: "الصف التاسع",
    },
}

# YouTube API settings
MAX_CHANNELS_PER_QUERY = 5       # Top channels per search query
MAX_VIDEOS_PER_CHANNEL = 20      # Most recent/popular videos per channel
MIN_VIDEO_DURATION_SECS = 120    # Skip videos shorter than 2 minutes
MAX_VIDEO_DURATION_SECS = 3600   # Skip videos longer than 1 hour

# Transcript processing
CHUNK_SIZE = 1500                # Characters per chunk for embedding
CHUNK_OVERLAP = 200              # Overlap between chunks

# Google Drive folder structure
# User's shared Drive folder: https://drive.google.com/drive/folders/1uFrdxrKzBGiZaNo3TzTLnd_aGVXeLj3f
DRIVE_ROOT_FOLDER_ID = "1uFrdxrKzBGiZaNo3TzTLnd_aGVXeLj3f"  # Existing folder — subfolders created inside
DRIVE_ROOT_FOLDER = "Zeluu_Knowledge_Base"  # Legacy name ref
DRIVE_FOLDER_TEMPLATE = "{country}/{subject}/{grade}"

# Supabase table names
SUPABASE_CHANNELS_TABLE = "knowledge_channels"
SUPABASE_TRANSCRIPTS_TABLE = "knowledge_transcripts"
SUPABASE_CHUNKS_TABLE = "knowledge_chunks"


def build_search_queries(country_code, subject, grade):
    """Generate YouTube search queries for a given country/subject/grade combo."""
    country = COUNTRIES[country_code]
    queries = []

    for lang in country["lang"]:
        if lang not in SUBJECTS[subject]:
            continue
        for keyword in SUBJECTS[subject][lang]:
            grade_term = GRADE_TERMS.get(lang, {}).get(grade, f"grade {grade}")
            # Country-specific query
            suffix = country["search_suffix"] if lang == "ar" else country["name"]
            queries.append(f"{keyword} {grade_term} {suffix}")
            # Generic query (no country — catches big channels)
            queries.append(f"{keyword} {grade_term}")

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique.append(q)
    return unique
