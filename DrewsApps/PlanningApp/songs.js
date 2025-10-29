// Song search + linking

function openSongSearch(inputId) {
  // currentSongInputId is defined in data.js
  currentSongInputId = inputId;
  document.getElementById('songSearchModal').classList.add('active');
  document.getElementById('songSearchInput').value = '';
  document.getElementById('songSearchResults').innerHTML = '';
  document.getElementById('songSearchInput').focus();
}

// Single shared audio element for previews
let previewAudio = null;
let currentPreviewBtn = null;

// Helper functions to get play/pause icon SVG
function getPlayIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 5v14l11-7z"/>
  </svg>`;
}

function getPauseIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
  </svg>`;
}

// Stop any playing preview
function stopPreview() {
  if (previewAudio) {
    try {
      // More aggressive stopping
      previewAudio.pause();
      previewAudio.volume = 0;
      previewAudio.currentTime = 0;
      previewAudio.src = '';
      previewAudio.load(); // Reset the audio element
      // Remove event listeners to prevent callbacks
      previewAudio.onended = null;
      previewAudio.onerror = null;
      previewAudio.onplay = null;
      previewAudio.onpause = null;
    } catch(e) {
      console.error('Error stopping preview:', e);
    }
    previewAudio = null;
  }
  if (currentPreviewBtn) {
    try {
      currentPreviewBtn.innerHTML = getPlayIcon();
    } catch(e) {
      // Button might be removed from DOM
    }
    currentPreviewBtn = null;
  }
}

function closeSongSearch() {
  stopPreview();
  const modal = document.getElementById('songSearchModal');
  if (modal) {
    modal.classList.remove('active');
  }
  currentSongInputId = null;
}

// Also stop preview when modal is hidden (in case closed another way)
function stopPreviewOnModalClose() {
  const modal = document.getElementById('songSearchModal');
  if (modal) {
    // Use MutationObserver to detect when modal is closed
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          if (!modal.classList.contains('active')) {
            stopPreview();
          }
        }
      });
    });
    observer.observe(modal, { attributes: true });
  }
}

// JSONP fallback for mobile CORS issues with iTunes API
function jsonpRequest(urlBase) {
  return new Promise((resolve, reject) => {
    const cbName = `__itunes_jsonp_cb_${Date.now()}_${Math.floor(Math.random()*10000)}`;
    const url = urlBase + `&callback=${cbName}`;
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      try { delete window[cbName]; } catch(_) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP script error'));
    };

    script.src = url;
    document.head.appendChild(script);
  });
}

// Optional proxy fetch: if window.ITUNES_PROXY_URL is defined, route request through it
async function fetchViaProxy(paramsQueryString) {
  const base = (typeof window !== 'undefined' && window.ITUNES_PROXY_URL) ? window.ITUNES_PROXY_URL : null;
  if (!base) throw new Error('No proxy configured');
  const url = `${base}?${paramsQueryString}`;
  const res = await fetch(url, { mode: 'cors', headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  return await res.json();
}

// Main search with preview rendering. Exported as searchSongsWithPreview and aliased from searchSongs.
async function searchSongsWithPreview() {
  const searchInput = document.getElementById('songSearchInput');
  const query = (searchInput?.value || '').trim();
  if (!query) return;

  const resultsContainer = document.getElementById('songSearchResults');
  resultsContainer.innerHTML = '<div class="search-loading">Searching...</div>';

  try {
    // Attempt 1: use country + entity=song (most accurate)
    const mkParams = (opts) => new URLSearchParams({
      term: query,
      country: 'US',
      media: 'music',
      limit: '25',
      ...opts
    }).toString();

    const attempts = [
      `https://itunes.apple.com/search?${mkParams({ entity: 'song' })}`,
      // Fallback: drop entity filter (Apple sometimes 404s on narrow queries)
      `https://itunes.apple.com/search?${mkParams({})}`
    ];

    let data = null;
    let lastError = null;

    // If a proxy is configured, try it FIRST (mobile-friendly)
    if ((typeof window !== 'undefined') && window.ITUNES_PROXY_URL) {
      try {
        const proxyParams = mkParams({ entity: 'song' });
        data = await fetchViaProxy(proxyParams);
      } catch (e) {
        lastError = e;
      }
    }

    for (const url of attempts) {
      try {
        const response = await fetch(url, {
          mode: 'cors',
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers.get('content-type') || '';
        // iTunes API sometimes returns text/javascript even though it's valid JSON
        // Accept both application/json and text/javascript
        const isJsonLike = contentType.includes('application/json') || 
                          contentType.includes('text/javascript') ||
                          contentType.includes('application/javascript');
        
        if (isJsonLike) {
          data = await response.json();
          break;
        } else {
          // If not JSON-like content type, try parsing anyway (some APIs misreport)
          const text = await response.text();
          if (text.trim().startsWith('{')) {
            data = JSON.parse(text);
            break;
          } else {
            throw new Error(`Expected JSON, got ${contentType}. Body starts: ${text.slice(0, 80)}`);
          }
        }
      } catch (e) {
        lastError = e;
      }
    }

    if (!data) {
      // Fallback for some mobile browsers with strict CORS: use JSONP
      try {
        const jsonpParams = mkParams({ entity: 'song', callback: '' });
        const urlBase = `https://itunes.apple.com/search?${jsonpParams}`;
        data = await jsonpRequest(urlBase);
      } catch (e) {
        lastError = e;
      }
    }

    if (!data) throw lastError || new Error('Unknown search error');

    if (data.results && data.results.length > 0) {
      resultsContainer.innerHTML = '';
      data.results.forEach(song => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        // Build inner layout with a preview button
        const hasPreview = Boolean(song.previewUrl);
        resultItem.innerHTML = `
          <img src="${song.artworkUrl60}" alt="${song.trackName}" class="search-result-artwork"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3C/svg%3E'">
          <div class="search-result-info" style="display:flex;gap:12px;align-items:center;">
            <div style="flex:1;min-width:0;cursor:pointer;" class="search-result-click">
              <div class="search-result-track">${song.trackName}</div>
              <div class="search-result-artist">${song.artistName}</div>
              <div class="search-result-album">${song.collectionName}</div>
            </div>
            ${hasPreview ? `<button class="preview-btn" data-url="${song.previewUrl}" title="Play preview" style="width:40px;height:40px;border:none;border-radius:50%;background:#1a9e8e;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
              ${getPlayIcon()}
            </button>` : ''}
          </div>
        `;
        // Click on text area selects the song
        resultItem.querySelector('.search-result-click').onclick = () => selectSong(song);
        // Preview button
        const previewBtn = resultItem.querySelector('.preview-btn');
        if (hasPreview) {
          previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            previewSong(previewBtn.getAttribute('data-url'), previewBtn);
          });
        }
        resultsContainer.appendChild(resultItem);
      });
    } else {
      resultsContainer.innerHTML = '<div class="search-no-results">No results found. Try a different search.</div>';
    }
  } catch (error) {
    console.error('Search error:', error);
    resultsContainer.innerHTML =
      '<div class="search-no-results">Error searching. Please try again, or use “Link” to paste a song URL.</div>';
  }
}

function selectSong(song) {
  stopPreview(); // Stop any playing preview when song is selected
  if (currentSongInputId) {
    const input = document.getElementById(currentSongInputId);
    const display = document.getElementById(`${currentSongInputId}_display`);
    if (input) {
      const songText = `${song.trackName} - ${song.artistName}`;
      input.value = songText;
      if (display) display.textContent = songText;
      // Persist
      saveEventDetails(currentEventId);
    }
  }
  closeSongSearch();
}

// Play/pause 30s preview. Only one preview plays at a time.
function previewSong(url, btn) {
  if (!url) return;
  // If clicking the same button while playing, toggle pause
  if (previewAudio && !previewAudio.paused && currentPreviewBtn === btn) {
    previewAudio.pause();
    btn.innerHTML = getPlayIcon();
    return;
  }
  // Stop previous
  if (previewAudio) {
    try { previewAudio.pause(); } catch(_) {}
    if (currentPreviewBtn) currentPreviewBtn.innerHTML = getPlayIcon();
  }
  previewAudio = new Audio(url);
  currentPreviewBtn = btn;
  btn.innerHTML = getPauseIcon();
  previewAudio.play().catch(() => {
    btn.innerHTML = getPlayIcon();
  });
  previewAudio.onended = () => {
    if (currentPreviewBtn) currentPreviewBtn.innerHTML = getPlayIcon();
    previewAudio = null;
    currentPreviewBtn = null;
  };
}

// “Link” button flow (paste Spotify / Apple link)
function openSongLink(inputId) {
  const input = document.getElementById(inputId);
  const display = document.getElementById(`${inputId}_display`);
  const url = prompt('Paste your Spotify or Apple Music link here:');
  if (url && url.trim()) {
    const songText = url.trim();
    input.value = songText;
    if (display) display.textContent = songText;
    saveEventDetails(currentEventId);
  }
}

// Attach handlers once
(function attachSongSearchHandlers() {
  const input = document.getElementById('songSearchInput');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchSongsWithPreview();
    });
  }
  const modal = document.getElementById('songSearchModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'songSearchModal') closeSongSearch();
    });
    // Also stop preview when modal visibility changes
    stopPreviewOnModalClose();
  }
  // Ensure global alias exists for onclicks
  window.searchSongsWithPreview = searchSongsWithPreview;
  window.searchSongs = searchSongsWithPreview; // fallback for legacy markup
  window.closeSongSearch = closeSongSearch; // Make sure close function is global
  window.stopPreview = stopPreview; // Make stopPreview global too
})();
