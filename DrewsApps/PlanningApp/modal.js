// Open general info modal
function openGeneralInfo() {
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    modalTitle.innerHTML = `<span>General Info</span>`;
    modalBody.innerHTML = `
        <div class="info-grid">
            <div class="form-group">
                <label>Venue Name</label>
                <input type="text" id="venueName" value="${generalInfo.venueName || ''}" placeholder="Venue name">
            </div>
            <div class="form-group">
                <label>Venue Address</label>
                <input type="text" id="venueAddress" value="${generalInfo.venueAddress || ''}" placeholder="Full address">
            </div>
        </div>
        <div class="form-group">
            <label class="checkbox-option">
                <input type="checkbox" id="differentCeremonyVenue" ${generalInfo.differentCeremonyVenue ? 'checked' : ''} onchange="toggleCeremonyVenue()">
                <span>My ceremony will be at a different venue</span>
            </label>
        </div>
        <div id="ceremonyVenueSection" class="info-grid" style="display: ${generalInfo.differentCeremonyVenue ? 'grid' : 'none'};">
            <div class="form-group">
                <label>Ceremony Venue Name</label>
                <input type="text" id="ceremonyVenueName" value="${generalInfo.ceremonyVenueName || ''}" placeholder="Ceremony venue name">
            </div>
            <div class="form-group">
                <label>Ceremony Venue Address</label>
                <input type="text" id="ceremonyVenueAddress" value="${generalInfo.ceremonyVenueAddress || ''}" placeholder="Full address">
            </div>
        </div>
        <div class="info-grid">
            <div class="form-group">
                <label>Planner Name</label>
                <input type="text" id="plannerName" value="${generalInfo.plannerName || ''}" placeholder="Planner's name">
            </div>
            <div class="form-group">
                <label>Planner Email</label>
                <input type="email" id="plannerEmail" value="${generalInfo.plannerEmail || ''}" placeholder="email@example.com">
            </div>
        </div>
    `;
    modal.classList.add('active');
    
    modalBody.querySelectorAll('input').forEach(input => {
        if (input.type === 'checkbox') {
            input.addEventListener('change', () => saveGeneralInfo());
        } else {
            input.addEventListener('input', () => saveGeneralInfo());
        }
    });
    
    const footer = modal.querySelector('.modal-footer');
    if (footer) footer.remove();
}

function saveGeneralInfo() {
    generalInfo.venueName = document.getElementById('venueName')?.value || '';
    generalInfo.venueAddress = document.getElementById('venueAddress')?.value || '';
    generalInfo.differentCeremonyVenue = document.getElementById('differentCeremonyVenue')?.checked || false;
    generalInfo.ceremonyVenueName = document.getElementById('ceremonyVenueName')?.value || '';
    generalInfo.ceremonyVenueAddress = document.getElementById('ceremonyVenueAddress')?.value || '';
    generalInfo.plannerName = document.getElementById('plannerName')?.value || '';
    generalInfo.plannerEmail = document.getElementById('plannerEmail')?.value || '';
    showSaveIndicator();
}

function toggleCeremonyVenue() {
    const checkbox = document.getElementById('differentCeremonyVenue');
    const section = document.getElementById('ceremonyVenueSection');
    if (section) {
        section.style.display = checkbox && checkbox.checked ? 'grid' : 'none';
    }
    saveGeneralInfo();
}

function closeModal() {
    document.getElementById('eventModal').classList.remove('active');
    currentEventId = null;
}

function openModal(eventId) {
    currentEventId = eventId;
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    
    const modal = document.getElementById('eventModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    modalTitle.innerHTML = `
        <span id="eventNameDisplay">${event.name}</span>
        <button class="edit-name-btn" onclick="toggleEventNameEdit()" title="Edit event name">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
        </button>
    `;
    modalBody.innerHTML = generateModalContent(event);
    modal.classList.add('active');
    
    modalBody.querySelectorAll('input, textarea, select').forEach(input => {
        input.addEventListener('change', () => saveEventDetails(eventId));
        input.addEventListener('input', () => {
            if (input.type === 'radio' || input.type === 'checkbox') return;
            saveEventDetails(eventId);
        });
    });
    
    modalBody.querySelectorAll('.song-search-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const inputId = btn.getAttribute('data-input-id');
            openSongSearch(inputId);
        });
    });
    
    modalBody.querySelectorAll('.song-link-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const inputId = btn.getAttribute('data-input-id');
            openSongLink(inputId);
        });
    });
    
    const deleteBtn = document.getElementById(`deleteBtn_${eventId}`);
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteEvent(eventId);
        });
    }
    
    addModalFooter(eventId);
}

function toggleEventNameEdit() {
    const event = events.find(e => e.id === currentEventId);
    if (!event) return;
    
    const display = document.getElementById('eventNameDisplay');
    const currentName = display.textContent;
    
    display.innerHTML = `<input type="text" class="event-name-input" id="eventNameInput" value="${currentName}" />`;
    const input = document.getElementById('eventNameInput');
    input.focus();
    input.select();
    
    input.addEventListener('blur', () => saveEventName());
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveEventName();
        }
    });
}

function saveEventName() {
    const input = document.getElementById('eventNameInput');
    if (!input) return;
    
    const newName = input.value.trim();
    if (newName) {
        const event = events.find(e => e.id === currentEventId);
        if (event) {
            event.name = newName;
            document.getElementById('eventNameDisplay').textContent = newName;
            renderEvents();
            setupDragAndDrop();
            showSaveIndicator();
        }
    } else {
        const event = events.find(e => e.id === currentEventId);
        document.getElementById('eventNameDisplay').textContent = event.name;
    }
}

function addModalFooter(eventId) {
    const currentIndex = events.findIndex(e => e.id === eventId);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < events.length - 1;
    
    const modalContent = document.querySelector('.modal-content');
    let footer = modalContent.querySelector('.modal-footer');
    
    if (!footer) {
        footer = document.createElement('div');
        footer.className = 'modal-footer';
        modalContent.appendChild(footer);
    }
    
    footer.innerHTML = `
        <button class="nav-btn" onclick="navigateEvent('prev')" ${!hasPrev ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
            Previous
        </button>
        <button class="nav-btn" onclick="navigateEvent('next')" ${!hasNext ? 'disabled' : ''}>
            Next
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
        </button>
    `;
}

function navigateEvent(direction) {
    const currentIndex = events.findIndex(e => e.id === currentEventId);
    let newIndex;
    
    if (direction === 'prev') {
        newIndex = currentIndex - 1;
    } else {
        newIndex = currentIndex + 1;
    }
    
    if (newIndex >= 0 && newIndex < events.length) {
        closeModal();
        setTimeout(() => {
            openModal(events[newIndex].id);
        }, 100);
    }
}

function deleteEvent(eventId) {
    openConfirm('Are you sure you want to delete this event?', () => {
        events = events.filter(e => e.id !== eventId);
        renderEvents();
        setupDragAndDrop();
        closeModal();
        showSaveIndicator();
    });
}

// Close modal when clicking outside
document.getElementById('eventModal').addEventListener('click', (e) => {
    if (e.target.id === 'eventModal') {
        closeModal();
    }
});

// Simple confirm modal helpers
let __onConfirmYes = null;
function openConfirm(message, onYes) {
    const modal = document.getElementById('confirmModal');
    const msg = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYesBtn');
    msg.textContent = message || 'Are you sure?';
    __onConfirmYes = onYes;
    modal.style.display = 'flex';
    modal.classList.add('active');
    // Reset existing handler then set
    yesBtn.onclick = () => {
        closeConfirm();
        if (typeof __onConfirmYes === 'function') __onConfirmYes();
        __onConfirmYes = null;
    };
}
function closeConfirm() {
    const modal = document.getElementById('confirmModal');
    modal.classList.remove('active');
    modal.style.display = 'none';
    __onConfirmYes = null;
}

function saveEventDetails(eventId) {
    const event = events.find(e => e.id === eventId);
    if (!event) return;

    const modalBody = document.getElementById('modalBody');
    const inputs = modalBody.querySelectorAll('input, textarea, select');
    
    const lineDances = {};
    
    inputs.forEach(input => {
        if (input.type === 'radio') {
            if (input.checked) {
                if (input.name.startsWith('lineDance_')) {
                    const danceName = input.name.replace('lineDance_', '');
                    lineDances[danceName] = input.value;
                } else {
                    event.details[input.name] = input.value;
                }
            }
        } else if (input.type === 'checkbox') {
            if (input.name === 'lineDanceOther') {
                event.details.lineDanceOtherEnabled = input.checked;
            }
        } else if (input.type === 'hidden' || input.id) {
            if (input.id) {
                event.details[input.id] = input.value;
            }
        }
    });

    if (Object.keys(lineDances).length > 0) {
        event.details.lineDances = lineDances;
    }

    if (event.details.startTime) {
        event.time = convert24To12Hour(event.details.startTime);
        renderEvents();
        setupDragAndDrop();
    }

    showSaveIndicator();
}
