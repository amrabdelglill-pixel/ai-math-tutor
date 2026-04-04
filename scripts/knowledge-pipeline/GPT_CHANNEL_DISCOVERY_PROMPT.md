# GPT Prompt: Zeluu YouTube Channel Discovery

Use this prompt with ChatGPT (with web browsing enabled) to discover more educational YouTube channels for the Zeluu knowledge base. Run it once per region to fill gaps.

---

## THE PROMPT

```
You are helping me build a curated database of educational YouTube channels for an AI math tutoring platform called Zeluu. The platform serves students in grades 1-9 across the UK and GCC/MENA region (Bahrain, Kuwait, Jordan, Lebanon, Morocco, UAE, Egypt).

I need you to find YouTube channels that meet these criteria:
- Teach math, science, or English
- Target students in grades 1-9 (ages 6-15)
- Have at least 10,000 subscribers
- Have uploaded at least 50 videos
- Are actively uploading (last video within 6 months)
- Have English OR Arabic content

## COVERAGE TARGET

I need AT LEAST 5 channels per cell in this matrix:

| | Math | Science | English |
|---|---|---|---|
| Grades 1-3 (EN) | 5+ channels | 5+ channels | 5+ channels |
| Grades 4-6 (EN) | 5+ channels | 5+ channels | 5+ channels |
| Grades 7-9 (EN) | 5+ channels | 5+ channels | 5+ channels |
| Grades 1-3 (AR) | 5+ channels | 5+ channels | 5+ channels |
| Grades 4-6 (AR) | 5+ channels | 5+ channels | 5+ channels |
| Grades 7-9 (AR) | 5+ channels | 5+ channels | 5+ channels |

Plus country-specific channels:
| Country | Min channels |
|---|---|
| Bahrain (BH) | 5 |
| Kuwait (KW) | 5 |
| Jordan (JO) | 5 |
| Lebanon (LB) | 5 |
| Morocco (MA) | 5 |
| UAE (AE) | 5 |
| Egypt (EG) | 10 (largest market) |
| UK | 10 (English curriculum) |

## CHANNELS I ALREADY HAVE (DO NOT REPEAT)

### English-language channels:
- Khan Academy (UC4a-Gbdw7vOaccHmFo40b9g)
- Math Antics (UCr0EYcMdFU6_L0nCSGJw8hg)
- Numberblocks (UCPlwvN0w4qFSP1FllALB92w)
- Homeschool Pop (UCfPyVJEBD7Di1YYjTdS2v8g)
- Mashup Math (UCtBtcQJ8_jsrjPzb8i1tOsA)
- 3Blue1Brown (UCYO_jab_esuFRV4b17AJtAw)
- Organic Chemistry Tutor (UCBnZ16ahKA2DZ_T5W0FPUXg)
- Professor Dave Explains (UC4a0YlN1P7rcjGRjh0DCKIA)
- ProfRobBob (UC9SPN6qaM0DB455-DrWAdpA)
- Eddie Woo (UCq0EGvLTyy-LLT1oUSO_0FQ)
- SciShow Kids (UCRFIPG2u1DxKLNuE3y2SjHA)
- Colossal Cranium (UCPwiAPYRT1JCna3GYf-vkCg)
- Mr DeMaio (UCwyVRKfytvjSF6q5s7noKZQ)
- Operation Ouch (UCQJDFI9j8UeNoqra37p5OkA)
- Peekaboo Kidz (UCxlJ45KjG4XVcQ_hd8j227A)
- CrashCourse (UCX6b17PVsYBQ0ip5gyeme-Q)
- Kurzgesagt (UCsXVk37bltHxD1rDPwtNM8Q)
- MinutePhysics (UCUHW94eEFW7hkUMVaZz4eDg)
- Veritasium (UCHnyfMqiRRG1u-2MsSQLbXA)
- SciShow (UCZYTClx2T1of7BRZ86-8fow)
- NileRed (UCFhXFikryT4aFcLkLw2LBLA)
- Cognito (UCaGEe4KXZrjou9kQx6ezG2w)
- Freesciencelessons (UCqbOeHaAUXw9Il7sBVG3_bw)
- Corbett Maths (UCqu9Na4YBSijiwdDj1KpyRg)
- BBC Teach (UC4KN50fal7f45fx2DqG7ttg)
- English SingSing (UCGwA4GjY4nGMIYvaJiA0EGA)
- Jack Hartmann Kids Music (UCVcQH8A634mauPrGbWs7QlQ)
- TED-Ed (UCsooa4yRKGN_zEE8iknghZA)
- English with Lucy (UCz4tgANd4yy8Oe0iXCdSWfA)

### Arabic-language channels:
- Khan Academy Arabic (UCsJwnIaPPlEJvnRS8uy2Ewg)
- Nafham - نفهم (UC2OJM3-_FMVBMdm2dHN4bVQ)
- Droos Online (UCkw4JCwteGrDHIsyIIKo4tQ)
- Mohamed El Deeb (UC7bmnKMxLfFxEi6KHXkEV9w)
- Mustafa Mounir (UCaxGPRhFkSJRxpoHi-HBvmg)
- Mohamed Khaled Elbakary (UC5g9WjBfj3vy_zTlyM_orAg)
- Youssef Nejjari (UCRc03mAue8nIGLSMV4VWtbQ)
- الأستاذ نورالدين (UCqNApt8CUzeR92CKm4nYuMg)
- Madrasati مدرستي (UCzp10JVJ3AScSDANBTgbvlg)
- Abwaab أبواب (UCd2R4lOnXC7aTRGNMbJPK3A)
- Let's Practice English (UCnuOcLg6PsX201LmC1pS2zg)
- Ms.Bassant Ahmed (UCX5bU7eGKzlY-VyfcvA5EWA)
- Teacher Aya (UCEc7koXK6HY4aOhw7u3N9Xg)
- مستر انجليزى (UClkf2zTnLqFJeYlrRpKnl3w)
- عبقري لغة (UCr8ww_CG194ATkyyyYFcIjQ)

## OUTPUT FORMAT

For EACH channel you find, provide this exact JSON format:

```json
{"channel_id": "UCxxxxxxxxxxxxxxxxxx", "title": "Channel Name", "tags": ["subject", "COUNTRY_CODE", "grade1", "grade2", ...]}
```

Rules for tags:
- Subjects: "math", "science", "english" (can have multiple)
- Country codes: "BH", "KW", "JO", "LB", "MA", "AE", "EG", "UK", "all_countries"
- Grades: "1" through "9" (list each applicable grade)

## SEARCH STRATEGY

For each gap in the matrix, search YouTube using these queries:

**Arabic channels per country:**
- "شرح رياضيات الصف [الأول-التاسع] [country_name_ar]"
- "دروس علوم [grade] [country]"
- "تعلم انجليزي للأطفال [country]"
- "منهج [country] رياضيات"

**English channels per grade band:**
- "math for grade [X] explained"
- "science experiments for kids grade [X]"
- "english grammar lessons grade [X]"

**UK curriculum:**
- "KS1 maths explained"
- "KS2 science lessons"
- "KS3 english revision"
- "GCSE maths tutorial"

**Country-specific searches:**
- Bahrain: "منهج البحرين", "تعليم البحرين"
- Kuwait: "منهج الكويت", "تعليم الكويت"
- Jordan: "منهج أردني", "توجيهي رياضيات"
- Lebanon: "منهج لبناني", "brevet libanais maths"
- Morocco: "cours maths maroc", "الرياضيات المغرب"
- UAE: "منهج الإمارات", "MOE UAE curriculum"
- Egypt: "منهج مصري", "الترم الأول رياضيات"

## IMPORTANT

1. VERIFY each channel ID by navigating to youtube.com/channel/[ID] — the ID must start with "UC" and be exactly 24 characters
2. Do NOT include channels that are primarily entertainment or nursery rhymes (e.g., ChuChu TV, Cocomelon)
3. Prioritize channels with clear, structured lessons over vlogs or reaction content
4. For Arabic channels, note which dialect/country curriculum they follow
5. Return ONLY channels not already in my list above
```

---

## HOW TO USE

1. Copy the prompt above into ChatGPT (GPT-4 with browsing)
2. Run it once — it will return 30-50 new channels
3. Copy the JSON output
4. Paste it into `config.py` under `SEED_CHANNELS`
5. Run the pipeline: `python3 download_local.py`

For best results, run the prompt in batches by region:
- Run 1: Focus on "Find me 10+ channels for Egypt curriculum"
- Run 2: Focus on "Find me 5+ channels per GCC country"
- Run 3: Focus on "Find me 10+ UK curriculum channels"
- Run 4: Focus on "Fill gaps in science grades 1-6 Arabic"
