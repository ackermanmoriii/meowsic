// player-mse.js (module)
// Media Source Extensions player implementation used by app.js

const SEGMENT_SIZE = 256 * 1024;
let mediaSource = null;
let sourceBuffer = null;
let mimeCodec = 'audio/mpeg';
let trackId = null;
let srcParam = null;
let nextSegmentStart = 0;
let isAppending = false;
let fetching = false;
let repeatMode = false;
let stopped = false;

export async function startTrack({track, src}) {
  await stopAndMaybeClear(trackId);
  trackId = track;
  srcParam = src;
  stopped = false;
  nextSegmentStart = 0;

  const audioEl = document.getElementById('audio');
  if (!window.MediaSource) {
    audioEl.src = `/api/stream?track=${encodeURIComponent(track)}&src=${encodeURIComponent(src)}`;
    audioEl.play().catch(()=>{});
    return;
  }

  mediaSource = new MediaSource();
  audioEl.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener('sourceopen', onSourceOpen);
  audioEl.play().catch(()=>{});
}

function onSourceOpen() {
  if (!mediaSource) return;
  if (!mediaSource.isTypeSupported(mimeCodec)) {
    console.error('MIME not supported', mimeCodec);
    return;
  }
  sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
  sourceBuffer.mode = 'segments';
  sourceBuffer.addEventListener('updateend', onUpdateEnd);
  fetchAndAppendNext();
}

function onUpdateEnd() {
  isAppending = false;
  trimBuffer(30);
  if (!stopped) fetchAndAppendNext();
}

function trimBuffer(maxSeconds) {
  try {
    const audioEl = document.getElementById('audio');
    if (!sourceBuffer || !sourceBuffer.buffered || sourceBuffer.buffered.length === 0) return;
    const start = sourceBuffer.buffered.start(0);
    const current = audioEl.currentTime;
    if (current - start > maxSeconds) {
      const removeEnd = start + (current - start - 5);
      sourceBuffer.remove(start, removeEnd);
    }
  } catch (e) {}
}

async function fetchAndAppendNext() {
  if (isAppending || fetching || !sourceBuffer || sourceBuffer.updating) return;
  fetching = true;
  const start = nextSegmentStart;
  const end = start + SEGMENT_SIZE - 1;
  const rangeHeader = `bytes=${start}-${end}`;
  const url = `/api/stream?track=${encodeURIComponent(trackId)}&src=${encodeURIComponent(srcParam)}`;

  try {
    const resp = await fetch(url, {headers: {'Range': rangeHeader}});
    if (!resp.ok && resp.status !== 206 && resp.status !== 200) {
      fetching = false;
      return;
    }
    const arrayBuffer = await resp.arrayBuffer();
    isAppending = true;
    sourceBuffer.appendBuffer(new Uint8Array(arrayBuffer));
    nextSegmentStart += arrayBuffer.byteLength;
  } catch (err) {
    console.error('Fetch error', err);
  } finally {
    fetching = false;
  }
}

export function pauseTrack() {
  document.getElementById('audio').pause();
}

export function resumeTrack() {
  return document.getElementById('audio').play();
}

export async function nextTrack(newTrackId, newSrc) {
  if (trackId) await clearTrackCache(trackId);
  startTrack({track: newTrackId, src: newSrc});
}

export async function prevTrack(newTrackId, newSrc) {
  if (trackId) await clearTrackCache(trackId);
  startTrack({track: newTrackId, src: newSrc});
}

export async function closeTrack() {
  await stopAndMaybeClear(trackId);
  if (!repeatMode && trackId) {
    clearTrackCache(trackId);
  }
  trackId = null;
  srcParam = null;
}

export function toggleRepeat() {
  repeatMode = !repeatMode;
}

// Helpers
async function stopAndMaybeClear(oldTrackId) {
  stopped = true;
  const audioEl = document.getElementById('audio');
  audioEl.pause();
  if (mediaSource) {
    try {
      if (sourceBuffer && mediaSource.readyState === 'open') {
        if (!sourceBuffer.updating) {
          mediaSource.removeSourceBuffer(sourceBuffer);
        }
      }
      mediaSource.endOfStream();
    } catch (e) {}
    try { URL.revokeObjectURL(audioEl.src); } catch(e){}
    mediaSource = null;
    sourceBuffer = null;
  }
  if (oldTrackId && !repeatMode) {
    clearTrackCache(oldTrackId);
  }
}

function clearTrackCache(trackToClear) {
  if (window.appClearTrackCache) {
    window.appClearTrackCache(trackToClear);
  } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({type:'CLEAR_TRACK', trackId: trackToClear});
  } else {
    fetch(`/api/clear-cache/${encodeURIComponent(trackToClear)}`, {method:'POST'}).catch(()=>{});
  }
}
