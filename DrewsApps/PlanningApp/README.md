# Wedding Planner App - File Structure Documentation

## Overview
This is a wedding planning application that helps DJs and planners organize wedding events, timelines, and music selections. The code has been split into modular files for better maintainability.

## File Structure
```
PlanningApp/
├── index.html          # Main HTML structure
├── styles.css          # All CSS styles
├── data.js             # Data storage and global variables
├── helpers.js          # Utility functions (time conversion, etc.)
├── ui.js               # UI rendering functions
├── modal.js            # Modal management and general info
├── modalContent.js     # Event-specific modal content generation
├── drag.js             # Drag and drop functionality
├── songs.js            # Song search and selection
├── events.js           # Event handlers and toggles
├── main.js             # App initialization
└── README.md           # This file
```

## How Files Link Together

### Load Order (Important!)
The files MUST be loaded in this specific order in `index.html`:

1. **data.js** - Loads first because it contains all global variables
2. **helpers.js** - Utility functions used by other files
3. **ui.js** - UI rendering functions
4. **modal.js** - Modal management functions
5. **modalContent.js** - Large function for generating event forms
6. **drag.js** - Drag and drop setup
7. **songs.js** - Song search functionality
8. **events.js** - Event handlers
9. **main.js** - Initializes everything (loads last)

### File Dependencies

#### data.js
- **Purpose**: Stores all application data
- **Exports**: Global variables
  - `events` - Array of wedding events
  - `currentEventId` - Currently selected event
  - `generalInfo` - Venue and planner information
  - `standardEventTemplates` - Pre-defined event types
  - Drag state variables
- **Dependencies**: None

#### helpers.js
- **Purpose**: Utility functions used across the app
- **Functions**:
  - `convert24To12Hour()` - Converts 24h to 12h time format
  - `convertTo24Hour()` - Converts 12h to 24h time format
  - `showSaveIndicator()` - Shows "Changes saved" message
  - `generateSongInput()` - Creates song input HTML
  - `generateLineDanceOptions()` - Creates line dance radio buttons
- **Dependencies**: None (pure utility functions)

#### ui.js
- **Purpose**: Handles rendering of event cards
- **Functions**:
  - `renderEvents()` - Renders all event cards to the page
  - `createEventCard()` - Creates individual event card HTML
  - `updateEventOrder()` - Updates event order after drag/drop
- **Dependencies**: 
  - `data.js` (uses `events` array)
  - `drag.js` (calls `setupDragAndDrop()` after render)

#### modal.js
- **Purpose**: Manages modal dialogs
- **Functions**:
  - `openGeneralInfo()` - Opens venue/planner info modal
  - `saveGeneralInfo()` - Saves venue/planner info
  - `toggleCeremonyVenue()` - Shows/hides ceremony venue fields
  - `openModal()` - Opens event detail modal
  - `closeModal()` - Closes modals
  - `toggleEventNameEdit()` - Enables event name editing
  - `saveEventName()` - Saves edited event name
  - `addModalFooter()` - Adds prev/next navigation
  - `navigateEvent()` - Navigates between events
  - `deleteEvent()` - Deletes an event
  - `saveEventDetails()` - Saves all event form data
- **Dependencies**:
  - `data.js` (uses `generalInfo`, `events`, `currentEventId`)
  - `helpers.js` (uses `convert24To12Hour()`, `showSaveIndicator()`)
  - `modalContent.js` (calls `generateModalContent()`)
  - `ui.js` (calls `renderEvents()`)
  - `drag.js` (calls `setupDragAndDrop()`)
  - `songs.js` (calls `openSongSearch()`, `openSongLink()`)

#### modalContent.js
- **Purpose**: Generates event-specific form HTML
- **Functions**:
  - `generateModalContent()` - Large switch statement that creates different forms for each event type
- **Dependencies**:
  - `helpers.js` (uses `generateSongInput()`, `generateLineDanceOptions()`, `convertTo24Hour()`)

#### drag.js
- **Purpose**: Handles drag and drop for reordering events
- **Functions**:
  - `setupDragAndDrop()` - Sets up all drag event listeners
  - `getDragAfterElement()` - Calculates drop position
- **Dependencies**:
  - `data.js` (uses drag state variables)
  - `ui.js` (calls `updateEventOrder()`)
  - `helpers.js` (calls `showSaveIndicator()`)
  - `modal.js` (calls `openModal()`)

#### songs.js
- **Purpose**: Song search and selection functionality
- **Functions**:
  - `openSongSearch()` - Opens song search modal
  - `closeSongSearch()` - Closes song search modal
  - `searchSongs()` - Searches iTunes API for songs
  - `selectSong()` - Handles song selection
  - `openSongLink()` - Allows pasting Spotify/Apple Music links
- **Dependencies**:
  - `data.js` (uses `currentSongInputId`, `currentEventId`)
  - `modal.js` (calls `saveEventDetails()`)

#### events.js
- **Purpose**: Event handlers for form interactions
- **Functions**:
  - Toggle functions for conditional form sections:
    - `toggleWeddingPartySection()`
    - `toggleSpecialActivityDetails()`
    - `toggleSpecialActivitySongEntry()`
    - `toggleBuffetRelease()`
    - `togglePhotoDashOther()`
    - `toggleLineDanceOther()`
  - Special dance handling:
    - `handleSpecialDanceType()`
    - `updateSpecialDanceName()`
  - Add event functions:
    - `addCustomEvent()`
    - `showStandardEvents()`
    - `backToAddOptions()`
    - `addStandardEvent()`
    - `createCustomEvent()`
    - `closeAddEventModal()`
- **Dependencies**:
  - `data.js` (uses `events`, `nextId`, `standardEventTemplates`)
  - `modal.js` (calls `saveEventDetails()`, `openModal()`)
  - `ui.js` (calls `renderEvents()`)
  - `drag.js` (calls `setupDragAndDrop()`)
  - `helpers.js` (calls `showSaveIndicator()`)

#### main.js
- **Purpose**: Application initialization
- **Functions**:
  - `init()` - Initializes the app on page load
- **Dependencies**:
  - `ui.js` (calls `renderEvents()`)
  - `drag.js` (calls `setupDragAndDrop()`)

## Data Flow

### On Page Load:
1. `main.js` calls `init()`
2. `init()` calls `renderEvents()` from `ui.js`
3. `renderEvents()` creates event cards from `data.js`
4. `init()` calls `setupDragAndDrop()` from `drag.js`
5. App is ready for user interaction

### When User Clicks Event Card:
1. `drag.js` detects click and calls `openModal(id)`
2. `modal.js` calls `generateModalContent(event)` from `modalContent.js`
3. Modal displays with event-specific form
4. Form changes trigger `saveEventDetails()` in `modal.js`
5. Data is saved to `events` array in `data.js`

### When User Drags Event Card:
1. `drag.js` handles drag events
2. Card is repositioned in DOM
3. `updateEventOrder()` from `ui.js` updates `events` array
4. `showSaveIndicator()` from `helpers.js` displays confirmation

### When User Searches for Song:
1. Click "Search" button triggers `openSongSearch()` in `songs.js`
2. User types and clicks "Search"
3. `searchSongs()` calls iTunes API
4. User clicks result, triggering `selectSong()`
5. Song data is saved via `saveEventDetails()` in `modal.js`

## Key Features

### Modular Architecture
- Each file has a single responsibility
- Functions are organized by feature
- Easy to find and modify specific functionality

### Global Variables (data.js)
All shared state is in one place:
- Event data
- Current selections
- Drag state
- General info

### No Circular Dependencies
Files are loaded in order with clear dependency chain going one direction.

## Making Changes

### To Add a New Event Type:
1. Add template to `standardEventTemplates` in `data.js`
2. Add case in `generateModalContent()` in `modalContent.js`
3. Add any new toggle functions to `events.js` if needed

### To Add a New Field to All Events:
1. Modify the default `html` in `generateModalContent()` before the switch statement
2. Update `saveEventDetails()` in `modal.js` if special handling needed

### To Modify Styling:
1. All styles are in `styles.css`
2. No inline styles except for dynamic show/hide

### To Add New Helper Functions:
1. Add to `helpers.js` if used by multiple files
2. Add to specific file if only used in one place

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile touch events supported
- Drag and drop works on desktop and mobile

## Future Enhancements

- Currently saves to memory (page refresh loses data)
- Ready to integrate with Airtable for persistence
- Look for comments marked "// Here you would sync with Airtable"

## Viewing the App

### Option 1: GitHub Pages
1. Enable GitHub Pages in repository settings
2. Access at: `https://[username].github.io/[repo]/DrewsApps/PlanningApp/`

### Option 2: Local Development
1. Download all files to a folder
2. Open `index.html` in a web browser
3. Or use a local server (Python: `python -m http.server`)

## Questions?

If you need to modify the app:
1. Find the feature in the file structure above
2. Locate the specific file
3. Make your changes
4. Test thoroughly - changes in one file may affect others
