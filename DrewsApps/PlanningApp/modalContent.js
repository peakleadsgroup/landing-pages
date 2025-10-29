// Generate modal content based on event type
function generateModalContent(event) {
    let html = `
        <div class="form-group">
            <label>Start Time</label>
            <input type="time" id="startTime" value="${event.time ? convertTo24Hour(event.time) : ''}">
        </div>
    `;

    // Add event-specific fields based on type
    switch(event.type) {
        case 'ceremony':
            html += `
                <div class="form-group">
                    <label>Where will this be taking place?</label>
                    <input type="text" id="location" value="${event.details.location || ''}" placeholder="Venue name or location">
                </div>
                ${generateSongInput('processionalSong', 'Processional Song (Wedding Party/Family Members)', event.details.processionalSong)}
                ${generateSongInput('brideEntrance', "Bride's Entrance Song", event.details.brideEntrance)}
                <div class="form-group">
                    <label>Are you doing any special activities during the ceremony such as a unity sand ritual, tying of the knot, etc.?</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="hasSpecialActivity" value="yes" ${event.details.hasSpecialActivity === 'yes' ? 'checked' : ''} onchange="toggleSpecialActivityDetails()">
                            <span>Yes</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="hasSpecialActivity" value="no" ${event.details.hasSpecialActivity === 'no' ? 'checked' : ''} onchange="toggleSpecialActivityDetails()">
                            <span>No</span>
                        </label>
                    </div>
                </div>
                <div id="specialActivityDetails" class="conditional-section" style="display: ${event.details.hasSpecialActivity === 'yes' ? 'block' : 'none'};">
                    <div class="form-group">
                        <label>What kind of event?</label>
                        <input type="text" id="specialActivityType" value="${event.details.specialActivityType || ''}" placeholder="e.g., Unity sand ritual, Handfasting">
                    </div>
                    <div class="form-group">
                        <label>Do you want a song for your special event?</label>
                        <div class="radio-group">
                            <label class="radio-option">
                                <input type="radio" name="specialActivitySong" value="yes" ${event.details.specialActivitySong === 'yes' ? 'checked' : ''} onchange="toggleSpecialActivitySongEntry()">
                                <span>Yes</span>
                            </label>
                            <label class="radio-option">
                                <input type="radio" name="specialActivitySong" value="no" ${event.details.specialActivitySong === 'no' ? 'checked' : ''} onchange="toggleSpecialActivitySongEntry()">
                                <span>No</span>
                            </label>
                        </div>
                    </div>
                    <div id="specialActivitySongEntry" style="display: ${event.details.specialActivitySong === 'yes' ? 'block' : 'none'};">
                        ${generateSongInput('specialActivitySongTitle', 'Song for Special Activity', event.details.specialActivitySongTitle)}
                    </div>
                </div>
                ${generateSongInput('recessionalSong', 'Recessional Song', event.details.recessionalSong)}
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'cocktail-hour':
            html += `
                <div class="form-group">
                    <label>Where will this be taking place?</label>
                    <input type="text" id="location" value="${event.details.location || ''}" placeholder="Venue name or location">
                </div>
                <div class="form-group">
                    <label>Music Style/Genre</label>
                    <input type="text" id="musicStyle" value="${event.details.musicStyle || ''}" placeholder="e.g., Jazz, Acoustic, Classical">
                </div>
                <div class="form-group">
                    <label>Specific Songs/Playlist</label>
                    <textarea id="playlist" placeholder="List songs or paste Spotify/Apple Music link">${event.details.playlist || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'first-dance':
        case 'private-last-dance':
        case 'last-group-dance':
            html += `
                ${generateSongInput('songChoice', 'Song Selection', event.details.songChoice)}
                <div class="form-group">
                    <label>Special Instructions</label>
                    <textarea id="instructions" placeholder="Any special requests or notes">${event.details.instructions || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'special-dance-1':
        case 'special-dance-2':
            html += `
                <div class="form-group">
                    <label>What type of dance is this?</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="danceType_${event.id}" value="father-daughter" ${event.details.danceType === 'father-daughter' ? 'checked' : ''} onchange="handleSpecialDanceType(${event.id})">
                            <span>Father Daughter</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="danceType_${event.id}" value="mother-son" ${event.details.danceType === 'mother-son' ? 'checked' : ''} onchange="handleSpecialDanceType(${event.id})">
                            <span>Mother Son</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="danceType_${event.id}" value="other" ${event.details.danceType === 'other' ? 'checked' : ''} onchange="handleSpecialDanceType(${event.id})">
                            <span>Other</span>
                        </label>
                    </div>
                </div>
                <div id="otherDanceTypeContainer_${event.id}" class="conditional-section" style="display: ${event.details.danceType === 'other' ? 'block' : 'none'};">
                    <div class="form-group">
                        <label>Please specify dance type</label>
                        <input type="text" id="otherDanceType_${event.id}" value="${event.details.otherDanceType || ''}" placeholder="e.g., Sibling dance, Grandparent dance" onchange="updateSpecialDanceName(${event.id})">
                    </div>
                </div>
                ${generateSongInput('songChoice', 'Song Selection', event.details.songChoice)}
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'intros':
            html += `
                <div class="form-group">
                    <label>Will we be introducing your wedding party?</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="introduceParty" value="yes" ${event.details.introduceParty === 'yes' ? 'checked' : ''} onchange="toggleWeddingPartySection()">
                            <span>Yes</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="introduceParty" value="no" ${event.details.introduceParty === 'no' ? 'checked' : ''} onchange="toggleWeddingPartySection()">
                            <span>No, just the newlyweds</span>
                        </label>
                    </div>
                </div>
                <div id="weddingPartySection" class="conditional-section" style="display: ${event.details.introduceParty === 'yes' ? 'block' : 'none'};">
                    ${generateSongInput('introSong', 'Wedding Party Introduction Song', event.details.introSong)}
                    <div class="form-group">
                        <label>Wedding Party Names (in order)</label>
                        <textarea id="weddingParty" placeholder="List names in order of introduction">${event.details.weddingParty || ''}</textarea>
                    </div>
                </div>
                ${generateSongInput('newlywedsIntroSong', 'Newlyweds Introduction Song', event.details.newlywedsIntroSong)}
                <div class="form-group">
                    <label>How to introduce couple</label>
                    <input type="text" id="coupleIntro" value="${event.details.coupleIntro || ''}" placeholder="e.g., Mr. & Mrs. Smith">
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'blessing':
        case 'welcome':
            const eventType = event.type === 'blessing' ? 'blessing' : 'welcome';
            html += `
                <div class="form-group">
                    <label>Who will be giving the ${eventType}?</label>
                    <input type="text" id="givenBy" value="${event.details.givenBy || ''}" placeholder="Name and relationship">
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'toasts':
            html += `
                <div class="form-group">
                    <label>Who is giving toasts?</label>
                    <textarea id="toastGivers" placeholder="List names in order and their relationship to the bride/groom i.e. Father of the bride John, Maid of honor Sarah, etc">${event.details.toastGivers || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'cake-cutting':
            html += `
                ${generateSongInput('cakeSong', 'Cake Cutting Song', event.details.cakeSong)}
                <div class="form-group">
                    <label>Would you like us to make an announcement?</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="makeAnnouncement" value="yes" ${event.details.makeAnnouncement === 'yes' ? 'checked' : ''}>
                            <span>Yes</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="makeAnnouncement" value="no" ${event.details.makeAnnouncement === 'no' ? 'checked' : ''}>
                            <span>No</span>
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'photo-dash':
            html += `
                ${generateSongInput('photoDashSong', 'Photo Dash Song', event.details.photoDashSong)}
                <div class="form-group">
                    <label>How would you like to do the photo dash?</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="photoDashStyle" value="center" ${event.details.photoDashStyle === 'center' ? 'checked' : ''} onchange="togglePhotoDashOther()">
                            <span>Couple sits in middle of dance floor and guests stand up to join</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="photoDashStyle" value="tables" ${event.details.photoDashStyle === 'tables' ? 'checked' : ''} onchange="togglePhotoDashOther()">
                            <span>Couple goes around to each table</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="photoDashStyle" value="other" ${event.details.photoDashStyle === 'other' ? 'checked' : ''} onchange="togglePhotoDashOther()">
                            <span>Other</span>
                        </label>
                    </div>
                </div>
                <div id="photoDashOther" class="conditional-section" style="display: ${event.details.photoDashStyle === 'other' ? 'block' : 'none'};">
                    <div class="form-group">
                        <label>Please explain your photo dash style</label>
                        <textarea id="photoDashOtherText" placeholder="Describe how you'd like to do the photo dash">${event.details.photoDashOtherText || ''}</textarea>
                    </div>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'bouquet-toss':
            html += `
                ${generateSongInput('bouquetSong', 'Bouquet Toss Song', event.details.bouquetSong)}
                <div class="form-group">
                    <label>Include Garter Toss?</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="garter" value="yes" ${event.details.garter === 'yes' ? 'checked' : ''}>
                            <span>Yes</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="garter" value="no" ${event.details.garter === 'no' ? 'checked' : ''}>
                            <span>No</span>
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'dinner':
            html += `
                <div class="form-group">
                    <label>Dinner style is...</label>
                    <div class="radio-group">
                        <label class="radio-option">
                            <input type="radio" name="dinnerStyle" value="plated" ${event.details.dinnerStyle === 'plated' ? 'checked' : ''} onchange="toggleBuffetRelease()">
                            <span>Plated</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="dinnerStyle" value="buffet" ${event.details.dinnerStyle === 'buffet' ? 'checked' : ''} onchange="toggleBuffetRelease()">
                            <span>Buffet</span>
                        </label>
                        <label class="radio-option">
                            <input type="radio" name="dinnerStyle" value="family" ${event.details.dinnerStyle === 'family' ? 'checked' : ''} onchange="toggleBuffetRelease()">
                            <span>Family Style</span>
                        </label>
                    </div>
                </div>
                <div id="buffetReleaseSection" class="conditional-section" style="display: ${event.details.dinnerStyle === 'buffet' ? 'block' : 'none'};">
                    <div class="form-group">
                        <label>Who will be releasing tables for the buffet line?</label>
                        <div class="radio-group">
                            <label class="radio-option">
                                <input type="radio" name="buffetRelease" value="catering" ${event.details.buffetRelease === 'catering' ? 'checked' : ''}>
                                <span>Catering</span>
                            </label>
                            <label class="radio-option">
                                <input type="radio" name="buffetRelease" value="planner" ${event.details.buffetRelease === 'planner' ? 'checked' : ''}>
                                <span>Planner</span>
                            </label>
                            <label class="radio-option">
                                <input type="radio" name="buffetRelease" value="dj" ${event.details.buffetRelease === 'dj' ? 'checked' : ''}>
                                <span>DJ on mic</span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Dinner Music Style</label>
                    <input type="text" id="dinnerMusic" value="${event.details.dinnerMusic || ''}" placeholder="Genre or playlist">
                </div>
                <div class="form-group">
                    <label>Special Announcements</label>
                    <textarea id="announcements" placeholder="Any announcements during dinner?">${event.details.announcements || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'open-dancing':
            html += `
                <div class="form-group">
                    <label>Must-Play Songs</label>
                    <textarea id="mustPlay" placeholder="Songs that MUST be played">${event.details.mustPlay || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Maybe play these if they fit, but all don't need to be played</label>
                    <textarea id="playIfPossible" placeholder="Songs to play if possible">${event.details.playIfPossible || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Songs, artists, or genres to avoid</label>
                    <textarea id="doNotPlay" placeholder="Songs, artists, or genres to avoid">${event.details.doNotPlay || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Preferred Music Style</label>
                    <input type="text" id="danceStyle" value="${event.details.danceStyle || ''}" placeholder="Genres or era">
                </div>
                <div class="form-group">
                    <label>Line Dances</label>
                    ${generateLineDanceOptions('cha-cha-slide', 'Cha-Cha Slide', event.details.lineDances)}
                    ${generateLineDanceOptions('electric-slide', 'Electric Slide', event.details.lineDances)}
                    ${generateLineDanceOptions('cupid-shuffle', 'Cupid Shuffle', event.details.lineDances)}
                    ${generateLineDanceOptions('wobble', 'Wobble', event.details.lineDances)}
                    ${generateLineDanceOptions('watermelon-crawl', 'Watermelon Crawl', event.details.lineDances)}
                    ${generateLineDanceOptions('git-up', 'The Git Up', event.details.lineDances)}
                    ${generateLineDanceOptions('copperhead-road', 'Copperhead Road', event.details.lineDances)}
                    ${generateLineDanceOptions('cotton-eye-joe', 'Cotton Eye Joe', event.details.lineDances)}
                    ${generateLineDanceOptions('macarena', 'Macarena', event.details.lineDances)}
                    ${generateLineDanceOptions('ymca', 'YMCA', event.details.lineDances)}
                    <div style="margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px;">
                        <label class="radio-option" style="display: flex; align-items: center; margin-bottom: 8px;">
                            <input type="checkbox" name="lineDanceOther" ${event.details.lineDanceOtherEnabled ? 'checked' : ''} onchange="toggleLineDanceOther()">
                            <span style="font-weight: 600;">Other</span>
                        </label>
                        <div id="lineDanceOtherText" style="display: ${event.details.lineDanceOtherEnabled ? 'block' : 'none'}; margin-top: 8px;">
                            <textarea id="lineDanceOtherDetails" placeholder="List any other line dances and preferences">${event.details.lineDanceOtherDetails || ''}</textarea>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'grand-exit':
            html += `
                <div class="form-group">
                    <label>Exit Style</label>
                    <select id="exitStyle">
                        <option value="">Select...</option>
                        <option value="sparklers" ${event.details.exitStyle === 'sparklers' ? 'selected' : ''}>Sparklers</option>
                        <option value="bubbles" ${event.details.exitStyle === 'bubbles' ? 'selected' : ''}>Bubbles</option>
                        <option value="confetti" ${event.details.exitStyle === 'confetti' ? 'selected' : ''}>Confetti</option>
                        <option value="other" ${event.details.exitStyle === 'other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Special Instructions</label>
                    <textarea id="instructions" placeholder="Any special notes about the exit">${event.details.instructions || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Any additional information">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        case 'custom':
            html += `
                ${generateSongInput('songChoice', 'Song Selection', event.details.songChoice)}
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Add any details about this event">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
            break;

        default:
            html += `
                ${generateSongInput('songChoice', 'Song Selection', event.details.songChoice)}
                <div class="form-group">
                    <label>Other details/anything else we should know?</label>
                    <textarea id="otherDetails" placeholder="Add any details about this event">${event.details.otherDetails || ''}</textarea>
                </div>
            `;
    }

    // Add delete button for all events
    html += `
        <button class="delete-event-btn" id="deleteBtn_${event.id}">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            Delete Event
        </button>
    `;

    return html;
}
