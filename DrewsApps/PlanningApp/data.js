// Mock data structure (will be replaced with Airtable)
let events = [
    { id: 1, type: 'ceremony', name: 'Ceremony', time: '', details: {} },
    { id: 2, type: 'cocktail-hour', name: 'Cocktail Hour', time: '', details: {} },
    { id: 3, type: 'intros', name: 'Wedding Party Introductions', time: '', details: {} },
    { id: 4, type: 'first-dance', name: 'First Dance', time: '', details: {} },
    { id: 5, type: 'special-dance-1', name: 'Special Dance #1', time: '', details: {} },
    { id: 6, type: 'special-dance-2', name: 'Special Dance #2', time: '', details: {} },
    { id: 7, type: 'blessing', name: 'Blessing', time: '', details: {} },
    { id: 8, type: 'welcome', name: 'Welcome', time: '', details: {} },
    { id: 9, type: 'dinner', name: 'Dinner', time: '', details: {} },
    { id: 10, type: 'toasts', name: 'Toasts', time: '', details: {} },
    { id: 11, type: 'cake-cutting', name: 'Cake Cutting', time: '', details: {} },
    { id: 12, type: 'photo-dash', name: 'Photo Dash', time: '', details: {} },
    { id: 13, type: 'open-dancing', name: 'Open Dancing', time: '', details: {} },
    { id: 14, type: 'last-group-dance', name: 'Last Group Dance', time: '', details: {} },
    { id: 15, type: 'private-last-dance', name: 'Private Last Dance', time: '', details: {} },
    { id: 16, type: 'grand-exit', name: 'Grand Exit', time: '', details: {} }
];

let currentEventId = null;
let nextId = 17;
let currentSongInputId = null;

// Mobile drag state
let draggedElement = null;
let longPressTimer = null;
let isDragging = false;
let draggedCard = null;
let touchStartY = 0;
let currentTouchY = 0;
let initialCardTop = 0;
let placeholder = null;

// General info data
let generalInfo = {
    venueName: '',
    venueAddress: '',
    differentCeremonyVenue: false,
    ceremonyVenueName: '',
    ceremonyVenueAddress: '',
    plannerName: '',
    plannerEmail: ''
};

// Standard event templates
const standardEventTemplates = [
    { type: 'ceremony', name: 'Ceremony' },
    { type: 'cocktail-hour', name: 'Cocktail Hour' },
    { type: 'intros', name: 'Wedding Party Introductions' },
    { type: 'first-dance', name: 'First Dance' },
    { type: 'special-dance-1', name: 'Special Dance #1' },
    { type: 'special-dance-2', name: 'Special Dance #2' },
    { type: 'blessing', name: 'Blessing' },
    { type: 'welcome', name: 'Welcome' },
    { type: 'dinner', name: 'Dinner' },
    { type: 'toasts', name: 'Toasts' },
    { type: 'cake-cutting', name: 'Cake Cutting' },
    { type: 'photo-dash', name: 'Photo Dash' },
    { type: 'open-dancing', name: 'Open Dancing' },
    { type: 'bouquet-toss', name: 'Bouquet Toss' },
    { type: 'last-group-dance', name: 'Last Group Dance' },
    { type: 'private-last-dance', name: 'Private Last Dance' },
    { type: 'grand-exit', name: 'Grand Exit' }
];
