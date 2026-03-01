# MediaGuard STT App

Stream audio to **ElevenLabs**, **Mistral Voxtral**, or use **Moshi** (offline WASM). For cloud providers: audio is sent to the STT service; transcription is stored as it arrives; after 1 minute, analysis is auto-sent to Mistral.

## Cloud STT providers

| Provider | Key required | Notes |
|----------|--------------|-------|
| **ElevenLabs** | ElevenLabs API key (or server `ELEVENLABS_API_KEY`) | Direct WebSocket to ElevenLabs |
| **Mistral Voxtral** | Mistral API key (same as for analysis) | Via MediaGuard API WebSocket proxy |

## Flow (cloud providers)

1. **Audio → Cloud** — Raw PCM is streamed to ElevenLabs or Mistral (Mistral uses 16kHz via API proxy).
2. **Storage** — As transcription returns, it is stored in memory (and later sent to the API).
3. **Auto-analyze at 1 min** — After at least 1 minute, the transcript is sent to Mistral via `POST /analyze`.
4. **Video ID** — Paste a YouTube video ID (e.g. `7_LAiwqArvE`) to associate the analysis with that video.

## Requirements

- **MediaGuard API** running at `http://localhost:3000`
- **Mistral API key** for analysis (and for Mistral Voxtral STT)
- **ElevenLabs API key** (or server-side `ELEVENLABS_API_KEY`) for ElevenLabs STT only
- For **Moshi** (local): Rust toolchain, `wasm32-unknown-unknown`, `wasm-bindgen-cli`

## Setup

From project root:

```bash
# Build WASM (one-time, for Moshi only)
npm run stt:build

# Serve app
npm run stt:serve
```

Open http://localhost:8000.

## Usage

1. Choose **ElevenLabs**, **Mistral Voxtral**, or **Local (Moshi)** provider, and **Tab audio** (to capture from a YouTube tab) or **Mic**.
2. For Mistral Voxtral: enter your **Mistral API key** (same key used for analysis).
3. Enter **Video ID** (optional, e.g. `7_LAiwqArvE`) so the analysis is stored for that video.
4. Click **Start transcription** — audio streams to the selected provider; transcription appears as it arrives.
5. After **1 minute**, analysis is automatically sent to Mistral and stored. Recording continues.
6. Click **Stop transcription** when done. You can also click **Analyze** manually for earlier analysis.
