// Event creation and management functions

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
    document.getElementById('addEventOptions').style.display = 'flex';
    document.getElementById('standardEventsList').classList.remove('active');
}

function addStandardEvent(template) {
    const newEvent = {
        id: nextId++,
        type: template.type,
        name: template.name,
        time: '',
        details: {}
    };
    events.push(newEvent);
    renderEvents();
    setupDragAndDrop();
    closeAddEventModal();
    openModal(newEvent.id);
    showSaveIndicator();
}

function createCustomEvent() {
    const newEvent = {
        id: nextId++,
        type: 'custom',
        name: 'New Event',
        time: '',
        details: {}
    };
    events.push(newEvent);
    renderEvents();
    setupDragAndDrop();
    closeAddEventModal();
    openModal(newEvent.id);
    showSaveIndicator();
}

function closeAddEventModal() {
    document.getElementById('addEventModal').classList.remove('active');
}

// Close add event modal when clicking outside
document.getElementById('addEventModal').addEventListener('click', (e) => {
    if (e.target.id === 'addEventModal') {
        closeAddEventModal();
    }
});

// Ensure functions are available globally for inline onclick handlers
window.addCustomEvent = addCustomEvent;
window.showStandardEvents = showStandardEvents;
window.backToAddOptions = backToAddOptions;
window.addStandardEvent = addStandardEvent;
window.createCustomEvent = createCustomEvent;
window.closeAddEventModal = closeAddEventModal;
