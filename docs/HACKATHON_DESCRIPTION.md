# MediaGuard — Hackathon Project Description

**Tagline:** AI-powered media literacy layer for YouTube — detect propaganda and rhetorical manipulation in real time.

---

## Problem

Propaganda and rhetorical manipulation in online videos undermine public discourse. Techniques like appeal to fear, loaded language, straw man arguments, and appeal to authority are hard to spot in real time. Viewers often lack tools to detect manipulation while watching.

---

## Solution

**MediaGuard** is a Firefox (and Chrome-compatible) browser extension that uses **Mistral AI** to detect 14 rhetorical manipulation techniques from an academic taxonomy — **in real time** — directly on YouTube. SponsorBlock-style segment markers on the progress bar, contextual overlays when you play into a segment.

---

## What We Built

### Browser Extension

- Segment markers on the YouTube progress bar: **orange** = manipulation techniques, **blue** = fact-checks
- **Floating panel** on hover or when playback enters a segment: technique name, quoted excerpt, explanation
- **Crowdsourced improvement:** users can add context; Mistral augments annotations for future viewers
- Vote up/down on annotations
- Works with Tab audio capture for videos without captions (via the STT app)

### Landing Page

- Hero, demo video, how it works, technique examples, install flow
- Deployed to GitHub Pages

### STT App (for videos without captions)

- Captures **mic** or **tab audio** in real time
- Three transcription options: **ElevenLabs** (cloud), **Mistral Voxtral** (cloud), **Moshi** (local WASM — fully offline, no audio leaves your machine)
- Transcript goes to MediaGuard for analysis — same segment markers and overlays

### Backend

- Fetches YouTube transcripts, analyzes with Mistral, caches results
- Annotations, votes, crowdsourced improvements
- Bring Your Own Key — no keys stored on the server

### SKILL.md — Taxonomy-Driven Technique Definitions

- Each technique has a **SKILL.md** file: definition, "How to recognize it", examples, research citations
- **Generation:** Skills are generated from the academic taxonomy (PRTA + SemEval PTC examples + PropaInsight appeals/intent/confusions). Mistral produces one SKILL.md per technique with aligned slugs
- **Usage:** The API loads these skills and injects them into the Mistral prompt as context. The LLM uses them to identify manipulation spans and output technique names in the transcript
- **Two flows:** YouTube flow (extract from Clément Viktorovitch transcripts) or dataset flow (multi-source from SemEval + PropaInsight); the dataset flow yields better accuracy on the benchmark

### Research & Evaluation

- Technique definitions from PRTA (ACL 2020), SemEval-2020 Task 11, PropaInsight (COLING 2025)
- Evaluated on a 50-item benchmark: **64.2% span F1**, **70.0% LLM judge score**
- Academic taxonomy, not ad-hoc

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|--------------|
| `/video/:videoId/analysis` | GET | Cached analysis or fetch transcript → Mistral → store. Returns alerts + fact-checks. Requires `X-Mistral-API-Key` on cache miss. |
| `/analyze` | POST | Client-supplied transcript (video_id, transcript). Mistral analysis → store. Supports ElevenLabs, Mistral Voxtral, and local Moshi sources. |
| `/annotations/:videoId` | GET | Annotations for a video (manipulation + fact-check). Optional `client_id` query for user vote. |
| `/annotations/:id/vote` | POST | Vote up/down on an annotation. Body: `{ vote: "up" or "down", client_id }`. |
| `/comment/improve` | POST | User comment on an annotation → Mistral augments content → update. Body: `{ annotation_id, user_comment }`. |
| `/stt/mistral-stream` | WebSocket | Real-time Mistral Voxtral transcription streaming. |
| `/stt/elevenlabs-token` | GET/POST | ElevenLabs single-use token for real-time transcription (STT app). |

---

## Key Differentiators

- **Academic grounding** — SemEval-2020 + PropaInsight, not made-up categories
- **Non-intrusive UX** — SponsorBlock-style bars, floating panel
- **Privacy-conscious** — BYOK, Moshi for fully offline STT
- **STT options** — ElevenLabs, Mistral Voxtral, or local Moshi
- **Crowdsourced improvement** — users add context, Mistral augments

---

## Techniques We Detect (14 total)

Appeal to Authority • Appeal to Fear/Prejudice • Loaded Language • Black-and-White Fallacy • Bandwagon / Reductio ad Hitlerum • Slogans • Name-Calling • Repetition • Doubt • Flag-Waving • Causal Oversimplification • Exaggeration/Minimisation • Thought-terminating Cliches • Whataboutism / Straw Men / Red Herring

---

## One-Liner for the Jury

> **MediaGuard** is a Firefox extension that uses Mistral AI to detect propaganda techniques in YouTube videos in real time — with an academic taxonomy, crowdsourced improvement, and speech-to-text for videos without captions (ElevenLabs, Mistral Voxtral, or local Moshi).
