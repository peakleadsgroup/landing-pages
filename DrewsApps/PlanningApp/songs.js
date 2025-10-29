// Song search functions
function openSongSearch(inputId) {
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
    const query = searchInput.value.trim();
    
    if (!query) return;
    
    const resultsContainer = document.getElementById('songSearchResults');
    resultsContainer.innerHTML = '<div class="search-loading">Searching...</div>';
    
    try {
        const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=25`);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            resultsContainer.innerHTML = '';
            data.results.forEach(song => {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';
                resultItem.onclick = () => selectSong(song);
                
                resultItem.innerHTML = `
                    <img src="${song.artworkUrl60}" alt="${song.trackName}" class="search-result-artwork">
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
        resultsContainer.innerHTML = '<div class="search-no-results">Error searching. Please try again.</div>';
    }
}

function selectSong(song) {
    if (currentSongInputId) {
        const input = document.getElementById(currentSongInputId);
        const display = document.getElementById(`${currentSongInputId}_display`);
        if (input) {
            const songText = `${song.trackName} - ${song.artistName}`;
            input.value = songText;
            if (display) {
                display.textContent = songText;
            }
            // Trigger save
            saveEventDetails(currentEventId);
        }
    }
    closeSongSearch();
}

// Function for Link
function openSongLink(inputId) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(`${inputId}_display`);
    
    const url = prompt('Paste your Spotify or Apple Music link here:');
    
    if (url && url.trim()) {
        const songText = url.trim();
        input.value = songText;
        if (display) {
            display.textContent = songText;
        }
        saveEventDetails(currentEventId);
    }
}

// Allow Enter key to search
document.getElementById('songSearchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchSongs();
    }
});

// Close song search modal when clicking outside
document.getElementById('songSearchModal').addEventListener('click', (e) => {
    if (e.target.id === 'songSearchModal') {
        closeSongSearch();
    }
});
