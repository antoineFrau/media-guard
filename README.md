# MediaGuard API

Backend for MediaGuard: video analysis (manipulation + fact-check detection), annotations, and crowdsourced improvements via Mistral AI.

## Stack

- **Database**: PostgreSQL (Docker Compose)
- **ORM**: Prisma
- **API**: Node.js + Hono

## Quick Start

```bash
# 1. Start PostgreSQL
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

**Environment:** `MISTRAL_API_KEY` (required), `S2_API_KEY` (optional, for higher Semantic Scholar rate limits)
