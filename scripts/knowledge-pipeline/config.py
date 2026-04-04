"""
Zeluu Knowledge Pipeline — Configuration
==========================================
Defines countries, subjects, grade levels, and search queries
for discovering educational YouTube content.
"""

# Countries to cover (GCC + MENA + UK)
COUNTRIES = {
    "BH": {"name": "Bahrain", "lang": ["ar", "en"], "search_suffix": "البحرين"},
    "KW": {"name": "Kuwait", "lang": ["ar", "en"], "search_suffix": "الكويت"},
    "JO": {"name": "Jordan", "lang": ["ar"], "search_suffix": "الأردن"},
    "LB": {"name": "Lebanon", "lang": ["ar", "en", "fr"], "search_suffix": "لبنان"},
    "MA": {"name": "Morocco", "lang": ["ar", "fr"], "search_suffix": "المغرب"},
    "AE": {"name": "UAE", "lang": ["ar", "en"], "search_suffix": "الإمارات"},
    "EG": {"name": "Egypt", "lang": ["ar"], "search_suffix": "مصر"},
    "SA": {"name": "Saudi Arabia", "lang": ["ar", "en"], "search_suffix": "السعودية"},
    "UK": {"name": "United Kingdom", "lang": ["en"], "search_suffix": "UK"},
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
MAX_VIDEOS_PER_CHANNEL = 50      # Most recent/popular videos per channel
MIN_VIDEO_DURATION_SECS = 60     # Skip videos shorter than 1 minute
MAX_VIDEO_DURATION_SECS = 5400   # Skip videos longer than 1.5 hours

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


# Transcript language priority: accept Arabic, English, and French
# The pipeline will try ALL languages and accept whatever is available
TRANSCRIPT_LANGUAGES = ["ar", "en", "fr"]

# Seed channels — teacher-led school-lesson channels organized by rollout priority
# Rollout order: Egypt → Jordan → Saudi → GCC regional pack → UK → English global
# Each channel verified on YouTube with real channel ID
SEED_CHANNELS = [
    # =========================================================================
    #  1. EGYPT — Math
    # =========================================================================
    {"channel_id": "UCSy383dRTcPD3FGzPZ6jprQ", "title": "Math Teacher (بالعربي)", "tags": ["math", "EG", "SA", "BH", "KW", "AE", "JO", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UC2OJM3-_FMVBMdm2dHN4bVQ", "title": "Nafham - نفهم", "tags": ["math", "science", "EG", "BH", "KW", "AE", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCkw4JCwteGrDHIsyIIKo4tQ", "title": "Droos Online - دروس أونلاين", "tags": ["math", "science", "EG", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCinhgeiLeNdWVs8NEauWu7g", "title": "التأسيس السليم", "tags": ["math", "EG", "1", "2", "3"]},
    {"channel_id": "UCtV5lgWdRwhPifEBVYrc2Qg", "title": "الزهراء لتعليم الأطفال", "tags": ["math", "science", "EG", "1", "2", "3", "4"]},
    {"channel_id": "UC5g9WjBfj3vy_zTlyM_orAg", "title": "Mohamed Khaled Elbakary", "tags": ["math", "EG", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UC7bmnKMxLfFxEi6KHXkEV9w", "title": "Mohamed El Deeb - محمد الديب", "tags": ["math", "EG", "7", "8", "9"]},
    {"channel_id": "UCaxGPRhFkSJRxpoHi-HBvmg", "title": "Mustafa Mounir - مصطفى منير", "tags": ["math", "EG", "7", "8", "9"]},

    # =========================================================================
    #  1. EGYPT — Science
    # =========================================================================
    {"channel_id": "UCgOpwqJtgh2Divtk0o91www", "title": "Ahmed Hefny أحمد حفني", "tags": ["science", "EG", "3", "4", "5", "6"]},
    {"channel_id": "UCzd-m6jXBTBITIN13f1coIw", "title": "مستر عمرو أحمد - دروس علوم", "tags": ["math", "science", "EG", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  1. EGYPT — English (school-lesson based)
    # =========================================================================
    {"channel_id": "UC_Tw_gPyghjiKh8vrq75Q4A", "title": "Simple English with Ahmed", "tags": ["english", "EG", "SA", "BH", "KW", "AE", "JO", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCX5bU7eGKzlY-VyfcvA5EWA", "title": "Ms.Bassant Ahmed", "tags": ["english", "EG", "BH", "KW", "1", "2", "3", "4", "5", "6"]},
    {"channel_id": "UCEc7koXK6HY4aOhw7u3N9Xg", "title": "Teacher Aya Online Tutor", "tags": ["english", "EG", "AE", "1", "2", "3", "4", "5", "6"]},
    {"channel_id": "UClkf2zTnLqFJeYlrRpKnl3w", "title": "مستر انجليزى", "tags": ["english", "EG", "BH", "KW", "AE", "7", "8", "9"]},
    {"channel_id": "UCr8ww_CG194ATkyyyYFcIjQ", "title": "عبقري لغة - Ahmed Tarek", "tags": ["english", "EG", "AE", "7", "8", "9"]},

    # =========================================================================
    #  2. JORDAN — Math
    # =========================================================================
    {"channel_id": "UCM3ptl0AnCykCKrNlj9IJkQ", "title": "Jihad Ismail teacher", "tags": ["math", "JO", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCd2R4lOnXC7aTRGNMbJPK3A", "title": "Abwaab - أبواب", "tags": ["math", "science", "JO", "AE", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  2. JORDAN — Science
    # =========================================================================
    {"channel_id": "UCtpUUHkA-D2cPXZPRiHr79w", "title": "Teacher Amal Ammourah", "tags": ["science", "JO", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  2. JORDAN — English (school-lesson based)
    # =========================================================================
    {"channel_id": "UC14fjjbgToZTe80rexAA8yw", "title": "Teacher Waleed AL-SOUFI", "tags": ["english", "JO", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  3. SAUDI ARABIA — Math
    # =========================================================================
    {"channel_id": "UC4xlIl-AzGnApdHBTsPGXMg", "title": "أكاديمية قلم للتعليم", "tags": ["math", "science", "SA", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UC3bpbklhBPLcZIfeK9PK8bA", "title": "درس خصوصي رياضيات", "tags": ["math", "SA", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  3. SAUDI ARABIA — English (Mega Goal curriculum)
    # =========================================================================
    {"channel_id": "UCCFXhSoIW93FZXHV42MQ0Zw", "title": "Mega goal with Molhim", "tags": ["english", "SA", "7", "8", "9"]},

    # =========================================================================
    #  4a. KUWAIT — Math
    # =========================================================================
    {"channel_id": "UCVGH3gPUReCDR8ypvT7qI3g", "title": "أ / أحمد جمال مُعلم رياضيات", "tags": ["math", "KW", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  4b. UAE — Math
    # =========================================================================
    {"channel_id": "UCYZLW4SPufnZYsz7t4q-yZA", "title": "إمارات ماث / UAE MATH", "tags": ["math", "AE", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCWXakWOuinjMSNGm_kYevug", "title": "دروس رياضيات ماث اون لاين", "tags": ["math", "AE", "KW", "BH", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCgw7XYhVkpw_4d1fXWdMKxw", "title": "Mr Tarek Ali - معلم الرياضيات", "tags": ["math", "AE", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  4c. GCC REGIONAL — Science (covers AE, KW, BH)
    # =========================================================================
    {"channel_id": "UCZVh0-57dFf7LpPLc0deeZw", "title": "المهدي أكاديمي المناهج الإماراتية", "tags": ["math", "science", "AE", "SA", "KW", "BH", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCQa22ky3r6YzT4xXyRDoKuQ", "title": "المدرس El-Modares", "tags": ["science", "KW", "BH", "AE", "7", "8", "9"]},
    {"channel_id": "UCEWapQi3NHBRlmsMADbF03Q", "title": "معمل العلوم", "tags": ["science", "EG", "BH", "KW", "AE", "1", "2", "3", "4", "5", "6"]},
    {"channel_id": "UCdEDqR6adI7gXhPkS7AzBtg", "title": "مستر احمد هنداوي - علوم", "tags": ["science", "EG", "BH", "KW", "AE", "7", "8", "9"]},

    # =========================================================================
    #  4d. GCC REGIONAL — English (covers AE, KW, BH, SA)
    # =========================================================================
    {"channel_id": "UCSAewF2ML9auuQX3LIg5QoA", "title": "ISLAM TAGEN - English Teacher", "tags": ["english", "EG", "BH", "KW", "AE", "SA", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCPIe00cwzt9yPdZKCKa5GQQ", "title": "Sherif Ramadan English Teacher", "tags": ["english", "EG", "BH", "KW", "AE", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  4e. PAN-ARAB BACKBONE (fallback for BH, KW, AE, LB where local is thin)
    # =========================================================================
    {"channel_id": "UCsJwnIaPPlEJvnRS8uy2Ewg", "title": "Khan Academy Arabic", "tags": ["math", "science", "BH", "KW", "JO", "AE", "EG", "LB", "MA", "SA", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCzp10JVJ3AScSDANBTgbvlg", "title": "Madrasati - مدرستي", "tags": ["math", "science", "KW", "BH", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCnuOcLg6PsX201LmC1pS2zg", "title": "Let's Practice English | تعلم الانجليزية", "tags": ["english", "BH", "KW", "AE", "EG", "JO", "SA", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},

    # =========================================================================
    #  5. MOROCCO — Math/Science
    # =========================================================================
    {"channel_id": "UCRc03mAue8nIGLSMV4VWtbQ", "title": "Youssef Nejjari", "tags": ["math", "MA", "7", "8", "9"]},
    {"channel_id": "UCqNApt8CUzeR92CKm4nYuMg", "title": "الأستاذ نورالدين", "tags": ["math", "science", "MA", "7", "8", "9"]},

    # =========================================================================
    #  6. UK CURRICULUM — Math (KS1/KS2/KS3/GCSE)
    # =========================================================================
    {"channel_id": "UCPlwvN0w4qFSP1FllALB92w", "title": "Numberblocks", "tags": ["math", "UK", "1", "2", "3"]},
    {"channel_id": "UC4KN50fal7f45fx2DqG7ttg", "title": "BBC Teach", "tags": ["math", "science", "english", "UK", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCqu9Na4YBSijiwdDj1KpyRg", "title": "Corbett Maths", "tags": ["math", "UK", "7", "8", "9"]},
    {"channel_id": "UCaGEe4KXZrjou9kQx6ezG2w", "title": "Cognito", "tags": ["science", "math", "UK", "7", "8", "9"]},
    {"channel_id": "UCqbOeHaAUXw9Il7sBVG3_bw", "title": "Freesciencelessons", "tags": ["science", "UK", "7", "8", "9"]},

    # =========================================================================
    #  7. ENGLISH-LANGUAGE GLOBAL — Math (school-lesson channels)
    # =========================================================================
    {"channel_id": "UC4a-Gbdw7vOaccHmFo40b9g", "title": "Khan Academy", "tags": ["math", "science", "all_countries", "1", "2", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCr0EYcMdFU6_L0nCSGJw8hg", "title": "Math Antics", "tags": ["math", "all_countries", "1", "2", "3", "4", "5", "6"]},
    {"channel_id": "UCtBtcQJ8_jsrjPzb8i1tOsA", "title": "Mashup Math", "tags": ["math", "all_countries", "3", "4", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCfPyVJEBD7Di1YYjTdS2v8g", "title": "Homeschool Pop", "tags": ["math", "science", "english", "all_countries", "1", "2", "3", "4", "5"]},
    {"channel_id": "UCYO_jab_esuFRV4b17AJtAw", "title": "3Blue1Brown", "tags": ["math", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCBnZ16ahKA2DZ_T5W0FPUXg", "title": "Organic Chemistry Tutor", "tags": ["math", "science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UC4a0YlN1P7rcjGRjh0DCKIA", "title": "Professor Dave Explains", "tags": ["math", "science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UC9SPN6qaM0DB455-DrWAdpA", "title": "ProfRobBob", "tags": ["math", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCq0EGvLTyy-LLT1oUSO_0FQ", "title": "Eddie Woo", "tags": ["math", "all_countries", "7", "8", "9"]},

    # =========================================================================
    #  7. ENGLISH-LANGUAGE GLOBAL — Science
    # =========================================================================
    {"channel_id": "UCRFIPG2u1DxKLNuE3y2SjHA", "title": "SciShow Kids", "tags": ["science", "all_countries", "1", "2", "3", "4"]},
    {"channel_id": "UCPwiAPYRT1JCna3GYf-vkCg", "title": "Colossal Cranium", "tags": ["science", "all_countries", "3", "4", "5", "6"]},
    {"channel_id": "UCwyVRKfytvjSF6q5s7noKZQ", "title": "Mr DeMaio", "tags": ["science", "all_countries", "3", "4", "5", "6"]},
    {"channel_id": "UCQJDFI9j8UeNoqra37p5OkA", "title": "Operation Ouch", "tags": ["science", "UK", "all_countries", "1", "2", "3", "4", "5"]},
    {"channel_id": "UCxlJ45KjG4XVcQ_hd8j227A", "title": "Peekaboo Kidz", "tags": ["science", "all_countries", "3", "4", "5", "6"]},
    {"channel_id": "UCX6b17PVsYBQ0ip5gyeme-Q", "title": "CrashCourse", "tags": ["science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCsXVk37bltHxD1rDPwtNM8Q", "title": "Kurzgesagt", "tags": ["science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCUHW94eEFW7hkUMVaZz4eDg", "title": "MinutePhysics", "tags": ["science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCHnyfMqiRRG1u-2MsSQLbXA", "title": "Veritasium", "tags": ["science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCZYTClx2T1of7BRZ86-8fow", "title": "SciShow", "tags": ["science", "all_countries", "7", "8", "9"]},
    {"channel_id": "UCFhXFikryT4aFcLkLw2LBLA", "title": "NileRed", "tags": ["science", "all_countries", "7", "8", "9"]},

    # =========================================================================
    #  7. ENGLISH-LANGUAGE GLOBAL — English subject
    # =========================================================================
    {"channel_id": "UCGwA4GjY4nGMIYvaJiA0EGA", "title": "English SingSing", "tags": ["english", "all_countries", "1", "2", "3", "4"]},
    {"channel_id": "UCVcQH8A634mauPrGbWs7QlQ", "title": "Jack Hartmann Kids Music", "tags": ["english", "all_countries", "1", "2", "3"]},
    {"channel_id": "UCsooa4yRKGN_zEE8iknghZA", "title": "TED-Ed", "tags": ["english", "science", "all_countries", "5", "6", "7", "8", "9"]},
    {"channel_id": "UCz4tgANd4yy8Oe0iXCdSWfA", "title": "English with Lucy", "tags": ["english", "UK", "all_countries", "7", "8", "9"]},
]


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
