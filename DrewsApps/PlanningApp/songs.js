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

function closeSongSearch() {
  document.getElementById('songSearchModal').classList.remove('active');
  currentSongInputId = null;
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
            <button class="preview-btn" ${hasPreview ? '' : 'disabled'} data-url="${hasPreview ? song.previewUrl : ''}" style="padding:8px 12px;border:none;border-radius:8px;background:#1a9e8e;color:#fff;font-weight:600;cursor:${hasPreview ? 'pointer' : 'not-allowed'};white-space:nowrap;">
              ${hasPreview ? 'Preview' : 'No Preview'}
            </button>
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
    btn.textContent = 'Preview';
    return;
  }
  // Stop previous
  if (previewAudio) {
    try { previewAudio.pause(); } catch(_) {}
    if (currentPreviewBtn) currentPreviewBtn.textContent = 'Preview';
  }
  previewAudio = new Audio(url);
  currentPreviewBtn = btn;
  btn.textContent = 'Pause';
  previewAudio.play().catch(() => {
    btn.textContent = 'Preview';
  });
  previewAudio.onended = () => {
    if (currentPreviewBtn) currentPreviewBtn.textContent = 'Preview';
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
  }
  // Ensure global alias exists for onclicks
  window.searchSongsWithPreview = searchSongsWithPreview;
  window.searchSongs = searchSongsWithPreview; // fallback for legacy markup
})();
