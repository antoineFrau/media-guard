---
name: MediaGuard Hackathon Video Plan
overview: A structured plan for creating a 2-minute hackathon demo video covering the problem, solution, live demo flow, and key messages for the jury.
todos: []
isProject: false
---

# MediaGuard Hackathon Demo Video Plan

## 1. Key Messages for the Jury (30 seconds total)

**Problem:** Propaganda and rhetorical manipulation in online media undermine public discourse. Viewers often lack tools to spot manipulation techniques while watching.

**Solution:** MediaGuard is an LLM-powered system that detects 14 manipulation techniques (appeal to authority, fear-mongering, loaded language, etc.) in video transcripts in real time, with direct integration on YouTube via a Firefox extension.

**Differentiators:**

- **Academic grounding**: Technique definitions aligned with SemEval-2020 Task 11 and PropaInsight (COLING 2025); benchmarked at 57.8% F1 on a 50-item gold-annotated set
- **Non-intrusive UX**: Segment markers on the timeline (SponsorBlock-style) + contextual overlay when playback enters a manipulation segment
- **Crowdsourced improvement**: Users can add context; Mistral augments annotations for future viewers
- **Privacy-conscious**: BYOK (Bring Your Own Key); no key stored on server

---

## 2. Suggested Video Structure (2 minutes)


| Section                  | Duration  | Content                                                                                                                                                                                      |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hook + Problem**       | 0:00-0:20 | One sentence: "How often do you spot manipulation in the videos you watch?" Quick montage of news/political clips. State the problem: propaganda techniques are hard to detect in real time. |
| **Solution intro**       | 0:20-0:35 | "MediaGuard uses an LLM to detect rhetorical manipulation techniques directly on YouTube." Show the extension icon, then cut to a YouTube page.                                              |
| **Live demo**            | 0:35-1:30 | Follow the [demo flow](#3-demo-flow) below. Focus on: loading analysis, segment bars on timeline, floating panel with technique + quote + explanation.                                       |
| **Fallback + community** | 1:30-1:45 | Brief mention: STT app for videos without captions; comment/improve for crowdsourced refinements.                                                                                            |
| **Tech + impact**        | 1:45-2:00 | One slide: "57.8% F1 on SemEval-aligned benchmark. Academic taxonomy. Firefox extension. Open for improvement."                                                                              |


---

## 3. Demo Flow (Recommended)

**Pre-record or prepare:**

- Pick a YouTube video with obvious manipulation (news clip, opinion piece, or political content). Videos with captions work best.
- Ensure the API is running (`npm run api:dev`), PostgreSQL is up, and the extension is loaded with a Mistral API key.
- Optional: Pre-analyze the video so the first run is fast (or show "Loading analysis..." briefly to prove it's live).

**Sequence:**

1. Open YouTube with the chosen video. Show the page before play.
2. Press play. Show "Loading analysis..." for a few seconds (or skip if pre-cached).
3. Analysis loads: **segment markers appear on the progress bar** (orange = manipulation, blue = fact-check). Point them out.
4. Seek or play into a segment. The **floating panel** appears with:
  - Technique name (e.g., "Appeal to Fear / Prejudice")
  - Quoted excerpt
  - Explanation
5. Hover over another segment bar; show that each bar has a label (technique or claim).
6. Optional: Show the STT app for a video without captions (Tab audio capture → transcription → auto-analyze after 1 min).
7. Optional: Click "Add context" on a segment, type a short comment, submit — show crowdsourced improvement.

---

## 4. What to Show vs. What to Mention

**Must show (visual impact):**

- Segment markers on the YouTube progress bar
- Floating panel appearing when playback enters a manipulation segment
- At least one clear technique (e.g., appeal to fear, loaded language) with quote and explanation

**Can mention without deep demo:**

- STT app (Tab audio capture for videos without captions)
- Comment/improve flow
- Skill generator pipeline (YouTube → Mistral → SemEval-aligned skills)
- Benchmark (57.8% F1)

---

## 5. Video Ideas for Maximum Impact

**Option A — "Before / After"**

- Split screen: left = raw YouTube, right = same video with MediaGuard overlay. Emphasize how the overlay surfaces manipulation the viewer might miss.

**Option B — "Live walkthrough"**

- Single take: you narrate while demonstrating. Most authentic; shows the product works in real time.

**Option C — "Problem → Solution → Demo"**

- 20s problem setup, 15s solution pitch, 75s demo, 10s wrap-up. Classic hackathon format.

**Recommendation:** Option C with a prepared video that has strong manipulation examples. Rehearse the demo once so transitions are smooth; if something fails, have a short backup clip.

---

## 6. Preparation Checklist

- Choose 1–2 demo videos with clear manipulation (news / political content)
- Pre-analyze them (`GET /video/{videoId}/analysis`) so the first load is instant, or accept a short "Loading" state
- Ensure extension popup has Mistral API key; API base URL points to your running instance
- Test the overlay: floating panel, segment bars, and time-based display all working
- Prepare a one-slide "Tech + impact" image for the final 15 seconds
- Record in 1080p; keep audio clear (avoid echo if screen-sharing)

---

## 7. One-Liner for the Jury

> "MediaGuard is a Firefox extension that uses an LLM to detect propaganda techniques in YouTube videos in real time, with an academic taxonomy (SemEval) and crowdsourced improvement."

