"""
app.py

Minimal Flask backend for the YT Music Streamer prototype.

Routes:
- /api/search?q=...
- /api/similar?trackId=...
- /api/artist?name=...
- /api/stream?track=...&src=...
- /api/clear-cache/<track_id>
- static frontend served from ../frontend

Notes:
- This example uses yt-dlp to resolve YouTube metadata and direct media URLs.
- Review YouTube/Google terms before using this in production.
"""

import os
import time
import logging
from typing import Optional, Dict

from flask import Flask, request, jsonify, Response, send_from_directory, abort
from flask_cors import CORS
import requests
from yt_dlp import YoutubeDL

# -------------------------
# Configuration
# -------------------------
BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
if not os.path.isdir(FRONTEND_DIR):
    FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

CHUNK_SIZE = 64 * 1024  # 64KB
DIRECT_URL_CACHE: Dict[str, Dict] = {}

YTDL_OPTS = {
    "format": "bestaudio/best",
    "quiet": True,
    "skip_download": True,
    "nocheckcertificate": True,
    "extract_flat": False,
}

ydl = YoutubeDL(YTDL_OPTS)

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app, resources={r"/api/*": {"origins": "*"}})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("yt-music-streamer")


# -------------------------
# Helpers
# -------------------------
def extract_direct_audio_url(video_url: str, track_id: Optional[str] = None) -> Optional[str]:
    """
    Use yt-dlp to extract a direct audio URL for streaming.
    Cache the result briefly to avoid repeated extraction.
    """
    now = time.time()
    if track_id and track_id in DIRECT_URL_CACHE:
        entry = DIRECT_URL_CACHE[track_id]
        if entry.get("expires_at", 0) > now:
            return entry.get("url")

    try:
        info = ydl.extract_info(video_url, download=False)
    except Exception as e:
        logger.exception("yt-dlp extract failed for %s: %s", video_url, e)
        return None

    formats = info.get("formats") or []
    audio_url = None
    for f in reversed(formats):
        if f.get("acodec") and f.get("url"):
            audio_url = f.get("url")
            break
    if not audio_url:
        audio_url = info.get("url")

    if audio_url and track_id:
        DIRECT_URL_CACHE[track_id] = {"url": audio_url, "expires_at": now + 300}
    return audio_url


def parse_range_header(range_header: Optional[str]) -> Optional[int]:
    """
    Parse a Range header like "bytes=12345-" and return the start byte as int.
    """
    if not range_header:
        return None
    try:
        if "=" in range_header:
            unit, rng = range_header.split("=", 1)
            if unit.strip() != "bytes":
                return None
            start_str = rng.split("-", 1)[0]
            return int(start_str)
    except Exception:
        return None
    return None


# -------------------------
# Frontend static serving
# -------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    """
    Serve frontend static files. If path not found, serve index.html.
    """
    if path and os.path.exists(os.path.join(FRONTEND_DIR, path)):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")


# -------------------------
# API: Search
# -------------------------
@app.route("/api/search")
def api_search():
    """
    Search YouTube using yt-dlp's 'ytsearch' extractor.
    Returns JSON: { results: [ { id, title, artist, thumbnail, duration, src } ] }
    """
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})

    query = f"ytsearch10:{q}"
    try:
        info = ydl.extract_info(query, download=False)
    except Exception as e:
        logger.exception("Search failed for query %s: %s", q, e)
        return jsonify({"results": []}), 500

    results = []
    entries = info.get("entries") or []
    for e in entries:
        vid_id = e.get("id") or e.get("webpage_url")
        video_url = e.get("webpage_url") or e.get("url")
        results.append(
            {
                "id": vid_id,
                "title": e.get("title"),
                "artist": e.get("uploader") or e.get("artist") or "",
                "thumbnail": e.get("thumbnail"),
                "duration": e.get("duration"),
                "src": video_url,
            }
        )
    return jsonify({"results": results})


# -------------------------
# API: Similar
# -------------------------
@app.route("/api/similar")
def api_similar():
    """
    Return related videos for a given trackId or src.
    """
    track_id = request.args.get("trackId")
    src = request.args.get("src")
    if not track_id and not src:
        return jsonify({"results": []})

    video_ref = src or f"https://www.youtube.com/watch?v={track_id}"
    try:
        info = ydl.extract_info(video_ref, download=False)
    except Exception as e:
        logger.exception("Similar extraction failed for %s: %s", video_ref, e)
        return jsonify({"results": []}), 500

    results = []
    related = info.get("related_videos") or info.get("entries") or []
    for r in related[:12]:
        results.append(
            {
                "id": r.get("id") or r.get("webpage_url"),
                "title": r.get("title"),
                "artist": r.get("uploader") or "",
                "thumbnail": r.get("thumbnail"),
                "duration": r.get("duration"),
                "src": r.get("webpage_url") or r.get("url"),
            }
        )
    return jsonify({"results": results})


# -------------------------
# API: Artist
# -------------------------
@app.route("/api/artist")
def api_artist():
    """
    Basic artist search: find videos matching the artist name and return a list.
    """
    name = request.args.get("name", "").strip()
    if not name:
        return jsonify({"tracks": []})

    query = f"ytsearch20:{name}"
    try:
        info = ydl.extract_info(query, download=False)
    except Exception as e:
        logger.exception("Artist search failed for %s: %s", name, e)
        return jsonify({"tracks": []}), 500

    tracks = []
    for e in (info.get("entries") or [])[:50]:
        tracks.append(
            {
                "id": e.get("id"),
                "title": e.get("title"),
                "artist": e.get("uploader") or name,
                "thumbnail": e.get("thumbnail"),
                "duration": e.get("duration"),
                "releaseDate": e.get("upload_date"),
                "likes": e.get("like_count"),
                "popularity": e.get("view_count"),
                "src": e.get("webpage_url"),
            }
        )
    return jsonify({"tracks": tracks})


# -------------------------
# API: Stream (proxy with Range support)
# -------------------------
@app.route("/api/stream")
def api_stream():
    """
    Proxy/stream audio for a given track.
    Query params:
      - src: the original video URL (preferred)
      - track: optional track id used for caching keys in the Service Worker
    """
    src = request.args.get("src")
    track = request.args.get("track") or request.args.get("id") or None
    if not src:
        return jsonify({"error": "missing src parameter"}), 400

    direct_url = extract_direct_audio_url(src, track_id=track or src)
    if not direct_url:
        return jsonify({"error": "could not resolve media URL"}), 502

    range_header = request.headers.get("Range")
    start = parse_range_header(range_header)

    upstream_headers = {}
    if start is not None:
        upstream_headers["Range"] = f"bytes={start}-"

    try:
        upstream = requests.get(direct_url, headers=upstream_headers, stream=True, timeout=15)
    except Exception as e:
        logger.exception("Upstream fetch failed: %s", e)
        return jsonify({"error": "upstream fetch failed"}), 502

    resp_headers = {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Range,Content-Type",
    }
    content_type = upstream.headers.get("Content-Type")
    if content_type:
        resp_headers["Content-Type"] = content_type
    if upstream.headers.get("Content-Range"):
        resp_headers["Content-Range"] = upstream.headers.get("Content-Range")
    if upstream.headers.get("Content-Length"):
        resp_headers["Content-Length"] = upstream.headers.get("Content-Length")

    status_code = upstream.status_code if upstream.status_code in (200, 206) else 200

    def generate():
        try:
            for chunk in upstream.iter_content(CHUNK_SIZE):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return Response(generate(), status=status_code, headers=resp_headers)


# -------------------------
# API: Clear cache (placeholder)
# -------------------------
@app.route("/api/clear-cache/<track_id>", methods=["POST"])
def api_clear_cache(track_id):
    """
    Endpoint to coordinate cache clearing across clients or server-side caches.
    """
    if track_id in DIRECT_URL_CACHE:
        try:
            del DIRECT_URL_CACHE[track_id]
        except Exception:
            pass
    return jsonify({"ok": True})


# -------------------------
# Health / debug
# -------------------------
@app.route("/api/ping")
def ping():
    return jsonify({"ok": True, "time": int(time.time())})


# -------------------------
# Run (development)
# -------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
