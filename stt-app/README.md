# MediaGuard STT App

Real-time speech-to-text for videos without captions. Streams audio to **ElevenLabs**, **Mistral Voxtral**, or **Moshi** (offline WASM). Transcript is sent to MediaGuard API for manipulation detection.

## Prerequisites

- **MediaGuard API** running at http://localhost:3000
- **Mistral API key** (for analysis and Mistral Voxtral STT)
- For **Moshi** (local): Rust, `wasm32-unknown-unknown`, `wasm-bindgen-cli` — see [wasm-speech-streaming](https://github.com/lucky-bai/wasm-speech-streaming#prerequisites)

## Setup

From project root:

```bash
# Build WASM (one-time, required for Moshi; optional if using cloud STT only)
npm run stt:build

# Serve app
npm run stt:serve
```

Open http://localhost:8000.

## STT Providers

| Provider | Key | Notes |
|----------|-----|-------|
| **ElevenLabs** | ElevenLabs API key (or server `ELEVENLABS_API_KEY`) | Cloud, direct WebSocket |
| **Mistral Voxtral** | Mistral API key | Cloud, via MediaGuard API proxy |
| **Moshi** | None | Local WASM — fully offline, no audio leaves your machine |

## Flow

1. Choose provider (ElevenLabs / Mistral Voxtral / Moshi) and source (Mic / Tab audio).
2. Click **Start transcription** — audio streams; transcript appears in real time.
3. After **1 minute**, transcript is auto-sent to MediaGuard for analysis (`POST /analyze`).
4. Optionally paste a **Video ID** to associate analysis with a YouTube video.
5. Click **Stop transcription** when done. **Analyze** can be triggered manually before 1 min.
