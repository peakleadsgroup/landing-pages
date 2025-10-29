// Conditional section toggle functions
function toggleWeddingPartySection() {
    const selected = document.querySelector('input[name="introduceParty"]:checked');
    const section = document.getElementById('weddingPartySection');
    if (section) {
        section.style.display = selected && selected.value === 'yes' ? 'block' : 'none';
    }
    saveEventDetails(currentEventId);
}

function toggleSpecialActivityDetails() {
    const selected = document.querySelector('input[name="hasSpecialActivity"]:checked');
    const section = document.getElementById('specialActivityDetails');
    if (section) {
        section.style.display = selected && selected.value === 'yes' ? 'block' : 'none';
    }
    saveEventDetails(currentEventId);
}

function toggleSpecialActivitySongEntry() {
    const selected = document.querySelector('input[name="specialActivitySong"]:checked');
    const section = document.getElementById('specialActivitySongEntry');
    if (section) {
        section.style.display = selected && selected.value === 'yes' ? 'block' : 'none';
    }
    saveEventDetails(currentEventId);
}

function toggleBuffetRelease() {
    const selected = document.querySelector('input[name="dinnerStyle"]:checked');
    const section = document.getElementById('buffetReleaseSection');
    if (section) {
        section.style.display = selected && selected.value === 'buffet' ? 'block' : 'none';
    }
    saveEventDetails(currentEventId);
}

function togglePhotoDashOther() {
    const selected = document.querySelector('input[name="photoDashStyle"]:checked');
    const section = document.getElementById('photoDashOther');
    if (section) {
        section.style.display = selected && selected.value === 'other' ? 'block' : 'none';
    }
    saveEventDetails(currentEventId);
}

function toggleLineDanceOther() {
    const checkbox = document.querySelector('input[name="lineDanceOther"]');
    const section = document.getElementById('lineDanceOtherText');
    if (section) {
        section.style.display = checkbox && checkbox.checked ? 'block' : 'none';
    }
    saveEventDetails(currentEventId);
}

function handleSpecialDanceType(eventId) {
    const selected = document.querySelector(`input[name="danceType_${eventId}"]:checked`);
    const container = document.getElementById(`otherDanceTypeContainer_${eventId}`);
    if (container) {
        container.style.display = selected && selected.value === 'other' ? 'block' : 'none';
    }
    updateSpecialDanceName(eventId);
    saveEventDetails(eventId);
}

function updateSpecialDanceName(eventId) {
    const event = events.find(e => e.id === eventId);
    if (!event) return;

    const selected = document.querySelector(`input[name="danceType_${eventId}"]:checked`);
    if (!selected) return;

    let newName = event.name;
    if (selected.value === 'father-daughter') {
        newName = 'Father Daughter Dance';
    } else if (selected.value === 'mother-son') {
        newName = 'Mother Son Dance';
    } else if (selected.value === 'other') {
        const otherInput = document.getElementById(`otherDanceType_${eventId}`);
        if (otherInput && otherInput.value.trim()) {
            newName = otherInput.value.trim();
        } else {
            newName = 'Special Dance';
        }
    }

    if (newName !== event.name) {
        event.name = newName;
        document.getElementById('eventNameDisplay').textContent = newName;
        renderEvents();
        setupDragAndDrop();
        showSaveIndicator();
    }
}

function addCustomEvent() {
    document.getElementById('addEventModal').classList.add('active');
    document.getElementById('addEventOptions').style.display = 'flex';
    document.getElementById('standardEventsList').classList.remove('active');
}

function showStandardEvents() {
    document.getElementById('addEventOptions').style.display = 'none';
    document.getElementById('standardEventsList').classList.add('active');
    
    const container = document.getElementById('standardEventsContainer');
    container.innerHTML = '';
    
    standardEventTemplates.forEach(template => {
        const item = document.createElement('div');
        item.className = 'standard-event-item';
        item.textContent = template.name;
        item.onclick = () => addStandardEvent(template);
        container.appendChild(item);
    });
}

function backToAddOptions() {
    document.getElementById('addEventOptions').style.display
