"""
utils/streamer.py

Optional helper utilities for streaming and range parsing.
This file is referenced by app.py if you want to split helpers out.
"""

from typing import Optional
import requests

CHUNK_SIZE = 64 * 1024

def stream_from_url(url: str, start: Optional[int] = None):
    headers = {}
    if start is not None:
        headers['Range'] = f'bytes={start}-'
    r = requests.get(url, headers=headers, stream=True, timeout=15)
    r.raise_for_status()
    for chunk in r.iter_content(CHUNK_SIZE):
        if chunk:
            yield chunk
    r.close()
