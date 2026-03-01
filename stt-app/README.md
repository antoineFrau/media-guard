# MediaGuard STT App

Stream audio to **ElevenLabs** (no local transcription) or use **Moshi** (offline WASM). For ElevenLabs: audio is sent raw to the cloud; transcription is stored as it arrives; after 1 minute, analysis is auto-sent to Mistral.

## ElevenLabs flow (recommended)

1. **Audio → ElevenLabs only** — Raw PCM is streamed to ElevenLabs; no transcription on our side.
2. **Storage** — As ElevenLabs returns transcription, it is stored in memory (and later sent to the API).
3. **Auto-analyze at 1 min** — After at least 1 minute of transcribed audio, the transcript is sent to Mistral via `POST /analyze` and stored for the given video.
4. **Video ID** — Paste a YouTube video ID (e.g. `7_LAiwqArvE`) to associate the stored analysis with that video.

## Requirements

- **MediaGuard API** running at `http://localhost:3000`
- **Mistral API key** for analysis
- **ElevenLabs API key** (or server-side `ELEVENLABS_API_KEY`) for cloud STT
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

## Usage (ElevenLabs)

1. Choose **ElevenLabs** provider and **Tab audio** (to capture from a YouTube tab).
2. Enter **Video ID** (optional, e.g. `7_LAiwqArvE`) so the analysis is stored for that video.
3. Click **Start transcription** — audio streams to ElevenLabs; transcription appears as it arrives.
4. After **1 minute**, analysis is automatically sent to Mistral and stored. Recording continues.
5. Click **Stop transcription** when done. You can also click **Analyze** manually for earlier analysis.
