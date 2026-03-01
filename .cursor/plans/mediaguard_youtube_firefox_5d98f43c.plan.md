---
name: MediaGuard YouTube Firefox
overview: Implement MediaGuard as a Firefox extension for YouTube that fetches or generates video analysis (manipulation/fact-check alerts), displays them as segment overlays on the video, and allows users to comment on problems to crowdsource improvements via Mistral.
todos: []
isProject: false
---

# *MediaGuard — YouTube + Firefox Implementation Plan*

## *Architecture Summary*

```mermaid
flowchart TB
    subgraph Extension [Firefox Extension]
        CS[Content Script]
        BG[Background Service Worker]
        Popup[Popup Settings]
        CS -->|video_id, play event| BG
        Popup -->|API keys storage| BG
    end
    
    subgraph Backend [Cloudflare Workers API]
        Analyze[/analyze]
        Video[/video/id/analysis]
        Annotate[/annotations]
        Comment[/comment/improve]
    end
    
    subgraph External [External APIs]
        YT[YouTube Innertube]
        Mistral[Mistral API]
    end
    
    subgraph DB [Supabase]
        Analyses[(video_analyses)]
        Annotations[(annotations)]
    end
    
    BG -->|GET analysis| Video
    Video -->|cache hit| DB
    Video -->|cache miss| Analyze
    Analyze -->|fetch transcript| YT
    Analyze -->|analyze| Mistral
    Analyze -->|store| DB
    
    CS -->|display segments| Overlay[Segment Overlay]
    CS -->|user comment| Comment
    Comment --> Mistral
    Comment -->|update| Annotations
```



---

## *1. Data Flow*

### *On Video Load*

1. *Content script detects YouTube watch page and extracts* `video_id` *from URL*
2. *On* `play` *event, extension asks backend:* `GET /video/{video_id}/analysis`
3. ***If cached**: Return immediately; extension renders segment markers on timeline + overlay panel*
4. ***If not cached**: Backend fetches YouTube transcript (Innertube API), calls Mistral with user's API key, stores result, returns*

### *Transcript Sources (Priority Order)*

- ***Primary**: YouTube captions via Innertube API (no user key, works for most videos)*
- ***Fallback**: ElevenLabs real-time transcription via extension (user's key) when video has no captions — implement in Phase 2*

### *Comment → Improvement Loop*

1. *User clicks a problem segment → expands to see details*
2. *User adds comment ("Here's a source: example.com/data")*
3. *Extension sends comment to* `POST /comment/improve`
4. *Backend sends to Mistral: current fact + user comment → Mistral augments/improves*
5. *Updated annotation stored in Supabase; other users see improved version*

---

## *2. Project Structure*

```
media-guard/
├── extension/                 # Firefox WebExtension
│   ├── manifest.json
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── content/
│   │   ├── content.js        # YouTube injection, overlay, segment display
│   │   └── overlay.css
│   ├── background/
│   │   └── service-worker.js # API calls, storage, message routing
│   └── lib/
│       └── youtube.js       # Video ID, player detection helpers
├── worker/                   # Cloudflare Worker
│   ├── wrangler.toml
│   ├── package.json
│   └── src/
│       ├── index.ts
│       ├── analyze.ts
│       ├── youtube-transcript.ts
│       └── mistral.ts
├── supabase/
│   └── migrations/
│       └── 001_initial.sql
└── README.md
```

---

## *3. Implementation Phases*

### *Phase 1: Backend + Extension Shell (Core MVP)*

***3.1 Supabase Schema***

- `video_analyses`*:* `video_id`*,* `transcript_hash`*,* `alerts` *(JSONB),* `fact_checks` *(JSONB),* `created_at`
- `annotations`*: For user-improved segments (*`video_id`*,* `timestamp_start`*,* `timestamp_end`*,* `type`*,* `content`*,* `explanation`*,* `sources`*,* `user_comments` *JSONB)*
- `annotation_comments`*:* `annotation_id`*,* `user_content`*,* `mistral_improved_content`*,* `status`

***3.2 Cloudflare Worker Endpoints***


| *Endpoint*                 | *Method* | *Purpose*                                                               |
| -------------------------- | -------- | ----------------------------------------------------------------------- |
| `/video/:videoId/analysis` | *GET*    | *Return cached analysis or trigger new analysis*                        |
| `/analyze`                 | *POST*   | *Internal: transcript +* `mistral_api_key` *→ Mistral → store → return* |
| `/annotations/:videoId`    | *GET*    | *Fetch annotations (including user-improved) for video*                 |
| `/comment/improve`         | *POST*   | *User comment + annotation ID → Mistral augmentation → update DB*       |


***3.3 YouTube Transcript Fetcher (Worker)***

- *Use Innertube API:* `POST https://www.youtube.com/youtubei/v1/player` *with* `videoId` *to get caption track URL*
- *Fetch caption XML/JSON3, parse to* `{ text, start, end }[]`
- *No API key required; may need* `User-Agent` *and minimal headers*

***3.4 Mistral Integration***

- *System prompt for manipulation detection + fact-check (rhetoric, bias, unsourced claims)*
- *Structured JSON output:* `{ alerts: [{ type, technique, quote, explanation, severity, start, end }], fact_checks: [...] }`
- *User provides Mistral API key in extension; sent only when analysis is needed (not stored)*

***3.5 Firefox Extension — Minimal***

- `manifest.json`*: Manifest V2 (Firefox) with* `content_scripts` *for* `*://www.youtube.com/watch`***
- *Popup: inputs for ElevenLabs key (for Phase 2) + Mistral key, save to* `browser.storage.local`
- *Background: on message from content script with* `video_id`*, call* `GET /video/{id}/analysis`*; if 404, optionally trigger analysis (POST with transcript from backend)*
- *Content script: wait for* `#movie_player video`*, extract* `video_id`*, listen to* `play`*, request analysis, render placeholder "Loading analysis..."*

---

### *Phase 2: Segment Overlay + Real-Time Analysis Path*

***4.1 Segment Display on Video***

- *Parse analysis response:* `alerts` *and* `fact_checks` *with* `start`*/`*end` (or `timestamp_start`*/*`timestamp_end`*)*
- *Render marker bars on the progress bar (similar to SponsorBlock): colored segments for* `manipulation`*,* `fact_check`*, etc.*
- *Floating panel (bottom or side): when playback enters a segment, show alert details (technique, quote, explanation)*
- *Use* `timeupdate` *on* `video` *to detect current segment and show/hide panel*

***4.2 ElevenLabs Fallback (Videos Without Captions)***

- *When backend returns "no transcript available", extension activates audio capture*
- *Use* `browser.tabCapture` *or equivalent for Firefox (check* `captureVisibleTab` *with audio, or* `getDisplayMedia`*)*
- *Stream audio to ElevenLabs Speech-to-Text WebSocket; buffer ~30s chunks*
- *Send transcript chunks to* `POST /analyze` *with* `mistral_api_key`*; backend runs Mistral and stores*
- *Display results as in 4.1*

---

### *Phase 3: Comment and Crowdsourced Improvement*

***5.1 Comment UI***

- *Each segment in the overlay has an "Add context / Report" button*
- *Modal or inline form: user types comment, submits*
- `POST /comment/improve`*:* `{ annotation_id, user_comment, video_id, timestamp }`

***5.2 Mistral Augmentation***

- *Worker receives comment; loads current annotation from DB*
- *Prompt: "Current fact-check: {content}. User adds: {comment}. Improve or augment this fact-check if the comment adds valid information. Return updated JSON."*
- *Store improved* `content`*/*`explanation`*/*`sources`*; increment confidence or version*
- *Optional: voting (upvote/downvote) for annotations*

---

### *Phase 4: Polish*

- *Error handling: no captions, Mistral errors, rate limits*
- *Landing page (Cloudflare Pages) with install instructions*
- *Privacy copy: BYOK, no key storage*

---

## *4. Key Technical Decisions*


| *Topic*             | *Decision*                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| *Transcript*        | *YouTube Innertube first; ElevenLabs only when no captions*                                                         |
| *API keys*          | *Stored in* `browser.storage.local`*; Mistral key sent per-request when analysis needed; never persisted on server* |
| *Caching*           | *Analysis by* `video_id`*; skip re-analysis if record exists*                                                       |
| *Firefox*           | *Manifest V2 for broader compatibility, or MV3 if supported (Firefox 109+)*                                         |
| *Overlay*           | *Append to* `#ytd-player`*, absolute positioning,* `z-index` *above controls*                                       |
| *Segment detection* | `video.currentTime` *vs* `[start, end]` *of each alert*                                                             |


---

## *5. API Contracts (Key Endpoints)*

### *GET* `/video/:videoId/analysis`

***Response (cached):***

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

***Response (no analysis):*** `404` *+* `{ "reason": "no_transcript" }` *or* `{ "reason": "analysis_failed" }`

### *POST* `/comment/improve`

***Request:***

```json
{
  "video_id": "abc123",
  "annotation_id": "uuid",
  "timestamp_start": 120,
  "user_comment": "INSEE data shows different: https://...",
  "current_content": "..."
}
```

***Response:** Updated annotation object*

---

## *6. Risks and Mitigations*

- ***Innertube API instability**: Undocumented; have ElevenLabs fallback*
- ***Firefox audio capture**:* `tabCapture` *may differ from Chrome; test early*
- ***Mistral rate limits**: BYOK spreads load; consider queue for high traffic*
- ***YouTube DOM changes**: Use stable selectors (*`#movie_player`*,* `#ytd-player`*); monitor for breaking changes*

---

## *7. Suggested Build Order (Todos)*

*Implementation todos are structured to deliver a working MVP first, then layer real-time and community features.*