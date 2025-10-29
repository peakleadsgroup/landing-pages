// Song search + linking

function openSongSearch(inputId) {
  // currentSongInputId is defined in data.js
  currentSongInputId = inputId;
  document.getElementById('songSearchModal').classList.add('active');
  document.getElementById('songSearchInput').value = '';
  document.getElementById('songSearchResults').innerHTML = '';
  document.getElementById('songSearchInput').focus();
}

function closeSongSearch() {
  document.getElementById('songSearchModal').classList.remove('active');
  currentSongInputId = null;
}

async function searchSongs() {
  const searchInput = document.getElementById('songSearchInput');
  const query = (searchInput?.value || '').trim();
  if (!query) return;

  const resultsContainer = document.getElementById('songSearchResults');
  resultsContainer.innerHTML = '<div class="search-loading">Searching...</div>';

  try {
    const params = new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '25'
    });
    const url = `https://itunes.apple.com/search?${params.toString()}`;

    const response = await fetch(url, { mode: 'cors' });

    // If Apple returns 404 (it sometimes does for odd queries), don’t try to parse JSON.
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Expected JSON, got ${contentType}. Body starts: ${text.slice(0, 120)}`);
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      resultsContainer.innerHTML = '';
      data.results.forEach(song => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.onclick = () => selectSong(song);
        resultItem.innerHTML = `
          <img src="${song.artworkUrl60}" alt="${song.trackName}" class="search-result-artwork"
               onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%2260%22 height=%2260%22/%3E%3C/svg%3E'">
          <div class="search-result-info">
            <div class="search-result-track">${song.trackName}</div>
            <div class="search-result-artist">${song.artistName}</div>
            <div class="search-result-album">${song.collectionName}</div>
          </div>
        `;
        resultsContainer.appendChild(resultItem);
      });
    } else {
      resultsContainer.innerHTML = '<div class="search-no-results">No results found. Try a different search.</div>';
    }
  } catch (error) {
    console.error('Search error:', error);
    resultsContainer.innerHTML =
      '<div class="search-no-results">Error searching. Try again later, or use “Link” to paste a song URL.</div>';
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
      if (e.key === 'Enter') searchSongs();
    });
  }
  const modal = document.getElementById('songSearchModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'songSearchModal') closeSongSearch();
    });
  }
})();
