<div align="center">
  <img src="logov5.svg" alt="MediaGuard" width="128" height="128" />
</div>

# MediaGuard

[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.0-2D3748.svg)](https://www.prisma.io/)
[![Mistral](https://img.shields.io/badge/LLM-Mistral-orange.svg)](https://mistral.ai/)
[![Benchmark F1](https://img.shields.io/badge/Span%20F1-64.2%25-success.svg)](/docs/CONCLUSION.md)
[![LLM Judge](https://img.shields.io/badge/LLM%20Judge-70.0%25-success.svg)](/docs/CONCLUSION.md)

> LLM-based detection of rhetorical manipulation techniques in video transcripts and news text.

---

## Research & Papers

MediaGuard builds on the following academic work:

| Paper | Venue | Role |
|-------|-------|------|
| [**PRTA**](https://aclanthology.org/2020.acl-demos.32/) — A System to Support the Analysis of Propaganda Techniques in the News | ACL 2020 | Base definitions, Tanbih framework |
| [**SemEval-2020 Task 11**](https://aclanthology.org/2020.semeval-1.186/) — Detection of Propaganda Techniques in News Articles | SemEval 2020 | 14-technique taxonomy, span identification |
| [**PropaInsight**](https://aclanthology.org/2025.coling-main.376/) — Toward Deeper Understanding of Propaganda in Terms of Techniques, Appeals, and Intent | COLING 2025 | Appeals, intent, common confusions enrichment |

See [docs/CONCLUSION.md](docs/CONCLUSION.md) for full methodology, evaluation protocol, and benchmark results.

---

## Components

- **API** — Backend for analysis, annotations, and crowdsourced improvements
- **Browser Extension** — YouTube video analysis and fact-check overlays (Chrome, Firefox)
- **STT App** — Real-time speech-to-text with Mic/Tab capture
- **Skill Generator** — Dataset-backed manipulation technique definitions (PRTA + SemEval + PropaInsight)

---

## MediaGuard API

Backend for MediaGuard: video analysis (manipulation + fact-check detection), annotations, and crowdsourced improvements via Mistral AI.

## Stack

- **Database**: PostgreSQL (Docker Compose)
- **ORM**: Prisma
- **API**: Node.js + Hono

## Quick Start

```bash
# 1. Start PostgreSQL (and optionally Langfuse for tracing)
docker compose up -d

# 2. Run migrations
npm run db:migrate

# 3. Seed fake data
npm run db:seed

# 4. Start API
npm run api:dev
```

API runs at `http://localhost:3000`.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/video/:videoId/analysis` | GET | Cached analysis or fetch transcript → Mistral → store |
| `/analyze` | POST | Client-supplied transcript → Mistral → store |
| `/annotations/:videoId` | GET | Annotations for a video |
| `/comment/improve` | POST | User comment → Mistral augmentation → update |

## Environment

Create `.env` in project root:

```
DATABASE_URL="postgresql://mediaguard:mediaguard@localhost:5432/mediaguard"
```

Optional: `MISTRAL_API_KEY` for server-side analysis. Otherwise send `X-Mistral-API-Key` header per request (BYOK).

For Langfuse tracing: `LANGFUSE_SECRET_KEY` (and optionally `LANGFUSE_PUBLIC_KEY`). When set, each `/analyze` and `/video/:id/analysis` request is traced with Mistral generations. Run `docker compose up -d` to start self-hosted Langfuse at http://localhost:3100.

## Seeded Data

After `npm run db:seed`, test with:

- `GET /video/dQw4w9WgXcQ/analysis`
- `GET /video/jNQXAC9IVRw/analysis`
- `GET /annotations/dQw4w9WgXcQ`

## Skill Generator (scripts/skill-generator)

Standalone script that builds a database of manipulation techniques from Clément Viktorovitch's YouTube channel (@Clemovitch):

1. Fetches the last N videos and their transcripts (via youtubei.js)
2. Extracts manipulation techniques with Mistral
3. Finds supporting research via Semantic Scholar
4. Generates SKILL.md files for each technique
5. Writes `output/problems.json` and `output/skills/{slug}/SKILL.md`

**Usage:**

```bash
cd scripts/skill-generator
cp .env.example .env   # Add MISTRAL_API_KEY
npm run generate       # Default: last 10 videos
npm run generate -- --last=5   # Custom count
```

From project root:

```bash
npm run skill:generate -- --last=5
npm run skill:generate -- --fetch-only --last=2   # Test YouTube fetch without Mistral
```

**Environment:** `MISTRAL_API_KEY` (required), `S2_API_KEY` (optional, for higher Semantic Scholar rate limits)

**Troubleshooting:**
- If "No videos found on channel", set `MEDIAGUARD_VIDEO_IDS=id1,id2,id3` to use specific video IDs (bypasses channel fetch).
- Transcripts use the internal `get_transcript` API (from [mcp-server-youtube-transcript](https://github.com/kimtaeyoon83/mcp-server-youtube-transcript)) — more reliable than youtubei.js for captions.

## STT App

Standalone web app for real-time speech-to-text. Options: **ElevenLabs** (cloud), **Mistral Voxtral** (cloud via API proxy), or **Moshi** (offline WASM). Captures mic or tab audio, transcribes in real time, then sends to MediaGuard API for analysis.

**Prerequisites:** Rust, `wasm32-unknown-unknown`, `wasm-bindgen-cli` (see [wasm-speech-streaming](https://github.com/lucky-bai/wasm-speech-streaming#prerequisites)).

```bash
npm run stt:build    # Build WASM (one-time, requires Rust)
npm run stt:serve    # Serve at http://localhost:8000
```

Open http://localhost:8000. Choose Mic or Tab audio, start transcription, then click **Analyze with MediaGuard** to detect manipulation techniques. Requires Mistral API key and API running at http://localhost:3000.
