---
name: MediaGuard API and Database
overview: "Implement the MediaGuard backend: Docker Compose + PostgreSQL, Prisma ORM, Node.js API (Hono), YouTube transcript fetching and Mistral integration. Includes seed data for local testing. No Supabase; Firefox extension handled in a separate plan."
todos:
  - id: docker-compose
    content: Add docker-compose.yml with PostgreSQL
    status: completed
  - id: prisma-schema
    content: Define Prisma schema (video_analyses, annotations, annotation_comments)
    status: completed
  - id: prisma-seed
    content: Create Prisma seed script with fake data
    status: completed
  - id: api-setup
    content: Scaffold Node.js API with Hono, Prisma client, CORS
    status: completed
  - id: youtube-transcript
    content: Implement YouTube Innertube transcript fetcher
    status: completed
  - id: mistral-integration
    content: Implement Mistral client and system prompt for analysis
    status: completed
  - id: video-analysis-endpoint
    content: Implement GET /video/:videoId/analysis (cache + fetch + analyze)
    status: completed
  - id: analyze-endpoint
    content: Implement POST /analyze for client-supplied transcript
    status: completed
  - id: annotations-endpoint
    content: Implement GET /annotations/:videoId
    status: completed
  - id: comment-improve-endpoint
    content: Implement POST /comment/improve with Mistral augmentation
    status: completed
isProject: false
---

# MediaGuard — API and Database Implementation Plan

This plan covers **only** the backend: Docker Compose + PostgreSQL, Prisma ORM, and Node.js API. No Supabase. The Firefox extension is handled in a separate plan.

**Stack**: Docker Compose (PostgreSQL) + Prisma + Node.js (Hono)

---

## Architecture (Backend Only)

```mermaid
flowchart TB
    subgraph Client [Extension - Out of Scope]
        Ext[Firefox Extension]
    end
    
    subgraph API [Node.js API - Hono]
        VideoEndpoint["GET /video/:id/analysis"]
        AnalyzeEndpoint["POST /analyze"]
        AnnotationsEndpoint["GET /annotations/:videoId"]
        CommentEndpoint["POST /comment/improve"]
    end
    
    subgraph Internal [External APIs]
        YouTube[YouTube Innertube API]
        Mistral[Mistral API]
    end
    
    subgraph Docker [Docker Compose]
        subgraph DB [PostgreSQL]
            Analyses[(video_analyses)]
            Annotations[(annotations)]
            Comments[(annotation_comments)]
        end
    end
    
    Ext -.->|"future"| VideoEndpoint
    VideoEndpoint -->|Prisma| DB
    VideoEndpoint -->|cache miss| YouTube
    VideoEndpoint -->|analyze| Mistral
    VideoEndpoint -->|store| DB
    Ext -.->|"future"| AnalyzeEndpoint
    AnalyzeEndpoint --> Mistral
    AnalyzeEndpoint --> DB
    Ext -.->|"future"| AnnotationsEndpoint
    AnnotationsEndpoint --> DB
    Ext -.->|"future"| CommentEndpoint
    CommentEndpoint --> Mistral
    CommentEndpoint --> DB
```



---

## Project Structure (Backend Only)

```
media-guard/
├── package.json                 # Root: pnpm workspace, prisma scripts
├── api/                         # Node.js API (Hono)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # Hono app, CORS, Prisma client
│       ├── routes/
│       │   ├── video.ts         # GET /video/:videoId/analysis
│       │   ├── analyze.ts       # POST /analyze
│       │   ├── annotations.ts   # GET /annotations/:videoId
│       │   └── comment.ts       # POST /comment/improve
│       ├── lib/
│       │   ├── youtube-transcript.ts
│       │   ├── mistral.ts
│       │   └── types.ts
│       └── prompts/
│           └── mistral-system.ts
├── prisma/
│   ├── schema.prisma            # Prisma schema
│   └── seed.ts                  # Fake data for local testing
├── docker-compose.yml           # PostgreSQL
└── README.md
```

---

## 1. Docker Compose and Database

### Docker Compose

**[docker-compose.yml](docker-compose.yml)**

- PostgreSQL 16 (or 15) on port `5432`
- Environment: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB=mediaguard`
- Volume for data persistence
- Health check so API can wait for DB

**Usage**: `docker compose up -d` then `pnpm prisma migrate dev` and `pnpm prisma db seed`

---

## 2. Prisma Schema

### Models

**[prisma/schema.prisma](prisma/schema.prisma)**

- `**VideoAnalysis`**: Cached analysis per video
  - `id` (uuid), `videoId` (unique), `transcriptHash`, `alerts` (Json), `factChecks` (Json), `createdAt`
- `**Annotation`**: User-improved segments
  - `id`, `videoId`, `timestampStart`, `timestampEnd`, `type` (enum: `MANIPULATION` | `FACT_CHECK`), `content`, `explanation`, `sources` (Json), `userComments` (Json), `version`, `createdAt`, `updatedAt`
- `**AnnotationComment`**: User comments and Mistral-improved content
  - `id`, `annotationId` (FK), `userContent`, `mistralImprovedContent` (Json), `status` (enum: `PENDING` | `APPLIED` | `REJECTED`), `createdAt`

### Connection

- `DATABASE_URL` in `.env`: `postgresql://mediaguard:mediaguard@localhost:5432/mediaguard`

---

## 3. Prisma Seed (Fake Data)

**[prisma/seed.ts](prisma/seed.ts)**

- At least 2 `VideoAnalysis` rows with realistic `alerts` and `fact_checks` JSON
- Corresponding `Annotation` rows for those analyses
- 1–2 `AnnotationComment` rows to test the improve flow
- Use consistent `videoId`s (e.g. `dQw4w9WgXcQ`, `jNQXAC9IVRw`) so endpoints work immediately with seed data

**Example seed**: One video with rhetorical manipulation + one fact-check; annotations with start/end; one applied comment.

**Config**: In root `package.json`, add `"prisma": { "seed": "tsx prisma/seed.ts" }` (or `ts-node`).

**Run**: `pnpm prisma db seed`

---

## 4. API Endpoints


| Endpoint                   | Method | Purpose                                                                                                  |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `/video/:videoId/analysis` | GET    | Return cached analysis or fetch transcript → Mistral → store → return                                    |
| `/analyze`                 | POST   | Receive transcript + `mistral_api_key` from client (e.g. ElevenLabs fallback) → Mistral → store → return |
| `/annotations/:videoId`    | GET    | Return annotations (merged from analysis + user-improved) for video                                      |
| `/comment/improve`         | POST   | User comment + annotation ID → Mistral augmentation → update DB                                          |


### CORS

- Allow `*` or specific origins for extension; support `OPTIONS` preflight.

---

## 5. Implementation Details

### 5.1 GET /video/:videoId/analysis

1. Query `VideoAnalysis` by `videoId` via Prisma.
2. **If found**: Return JSON (see contract below).
3. **If not found**:
  - Fetch transcript via YouTube Innertube API (see 5.3).
  - If no transcript: return `404` with `{ "reason": "no_transcript" }`.
  - Call Mistral with transcript + `mistral_api_key` (from `X-Mistral-API-Key` header).
  - Create `VideoAnalysis` and `Annotation` rows via Prisma.
  - Return analysis JSON.

**Note**: `mistral_api_key` must be passed by the client per request (BYOK). Client sends `X-Mistral-API-Key` header on GET when triggering analysis.

### 5.2 POST /analyze

- **Request body**: `{ video_id, transcript: [{ text, start, end }], mistral_api_key }`
- Used when transcript comes from client (e.g. ElevenLabs in extension).
- Same Mistral + Prisma store flow as above.
- Return analysis JSON or `404`/`500` with `{ "reason": "..." }`.

### 5.3 YouTube Transcript Fetcher

- **File**: [api/src/lib/youtube-transcript.ts](api/src/lib/youtube-transcript.ts)
- `POST https://www.youtube.com/youtubei/v1/player` with `videoId`; extract caption track URL from response.
- Fetch caption (XML or JSON3), parse to `{ text, start, end }[]`.
- Set `User-Agent` and minimal headers (no API key).
- Handle "no captions available" and parse errors.

### 5.4 Mistral Integration

- **File**: [api/src/lib/mistral.ts](api/src/lib/mistral.ts)
- System prompt: manipulation detection + fact-check (rhetoric, bias, unsourced claims).
- Structured JSON output: `{ alerts: [{ type, technique, quote, explanation, severity, start, end }], fact_checks: [{ claim, verdict, context, sources, start, end }] }`.
- Use Mistral structured output or JSON mode. Validate response shape.

### 5.5 POST /comment/improve

- **Request**: `{ video_id, annotation_id, timestamp_start, user_comment, current_content? }`
- Load annotation from DB via Prisma.
- Mistral prompt: "Current fact-check: {content}. User adds: {comment}. Improve or augment. Return updated JSON."
- Update `Annotation` (content, explanation, sources, version).
- Create `AnnotationComment` row.
- Return updated annotation object.

### 5.6 Prisma Client

- Single `PrismaClient` instance in [api/src/index.ts](api/src/index.ts).
- `DATABASE_URL` from `process.env` (via `.env`).

---

## 6. API Contracts

### GET /video/:videoId/analysis — Success

```json
{
  "video_id": "abc123",
  "alerts": [
    {
      "type": "rhetorical_manipulation",
      "technique": "Appeal to Fear",
      "quote": "If we don't act now...",
      "explanation": "...",
      "severity": "medium",
      "start": 120.5,
      "end": 135.2
    }
  ],
  "fact_checks": [
    {
      "claim": "Crime increased 500%",
      "verdict": "misleading",
      "context": "...",
      "sources": ["https://..."],
      "start": 200,
      "end": 210
    }
  ]
}
```

### GET /video/:videoId/analysis — Error

- `404`: `{ "reason": "no_transcript" }` or `{ "reason": "analysis_failed" }`

### POST /comment/improve — Request

```json
{
  "video_id": "abc123",
  "annotation_id": "uuid",
  "timestamp_start": 120,
  "user_comment": "INSEE data shows different: https://...",
  "current_content": "..."
}
```

### POST /comment/improve — Response

- Updated annotation object (same shape as annotation row).

---

## 7. Environment and Secrets

- `**.env**` (root or `api/`): `DATABASE_URL=postgresql://mediaguard:mediaguard@localhost:5432/mediaguard`
- **Optional**: `MISTRAL_API_KEY` for server-side fallback; otherwise key comes from client header per request.

---

## 8. Local Development Workflow

1. `docker compose up -d` — start PostgreSQL
2. `pnpm prisma migrate dev` — run migrations
3. `pnpm prisma db seed` — load fake data
4. `pnpm --filter api dev` (or `cd api && pnpm dev`) — start Hono API
5. Test endpoints with curl/Postman (e.g. `GET /video/dQw4w9WgXcQ/analysis` if seeded)

---

## 9. Out of Scope (Firefox Plan)

- Manifest, popup, content scripts, background service worker
- Segment overlay, progress bar markers, floating panel
- ElevenLabs audio capture in extension
- Comment UI in extension
- API key storage in `browser.storage.local`

