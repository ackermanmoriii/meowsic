// app.js (module)
// UI glue: search, results, sidebar, and wiring to the MSE player module.

import {
  startTrack,
  pauseTrack,
  resumeTrack,
  nextTrack,
  prevTrack,
  closeTrack,
  toggleRepeat
} from './player-mse.js';

// Service Worker registration (ensure sw.js is served at /sw.js)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('SW registered', reg);
  }).catch(err => console.warn('SW reg failed', err));
}

// UI elements
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const resultsEl = document.getElementById('results');
const sidebar = document.getElementById('sidebar');
const closeSidebarBtn = document.getElementById('closeSidebar');
const tabSimilar = document.getElementById('tabSimilar');
const tabArtist = document.getElementById('tabArtist');
const similarList = document.getElementById('similarList');
const artistList = document.getElementById('artistList');
const similarFor = document.getElementById('similarFor');
const artistNameEl = document.getElementById('artistName');
const artistSort = document.getElementById('artistSort');
const openCollectionBtn = document.getElementById('openCollection');

const playerBar = document.getElementById('playerBar');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const repeatBtn = document.getElementById('repeatBtn');
const closeBtn = document.getElementById('closeBtn');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const playerThumb = document.getElementById('playerThumb');
const audioEl = document.getElementById('audio');

let currentTrack = null;
let currentQueue = [];
let currentIndex = 0;
let repeatMode = false;
let currentArtistTracks = [];

// Search handler
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  await doSearch(q);
});

async function doSearch(query) {
  resultsEl.innerHTML = '<div class="empty-state">Searching…</div>';
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    renderResults(data.results || []);
  } catch (err) {
    console.error(err);
    resultsEl.innerHTML = `<div class="empty-state">Search failed. Try again.</div>`;
  }
}

function renderResults(items) {
  if (!items.length) {
    resultsEl.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }
  resultsEl.innerHTML = '';
  items.forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="thumb" src="${t.thumbnail || ''}" alt="${escapeHtml(t.title)}" />
      <div class="meta">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="sub">${escapeHtml(t.artist || '')} • ${formatDuration(t.duration)}</div>
      </div>
      <div class="actions">
        <button class="icon-btn play" data-idx="${idx}">▶</button>
        <button class="icon-btn more" data-idx="${idx}">⋯</button>
      </div>
    `;
    card.track = t;
    resultsEl.appendChild(card);

    card.querySelector('.play').addEventListener('click', () => {
      openSidebarForTrack(t);
      playTrackFromResults(t);
    });

    card.querySelector('.more').addEventListener('click', () => {
      openSidebarForTrack(t);
    });
  });
}

// Sidebar behavior
function openSidebarForTrack(track) {
  sidebar.classList.add('open');
  sidebar.setAttribute('aria-hidden', 'false');
  document.getElementById('sidebarTitle').textContent = track.title;
  similarFor.textContent = track.title;
  artistNameEl.textContent = track.artist || 'Unknown';
  loadSimilar(track);
  loadArtist(track.artist);
}

closeSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebar.setAttribute('aria-hidden', 'true');
});

tabSimilar.addEventListener('click', () => {
  tabSimilar.classList.add('active');
  tabArtist.classList.remove('active');
  document.getElementById('similarView').classList.remove('hidden');
  document.getElementById('artistView').classList.add('hidden');
});
tabArtist.addEventListener('click', () => {
  tabArtist.classList.add('active');
  tabSimilar.classList.remove('active');
  document.getElementById('artistView').classList.remove('hidden');
  document.getElementById('similarView').classList.add('hidden');
});

// Fetch similar tracks
async function loadSimilar(track) {
  similarList.innerHTML = '<li class="empty-state">Loading similar…</li>';
  try {
    const res = await fetch(`/api/similar?trackId=${encodeURIComponent(track.id)}&src=${encodeURIComponent(track.src)}`);
    const data = await res.json();
    renderSimilarList(data.results || []);
  } catch (err) {
    similarList.innerHTML = '<li class="empty-state">No similar tracks</li>';
  }
}

function renderSimilarList(items) {
  similarList.innerHTML = '';
  items.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img class="thumb" src="${t.thumbnail || ''}" alt="${escapeHtml(t.title)}" />
      <div style="flex:1">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="sub">${escapeHtml(t.artist || '')}</div>
      </div>
      <div>
        <button class="primary-btn play-sim">Play</button>
      </div>
    `;
    li.track = t;
    similarList.appendChild(li);
    li.querySelector('.play-sim').addEventListener('click', () => {
      playTrackFromResults(t);
    });
  });
}

// Artist view
async function loadArtist(artistName) {
  artistList.innerHTML = '<li class="empty-state">Loading artist…</li>';
  try {
    const res = await fetch(`/api/artist?name=${encodeURIComponent(artistName)}`);
    const data = await res.json();
    currentArtistTracks = data.tracks || [];
    renderArtistList(currentArtistTracks);
  } catch (err) {
    artistList.innerHTML = '<li class="empty-state">No artist data</li>';
  }
}

artistSort.addEventListener('change', () => {
  const mode = artistSort.value;
  const sorted = [...currentArtistTracks];
  if (mode === 'popularity') sorted.sort((a,b)=> (b.popularity||0)-(a.popularity||0));
  if (mode === 'likes') sorted.sort((a,b)=> (b.likes||0)-(a.likes||0));
  if (mode === 'newest') sorted.sort((a,b)=> new Date(b.releaseDate) - new Date(a.releaseDate));
  if (mode === 'oldest') sorted.sort((a,b)=> new Date(a.releaseDate) - new Date(b.releaseDate));
  renderArtistList(sorted);
});

function renderArtistList(items) {
  artistList.innerHTML = '';
  items.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `
      <img class="thumb" src="${t.thumbnail || ''}" alt="${escapeHtml(t.title)}" />
      <div style="flex:1">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="sub">${formatDate(t.releaseDate)} • ${t.popularity || 0} popularity</div>
      </div>
      <div>
        <button class="primary-btn play-artist">Play</button>
      </div>
    `;
    li.track = t;
    artistList.appendChild(li);
    li.querySelector('.play-artist').addEventListener('click', () => {
      playTrackFromResults(t);
    });
  });
}

// Player control wiring
playBtn.addEventListener('click', async () => {
  if (!currentTrack) return;
  if (audioEl.paused) {
    await resumeTrack();
    playBtn.textContent = '⏸';
  } else {
    pauseTrack();
    playBtn.textContent = '▶️';
  }
});

prevBtn.addEventListener('click', async () => {
  if (currentQueue.length && currentIndex > 0) {
    const prev = currentQueue[--currentIndex];
    await prevTrack(prev.id, prev.src);
    updatePlayerMeta(prev);
  }
});

nextBtn.addEventListener('click', async () => {
  if (currentQueue.length && currentIndex < currentQueue.length - 1) {
    const next = currentQueue[++currentIndex];
    await nextTrack(next.id, next.src);
    updatePlayerMeta(next);
  }
});

repeatBtn.addEventListener('click', () => {
  repeatMode = !repeatMode;
  toggleRepeat();
  repeatBtn.style.opacity = repeatMode ? '1' : '0.6';
});

closeBtn.addEventListener('click', async () => {
  await closeTrack();
  hidePlayer();
});

// Playback helpers
function playTrackFromResults(track) {
  currentTrack = track;
  currentQueue = [track];
  currentIndex = 0;
  updatePlayerMeta(track);
  showPlayer();
  startTrack({track: track.id, src: track.src});
  playBtn.textContent = '⏸';
}

function updatePlayerMeta(track) {
  playerTitle.textContent = track.title || 'Unknown';
  playerArtist.textContent = track.artist || '';
  playerThumb.src = track.thumbnail || '';
}

function showPlayer() {
  playerBar.style.display = 'flex';
  playerBar.setAttribute('aria-hidden', 'false');
}

function hidePlayer() {
  playerBar.style.display = 'none';
  playerBar.setAttribute('aria-hidden', 'true');
  playerTitle.textContent = '—';
  playerArtist.textContent = '—';
  playerThumb.src = '';
  playBtn.textContent = '▶️';
  currentTrack = null;
}

// Utility functions
function escapeHtml(s){ if(!s) return ''; return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
function formatDuration(sec){ if(!sec) return ''; const m = Math.floor(sec/60); const s = Math.floor(sec%60).toString().padStart(2,'0'); return `${m}:${s}`; }
function formatDate(d){ if(!d) return ''; const dt = new Date(d); return dt.toLocaleDateString(); }

// Clear cache helper (post message to SW)
function clearTrackCache(trackId) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({type:'CLEAR_TRACK', trackId});
  } else {
    fetch(`/api/clear-cache/${encodeURIComponent(trackId)}`, {method:'POST'}).catch(()=>{});
  }
}

// Expose clearTrackCache globally for player-mse module
window.appClearTrackCache = clearTrackCache;
