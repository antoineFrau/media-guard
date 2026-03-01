#!/usr/bin/env python3
"""Serve MediaGuard STT app with COOP/COEP headers (required for WASM threads)."""
import os
import http.server
import socketserver

ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "stt-app"))
BUILD_SRC = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "libs", "wasm-speech-streaming", "build"))
BUILD_LINK = os.path.join(ROOT, "build")


class STTRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main():
    if not os.path.exists(BUILD_LINK) and os.path.exists(BUILD_SRC):
        try:
            os.symlink(BUILD_SRC, BUILD_LINK)
        except OSError:
            pass
    if not os.path.exists(BUILD_LINK):
        print("Warning: stt-app/build not found. Run: ./scripts/build-stt.sh")
    port = 8000
    with socketserver.TCPServer(("", port), STTRequestHandler) as httpd:
        print(f"MediaGuard STT at http://localhost:{port}/")
        print("Ensure API runs at http://localhost:3000 for analysis.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
