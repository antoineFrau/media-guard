#!/usr/bin/env bash
# Build wasm-speech-streaming and link output to stt-app
# Requires: Rust, wasm32-unknown-unknown target, wasm-bindgen-cli

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_DIR="$ROOT/libs/wasm-speech-streaming"
STT_APP="$ROOT/stt-app"
BUILD_OUT="$WASM_DIR/build"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: Rust/Cargo not found. Install from https://rustup.rs"
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  echo "  rustup target add wasm32-unknown-unknown"
  echo "  cargo install wasm-bindgen-cli"
  exit 1
fi

cd "$WASM_DIR"
echo "Building WASM (this may take several minutes)..."
rm -rf build
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/wasm_speech_streaming.wasm \
  --out-dir build --target web

if command -v wasm-opt >/dev/null 2>&1; then
  echo "Optimizing with wasm-opt..."
  wasm-opt -O3 --enable-simd --enable-threads \
    -o build/wasm_speech_streaming_bg.opt.wasm build/wasm_speech_streaming_bg.wasm
  mv build/wasm_speech_streaming_bg.opt.wasm build/wasm_speech_streaming_bg.wasm
fi

mkdir -p "$STT_APP"
rm -f "$STT_APP/build"
ln -sfn "$(realpath "$BUILD_OUT")" "$STT_APP/build"
echo "Build complete. STT app ready at stt-app/"
echo "Run: npm run stt:serve"
