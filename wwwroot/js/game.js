let conn        = null;
let currentUser = null;
let matchId     = null;
let myPlayer    = 0;
let currentGuess = "";
let myGuesses   = [];
let oppGuesses  = [];
let timerInterval     = null;
let queueTimerInterval = null;
let keyStates   = {};
let myRoundDone = false;
let roundActive = false;
let myMatchScore  = 0;
let oppMatchScore = 0;
// these two work together: if the round ends while the tile flip animation is still
// playing, we hold the RoundEnd modal until the animation finishes
let revealAnimationPromise = null;
let pendingRoundEndData    = null;
let _inQueue = false;

let _opponentProfile = null;
let _opponentName    = '';

function capName(n) { return n ? n.charAt(0).toUpperCase() + n.slice(1) : n; }

// Rank system
const RANKS = [
    { name: 'Bronze',      emoji: '🥉', min: 0,    max: 1000, color: '#CD7F32' },
    { name: 'Silver',      emoji: '🥈', min: 1000, max: 2000, color: '#C0C0C0' },
    { name: 'Gold',        emoji: '🥇', min: 2000, max: 3000, color: '#FFD700' },
    { name: 'Platinum',    emoji: '⚪', min: 3000, max: 4000, color: '#E5E4E2' },
    { name: 'Diamond',     emoji: '💠', min: 4000, max: 5000, color: '#B9F2FF' },
    { name: 'Champion',    emoji: '🏆', min: 5000, max: 6000, color: '#FF4500' },
    { name: 'Master',      emoji: '💎', min: 6000, max: 7000, color: '#9400D3' },
    { name: 'Grandmaster', emoji: '👑', min: 7000, max: 8000, color: '#FF1493' },
    { name: 'Lexicon God', emoji: '🔱', min: 8000, max: 9999, color: '#FFD700' },
];

function getRank(pts) {
    for (let i = RANKS.length - 1; i >= 0; i--)
        if (pts >= RANKS[i].min) return RANKS[i];
    return RANKS[0];
}

function rankIconHTML(rankName, emoji, sizePx = 18) {
    const slug = rankName.toLowerCase().replace(/\s+/g, '-');
    return `<img src="/img/ranks/${slug}.png" class="rank-icon-img"` +
           ` style="width:${sizePx}px;height:${sizePx}px"` +
           ` alt="${emoji}" title="${rankName}"` +
           ` onerror="this.replaceWith(document.createTextNode('${emoji}'))">`;
}

function rankIconHTMLFromPts(pts, sizePx = 18) {
    const r = getRank(pts);
    return rankIconHTML(r.name, r.emoji, sizePx);
}

function rankIconHTMLFromName(rankName, sizePx = 18) {
    const r = RANKS.find(x => x.name === rankName) || RANKS[0];
    return rankIconHTML(r.name, r.emoji, sizePx);
}

// builds the rank progress bar on the result screen and returns a function
// that, when called, triggers the animated fill + point counter
function renderRankProgress(totalPoints, pointsDelta) {
    const rank     = getRank(totalPoints);
    const rankIdx  = RANKS.indexOf(rank);
    const nextRank = rankIdx < RANKS.length - 1 ? RANKS[rankIdx + 1] : null;

    const isMax    = !nextRank;
    const rangeMin = rank.min;
    const rangeMax = isMax ? Math.max(rank.min + 100, totalPoints + 20) : rank.max;
    const span     = rangeMax - rangeMin;

    const pointsBefore = Math.max(0, totalPoints - pointsDelta);
    const beforePct    = Math.min(100, Math.max(0, (pointsBefore - rangeMin) / span * 100));
    const afterPct     = Math.min(100, Math.max(0, (totalPoints  - rangeMin) / span * 100));

    function rankSideHTML(r) {
        if (!r) return `<span>✨</span><span class="rs-name">MAX</span>`;
        return `<span>${rankIconHTML(r.name, r.emoji, 22)}</span><span class="rs-name">${r.name}</span>`;
    }
    document.getElementById('resultCurrentRank').innerHTML = rankSideHTML(rank);
    document.getElementById('resultNextRank').innerHTML    = rankSideHTML(nextRank);

    const pctEl   = document.getElementById('resultProgressPct');
    const labelEl = document.getElementById('resultBarDeltaText');

    pctEl.textContent = Math.round(beforePct) + '%';

    const sign = pointsDelta > 0 ? '+' : '';
    labelEl.textContent = pointsDelta !== 0 ? `${sign}${pointsDelta}` : '';
    labelEl.style.left  = ((beforePct + afterPct) / 2) + '%';

    const fillEl  = document.getElementById('resultBarFill');
    const deltaEl = document.getElementById('resultBarDelta');
    fillEl.style.transition  = 'none';
    fillEl.style.width = beforePct + '%';

    const deltaWidth = Math.abs(afterPct - beforePct);
    deltaEl.className        = 'rank-bar-delta' + (pointsDelta > 0 ? ' gain' : pointsDelta < 0 ? ' loss' : '');
    deltaEl.style.transition = 'none';
    deltaEl.style.width      = '0%';

    if (pointsDelta >= 0) {
        deltaEl.style.left  = beforePct + '%';
        deltaEl.style.right = 'auto';
    } else {
        deltaEl.style.right = (100 - beforePct) + '%';
        deltaEl.style.left  = 'auto';
    }

    return function animateBar() {
        if (pointsDelta < 0 && totalPoints === 0 && deltaWidth === 0) return;

        requestAnimationFrame(() => {
            fillEl.style.transition  = '';
            deltaEl.style.transition = '';
            void deltaEl.offsetWidth;
            deltaEl.style.width = deltaWidth + '%';
        });

        if (pointsDelta === 0) return;

        const counterDelay    = 700;
        const counterDuration = 1400;
        let startTime  = null;

        setTimeout(() => {
            function tick(ts) {
                if (!startTime) startTime = ts;
                const elapsed  = ts - startTime;
                const progress = Math.min(elapsed / counterDuration, 1);
                const eased    = 1 - Math.pow(1 - progress, 3);
                const curPct   = Math.round(beforePct + (afterPct - beforePct) * eased);
                pctEl.textContent = curPct + '%';
                if (progress < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        }, counterDelay);
    };
}

const KEYBOARD_LAYOUT = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['ENTER','Z','X','C','V','B','N','M','BACK']
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    const header = document.getElementById('siteHeader');
    if (header) header.classList.toggle('hidden', id === 'authScreen');
}

function showLogin()    { document.getElementById('loginForm').classList.remove('hidden'); document.getElementById('registerForm').classList.add('hidden'); }
function showRegister() { document.getElementById('registerForm').classList.remove('hidden'); document.getElementById('loginForm').classList.add('hidden'); }

function onTitleClick() {
    if (!currentUser) { showScreen('authScreen'); return; }

    const inGame    = !document.getElementById('gameScreen').classList.contains('hidden');
    const inMatched = !document.getElementById('matchedScreen').classList.contains('hidden');

    if (_inQueue) {
        cancelQueue();
    } else if (matchId && (inGame || inMatched)) {
        forfeitAndGoHome();
    } else {
        showMenu();
    }
}

async function forfeitAndGoHome() {
    roundActive = false;
    myRoundDone = true;
    if (timerInterval) clearInterval(timerInterval);
    stopQueueTimer();
    hideRoundModal();

    const leavingMatchId = matchId;
    matchId = null;

    let pointsDelta = 0;
    try {
        if (conn && conn.state === signalR.HubConnectionState.Connected && leavingMatchId) {
            const result = await conn.invoke('LeaveMatch', leavingMatchId);
            if (result && result.points !== undefined) {
                pointsDelta           = result.pointsDelta ?? 0;
                currentUser.points    = result.points;
                currentUser.wins      = result.wins;
                currentUser.losses    = result.losses;
                currentUser.rank      = result.rank      || currentUser.rank;
                currentUser.rankEmoji = result.rankEmoji || currentUser.rankEmoji;
            }
        }
    } catch {}

    document.getElementById('resultTitle').textContent    = 'You left — you lose.';
    document.getElementById('resultMyScore').textContent  = myMatchScore;
    document.getElementById('resultOppScore').textContent = oppMatchScore;
    const triggerBar = renderRankProgress(currentUser.points, pointsDelta);
    populateResultPlayers(currentUser.points);
    document.getElementById('resultButtons')?.classList.remove('hidden');
    document.getElementById('resultMatchmakingWrap')?.classList.add('hidden');
    showScreen('resultScreen');
    triggerBar();
}

// Toasts
function showMessage(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = 'toast ' + type;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 3200);
}
const showError   = m => showMessage(m, 'error');
const showSuccess = m => showMessage(m, 'success');
const showInfo    = m => showMessage(m, 'info');

// Settings dropdown
function toggleSettings() {
    const dropdown = document.getElementById('settingsDropdown');
    const btn      = document.getElementById('settingsBtn');
    const isOpen   = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', isOpen);
    btn.classList.toggle('open', !isOpen);
}

document.addEventListener('click', e => {
    const wrap = document.getElementById('settingsBtn')?.closest('.header-settings-wrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('settingsDropdown')?.classList.add('hidden');
        document.getElementById('settingsBtn')?.classList.remove('open');
    }
});

// Account modal
function openAccountModal() {
    closeDropdown();
    if (!currentUser) return;
    document.getElementById('acctUsername').textContent = capName(currentUser.username);
    document.getElementById('acctEmail').textContent    = currentUser.email;
    document.getElementById('acctNewUsername').value = '';
    document.getElementById('acctNewEmail').value    = '';
    document.getElementById('acctCurrentPw').value  = '';
    document.getElementById('acctNewPw').value       = '';
    document.getElementById('accountModal').classList.remove('hidden');
}
function closeAccountModal() {
    document.getElementById('accountModal').classList.add('hidden');
}

async function submitChangeUsername() {
    const val = document.getElementById('acctNewUsername').value.trim();
    if (!val) return;
    const token = sessionStorage.getItem('token');
    try {
        const res  = await fetch('/api/auth/change-username', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ newUsername: val })
        });
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Failed'); return; }
        currentUser.username = data.username;
        document.getElementById('acctUsername').textContent = capName(currentUser.username);
        document.getElementById('menuUsername').textContent = capName(currentUser.username);
        document.getElementById('acctNewUsername').value = '';
        showSuccess('Username updated!');
    } catch { showError('Request failed'); }
}

async function submitChangeEmail() {
    const val = document.getElementById('acctNewEmail').value.trim();
    if (!val) return;
    const token = sessionStorage.getItem('token');
    try {
        const res  = await fetch('/api/auth/change-email', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ newEmail: val })
        });
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Failed'); return; }
        currentUser.email = val;
        document.getElementById('acctEmail').textContent = currentUser.email;
        document.getElementById('acctNewEmail').value = '';
        showSuccess('Email updated!');
    } catch { showError('Request failed'); }
}

async function submitChangePassword() {
    const cur = document.getElementById('acctCurrentPw').value;
    const nw  = document.getElementById('acctNewPw').value;
    if (!cur || !nw) return;
    const token = sessionStorage.getItem('token');
    try {
        const res  = await fetch('/api/auth/change-password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ currentPassword: cur, newPassword: nw })
        });
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Failed'); return; }
        document.getElementById('acctCurrentPw').value = '';
        document.getElementById('acctNewPw').value     = '';
        showSuccess('Password updated!');
    } catch { showError('Request failed'); }
}

function submitDeleteAccount() {
    document.getElementById('deleteAccountModal')?.classList.remove('hidden');
}
function closeDeleteModal() {
    document.getElementById('deleteAccountModal')?.classList.add('hidden');
}

// Forgot password modal
function openForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').classList.remove('hidden');
    document.getElementById('forgotPasswordForm').classList.remove('hidden');
    document.getElementById('forgotPasswordResult').classList.add('hidden');
    document.getElementById('forgotUsername').value = '';
    document.getElementById('forgotEmail').value = '';
}
function closeForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').classList.add('hidden');
}
async function submitForgotPassword() {
    const username = document.getElementById('forgotUsername').value.trim();
    const email    = document.getElementById('forgotEmail').value.trim();
    if (!username || !email) return showError('Please enter both username and email');
    try {
        const res  = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });
        const data = await res.json();
        if (!res.ok) return showError(data.error || 'No account found with those details');
        document.getElementById('forgotTempPassword').textContent = data.tempPassword;
        document.getElementById('forgotPasswordForm').classList.add('hidden');
        document.getElementById('forgotPasswordResult').classList.remove('hidden');
    } catch { showError('Request failed'); }
}
async function confirmDeleteAccount() {
    const btn = document.getElementById('confirmDeleteBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
    const token = sessionStorage.getItem('token');
    try {
        const res = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) {
            if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
            closeDeleteModal();
            showError('Failed to delete account');
            return;
        }
        closeDeleteModal();
        closeAccountModal();
        document.getElementById('deletingOverlay').classList.remove('hidden');
        setTimeout(() => {
            document.getElementById('deletingOverlay').classList.add('hidden');
            logout();
        }, 1600);
    } catch {
        if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
        closeDeleteModal();
        showError('Request failed');
    }
}

// Settings modal
function openSettingsModal() {
    closeDropdown();
    const s = loadStoredSettings();
    document.getElementById('settingLightMode').checked = !!s.lightMode;
    document.getElementById('settingSounds').checked    = !!s.soundEnabled;
    document.getElementById('settingMusic').checked     = !!s.musicEnabled;
    document.getElementById('settingMusicVolume').value = s.musicVolume ?? 30;
    document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
}

const SETTINGS_DEFAULTS = { lightMode: false, soundEnabled: true, musicEnabled: true, musicVolume: 30 };

function loadStoredSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem('wb_settings') || '{}');
        return { ...SETTINGS_DEFAULTS, ...stored };
    } catch { return { ...SETTINGS_DEFAULTS }; }
}

// Save settings to the server so they persist across devices / logouts
async function saveSettingsToServer(s) {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        await fetch('/api/profile/settings', {
            method:  'PUT',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body:    JSON.stringify(s)
        });
    } catch {}
}

// Pull settings from server, merge over localStorage, return merged result
async function loadSettingsFromServer() {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        const res = await fetch('/api/profile/settings', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) return;
        const text = await res.text();
        if (!text) return;
        const srv = JSON.parse(text);
        if (srv && typeof srv === 'object' && Object.keys(srv).length > 0) {
            // server wins — store merged result locally
            const merged = { ...SETTINGS_DEFAULTS, ...srv };
            localStorage.setItem('wb_settings', JSON.stringify(merged));
        }
    } catch {}
}

function onSettingChange() {
    const s = {
        lightMode:    document.getElementById('settingLightMode').checked,
        soundEnabled: document.getElementById('settingSounds').checked,
        musicEnabled: document.getElementById('settingMusic').checked,
        musicVolume:  parseInt(document.getElementById('settingMusicVolume').value, 10),
    };
    localStorage.setItem('wb_settings', JSON.stringify(s));
    saveSettingsToServer(s);
    applySettings(s);
}

function onVolumeChange(val) {
    const s = loadStoredSettings();
    s.musicVolume = parseInt(val, 10);
    localStorage.setItem('wb_settings', JSON.stringify(s));
    // exponential curve so low values are actually quiet
    if (_bgMusic) _bgMusic.volume = Math.pow(s.musicVolume / 100, 2.2);
}

function applySettings(s) {
    document.body.classList.toggle('light-mode', !!s.lightMode);
    // only stop music here — starting is always done via tryStartMusic (needs a user gesture)
    if (!s.musicEnabled) {
        _musicStarted = false;
        if (_musicFadeTimer) { clearInterval(_musicFadeTimer); _musicFadeTimer = null; }
        if (_bgMusic) { _bgMusic.pause(); }
    }
}

// Sound effects — Web Audio API, no files needed
let _audioCtx = null;
function _getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
}

// Plays a tone with a quick attack and smooth exponential decay for a crisp, clean sound
function _playTone(freq, duration, type = 'sine', vol = 0.18, delayMs = 0) {
    if (!loadStoredSettings().soundEnabled) return;
    setTimeout(() => {
        try {
            const ctx    = _getAudioCtx();
            const osc    = ctx.createOscillator();
            const gain   = ctx.createGain();
            const t      = ctx.currentTime;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            osc.type = type;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(vol, t + 0.006); // short attack
            gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
            osc.start(t);
            osc.stop(t + duration);
        } catch {}
    }, delayMs);
}

// crisp tap — short high sine, barely audible
function soundKeyPress()  { _playTone(1080, 0.07, 'sine', 0.09); }

// soft low thud for invalid word
function soundInvalid()   { _playTone(140, 0.22, 'sine', 0.22); }

// clean ascending triad — correct guess
function soundCorrect() {
    _playTone(659,  0.18, 'sine', 0.18, 0);
    _playTone(784,  0.18, 'sine', 0.18, 80);
    _playTone(1047, 0.22, 'sine', 0.16, 160);
}

// round win — bright upward chime
function soundRoundWin() {
    _playTone(784,  0.15, 'sine', 0.16, 0);
    _playTone(1047, 0.15, 'sine', 0.16, 90);
    _playTone(1319, 0.22, 'sine', 0.14, 180);
}

// round lose — gentle downward tone
function soundRoundLose() {
    _playTone(494, 0.2, 'sine', 0.15, 0);
    _playTone(392, 0.2, 'sine', 0.15, 110);
    _playTone(330, 0.3, 'sine', 0.13, 220);
}

// match win — full 5-note fanfare
function soundMatchWin() {
    [659, 784, 1047, 1319, 1568].forEach((f, i) =>
        _playTone(f, 0.22, 'sine', 0.16, i * 100));
}

// match lose — slow descend fading out
function soundMatchLose() {
    [494, 392, 330, 262].forEach((f, i) =>
        _playTone(f, 0.3, 'sine', 0.14, i * 150));
}

// Background music — three tracks that cycle, with a 3-second fade-in per track
const MUSIC_TRACKS  = ['/audio/music1.mp3', '/audio/music2.mp3', '/audio/music3.mp3'];
let _bgMusic        = null;
let _musicTrackIdx  = 0;
let _musicFadeTimer = null;
let _musicStarted   = false; // true once play() has been called, prevents double-starts

function _musicVolume() {
    const vol = loadStoredSettings().musicVolume ?? 30;
    return Math.pow(vol / 100, 2.2); // exponential so low values are actually quiet
}

function _fadeInMusic(audio, targetVol, durationMs = 3000) {
    if (_musicFadeTimer) clearInterval(_musicFadeTimer);
    audio.volume = 0;
    const steps    = 60;
    const interval = durationMs / steps;
    let   step     = 0;
    _musicFadeTimer = setInterval(() => {
        step++;
        audio.volume = Math.min(targetVol * (step / steps), targetVol);
        if (step >= steps) { clearInterval(_musicFadeTimer); _musicFadeTimer = null; }
    }, interval);
}

function _loadTrack(idx) {
    if (_bgMusic) {
        _bgMusic.onended = null;
        _bgMusic.pause();
    }
    _bgMusic           = new Audio(MUSIC_TRACKS[idx]);
    _bgMusic.volume    = 0;
    _bgMusic.onended   = () => {
        _musicTrackIdx = (_musicTrackIdx + 1) % MUSIC_TRACKS.length;
        _loadTrack(_musicTrackIdx);
        _bgMusic.play().catch(() => {});
        _fadeInMusic(_bgMusic, _musicVolume());
    };
    return _bgMusic;
}

// Called from onSettingChange when user toggles Music on/off (guaranteed user gesture)
function applyMusicSetting(enabled) {
    if (enabled) {
        tryStartMusic();
    } else {
        _musicStarted = false;
        if (_musicFadeTimer) { clearInterval(_musicFadeTimer); _musicFadeTimer = null; }
        if (_bgMusic) { _bgMusic.pause(); _bgMusic = null; }
    }
}

// Start music — always loads a fresh Audio element to avoid stale state after blocked play()
function tryStartMusic() {
    if (!loadStoredSettings().musicEnabled) return;
    _musicStarted = true; // mark as started before play() so no double-start from interaction handler
    _loadTrack(_musicTrackIdx);
    _bgMusic.play().then(() => {
        _fadeInMusic(_bgMusic, _musicVolume());
    }).catch(() => {
        _musicStarted = false; // browser blocked it — allow retry on next interaction
    });
}

// Registers capture-phase listeners that start music on the first interaction after a
// page refresh. Uses _musicStarted flag so toggling other settings never re-triggers it.
let _musicInteractionRegistered = false;
function _registerMusicOnInteraction() {
    if (_musicInteractionRegistered) return;
    _musicInteractionRegistered = true;
    const tryPlay = () => {
        if (_musicStarted) return; // already playing or starting — do nothing
        if (!loadStoredSettings().musicEnabled) return;
        tryStartMusic();
    };
    // capture: true — fires before any child handler, even ones that stopPropagation
    document.addEventListener('click',      tryPlay, { capture: true });
    document.addEventListener('keydown',    tryPlay, { capture: true });
    document.addEventListener('touchstart', tryPlay, { capture: true });
}

// Friends modal
let _friendsCurrentTab = 'friends';

function openFriendsModal() {
    closeDropdown();
    document.getElementById('friendsModal').classList.remove('hidden');
    const inp = document.getElementById('friendSearchInput');
    if (inp) inp.value = '';
    const res = document.getElementById('friendSearchResults');
    if (res) { res.innerHTML = ''; res.classList.add('hidden'); }
    switchFriendsTab('friends', document.getElementById('friendsTabFriendsBtn'));
    loadFriends();
    loadFriendRequests();
}
function closeFriendsModal() {
    document.getElementById('friendsModal').classList.add('hidden');
}

function switchFriendsTab(tab, btn) {
    _friendsCurrentTab = tab;
    document.getElementById('friendsTabFriends').classList.toggle('hidden',  tab !== 'friends');
    document.getElementById('friendsTabRequests').classList.toggle('hidden', tab !== 'requests');
    document.querySelectorAll('.friends-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function loadFriends() {
    const list  = document.getElementById('friendsList');
    list.innerHTML = '<div class="lb-loading">Loading…</div>';
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        const res  = await fetch('/api/friends', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) {
            list.innerHTML = '<div class="friends-empty">No friends yet — add someone!</div>';
            return;
        }
        list.innerHTML = data.map(f => friendItemHTML(f, 'remove')).join('');
    } catch { list.innerHTML = '<div class="friends-empty">Failed to load</div>'; }
}

async function loadFriendRequests() {
    const list  = document.getElementById('requestsList');
    list.innerHTML = '<div class="lb-loading">Loading…</div>';
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        const res  = await fetch('/api/friends/requests', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const badge = document.getElementById('friendRequestsBadge');
        if (!Array.isArray(data) || !data.length) {
            list.innerHTML = '<div class="friends-empty">No pending requests</div>';
            if (badge) badge.classList.add('hidden');
            updateHeaderFriendBadge(0);
            return;
        }
        if (badge) { badge.textContent = data.length; badge.classList.remove('hidden'); }
        updateHeaderFriendBadge(data.length);
        list.innerHTML = data.map(f => friendItemHTML(f, 'request')).join('');
    } catch { list.innerHTML = '<div class="friends-empty">Failed to load</div>'; }
}

function updateHeaderFriendBadge(count) {
    const btn   = document.getElementById('headerFriendBtn');
    const badge = document.getElementById('headerFriendBadge');
    if (!btn || !badge) return;
    if (count > 0) {
        badge.textContent = count;
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

let _friendBadgePollTimer = null;
async function pollFriendRequestsBadge() {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        const res  = await fetch('/api/friends/requests', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) return;
        const data = await res.json();
        updateHeaderFriendBadge(Array.isArray(data) ? data.length : 0);
    } catch {}
}

function startFriendBadgePolling() {
    if (_friendBadgePollTimer) return;
    pollFriendRequestsBadge();
    _friendBadgePollTimer = setInterval(pollFriendRequestsBadge, 45000);
}

function friendItemHTML(f, mode) {
    const initial = escHtml(f.username.charAt(0).toUpperCase());
    const pic     = f.picture ? `background-image:url(${escHtml(f.picture)})` : '';
    const btnHtml = mode === 'request'
        ? `<button class="friend-btn accept" onclick="acceptFriendRequest(${f.friendshipId})">Accept</button>
           <button class="friend-btn remove" onclick="declineFriendRequest(${f.friendshipId})">Decline</button>`
        : `<button class="friend-btn remove" onclick="removeFriend(${f.friendshipId})">Remove</button>`;
    const profileClick = f.userId ? ` onclick="openPlayerProfile(${f.userId})" style="cursor:pointer"` : '';
    const avStyle      = pic + (f.userId ? ';cursor:pointer' : '');
    return `<div class="friend-item" id="fi-${f.friendshipId}">
        <div class="friend-avatar" style="${avStyle}"${f.userId ? ` onclick="openPlayerProfile(${f.userId})"` : ''}>${pic ? '' : initial}</div>
        <div class="friend-info"${profileClick}>
            <div class="friend-name">${escHtml(capName(f.username))}</div>
            <div class="friend-rank">${rankIconHTMLFromName(f.rank, 14)} ${escHtml(f.rank)}</div>
        </div>
        <div class="friend-actions">${btnHtml}</div>
    </div>`;
}

let _friendSearchTimer = null;

function debounceFriendSearch(value) {
    clearTimeout(_friendSearchTimer);
    const q = value.trim();
    const res = document.getElementById('friendSearchResults');
    if (!q) { res.innerHTML = ''; res.classList.add('hidden'); return; }
    _friendSearchTimer = setTimeout(() => doFriendSearch(q), 380);
}

function triggerFriendSearch() {
    const q = (document.getElementById('friendSearchInput')?.value || '').trim();
    if (q) doFriendSearch(q);
}

async function doFriendSearch(name) {
    const resultsEl = document.getElementById('friendSearchResults');
    resultsEl.innerHTML = '<div class="lb-loading">Searching…</div>';
    resultsEl.classList.remove('hidden');
    const token = sessionStorage.getItem('token');
    try {
        const res = await fetch(`/api/profile/search?q=${encodeURIComponent(name)}`,
            { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        if (!res.ok) {
            resultsEl.innerHTML = '<div class="friend-search-empty">Search failed</div>';
            return;
        }
        const allUsers = await res.json();
        const users = allUsers.filter(d => !currentUser || d.userId !== currentUser.id);
        if (!users.length) {
            resultsEl.innerHTML = '<div class="friend-search-empty">No players found</div>';
            return;
        }

        const statusMap = {};
        if (token) {
            await Promise.all(users.map(async d => {
                try {
                    const sr = await fetch(`/api/friends/status/${d.userId}`,
                        { headers: { 'Authorization': 'Bearer ' + token } });
                    if (sr.ok) { const sd = await sr.json(); statusMap[d.userId] = sd; }
                } catch {}
            }));
        }

        resultsEl.innerHTML = users.map(d => {
            const sd = statusMap[d.userId] || {};
            const friendStatus = sd.status || 'none';
            const fshipId = sd.friendshipId || null;

            let btnHtml = '';
            if (friendStatus === 'friends')
                btnHtml = '<button class="friend-search-btn" disabled>✓ Friends</button>';
            else if (friendStatus === 'pending_sent')
                btnHtml = '<button class="friend-search-btn" disabled>Sent ✓</button>';
            else if (friendStatus === 'pending_received')
                btnHtml = `<button class="friend-search-btn" onclick="event.stopPropagation();searchAcceptRequest(${fshipId},this)">Accept</button>`;
            else
                btnHtml = `<button class="friend-search-btn" onclick="event.stopPropagation();searchAddFriend('${escHtml(d.username)}',this)">Add Friend</button>`;

            const picStyle = d.picture ? `background-image:url(${d.picture});background-size:cover;background-position:center` : '';
            const ini = escHtml(d.username.charAt(0).toUpperCase());
            return `
                <div class="friend-search-result-item" onclick="openPlayerProfile(${d.userId})">
                    <div class="friend-search-result-avatar" style="${picStyle}">${d.picture ? '' : ini}</div>
                    <div class="friend-search-result-info">
                        <div class="friend-search-result-name">${escHtml(capName(d.username))}</div>
                        <div class="friend-search-result-rank">${rankIconHTMLFromName(d.rank, 13)} ${escHtml(d.rank)} · ${d.points} pts</div>
                    </div>
                    ${btnHtml}
                </div>`;
        }).join('');
    } catch {
        resultsEl.innerHTML = '<div class="friend-search-empty">Search failed</div>';
    }
}

async function searchAddFriend(username, btn) {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    btn.disabled = true;
    try {
        const res  = await fetch('/api/friends/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) { btn.disabled = false; showError(data.error || 'Failed'); return; }
        btn.textContent = 'Sent ✓';
        showSuccess('Friend request sent!');
    } catch { btn.disabled = false; showError('Request failed'); }
}

async function searchAcceptRequest(friendshipId, btn) {
    btn.disabled = true;
    await acceptFriendRequest(friendshipId);
    btn.textContent = '✓ Friends';
}

async function acceptFriendRequest(friendshipId) {
    const token = sessionStorage.getItem('token');
    try {
        const res = await fetch(`/api/friends/accept/${friendshipId}`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) { showError('Failed'); return; }
        document.getElementById('fi-' + friendshipId)?.remove();
        showSuccess('Friend added!');
        loadFriends();
        loadFriendRequests();
    } catch { showError('Request failed'); }
}

async function declineFriendRequest(friendshipId) {
    const token = sessionStorage.getItem('token');
    try {
        await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        document.getElementById('fi-' + friendshipId)?.remove();
        loadFriendRequests();
    } catch { showError('Request failed'); }
}

async function removeFriend(friendshipId) {
    if (!confirm('Remove this friend?')) return;
    const token = sessionStorage.getItem('token');
    try {
        await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        document.getElementById('fi-' + friendshipId)?.remove();
        showSuccess('Friend removed');
        loadFriends();
    } catch { showError('Request failed'); }
}

function closeDropdown() {
    document.getElementById('settingsDropdown')?.classList.add('hidden');
    document.getElementById('settingsBtn')?.classList.remove('open');
}

// Player profile modal
let _ppCurrentUserId = null;
const _profileCache  = {};

async function openPlayerProfile(userId) {
    if (!userId) return;
    _ppCurrentUserId = userId;
    const modal = document.getElementById('playerProfileModal');
    modal.classList.remove('hidden');

    // Show cached data instantly if available, otherwise show loading state
    if (_profileCache[userId]) {
        _applyPlayerProfileData(_profileCache[userId]);
    } else {
        document.getElementById('ppUsername').textContent = '…';
        document.getElementById('ppRank').innerHTML       = '';
        const _ppTitleReset = document.getElementById('ppTitle');
        if (_ppTitleReset) { _ppTitleReset.textContent = ''; _ppTitleReset.className = 'profile-title-badge hidden'; }
        const _ppStreakReset = document.getElementById('ppStreakBadge');
        if (_ppStreakReset) _ppStreakReset.classList.add('hidden');
        document.getElementById('ppBio').textContent      = '';
        document.getElementById('ppActions').innerHTML    = '';
        document.getElementById('ppStatGrid').innerHTML   = '';
        document.getElementById('ppBanner').style.backgroundImage = '';
        document.getElementById('ppExtraStats')?.classList.add('hidden');
        document.getElementById('ppFirstGuessWrap')?.classList.add('hidden');
        document.getElementById('ppFavWordWrap')?.classList.add('hidden');
    }

    try {
        const res  = await fetch(`/api/profile/${userId}`);
        if (!res.ok) throw new Error();
        const d    = await res.json();
        _profileCache[userId] = d;
        if (_ppCurrentUserId === userId) await _applyPlayerProfileData(d);
    } catch {
        if (!_profileCache[userId])
            document.getElementById('ppUsername').textContent = 'Failed to load';
    }
}

async function _applyPlayerProfileData(d) {
    const banner = document.getElementById('ppBanner');
    if (d.banner) {
        banner.style.backgroundImage    = `url(${d.banner})`;
        banner.style.backgroundSize     = 'cover';
        banner.style.backgroundPosition = 'center';
    } else {
        banner.style.backgroundImage = '';
    }

    const av = document.getElementById('ppAvatar');
    av.textContent = '';
    if (d.picture) {
        av.style.backgroundImage    = `url(${d.picture})`;
        av.style.backgroundSize     = 'cover';
        av.style.backgroundPosition = 'center';
    } else {
        av.style.backgroundImage = '';
        av.textContent = d.username.charAt(0).toUpperCase();
    }
    BORDERS.forEach(b => { if (b.cls) av.classList.remove(b.cls); });
    av.style.borderColor = ''; av.style.boxShadow = '';
    const bDef = BORDERS.find(b => b.id === (d.border || 'default')) || BORDERS[0];
    if (bDef.cls) av.classList.add(bDef.cls);
    else av.style.borderColor = bDef.color || '#3a3a3c';

    document.getElementById('ppUsername').textContent = capName(d.username);
    const ppStreak = document.getElementById('ppStreakBadge');
    if (ppStreak) {
        const streak = d.stats?.currentStreak ?? 0;
        ppStreak.textContent = streak > 0 ? '🔥' + streak : '';
        ppStreak.classList.toggle('hidden', streak === 0);
    }
    document.getElementById('ppRank').innerHTML =
        rankIconHTMLFromName(d.rank, 16) + ' ' + escHtml(d.rank);

    const titleDef = TITLES.find(t => t.id === d.title);
    const ppTitle  = document.getElementById('ppTitle');
    if (titleDef && d.title) {
        ppTitle.textContent = titleDef.label;
        ppTitle.className = 'profile-title-badge' + (titleDef.tier ? ' tier-' + titleDef.tier : '');
        ppTitle.classList.remove('hidden');
    } else {
        ppTitle.textContent = '';
        ppTitle.className = 'profile-title-badge hidden';
    }
    document.getElementById('ppBio').textContent = d.bio || '';

    const actions = document.getElementById('ppActions');
    actions.innerHTML = '';
    if (currentUser && d.userId !== currentUser.id) {
        const token = sessionStorage.getItem('token');
        let friendStatus = 'none', friendshipId = null;
        if (token) {
            try {
                const sr = await fetch(`/api/friends/status/${d.userId}`,
                    { headers: { 'Authorization': 'Bearer ' + token } });
                if (sr.ok) { const sd = await sr.json(); friendStatus = sd.status; friendshipId = sd.friendshipId; }
            } catch {}
        }
        if (friendStatus === 'friends') {
            actions.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem">✓ Already friends</span>';
        } else if (friendStatus === 'pending_sent') {
            actions.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem">Request sent</span>';
        } else if (friendStatus === 'pending_received') {
            const btn = document.createElement('button');
            btn.textContent = 'Accept Request';
            btn.onclick = async () => { await acceptFriendRequest(friendshipId); actions.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem">✓ Now friends</span>'; };
            actions.appendChild(btn);
        } else {
            const btn = document.createElement('button');
            btn.textContent = 'Add Friend';
            btn.onclick = () => ppAddFriend(d.username);
            actions.appendChild(btn);
        }
    }

    const s = d.stats || {};
    const winsN = Number(d.wins) || 0, lossesN = Number(d.losses) || 0, totalM = winsN + lossesN;
    const stats = [
        { label: 'Wins',          value: winsN },
        { label: 'Losses',        value: lossesN },
        { label: 'Win Rate',      value: totalM > 0 ? Math.round(winsN * 100 / totalM) + '%' : '0%' },
        { label: 'Points',        value: d.points ?? 0 },
        { label: 'Avg Guesses',   value: s.avgGuesses > 0 ? Number(s.avgGuesses).toFixed(1) : '—' },
        { label: 'Fastest Solve', value: s.fastestSolve > 0 ? String(s.fastestSolve) : '—' },
        { label: 'Streak',        value: s.currentStreak ?? 0 },
        { label: 'Best Streak',   value: s.bestStreak    ?? 0 },
    ];
    document.getElementById('ppStatGrid').innerHTML = stats.map(st =>
        `<div class="pstat-card"><div class="pstat-value">${st.value}</div><div class="pstat-label">${st.label}</div></div>`
    ).join('');

    const ppFgWrap = document.getElementById('ppFirstGuessWrap');
    const ppFgWord = document.getElementById('ppFirstGuess');
    if (ppFgWrap && ppFgWord) { ppFgWord.textContent = d.commonFirstGuess ? d.commonFirstGuess.toUpperCase() : 'No data'; ppFgWrap.classList.remove('hidden'); }
    const ppFavWrap = document.getElementById('ppFavWordWrap');
    const ppFavWord = document.getElementById('ppFavWord');
    if (ppFavWrap && ppFavWord) { ppFavWord.textContent = d.favoriteWord ? d.favoriteWord.toUpperCase() : 'No data'; ppFavWrap.classList.remove('hidden'); }
    document.getElementById('ppExtraStats')?.classList.remove('hidden');
}

function closePlayerProfile() {
    document.getElementById('playerProfileModal').classList.add('hidden');
    _ppCurrentUserId = null;
}

async function ppAddFriend(username) {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        const res  = await fetch('/api/friends/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Failed'); return; }
        showSuccess('Friend request sent!');
        const actions = document.getElementById('ppActions');
        if (actions) actions.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem">Request sent</span>';
    } catch { showError('Request failed'); }
}

// Menu
function applyUserToMenu() {
    document.getElementById('menuUsername').textContent = capName(currentUser.username);
    const r   = currentUser.rank || '';
    const pts = currentUser.points || 0;
    const rankEl = document.getElementById('menuRank');
    rankEl.innerHTML = rankIconHTMLFromPts(pts, 16) + ' ' + escHtml(r);
    const qRank = getRank(pts);
    const qRankEl = document.getElementById('menuQueueRank');
    if (qRankEl) {
        document.getElementById('menuQueueRankIcon').innerHTML = rankIconHTML(qRank.name, qRank.emoji, 26);
        document.getElementById('menuQueueRankName').textContent = qRank.name;
        document.getElementById('menuQueuePts').textContent = pts;
    }
    updateMenuAvatar();
    updateMenuBanner();
    updateMenuTitleBadge();
    updateMenuStreakBadge();
}

async function fetchRecentMatches() {
    const list  = document.getElementById('recentMatchesList');
    list.innerHTML = '<div class="lb-loading">Loading…</div>';
    const token = sessionStorage.getItem('token');
    if (!token) { list.innerHTML = '<div class="lb-loading">—</div>'; return; }
    try {
        const res  = await fetch('/api/auth/recent-matches',
            { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) {
            list.innerHTML = '<div class="lb-loading">No matches yet</div>';
            return;
        }
        list.innerHTML = '';
        data.forEach(m => {
            const row = document.createElement('div');
            row.className = 'recent-match-row';
            const cls = m.outcome === 'WIN' ? 'win' : m.outcome === 'LOSS' ? 'loss' : 'draw';

            const av = makeSmallAvatar(m.opponentName, m.opponentPicture, m.opponentBorder, 26);
            row.appendChild(av);

            const outcomeEl = document.createElement('span');
            outcomeEl.className = `rm-outcome ${cls}`;
            outcomeEl.textContent = m.outcome;
            row.appendChild(outcomeEl);

            const oppEl = document.createElement('span');
            oppEl.className = 'rm-opp';
            oppEl.textContent = capName(m.opponentName);
            row.appendChild(oppEl);

            const scoreEl = document.createElement('span');
            scoreEl.className = 'rm-score';
            scoreEl.textContent = `${m.myScore}–${m.oppScore}`;
            row.appendChild(scoreEl);

            const delta = m.pointsDelta ?? 0;
            const deltaEl = document.createElement('span');
            deltaEl.className = 'rm-delta' + (delta > 0 ? ' gain' : delta < 0 ? ' loss' : ' draw');
            deltaEl.textContent = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';
            row.appendChild(deltaEl);

            if (m.opponentId) {
                row.style.cursor = 'pointer';
                row.onclick = () => openPlayerProfile(m.opponentId);
            }

            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<div class="lb-loading">Failed to load</div>';
    }
}

async function fetchLeaderboard() {
    const list = document.getElementById('leaderboardList');
    list.innerHTML = '<div class="lb-loading">Loading…</div>';
    try {
        const res  = await fetch('/api/auth/leaderboard');
        const data = await res.json();
        const rows = Array.isArray(data) ? data : [];
        while (rows.length < 10) rows.push(null);

        list.innerHTML =
            `<div class="leaderboard-header">
                <span>#</span><span></span><span></span><span>Player</span>
                <span style="text-align:right">Pts</span>
                <span style="text-align:center">Wins</span>
                <span style="text-align:right">W/R</span>
            </div>`;

        rows.forEach((p, i) => {
            const row = document.createElement('div');
            if (!p) {
                row.className = 'leaderboard-row empty';
                row.innerHTML =
                    `<span class="lb-pos">${i + 1}</span>` +
                    `<span></span><span></span><span class="lb-name">—</span>` +
                    `<span class="lb-pts">—</span><span class="lb-wins">—</span><span class="lb-wr">—</span>`;
                list.appendChild(row);
                return;
            }
            row.className = 'leaderboard-row' +
                (currentUser && p.username === currentUser.username ? ' me' : '');

            const av = makeSmallAvatar(p.username, p.picture, p.border, 24);
            row.appendChild(av);

            const posClass = p.position <= 3 ? ' top' : '';
            const icon = rankIconHTML(p.rank, p.rankEmoji, 16);

            const cell = (cls, html) => {
                const s = document.createElement('span');
                s.className = cls;
                s.innerHTML = html;
                return s;
            };

            const streakHtml = p.streak > 0
                ? ` <span class="lb-streak">🔥${p.streak}</span>`
                : '';

                    row.insertBefore(cell('lb-rank-icon', icon), av);
            row.insertBefore(cell(`lb-pos${posClass}`, p.position), av.previousSibling);
            row.appendChild(cell('lb-name', escHtml(capName(p.username)) + streakHtml));
            row.appendChild(cell('lb-pts', p.points));
            row.appendChild(cell('lb-wins', p.wins ?? 0));
            row.appendChild(cell('lb-wr', p.winRate + '%'));
            row.style.cursor = 'pointer';
            row.onclick = () => openPlayerProfile(p.userId);
            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<div class="lb-loading">Failed to load</div>';
    }
}

function showMenu() {
    _inQueue = false;
    stopQueueTimer();
    const findBtn       = document.getElementById('findGameBtn');
    const matchmakingEl = document.getElementById('menuMatchmaking');
    if (findBtn)       { findBtn.textContent = 'Find Game'; findBtn.onclick = playGame; }
    if (matchmakingEl) { matchmakingEl.classList.add('hidden'); }

    document.getElementById('settingsDropdown')?.classList.add('hidden');
    document.getElementById('settingsBtn')?.classList.remove('open');

    applyUserToMenu();
    showScreen('menuScreen');
    fetchLeaderboard();
    fetchRecentMatches();
    fetchUserProfile();
    startFriendBadgePolling();

    const token = sessionStorage.getItem('token');
    if (!token) return;
    fetch('/api/auth/verify', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data?.success || !data.user) return;
            currentUser = data.user;
            if (!document.getElementById('menuScreen').classList.contains('hidden'))
                applyUserToMenu();
        })
        .catch(() => {});
}

// Auth
async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    if (!username || !email || !password) return showError('All fields required');
    try {
        const res  = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,email,password}) });
        const data = await res.json();
        if (!data.success) return showError(data.error);
            document.getElementById('regUsername').value = '';
        document.getElementById('regEmail').value    = '';
        document.getElementById('regPassword').value = '';
        showLogin();
        document.getElementById('loginUsername').value = username;
        showSuccess('Account created! Please sign in.');
    } catch (e) { showError('Registration failed'); }
}

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) return showError('Username and password required');
    try {
        const res  = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password}) });
        const data = await res.json();
        if (!data.success) return showError(data.error || 'Invalid credentials');
        sessionStorage.setItem('token', data.token);
        currentUser = data.user;
        await loadSettingsFromServer(); // pull saved settings before applying
        applySettings(loadStoredSettings());
        try { await initSignalR(); } catch {}
        showMenu();
        tryStartMusic(); // login is a user gesture — safe to start audio here
    } catch (e) { showError('Login failed'); }
}

function logout() {
    sessionStorage.removeItem('token');
    currentUser = null;
    if (conn) { conn.stop(); conn = null; }
    if (_friendBadgePollTimer) { clearInterval(_friendBadgePollTimer); _friendBadgePollTimer = null; }
    updateHeaderFriendBadge(0);
    showScreen('authScreen');
}

// Enter key on auth forms
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const authScreen = document.getElementById('authScreen');
    if (authScreen.classList.contains('hidden')) return;
    const loginForm = document.getElementById('loginForm');
    if (!loginForm.classList.contains('hidden')) login();
    else register();
});

// SignalR
async function initSignalR() {
    const token = sessionStorage.getItem('token');

    conn = new signalR.HubConnectionBuilder()
        .withUrl('/gamehub', { accessTokenFactory: () => token })
        .withAutomaticReconnect()
        .build();

    conn.on('MatchFound', async (data) => {
        matchId  = data.matchId;
        myPlayer = data.player;
        roundActive  = false;
        myRoundDone  = false;
        _opponentProfile = null;

        _inQueue = false;
        stopQueueTimer();
        const findBtn       = document.getElementById('findGameBtn');
        const matchmakingEl = document.getElementById('menuMatchmaking');
        if (findBtn)       { findBtn.textContent = 'Find Game'; findBtn.onclick = playGame; }
        if (matchmakingEl) { matchmakingEl.classList.add('hidden'); }
        document.getElementById('resultButtons')?.classList.remove('hidden');
        document.getElementById('resultMatchmakingWrap')?.classList.add('hidden');

        const myName  = capName(currentUser.username);
        const oppName = data.opponent;
        _opponentName = oppName;

        document.getElementById('p1Name').textContent  = myName;          // left = always me
        document.getElementById('p2Name').textContent  = capName(oppName); // right = always opponent
        document.getElementById('p1Score').textContent = '0';
        document.getElementById('p2Score').textContent = '0';
        document.getElementById('roundNum').textContent = '?';
        document.getElementById('timer').textContent    = '60';
        renderBoard('myBoard',  [], false);
        renderBoard('oppBoard', [], true);
        document.getElementById('keyboard').innerHTML = '';

        const oppRankName = data.opponentRankName || '';
        const oppRankEmoji = data.opponentRankEmoji || '';
        document.getElementById('matchedOpponentName').textContent = oppName;
        document.getElementById('matchedOpponentRank').innerHTML =
            oppRankName ? rankIconHTMLFromName(oppRankName, 44) : escHtml(oppRankEmoji);

        showScreen('matchedScreen');

        if (data.opponentId) {
            fetchPublicProfile(data.opponentId).then(prof => {
                _opponentProfile = prof;
            }).catch(() => {});
        }
    });

    conn.on('RoundStart',  startRound);
    conn.on('GuessResult', handleGuess);
    conn.on('RoundEnd',    endRound);
    conn.on('MatchEnd',    endMatch);

    conn.on('OpponentDisconnected', (data) => {
        if (timerInterval) clearInterval(timerInterval);
        hideRoundModal();
        roundActive = false;
        matchId = null;

        currentUser.points    = data.myPoints;
        currentUser.wins      = data.myWins;
        currentUser.losses    = data.myLosses;
        currentUser.rank      = data.rank      || currentUser.rank;
        currentUser.rankEmoji = data.rankEmoji || currentUser.rankEmoji;

        document.getElementById('resultTitle').textContent     = 'Opponent left — you win! 🎉';
        document.getElementById('resultMyScore').textContent   = data.myScore  ?? '—';
        document.getElementById('resultOppScore').textContent  = data.oppScore ?? '—';
        const triggerBar = renderRankProgress(data.myPoints, data.pointsDelta ?? 10);
        populateResultPlayers(data.myPoints);
        document.getElementById('resultButtons')?.classList.remove('hidden');
        document.getElementById('resultMatchmakingWrap')?.classList.add('hidden');
        showScreen('resultScreen');
        triggerBar();
    });

    try {
        await conn.start();
    } catch {}
}

async function fetchPublicProfile(userId) {
    const res = await fetch(`/api/profile/${userId}`);
    if (!res.ok) return null;
    return await res.json();
}

function populateGamePanels(p1Name, p2Name) {
    const myPanelNum  = 1; // left panel is always me
    const oppPanelNum = 2; // right panel is always opponent

    const myAvatarEl  = document.getElementById(`p${myPanelNum}Avatar`);
    const myRankEl    = document.getElementById(`p${myPanelNum}Rank`);
    const myTitleEl   = document.getElementById(`p${myPanelNum}Title`);

    if (myAvatarEl) {
        if (userProfile?.picture) {
            myAvatarEl.style.backgroundImage    = `url(${userProfile.picture})`;
            myAvatarEl.style.backgroundSize     = 'cover';
            myAvatarEl.style.backgroundPosition = 'center';
            myAvatarEl.textContent = '';
        } else {
            myAvatarEl.style.backgroundImage = '';
            myAvatarEl.textContent = currentUser.username.substring(0, 2).toUpperCase();
        }
        applyBorderToAvatar(myAvatarEl, userProfile?.border || 'default');
    }

    if (myRankEl) {
        const pts = currentUser.points || 0;
        const rank = getRank(pts);
        myRankEl.innerHTML = rankIconHTML(rank.name, rank.emoji, 14) + ' ' + escHtml(rank.name);
    }

    if (myTitleEl) {
        const titleId = userProfile?.title || '';
        const titleDef = TITLES.find(t => t.id === titleId);
        if (titleDef && titleId) {
            myTitleEl.textContent = titleDef.label;
            myTitleEl.className = 'game-player-title' + (titleDef.tier ? ' tier-' + titleDef.tier : '');
        } else {
            myTitleEl.className = 'game-player-title hidden';
        }
    }

    const myStreakEl = document.getElementById(`p${myPanelNum}Streak`);
    if (myStreakEl) {
        const myStreak = userProfile?.stats?.currentStreak ?? 0;
        if (myStreak > 0) {
            myStreakEl.textContent = '🔥' + myStreak;
            myStreakEl.classList.remove('hidden');
        } else {
            myStreakEl.classList.add('hidden');
        }
    }

    const oppAvatarEl = document.getElementById(`p${oppPanelNum}Avatar`);
    const oppRankEl   = document.getElementById(`p${oppPanelNum}Rank`);
    const oppTitleEl  = document.getElementById(`p${oppPanelNum}Title`);

    if (oppAvatarEl) {
        const prof = _opponentProfile;
        if (prof?.picture) {
            oppAvatarEl.style.backgroundImage    = `url(${prof.picture})`;
            oppAvatarEl.style.backgroundSize     = 'cover';
            oppAvatarEl.style.backgroundPosition = 'center';
            oppAvatarEl.textContent = '';
        } else {
            oppAvatarEl.style.backgroundImage = '';
            const oppNm = myPlayer === 1 ? p2Name : p1Name;
            oppAvatarEl.textContent = (oppNm || '?').substring(0, 2).toUpperCase();
        }
        applyBorderToAvatar(oppAvatarEl, _opponentProfile?.border || 'default');
    }

    if (oppRankEl) {
        const rankName = _opponentProfile?.rank || '';
        if (rankName) {
            oppRankEl.innerHTML = rankIconHTMLFromName(rankName, 14) + ' ' + escHtml(rankName);
        } else {
            oppRankEl.innerHTML = '';
        }
    }

    if (oppTitleEl) {
        const titleId = _opponentProfile?.title || '';
        const titleDef = TITLES.find(t => t.id === titleId);
        if (titleDef && titleId) {
            oppTitleEl.textContent = titleDef.label;
            oppTitleEl.className = 'game-player-title' + (titleDef.tier ? ' tier-' + titleDef.tier : '');
        } else {
            oppTitleEl.className = 'game-player-title hidden';
        }
    }

    const oppStreakEl = document.getElementById(`p${oppPanelNum}Streak`);
    if (oppStreakEl) {
        const oppStreak = _opponentProfile?.stats?.currentStreak ?? 0;
        if (oppStreak > 0) {
            oppStreakEl.textContent = '🔥' + oppStreak;
            oppStreakEl.classList.remove('hidden');
        } else {
            oppStreakEl.classList.add('hidden');
        }
    }
}

// Queue
let queueSeconds = 0;

function startQueueTimer() {
    queueSeconds = 0;
    updateQueueTimerDisplay();
    queueTimerInterval = setInterval(() => {
        queueSeconds++;
        updateQueueTimerDisplay();
    }, 1000);
}

function stopQueueTimer() {
    clearInterval(queueTimerInterval);
    queueTimerInterval = null;
}

function updateQueueTimerDisplay() {
    const m = Math.floor(queueSeconds / 60);
    const s = queueSeconds % 60;
    const timeStr = `${m}:${String(s).padStart(2, '0')}`;
    const el  = document.getElementById('menuQueueTimer');
    const rel = document.getElementById('resultQueueTimer');
    if (el)  el.textContent  = timeStr;
    if (rel) rel.textContent = timeStr;
}

async function playGame() {
    if (!conn || conn.state !== signalR.HubConnectionState.Connected) {
        showError('Not connected. Please wait or reload.');
        return;
    }
    _inQueue = true;

    const findBtn       = document.getElementById('findGameBtn');
    const matchmakingEl = document.getElementById('menuMatchmaking');
    if (findBtn)       { findBtn.textContent = 'Cancel Matchmaking'; findBtn.onclick = cancelQueue; }
    if (matchmakingEl) matchmakingEl.classList.remove('hidden');
    startQueueTimer();

    const resultButtons     = document.getElementById('resultButtons');
    const resultMatchmaking = document.getElementById('resultMatchmakingWrap');
    const onResultScreen    = !document.getElementById('resultScreen').classList.contains('hidden');
    if (onResultScreen) {
        if (resultButtons)     resultButtons.classList.add('hidden');
        if (resultMatchmaking) resultMatchmaking.classList.remove('hidden');
        const rel = document.getElementById('resultQueueTimer');
        if (rel) rel.textContent = '0:00';
    }

    try {
        await conn.invoke('FindGame');
    } catch (err) {
        _inQueue = false;
        stopQueueTimer();
        if (findBtn)       { findBtn.textContent = 'Find Game'; findBtn.onclick = playGame; }
        if (matchmakingEl) matchmakingEl.classList.add('hidden');
        if (resultButtons)     resultButtons.classList.remove('hidden');
        if (resultMatchmaking) resultMatchmaking.classList.add('hidden');
        showError('Failed to join queue');
    }
}

async function cancelQueue() {
    _inQueue = false;
    stopQueueTimer();
    const findBtn       = document.getElementById('findGameBtn');
    const matchmakingEl = document.getElementById('menuMatchmaking');
    if (findBtn)       { findBtn.textContent = 'Find Game'; findBtn.onclick = playGame; }
    if (matchmakingEl) { matchmakingEl.classList.add('hidden'); }
    const resultButtons     = document.getElementById('resultButtons');
    const resultMatchmaking = document.getElementById('resultMatchmakingWrap');
    if (resultButtons)     resultButtons.classList.remove('hidden');
    if (resultMatchmaking) resultMatchmaking.classList.add('hidden');
    try { if (conn && conn.state === signalR.HubConnectionState.Connected) await conn.invoke('CancelQueue'); } catch {}
}

// Game
function hideRoundModal() {
    document.getElementById('roundEndModal').classList.add('hidden');
}

function showOvertimePopup() {
    const popup = document.getElementById('overtimePopup');
    if (!popup) return;
    popup.classList.remove('hidden', 'fading');
    setTimeout(() => {
        popup.classList.add('fading');
        popup.addEventListener('animationend', () => popup.classList.add('hidden'), { once: true });
    }, 2200);
}

function startRound(data) {
    if (!matchId) return;

    hideRoundModal();
    showScreen('gameScreen');

    const isOT = data.isOvertime || (data.round > 5);
    const roundNumEl = document.getElementById('roundNum');
    if (roundNumEl) roundNumEl.textContent = isOT ? 'OT' : data.round;
    const roundLabel = document.querySelector('.round-label');
    if (roundLabel) roundLabel.innerHTML = isOT
        ? '<span style="color:#ff9500;font-weight:700;letter-spacing:0.12em">⚡ OVERTIME</span>'
        : `Round <span id="roundNum">${data.round}</span> / 5`;

    if (isOT && data.round === 6) showOvertimePopup();
    myMatchScore  = myPlayer === 1 ? data.p1Score : data.p2Score;
    oppMatchScore = myPlayer === 1 ? data.p2Score : data.p1Score;
    document.getElementById('p1Score').textContent  = myMatchScore;
    document.getElementById('p2Score').textContent  = oppMatchScore;

    const p1NameStr = myPlayer === 1 ? data.p1Name : data.p2Name; // my name
    const p2NameStr = myPlayer === 1 ? data.p2Name : data.p1Name; // opp name
    document.getElementById('p1Name').textContent = p1NameStr;  // left = me
    document.getElementById('p2Name').textContent = p2NameStr;  // right = opponent

    currentGuess = '';
    myGuesses    = [];
    oppGuesses   = [];
    keyStates    = {};
    myRoundDone  = false;
    roundActive  = true;

    renderBoard('myBoard',  myGuesses,  false);
    renderBoard('oppBoard', oppGuesses, true);
    renderKeyboard();
    startTimer(60);

    populateGamePanels(p1NameStr, p2NameStr);
}

function startTimer(seconds) {
    if (timerInterval) clearInterval(timerInterval);
    let remaining = seconds;
    const el = document.getElementById('timer');
    el.textContent = remaining;
    el.classList.remove('warning');
    timerInterval = setInterval(() => {
        remaining--;
        el.textContent = remaining;
        el.classList.toggle('warning', remaining <= 10);
        if (remaining <= 0) clearInterval(timerInterval);
    }, 1000);
}

function renderBoard(boardId, guesses, mini, skipColorRow = -1) {
    const board = document.getElementById(boardId);
    board.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const row = document.createElement('div');
        row.className = 'row';
        for (let j = 0; j < 5; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            if (guesses[i]) {
                if (!mini) tile.textContent = guesses[i].word[j];
                if (i !== skipColorRow) {
                    const s = guesses[i].result[j];
                    tile.classList.add(s === 'G' ? 'correct' : s === 'Y' ? 'present' : 'absent');
                }
            } else if (i === guesses.length && !mini) {
                if (currentGuess[j]) { tile.textContent = currentGuess[j]; tile.classList.add('filled'); }
            }
            row.appendChild(tile);
        }
        board.appendChild(row);
    }
}

// flips each tile in the row one by one to reveal green/yellow/gray
async function animateRowReveal(boardId, rowIndex, results) {
    const board = document.getElementById(boardId);
    const rows  = board.querySelectorAll('.row');
    if (!rows[rowIndex]) return;
    const tiles = rows[rowIndex].querySelectorAll('.tile');

    const colorClass = { G: 'correct', Y: 'present', X: 'absent' };

    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const cls  = colorClass[results[i]] || 'absent';

        await delay(i * 55);

        tile.style.transition = 'transform 0.065s ease-in';
        tile.style.transform  = 'scaleY(0)';

        await delay(70);

        tile.classList.add(cls);

        tile.style.transition = 'transform 0.065s ease-out';
        tile.style.transform  = 'scaleY(1)';

        await delay(70);
    }
}

function renderKeyboard() {
    const kb = document.getElementById('keyboard');
    kb.innerHTML = '';
    KEYBOARD_LAYOUT.forEach(row => {
        const div = document.createElement('div');
        div.className = 'keyboard-row';
        row.forEach(letter => {
            const btn = document.createElement('button');
            btn.className = 'key' + (letter === 'ENTER' || letter === 'BACK' ? ' wide' : '');
            btn.textContent = letter === 'BACK' ? '⌫' : letter;
            if (keyStates[letter]) btn.classList.add(keyStates[letter]);
            btn.addEventListener('click', () => handleKey(letter));
            div.appendChild(btn);
        });
        kb.appendChild(div);
    });
}

function animateKey(key) {
    const kb = document.getElementById('keyboard');
    if (!kb) return;
    const label = key === 'BACK' ? '⌫' : key;
    for (const btn of kb.querySelectorAll('.key')) {
        if (btn.textContent === label) {
            btn.classList.remove('tapped');
            void btn.offsetWidth;
            btn.classList.add('tapped');
            btn.addEventListener('animationend', () => btn.classList.remove('tapped'), { once: true });
            break;
        }
    }
}

function animateTilePop() {
    const board = document.getElementById('myBoard');
    const rows  = board.querySelectorAll('.row');
    const row   = rows[myGuesses.length];
    if (!row) return;
    const tiles = row.querySelectorAll('.tile');
    const tile  = tiles[currentGuess.length - 1];
    if (!tile) return;
    tile.classList.remove('pop');
    void tile.offsetWidth;
    tile.classList.add('pop');
}

function shakeCurrentRow() {
    const board = document.getElementById('myBoard');
    const rows  = board.querySelectorAll('.row');
    const row   = rows[myGuesses.length];
    if (!row) return;
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
    row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
}

function handleKey(key) {
    if (!roundActive || myRoundDone) return;
    animateKey(key);
    if (key !== 'ENTER') soundKeyPress();
    if (key === 'ENTER') {
        submitGuess();
    } else if (key === 'BACK') {
        currentGuess = currentGuess.slice(0, -1);
        renderBoard('myBoard', myGuesses, false);
    } else if (currentGuess.length < 5) {
        currentGuess += key;
        renderBoard('myBoard', myGuesses, false);
        animateTilePop();
    }
}

let _guessSubmitting = false; // prevents double-submitting on fast enter presses

async function submitGuess() {
    if (currentGuess.length !== 5) return showError('Word must be 5 letters');
    if (!roundActive || myRoundDone) return;
    if (_guessSubmitting) return;
    _guessSubmitting = true;
    const wordToSubmit = currentGuess;
    currentGuess = '';
    renderBoard('myBoard', myGuesses, false);
    try {
        // 6-second timeout so a dropped SignalR call never freezes the input
        const res = await Promise.race([
            conn.invoke('Guess', matchId, wordToSubmit),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
        ]);
        if (res && !res.success && res.error) {
            // "No active round" / "already finished" means the round ended simultaneously
            // with the guess — not an input error, so just let the RoundEnd event handle it.
            const roundEndedErrors = ['no active round', 'you already finished this round'];
            if (roundEndedErrors.some(e => res.error.toLowerCase().includes(e))) return;
            currentGuess = wordToSubmit;
            renderBoard('myBoard', myGuesses, false);
            showError(res.error);
            shakeCurrentRow();
            soundInvalid();
        }
    } catch {
        currentGuess = wordToSubmit;
        renderBoard('myBoard', myGuesses, false);
        showError('Failed to submit guess');
    } finally {
        _guessSubmitting = false;
    }
}

function handleGuess(data) {
    if (!matchId) return;
    const guess = { word: data.word, result: data.result };
    if (data.player === myPlayer) {
        const rowIndex = myGuesses.length;
        myGuesses.push(guess);
        currentGuess = '';

        if (data.correct) { myRoundDone = true; soundCorrect(); }
        else if (myGuesses.length >= 6) { myRoundDone = true; showInfo('No guesses left — waiting for opponent…'); }

        renderBoard('myBoard', myGuesses, false, rowIndex);
        const p = animateRowReveal('myBoard', rowIndex, data.result);
        if (data.correct) revealAnimationPromise = p;
        p.then(() => {
            if (data.correct) revealAnimationPromise = null;
            for (let i = 0; i < 5; i++) {
                const l = data.word[i], s = data.result[i];
                if      (s === 'G') keyStates[l] = 'correct';
                else if (s === 'Y' && keyStates[l] !== 'correct') keyStates[l] = 'present';
                else if (s === 'X' && !keyStates[l]) keyStates[l] = 'absent';
            }
            renderKeyboard();
            if (pendingRoundEndData) {
                showRoundEndModal(pendingRoundEndData);
                pendingRoundEndData = null;
            }
        });
    } else {
        oppGuesses.push(guess);
        renderBoard('oppBoard', oppGuesses, true);
    }
}

function showRoundEndModal(data) {
    const word  = (data.word || '').toUpperCase();
    const tied  = data.winner == null;
    const iWon  = !tied && data.winner === currentUser.id;

    document.getElementById('roundEndResult').textContent =
        tied  ? "⏱ Time's up!" :
        iWon  ? '✅ You got it!' :
                '❌ Opponent got it!';
    document.getElementById('roundEndWord').textContent = word;
    document.getElementById('roundEndSub').textContent  = 'Next round starting…';
    document.getElementById('roundEndModal').classList.remove('hidden');

    if (!tied) { iWon ? soundRoundWin() : soundRoundLose(); }
}

function endRound(data) {
    if (!matchId) return;
    clearInterval(timerInterval);
    roundActive = false;

    myMatchScore  = myPlayer === 1 ? data.p1Score : data.p2Score;
    oppMatchScore = myPlayer === 1 ? data.p2Score : data.p1Score;
    document.getElementById('p1Score').textContent = myMatchScore;
    document.getElementById('p2Score').textContent = oppMatchScore;

    const iWon = data.winner === currentUser.id;
    if (iWon && revealAnimationPromise) {
        pendingRoundEndData = data;
        return;
    }

    showRoundEndModal(data);
}

function endMatch(data) {
    if (!matchId) return;
    matchId = null;
    hideRoundModal();
    clearInterval(timerInterval);
    roundActive = myRoundDone = true;

    currentUser.points    = data.points;
    currentUser.wins      = data.wins;
    currentUser.losses    = data.losses;
    currentUser.rank      = data.rank      || currentUser.rank;
    currentUser.rankEmoji = data.rankEmoji || currentUser.rankEmoji;

    const tied = data.winner == null;
    const iWon = !tied && data.winner === currentUser.id;

    document.getElementById('resultTitle').textContent    = tied ? "It's a draw!" : iWon ? 'You won! 🎉' : 'You lost.';
    document.getElementById('resultMyScore').textContent  = data.myScore;
    document.getElementById('resultOppScore').textContent = data.oppScore;
    if (!tied) { iWon ? soundMatchWin() : soundMatchLose(); }
    const triggerBar = renderRankProgress(data.points, data.pointsDelta ?? 0);
    populateResultPlayers(data.points);
    document.getElementById('resultButtons')?.classList.remove('hidden');
    document.getElementById('resultMatchmakingWrap')?.classList.add('hidden');
    showScreen('resultScreen');
    triggerBar();
}

function populateResultPlayers(myPoints) {
    const myAv = document.getElementById('resultMyAvatar');
    if (myAv) {
        if (userProfile?.picture) {
            myAv.style.backgroundImage    = `url(${userProfile.picture})`;
            myAv.style.backgroundSize     = 'cover';
            myAv.style.backgroundPosition = 'center';
            myAv.textContent = '';
        } else {
            myAv.style.backgroundImage = '';
            myAv.textContent = (currentUser?.username || '?').substring(0, 2).toUpperCase();
        }
        applyBorderToAvatar(myAv, userProfile?.border || 'default');
    }
    const myNameEl = document.getElementById('resultMyName');
    if (myNameEl) myNameEl.textContent = capName(currentUser?.username || '');

    const myRankEl = document.getElementById('resultMyRank');
    if (myRankEl) {
        const r = getRank(myPoints ?? currentUser?.points ?? 0);
        myRankEl.innerHTML = rankIconHTML(r.name, r.emoji, 14) + ' ' + escHtml(r.name);
    }
    const myTitleEl = document.getElementById('resultMyTitle');
    if (myTitleEl) {
        const tid = userProfile?.title || '';
        const def = TITLES.find(t => t.id === tid);
        if (def && tid) {
            myTitleEl.textContent = def.label;
            myTitleEl.className = 'result-player-title' + (def.tier ? ' tier-' + def.tier : '');
        } else {
            myTitleEl.className = 'result-player-title hidden';
        }
    }

    const oppAv = document.getElementById('resultOppAvatar');
    if (oppAv) {
        if (_opponentProfile?.picture) {
            oppAv.style.backgroundImage    = `url(${_opponentProfile.picture})`;
            oppAv.style.backgroundSize     = 'cover';
            oppAv.style.backgroundPosition = 'center';
            oppAv.textContent = '';
        } else {
            oppAv.style.backgroundImage = '';
            oppAv.textContent = (_opponentName || '?').substring(0, 2).toUpperCase();
        }
        applyBorderToAvatar(oppAv, _opponentProfile?.border || 'default');
    }
    const oppNameEl = document.getElementById('resultOppName');
    if (oppNameEl) oppNameEl.textContent = capName(_opponentName || 'Opponent');

    const oppRankEl = document.getElementById('resultOppRank');
    if (oppRankEl) {
        const rn = _opponentProfile?.rank || '';
        oppRankEl.innerHTML = rn ? rankIconHTMLFromName(rn, 14) + ' ' + escHtml(rn) : '';
    }
    const oppTitleEl = document.getElementById('resultOppTitle');
    if (oppTitleEl) {
        const tid = _opponentProfile?.title || '';
        const def = TITLES.find(t => t.id === tid);
        if (def && tid) {
            oppTitleEl.textContent = def.label;
            oppTitleEl.className = 'result-player-title' + (def.tier ? ' tier-' + def.tier : '');
        } else {
            oppTitleEl.className = 'result-player-title hidden';
        }
    }
}

document.addEventListener('keydown', e => {
    if (document.getElementById('gameScreen').classList.contains('hidden')) return;
    if (!roundActive || myRoundDone) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter') {
        animateKey('ENTER');
        submitGuess();
    } else if (e.key === 'Backspace') {
        animateKey('BACK');
        currentGuess = currentGuess.slice(0, -1);
        renderBoard('myBoard', myGuesses, false);
    } else if (/^[a-zA-Z]$/.test(e.key) && currentGuess.length < 5) {
        const k = e.key.toUpperCase();
        animateKey(k);
        soundKeyPress();
        currentGuess += k;
        renderBoard('myBoard', myGuesses, false);
        animateTilePop();
    }
});

window.addEventListener('load', async () => {
    document.getElementById('siteHeader')?.classList.add('hidden');
    applySettings(loadStoredSettings());
    _registerMusicOnInteraction(); // unlock music after refresh if user has it enabled
    const token = sessionStorage.getItem('token');
    if (!token) return showScreen('authScreen');

    let userData = null;
    try {
        const res  = await fetch('/api/auth/verify', { headers:{ 'Authorization': 'Bearer ' + token } });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!data.success) throw new Error();
        userData = data.user;
    } catch {
        sessionStorage.removeItem('token');
        return showScreen('authScreen');
    }

    currentUser = userData;
    await loadSettingsFromServer(); // sync server settings on refresh
    applySettings(loadStoredSettings());
    try { await initSignalR(); } catch {}
    showMenu();
    startFriendBadgePolling();
});

// Small helpers
function escHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function makeSmallAvatar(username, picture, borderId, sizePx = 26) {
    const border = BORDERS.find(b => b.id === borderId) || BORDERS[0];
    const el = document.createElement('div');
    el.className = 'lb-avatar';
    el.style.cssText =
        `width:${sizePx}px;height:${sizePx}px;` +
        `border-color:${border.color || '#3a3a3c'};`;

    if (picture) {
        el.style.backgroundImage    = `url(${picture})`;
        el.style.backgroundSize     = 'cover';
        el.style.backgroundPosition = 'center';
    } else {
        el.textContent = (username || '?').substring(0, 2).toUpperCase();
    }
    return el;
}

// Profile
let userProfile = null;

// Border definitions
const BORDERS = [
    { id:'default',     label:'Default',     cls:null,                       color:'#3a3a3c', req:null },
    { id:'bronze',      label:'Bronze',      cls:'avatar-border-bronze',     color:'#CD7F32', req:{ type:'points', value:0,    display:'Reach Bronze rank'      } },
    { id:'silver',      label:'Silver',      cls:'avatar-border-silver',     color:'#C0C0C0', req:{ type:'points', value:1000, display:'Reach Silver (1000 pts)' } },
    { id:'gold',        label:'Gold',        cls:'avatar-border-gold',       color:'#FFD700', req:{ type:'points', value:2000, display:'Reach Gold (2000 pts)'   } },
    { id:'platinum',    label:'Platinum',    cls:'avatar-border-platinum',   color:'#E5E4E2', req:{ type:'points', value:3000, display:'Reach Platinum (3000 pts)'} },
    { id:'diamond',     label:'Diamond',     cls:'avatar-border-diamond',    color:'#90E0EF', req:{ type:'points', value:4000, display:'Reach Diamond (4000 pts)' } },
    { id:'champion',    label:'Champion',    cls:'avatar-border-champion',   color:'#F77F00', req:{ type:'points', value:5000, display:'Reach Champion (5000 pts)'} },
    { id:'master',      label:'Master',      cls:'avatar-border-master',     color:'#C77DFF', req:{ type:'points', value:6000, display:'Reach Master (6000 pts)'  } },
    { id:'grandmaster', label:'Grandmaster', cls:'avatar-border-grandmaster',color:'#FF79C6', req:{ type:'points', value:7000, display:'Reach Grandmaster (7000 pts)'} },
    { id:'lexicongod',  label:'Lexicon God', cls:'avatar-border-lexicongod', color:'#FFD700', req:{ type:'points', value:8000, display:'Reach Lexicon God (8000 pts)'} },
    { id:'neon',        label:'Neon',        cls:'avatar-border-neon',       color:'#06d6a0', req:{ type:'wins', value:10,  display:'Win 10 matches'    } },
    { id:'rainbow',     label:'Rainbow',     cls:'avatar-border-rainbow',    color:'#ff9900', req:{ type:'wins', value:25,  display:'Win 25 matches'    } },
    { id:'veteran',     label:'Veteran',     cls:'avatar-border-veteran',    color:'#B5838D', req:{ type:'wins', value:50,  display:'Win 50 matches'    } },
    { id:'centurion',   label:'Centurion',   cls:'avatar-border-centurion',  color:'#C9A227', req:{ type:'wins', value:100, display:'Win 100 matches'   } },
    { id:'ember',       label:'Ember',       cls:'avatar-border-ember',      color:'#F48C06', req:{ type:'bestStreak', value:3,  display:'3-win streak'  } },
    { id:'blaze',       label:'Blaze',       cls:'avatar-border-blaze',      color:'#DC2F02', req:{ type:'bestStreak', value:5,  display:'5-win streak'  } },
    { id:'inferno',     label:'Inferno',     cls:'avatar-border-inferno',    color:'#9D0208', req:{ type:'bestStreak', value:10, display:'10-win streak' } },
    { id:'bullseye',    label:'Bullseye',    cls:'avatar-border-bullseye',   color:'#0096C7', req:{ type:'fastestSolve', value:1, display:'Solve in 1 guess' } },
    { id:'precision',   label:'Precision',   cls:'avatar-border-precision',  color:'#00B4D8', req:{ type:'avgGuesses',   value:2, lte:true, display:'Avg ≤ 2 guesses' } },
];

// Title definitions
const TITLES = [
    { id:'',             label:'No Title',         tier:null,           req:null },
    { id:'bronze_t',     label:'Word Rookie',       tier:'bronze',       req:{ type:'points', value:0,    display:'Reach Bronze'      } },
    { id:'silver_t',     label:'Challenger',        tier:'silver',       req:{ type:'points', value:1000, display:'Reach Silver'      } },
    { id:'gold_t',       label:'Contender',         tier:'gold',         req:{ type:'points', value:2000, display:'Reach Gold'        } },
    { id:'platinum_t',   label:'Word Sage',         tier:'platinum',     req:{ type:'points', value:3000, display:'Reach Platinum'    } },
    { id:'diamond_t',    label:'Wordsmith',         tier:'diamond',      req:{ type:'points', value:4000, display:'Reach Diamond'     } },
    { id:'champion_t',   label:'Champion',          tier:'champion',     req:{ type:'points', value:5000, display:'Reach Champion'    } },
    { id:'master_t',     label:'Word Master',       tier:'master',       req:{ type:'points', value:6000, display:'Reach Master'      } },
    { id:'gm_t',         label:'Grandmaster',       tier:'grandmaster',  req:{ type:'points', value:7000, display:'Reach Grandmaster' } },
    { id:'lexicongod_t', label:'Lexicon God',       tier:'lexicongod',   req:{ type:'points', value:8000, display:'Reach Lexicon God' } },
    { id:'first_win',    label:'First Blood',       tier:'achievement',  req:{ type:'wins', value:1,   display:'1 win'    } },
    { id:'wordsmith_w',  label:'Wordsmith',         tier:'achievement',  req:{ type:'wins', value:10,  display:'10 wins'  } },
    { id:'veteran_t',    label:'Veteran',           tier:'achievement',  req:{ type:'wins', value:50,  display:'50 wins'  } },
    { id:'centurion_t',  label:'Centurion',         tier:'achievement',  req:{ type:'wins', value:100, display:'100 wins' } },
    { id:'legend_t',     label:'Legend',            tier:'achievement',  req:{ type:'wins', value:500, display:'500 wins' } },
    { id:'quickmind',    label:'Quick Mind',        tier:'achievement',  req:{ type:'fastestSolve', value:1, exact:true, display:'Solve in 1 guess'  } },
    { id:'sharpshooter', label:'Sharpshooter',      tier:'achievement',  req:{ type:'avgGuesses',   value:2, lte:true,   display:'Avg ≤ 2 guesses'  } },
    { id:'efficient',    label:'Efficient',         tier:'achievement',  req:{ type:'avgGuesses',   value:3, lte:true,   display:'Avg ≤ 3 guesses'  } },
    { id:'onfire',       label:'On Fire 🔥',        tier:'achievement',  req:{ type:'bestStreak', value:3,  display:'3-win streak'  } },
    { id:'unstoppable',  label:'Unstoppable',       tier:'achievement',  req:{ type:'bestStreak', value:5,  display:'5-win streak'  } },
    { id:'legendary',    label:'Legendary',         tier:'achievement',  req:{ type:'bestStreak', value:10, display:'10-win streak' } },
];

// Unlock helpers
function _statVal(r, stats) {
    if (r.type === 'points') return (stats?.points ?? currentUser?.points ?? 0);
    if (r.type === 'wins')   return (stats?.wins   ?? currentUser?.wins   ?? 0);
    return stats ? (stats[r.type] ?? 0) : 0;
}

function isBorderUnlocked(border, stats) {
    if (!border.req) return true;
    const r = border.req;
    const v = _statVal(r, stats);
    if (r.lte)   return v > 0 && v <= r.value;
    if (r.type === 'fastestSolve') return v > 0 && v <= r.value;
    return v >= r.value;
}

function isTitleUnlocked(title, stats) {
    if (!title.req) return true;
    const r = title.req;
    const v = _statVal(r, stats);
    if (r.exact) return v > 0 && v <= r.value;
    if (r.lte)   return v > 0 && v <= r.value;
    return v >= r.value;
}

function applyBorderToAvatar(el, borderId) {
    BORDERS.forEach(b => { if (b.cls) el.classList.remove(b.cls); });
    el.style.borderColor = '';
    el.style.boxShadow   = '';

    const border = BORDERS.find(b => b.id === borderId) || BORDERS[0];
    if (border.cls) {
        el.classList.add(border.cls);
    } else {
        el.style.borderColor = border.color || '#3a3a3c';
    }
}

function updateMenuAvatar() {
    const el = document.getElementById('menuAvatar');
    if (!el || !currentUser) return;
    if (userProfile && userProfile.picture) {
        el.style.backgroundImage    = `url(${userProfile.picture})`;
        el.style.backgroundSize     = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent              = '';
    } else {
        el.style.backgroundImage = '';
        el.textContent = currentUser.username.substring(0, 2).toUpperCase();
    }
    applyBorderToAvatar(el, userProfile ? userProfile.border : 'default');
}

function updateMenuBanner() {
    const el = document.getElementById('menuBanner');
    if (!el) return;
    if (userProfile?.banner) {
        el.style.backgroundImage    = `url(${userProfile.banner})`;
        el.style.backgroundSize     = 'cover';
        el.style.backgroundPosition = 'center';
    } else {
        el.style.backgroundImage = '';
    }
}

function triggerBannerUpload(event) {
    event.stopPropagation();
    document.getElementById('bannerPicInput').click();
}

async function handleBannerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    try {
        const dataUrl = await resizeImage(file, 640, 200);
        if (userProfile) userProfile.banner = dataUrl;

        updateMenuBanner();
        // Sync banner in profile modal if open
        const modalBanner = document.getElementById('profileModalBanner');
        if (modalBanner) {
            modalBanner.style.backgroundImage    = `url(${dataUrl})`;
            modalBanner.style.backgroundSize     = 'cover';
            modalBanner.style.backgroundPosition = 'center';
        }

        const token = sessionStorage.getItem('token');
        if (!token) return;
        await fetch('/api/profile/customization', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify({ banner: dataUrl }),
        });
        showSuccess('Banner updated!');
    } catch {
        showError('Failed to update banner');
    }
}

async function fetchUserProfile() {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        const res = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) return;
        userProfile = await res.json();
        updateMenuAvatar();
        updateMenuBanner();
        updateMenuTitleBadge();
        updateMenuStreakBadge();
    } catch {}
}

function updateMenuStreakBadge() {
    const el = document.getElementById('menuStreakBadge');
    if (!el) return;
    const streak = userProfile?.stats?.currentStreak ?? 0;
    if (streak > 0) {
        el.textContent = '🔥' + streak;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function updateMenuTitleBadge() {
    const badge = document.getElementById('menuTitleBadge');
    if (!badge) return;
    const titleId = userProfile?.title || '';
    const def     = titleId ? TITLES.find(t => t.id === titleId) : null;
    if (def && titleId) {
        badge.textContent = def.label;
        badge.className = 'menu-title-badge' + (def.tier ? ' tier-' + def.tier : '');
        badge.classList.remove('hidden');
    } else {
        badge.className = 'menu-title-badge hidden';
    }
}

// Open / close profile modal
function openProfile() {
    if (!currentUser) return;
    const modal = document.getElementById('profileModal');
    if (!modal) return;

    document.getElementById('profileUsername').textContent = capName(currentUser.username);
    const r   = getRank(currentUser.points || 0);
    document.getElementById('profileRankBadge').innerHTML =
        rankIconHTML(r.name, r.emoji, 16) + ' ' + escHtml(r.name);

    const titleBadge = document.getElementById('profileTitleBadge');
    const activeTitleId = userProfile ? userProfile.title : '';
    const titleDef = TITLES.find(t => t.id === activeTitleId);
    if (titleDef && activeTitleId) {
        titleBadge.textContent = titleDef.label;
        titleBadge.className = 'profile-title-badge' + (titleDef.tier ? ' tier-' + titleDef.tier : '');
        titleBadge.classList.remove('hidden');
    } else {
        titleBadge.className = 'profile-title-badge hidden';
    }

    const profAvEl = document.getElementById('profileAvatarEl');
    if (userProfile && userProfile.picture) {
        profAvEl.style.backgroundImage    = `url(${userProfile.picture})`;
        profAvEl.style.backgroundSize     = 'cover';
        profAvEl.style.backgroundPosition = 'center';
        profAvEl.textContent              = '';
    } else {
        profAvEl.style.backgroundImage = '';
        profAvEl.textContent = currentUser.username.charAt(0).toUpperCase();
    }
    applyBorderToAvatar(profAvEl, userProfile ? userProfile.border : 'default');

    const modalBanner = document.getElementById('profileModalBanner');
    if (modalBanner) {
        if (userProfile?.banner) {
            modalBanner.style.backgroundImage    = `url(${userProfile.banner})`;
            modalBanner.style.backgroundSize     = 'cover';
            modalBanner.style.backgroundPosition = 'center';
        } else {
            modalBanner.style.backgroundImage = '';
        }
    }

    // Bio
    const bioEl = document.getElementById('profileBio');
    if (bioEl) bioEl.value = userProfile?.bio || '';

    modal.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
    modal.querySelectorAll('.profile-tab')[0].classList.add('active');
    document.getElementById('profileTabStats').classList.remove('hidden');
    document.getElementById('profileTabBorders').classList.add('hidden');
    document.getElementById('profileTabTitles').classList.add('hidden');

    modal.classList.remove('hidden');
    loadProfileData();
}

function closeProfile() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.classList.add('hidden');
}

function openProfileTab(tabName, btnEl) {
    document.getElementById('profileTabStats').classList.toggle('hidden',   tabName !== 'stats');
    document.getElementById('profileTabBorders').classList.toggle('hidden', tabName !== 'borders');
    document.getElementById('profileTabTitles').classList.toggle('hidden',  tabName !== 'titles');
    document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
}

// Load + render profile data
async function loadProfileData() {
    const token = sessionStorage.getItem('token');
    if (!token) return;

    document.getElementById('profileStatGrid').innerHTML = '<div class="lb-loading">Loading…</div>';
    document.getElementById('profileExtraStats').classList.add('hidden');

    try {
        const res  = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) throw new Error();
        const data = await res.json();
        userProfile = data;

        const profAvEl = document.getElementById('profileAvatarEl');
        if (profAvEl) applyBorderToAvatar(profAvEl, data.border || 'default');

        const modalBanner = document.getElementById('profileModalBanner');
        if (modalBanner) {
            if (data.banner) {
                modalBanner.style.backgroundImage    = `url(${data.banner})`;
                modalBanner.style.backgroundSize     = 'cover';
                modalBanner.style.backgroundPosition = 'center';
            } else {
                modalBanner.style.backgroundImage = '';
            }
        }
        updateMenuBanner();

        const bioEl = document.getElementById('profileBio');
        if (bioEl) bioEl.value = data.bio || '';

        renderProfileStats(data);
        renderBorderPicker(data.border || 'default');
        renderTitlePicker(data.title || '', data.stats);
        updateMenuAvatar();
        updateMenuStreakBadge();
    } catch {
        document.getElementById('profileStatGrid').innerHTML = '<div class="lb-loading">Failed to load</div>';
    }
}

function renderProfileStats(data) {
    const s = data.stats || {};
    const winsN   = Number(s.wins)   || 0;
    const lossesN = Number(s.losses) || 0;
    const total   = winsN + lossesN;

    const cards = [
        { label: 'Wins',          value: winsN },
        { label: 'Losses',        value: lossesN },
        { label: 'Win Rate',      value: total > 0 ? Math.round(winsN * 100 / total) + '%' : '0%' },
        { label: 'Points',        value: Number(s.points) || 0 },
        { label: 'Avg Guesses',   value: s.avgGuesses > 0 ? Number(s.avgGuesses).toFixed(1) : '—' },
        { label: 'Fastest Solve', value: s.fastestSolve > 0 ? String(s.fastestSolve) : '—' },
        { label: 'Streak',        value: s.currentStreak ?? 0 },
        { label: 'Best Streak',   value: s.bestStreak    ?? 0 },
    ];

    const grid = document.getElementById('profileStatGrid');
    grid.innerHTML = '';
    cards.forEach(c => {
        const card = document.createElement('div');
        card.className = 'pstat-card';
        card.innerHTML = `<div class="pstat-value">${c.value}</div><div class="pstat-label">${c.label}</div>`;
        grid.appendChild(card);
    });

    const profStreakBadge = document.getElementById('profileStreakBadge');
    if (profStreakBadge) {
        const streak = s.currentStreak ?? 0;
        profStreakBadge.textContent = streak > 0 ? '🔥' + streak : '';
        profStreakBadge.classList.toggle('hidden', streak === 0);
    }

    const fgWrap = document.getElementById('profileFirstGuessWrap');
    const fgWord = document.getElementById('profileFirstGuess');
    if (fgWrap && fgWord) {
        fgWord.textContent = data.commonFirstGuess ? data.commonFirstGuess.toUpperCase() : 'No data';
        fgWord.classList.toggle('no-data-word', !data.commonFirstGuess);
        fgWrap.classList.remove('hidden');
    }

    const favWrap = document.getElementById('profileFavWordWrap');
    const favWord = document.getElementById('profileFavWord');
    if (favWrap && favWord) {
        favWord.textContent = data.favoriteWord ? data.favoriteWord.toUpperCase() : 'No data';
        favWord.classList.toggle('no-data-word', !data.favoriteWord);
        favWrap.classList.remove('hidden');
    }

    document.getElementById('profileExtraStats').classList.remove('hidden');
}

// Border picker
function renderBorderPicker(activeBorderId) {
    const grid  = document.getElementById('borderGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const stats = userProfile?.stats || null;

    BORDERS.forEach(b => {
        const unlocked = isBorderUnlocked(b, stats);
        const isActive = b.id === activeBorderId;

        const el = document.createElement('div');
        el.className = 'border-swatch' +
            (isActive   ? ' selected' : '') +
            (unlocked   ? ''          : ' locked');
        if (unlocked) el.onclick = () => selectBorder(b.id);

        const circle = document.createElement('div');
        circle.className = 'border-swatch-circle';
        if (b.cls) {
            circle.classList.add(b.cls);
        } else {
            circle.style.borderColor = b.color || '#3a3a3c';
        }

        if (b.req?.type === 'points' && b.id !== 'default') {
            const slug = b.id === 'lexicongod' ? 'lexicon-god' : b.id;
            const img = document.createElement('img');
            img.src = `/img/ranks/${slug}.png`;
            img.style.cssText = 'width:22px;height:22px;object-fit:contain;opacity:0.9;pointer-events:none;';
            img.onerror = () => img.remove();
            circle.appendChild(img);
        }

        const label = document.createElement('div');
        label.className   = 'border-swatch-label';
        label.textContent = b.label;

        el.appendChild(circle);
        el.appendChild(label);

        if (b.req?.display) {
            const req = document.createElement('div');
            req.className   = 'border-swatch-req' + (unlocked ? ' unlocked' : '');
            req.textContent = (unlocked ? '' : '\uD83D\uDD12 ') + b.req.display;
            el.appendChild(req);
        }

        grid.appendChild(el);
    });
}

async function selectBorder(borderId) {
    if (userProfile) userProfile.border = borderId;
    renderBorderPicker(borderId);

    const profAvEl = document.getElementById('profileAvatarEl');
    if (profAvEl) applyBorderToAvatar(profAvEl, borderId);
    updateMenuAvatar();

    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        await fetch('/api/profile/customization', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify({ border: borderId }),
        });
    } catch {}
}

// Title picker
function renderTitlePicker(activeTitleId, stats) {
    const list = document.getElementById('titleList');
    if (!list) return;
    list.innerHTML = '';

    TITLES.forEach(t => {
        const unlocked   = isTitleUnlocked(t, stats);
        const isSelected = t.id === activeTitleId;

        const el = document.createElement('div');
        el.className = 'title-item' +
            (isSelected ? ' selected' : '') +
            (unlocked   ? ''          : ' locked');

        if (unlocked) el.onclick = () => selectTitle(t.id);

        const tierClass = t.tier ? ` tier-${t.tier}` : '';
        el.innerHTML =
            `<span class="title-item-name${tierClass}">${t.label}</span>` +
            (t.req ? `<span class="title-item-req">${unlocked ? t.req.display : '🔒 ' + t.req.display}</span>` : `<span class="title-item-req"></span>`) +
            `<span class="title-item-check">${isSelected ? '✓' : ''}</span>`;

        list.appendChild(el);
    });
}

async function selectTitle(titleId) {
    const prevStats = userProfile ? userProfile.stats : null;
    if (userProfile) userProfile.title = titleId;
    renderTitlePicker(titleId, prevStats);

    const titleBadge = document.getElementById('profileTitleBadge');
    if (titleBadge) {
        const def = TITLES.find(t => t.id === titleId);
        if (def && titleId) {
            titleBadge.textContent = def.label;
            titleBadge.className = 'profile-title-badge' + (def.tier ? ' tier-' + def.tier : '');
            titleBadge.classList.remove('hidden');
        } else {
            titleBadge.className = 'profile-title-badge hidden';
        }
    }
    updateMenuTitleBadge();

    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        await fetch('/api/profile/customization', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify({ title: titleId }),
        });
    } catch {}
}

// Bio
let _bioSaveTimer = null;

function onBioInput(textarea) {
    clearTimeout(_bioSaveTimer);
    _bioSaveTimer = setTimeout(() => saveBio(textarea.value), 1500);
}

async function saveBio(text) {
    const token = sessionStorage.getItem('token');
    if (!token) return;
    try {
        await fetch('/api/profile/bio', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify({ bio: text }),
        });
        if (userProfile) userProfile.bio = text;
    } catch {}
}

// Profile picture upload
function triggerPicUpload() {
    document.getElementById('profilePicInput').click();
}

async function handlePicUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    try {
        const dataUrl = await resizeImage(file, 256, 256);

        const profAvEl = document.getElementById('profileAvatarEl');
        if (profAvEl) {
            profAvEl.style.backgroundImage    = `url(${dataUrl})`;
            profAvEl.style.backgroundSize     = 'cover';
            profAvEl.style.backgroundPosition = 'center';
            profAvEl.textContent              = '';
        }

        if (userProfile) userProfile.picture = dataUrl;
        updateMenuAvatar();

        const token = sessionStorage.getItem('token');
        if (!token) return;
        await fetch('/api/profile/picture', {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify({ picture: dataUrl }),
        });
        showSuccess('Profile picture updated!');
    } catch {
        showError('Failed to update picture');
    }
}

function resizeImage(file, maxW, maxH) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; } }
                else       { if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; } }
                const canvas = document.createElement('canvas');
                canvas.width  = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
