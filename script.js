/* =========================================================
   BINARY / IP CONVERSION ACTIVITY — CONFIG
   Each phase is configured independently: enable/disable it and set its
   own question count (and, where relevant, its own bit width/decimal
   range/CIDR list) without affecting any other phase.
========================================================= */
const QUESTION_CONFIG = {
    // Phase 1: Decimal -> Binary
    phase1: {
        enabled: false,
        numQuestions: 5,
        bitWidth: 8,
        decMin: 0,
        decMax: 255
    },

    // Phase 2: Binary -> Decimal
    phase2: {
        enabled: false,
        numQuestions: 5,
        bitWidth: 8,
        decMin: 0,
        decMax: 255
    },

    // Phase 3: IP address, Decimal -> Binary
    phase3: {
        enabled: false,
        numQuestions: 4
    },

    // Phase 4: IP address, Binary -> Decimal
    phase4: {
        enabled: false,
        numQuestions: 4
    },

    // Phase 5: Subnet mask, CIDR -> dotted-decimal
    phase5: {
        enabled: false,
        numQuestions: 10,
        cidrList: "8,10,16,18,24,25,26,27,28,29,30"
    },

    // Phase 6: Subnet mask, dotted-decimal -> Binary
    phase6: {
        enabled: false,
        numQuestions: 10,
        cidrList: "8,10,16,18,24,25,26,27,28,29,30"
    },

    // Phase 7: classful CIDR identification — given an IP address, identify
    // its default CIDR prefix based on address class (A: 1–126 -> /8,
    // B: 128–191 -> /16, C: 192–223 -> /24). Loopback (127.x) is excluded.
    phase7: {
        enabled: false,
        numQuestions: 10
    },

    // Atom 1: The Constraint (Bit Question) — given a classful network and
    // a minimum subnets-OR-hosts requirement, the student borrows bits by
    // clicking a Panel-2-style bit grid until the requirement is exactly
    // satisfied. Scored like every other phase.
    atom1: {
        enabled: true,
        numQuestions: 10
    },

    // Atom 2: The Mask Assembly (Interesting Octet) — given a host IP and a
    // classless CIDR, the student assembles the subnet mask by toggling bits
    // in a Panel-2-style grid: classful bits are locked to 1 by default,
    // everything else starts at 0 and toggles independently on click. Graded
    // all-or-nothing, like Atom 1 (1 point total).
    atom2: {
        enabled: true,
        numQuestions: 6
    },

    // Atom 3: The Space Map (Front & Back Subnets) — given a classful
    // network and a borrowed-bit count, the student clicks bits to build
    // the binary subnet ID for the first 4 and last 4 subnets in that
    // borrowed-bit range (8 rows total). Scored all-or-nothing (1 point),
    // like Atom 2.
    atom3: {
        enabled: true,
        numQuestions: 6
    },

    // Atom 4: The Boundaries — given one subnet ID, fill the remaining
    // host bits twice: all zeroes for the network ID and all ones for the
    // broadcast address. Host cells cycle ?, 0, 1, ? when clicked.
    atom4: {
        enabled: true,
        numQuestions: 6
    },

    // Grading
    strictLeadingZeros: true // binary answers must match bit-width exactly
};

let studentDatabase = [];
let exerciseData = {}; 
let currentFile = "";
let currentUser = "";

// Settings and Mode Management
let appSettings = {
    mode: 'practice', // 'practice' or 'exam'
    timerMinutes: 10,
    autoShowSample: true, // whether the console panel auto-opens when an exercise has sample output; device-based default set below
    practiceQuestionMode: 'fixed' // 'fixed' (same set every time — legacy behavior) or 'random' (fresh set each practice session)
};

// Holds the seed for the current practice session when
// appSettings.practiceQuestionMode === 'random'. Generated once per login
// (see loadAllExercises) so the question set stays stable for the
// duration of that session — switching exercises or reloading the
// settings modal doesn't reshuffle it — but a fresh login produces a new
// random set. Reset to null on logout-equivalent state so a later login
// in random mode is guaranteed to regenerate rather than accidentally
// reusing a stale value.
let currentPracticeSeed = null;

// Builds a seed string that's different on every call — timestamp plus a
// random component, so even two logins in the same millisecond can't
// collide.
function generateRandomPracticeSeed() {
    return `practice-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

let timerIntervalId = null;
let timeRemaining = 0; // in seconds
let examEndTimestamp = null; // epoch ms the exam timer should expire at; persisted per-student so a reload resumes the real deadline instead of granting a fresh timer

window.onload = async function() {
    // Native HTML5 drag-and-drop (used for line ordering) does not fire on
    // touchscreens. Flag touch devices so CSS can hide the drag handle and
    // reveal the Up/Down buttons and Jump-to dropdown instead.
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isTouchDevice) {
        document.body.classList.add('touch-device');
    }

    // The sidebar defaults to open on desktop and closed on mobile, so the
    // hamburger button's label needs to match whichever is current.
    initSidebarToggleLabel();

    // The global "auto-show sample output" setting defaults to ON on
    // desktop (room to show it automatically) and OFF on mobile (screen
    // space is tight). It's a one-time default only — from here on it's a
    // normal setting the student can flip in the Settings modal, and the
    // drawer tab is always available to pull the console into view by hand
    // regardless of this setting.
    initSampleAutoShowDefault();

    try {
        const res = await fetch('students.csv');
        const text = await res.text();
        const rows = text.split('\n').slice(1);
        studentDatabase = rows.map(row => {
            const [email, id] = row.split(',');
            return { email: email?.trim(), id: id?.trim() };
        });
    } catch (err) { console.error("Database failed to load."); }
};

// --- HAMBURGER MENU / OFF-CANVAS SIDEBAR (mobile: overlay) ---
function openSidebar() {
    document.getElementById('sidebarNav').classList.add('sidebar-open');
    document.getElementById('sidebarBackdrop').classList.add('show');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'true');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-label', 'Hide exercise list');
    // Prevent the page behind the panel from scrolling while it's open
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    document.getElementById('sidebarNav').classList.remove('sidebar-open');
    document.getElementById('sidebarBackdrop').classList.remove('show');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'false');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-label', 'Show exercise list');
    document.body.style.overflow = '';
}

// --- LIVE TIMESTAMP (day, date, time — seconds re-animate on every tick) ---
function startUserClock() {
    updateUserTimestamp();
    setInterval(updateUserTimestamp, 1000);
}

function updateUserTimestamp() {
    const el = document.getElementById('userTimestamp');
    if (!el) return;

    const now = new Date();
    const dayName = now.toLocaleDateString(undefined, { weekday: 'long' });
    const dateStr = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

    let hours = now.getHours();
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    el.innerHTML = `<div class="timestamp-date">${dayName}, ${dateStr}</div><div class="timestamp-time">${hours}:${minutes}<span class="timestamp-seconds" id="timestampSeconds">:${seconds}</span> ${period}</div>`;

    // Restart the pulse animation each tick so the seconds visibly "beat"
    // in sync with the clock, rather than animating once and going static.
    const secondsEl = document.getElementById('timestampSeconds');
    if (secondsEl) {
        secondsEl.classList.remove('tick');
        void secondsEl.offsetWidth; // force reflow to restart the CSS animation
        secondsEl.classList.add('tick');
    }
}

// --- SIDEBAR WATERMARK (screenshot deterrent) ---
// Renders a faint, randomly-generated QR-code-like pattern behind the
// sidebar. It isn't a real scannable code — it's just visual noise meant
// to make it obvious/awkward if a student tries to pass off an edited
// screenshot of their scores as the genuine app, since a fresh random
// pattern is drawn every login and a doctored screenshot would need to
// fake it convincingly too.
function classifyQrModule(x, y, moduleCount) {
    // Three finder-pattern corners (top-left, top-right, bottom-left),
    // each with a 1-module quiet border, like a real QR code.
    const finderZones = [
        { x0: 0, y0: 0 },
        { x0: moduleCount - 7, y0: 0 },
        { x0: 0, y0: moduleCount - 7 }
    ];

    for (const zone of finderZones) {
        const lx = x - zone.x0;
        const ly = y - zone.y0;
        if (lx >= -1 && lx <= 7 && ly >= -1 && ly <= 7) {
            if (lx < 0 || lx > 6 || ly < 0 || ly > 6) return 'blank'; // quiet zone
            const onBorder = (lx === 0 || lx === 6 || ly === 0 || ly === 6);
            const inCenter = (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
            return (onBorder || inCenter) ? 'filled' : 'blank';
        }
    }

    // Timing strips: alternating modules along row/column 6, outside the finders
    if (y === 6 || x === 6) {
        return ((x + y) % 2 === 0) ? 'filled' : 'blank';
    }

    return 'data';
}

function generateQrWatermarkDataUrl() {
    const moduleCount = 21;
    const moduleSize = 6;
    const size = moduleCount * moduleSize;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(98, 0, 238, 0.05)'; // subtle — matches the theme's primary color

    for (let y = 0; y < moduleCount; y++) {
        for (let x = 0; x < moduleCount; x++) {
            const type = classifyQrModule(x, y, moduleCount);
            let filled;
            if (type === 'filled') filled = true;
            else if (type === 'blank') filled = false;
            else filled = Math.random() < 0.42; // random "data" noise

            if (filled) {
                ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
            }
        }
    }

    return canvas.toDataURL('image/png');
}

function applySidebarWatermark() {
    const sidebar = document.getElementById('sidebarNav');
    if (!sidebar) return;
    sidebar.style.backgroundImage = `url(${generateQrWatermarkDataUrl()})`;
    sidebar.style.backgroundRepeat = 'repeat';
}

// --- SIDEBAR COLLAPSE (desktop: in-layout panel, no backdrop/scroll-lock) ---
function collapseDesktopSidebar() {
    document.getElementById('sidebarNav').classList.add('sidebar-collapsed');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'false');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-label', 'Show exercise list');
}

function expandDesktopSidebar() {
    document.getElementById('sidebarNav').classList.remove('sidebar-collapsed');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'true');
    document.getElementById('sidebarToggleBtn').setAttribute('aria-label', 'Hide exercise list');
}

// Single entry point for the hamburger button. Behavior depends on viewport:
// on mobile the sidebar is an off-canvas overlay (hidden by default), on
// desktop it's a normal layout panel (visible by default) that can now be
// collapsed to reclaim horizontal space.
function toggleSidebar() {
    const sidebar = document.getElementById('sidebarNav');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile) {
        if (sidebar.classList.contains('sidebar-open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    } else {
        if (sidebar.classList.contains('sidebar-collapsed')) {
            expandDesktopSidebar();
        } else {
            collapseDesktopSidebar();
        }
    }
}

// Set the hamburger button's initial label to match each breakpoint's
// default sidebar state (open on desktop, closed on mobile) — otherwise
// the aria-label baked into the HTML would only be correct for mobile.
function initSidebarToggleLabel() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const btn = document.getElementById('sidebarToggleBtn');
    if (!btn) return;
    if (isMobile) {
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Show exercise list');
    } else {
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', 'Hide exercise list');
    }
}

// --- SAMPLE OUTPUT: GLOBAL AUTO-SHOW SETTING ---
// This is a global preference (configured in the Settings modal) rather
// than a per-exercise control: it decides whether the console panel opens
// automatically whenever the student switches to an activity that has
// sample output. Manually pulling the panel into view for any individual
// activity is handled separately by the drawer tab.
function initSampleAutoShowDefault() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    appSettings.autoShowSample = !isMobile;
}

function applyAutoShowForCurrentExercise() {
    if (!currentFile) return;
    const ex = exerciseData[currentFile];
    const hasSampleOutput = !!(ex && ex.sampleOutput && ex.sampleOutput.trim().length > 0);
    if (hasSampleOutput && appSettings.autoShowSample) {
        showSampleOutput(currentFile);
    } else {
        closeSampleOutputModal();
    }
}

// Close the off-canvas panel automatically after picking an exercise, but
// only on screens narrow enough that the sidebar is an overlay in the
// first place — on desktop the sidebar stays put (collapsing is a manual,
// explicit choice there, not something exercise selection should trigger).
function closeSidebarIfMobile() {
    if (window.matchMedia('(max-width: 768px)').matches) {
        closeSidebar();
    }
}

// Close on Escape for keyboard users (mobile overlay only — desktop's
// collapsed sidebar isn't a modal, so Escape shouldn't touch it)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const sidebar = document.getElementById('sidebarNav');
        if (sidebar && sidebar.classList.contains('sidebar-open')) {
            closeSidebar();
        }
        const consolePanel = document.getElementById('sampleOutputPanel');
        if (consolePanel && consolePanel.classList.contains('open')) {
            closeSampleOutputModal();
        }
    }
});

async function handleLogin() {
    const email = document.getElementById('emailInput').value.trim();
    const id = document.getElementById('studentNumInput').value.trim();
    const user = studentDatabase.find(s => s.email === email && s.id === id);
    
    if (user) {
        currentUser = email;
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        document.getElementById('userDisplay').textContent = email;
        startUserClock();
        applySidebarWatermark();

        const { session: resumedSession, isExpired } = await loadAllExercises();

        // Start timer if in exam mode — resuming the real deadline (not a
        // fresh countdown) if this student already has a persisted session.
        if (appSettings.mode === 'exam') {
            if (isExpired) {
                // Time was already up (or the exam was already completed)
                // before this login/reload — stay locked, no timer.
                stopTimer();
                document.getElementById('timerContainer').style.display = 'none';
                document.getElementById('actionButton').disabled = true;
                saveExamSession();
            } else if (resumedSession && typeof resumedSession.examEndTimestamp === 'number') {
                const remaining = Math.max(0, Math.round((resumedSession.examEndTimestamp - Date.now()) / 1000));
                startTimer(remaining);
            } else {
                startTimer();
            }
        }
    } else {
        const errorEl = document.getElementById('loginError');
        errorEl.innerHTML = '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> Invalid email or student number. Please try again.';
        errorEl.className = "error-text show";
    }
}

// --- PER-STUDENT DETERMINISTIC SHUFFLE ---
// Simple string hash -> 32-bit seed, used to seed a PRNG so the same
// student always gets the same "random" exercise order.
function hashStringToSeed(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0; // force 32-bit int
    }
    return hash >>> 0;
}

// mulberry32: small, fast, deterministic PRNG. Given the same seed it
// always produces the same sequence of numbers.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Returns a shuffled copy of `array`, seeded by `email` so that a given
// student always gets the same order (stable across reloads/resumed exam
// sessions), while different students get different orders from each other.
function shuffleExercisesForStudent(array, email) {
    const rng = mulberry32(hashStringToSeed(email || ''));
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/* =========================================================
   BINARY / IP CONVERSION ACTIVITY — QUESTION GENERATION
   Ported from the standalone conversion-lab reference. Uses the
   same seeded mulberry32 PRNG already defined above, so a given
   seed string always reproduces the exact same question set.
========================================================= */
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pickRandom(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function genPhase1Questions(cfg, rng) {
    // Phase 1: Decimal -> Binary
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const bitWidth = parseInt(cfg.bitWidth, 10);
    const capMax = Math.pow(2, bitWidth) - 1;
    const min = Math.max(0, Math.min(cfg.decMin, capMax));
    const max = Math.max(min, Math.min(cfg.decMax, capMax));

    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const dec = randInt(rng, min, max);
        const bin = dec.toString(2).padStart(bitWidth, '0');
        out.push({
            type: 'd2b',
            promptHtml: `Convert the decimal number <b>${dec}</b> to <b>${bitWidth}-bit</b> binary.`,
            correct: bin, bitWidth, given: dec
        });
    }
    return out;
}

function genPhase2Questions(cfg, rng) {
    // Phase 2: Binary -> Decimal
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const bitWidth = parseInt(cfg.bitWidth, 10);
    const capMax = Math.pow(2, bitWidth) - 1;
    const min = Math.max(0, Math.min(cfg.decMin, capMax));
    const max = Math.max(min, Math.min(cfg.decMax, capMax));

    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const dec = randInt(rng, min, max);
        const bin = dec.toString(2).padStart(bitWidth, '0');
        out.push({
            type: 'b2d',
            promptHtml: `Convert the binary number below to decimal.`,
            correct: String(dec), bitWidth, given: bin
        });
    }
    return out;
}

function randomIP(rng) { return [randInt(rng, 0, 255), randInt(rng, 0, 255), randInt(rng, 0, 255), randInt(rng, 0, 255)]; }
function ipToBinDotted(ip) { return ip.map(o => o.toString(2).padStart(8, '0')).join('.'); }

function genPhase3Questions(cfg, rng) {
    // Phase 3: IP address, Decimal -> Binary
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const ip = randomIP(rng);
        const decStr = ip.join('.');
        const binStr = ipToBinDotted(ip);
        out.push({ type: 'ip_d2b', promptHtml: `Convert the IP address <b>${decStr}</b> to binary (8 bits per octet).`, correct: binStr, given: decStr });
    }
    return out;
}

function genPhase4Questions(cfg, rng) {
    // Phase 4: IP address, Binary -> Decimal
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const ip = randomIP(rng);
        const decStr = ip.join('.');
        const binStr = ipToBinDotted(ip);
        out.push({ type: 'ip_b2d', promptHtml: `Convert the binary IP address <b>${binStr}</b> to dotted-decimal.`, correct: decStr, given: binStr });
    }
    return out;
}

function genPhase5Questions(cfg, rng) {
    // Phase 5: Subnet mask, CIDR -> dotted-decimal
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const cidrOptions = (cfg.cidrList || "").split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 32);
    if (cidrOptions.length === 0) return [];

    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const cidr = pickRandom(rng, cidrOptions);
        const maskBits = '1'.repeat(cidr) + '0'.repeat(32 - cidr);
        const octetsBin = [maskBits.substr(0, 8), maskBits.substr(8, 8), maskBits.substr(16, 8), maskBits.substr(24, 8)];
        const octetsDec = octetsBin.map(o => parseInt(o, 2));
        const decStr = octetsDec.join('.');
        out.push({ type: 'mask_c2d', promptHtml: `Convert the subnet mask <b>/${cidr}</b> (CIDR) to dotted-decimal notation.`, correct: decStr, given: cidr });
    }
    return out;
}

function genPhase6Questions(cfg, rng) {
    // Phase 6: Subnet mask, dotted-decimal -> Binary
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const cidrOptions = (cfg.cidrList || "").split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 32);
    if (cidrOptions.length === 0) return [];

    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const cidr = pickRandom(rng, cidrOptions);
        const maskBits = '1'.repeat(cidr) + '0'.repeat(32 - cidr);
        const octetsBin = [maskBits.substr(0, 8), maskBits.substr(8, 8), maskBits.substr(16, 8), maskBits.substr(24, 8)];
        const octetsDec = octetsBin.map(o => parseInt(o, 2));
        const decStr = octetsDec.join('.');
        const binStr = octetsBin.join('.');
        out.push({ type: 'mask_d2b', promptHtml: `Convert the subnet mask <b>${decStr}</b> to binary (8 bits per octet).`, correct: binStr, given: decStr });
    }
    return out;
}

// --- CLASSFUL CIDR IDENTIFICATION (Phase 7) ---
// Given an IP address, the student identifies its default CIDR prefix
// based on the traditional IPv4 address class (A/B/C). Class D (224–239,
// multicast) and Class E (240–255, reserved) don't have a classful default
// mask, so they're never generated; 127.x.x.x (loopback) is skipped too.
const CLASSFUL_CIDR_RANGES = [
    { cls: 'A', min: 1, max: 126, cidr: 8 },   // 127 reserved for loopback
    { cls: 'B', min: 128, max: 191, cidr: 16 },
    { cls: 'C', min: 192, max: 223, cidr: 24 }
];

function randomIPInRange(rng, range) {
    const firstOctet = randInt(rng, range.min, range.max);
    const rest = [randInt(rng, 0, 255), randInt(rng, 0, 255), randInt(rng, 0, 255)];
    return [firstOctet, ...rest].join('.');
}

function genPhase7Questions(cfg, rng) {
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];

    // Guarantee every class (A, B, C) appears at least once: assign classes
    // round-robin across the requested slots (so with numQuestions >= 3 each
    // class is covered, and any extra slots cycle back through A/B/C again),
    // then shuffle deterministically so the guaranteed A/B/C questions don't
    // always land in the first three slots or the same relative order.
    const assignments = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        assignments.push(CLASSFUL_CIDR_RANGES[i % CLASSFUL_CIDR_RANGES.length]);
    }
    for (let i = assignments.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [assignments[i], assignments[j]] = [assignments[j], assignments[i]];
    }

    return assignments.map(range => ({
        type: 'class_cidr',
        promptHtml: `Identify the CIDR notation based on IP address class.`,
        correct: String(range.cidr),
        given: randomIPInRange(rng, range)
    }));
}

// --- ATOM 1: THE CONSTRAINT (BIT QUESTION) ---
// Given a classful network address and a minimum subnets-OR-hosts
// requirement, the student must borrow exactly enough bits — by clicking
// bits in a Panel-2-style grid, not typing — to satisfy it. The graded
// answer is the exact minimal borrowed-bit count:
//   subnets mode: smallest N such that 2^N >= requiredSubnets
//   hosts mode:   smallest H (host bits kept) such that 2^H - 2 >= requiredHosts,
//                 i.e. borrow totalHostBits - H bits (as many as possible
//                 while still meeting the host floor).
// Reuses CLASSFUL_CIDR_RANGES (already defined above for Phase 7) so the
// generated address is always a real classful A/B/C network.
function genAtom1Questions(cfg, rng) {
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const out = [];
    for (let i = 0; i < cfg.numQuestions; i++) {
        const range = pickRandom(rng, CLASSFUL_CIDR_RANGES);
        const networkBits = range.cidr;
        const editableCount = networkBits / 8; // matches SubnetVisualizer's syncOctetLocking

        // Build a classful NETWORK address (host portion zeroed), e.g.
        // 172.20.0.0 for Class B — same convention as the visualizer's
        // own presets (10.0.0.0 / 172.16.0.0 / 192.168.1.0).
        const octets = [0, 0, 0, 0];
        octets[0] = randInt(rng, range.min, range.max);
        for (let o = 1; o < editableCount; o++) octets[o] = randInt(rng, 0, 255);

        const totalHostBits = 32 - networkBits;
        const maxBorrow = Math.max(0, 30 - networkBits); // leave >= 2 host bits, matches SubnetVisualizer's own cap

        const requirementType = rng() < 0.5 ? 'subnets' : 'hosts';
        let correctBits, requiredCount;

        if (requirementType === 'subnets') {
            const nCap = Math.min(maxBorrow, 10); // keep required-subnet counts classroom-sized
            const nTarget = randInt(rng, 1, Math.max(1, nCap));
            const lower = Math.pow(2, nTarget - 1) + 1;
            const upper = Math.pow(2, nTarget);
            requiredCount = randInt(rng, lower, upper);
            correctBits = nTarget;
        } else {
            // Cap below totalHostBits so correctBits is never 0 (a
            // zero-click question would be a degenerate exercise).
            const hCap = Math.min(totalHostBits - 1, 12);
            const hTarget = randInt(rng, 2, Math.max(2, hCap));
            const lower = Math.pow(2, hTarget - 1) - 1;
            const upper = Math.pow(2, hTarget) - 2;
            requiredCount = randInt(rng, Math.max(1, lower), Math.max(1, upper));
            correctBits = totalHostBits - hTarget;
        }

        const ipStr = octets.join('.');
        const promptHtml = requirementType === 'subnets'
            ? `A network engineer is assigned the <b>Class ${range.cls}</b> network <b>${ipStr}</b> (classful <b>/${networkBits}</b>) and must support at least <b>${requiredCount}</b> subnet${requiredCount === 1 ? '' : 's'}. Click bits in the grid below to borrow exactly enough network bits, then verify.`
            : `A network engineer is assigned the <b>Class ${range.cls}</b> network <b>${ipStr}</b> (classful <b>/${networkBits}</b>) and each subnet must support at least <b>${requiredCount}</b> usable host${requiredCount === 1 ? '' : 's'}. Click bits in the grid below to borrow just enough network bits — leaving just enough host bits behind — then verify.`;

        out.push({
            type: 'atom1',
            octets,
            classLabel: range.cls,
            networkBits,
            totalHostBits,
            maxBorrow,
            requirementType,
            requiredCount,
            correctBits,
            correctCidr: networkBits + correctBits,
            promptHtml,
            correct: String(correctBits),
            given: ipStr
        });
    }
    return out;
}

function questionTypeLabel(type) {
    switch (type) {
        case 'd2b': return 'Dec→Bin';
        case 'b2d': return 'Bin→Dec';
        case 'ip_d2b': return 'IP Dec→Bin';
        case 'ip_b2d': return 'IP Bin→Dec';
        case 'mask_c2d': return 'CIDR→Mask';
        case 'mask_d2b': return 'Mask→Bin';
        case 'class_cidr': return 'Class→CIDR';
        case 'atom1': return 'Bit Question';
        case 'atom2': return 'Mask Assembly';
        case 'atom3': return 'Space Map';
        case 'atom4': return 'Boundaries';
        default: return '';
    }
}

// Builds the full, ordered list of named question "exercises" for a given
// seed string. Exam mode seeds with the student's email (unique, stable
// per student across reloads); practice mode uses one fixed seed so every
// student practices the same set. Grouped by phase, numbered within each
// phase, matching the sidebar's one-entry-per-question structure.
function buildConversionQuestions(seedStr) {
    const rng = mulberry32(hashStringToSeed(seedStr || ''));
    const decToBin = genPhase1Questions(QUESTION_CONFIG.phase1, rng);
    const binToDec = genPhase2Questions(QUESTION_CONFIG.phase2, rng);
    const ipToBinary = genPhase3Questions(QUESTION_CONFIG.phase3, rng);
    const ipToDecimal = genPhase4Questions(QUESTION_CONFIG.phase4, rng);
    const cidrToMask = genPhase5Questions(QUESTION_CONFIG.phase5, rng);
    const maskToBinary = genPhase6Questions(QUESTION_CONFIG.phase6, rng);
    const classCidrQuestions = genPhase7Questions(QUESTION_CONFIG.phase7, rng);

    const list = [];
    decToBin.forEach((q, i) => list.push({
        name: `dec2bin-q${i + 1}`,
        phase: 'Phase 1 · Decimal → Binary',
        label: `Phase 1 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    binToDec.forEach((q, i) => list.push({
        name: `bin2dec-q${i + 1}`,
        phase: 'Phase 2 · Binary → Decimal',
        label: `Phase 2 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    ipToBinary.forEach((q, i) => list.push({
        name: `ipdecbin-q${i + 1}`,
        phase: 'Phase 3 · IP Decimal → Binary',
        label: `Phase 3 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    ipToDecimal.forEach((q, i) => list.push({
        name: `ipbindec-q${i + 1}`,
        phase: 'Phase 4 · IP Binary → Decimal',
        label: `Phase 4 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    cidrToMask.forEach((q, i) => list.push({
        name: `cidrmask-q${i + 1}`,
        phase: 'Phase 5 · CIDR → Mask',
        label: `Phase 5 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    maskToBinary.forEach((q, i) => list.push({
        name: `maskbin-q${i + 1}`,
        phase: 'Phase 6 · Mask → Binary',
        label: `Phase 6 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    classCidrQuestions.forEach((q, i) => list.push({
        name: `classcidr-q${i + 1}`,
        phase: 'Phase 7 · Class-Based CIDR',
        label: `Phase 7 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
    return list;
}

// --- ATOM 1: separate question list for its own dedicated full-width view ---
// Deliberately NOT part of buildConversionQuestions' returned list — Atom 1
// lives in its own page (see showAtom1Page/renderAtom1View below), not the
// Exercises sidebar, so it needs its own item list with the same shape
// (name/phase/label/shortLabel/q) but drawn from an independent RNG stream
// (seed suffixed with '::atom1'). That keeps it fully decoupled: adding,
// removing, or reconfiguring Atom 1 questions can never shift the random
// sequence any other phase draws from, and vice versa.
function buildAtom1QuestionList(seedStr) {
    const rng = mulberry32(hashStringToSeed((seedStr || '') + '::atom1'));
    const atom1Questions = genAtom1Questions(QUESTION_CONFIG.atom1, rng);
    return atom1Questions.map((q, i) => ({
        name: `atom1-q${i + 1}`,
        phase: 'Atom 1 · The Constraint (Bit Question)',
        label: `Atom 1 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
}

// --- ATOM 2: THE MASK ASSEMBLY (INTERESTING OCTET) ---
// Given a host IP address and a classless CIDR prefix, the student
// assembles the subnet mask directly: classful network bits (Class A/B/C's
// default 8/16/24) are locked to 1, and every bit beyond that starts at 0
// and toggles independently on click (unlike Atom 1's "click sets the
// boundary" behavior — here each bit is its own decision). The correct
// answer is simply the standard mask for the given CIDR. Reuses
// CLASSFUL_CIDR_RANGES (see Phase 7 / Atom 1 above) for a real classful
// A/B/C starting point.
function genAtom2Questions(cfg, rng) {
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const out = [];
    const maxCidr = 30; // leave >= 2 host bits, same convention as Atom 1's maxBorrow cap

    for (let i = 0; i < cfg.numQuestions; i++) {
        const range = pickRandom(rng, CLASSFUL_CIDR_RANGES);
        const networkBits = range.cidr;

        // A full random host IP (not a zeroed network address) — Atom 2's
        // scenario is "given this host's address and CIDR," matching the
        // Project Brief's Atom 2 framing.
        const octets = [randInt(rng, range.min, range.max), randInt(rng, 0, 255), randInt(rng, 0, 255), randInt(rng, 0, 255)];

        // Pick a classless CIDR that borrows at least 1 bit and never lands
        // exactly on an octet boundary, so there's always a genuine mixed
        // "interesting octet" to assemble (matching the Project Brief's
        // 224 example) rather than an all-255-or-0 mask.
        let targetCidr;
        let attempts = 0;
        do {
            const n = randInt(rng, 1, Math.max(1, maxCidr - networkBits));
            targetCidr = networkBits + n;
            attempts++;
        } while (targetCidr % 8 === 0 && attempts < 50);
        if (targetCidr % 8 === 0) targetCidr = Math.min(maxCidr, targetCidr + 1);

        const maskBits = '1'.repeat(targetCidr) + '0'.repeat(32 - targetCidr);
        const maskOctets = [0, 1, 2, 3].map(g => parseInt(maskBits.substr(g * 8, 8), 2));
        const correct = maskOctets.join('.');
        const ipStr = octets.join('.');

        // Kept deliberately brief: the general "how to assemble the mask /
        // classful bits are locked" instructions already live once in the
        // Atom 2 page header (see #atom2View's card-header in index.html),
        // so each question only needs the two facts that actually change
        // from question to question — the given host IP and target CIDR.
        // Class and the classful network-bit count are intentionally
        // omitted: the grid's own locked (blue) bits already show exactly
        // which bits are fixed, so restating that in words is redundant.
        const promptHtml = `Assemble the subnet mask for <b>${ipStr}/${targetCidr}</b>.`;

        out.push({
            type: 'atom2',
            octets,
            classLabel: range.cls,
            networkBits,
            targetCidr,
            promptHtml,
            correct,
            given: ipStr
        });
    }
    return out;
}

// Separate question list for Atom 2's own dedicated view — same rationale
// as buildAtom1QuestionList: not part of buildConversionQuestions' sidebar
// list, and drawn from its own independent RNG stream (seed suffixed with
// '::atom2') so it can never shift any other phase's/atom's sequence.
function buildAtom2QuestionList(seedStr) {
    const rng = mulberry32(hashStringToSeed((seedStr || '') + '::atom2'));
    const atom2Questions = genAtom2Questions(QUESTION_CONFIG.atom2, rng);
    return atom2Questions.map((q, i) => ({
        name: `atom2-q${i + 1}`,
        phase: 'Atom 2 · The Mask Assembly (Interesting Octet)',
        label: `Atom 2 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
}

// --- ATOM 3: THE SPACE MAP (FRONT & BACK SUBNETS) ---
// Given a classful network address and a TARGET classless CIDR (e.g.
// 172.20.5.0/26), the student must figure out — and then click, exactly
// like Atom 1's own boundary-setting bit grid — how many bits that target
// implies borrowing. Nothing here states the borrowed-bit count in words;
// it's implied entirely by the gap between the classful network bits
// (locked, derived from class) and the given target CIDR, so the student
// has to read the class off the address and do networkBits -> targetCidr
// subtraction themselves. As the boundary moves, a live subnet-ID list
// below (see buildAtom3SubnetListHtml) recomputes from whatever borrowed-
// bit count is CURRENTLY selected — a self-check aid, not a separate
// answer surface; only the grid's final boundary position is graded.
//
// Class is weighted toward C, then B, then A for practice: Class C's
// single, always-editable last octet is by far the easiest to visualize
// bit-borrowing in, Class B is a step up, and Class A (24 bits of
// borrowable host space) is the hardest to reason about — so it's seen
// least often while still appearing.
const ATOM3_CLASS_WEIGHTS = [
    { range: CLASSFUL_CIDR_RANGES[2], weight: 0.55 }, // C
    { range: CLASSFUL_CIDR_RANGES[1], weight: 0.30 }, // B
    { range: CLASSFUL_CIDR_RANGES[0], weight: 0.15 }  // A
];

function pickAtom3ClassRange(rng) {
    const r = rng();
    let acc = 0;
    for (const entry of ATOM3_CLASS_WEIGHTS) {
        acc += entry.weight;
        if (r < acc) return entry.range;
    }
    return ATOM3_CLASS_WEIGHTS[ATOM3_CLASS_WEIGHTS.length - 1].range;
}

// Atom 4 is deliberately sequenced instead of randomly weighted: its
// boundary task is more demanding than Atom 3's, so practice should teach
// the pattern with mostly Class C questions, then introduce Class B, and
// finish with at most one Class A question.
function atom4ClassRangeForQuestion(index, totalQuestions) {
    const classACount = totalQuestions > 0 ? 1 : 0;
    const nonClassACount = Math.max(0, totalQuestions - classACount);
    const classCCount = Math.max(1, Math.ceil(nonClassACount * 0.7));

    if (index < classCCount) return CLASSFUL_CIDR_RANGES[2];
    if (index < nonClassACount) return CLASSFUL_CIDR_RANGES[1];
    return CLASSFUL_CIDR_RANGES[0];
}

function genAtom3Questions(cfg, rng) {
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const out = [];
    const maxBorrowCap = 10; // keep the target CIDR classroom-sized regardless of class

    for (let i = 0; i < cfg.numQuestions; i++) {
        const range = pickAtom3ClassRange(rng);
        const networkBits = range.cidr;
        const editableCount = networkBits / 8; // matches Atom 1/2's own classful-address convention

        const octets = [0, 0, 0, 0];
        octets[0] = randInt(rng, range.min, range.max);
        for (let o = 1; o < editableCount; o++) octets[o] = randInt(rng, 0, 255);

        // At least 3 borrowed bits guarantees >= 8 subnets, which is the
        // minimum needed for "first 4" (indices 0-3) and "last 4" (the
        // top 4 indices) to never overlap in the live list below.
        const maxBorrow = Math.max(0, 30 - networkBits); // leave >= 2 host bits, same convention as Atom 1
        const borrowedBits = randInt(rng, 3, Math.max(3, Math.min(maxBorrow, maxBorrowCap)));
        const targetCidr = networkBits + borrowedBits;

        const ipStr = octets.join('.');
        const promptHtml = `A network engineer needs the classless network <b>${ipStr}/${targetCidr}</b>. First, click bits in the grid below to borrow exactly enough network bits to reach that CIDR. Next, assemble the matching subnet mask bit by bit. Finally, build the binary subnet ID for each subnet listed underneath by clicking its own bits — its full network address updates live as you go.`;

        out.push({
            type: 'atom3',
            octets,
            classLabel: range.cls,
            networkBits,
            maxBorrow,
            targetCidr,
            correctBits: borrowedBits,
            promptHtml,
            correct: String(borrowedBits),
            given: ipStr
        });
    }
    return out;
}

function genAtom4Questions(cfg, rng) {
    if (!cfg || !cfg.enabled || !cfg.numQuestions) return [];
    const out = [];
    const maxBorrowCap = 10;

    for (let i = 0; i < cfg.numQuestions; i++) {
        const range = atom4ClassRangeForQuestion(i, cfg.numQuestions);
        const networkBits = range.cidr;
        const editableCount = networkBits / 8;
        const octets = [0, 0, 0, 0];
        octets[0] = randInt(rng, range.min, range.max);
        for (let o = 1; o < editableCount; o++) octets[o] = randInt(rng, 0, 255);

        const maxBorrow = Math.max(0, 30 - networkBits);
        const borrowedBits = randInt(rng, 3, Math.max(3, Math.min(maxBorrow, maxBorrowCap)));
        const targetCidr = networkBits + borrowedBits;
        const ipStr = octets.join('.');

        out.push({
            type: 'atom4',
            octets,
            classLabel: range.cls,
            networkBits,
            maxBorrow,
            borrowedBits,
            hostBits: 32 - targetCidr,
            targetCidr,
            promptHtml: `For the <b>${ipStr}/${targetCidr}</b> network, build each subnet ID listed below. Then set every remaining host bit to <b>0</b> for its Network ID and to <b>1</b> for its Broadcast Address.`,
            correct: '',
            given: ipStr
        });
    }
    return out;
}

// Separate question list for Atom 3's own dedicated view — same rationale
// as buildAtom1QuestionList/buildAtom2QuestionList, drawn from its own
// independent RNG stream (seed suffixed with '::atom3').
function buildAtom3QuestionList(seedStr) {
    const rng = mulberry32(hashStringToSeed((seedStr || '') + '::atom3'));
    const atom3Questions = genAtom3Questions(QUESTION_CONFIG.atom3, rng);
    return atom3Questions.map((q, i) => ({
        name: `atom3-q${i + 1}`,
        phase: 'Atom 3 · The Space Map (Front & Back Subnets)',
        label: `Atom 3 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
}

function buildAtom4QuestionList(seedStr) {
    const rng = mulberry32(hashStringToSeed((seedStr || '') + '::atom4'));
    const atom4Questions = genAtom4Questions(QUESTION_CONFIG.atom4, rng);
    return atom4Questions.map((q, i) => ({
        name: `atom4-q${i + 1}`,
        phase: 'Atom 4 · The Boundaries (Network ID & Broadcast)',
        label: `Atom 4 – Q${i + 1} (${questionTypeLabel(q.type)})`,
        shortLabel: `Q${i + 1} · ${questionTypeLabel(q.type)}`,
        q
    }));
}

async function loadAllExercises() {
    const list = document.getElementById('fileList');
    list.innerHTML = ""; 
    document.getElementById('loader').style.display = 'block';

    // Exam mode hides the per-bit decimal place-value labels (128, 64, 32,
    // ...) shown above every bit box across Phase 1, Phase 2's read-only
    // "given" grid, and the Phase 3/6 octet grids — those numbers hand the
    // student the exact arithmetic needed to solve the question, which
    // defeats the point of a timed assessment. Driven by a single
    // body-level class rather than touching each render function, so it
    // covers every bit grid uniformly (including ones not yet rendered)
    // via CSS alone (see .bit-place-value in style.css).
    document.body.classList.toggle('exam-mode', appSettings.mode === 'exam');

    // Exam mode: seed question generation with the student's email, so
    // the exact same numbers/questions reappear on reload (stable across
    // resumed exam sessions) while differing from student to student.
    //
    // Practice mode's seed depends on appSettings.practiceQuestionMode
    // (set in the Settings modal, before login):
    //   - 'fixed'  -> the same constant seed every time, so every student
    //                 practices the identical set (e.g. for walking
    //                 through problems together as a class).
    //   - 'random' -> a freshly generated seed for this login session, so
    //                 practice sessions vary session-to-session instead of
    //                 repeating the same questions forever.
    let seedStr;
    if (appSettings.mode === 'exam' && currentUser) {
        seedStr = currentUser;
    } else if (appSettings.mode === 'practice' && appSettings.practiceQuestionMode === 'random') {
        if (!currentPracticeSeed) {
            currentPracticeSeed = generateRandomPracticeSeed();
        }
        seedStr = currentPracticeSeed;
    } else {
        seedStr = 'practice-default-seed';
    }

    const questionList = buildConversionQuestions(seedStr);

    let lastPhase = null;
    for (const item of questionList) {
        exerciseData[item.name] = buildConversionExerciseData(item);

        // Insert a non-interactive phase header whenever the phase changes
        // (list is already grouped/ordered by phase from buildConversionQuestions).
        if (item.phase !== lastPhase) {
            const headerLi = document.createElement('li');
            headerLi.className = 'sidebar-phase-header';
            headerLi.textContent = item.phase;
            headerLi.setAttribute('role', 'presentation');
            list.appendChild(headerLi);
            lastPhase = item.phase;
        }

        const li = document.createElement('li');
        const safeId = item.name;
        li.id = `nav-${safeId}`;

        li.innerHTML = `
            <span>${item.shortLabel}</span>
            <span class="nav-score" id="score-${safeId}">0/${exerciseData[item.name].answers.length}</span>
        `;

        li.onclick = () => {
            switchExercise(item.name, li);
            closeSidebarIfMobile();
        };
        list.appendChild(li);

        // Initialize sidebar score and summary
        updateSidebarScore(item.name);
        updateSummaryPanel();
    }

    // --- Atom 1: scored, but lives in its own full-width view (see
    // showAtom1Page/renderAtom1View), not the Exercises sidebar list built
    // above. Its exerciseData entries still live in the same `exerciseData`
    // object as everything else, so scoring, exam persistence, and the
    // sidebar's overall Total Points all pick it up automatically with no
    // special-casing needed there.
    const atom1List = buildAtom1QuestionList(seedStr);
    atom1List.forEach(item => {
        exerciseData[item.name] = buildConversionExerciseData(item);
    });
    renderAtom1View(atom1List);

    // --- Atom 2: scored, dedicated full-width view (see showAtom2Page/
    // renderAtom2View), same pattern as Atom 1 immediately above.
    const atom2List = buildAtom2QuestionList(seedStr);
    atom2List.forEach(item => {
        exerciseData[item.name] = buildConversionExerciseData(item);
    });
    renderAtom2View(atom2List);

    // --- Atom 3: scored, dedicated full-width view (see showAtom3Page/
    // renderAtom3View), same pattern as Atom 1/2 immediately above.
    const atom3List = buildAtom3QuestionList(seedStr);
    atom3List.forEach(item => {
        exerciseData[item.name] = buildConversionExerciseData(item);
    });
    renderAtom3View(atom3List);

    // --- Atom 4: scored, dedicated boundary view ---
    const atom4List = buildAtom4QuestionList(seedStr);
    atom4List.forEach(item => {
        exerciseData[item.name] = buildConversionExerciseData(item);
    });
    renderAtom4View(atom4List);

    document.getElementById('loader').style.display = 'none';

    // --- Restore any persisted exam-mode progress for this student ---
    // Keyed by email, so a page reload/reconnect during an exam resumes
    // exactly where the student left off (locked exercises, scores, line
    // order) instead of silently wiping their answers and handing them a
    // brand-new timer.
    let resumedSession = null;
    let isExpired = false;
    if (appSettings.mode === 'exam' && currentUser) {
        resumedSession = loadExamSession(currentUser);
        if (resumedSession) {
            applySavedExerciseStates(resumedSession);
            isExpired = !!resumedSession.completed ||
                (typeof resumedSession.examEndTimestamp === 'number' && Date.now() >= resumedSession.examEndTimestamp);
            if (isExpired) {
                // Lock every exercise, including ones never opened, so a
                // reload after time's up can't be used to keep answering.
                for (const file in exerciseData) {
                    exerciseData[file].locked = true;
                }
            }
        }
    }

    // Reflect any restored/expired lock state (set above, generically, on
    // every exerciseData entry) onto the Atom 1 view's own DOM — unlike the
    // Exercises list, which lazily re-renders per exercise on click via
    // switchExercise, the Atom 1 view renders every question up front, so
    // it needs an explicit pass here to pick up locked/score/userAnswer.
    syncAtom1ViewDOM();
    syncAtom2ViewDOM();
    syncAtom3ViewDOM();
    syncAtom4ViewDOM();

    const firstQuestionItem = list.querySelector('li:not(.sidebar-phase-header)');
    if (firstQuestionItem) firstQuestionItem.click();

    // Attach action button handler (delegates to verify or reset depending on locked state)
    document.getElementById('actionButton').addEventListener('click', () => {
        const actionBtn = document.getElementById('actionButton');
        const ex = exerciseData[currentFile];
        if (!currentFile) return;
        if (ex && ex.locked) {
            resetCurrentExercise();
        } else {
            checkAnswers();
        }
    });

    return { session: resumedSession, isExpired };
}

// Applies a previously-saved exam session (locked state, score, and line
// order per exercise) onto the freshly-loaded exerciseData. Must run after
// exerciseData has been populated (each exercise re-shuffles on every page
// load, but userOrder is stored as original line indices, so it re-applies
// correctly regardless of the new shuffle).
function applySavedExerciseStates(session) {
    if (!session || !session.exercises) return;
    for (const file in session.exercises) {
        const saved = session.exercises[file];
        const ex = exerciseData[file];
        if (!ex || !saved) continue;
        ex.locked = !!saved.locked;
        ex.score = saved.score || 0;
        ex.isPartial = !!saved.isPartial;
        if (ex.isLineOrdering && Array.isArray(saved.userOrder) && saved.userOrder.length) {
            ex.userOrder = saved.userOrder;
        }
        if (ex.isConversionQuestion && typeof saved.userAnswer === 'string') {
            ex.userAnswer = saved.userAnswer;
        }
        updateSidebarScore(file);
    }
    updateSummaryPanel();
}

// Fisher-Yates shuffle that guarantees a derangement (no item in original position)
function createDerangement(length) {
    if (length <= 1) return [...Array(length).keys()];
    
    let attempt = 0;
    let derangement;
    let isValid;
    
    do {
        // Fisher-Yates shuffle
        derangement = [...Array(length).keys()];
        for (let i = length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [derangement[i], derangement[j]] = [derangement[j], derangement[i]];
        }
        
        // Check if it's a valid derangement (no item in original position)
        isValid = true;
        for (let i = 0; i < length; i++) {
            if (derangement[i] === i) {
                isValid = false;
                break;
            }
        }
        
        attempt++;
    } while (!isValid && attempt < 100); // Max 100 attempts to prevent infinite loop
    
    // Fallback: if derangement fails, manually create one
    if (!isValid) {
        derangement = [...Array(length).keys()];
        const rotations = Math.max(1, Math.floor(length / 2));
        for (let i = 0; i < rotations; i++) {
            derangement.push(derangement.shift());
        }
    }
    
    return derangement;
}

function parseJavaCode(raw) {
    // Extract sample output from a leading block comment (/* ... */) if present
    let sampleOutput = '';
    const commentMatch = raw.match(/\/\*[\s\S]*?\*\//);
    if (commentMatch) {
        const comment = commentMatch[0];
        // Find 'Sample Output:' marker (case-insensitive)
        const markerIndex = comment.search(/Sample Output:/i);
        if (markerIndex >= 0) {
            // Extract everything after the marker up to end of comment
            let after = comment.slice(markerIndex + 'Sample Output:'.length);

            // Strip the block comment's closing "*/" (and any whitespace
            // right before it) from the very end BEFORE splitting into
            // lines. Doing this first means a genuine blank line the
            // author intentionally included in the sample output (e.g. a
            // trailing blank row) can't get confused with — and dropped
            // along with — the leftover artifact the closer would
            // otherwise leave behind on its own line.
            after = after.replace(/\s*\*\/\s*$/, '');

            // Strip only the JavaDoc-style comment prefix from each line: an
            // optional single leading space, the '*', and at most one space
            // right after it. Anything beyond that single space is real
            // indentation belonging to the program's actual output (e.g. an
            // ASCII-art shape) and must be preserved exactly as-is.
            let sampleLines = after.split('\n').map(l => l.replace(/^ ?\*\s?/, ''));

            // Drop only the leading blank line produced by the newline
            // right after "Sample Output:" itself. Any blank line(s)
            // further in — including a trailing one — are part of the
            // real output and are left untouched.
            while (sampleLines.length && sampleLines[0].trim() === '') {
                sampleLines.shift();
            }

            // Trailing whitespace on a line doesn't affect how it renders,
            // so it's safe to trim per line without touching leading spaces.
            sampleOutput = sampleLines.map(l => l.replace(/\s+$/, '')).join('\n');
        }

        // Remove the entire leading comment block from the raw source before parsing lines
        raw = raw.replace(commentMatch[0], '');
    }

    // Split code into lines and filter out empty lines
    const lines = raw.split('\n').filter(line => line.trim().length > 0);
    
    // Escape HTML
    const escapedLines = lines.map(line => 
        line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );
    
    // Create shuffled version using derangement (no item in original position)
    const shuffledIndices = createDerangement(escapedLines.length);
    const shuffledLines = shuffledIndices.map(idx => escapedLines[idx]);
    
    // Generate fixed line numbers column and draggable code area
    let lineNumbersHtml = '<div class="line-numbers-column">';
    for (let i = 0; i < escapedLines.length; i++) {
        lineNumbersHtml += `<div class="line-number">${i + 1}</div>`;
    }
    lineNumbersHtml += '</div>';
    
    // Build draggable items (no line numbers attached)
    let codeAreaHtml = '<div class="code-ordering-area" id="orderingArea">';
    shuffledLines.forEach((line, idx) => {
        const originalIdx = shuffledIndices[idx];
        
        codeAreaHtml += `<div class="draggable-line" draggable="true" data-original-idx="${originalIdx}">
                            <span class="drag-handle"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></span>
                            <div class="updown-buttons">
                                <button type="button" class="move-up-btn" aria-label="Move line up"><i class="fa-solid fa-chevron-up" aria-hidden="true"></i></button>
                                <button type="button" class="move-down-btn" aria-label="Move line down"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
                            </div>
                            <code>${line}</code>
                        </div>`;
    });
    codeAreaHtml += '</div>';
    
    // Wrap both in a container
    const html = `<div class="code-ordering-container">${lineNumbersHtml}${codeAreaHtml}</div>`;
    
    // For compatibility, 'answers' stores the correct order
    const answers = escapedLines.map((_, idx) => [idx.toString()]);
    
    // Identify duplicate lines and map which positions are valid for each line's content
    const lineGroups = {}; // content -> array of original indices
    escapedLines.forEach((line, idx) => {
        if (!lineGroups[line]) {
            lineGroups[line] = [];
        }
        lineGroups[line].push(idx);
    });
    
    // Create a map: originalIdx -> valid positions for that line's content
    const validPositionsMap = {};
    escapedLines.forEach((line, idx) => {
        validPositionsMap[idx] = lineGroups[line].sort((a, b) => a - b);
    });
    
    return { 
        html, 
        answers, 
        sampleOutput,
        originalLines: escapedLines,
        originalIndices: [...escapedLines.keys()],
        shuffledIndices: shuffledIndices,
        validPositionsMap: validPositionsMap,
        lineGroups: lineGroups,
        userOrder: [],
        score: 0, 
        locked: false, 
        isPartial: false,
        isLineOrdering: true
    };
}

/* =========================================================
   BINARY / IP CONVERSION ACTIVITY — EXERCISE DATA / RENDERING / GRADING
   Builds an object shaped like the exerciseData entries the rest of the
   app already expects (locked/score/answers/html), so the sidebar,
   scoring, exam persistence, and lock/reset flow all work unmodified.
========================================================= */
function buildConversionExerciseData(item) {
    const q = item.q;
    // IP address questions (Phase 3 · IP Dec→Bin and Phase 4 · IP Bin→Dec)
    // are graded per octet — 4 "lines" so 1 point per octet, up to 4 points
    // total — instead of a single all-or-nothing point. Everything else
    // (mask questions, individual dec/bin questions) stays at 1 point.
    // Atom 2 is graded all-or-nothing (1 point), like Atom 1 — the full
    // 32-bit mask either matches the target CIDR's mask or it doesn't;
    // there's no partial-credit notion of "which octet was right" the way
    // there is for the IP-address conversion questions below.
    const isOctetScored = (q.type === 'ip_d2b' || q.type === 'ip_b2d');
    // Atom 3 is graded per answerable item, not all-or-nothing: the
    // boundary grid, the assembled mask, and each subnet row shown for
    // the TARGET (correct) borrowed-bit count each earn their own point.
    // Computed here (rather than assuming a fixed count) since the number
    // of subnet rows depends on the question's own correctBits.
    const atom3AnswerCount = q.type === 'atom3' ? (2 + atom3SubnetIndicesForBorrowed(q.correctBits).length) : null;
    // Atom 1 questions carry extra fields the bit-grid renderer/handlers
    // need at interaction time (networkBits/maxBorrow to clamp clicks,
    // requirementType/requiredCount/totalHostBits to drive the live
    // formula box). Everything else keeps the same shape every other
    // conversion question already uses.
    const atom1Extra = q.type === 'atom1' ? {
        octets: q.octets,
        classLabel: q.classLabel,
        networkBits: q.networkBits,
        totalHostBits: q.totalHostBits,
        maxBorrow: q.maxBorrow,
        requirementType: q.requirementType,
        requiredCount: q.requiredCount,
        correctBits: q.correctBits,
        correctCidr: q.correctCidr
    } : {};
    // Atom 2 questions carry the fields its grid/panel needs: the given
    // host IP octets, class, classful networkBits (drives the locked
    // portion of the grid), and the target classless CIDR (shown in the
    // prompt/Panel 1 only — never re-derived from or displayed on the grid
    // itself).
    const atom2Extra = q.type === 'atom2' ? {
        octets: q.octets,
        classLabel: q.classLabel,
        networkBits: q.networkBits,
        targetCidr: q.targetCidr
    } : {};
    // Atom 3 questions carry the fields its boundary-setting grid needs —
    // the same shape as Atom 1's own extra fields (octets/networkBits/
    // maxBorrow clamp the clickable range), plus the static targetCidr
    // shown as given information in Panel 1.
    const atom3Extra = q.type === 'atom3' ? {
        octets: q.octets,
        classLabel: q.classLabel,
        networkBits: q.networkBits,
        maxBorrow: q.maxBorrow,
        targetCidr: q.targetCidr,
        correctBits: q.correctBits
    } : {};
    const atom4AnswerCount = q.type === 'atom4' ? (2 + atom3SubnetIndicesForBorrowed(q.correctBits).length + 2) : null;
    const atom4Extra = q.type === 'atom4' ? {
        octets: q.octets,
        classLabel: q.classLabel,
        networkBits: q.networkBits,
        maxBorrow: q.maxBorrow,
        correctBits: q.borrowedBits,
        borrowedBits: q.borrowedBits,
        hostBits: q.hostBits,
        targetCidr: q.targetCidr,
        // Atom 4 subnet IDs are entered per displayed row, just like Atom 3;
        // there is no single target subnet or fixed subnet-bit pattern.
    } : {};
    return Object.assign({
        html: renderQuestionHtml(item.name, q),
        answers: isOctetScored
            ? [[], [], [], []]
            : (q.type === 'atom3' ? Array.from({ length: atom3AnswerCount }, () => []) : (q.type === 'atom4' ? Array.from({ length: atom4AnswerCount }, () => []) : [[q.correct]])), // length drives the score denominator everywhere (sidebar, summary, exam completion)
        correct: q.correct,
        type: q.type,
        bitWidth: q.bitWidth,
        given: q.given,
        promptHtml: q.promptHtml,
        label: item.label,
        shortLabel: item.shortLabel,
        phase: item.phase,
        sampleOutput: '',
        userAnswer: '',
        score: 0,
        locked: false,
        isPartial: false,
        isConversionQuestion: true,
        isLineOrdering: false
    }, atom1Extra, atom2Extra, atom3Extra, atom4Extra);
}

function renderBitGroup(qid, width) {
    // Mirrors the Phase 3/6 octet bit-grid's presentation, adapted for the
    // fact Phase 1 has no compact/expanded distinction — there's no
    // separate collapsed field this grid swaps out of, it's just always
    // shown this way. Same two ideas carried over:
    //   1. One continuous row, no mid-row separator — a visible gap implied
    //      two disconnected groups (see renderExpandableOctetBitboxes'
    //      comment); this is one binary value regardless of width.
    //   2. Each box gets its own decimal place-value label above it
    //      (2^(width-1-i) for a value of this width), muted by default and
    //      lighting up whenever that bit is set to 1, via
    //      updatePlainBitPlaceValueLabel — making the
    //      decimal-equals-sum-of-active-place-values relationship visible
    //      as the student types.
    let html = `<div class="bitgroup" data-qid="${qid}">`;
    for (let i = 0; i < width; i++) {
        const placeValue = Math.pow(2, width - 1 - i);
        html += `<div class="octet-bit-col">` +
                    `<span class="bit-place-value muted" data-qid="${qid}" data-idx="${i}">${placeValue}</span>` +
                    `<input class="bitbox" maxlength="1" inputmode="numeric" data-idx="${i}" data-qid="${qid}">` +
                `</div>`;
    }
    html += `</div>`;
    return html;
}

// Phase 2 (Binary -> Decimal): renders the question's "given" binary value
// using the exact same bitgroup/bitbox/place-value markup as Phase 1's
// renderBitGroup above, so a student who's built up familiarity with that
// per-bit, place-value-labeled layout in Phase 1 sees the same visual
// language here rather than a plain inline string. The key difference is
// this grid is entirely pre-filled and non-interactive: it's presenting a
// known, given value, not collecting an answer (the decimal answer is
// still gathered separately via the normal .answer-input-num field), so
// each box is `readonly` + `tabindex="-1"` (keeps it out of the tab order
// entirely, since there's nothing to type into it) and — because the bit
// values are fixed at render time rather than changing as someone types —
// the on/off box state and active/muted place-value label are computed
// once right here instead of via the input-event handlers Phase 1 uses.
function renderReadOnlyBitGroup(qid, binStr, width) {
    const bits = (binStr || '').padStart(width, '0');
    let html = `<div class="bitgroup bitgroup-readonly" data-qid="${qid}">`;
    for (let i = 0; i < width; i++) {
        const placeValue = Math.pow(2, width - 1 - i);
        const bit = bits[i];
        const boxStateClass = bit === '1' ? 'on' : 'off';
        const labelStateClass = bit === '1' ? 'active' : 'muted';
        html += `<div class="octet-bit-col">` +
                    `<span class="bit-place-value ${labelStateClass}">${placeValue}</span>` +
                    `<input class="bitbox readonly-bitbox ${boxStateClass}" value="${bit}" readonly tabindex="-1" aria-label="Bit ${i + 1} of ${width}: ${bit}">` +
                `</div>`;
    }
    html += `</div>`;
    return html;
}

function renderIpOctetInputs(qid, kind) {
    const cls = kind === 'bin' ? 'ip-octet-bin' : 'ip-octet-dec';
    const maxlen = kind === 'bin' ? 8 : 3;
    const placeholder = kind === 'bin' ? '00000000' : '0';
    let html = '';
    for (let i = 0; i < 4; i++) {
        html += `<input type="text" class="${cls}" maxlength="${maxlen}" inputmode="numeric" data-qid="${qid}" data-oct="${i}" placeholder="${placeholder}">`;
        if (i < 3) html += `<span class="octet-dot">.</span>`;
    }
    return html;
}

// Single accent color for the expanded bit-grid "card" (Phase 3 & Phase 6,
// the two IP/mask octet Dec→Bin question types) — the
// same style for every octet, so the four cards read as one consistent
// component rather than four differently-colored ones. Deliberately NOT
// var(--primary) (already the app's button/branding color, so reusing it
// here reads as a call-to-action rather than a grouping) and NOT
// var(--secondary)/var(--error) (those are reserved for correct/wrong
// grading feedback elsewhere in this same UI, via applyOctetFeedback —
// reusing either here would make an unanswered octet look pre-graded).
const OCTET_CARD_ACCENT = '#5C6BC0';

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Standard 8-bit place values, most-significant bit first — matches the
// left-to-right order the bit boxes are already rendered in.
const OCTET_BIT_PLACE_VALUES = [128, 64, 32, 16, 8, 4, 2, 1];

// Shared by Phase 3 (IP Dec→Bin) and Phase 6 (Mask Dec→Bin) — both ask for
// four 8-bit binary octets, so both use this same expand-on-focus UI. Each
// octet starts as the same compact text field as before (kept as class
// "ip-octet-bin" so collect/restore/grade/disable logic elsewhere needs no
// changes), but on focus it swaps out for an 8-box bit grid. The row of
// boxes reuses Phase 1's exact "bitgroup"/"bitbox" markup and classes so it
// inherits Phase 1's per-bit entry feel, but — unlike Phase 1, where
// there's only ever one such row on screen — it's wrapped in its own
// bordered "card" with an "Octet N" label beneath, so it's visually
// unambiguous which octet those 8 boxes belong to. Collapses back to the
// compact field once focus leaves that octet.
//
// Each box also gets its own decimal place-value label (128, 64, ... 1)
// sitting directly above it, muted by default and switching to "active"
// styling whenever that bit is set to 1 (see updateBitPlaceValueLabel) —
// making the decimal-equals-sum-of-active-place-values relationship
// visible as the student types, instead of something computed separately
// after the fact.
function renderExpandableOctetBitboxes(qid, oct) {
    // Like Phase 1's own renderBitGroup, this grid is one continuous row
    // with no mid-row separator — a visible gap there would imply two
    // disconnected 4-bit groups rather than one 8-bit octet, so none is
    // inserted; all 8 boxes sit in a single unbroken row.
    let boxesHtml = '';
    for (let b = 0; b < 8; b++) {
        boxesHtml += `<div class="octet-bit-col">` +
                `<span class="bit-place-value muted" data-qid="${qid}" data-oct="${oct}" data-idx="${b}">${OCTET_BIT_PLACE_VALUES[b]}</span>` +
                `<input class="bitbox octet-bitbox" maxlength="1" inputmode="numeric" data-qid="${qid}" data-oct="${oct}" data-idx="${b}">` +
            `</div>`;
    }

    const containerStyle = 'display:inline-flex;flex-direction:column;align-items:center;gap:6px;' +
        `padding:8px 10px 6px;border:1.5px solid ${OCTET_CARD_ACCENT};border-radius:10px;` +
        `background:${hexToRgba(OCTET_CARD_ACCENT, 0.07)};vertical-align:middle;`;
    const labelStyle = 'font-size:0.7rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;' +
        `color:${OCTET_CARD_ACCENT};`;

    return `<div class="octet-bitgroup" data-qid="${qid}" data-oct="${oct}" style="${containerStyle}">` +
                `<div class="bitgroup octet-bitgroup-row" data-qid="${qid}" data-oct="${oct}">${boxesHtml}</div>` +
                `<span class="octet-label" style="${labelStyle}">Octet ${oct + 1}</span>` +
            `</div>`;
}


function renderIpOctetBinExpandable(qid) {
    let html = '';
    for (let i = 0; i < 4; i++) {
        html += `<span class="octet-expand-wrapper" data-qid="${qid}" data-oct="${i}">` +
            `<input type="text" class="ip-octet-bin ip-octet-collapsed" maxlength="8" inputmode="numeric" data-qid="${qid}" data-oct="${i}" placeholder="00000000">` +
            renderExpandableOctetBitboxes(qid, i) +
            `</span>`;
        if (i < 3) html += `<span class="octet-dot">.</span>`;
    }
    return html;
}

// Renders "192.168.1.0 / ___" — the IP address followed by a slash and an
// underline-style blank for the CIDR prefix number (no boxed border, just
// a line to write on). Reuses the "answer-input-num" class so the existing
// collect/restore/enable-disable wiring (shared with the b2d question
// type) picks it up with no extra plumbing; inline styles override that
// class's default boxed look for this specific input.
function renderClassCidrInput(qid, ip) {
    const lineStyle = 'border:none;border-bottom:2px solid currentColor;background:transparent;' +
        'width:2.5ch;text-align:center;padding:0 2px;box-shadow:none;border-radius:0;';
    return `<span class="cidr-ip-text">${ip}</span><span class="cidr-slash">/</span><input type="text" class="answer-input-num cidr-answer-input" data-qid="${qid}" maxlength="2" inputmode="numeric" style="${lineStyle}">`;
}

/* =========================================================
   ATOM 1: THE CONSTRAINT (BIT QUESTION) — rendering & interaction
   Reuses the exact CSS component language SubnetVisualizer's Panel 1
   (class + octet display), Panel 2 (interactive 32-bit grid), and the
   Panel 4/5 formula-box use — those class names (.bit-grid, .bit-cell,
   .octet-block, .weight-row-main, .formula-box, .class-value,
   .octet-field, .badge-borrow, ...) are plain global selectors in
   styles.css, not scoped to the visualizer's own DOM, so this question
   type can use them directly inside the normal .code-editor question
   card. The actual click/render logic here is a small, self-contained
   parallel to SubnetVisualizer's onBitClick/renderPanel2 (that engine's
   own helpers are private to its IIFE), scoped with an "atom1" prefix so
   nothing here collides with SubnetVisualizer's internals.
========================================================= */
// --- ATOM 1: REQUIREMENT CARD (how the question is COMMUNICATED) ---
// Replaces the old single narrative sentence (previously rendered via
// q.promptHtml inside a plain .conversion-prompt div) with a compact,
// icon-labeled card of three scannable rows: the given network, the
// requirement itself, and the task. This only changes how the question
// text is presented — it reads the exact same fields genAtom1Questions
// already computes (classLabel, octets, networkBits, requirementType,
// requiredCount), and does not touch the bit grid, the given-network
// octet boxes in Panel 1, grading, or any other Atom's rendering.
//
// The given-network row deliberately keeps the IP address and its CIDR
// suffix as one unbroken token ("202.197.98.0/24") — the notation a
// network engineer expects — rather than splitting them apart with the
// Class badge in between; the Class badge sits before that token instead.
function buildAtom1RequirementCardHtml(q) {
    const ipStr = q.octets.join('.');
    const isHosts = q.requirementType === 'hosts';
    const reqIconGlyph = isHosts ? 'fa-house-user' : 'fa-layer-group';
    const reqIconExtraClass = isHosts ? ' atom1-req-icon-hosts' : '';
    const reqNumExtraClass = isHosts ? ' atom1-req-target-num-hosts' : '';
    const reqEyebrow = isHosts ? 'Each subnet must support at least' : 'Must support at least';
    const reqLabel = isHosts
        ? 'usable host' + (q.requiredCount === 1 ? '' : 's')
        : 'subnet' + (q.requiredCount === 1 ? '' : 's');
    const taskText = isHosts
        ? 'Click bits in the grid below to borrow just enough network bits — leaving just enough host bits behind — then verify.'
        : 'Click bits in the grid below to borrow exactly enough network bits, then verify.';

    return (
        '<div class="atom1-req-card">' +
            '<div class="atom1-req-row">' +
                '<div class="atom1-req-icon atom1-req-icon-network"><i class="fa-solid fa-diagram-project" aria-hidden="true"></i></div>' +
                '<div class="atom1-req-body">' +
                    '<div class="atom1-req-eyebrow">Given network</div>' +
                    '<div class="atom1-req-main">' +
                        '<span class="atom1-req-badge">Class ' + q.classLabel + '</span>' +
                        '<span class="atom1-req-value">' + ipStr + '<span class="atom1-req-cidr">/' + q.networkBits + '</span></span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="atom1-req-row">' +
                '<div class="atom1-req-icon atom1-req-icon-requirement' + reqIconExtraClass + '"><i class="fa-solid ' + reqIconGlyph + '" aria-hidden="true"></i></div>' +
                '<div class="atom1-req-body">' +
                    '<div class="atom1-req-eyebrow">' + reqEyebrow + '</div>' +
                    '<div class="atom1-req-target">' +
                        '<span class="atom1-req-target-num' + reqNumExtraClass + '">' + q.requiredCount + '</span>' +
                        '<span class="atom1-req-target-label">' + reqLabel + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="atom1-req-row">' +
                '<div class="atom1-req-icon atom1-req-icon-action"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i></div>' +
                '<div class="atom1-req-body">' +
                    '<div class="atom1-req-eyebrow">Your task</div>' +
                    '<div class="atom1-req-action-text">' + taskText + '</div>' +
                '</div>' +
            '</div>' +
        '</div>'
    );
}

function atom1ToBinary8(n) {
    const v = Math.max(0, Math.min(255, Number(n) || 0));
    return v.toString(2).padStart(8, '0').split('').map(Number);
}
function atom1OctetsToBits(octets) {
    return octets.flatMap(atom1ToBinary8);
}
function atom1BitsToOctet(bitsArr) {
    return parseInt(bitsArr.join(''), 2);
}

// Builds the inner HTML of the 32-bit grid for a given borrowed-bit count.
// Bits before networkBits are locked (blue, non-clickable — classful
// network portion); the rest are borrowed (amber) up to
// networkBits+borrowedBits, then host (green) — identical color/role
// language to SubnetVisualizer's own Panel 2.
function renderAtom1BitGridInner(qid, inputBits, networkBits, borrowedBits) {
    const totalBorrowEnd = networkBits + borrowedBits;
    // Same live prefix SubnetVisualizer's own Panel 2 attaches to its last
    // octet — classful network bits plus however many have been borrowed
    // so far, so it updates in place as bits are clicked.
    const totalPrefix = networkBits + borrowedBits;
    let html = '';
    for (let g = 0; g < 4; g++) {
        const bitsSlice = inputBits.slice(g * 8, g * 8 + 8);
        const kindsSlice = bitsSlice.map((_, k) => {
            const gi = g * 8 + k;
            if (gi < networkBits) return 'locked';
            if (gi < totalBorrowEnd) return 'borrowed';
            return 'host';
        });

        html += '<div class="octet-block">';
        // Octet 4 mirrors SubnetVisualizer.renderPanel2: the live CIDR
        // suffix rides right alongside the last octet's total ("0/24"),
        // not just up in the Panel-1 network row / borrow badge — this is
        // the piece Atom 1's grid was missing versus Subnetify's own.
        if (g === 3) {
            html += '<div class="octet-total-cidr-wrap">' +
                        '<div class="octet-total octet-total-main">' + atom1BitsToOctet(bitsSlice) + '</div>' +
                        '<span class="decimal-cidr-suffix cidr-suffix-viz">/' + totalPrefix + '</span>' +
                    '</div>';
        } else {
            html += '<div class="octet-total octet-total-main">' + atom1BitsToOctet(bitsSlice) +
                '<span class="octet-total-dot">.</span></div>';
        }

        html += '<div class="weight-row weight-row-main">';
        OCTET_BIT_PLACE_VALUES.forEach((w, k) => {
            const lit = bitsSlice[k] === 1;
            const cls = lit ? ('weight-num weight-lit weight-lit-' + kindsSlice[k]) : 'weight-num weight-muted';
            html += '<span class="' + cls + '">' + w + '</span>';
        });
        html += '</div>';

        html += '<div class="bit-octet-group">';
        for (let b = 0; b < 8; b++) {
            const gi = g * 8 + b;
            const kind = kindsSlice[b];
            html += '<div class="bit-cell ' + kind + '" data-idx="' + gi + '"' +
                (kind !== 'locked' ? ' role="button" tabindex="0" title="Click to set the subnet boundary here"' : '') + '>' +
                (kind === 'locked' ? '<span class="lock-icon"><i class="fa-solid fa-lock"></i></span>' : '') +
                '<span class="bit-value">' + bitsSlice[b] + '</span>' +
                '</div>';
        }
        html += '</div>';

        html += '<div class="octet-viz-label">Octet ' + (g + 1) + '</div>';
        html += '</div>';

        if (g < 3) html += '<div class="octet-dot-separator">.</div>';
    }
    return html;
}

// Live formula content (Panel 4/5 formula-box visual language): recomputes
// from the CURRENT borrowed-bit count, not the correct answer, so it's a
// self-check aid rather than an answer key — mirrors how SubnetVisualizer's
// own formula boxes always reflect current state.borrowedBits.
function buildAtom1FormulaContent(qOrEx, borrowedBits) {
    if (qOrEx.requirementType === 'subnets') {
        const totalSubnets = Math.pow(2, borrowedBits);
        const meets = totalSubnets >= qOrEx.requiredCount;
        return '<span class="formula-line"><span class="formula-term">Total Subnets</span> = 2<sup>borrowed bits</sup> = 2<sup>' + borrowedBits + '</sup> = ' +
            '<span class="formula-highlight-subnet">' + totalSubnets + '</span></span>' +
            '<span class="formula-note">Requirement: at least ' + qOrEx.requiredCount + ' subnet' + (qOrEx.requiredCount === 1 ? '' : 's') + '. Currently ' +
            (meets ? 'satisfied ✓' : 'not yet satisfied ✗') + '.</span>';
    }
    const hostBitsLeft = qOrEx.totalHostBits - borrowedBits;
    const totalHosts = Math.pow(2, Math.max(0, hostBitsLeft));
    const usable = Math.max(0, totalHosts - 2);
    const meets = usable >= qOrEx.requiredCount;
    return '<span class="formula-line"><span class="formula-term">Usable Hosts</span> = 2<sup>host bits</sup> &minus; 2 = 2<sup>' + hostBitsLeft + '</sup> &minus; 2 = ' +
        '<span class="formula-highlight-host">' + usable + '</span></span>' +
        '<span class="formula-note">Requirement: at least ' + qOrEx.requiredCount + ' usable host' + (qOrEx.requiredCount === 1 ? '' : 's') + ' per subnet. Currently ' +
        (meets ? 'satisfied ✓' : 'not yet satisfied ✗') + '.</span>';
}

function renderAtom1FormulaBox(qid, q, borrowedBits) {
    const cls = q.requirementType === 'subnets' ? 'formula-box-subnet' : 'formula-box-host';
    return '<div class="formula-box ' + cls + ' atom1-formula-box" id="atom1FormulaBox-' + qid + '">' +
        buildAtom1FormulaContent(q, borrowedBits) + '</div>';
}

// Re-renders the grid + borrow badge + (if present) formula box for a new
// borrowed-bit count. Called on every click and on restore.
function updateAtom1Grid(qid, ex, borrowedBits) {
    const grid = document.getElementById('atom1BitGrid-' + qid);
    if (!grid) return;
    const inputBits = atom1OctetsToBits(ex.octets);
    grid.dataset.borrowed = String(borrowedBits);
    grid.innerHTML = renderAtom1BitGridInner(qid, inputBits, ex.networkBits, borrowedBits);

    const badge = document.getElementById('atom1BorrowBadge-' + qid);
    if (badge) {
        badge.innerHTML = '<span>' + borrowedBits + ' bit' + (borrowedBits === 1 ? '' : 's') + ' borrowed &rarr; /' + (ex.networkBits + borrowedBits) + '</span>';
    }

    const formulaBox = document.getElementById('atom1FormulaBox-' + qid);
    if (formulaBox) formulaBox.innerHTML = buildAtom1FormulaContent(ex, borrowedBits);
}

function renderAtom1QuestionHtml(qid, q) {
    const inputBits = atom1OctetsToBits(q.octets);

    // The given-network octet-box row (Class | Octet 1-4 | /CIDR) that used
    // to render here was dropped: it duplicated the same address/class/CIDR
    // already shown in the requirement card above (buildAtom1RequirementCardHtml),
    // and the bit grid below still displays each octet's own live total, so
    // nothing is lost by removing the redundant static row.

    const gridHtml =
        '<div class="atom1-bitgrid-wrap">' +
            '<div class="badge badge-borrow atom1-borrow-badge" id="atom1BorrowBadge-' + qid + '">' +
                '<span>0 bits borrowed &rarr; /' + q.networkBits + '</span>' +
            '</div>' +
            '<div class="bit-grid atom1-bitgrid" id="atom1BitGrid-' + qid + '" data-qid="' + qid + '" data-network-bits="' + q.networkBits + '" data-max-borrow="' + q.maxBorrow + '" data-borrowed="0">' +
                renderAtom1BitGridInner(qid, inputBits, q.networkBits, 0) +
            '</div>' +
            '<div class="legend secondary-copy">' +
                '<span><i class="swatch swatch-locked"></i> Locked network bit</span>' +
                '<span><i class="swatch swatch-borrowed"></i> Borrowed subnet bit</span>' +
                '<span><i class="swatch swatch-host"></i> Host bit</span>' +
            '</div>' +
        '</div>';

    // Formula stays visible throughout Practice Mode (so the student only
    // has to click bits and self-check against the live numbers); Exam
    // Mode hides it, same principle as hiding bit place-value labels there.
    const formulaHtml = (appSettings.mode === 'practice') ? renderAtom1FormulaBox(qid, q, 0) : '';

    return '<div class="conversion-question atom1-question" data-qid="' + qid + '">' +
                buildAtom1RequirementCardHtml(q) +
                gridHtml +
                formulaHtml +
            '</div>';
}

// Delegated click/keyboard handling for one question's bit grid. Clicking
// any unlocked bit sets borrowedBits = thatBitIndex - networkBits + 1,
// exactly mirroring SubnetVisualizer's own onBitClick — clicking near the
// boundary shrinks the borrowed range, clicking further out grows it.
function attachAtom1Handlers(qid, ex) {
    const grid = document.getElementById('atom1BitGrid-' + qid);
    if (!grid) return;

    const handleActivate = (cell) => {
        // Keyed off the qid this grid actually belongs to, NOT currentFile —
        // Atom 1's dedicated view renders every question at once, so there
        // is no single "current" exercise the way the Exercises list has.
        if (exerciseData[qid]?.locked) return;
        if (!cell || cell.classList.contains('locked')) return;
        const idx = parseInt(cell.dataset.idx, 10);
        let newBorrowed = idx - ex.networkBits + 1;
        newBorrowed = Math.max(0, Math.min(newBorrowed, ex.maxBorrow));
        updateAtom1Grid(qid, ex, newBorrowed);
        saveAtom1Progress(qid);
    };

    grid.addEventListener('click', (e) => {
        handleActivate(e.target.closest('.bit-cell'));
    });
    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cell = e.target.closest && e.target.closest('.bit-cell');
        if (!cell) return;
        e.preventDefault();
        handleActivate(cell);
    });
}

/* =========================================================
   ATOM PAGINATION — shared one-question-at-a-time navigator
   Used by Atom 1-4's dedicated views. Each view renders every question's
   panel up front (buildAtomXPanelHtml), all sharing the ".atom1-q-panel"
   class regardless of which Atom built them — so the panel list for any
   given atom is just `container.querySelectorAll('.atom1-q-panel')`, in
   DOM order, no separate id bookkeeping needed.

   Only the current panel is shown (display: '') / all others hidden
   (display: 'none') — this is real paging, not scroll-to, since a long
   list of full-size Panel-2-style bit grids is the exact thing that makes
   mobile scrolling painful in the first place. A bar with First/Prev/
   [number buttons]/Next/Last renders below the questions; on narrow
   screens the number buttons are hidden by CSS in favor of a jump <select>
   showing "Q3 / 10" between the Prev/Next arrows.

   State is keyed by atomKey ('atom1'..'atom4') so each view's current
   page is independent and survives being re-synced (syncAtomXViewDOM)
   without resetting to page 1 on every login-time DOM sync pass — sync
   only touches per-question state, never calls showAtomQuestion.
========================================================= */
const ATOM_PAGINATION = {};

function getAtomPanels(atomKey) {
    const container = document.getElementById(atomKey + 'QuestionsContainer');
    if (!container) return [];
    return Array.from(container.querySelectorAll(':scope > .atom1-q-panel'));
}

// Fixed-size sliding window of page numbers, e.g. with ATOM_PAGE_WINDOW_SIZE
// = 5 and total=12: current=1 -> [1,2,3,4,5]; current=6 -> [4,5,6,7,8];
// current=12 -> [8,9,10,11,12]. Deliberately NOT an ellipsis-based list —
// an ellipsis appearing/disappearing as the boundary is approached changes
// how many items are rendered, which changes the row's width call to call.
// A constant-length window (always exactly ATOM_PAGE_WINDOW_SIZE items, or
// `total` itself when there are fewer questions than that) means the same
// number of buttons renders on every page, so paired with the fixed CSS
// width on .atom-page-numbers, the whole bar never resizes as the student
// moves between questions.
const ATOM_PAGE_WINDOW_SIZE = 5;

function buildAtomPageWindow(total, current) {
    if (total <= ATOM_PAGE_WINDOW_SIZE) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }
    let start = current - Math.floor(ATOM_PAGE_WINDOW_SIZE / 2);
    start = Math.max(1, Math.min(start, total - ATOM_PAGE_WINDOW_SIZE + 1));
    return Array.from({ length: ATOM_PAGE_WINDOW_SIZE }, (_, i) => start + i);
}

function buildAtomPaginationHtml(atomKey, total, currentIdx) {
    if (total <= 1) return '';
    const current = currentIdx + 1; // 1-based for display/comparison

    const numbersHtml = buildAtomPageWindow(total, current).map(p => {
        const isActive = p === current;
        return '<button type="button" class="atom-page-btn' + (isActive ? ' active' : '') + '" data-atom="' + atomKey + '" data-page="' + (p - 1) + '"' +
            (isActive ? ' aria-current="true"' : '') + ' aria-label="Go to question ' + p + '">' + p + '</button>';
    }).join('');

    let jumpOptionsHtml = '';
    for (let i = 0; i < total; i++) {
        jumpOptionsHtml += '<option value="' + i + '"' + (i === currentIdx ? ' selected' : '') + '>' + (i + 1) + '</option>';
    }

    const atFirst = currentIdx === 0;
    const atLast = currentIdx === total - 1;

    return (
        '<nav class="atom-pagination" data-atom="' + atomKey + '" aria-label="Question navigation">' +
            '<button type="button" class="atom-page-nav-btn atom-page-first" data-atom="' + atomKey + '" data-page="0"' + (atFirst ? ' disabled' : '') + ' aria-label="First question"><i class="fa-solid fa-angles-left" aria-hidden="true"></i></button>' +
            '<button type="button" class="atom-page-nav-btn atom-page-prev" data-atom="' + atomKey + '" data-page="' + (currentIdx - 1) + '"' + (atFirst ? ' disabled' : '') + ' aria-label="Previous question"><i class="fa-solid fa-angle-left" aria-hidden="true"></i></button>' +
            '<div class="atom-page-numbers">' + numbersHtml + '</div>' +
            '<div class="atom-page-mobile-indicator">' +
                '<select class="atom-page-jump-select" data-atom="' + atomKey + '" aria-label="Jump to question">' + jumpOptionsHtml + '</select>' +
                '<span class="atom-page-mobile-total">of ' + total + '</span>' +
            '</div>' +
            '<button type="button" class="atom-page-nav-btn atom-page-next" data-atom="' + atomKey + '" data-page="' + (currentIdx + 1) + '"' + (atLast ? ' disabled' : '') + ' aria-label="Next question"><i class="fa-solid fa-angle-right" aria-hidden="true"></i></button>' +
            '<button type="button" class="atom-page-nav-btn atom-page-last" data-atom="' + atomKey + '" data-page="' + (total - 1) + '"' + (atLast ? ' disabled' : '') + ' aria-label="Last question"><i class="fa-solid fa-angles-right" aria-hidden="true"></i></button>' +
        '</nav>'
    );
}

function renderAtomPaginationBar(atomKey) {
    const holder = document.getElementById(atomKey + 'PaginationContainer');
    if (!holder) return;
    const state = ATOM_PAGINATION[atomKey];
    const total = state ? state.total : 0;
    const current = state ? state.current : 0;
    holder.innerHTML = buildAtomPaginationHtml(atomKey, total, current);
}

// Shows only the panel at `index`, hides the rest, updates state + bar,
// and scrolls the question container back into view (useful after paging
// from a long question further down the list).
function showAtomQuestion(atomKey, index, opts) {
    const state = ATOM_PAGINATION[atomKey];
    if (!state || !state.total) return;
    const safeIndex = Math.max(0, Math.min(index, state.total - 1));
    state.current = safeIndex;

    const panels = getAtomPanels(atomKey);
    panels.forEach((panel, i) => {
        panel.style.display = i === safeIndex ? '' : 'none';
    });

    renderAtomPaginationBar(atomKey);

    if (!opts || opts.scroll !== false) {
        const container = document.getElementById(atomKey + 'QuestionsContainer');
        if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Called once per login, right after a view's panels have been (re)built.
// Resets to question 1 — each render pass is a fresh question set (new
// login/session seed), so there's no prior page position worth preserving.
function initAtomPagination(atomKey) {
    const panels = getAtomPanels(atomKey);
    ATOM_PAGINATION[atomKey] = { total: panels.length, current: 0 };
    showAtomQuestion(atomKey, 0, { scroll: false });
}

// --- ATOM PAGINATION BAR VISIBILITY (direct children of <main>) ---
// The four #atomXPaginationContainer bars now live as direct siblings of
// #contentScrollArea under <main class="content"> (see index.html) rather
// than nested inside their own atomXView — that's what makes each one a
// real block-level boundary below the scrollable question area instead of
// an overlay floating on top of it. Because they're no longer nested
// inside atomXView, they no longer get hidden "for free" whenever that
// view's own display:none is set; every place that switches the main view
// (Exercises, Subnet Visualizer, an ungraded Atom placeholder, or another
// Atom) must explicitly hide all four and then show at most one.
function hideAllAtomPaginationBars() {
    ['atom1', 'atom2', 'atom3', 'atom4'].forEach(key => {
        const bar = document.getElementById(key + 'PaginationContainer');
        if (bar) bar.style.display = 'none';
    });
}

function showAtomPaginationBar(atomKey) {
    hideAllAtomPaginationBars();
    const bar = document.getElementById(atomKey + 'PaginationContainer');
    if (bar) bar.style.display = 'flex';
}

let atomPaginationDelegated = false;
function attachAtomPaginationHandlers() {
    if (atomPaginationDelegated) return;
    atomPaginationDelegated = true;

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.atom-page-nav-btn, .atom-page-btn');
        if (!btn || btn.disabled) return;
        const atomKey = btn.dataset.atom;
        const page = parseInt(btn.dataset.page, 10);
        if (!atomKey || isNaN(page)) return;
        showAtomQuestion(atomKey, page);
    });

    document.addEventListener('change', (e) => {
        const select = e.target.closest('.atom-page-jump-select');
        if (!select) return;
        const atomKey = select.dataset.atom;
        const page = parseInt(select.value, 10);
        if (!atomKey || isNaN(page)) return;
        showAtomQuestion(atomKey, page);
    });
}

/* =========================================================
   ATOM 1: DEDICATED FULL-WIDTH VIEW
   Renders every Atom 1 question as its own full-size .panel — the exact
   component the Subnet Visualizer itself uses — stacked on one continuous
   scrollable page, rather than squeezed into the Exercises list's narrow
   .code-editor card. Panel-1-style given network, Panel-2-style bit grid,
   and the formula box are all reused as-is (renderAtom1BitGridInner,
   renderAtom1FormulaBox, updateAtom1Grid, above); this section only adds
   the page shell, per-question score badge, and independent Verify/Reset
   + feedback controls this view needs since nothing here is routed
   through the shared #actionButton/#feedback the Exercises list uses.
========================================================= */

// Guards against attaching the delegated verify/reset click listener more
// than once — the container's innerHTML is rebuilt on every login (fresh
// question set), but the container element itself persists, so the
// listener only needs to be attached the first time.
let atom1ActionsDelegated = false;

function buildAtom1PanelHtml(qid, ex, index) {
    const inputBits = atom1OctetsToBits(ex.octets);

    // The given-network octet-box row (Class | Octet 1-4 | /CIDR) that used
    // to render here was dropped: it duplicated the same address/class/CIDR
    // already shown in the requirement card above (buildAtom1RequirementCardHtml),
    // and the bit grid below still displays each octet's own live total, so
    // nothing is lost by removing the redundant static row.

    const gridHtml =
        '<div class="atom1-bitgrid-wrap">' +
            '<div class="badge badge-borrow atom1-borrow-badge" id="atom1BorrowBadge-' + qid + '">' +
                '<span>0 bits borrowed &rarr; /' + ex.networkBits + '</span>' +
            '</div>' +
            '<div class="bit-grid atom1-bitgrid" id="atom1BitGrid-' + qid + '" data-qid="' + qid + '" data-network-bits="' + ex.networkBits + '" data-max-borrow="' + ex.maxBorrow + '" data-borrowed="0">' +
                renderAtom1BitGridInner(qid, inputBits, ex.networkBits, 0) +
            '</div>' +
            '<div class="legend secondary-copy">' +
                '<span><i class="swatch swatch-locked"></i> Locked network bit</span>' +
                '<span><i class="swatch swatch-borrowed"></i> Borrowed subnet bit</span>' +
                '<span><i class="swatch swatch-host"></i> Host bit</span>' +
            '</div>' +
        '</div>';

    // Formula stays visible throughout Practice Mode (self-check aid);
    // Exam Mode hides it, same principle as hiding bit place-value labels
    // elsewhere in exam mode.
    const formulaHtml = (appSettings.mode === 'practice') ? renderAtom1FormulaBox(qid, ex, 0) : '';

    return (
        '<section class="panel atom1-q-panel" id="atom1QPanel-' + qid + '" data-qid="' + qid + '">' +
            '<div class="panel-head">' +
                '<span class="panel-index">Q' + index + '</span>' +
                '<h2>' + (ex.requirementType === 'subnets' ? 'Subnet Requirement' : 'Host Requirement') + '</h2>' +
                '<span class="badge atom1-score-badge" id="atom1ScoreBadge-' + qid + '">0/1</span>' +
            '</div>' +
            buildAtom1RequirementCardHtml(ex) +
            gridHtml +
            formulaHtml +
            '<div class="atom1-actions">' +
                '<button class="primary-btn atom1-verify-btn" data-qid="' + qid + '">Verify Answer</button>' +
                '<div class="atom1-feedback" id="atom1Feedback-' + qid + '" role="status" aria-live="polite"></div>' +
            '</div>' +
        '</section>'
    );
}

// Builds the full Atom 1 page from scratch (called once per login) and
// wires up each question's bit-grid interaction plus a single delegated
// click listener for every Verify/Reset button on the page.
function renderAtom1View(atom1List) {
    const container = document.getElementById('atom1QuestionsContainer');
    if (!container) return;

    container.innerHTML = atom1List
        .map((item, i) => buildAtom1PanelHtml(item.name, exerciseData[item.name], i + 1))
        .join('');

    atom1List.forEach(item => {
        attachAtom1Handlers(item.name, exerciseData[item.name]);
    });

    if (!atom1ActionsDelegated) {
        atom1ActionsDelegated = true;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.atom1-verify-btn');
            if (!btn) return;
            const qid = btn.dataset.qid;
            const ex = exerciseData[qid];
            if (!ex) return;
            if (ex.locked) {
                resetAtom1Question(qid);
            } else {
                verifyAtom1Question(qid);
            }
        });
    }

    attachAtomPaginationHandlers();
    initAtomPagination('atom1');
}

// Persists the in-progress borrowed-bit count for one Atom 1 question
// (analogous to saveConversionProgress, but keyed off the question's own
// qid rather than the single global currentFile).
function saveAtom1Progress(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;
    const grid = document.getElementById('atom1BitGrid-' + qid);
    ex.userAnswer = grid ? (grid.dataset.borrowed || '0') : (ex.userAnswer || '');
    if (appSettings.mode === 'exam') saveExamSession();
}

// Sets the Verify/Reset/Locked button label + disabled state for one
// question, matching the same rules the shared #actionButton follows:
// locked + practice -> "Reset" (enabled); locked + exam -> "Locked"
// (disabled); unlocked -> "Verify Answer".
function setAtom1ButtonState(qid) {
    const ex = exerciseData[qid];
    const btn = document.querySelector('.atom1-verify-btn[data-qid="' + qid + '"]');
    if (!btn || !ex) return;
    if (ex.locked) {
        if (appSettings.mode === 'practice') {
            btn.textContent = 'Reset';
            btn.disabled = false;
        } else {
            btn.textContent = 'Locked';
            btn.disabled = true;
        }
    } else {
        btn.textContent = 'Verify Answer';
        btn.disabled = false;
    }
}

// Renders this question's per-question feedback message, reusing the same
// buildFeedbackForExercise/renderFeedback helpers the Exercises list uses
// so the wording (including "No answer submitted." for an untouched,
// exam-expired question) stays identical across both views.
function updateAtom1QuestionFeedback(qid, ex) {
    const el = document.getElementById('atom1Feedback-' + qid);
    if (!el) return;
    if (!ex || !ex.locked) {
        el.textContent = '';
        el.className = 'atom1-feedback';
        return;
    }
    const feedback = buildFeedbackForExercise(ex);
    renderFeedback(el, feedback);
    el.className = 'atom1-feedback ' + feedback.cls;
}

// Updates one question's score badge (max always 1/1 for Atom 1). Reuses
// the app's existing bare .completed-score/.partial-score classes so the
// coloring matches the Exercises list's own score pills exactly.
function updateAtom1ScoreBadge(qid, ex) {
    const badge = document.getElementById('atom1ScoreBadge-' + qid);
    if (!badge || !ex) return;
    badge.textContent = (ex.score || 0) + '/' + ex.answers.length;
    badge.classList.remove('completed-score', 'partial-score');
    if (ex.locked) {
        if (ex.score === ex.answers.length) badge.classList.add('completed-score');
        else if (ex.score > 0) badge.classList.add('partial-score');
    }
}

// Applies every visual consequence of this question being locked: the
// panel's correct/incorrect edge color, the bit grid's click-lock, the
// feedback message, the score badge, and the action button label.
function applyAtom1LockedUI(qid, ex) {
    const panel = document.getElementById('atom1QPanel-' + qid);
    const grid = document.getElementById('atom1BitGrid-' + qid);
    const isCorrect = (ex.score || 0) > 0;

    if (panel) {
        panel.classList.remove('correct', 'incorrect');
        panel.classList.add(isCorrect ? 'correct' : 'incorrect');
    }
    if (grid) grid.classList.add('atom1-locked');

    updateAtom1QuestionFeedback(qid, ex);
    updateAtom1ScoreBadge(qid, ex);
    setAtom1ButtonState(qid);
}

// Grades and locks one Atom 1 question — the Atom 1 equivalent of
// checkAnswers, but scoped to a single question's qid since every
// question on this page has its own independent Verify button.
function verifyAtom1Question(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;

    const grid = document.getElementById('atom1BitGrid-' + qid);
    const userAnswer = grid ? (grid.dataset.borrowed || '0') : '0';
    ex.userAnswer = userAnswer;

    const isCorrect = gradeConversionAnswer(ex, userAnswer);
    ex.score = isCorrect ? 1 : 0;
    ex.isPartial = false;
    ex.locked = true;

    applyAtom1LockedUI(qid, ex);
    updateAtom1NavScore();
    updateSummaryPanel();

    if (isCorrect) triggerConfetti();

    if (appSettings.mode === 'exam') {
        saveExamSession();
        if (checkIfAllAnswered()) {
            stopTimer();
            setTimeout(() => {
                showScoreSummaryModal('Congratulations! All exercises completed before time ran out!', 'success');
            }, 500);
        }
    }
}

// Resets one Atom 1 question — practice mode only, mirroring
// resetCurrentExercise's exam-mode guard.
function resetAtom1Question(qid) {
    if (appSettings.mode === 'exam') {
        showAlertModal('Reset Not Allowed', 'Reset is not allowed in Exam Mode.');
        return;
    }
    const ex = exerciseData[qid];
    if (!ex) return;

    ex.userAnswer = '';
    ex.score = 0;
    ex.isPartial = false;
    ex.locked = false;

    updateAtom1Grid(qid, ex, 0);

    const panel = document.getElementById('atom1QPanel-' + qid);
    if (panel) panel.classList.remove('correct', 'incorrect');
    const grid = document.getElementById('atom1BitGrid-' + qid);
    if (grid) grid.classList.remove('atom1-locked');

    updateAtom1QuestionFeedback(qid, null);
    updateAtom1ScoreBadge(qid, ex);
    setAtom1ButtonState(qid);
    updateAtom1NavScore();
    updateSummaryPanel();
}

// Aggregates every atom1-q* exercise into a single X/N readout on the
// sidebar's "Atom 1" nav entry — its nav tag, per the finalized plan,
// shows a live score readout (same completed/partial/unanswered coloring
// as the Exercises list' score pills) instead of the "Ungraded" pill
// Atom 2–5 keep.
function updateAtom1NavScore() {
    const scoreEl = document.getElementById('score-atom1');
    if (!scoreEl) return;
    let got = 0;
    let total = 0;
    for (const file in exerciseData) {
        if (file.indexOf('atom1-q') === 0) {
            const ex = exerciseData[file];
            got += Number(ex.score || 0);
            total += ex.answers.length;
        }
    }
    scoreEl.textContent = got + '/' + total;
    scoreEl.classList.remove('completed-score', 'partial-score');
    if (total > 0 && got === total) {
        scoreEl.classList.add('completed-score');
    } else if (got > 0) {
        scoreEl.classList.add('partial-score');
    }
}

// Re-applies every Atom 1 question's current exerciseData state (grid
// borrowed-bit count, locked styling, feedback, badge) onto the already-
// rendered DOM. Called once per login, after exam-session restore (and
// any timer-expiry force-lock) has already updated exerciseData itself —
// this is what actually makes those restored/expired states visible, since
// Atom 1's view has no per-question lazy render step like switchExercise.
function syncAtom1ViewDOM() {
    for (const file in exerciseData) {
        if (file.indexOf('atom1-q') !== 0) continue;
        const ex = exerciseData[file];
        if (!ex) continue;

        const borrowed = parseInt(ex.userAnswer, 10);
        const safeBorrowed = isNaN(borrowed) ? 0 : Math.max(0, Math.min(borrowed, ex.maxBorrow));
        updateAtom1Grid(file, ex, safeBorrowed);

        if (ex.locked) {
            applyAtom1LockedUI(file, ex);
        } else {
            setAtom1ButtonState(file);
        }
    }
    updateAtom1NavScore();
}

// --- Sidebar navigation into the Atom 1 view (Tools → Atoms → Atom 1) ---
// Mirrors showSubnetVisualizer/showAtomPage's page-switching pattern (hide
// every other view, clear currentFile since no single exercise is
// "current" here, close the console drawer), plus keeps the exam timer bar
// visible here too — unlike the ungraded tools, Atom 1 is scored and
// counts toward exam completion, so the countdown should stay visible
// while working through it.
function showAtom1Page() {
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    const navItem = document.getElementById('nav-atom1');
    if (navItem) navItem.classList.add('active');

    document.getElementById('exerciseArea').style.display = 'none';
    document.getElementById('subnetVisualizerView').style.display = 'none';
    document.getElementById('atomPlaceholderView').style.display = 'none';
    document.getElementById('atom2View').style.display = 'none';
    document.getElementById('atom3View').style.display = 'none';
    document.getElementById('atom4View').style.display = 'none';
    document.getElementById('atom1View').style.display = 'flex';
    document.getElementById('timerContainer').style.display = timerIntervalId ? 'flex' : 'none';

    showAtomPaginationBar('atom1');

    currentFile = ''; // no single graded exercise is "current" on this page

    closeSampleOutputModal();
    updateConsoleDrawerTab(false);

    closeSidebarIfMobile();
}

/* =========================================================
   ATOM 2: THE MASK ASSEMBLY (INTERESTING OCTET) — rendering & interaction
   Follows Atom 1's lead throughout: same .panel/.bit-grid/.bit-cell/
   .class-value/.octet-field component language, same dedicated
   full-width view pattern (own container, own Verify/Reset + feedback per
   question, own nav score aggregation), same self-contained verify/reset
   pathway independent of the shared #actionButton/#feedback the Exercises
   list uses.

   The interaction itself is deliberately different from Atom 1's "click
   sets the subnet boundary" behavior: here every bit beyond the classful
   network portion starts at 0 and toggles independently (0->1->0) on its
   own click, since the student is assembling a specific, already-given
   mask rather than exploring where a boundary should sit. The classful
   network bits are locked to 1 by default (they're always part of any
   mask for this address) using the exact same "locked" bit-cell styling
   Atom 1 and the Subnet Visualizer already use — reused here to mean "this
   bit is fixed," not "this bit is off-limits to view."

   Bit-level coloring still reuses the app's existing locked/borrowed/host
   language even though "borrowed/host" don't map to Atom 2's task in the
   original visualizer sense: a mask bit the student has toggled ON in the
   togglable region IS, definitionally, a bit borrowed from the host
   portion into the network/subnet portion — so amber-for-"on" and
   green-for-"off" stays semantically honest, not just visually recycled.

   The target CIDR is shown once, as given information, in the prompt text
   and in Panel 1's static address readout (mirroring Atom 1's own static
   "/networkBits" suffix there) — but never as a live badge attached to the
   bit grid itself, so the grid can't be used to just read the answer back
   instead of building it.
========================================================= */

// Builds the 32-character '0'/'1' string representing the grid's default
// starting state for a given classful network-bit count: classful bits
// locked to 1, every remaining bit starts at 0. Used both to seed a fresh
// question and to reset an already-answered one.
function initAtom2MaskBits(networkBits) {
    return '1'.repeat(networkBits) + '0'.repeat(32 - networkBits);
}

// Builds the inner HTML of Atom 2's 32-bit grid from its current mask-bit
// string. Unlike Atom 1's renderAtom1BitGridInner (which derives every
// bit's color from a single borrowedBits boundary), each bit's color here
// comes directly from its own current value: locked (classful, always 1),
// "borrowed" styling when toggled on, "host" styling when left off.
function renderAtom2BitGridInner(qid, maskBitsArr, networkBits) {
    let html = '';
    for (let g = 0; g < 4; g++) {
        const bitsSlice = maskBitsArr.slice(g * 8, g * 8 + 8);
        const kindsSlice = bitsSlice.map((b, k) => {
            const gi = g * 8 + k;
            if (gi < networkBits) return 'locked';
            return b === 1 ? 'borrowed' : 'host';
        });

        html += '<div class="octet-block">';
        html += '<div class="octet-total octet-total-main">' + atom1BitsToOctet(bitsSlice) +
            (g < 3 ? '<span class="octet-total-dot">.</span>' : '') + '</div>';

        html += '<div class="weight-row weight-row-main">';
        OCTET_BIT_PLACE_VALUES.forEach((w, k) => {
            const lit = bitsSlice[k] === 1;
            const cls = lit ? ('weight-num weight-lit weight-lit-' + kindsSlice[k]) : 'weight-num weight-muted';
            html += '<span class="' + cls + '">' + w + '</span>';
        });
        html += '</div>';

        html += '<div class="bit-octet-group">';
        for (let b = 0; b < 8; b++) {
            const gi = g * 8 + b;
            const kind = kindsSlice[b];
            html += '<div class="bit-cell ' + kind + '" data-idx="' + gi + '"' +
                (kind !== 'locked' ? ' role="button" tabindex="0" title="Click to toggle this bit"' : '') + '>' +
                (kind === 'locked' ? '<span class="lock-icon"><i class="fa-solid fa-lock"></i></span>' : '') +
                '<span class="bit-value">' + bitsSlice[b] + '</span>' +
                '</div>';
        }
        html += '</div>';

        html += '<div class="octet-viz-label">Octet ' + (g + 1) + '</div>';
        html += '</div>';

        if (g < 3) html += '<div class="octet-dot-separator">.</div>';
    }
    return html;
}

// Re-renders the grid for a new mask-bit string, keeping the grid's own
// dataset in sync (the single source of truth for "what's currently
// toggled on" — read back out at verify/save time).
function updateAtom2Grid(qid, ex, maskBitsStr) {
    const grid = document.getElementById('atom2BitGrid-' + qid);
    if (!grid) return;
    const bitsArr = maskBitsStr.split('').map(Number);
    grid.dataset.maskbits = maskBitsStr;
    grid.innerHTML = renderAtom2BitGridInner(qid, bitsArr, ex.networkBits);
}

// Delegated click/keyboard handling for one question's grid. Clicking any
// unlocked bit flips just that bit (0->1 or 1->0) — independent of every
// other bit, unlike Atom 1's single-boundary click.
function attachAtom2Handlers(qid, ex) {
    const grid = document.getElementById('atom2BitGrid-' + qid);
    if (!grid) return;

    const handleActivate = (cell) => {
        if (exerciseData[qid]?.locked) return;
        if (!cell || cell.classList.contains('locked')) return;
        const idx = parseInt(cell.dataset.idx, 10);
        const current = grid.dataset.maskbits || initAtom2MaskBits(ex.networkBits);
        const chars = current.split('');
        chars[idx] = chars[idx] === '1' ? '0' : '1';
        updateAtom2Grid(qid, ex, chars.join(''));
        saveAtom2Progress(qid);
    };

    grid.addEventListener('click', (e) => {
        handleActivate(e.target.closest('.bit-cell'));
    });
    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cell = e.target.closest && e.target.closest('.bit-cell');
        if (!cell) return;
        e.preventDefault();
        handleActivate(cell);
    });
}

// Persists the in-progress mask-bit string for one Atom 2 question
// (analogous to saveAtom1Progress).
function saveAtom2Progress(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;
    const grid = document.getElementById('atom2BitGrid-' + qid);
    ex.userAnswer = grid ? (grid.dataset.maskbits || initAtom2MaskBits(ex.networkBits)) : (ex.userAnswer || '');
    if (appSettings.mode === 'exam') saveExamSession();
}

// Guards against attaching the delegated verify/reset click listener more
// than once, same rationale as atom1ActionsDelegated.
let atom2ActionsDelegated = false;

// --- ATOM 2: REQUIREMENT CARD (how the question is COMMUNICATED) ---
// Same rationale as Atom 1's buildAtom1RequirementCardHtml: the old plain
// prompt sentence ("Assemble the subnet mask for X/Y") and the static
// Panel 1 octet-box row underneath it were both restating the exact same
// two facts — the given host IP and the target CIDR — one right after the
// other. The bit grid below already shows each octet's own live total (and
// its locked/blue bits already make the classful network portion visually
// obvious), so nothing is lost by stating the given IP/CIDR once, here, in
// the same compact two-row card language Atom 1 uses, instead of twice.
function buildAtom2RequirementCardHtml(ex) {
    const ipStr = ex.octets.join('.');
    return (
        '<div class="atom1-req-card">' +
            '<div class="atom1-req-row">' +
                '<div class="atom1-req-icon atom1-req-icon-network"><i class="fa-solid fa-diagram-project" aria-hidden="true"></i></div>' +
                '<div class="atom1-req-body">' +
                    '<div class="atom1-req-eyebrow">Given host</div>' +
                    '<div class="atom1-req-main">' +
                        '<span class="atom1-req-badge">Class ' + ex.classLabel + '</span>' +
                        '<span class="atom1-req-value">' + ipStr + '<span class="atom1-req-cidr">/' + ex.targetCidr + '</span></span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="atom1-req-row">' +
                '<div class="atom1-req-icon atom1-req-icon-action"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i></div>' +
                '<div class="atom1-req-body">' +
                    '<div class="atom1-req-eyebrow">Your task</div>' +
                    '<div class="atom1-req-action-text">Assemble the subnet mask bit by bit — click a bit to toggle it between 0 and 1. Classful network bits are locked to 1, then verify.</div>' +
                '</div>' +
            '</div>' +
        '</div>'
    );
}

function buildAtom2PanelHtml(qid, ex, index) {
    // Grid always starts rendered in its default state (classful bits
    // locked to 1, rest at 0) — any persisted in-progress/locked state is
    // reapplied afterward by syncAtom2ViewDOM, mirroring Atom 1's own
    // buildAtom1PanelHtml/syncAtom1ViewDOM split.
    const initBits = initAtom2MaskBits(ex.networkBits).split('').map(Number);

    const gridHtml =
        '<div class="atom1-bitgrid-wrap">' +
            '<div class="bit-grid atom1-bitgrid atom2-bitgrid" id="atom2BitGrid-' + qid + '" data-qid="' + qid + '" data-network-bits="' + ex.networkBits + '" data-maskbits="' + initAtom2MaskBits(ex.networkBits) + '">' +
                renderAtom2BitGridInner(qid, initBits, ex.networkBits) +
            '</div>' +
            '<div class="legend secondary-copy">' +
                '<span><i class="swatch swatch-locked"></i> Locked network bit</span>' +
                '<span><i class="swatch swatch-borrowed"></i> Mask bit ON (1)</span>' +
                '<span><i class="swatch swatch-host"></i> Mask bit OFF (0)</span>' +
            '</div>' +
        '</div>';

    return (
        '<section class="panel atom1-q-panel" id="atom2QPanel-' + qid + '" data-qid="' + qid + '">' +
            '<div class="panel-head">' +
                '<span class="panel-index">Q' + index + '</span>' +
                '<h2>Subnet Mask Assembly</h2>' +
                '<span class="badge atom1-score-badge" id="atom2ScoreBadge-' + qid + '">0/1</span>' +
            '</div>' +
            buildAtom2RequirementCardHtml(ex) +
            gridHtml +
            '<div class="atom1-actions">' +
                '<button class="primary-btn atom2-verify-btn" data-qid="' + qid + '">Verify Answer</button>' +
                '<div class="atom1-feedback" id="atom2Feedback-' + qid + '" role="status" aria-live="polite"></div>' +
            '</div>' +
        '</section>'
    );
}

// Builds the full Atom 2 page from scratch (called once per login) and
// wires up each question's bit-grid interaction plus a single delegated
// click listener for every Verify/Reset button on the page — same
// structure as renderAtom1View.
function renderAtom2View(atom2List) {
    const container = document.getElementById('atom2QuestionsContainer');
    if (!container) return;

    container.innerHTML = atom2List
        .map((item, i) => buildAtom2PanelHtml(item.name, exerciseData[item.name], i + 1))
        .join('');

    atom2List.forEach(item => {
        attachAtom2Handlers(item.name, exerciseData[item.name]);
    });

    if (!atom2ActionsDelegated) {
        atom2ActionsDelegated = true;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.atom2-verify-btn');
            if (!btn) return;
            const qid = btn.dataset.qid;
            const ex = exerciseData[qid];
            if (!ex) return;
            if (ex.locked) {
                resetAtom2Question(qid);
            } else {
                verifyAtom2Question(qid);
            }
        });
    }

    attachAtomPaginationHandlers();
    initAtomPagination('atom2');
}

// Sets the Verify/Reset/Locked button label + disabled state for one
// question — same rules as setAtom1ButtonState.
function setAtom2ButtonState(qid) {
    const ex = exerciseData[qid];
    const btn = document.querySelector('.atom2-verify-btn[data-qid="' + qid + '"]');
    if (!btn || !ex) return;
    if (ex.locked) {
        if (appSettings.mode === 'practice') {
            btn.textContent = 'Reset';
            btn.disabled = false;
        } else {
            btn.textContent = 'Locked';
            btn.disabled = true;
        }
    } else {
        btn.textContent = 'Verify Answer';
        btn.disabled = false;
    }
}

// Renders this question's per-question feedback. Reuses
// buildFeedbackForExercise/renderFeedback exactly as Atom 1 does — with
// answers.length === 1, its existing all-or-nothing "Not quite" branch
// already produces the right wording for Atom 2's 1-point score with no
// changes needed there.
function updateAtom2QuestionFeedback(qid, ex) {
    const el = document.getElementById('atom2Feedback-' + qid);
    if (!el) return;
    if (!ex || !ex.locked) {
        el.textContent = '';
        el.className = 'atom1-feedback';
        return;
    }
    const feedback = buildFeedbackForExercise(ex);
    renderFeedback(el, feedback);
    el.className = 'atom1-feedback ' + feedback.cls;
}

// Updates one question's score badge (max always 1/1 for Atom 2) — same
// coloring convention as updateAtom1ScoreBadge.
function updateAtom2ScoreBadge(qid, ex) {
    const badge = document.getElementById('atom2ScoreBadge-' + qid);
    if (!badge || !ex) return;
    badge.textContent = (ex.score || 0) + '/' + ex.answers.length;
    badge.classList.remove('completed-score', 'partial-score');
    if (ex.locked) {
        if (ex.score === ex.answers.length) badge.classList.add('completed-score');
        else if (ex.score > 0) badge.classList.add('partial-score');
    }
}

// Applies every visual consequence of this question being locked — same
// shape as applyAtom1LockedUI. Reuses the "atom1-locked" grid-lock class
// (identical pointer-events/opacity rule already defined for it in CSS;
// the grid also carries the shared "atom1-bitgrid" class, so no new CSS
// selector is needed for Atom 2 specifically).
function applyAtom2LockedUI(qid, ex) {
    const panel = document.getElementById('atom2QPanel-' + qid);
    const grid = document.getElementById('atom2BitGrid-' + qid);
    const isCorrect = (ex.score || 0) === ex.answers.length;

    if (panel) {
        panel.classList.remove('correct', 'incorrect');
        panel.classList.add(isCorrect ? 'correct' : 'incorrect');
    }
    if (grid) grid.classList.add('atom1-locked');

    updateAtom2QuestionFeedback(qid, ex);
    updateAtom2ScoreBadge(qid, ex);
    setAtom2ButtonState(qid);
}

// Grades and locks one Atom 2 question — reads the grid's current
// mask-bit string, converts it to dotted-decimal, and compares the WHOLE
// mask against the correct one. All-or-nothing (1 point), same grading
// shape as Atom 1 — self-contained here since Atom 2 doesn't route
// through the shared checkAnswers flow.
function verifyAtom2Question(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;

    const grid = document.getElementById('atom2BitGrid-' + qid);
    const maskBitsStr = grid ? (grid.dataset.maskbits || initAtom2MaskBits(ex.networkBits)) : initAtom2MaskBits(ex.networkBits);
    const bitsArr = maskBitsStr.split('').map(Number);
    const userOctets = [0, 1, 2, 3].map(g => atom1BitsToOctet(bitsArr.slice(g * 8, g * 8 + 8)));
    const userMask = userOctets.join('.');

    ex.userAnswer = maskBitsStr; // stored as the raw bit string for faithful restore

    const isCorrect = userMask === (ex.correct || '').trim();
    ex.score = isCorrect ? 1 : 0;
    ex.isPartial = false;
    ex.locked = true;

    applyAtom2LockedUI(qid, ex);
    updateAtom2NavScore();
    updateSummaryPanel();

    if (isCorrect) triggerConfetti();

    if (appSettings.mode === 'exam') {
        saveExamSession();
        if (checkIfAllAnswered()) {
            stopTimer();
            setTimeout(() => {
                showScoreSummaryModal('Congratulations! All exercises completed before time ran out!', 'success');
            }, 500);
        }
    }
}

// Resets one Atom 2 question — practice mode only, mirroring
// resetAtom1Question's exam-mode guard.
function resetAtom2Question(qid) {
    if (appSettings.mode === 'exam') {
        showAlertModal('Reset Not Allowed', 'Reset is not allowed in Exam Mode.');
        return;
    }
    const ex = exerciseData[qid];
    if (!ex) return;

    ex.userAnswer = '';
    ex.score = 0;
    ex.isPartial = false;
    ex.locked = false;

    updateAtom2Grid(qid, ex, initAtom2MaskBits(ex.networkBits));

    const panel = document.getElementById('atom2QPanel-' + qid);
    if (panel) panel.classList.remove('correct', 'incorrect');
    const grid = document.getElementById('atom2BitGrid-' + qid);
    if (grid) grid.classList.remove('atom1-locked');

    updateAtom2QuestionFeedback(qid, null);
    updateAtom2ScoreBadge(qid, ex);
    setAtom2ButtonState(qid);
    updateAtom2NavScore();
    updateSummaryPanel();
}

// Aggregates every atom2-q* exercise into a single X/N readout on the
// sidebar's "Atom 2" nav entry, same as updateAtom1NavScore.
function updateAtom2NavScore() {
    const scoreEl = document.getElementById('score-atom2');
    if (!scoreEl) return;
    let got = 0;
    let total = 0;
    for (const file in exerciseData) {
        if (file.indexOf('atom2-q') === 0) {
            const ex = exerciseData[file];
            got += Number(ex.score || 0);
            total += ex.answers.length;
        }
    }
    scoreEl.textContent = got + '/' + total;
    scoreEl.classList.remove('completed-score', 'partial-score');
    if (total > 0 && got === total) {
        scoreEl.classList.add('completed-score');
    } else if (got > 0) {
        scoreEl.classList.add('partial-score');
    }
}

// Re-applies every Atom 2 question's current exerciseData state (grid
// mask-bit string, locked styling, feedback, badge) onto the
// already-rendered DOM — called once per login, after exam-session
// restore, same rationale as syncAtom1ViewDOM.
function syncAtom2ViewDOM() {
    for (const file in exerciseData) {
        if (file.indexOf('atom2-q') !== 0) continue;
        const ex = exerciseData[file];
        if (!ex) continue;

        const maskBitsStr = (typeof ex.userAnswer === 'string' && ex.userAnswer.length === 32)
            ? ex.userAnswer
            : initAtom2MaskBits(ex.networkBits);
        updateAtom2Grid(file, ex, maskBitsStr);

        if (ex.locked) {
            applyAtom2LockedUI(file, ex);
        } else {
            setAtom2ButtonState(file);
        }
    }
    updateAtom2NavScore();
}

// --- Sidebar navigation into the Atom 2 view (Tools → Atoms → Atom 2) ---
// Mirrors showAtom1Page exactly.
function showAtom2Page() {
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    const navItem = document.getElementById('nav-atom2');
    if (navItem) navItem.classList.add('active');

    document.getElementById('exerciseArea').style.display = 'none';
    document.getElementById('subnetVisualizerView').style.display = 'none';
    document.getElementById('atomPlaceholderView').style.display = 'none';
    document.getElementById('atom1View').style.display = 'none';
    document.getElementById('atom2View').style.display = 'flex';
    document.getElementById('atom3View').style.display = 'none';
    document.getElementById('timerContainer').style.display = timerIntervalId ? 'flex' : 'none';
    document.getElementById('atom4View').style.display = 'none';

    showAtomPaginationBar('atom2');

    currentFile = ''; // no single graded exercise is "current" on this page

    closeSampleOutputModal();
    updateConsoleDrawerTab(false);

    closeSidebarIfMobile();
}

/* =========================================================
   ATOM 3: THE SPACE MAP (FRONT & BACK SUBNETS) — rendering & interaction
   Reuses Atom 1's exact boundary-click mechanic and grid renderer
   (renderAtom1BitGridInner / atom1OctetsToBits / atom1BitsToOctet) rather
   than a parallel implementation: the given classful address is shown in
   a Panel-1-style row, the target CIDR is stated as given information
   (same convention as Atom 2's static targetCidr suffix), and clicking any
   unlocked bit in the 32-bit grid sets the subnet boundary there — nothing
   here re-derives the borrowed-bit count for the student; they have to
   read the class off the address and work out (targetCidr - networkBits)
   themselves before clicking.

   Underneath the grid, a live subnet-ID list shows WHICH subnets the
   current boundary position produces (first 4 / last 4, or all of them
   when there are 8 or fewer) — but each one starts at all-zero bits and is
   itself independently clickable, exactly like Atom 2's per-bit toggle
   grid. The list tells the student which subnet numbers to build; it never
   fills in the binary for them. Moving the boundary regenerates the list
   (new subnet numbers, bits reset to 0) since a new boundary means a new
   set of subnets to build.

   Grading is all-or-nothing across BOTH parts: the grid's final boundary
   must equal the target borrowed-bit count, AND every currently-shown
   row's clicked-in bits must correctly represent its own labeled subnet
   number at that bit width.
========================================================= */

// Given a borrowed-bit count, returns the ordered list of subnet indices
// the live list displays for it — every subnet when there are 8 or fewer,
// otherwise the first 4 and last 4. Shared by the renderer (so the
// question always shows the right numbers) and the grader (so "correct"
// is computed against the exact same set), so the two can never drift.
function atom3SubnetIndicesForBorrowed(borrowedBits) {
    const totalSubnets = Math.pow(2, borrowedBits);
    if (borrowedBits <= 0) return [0];
    if (totalSubnets <= 8) return Array.from({ length: totalSubnets }, (_, i) => i);
    return [0, 1, 2, 3, totalSubnets - 4, totalSubnets - 3, totalSubnets - 2, totalSubnets - 1];
}

// Renders the "Subnet Index" bit pattern for one row — the same visual
// language Panel 4's own borrowed-bit pattern viz uses (a decimal total
// on top, a weight row scaled to the borrowed-bit width, a joined compact
// bit-cell strip, and a label underneath), so this reads identically to
// the Subnet Visualizer's own Subnet Permutation Table instead of the old
// flat toggle strip. Every cell is always styled "borrowed" (amber)
// regardless of its current 0/1 value — matching Panel 4's treatment of
// subnet-index bits as inherently subnet bits — only the weight row above
// lights up per the actual value. Cells stay clickable here (role=
// "button") since the student is building this pattern rather than
// viewing a derived one.
//
// Sits directly above the bit-answer grid as a "SUBNET" pill with a
// prominent circular badge, replacing the old plain decimal total and the
// even older muted "Subnet N" caption that used to sit underneath the
// bits. The circle badge — not just plain text — is what signals "this is
// a subnet INDEX", the same kind of numbered-identity cue a sequence
// number alone doesn't carry.
//
// The pill pairs a "SUBNET" label with a live decimal readout — the same
// value the old, now-removed ".octet-total-compact" div used to show on
// its own, so nothing is lost by dropping that separate display; the
// pill's circle IS the total now. The circle shows the LIVE value the
// currently-clicked bits represent, not the static target — it updates in
// real time as the student clicks, but is deliberately NEVER recolored or
// otherwise flagged when it happens to equal the target. Doing so would
// let a student find the right answer by randomly toggling bits until the
// badge turns green, rather than by reasoning out the subnet ID.
// Correctness is only ever revealed after Verify, and then at the level of
// the whole row (see applyAtom3ItemFeedback, which colors the containing
// .subnet-row), not on this live badge. The target number itself (which
// subnet this row is FOR) is answer-relevant, so that's only surfaced via
// the tooltip, and only in Practice Mode.
//
// WRAPPING (per atom3_subnet_mockup_desktop.html / _mobile.html): a
// single flat row of bit-cells only reads cleanly up to about 8 bits —
// beyond that it either overflows its column sideways or the cells shrink
// past legibility. Instead, the strip wraps into 8-bit-wide rows, and
// EACH row gets its own place-value weight strip directly above its own
// bits, rather than one weight row spanning the full (possibly 9-10-bit)
// pattern. That keeps the "this bit is worth this much" mapping legible
// at any borrowed-bit width Atom 3 can generate (up to 10), the same way
// the mockups scale cleanly from 1 up to 16 bits. Bit indices in data-idx
// stay GLOBAL (position within the full pattern, not per-row), so nothing
// downstream (updateAtom3Row's click handler, grading) needs to change.
function buildSubnetIndexInner(bitsArr, options) {
    const config = options || {};
    const n = bitsArr.length;
    const total = n ? parseInt(bitsArr.join(''), 2) : 0;
    const rowsCount = Math.max(1, Math.ceil(n / 8));
    const interactive = config.interactive !== false;
    const bitClass = config.bitClass ? ' ' + config.bitClass : '';

    let rowsHtml = '<div class="bit-rows">';
    for (let r = 0; r < rowsCount; r++) {
        const start = r * 8;
        const chunk = bitsArr.slice(start, start + 8);
        const startPow = n - 1 - start; // place-value exponent of this row's leftmost bit

        let caption = '';
        if (rowsCount > 1) {
            const hi = Math.pow(2, startPow);
            const lo = Math.pow(2, startPow - chunk.length + 1);
            caption = '<div class="bit-row-caption">' + (r === 0 ? 'MSB &middot; ' : '') + hi + ' &rarr; ' + lo + (r === rowsCount - 1 ? ' &middot; LSB' : '') + '</div>';
        }

        let inner = '<div class="bit-row-inner">';
        chunk.forEach((v, i) => {
            const globalIdx = start + i;
            const weight = Math.pow(2, startPow - i);
            const bitAttrs = interactive
                ? ' role="button" tabindex="0" data-idx="' + globalIdx + '" aria-label="Bit worth ' + weight + ', currently ' + v + '"'
                : ' aria-hidden="true"';
            inner += '<div class="bit-col">' +
                        '<span class="bit-weight' + (v === 1 ? ' active' : '') + '">' + weight + '</span>' +
                        '<div class="idx-bit' + bitClass + (v === 1 ? ' on' : '') + '"' + bitAttrs + '>' + v + '</div>' +
                      '</div>';
        });
        inner += '</div>';

        rowsHtml += caption + inner;
    }
    rowsHtml += '</div>';

    const pillTitleAttr = config.pillTitle ? ' title="' + config.pillTitle + '"' : '';
    const hint = config.hint || (interactive ? '&middot; tap bits to answer' : '&middot; read-only');
    const badgeHtml = config.badgeHtml || '<span class="idx-pill-badge">' + total + '</span>';
    const footerHtml = config.footerHtml || '<div class="idx-viz-label">Subnet Index</div>';

    return '<div class="idx-pill-row"' + pillTitleAttr + '>' +
                '<span class="idx-pill-label">Subnet Index <span class="idx-hint">' + hint + '</span></span>' +
                badgeHtml +
            '</div>' +
            rowsHtml +
            footerHtml;
}

function renderAtom3SubnetIndexInner(qid, rowPos, bitsArr, subnetNum) {
    const pillTitle = (appSettings.mode === 'practice')
        ? 'This row builds Subnet ' + subnetNum
        : '';
    const footerHtml = (appSettings.mode === 'practice')
        ? '<div class="idx-viz-label">Target: Subnet ' + subnetNum + '</div>'
        : '<div class="idx-viz-label">Subnet Index</div>';

    return buildSubnetIndexInner(bitsArr, {
        pillTitle,
        footerHtml
    });
}

// Wraps renderAtom3SubnetIndexInner in the "idx-block" answer-card markup
// ported from atom3_subnet_mockup_combined.html — an amber-bordered card
// with its own pill header (live decimal readout) and a bit strip that
// wraps into additional 8-bit rows past 8 borrowed bits, scaling cleanly
// from 1 up to Atom 3's max of 10 (the mockup itself scales 1-16). Unlike
// the old Panel-4-style "octet-bits-group" this replaced, no width needs
// computing here: .idx-block sizes to its own content (its cqi-based
// label sizing keys off the row's own container, see .atom3-subnet-group
// in styles.css), and the grid column it sits in (.subnet-row, "auto 1fr")
// sizes around it automatically.
//
// Carries data-qid/data-row so updateAtom3Row can find and re-render it
// directly, data-subnet so it can restate the same target subnet number on
// every re-render without it being re-passed in from the click handler,
// and the "atom3-bit-row" class + data-bits/id contract every other Atom 3
// helper (collectAtom3Answer, applyAtom3ItemFeedback, syncAtom3ViewDOM, the
// click handler in attachAtom3Handlers) already relies on — only the
// visual language inside it changed here, not that contract.
function renderAtom3SubnetIndexViz(qid, rowPos, bitsArr, subnetNum) {
    // "idx-block" is the mockup's amber-bordered answer card; it also
    // keeps the "atom3-bit-row" marker class (+ id/data-qid/data-row/
    // data-bits) that the click handler, collectAtom3Answer,
    // applyAtom3ItemFeedback, and syncAtom3ViewDOM all already look up by
    // — only the visual language inside it changed, not this contract.
    return '<div class="idx-block atom3-bit-row" id="atom3Row-' + qid + '-' + rowPos + '" data-qid="' + qid + '" data-row="' + rowPos + '" data-subnet="' + subnetNum + '" data-bits="' + bitsArr.join('') + '">' +
        renderAtom3SubnetIndexInner(qid, rowPos, bitsArr, subnetNum) +
        '</div>';
}

// Local duplicate of Panel 4/5's per-octet bit visualization
// (buildSingleOctetBits, private to the SubnetVisualizer IIFE and not
// reachable from here) — renders one octet's total/weight-row/bit-cell/
// label block, including the dashed "curtain" divider marking the
// boundary between borrowed (subnet) and host bits, exactly as Panel 4's
// own "Octet Bits & Subnet ID" column does.
function atom3BuildSingleOctetBits(fullBits, networkBits, borrowEnd, octetIndex) {
    const octetStart = octetIndex * 8;
    const bitsSlice = fullBits.slice(octetStart, octetStart + 8);
    let weightsHtml = '';
    let bitsHtml = '';
    for (let k = 0; k < 8; k++) {
        const gi = octetStart + k;
        let kind = 'host';
        if (gi < networkBits) kind = 'locked';
        else if (gi < borrowEnd) kind = 'borrowed';
        const lit = bitsSlice[k] === 1;
        const isCurtainBit = gi === borrowEnd - 1 && borrowEnd > networkBits && gi < octetStart + 7;
        weightsHtml += '<span class="addr-weight' + (lit ? ' lit-' + kind : '') + '">' + OCTET_BIT_PLACE_VALUES[k] + '</span>';
        bitsHtml += '<div class="addr-bit ' + kind + (isCurtainBit ? ' curtain' : '') + '">' + bitsSlice[k] + '</div>';
    }
    const totalVal = atom1BitsToOctet(bitsSlice);
    const dot = octetIndex < 3 ? '<span class="addr-total-dot">.</span>' : '';

    return '<div class="addr-octet">' +
        '<div class="addr-total-box">' + totalVal + dot + '</div>' +
        '<div class="addr-weight-row">' + weightsHtml + '</div>' +
        '<div class="addr-bits">' + bitsHtml + '</div>' +
        '<div class="addr-octet-label">Octet ' + (octetIndex + 1) + '</div>' +
        '</div>';
}

// Composes the full 32-bit network address for one subnet row — classful
// network-portion bits (from the given classful address) + this row's own
// subnet bits (however many of them the student has clicked to 1 so far)
// + zero-filled host bits — and renders it with the same rich per-octet
// bit visualization Panel 4 uses (see atom3BuildSingleOctetBits above)
// instead of a plain dotted-decimal string. Recomputed live as the
// student clicks each row's bits, mirroring Atom 1's live formula box:
// it only reflects the current attempt, never the target.
function atom3BuildFullAddressViz(ex, subnetBitsArr) {
    const networkBits = ex.networkBits;
    const borrowEnd = networkBits + subnetBitsArr.length;
    const hostBits = Math.max(0, 32 - borrowEnd);
    const prefixBits = atom1OctetsToBits(ex.octets).slice(0, networkBits);
    const fullBits = prefixBits.concat(subnetBitsArr).concat(new Array(hostBits).fill(0));
    let out = '<div class="addr-row">';
    for (let o = 0; o < 4; o++) {
        out += atom3BuildSingleOctetBits(fullBits, networkBits, borrowEnd, o);
    }
    out += '</div>';
    return out;
}

// Builds one subnet's row: its clickable "Subnet Index" bit pattern, and
// — mirroring Panel 4's own "Octet Bits & Subnet ID" column — the full
// composed network address, both rendered with the exact same compact
// bit-visualization language Panel 4 uses. No separate "Subnet N" text
// label — the index box's own decimal total already is that number (see
// renderAtom3SubnetIndexViz), same as Panel 4's own table. Both live
// readouts reflect only what's been entered so far (all-zero / the
// classful-plus-zeros address until the student acts) — neither one
// reveals the target, they only mirror back the current attempt.
function buildAtom3RowHtml(qid, rowPos, subnetNum, borrowedBits, ex) {
    const zeros = new Array(borrowedBits).fill(0);
    if (ex.type === 'atom4') {
        const subnetBits = zeros.join('');
        const hostBits = atom4DefaultBits(ex);
        return (
            '<div class="subnet-row atom4-subnet-row" id="atom3SubnetRow-' + qid + '-' + rowPos + '" data-qid="' + qid + '" data-row="' + rowPos + '">' +
                renderAtom3SubnetIndexViz(qid, rowPos, zeros, subnetNum) +
                '<div class="atom4-row-boundaries" id="atom4RowBoundaries-' + qid + '-' + rowPos + '">' +
                    buildAtom4BoundaryHtml(qid, ex, 'network', hostBits, subnetBits, rowPos) +
                    buildAtom4BoundaryHtml(qid, ex, 'broadcast', hostBits, subnetBits, rowPos) +
                '</div>' +
            '</div>'
        );
    }
    return (
        '<div class="subnet-row" id="atom3SubnetRow-' + qid + '-' + rowPos + '" data-qid="' + qid + '" data-row="' + rowPos + '">' +
            renderAtom3SubnetIndexViz(qid, rowPos, zeros, subnetNum) +
            '<div class="atom3-row-network" id="atom3Network-' + qid + '-' + rowPos + '">' + atom3BuildFullAddressViz(ex, zeros) + '</div>' +
        '</div>'
    );
}

// Builds the live "first N / last N subnets" list for the CURRENT
// borrowed-bit selection — WHICH subnets are shown updates live as the
// boundary moves, but every row's bits always start at 0 for the student
// to build themselves. `ex` is threaded through so each row can compose
// its own live network-address readout (see atom3BuildFullAddressViz).
// Always a single vertical column (.atom3-subnet-group) — when there are
// more than 8 subnets, "First 4"/"Last 4" are two stacked sections within
// that same column rather than two side-by-side groups.
function buildAtom3SubnetListHtml(qid, borrowedBits, ex) {
    const indices = atom3SubnetIndicesForBorrowed(borrowedBits);
    const rowsHtml = indices.map((n, pos) => buildAtom3RowHtml(qid, pos, n, borrowedBits, ex)).join('');

    if (borrowedBits <= 0) {
        return '<div class="atom3-subnet-group"><h3 class="atom3-group-title">Subnets</h3>' + rowsHtml + '</div>';
    }
    const totalSubnets = Math.pow(2, borrowedBits);
    if (totalSubnets <= 8) {
        return '<div class="atom3-subnet-group"><h3 class="atom3-group-title">All ' + totalSubnets + ' Subnet' + (totalSubnets === 1 ? '' : 's') + '</h3>' + rowsHtml + '</div>';
    }
    const firstRowsHtml = indices.slice(0, 4).map((n, pos) => buildAtom3RowHtml(qid, pos, n, borrowedBits, ex)).join('');
    const lastRowsHtml = indices.slice(4, 8).map((n, pos) => buildAtom3RowHtml(qid, pos + 4, n, borrowedBits, ex)).join('');
    return '<div class="atom3-subnet-group">' +
                '<h3 class="atom3-group-title">First 4 Subnets</h3>' + firstRowsHtml +
                '<h3 class="atom3-group-title atom3-group-title-second">Last 4 Subnets</h3>' + lastRowsHtml +
            '</div>';
}

// Re-renders the grid + borrow badge + live subnet list for a new
// borrowed-bit count. Called on every grid click and on restore — the
// subnet list is always rebuilt FRESH (bits reset to 0) since a new
// boundary means a new set of subnets to build from scratch.
function updateAtom3Grid(qid, ex, borrowedBits) {
    const grid = document.getElementById('atom3BitGrid-' + qid);
    if (!grid) return;
    const inputBits = atom1OctetsToBits(ex.octets);
    grid.dataset.borrowed = String(borrowedBits);
    grid.innerHTML = renderAtom1BitGridInner(qid, inputBits, ex.networkBits, borrowedBits);

    const badge = document.getElementById('atom3BorrowBadge-' + qid);
    if (badge) {
        badge.innerHTML = '<span>' + borrowedBits + ' bit' + (borrowedBits === 1 ? '' : 's') + ' borrowed &rarr; /' + (ex.networkBits + borrowedBits) + '</span>';
    }

    const listWrap = document.getElementById('atom3SubnetList-' + qid);
    if (listWrap) listWrap.innerHTML = buildAtom3SubnetListHtml(qid, borrowedBits, ex);
}

// --- ATOM 3: MASK ASSEMBLY GRID (reuses Atom 2's mask-assembly engine) ---
// Once the boundary is set above, the student assembles the matching
// subnet mask bit by bit — classful network bits locked to 1, everything
// else starts at 0 and toggles independently on click, exactly like Atom
// 2's own grid (renderAtom2BitGridInner/initAtom2MaskBits are reused
// directly; this section only adds the DOM plumbing to give Atom 3 its
// own independent mask-grid instance per question).
function updateAtom3MaskGrid(qid, ex, maskBitsStr) {
    const grid = document.getElementById('atom3MaskGrid-' + qid);
    if (!grid) return;
    const bitsArr = maskBitsStr.split('').map(Number);
    grid.dataset.maskbits = maskBitsStr;
    grid.innerHTML = renderAtom2BitGridInner(qid, bitsArr, ex.networkBits);
}

function attachAtom3MaskHandlers(qid, ex) {
    const grid = document.getElementById('atom3MaskGrid-' + qid);
    if (!grid) return;

    const handleActivate = (cell) => {
        if (exerciseData[qid]?.locked) return;
        if (!cell || cell.classList.contains('locked')) return;
        const idx = parseInt(cell.dataset.idx, 10);
        const current = grid.dataset.maskbits || initAtom2MaskBits(ex.networkBits);
        const chars = current.split('');
        chars[idx] = chars[idx] === '1' ? '0' : '1';
        updateAtom3MaskGrid(qid, ex, chars.join(''));
        saveAtom3Progress(qid);
    };

    grid.addEventListener('click', (e) => {
        handleActivate(e.target.closest('.bit-cell'));
    });
    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cell = e.target.closest && e.target.closest('.bit-cell');
        if (!cell) return;
        e.preventDefault();
        handleActivate(cell);
    });
}

// Re-renders one subnet row's "Subnet Index" pattern and its live
// composed network address for a new bit array, keeping the row's own
// dataset in sync (the single source of truth for "what's currently
// clicked" for that row — read back out at verify/save/collect time).
// Reads the target subnet number back from the group's own data-subnet
// attribute (set once in renderAtom3SubnetIndexViz) so the caption keeps
// stating the correct target on every click, without needing it re-passed
// in from the handler.
function updateAtom3Row(qid, rowPos, bitsArr) {
    const rowEl = document.getElementById('atom3Row-' + qid + '-' + rowPos);
    if (!rowEl) return;
    const subnetNum = rowEl.dataset.subnet;
    rowEl.dataset.bits = bitsArr.join('');
    rowEl.innerHTML = renderAtom3SubnetIndexInner(qid, rowPos, bitsArr, subnetNum);

    const ex = exerciseData[qid];
    const networkEl = document.getElementById('atom3Network-' + qid + '-' + rowPos);
    if (networkEl && ex) networkEl.innerHTML = atom3BuildFullAddressViz(ex, bitsArr);
    if (ex && ex.type === 'atom4') {
        const getHostBits = boundary => Array.from(document.querySelectorAll('.atom4-host-bit[data-qid="' + qid + '"][data-boundary="' + boundary + '"][data-row="' + rowPos + '"]'))
            .sort((a, b) => parseInt(a.dataset.index, 10) - parseInt(b.dataset.index, 10))
            .map(cell => cell.textContent).join('');
        const hostFallback = atom4DefaultBits(ex);
        const boundaries = document.getElementById('atom4RowBoundaries-' + qid + '-' + rowPos);
        if (boundaries) {
            boundaries.innerHTML = buildAtom4BoundaryHtml(qid, ex, 'network', getHostBits('network') || hostFallback, bitsArr.join(''), rowPos) +
                buildAtom4BoundaryHtml(qid, ex, 'broadcast', getHostBits('broadcast') || hostFallback, bitsArr.join(''), rowPos);
        }
    }
}

// Delegated click/keyboard handling for one question: the 32-bit grid
// (boundary-setting, exactly like Atom 1) PLUS every subnet row's bit
// strip below it (per-bit toggle, exactly like Atom 2's mask grid).
// Attached once to each persistent container — grid clicks regenerate the
// row list via updateAtom3Grid; row clicks only flip that one bit.
function attachAtom3Handlers(qid, ex) {
    const grid = document.getElementById('atom3BitGrid-' + qid);
    if (grid) {
        const handleGridActivate = (cell) => {
            if (exerciseData[qid]?.locked) return;
            if (!cell || cell.classList.contains('locked')) return;
            const idx = parseInt(cell.dataset.idx, 10);
            let newBorrowed = idx - ex.networkBits + 1;
            newBorrowed = Math.max(0, Math.min(newBorrowed, ex.maxBorrow));
            updateAtom3Grid(qid, ex, newBorrowed);
            saveAtom3Progress(qid);
        };

        grid.addEventListener('click', (e) => {
            handleGridActivate(e.target.closest('.bit-cell'));
        });
        grid.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const cell = e.target.closest && e.target.closest('.bit-cell');
            if (!cell) return;
            e.preventDefault();
            handleGridActivate(cell);
        });
    }

    const listWrap = document.getElementById('atom3SubnetList-' + qid);
    if (listWrap) {
        const handleRowActivate = (cell) => {
            if (exerciseData[qid]?.locked) return;
            const row = cell.closest('.atom3-bit-row');
            if (!row) return;
            const rowPos = row.dataset.row;
            const idx = parseInt(cell.dataset.idx, 10);
            const bits = (row.dataset.bits || '').split('').map(Number);
            bits[idx] = bits[idx] === 1 ? 0 : 1;
            updateAtom3Row(qid, rowPos, bits);
            saveAtom3Progress(qid);
        };

        listWrap.addEventListener('click', (e) => {
            const cell = e.target.closest('.idx-bit');
            if (cell) handleRowActivate(cell);
        });
        listWrap.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const cell = e.target.closest && e.target.closest('.idx-bit');
            if (!cell) return;
            e.preventDefault();
            handleRowActivate(cell);
        });
    }
}

// Reads every currently-shown row's bit string, in display order, plus
// the grid's own boundary — the full in-progress answer for one Atom 3
// question. Serialized as "borrowedBits::bits1,bits2,..." so both parts
// persist and restore together (see restoreAtom3Answer/gradeAtom3Answer).
function collectAtom3Answer(qid) {
    const ex = exerciseData[qid];
    const grid = document.getElementById('atom3BitGrid-' + qid);
    const borrowedBits = grid ? (grid.dataset.borrowed || '0') : '0';
    const maskGrid = document.getElementById('atom3MaskGrid-' + qid);
    const maskBits = maskGrid ? (maskGrid.dataset.maskbits || (ex ? initAtom2MaskBits(ex.networkBits) : '')) : (ex ? initAtom2MaskBits(ex.networkBits) : '');
    const rows = Array.from(document.querySelectorAll('.atom3-bit-row[data-qid="' + qid + '"]'))
        .sort((a, b) => parseInt(a.dataset.row, 10) - parseInt(b.dataset.row, 10));
    const rowBits = rows.map(r => r.dataset.bits || '');
    return borrowedBits + '::' + maskBits + '::' + rowBits.join(',');
}

// Grades every answerable item in one Atom 3 question and returns a
// { score, allCorrect } pair — partial credit, not a single all-or-
// nothing boolean — mirroring the octet-scored IP conversion questions
// elsewhere in this file (see gradeConversionScore). Answerable items:
//   1. The boundary grid's final borrowed-bit count (1 point).
//   2. The assembled subnet mask, checked against the TARGET CIDR's
//      standard mask regardless of what boundary was chosen (1 point) —
//      the mask-assembly grid always starts from the same classful-bits-
//      locked state independent of the boundary step above it, so it's
//      graded independently too.
//   3. Each subnet row shown for the TARGET borrowed-bit count (1 point
//      each). Rows can only be individually graded when the student's
//      chosen boundary matches the target: a different boundary shows an
//      entirely different set of subnet rows (different indices,
//      different bit widths), so there's no meaningful row-by-row
//      mapping back to the target rows in that case — those points stay
//      unearned until the boundary itself is fixed.
// Uses atom3SubnetIndicesForBorrowed so the expected subnet numbers can
// never drift from what the renderer actually displayed.
function gradeAtom3Answer(ex, userAnswerStr) {
    const parts = (userAnswerStr || '').split('::');
    const borrowedBits = parseInt(parts[0], 10);
    const boundaryCorrect = !isNaN(borrowedBits) && borrowedBits === ex.correctBits;

    const maskBitsStr = parts[1] !== undefined ? parts[1] : '';
    const expectedMask = initAtom2MaskBits(ex.networkBits + ex.correctBits);
    const maskCorrect = maskBitsStr === expectedMask;

    const targetIndices = atom3SubnetIndicesForBorrowed(ex.correctBits);
    let rowsCorrect = 0;
    // Per-row correctness, position-aligned with targetIndices — this is
    // what drives per-row visual feedback (see applyAtom3ItemFeedback). If
    // the boundary itself is wrong, the rows currently on screen belong to
    // a different boundary and aren't comparable to the target rows, so
    // every row is marked incorrect (none earned a point either).
    const rowCorrectArr = new Array(targetIndices.length).fill(false);
    if (boundaryCorrect) {
        const rowBitsStrs = (parts[2] !== undefined ? parts[2] : '').split(',');
        for (let i = 0; i < targetIndices.length; i++) {
            const expected = ex.correctBits > 0 ? targetIndices[i].toString(2).padStart(ex.correctBits, '0') : '';
            const isRowCorrect = (rowBitsStrs[i] || '') === expected;
            rowCorrectArr[i] = isRowCorrect;
            if (isRowCorrect) rowsCorrect++;
        }
    }

    const maxScore = 2 + targetIndices.length;
    const score = (boundaryCorrect ? 1 : 0) + (maskCorrect ? 1 : 0) + rowsCorrect;
    return { score, allCorrect: score === maxScore, boundaryCorrect, maskCorrect, rowCorrectArr };
}

// Persists the in-progress boundary + subnet-row bits for one Atom 3
// question (analogous to saveAtom1Progress/saveAtom2Progress).
function saveAtom3Progress(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;
    ex.userAnswer = collectAtom3Answer(qid);
    if (appSettings.mode === 'exam') saveExamSession();
}

// Guards against attaching the delegated verify/reset click listener more
// than once, same rationale as atom1ActionsDelegated/atom2ActionsDelegated.
let atom3ActionsDelegated = false;
let atom4ActionsDelegated = false;

// --- ATOM 3: REQUIREMENT CARD (how the question is COMMUNICATED) ---
// Same rationale as Atom 1/2's own requirement cards: the old plain prompt
// sentence (via ex.promptHtml) and the static Panel 1 octet-box row
// underneath it both restated the exact same two facts — the given
// classful address and the target classless CIDR — one right after the
// other. The bit grid's own live borrow badge and octet totals already
// make the classful network portion and current boundary obvious, so
// nothing is lost by stating the given address and the CIDR to reach once,
// here, instead of twice. Unlike Atom 1's card (a single subnet/host count
// target), Atom 3's target is a CIDR to reach by clicking, so its middle
// row states that instead of a requirement count.
// --- ATOM 3: PER-SUBTASK TASK CARDS (how the question is COMMUNICATED) ---
// Atom 3 is not a single-task question like Atom 1 (borrow bits) or Atom 2
// (assemble a mask) — it chains THREE separately-gradable subtasks: set
// the subnet boundary (Atom 1's own task), assemble the matching mask
// (Atom 2's own task), then build each subnet's binary ID. Each subtask
// gets its own card immediately above the UI it governs, and — so a
// student scrolling back to any one of them never has to scroll back up
// to re-find the given network or the CIDR they're working toward — every
// card repeats the exact same three-part structure: Given network, the
// classless network to reach, and what to do for THIS step. Only the
// task-specific header (a highly visible "TASK N OF 3" badge + title) and
// the final row's icon/text change between the three calls below.
function buildAtom3TaskCardHtml(ex, taskNum, title, iconClass, actionText) {
    const ipStr = ex.octets.join('.');
    // Task 1 opens the question (no preceding grid to separate it from),
    // so it skips the extra top margin/spacing the later two cards get —
    // see .atom3-task-card-followup in styles.css.
    const cardClass = 'atom1-req-card atom3-task-card' + (taskNum > 1 ? ' atom3-task-card-followup' : '');
    return (
        '<div class="' + cardClass + '">' +
            '<div class="atom3-task-card-header">' +
                '<span class="atom3-task-badge">Task ' + taskNum + ' of 3</span>' +
                '<h3 class="atom3-task-title">' + title + '</h3>' +
            '</div>' +
            '<div class="atom3-task-card-rows">' +
                '<div class="atom1-req-row">' +
                    '<div class="atom1-req-icon atom1-req-icon-network"><i class="fa-solid fa-diagram-project" aria-hidden="true"></i></div>' +
                    '<div class="atom1-req-body">' +
                        '<div class="atom1-req-eyebrow">Given network</div>' +
                        '<div class="atom1-req-main">' +
                            '<span class="atom1-req-badge">Class ' + ex.classLabel + '</span>' +
                            '<span class="atom1-req-value">' + ipStr + '<span class="atom1-req-cidr">/' + ex.networkBits + '</span></span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="atom1-req-row">' +
                    '<div class="atom1-req-icon atom1-req-icon-requirement"><i class="fa-solid fa-bullseye" aria-hidden="true"></i></div>' +
                    '<div class="atom1-req-body">' +
                        '<div class="atom1-req-eyebrow">Reach this classless network</div>' +
                        '<div class="atom1-req-target">' +
                            '<span class="atom1-req-target-num">/' + ex.targetCidr + '</span>' +
                            '<span class="atom1-req-target-label">target CIDR</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="atom1-req-row">' +
                    '<div class="atom1-req-icon atom1-req-icon-action"><i class="fa-solid ' + iconClass + '" aria-hidden="true"></i></div>' +
                    '<div class="atom1-req-body">' +
                        '<div class="atom1-req-eyebrow">What to do</div>' +
                        '<div class="atom1-req-action-text">' + actionText + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>'
    );
}

function buildAtom3PanelHtml(qid, ex, index) {
    const inputBits = atom1OctetsToBits(ex.octets);

    const task1Html = buildAtom3TaskCardHtml(
        ex,
        1,
        'Set the Subnet Boundary',
        'hand-pointer',
        'Click bits below to borrow exactly enough network bits to reach /' + ex.targetCidr + '.'
    );

    const gridHtml =
        '<div class="atom1-bitgrid-wrap" id="atom3BoundaryWrap-' + qid + '">' +
            '<div class="badge badge-borrow atom1-borrow-badge" id="atom3BorrowBadge-' + qid + '">' +
                '<span>0 bits borrowed &rarr; /' + ex.networkBits + '</span>' +
            '</div>' +
            '<div class="bit-grid atom1-bitgrid" id="atom3BitGrid-' + qid + '" data-qid="' + qid + '" data-network-bits="' + ex.networkBits + '" data-max-borrow="' + ex.maxBorrow + '" data-borrowed="0">' +
                renderAtom1BitGridInner(qid, inputBits, ex.networkBits, 0) +
            '</div>' +
            '<div class="legend secondary-copy">' +
                '<span><i class="swatch swatch-locked"></i> Locked network bit</span>' +
                '<span><i class="swatch swatch-borrowed"></i> Borrowed subnet bit</span>' +
                '<span><i class="swatch swatch-host"></i> Host bit</span>' +
            '</div>' +
        '</div>';

    // Mask assembly (reuses Atom 2's toggle-grid engine verbatim —
    // renderAtom2BitGridInner/initAtom2MaskBits — via its own DOM ids so
    // it can't collide with the real Atom 2 view's grids). Classful
    // network bits start locked to 1; everything else starts at 0 and
    // toggles independently on click, same as Atom 2. Its own task card
    // (task2Html, below) now carries the instructions this wrap used to
    // open with via .atom3-mask-hint, so that paragraph is dropped here.
    const maskInitBits = initAtom2MaskBits(ex.networkBits).split('').map(Number);
    const task2Html = buildAtom3TaskCardHtml(
        ex,
        2,
        'Assemble the Subnet Mask',
        'sliders',
        'Now assemble the subnet mask that matches the boundary you set above — click a bit to toggle it on/off. Classful network bits are locked to 1.'
    );
    const maskGridHtml =
        '<div class="atom1-bitgrid-wrap atom3-mask-wrap" id="atom3MaskWrap-' + qid + '">' +
            '<div class="bit-grid atom1-bitgrid" id="atom3MaskGrid-' + qid + '" data-qid="' + qid + '" data-network-bits="' + ex.networkBits + '" data-maskbits="' + initAtom2MaskBits(ex.networkBits) + '">' +
                renderAtom2BitGridInner(qid, maskInitBits, ex.networkBits) +
            '</div>' +
            '<div class="legend secondary-copy">' +
                '<span><i class="swatch swatch-locked"></i> Locked network bit</span>' +
                '<span><i class="swatch swatch-borrowed"></i> Mask bit ON (1)</span>' +
                '<span><i class="swatch swatch-host"></i> Mask bit OFF (0)</span>' +
            '</div>' +
        '</div>';

    // Task 3's card carries the exact phrase "Build each subnet's binary ID
    // below" verbatim — Atom 4 (see buildAtom4PanelHtml) string-replaces
    // that same phrase in its own copy of this panel to append its own
    // Network/Broadcast instructions, so the wording here must stay intact
    // for that hook to keep matching.
    const task3Html = buildAtom3TaskCardHtml(
        ex,
        3,
        'Build Each Subnet ID',
        'list-ol',
        'Build each subnet\'s binary ID below — its full network address updates live, and the subnet list itself updates as you move the boundary above.'
    );
    const liveListHtml =
        '<div class="atom3-live-wrap">' +
            '<div id="atom3SubnetList-' + qid + '">' + buildAtom3SubnetListHtml(qid, 0, ex) + '</div>' +
        '</div>';

    return (
        '<section class="panel atom1-q-panel" id="atom3QPanel-' + qid + '" data-qid="' + qid + '">' +
            '<div class="panel-head">' +
                '<span class="panel-index">Q' + index + '</span>' +
                '<h2>Subnet ID Mapping</h2>' +
                '<span class="badge atom1-score-badge" id="atom3ScoreBadge-' + qid + '">0/' + ex.answers.length + '</span>' +
            '</div>' +
            task1Html +
            gridHtml +
            task2Html +
            maskGridHtml +
            task3Html +
            liveListHtml +
            '<div class="atom1-actions">' +
                '<button class="primary-btn atom3-verify-btn" data-qid="' + qid + '">Verify Answer</button>' +
                '<div class="atom1-feedback" id="atom3Feedback-' + qid + '" role="status" aria-live="polite"></div>' +
            '</div>' +
        '</section>'
    );
}

// Builds the full Atom 3 page from scratch (called once per login) and
// wires up each question's bit-row interaction plus a single delegated
// click listener for every Verify/Reset button on the page — same
// structure as renderAtom1View/renderAtom2View.
function renderAtom3View(atom3List) {
    const container = document.getElementById('atom3QuestionsContainer');
    if (!container) return;

    container.innerHTML = atom3List
        .map((item, i) => buildAtom3PanelHtml(item.name, exerciseData[item.name], i + 1))
        .join('');

    atom3List.forEach(item => {
        attachAtom3Handlers(item.name, exerciseData[item.name]);
        attachAtom3MaskHandlers(item.name, exerciseData[item.name]);
    });

    if (!atom3ActionsDelegated) {
        atom3ActionsDelegated = true;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.atom3-verify-btn');
            if (!btn) return;
            const qid = btn.dataset.qid;
            const ex = exerciseData[qid];
            if (!ex) return;
            if (ex.locked) {
                resetAtom3Question(qid);
            } else {
                verifyAtom3Question(qid);
            }
        });
    }

    attachAtomPaginationHandlers();
    initAtomPagination('atom3');
}

// Sets the Verify/Reset/Locked button label + disabled state for one
// question — same rules as setAtom1ButtonState/setAtom2ButtonState.
function setAtom3ButtonState(qid) {
    const ex = exerciseData[qid];
    const btn = document.querySelector('.atom3-verify-btn[data-qid="' + qid + '"]');
    if (!btn || !ex) return;
    if (ex.locked) {
        if (appSettings.mode === 'practice') {
            btn.textContent = 'Reset';
            btn.disabled = false;
        } else {
            btn.textContent = 'Locked';
            btn.disabled = true;
        }
    } else {
        btn.textContent = 'Verify Answer';
        btn.disabled = false;
    }
}

// Renders this question's per-question feedback. Reuses
// buildFeedbackForExercise/renderFeedback exactly as Atom 1/2 do — with
// answers.length === 1, its all-or-nothing "Not quite" branch already
// produces the right wording with no changes needed there.
function updateAtom3QuestionFeedback(qid, ex) {
    const el = document.getElementById('atom3Feedback-' + qid);
    if (!el) return;
    if (!ex || !ex.locked) {
        el.textContent = '';
        el.className = 'atom1-feedback';
        return;
    }
    const feedback = buildFeedbackForExercise(ex);
    renderFeedback(el, feedback);
    el.className = 'atom1-feedback ' + feedback.cls;
}

// Updates one question's score badge (max always 1/1 for Atom 3) — same
// coloring convention as updateAtom1ScoreBadge/updateAtom2ScoreBadge.
function updateAtom3ScoreBadge(qid, ex) {
    const badge = document.getElementById('atom3ScoreBadge-' + qid);
    if (!badge || !ex) return;
    badge.textContent = (ex.score || 0) + '/' + ex.answers.length;
    badge.classList.remove('completed-score', 'partial-score');
    if (ex.locked) {
        if (ex.score === ex.answers.length) badge.classList.add('completed-score');
        else if (ex.score > 0) badge.classList.add('partial-score');
    }
}

// Applies correct/incorrect styling to each individually-gradable piece of
// an Atom 3 question — the boundary grid, the mask grid, and each subnet
// row — using the exact same breakdown gradeAtom3Answer uses to compute
// the score, so the visual feedback can never drift from the numeric one.
// Called from applyAtom3LockedUI, which covers both the normal verify path
// and exam-session restore (via syncAtom3ViewDOM -> applyAtom3LockedUI).
function applyAtom3ItemFeedback(qid, ex) {
    const { boundaryCorrect, maskCorrect, rowCorrectArr } = gradeAtom3Answer(ex, ex.userAnswer);

    const boundaryWrap = document.getElementById('atom3BoundaryWrap-' + qid);
    if (boundaryWrap) {
        boundaryWrap.classList.remove('atom3-item-correct', 'atom3-item-incorrect');
        boundaryWrap.classList.add(boundaryCorrect ? 'atom3-item-correct' : 'atom3-item-incorrect');
    }

    const maskWrap = document.getElementById('atom3MaskWrap-' + qid);
    if (maskWrap) {
        maskWrap.classList.remove('atom3-item-correct', 'atom3-item-incorrect');
        maskWrap.classList.add(maskCorrect ? 'atom3-item-correct' : 'atom3-item-incorrect');
    }

    document.querySelectorAll('.subnet-row[data-qid="' + qid + '"]').forEach(row => {
        const pos = parseInt(row.dataset.row, 10);
        const isCorrect = !!rowCorrectArr[pos];
        row.classList.remove('atom3-item-correct', 'atom3-item-incorrect');
        row.classList.add(isCorrect ? 'atom3-item-correct' : 'atom3-item-incorrect');
    });
}

// Applies every visual consequence of this question being locked — same
// shape as applyAtom1LockedUI/applyAtom2LockedUI: the panel's
// correct/incorrect edge color, the bit grid's AND every subnet row's
// click-lock, per-item correct/incorrect feedback, the feedback message,
// the score badge, and the action button label.
function applyAtom3LockedUI(qid, ex) {
    const panel = document.getElementById('atom3QPanel-' + qid);
    const grid = document.getElementById('atom3BitGrid-' + qid);
    const maskGrid = document.getElementById('atom3MaskGrid-' + qid);
    const isCorrect = (ex.score || 0) === ex.answers.length;

    if (panel) {
        panel.classList.remove('correct', 'incorrect');
        panel.classList.add(isCorrect ? 'correct' : 'incorrect');
    }
    if (grid) grid.classList.add('atom1-locked');
    if (maskGrid) maskGrid.classList.add('atom1-locked');
    document.querySelectorAll('.atom3-bit-row[data-qid="' + qid + '"]').forEach(row => {
        row.classList.add('atom3-locked');
    });

    applyAtom3ItemFeedback(qid, ex);

    updateAtom3QuestionFeedback(qid, ex);
    updateAtom3ScoreBadge(qid, ex);
    setAtom3ButtonState(qid);
}

// Grades and locks one Atom 3 question — per answerable item (boundary,
// mask, each subnet row), not all-or-nothing (see gradeAtom3Answer).
function verifyAtom3Question(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;

    const userAnswer = collectAtom3Answer(qid);
    ex.userAnswer = userAnswer;

    const { score, allCorrect } = gradeAtom3Answer(ex, userAnswer);
    ex.score = score;
    ex.isPartial = score > 0 && !allCorrect;
    ex.locked = true;

    applyAtom3LockedUI(qid, ex);
    updateAtom3NavScore();
    updateSummaryPanel();

    if (allCorrect) triggerConfetti();

    if (appSettings.mode === 'exam') {
        saveExamSession();
        if (checkIfAllAnswered()) {
            stopTimer();
            setTimeout(() => {
                showScoreSummaryModal('Congratulations! All exercises completed before time ran out!', 'success');
            }, 500);
        }
    }
}

// Resets one Atom 3 question — practice mode only, mirroring
// resetAtom1Question's/resetAtom2Question's exam-mode guard. Resetting the
// grid to 0 borrowed bits also rebuilds the subnet row list from scratch
// (see updateAtom3Grid), so nothing further needs clearing here.
function resetAtom3Question(qid) {
    if (appSettings.mode === 'exam') {
        showAlertModal('Reset Not Allowed', 'Reset is not allowed in Exam Mode.');
        return;
    }
    const ex = exerciseData[qid];
    if (!ex) return;

    ex.userAnswer = '';
    ex.score = 0;
    ex.isPartial = false;
    ex.locked = false;

    updateAtom3Grid(qid, ex, 0);
    updateAtom3MaskGrid(qid, ex, initAtom2MaskBits(ex.networkBits));

    const panel = document.getElementById('atom3QPanel-' + qid);
    if (panel) panel.classList.remove('correct', 'incorrect');
    const grid = document.getElementById('atom3BitGrid-' + qid);
    if (grid) grid.classList.remove('atom1-locked');
    const maskGrid = document.getElementById('atom3MaskGrid-' + qid);
    if (maskGrid) maskGrid.classList.remove('atom1-locked');

    // Rows/mask-grid contents are already fresh (rebuilt above via
    // updateAtom3Grid/updateAtom3MaskGrid), but the outer wrapper elements
    // persist across resets and carry their own item-feedback classes —
    // those need clearing explicitly so a fresh attempt doesn't start out
    // still colored from the previous one.
    const boundaryWrap = document.getElementById('atom3BoundaryWrap-' + qid);
    if (boundaryWrap) boundaryWrap.classList.remove('atom3-item-correct', 'atom3-item-incorrect');
    const maskWrap = document.getElementById('atom3MaskWrap-' + qid);
    if (maskWrap) maskWrap.classList.remove('atom3-item-correct', 'atom3-item-incorrect');

    updateAtom3QuestionFeedback(qid, null);
    updateAtom3ScoreBadge(qid, ex);
    setAtom3ButtonState(qid);
    updateAtom3NavScore();
    updateSummaryPanel();
}

// Aggregates every atom3-q* exercise into a single X/N readout on the
// sidebar's "Atom 3" nav entry, same as updateAtom1NavScore/updateAtom2NavScore.
function updateAtom3NavScore() {
    const scoreEl = document.getElementById('score-atom3');
    if (!scoreEl) return;
    let got = 0;
    let total = 0;
    for (const file in exerciseData) {
        if (file.indexOf('atom3-q') === 0) {
            const ex = exerciseData[file];
            got += Number(ex.score || 0);
            total += ex.answers.length;
        }
    }
    scoreEl.textContent = got + '/' + total;
    scoreEl.classList.remove('completed-score', 'partial-score');
    if (total > 0 && got === total) {
        scoreEl.classList.add('completed-score');
    } else if (got > 0) {
        scoreEl.classList.add('partial-score');
    }
}

// Re-applies every Atom 3 question's current exerciseData state — the
// grid's boundary, each subnet row's clicked-in bits, locked styling,
// feedback, badge — onto the already-rendered DOM. Called once per login,
// after exam-session restore, same rationale as syncAtom1ViewDOM/
// syncAtom2ViewDOM. The grid rebuild (updateAtom3Grid) always regenerates
// a fresh, zeroed row list for the restored boundary first; any saved
// per-row bits are then layered back on top, position by position — only
// applied when they still match that boundary's row width, since a saved
// answer from a different boundary no longer corresponds to anything on
// screen.
function syncAtom3ViewDOM() {
    for (const file in exerciseData) {
        if (file.indexOf('atom3-q') !== 0) continue;
        const ex = exerciseData[file];
        if (!ex) continue;

        const parts = (typeof ex.userAnswer === 'string' && ex.userAnswer.length) ? ex.userAnswer.split('::') : [];
        const borrowed = parseInt(parts[0], 10);
        const safeBorrowed = isNaN(borrowed) ? 0 : Math.max(0, Math.min(borrowed, ex.maxBorrow));
        updateAtom3Grid(file, ex, safeBorrowed);

        const savedMaskStr = parts.length > 1 ? parts[1] : '';
        updateAtom3MaskGrid(file, ex, (savedMaskStr && savedMaskStr.length === 32) ? savedMaskStr : initAtom2MaskBits(ex.networkBits));

        const savedRowsStr = parts.length > 2 ? parts[2] : '';
        if (savedRowsStr) {
            savedRowsStr.split(',').forEach((bitsStr, pos) => {
                if (bitsStr && bitsStr.length === safeBorrowed) {
                    updateAtom3Row(file, pos, bitsStr.split('').map(Number));
                }
            });
        }

        if (ex.locked) {
            applyAtom3LockedUI(file, ex);
        } else {
            setAtom3ButtonState(file);
        }
    }
    updateAtom3NavScore();
}

function atom4DefaultBits(ex) {
    return '?'.repeat(ex.hostBits);
}

function atom4BitsFromAnswer(value, ex) {
    return typeof value === 'string' && value.length === ex.hostBits && /^[?01]+$/.test(value)
        ? value
        : atom4DefaultBits(ex);
}

function atom4PrefixBits(ex, subnetBits) {
    return atom1OctetsToBits(ex.octets).slice(0, ex.networkBits).join('') + (subnetBits || '');
}

function buildAtom4BoundaryHtml(qid, ex, boundary, hostBits, subnetBits, rowPos) {
    const prefix = atom4PrefixBits(ex, subnetBits);
    const hostCount = Math.max(0, 32 - prefix.length);
    const normalizedHostBits = atom4BitsFromAnswer(hostBits, { hostBits: hostCount });
    let addressHtml = '<div class="addr-row">';
    for (let octet = 0; octet < 4; octet++) {
        const start = octet * 8;
        let bitsHtml = '';
        let weightsHtml = '';
        const octetValues = [];
        for (let bit = 0; bit < 8; bit++) {
            const globalIndex = start + bit;
            const fixed = globalIndex < prefix.length;
            const kind = fixed
                ? (globalIndex < ex.networkBits ? 'locked' : 'borrowed')
                : 'host';
            const value = fixed ? prefix[globalIndex] : normalizedHostBits[globalIndex - prefix.length];
            octetValues.push(value);
            weightsHtml += '<span class="addr-weight ' + (value === '1' ? 'lit-' + kind : '') + '">' + OCTET_BIT_PLACE_VALUES[bit] + '</span>';
            bitsHtml += '<div class="addr-bit ' + kind + (fixed ? '' : ' atom4-host-bit') + '"' +
                (fixed ? ' aria-hidden="true"' : ' role="button" tabindex="0" data-qid="' + qid + '" data-boundary="' + boundary + '" data-row="' + (rowPos === undefined ? '' : rowPos) + '" data-index="' + (globalIndex - prefix.length) + '" aria-label="' + boundary + ' host bit ' + (globalIndex - prefix.length + 1) + ', currently ' + value + '"') + '>' + value + '</div>';
        }
        const octetTotal = octetValues.includes('?')
            ? '?'
            : atom1BitsToOctet(octetValues.map(Number));
        addressHtml += '<div class="addr-octet">' +
            '<div class="addr-total-box">' + octetTotal + (octet < 3 ? '<span class="addr-total-dot">.</span>' : '') + '</div>' +
            '<div class="addr-weight-row">' + weightsHtml + '</div>' +
            '<div class="addr-bits">' + bitsHtml + '</div>' +
            '<div class="addr-octet-label">Octet ' + (octet + 1) + '</div>' +
        '</div>';
    }
    addressHtml += '</div>';
    return '<div class="atom4-boundary-row" data-qid="' + qid + '" data-boundary="' + boundary + '" data-row="' + (rowPos === undefined ? '' : rowPos) + '">' +
        '<div class="atom4-boundary-label"><strong>' + (boundary === 'network' ? 'Network ID' : 'Broadcast Address') + '</strong><span>' + (boundary === 'network' ? 'Host bits = 0' : 'Host bits = 1') + '</span></div>' +
        addressHtml +
    '</div>';
}

function collectAtom4Answer(qid) {
    const atom3Answer = collectAtom3Answer(qid);
    const rowPositions = Array.from(document.querySelectorAll('.atom4-boundary-row[data-qid="' + qid + '"]'))
        .map(row => parseInt(row.dataset.row, 10))
        .filter((row, index, rows) => !isNaN(row) && rows.indexOf(row) === index)
        .sort((a, b) => a - b);
    const getBits = (boundary, rowPos) => Array.from(document.querySelectorAll('.atom4-host-bit[data-qid="' + qid + '"][data-boundary="' + boundary + '"][data-row="' + rowPos + '"]'))
        .sort((a, b) => parseInt(a.dataset.index, 10) - parseInt(b.dataset.index, 10))
        .map(cell => cell.textContent).join('');
    return atom3Answer + '::' + rowPositions.map(row => getBits('network', row)).join(',') + '::' + rowPositions.map(row => getBits('broadcast', row)).join(',');
}

function gradeAtom4Answer(ex, answer) {
    const parts = (answer || '').split('::');
    const atom3Result = gradeAtom3Answer(ex, parts.slice(0, 3).join('::'));
    const networkRows = (parts[3] || '').split(',');
    const broadcastRows = (parts[4] || '').split(',');
    const expectedLength = ex.hostBits;
    const targetRows = atom3SubnetIndicesForBorrowed(ex.correctBits).length;
    // Boundary addresses are meaningful only for the correct subnet rows.
    // Reuse Atom 3's dependency model: a wrong borrowed boundary means the
    // displayed rows are not comparable, and a wrong subnet ID means its
    // Network/Broadcast address is not the target address for that row.
    const networkCorrectArr = new Array(targetRows).fill(false);
    const broadcastCorrectArr = new Array(targetRows).fill(false);
    for (let i = 0; i < targetRows; i++) {
        const rowEligible = atom3Result.boundaryCorrect && atom3Result.rowCorrectArr[i];
        networkCorrectArr[i] = rowEligible && networkRows[i]?.length === expectedLength && networkRows[i] === '0'.repeat(expectedLength);
        broadcastCorrectArr[i] = rowEligible && broadcastRows[i]?.length === expectedLength && broadcastRows[i] === '1'.repeat(expectedLength);
    }
    const networkCorrect = networkCorrectArr.length === targetRows && networkCorrectArr.every(Boolean);
    const broadcastCorrect = broadcastCorrectArr.length === targetRows && broadcastCorrectArr.every(Boolean);
    const networkScore = networkCorrectArr.filter(Boolean).length;
    const broadcastScore = broadcastCorrectArr.filter(Boolean).length;
    const score = atom3Result.score + networkScore + broadcastScore;
    return { score, allCorrect: score === ex.answers.length, atom3Result, networkCorrect, broadcastCorrect, networkCorrectArr, broadcastCorrectArr };
}

function buildAtom4PanelHtml(qid, ex, index) {
    const atom3Panel = buildAtom3PanelHtml(qid, ex, index)
        .replace('Subnet ID Mapping', 'Subnet ID Mapping & Boundaries')
        .replace('atom3-verify-btn', 'atom4-verify-btn');
    return atom3Panel.replace('Build each subnet\'s binary ID below', 'Build each subnet\'s binary ID below, then assemble its Network and Broadcast addresses');
}

function renderAtom4View(atom4List) {
    const container = document.getElementById('atom4QuestionsContainer');
    if (!container) return;
    container.innerHTML = atom4List.map((item, i) => buildAtom4PanelHtml(item.name, exerciseData[item.name], i + 1)).join('');
    atom4List.forEach(item => {
        attachAtom3Handlers(item.name, exerciseData[item.name]);
        attachAtom3MaskHandlers(item.name, exerciseData[item.name]);
    });
    if (!atom4ActionsDelegated) {
        atom4ActionsDelegated = true;
        container.addEventListener('click', event => {
            const cell = event.target.closest('.atom4-host-bit');
            if (cell) {
                cycleAtom4Bit(cell.dataset.qid, cell.dataset.boundary, parseInt(cell.dataset.row, 10), parseInt(cell.dataset.index, 10));
                return;
            }
            const button = event.target.closest('.atom4-verify-btn');
            if (!button) return;
            const qid = button.dataset.qid;
            if (exerciseData[qid]?.locked) resetAtom4Question(qid);
            else verifyAtom4Question(qid);
        });
        container.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const cell = event.target.closest('.atom4-host-bit');
            if (!cell) return;
            event.preventDefault();
            cycleAtom4Bit(cell.dataset.qid, cell.dataset.boundary, parseInt(cell.dataset.row, 10), parseInt(cell.dataset.index, 10));
        });
    }

    attachAtomPaginationHandlers();
    initAtomPagination('atom4');
}

function refreshAtom4Boundary(qid, boundary, rowPos) {
    const ex = exerciseData[qid];
    if (!ex) return;
    const hostBits = Array.from(document.querySelectorAll('.atom4-host-bit[data-qid="' + qid + '"][data-boundary="' + boundary + '"][data-row="' + rowPos + '"]'))
        .sort((a, b) => parseInt(a.dataset.index, 10) - parseInt(b.dataset.index, 10))
        .map(cell => cell.textContent).join('');
    const subnetRow = document.getElementById('atom3Row-' + qid + '-' + rowPos);
    const subnetBits = subnetRow ? (subnetRow.dataset.bits || '') : '';
    const boundaryRow = document.querySelector('.atom4-boundary-row[data-qid="' + qid + '"][data-boundary="' + boundary + '"][data-row="' + rowPos + '"]');
    if (boundaryRow) boundaryRow.outerHTML = buildAtom4BoundaryHtml(qid, ex, boundary, hostBits || atom4DefaultBits(ex), subnetBits, rowPos);
}

function cycleAtom4Bit(qid, boundary, rowPos, index) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;
    const cells = Array.from(document.querySelectorAll('.atom4-host-bit[data-qid="' + qid + '"][data-boundary="' + boundary + '"][data-row="' + rowPos + '"]'))
        .sort((a, b) => parseInt(a.dataset.index, 10) - parseInt(b.dataset.index, 10));
    const cell = cells[index];
    if (!cell) return;
    cell.textContent = cell.textContent === '?' ? '0' : (cell.textContent === '0' ? '1' : '?');
    cell.setAttribute('aria-label', boundary + ' host bit ' + (index + 1) + ', currently ' + cell.textContent);
    refreshAtom4Boundary(qid, boundary, rowPos);
    saveAtom4Progress(qid);
}

function saveAtom4Progress(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;
    ex.userAnswer = collectAtom4Answer(qid);
    if (appSettings.mode === 'exam') saveExamSession();
}

function updateAtom4ButtonState(qid) {
    const ex = exerciseData[qid];
    const button = document.querySelector('.atom4-verify-btn[data-qid="' + qid + '"]');
    if (!button || !ex) return;
    button.textContent = ex.locked ? (appSettings.mode === 'practice' ? 'Reset' : 'Locked') : 'Verify Answer';
    button.disabled = ex.locked && appSettings.mode !== 'practice';
}

function applyAtom4LockedUI(qid, ex) {
    const result = gradeAtom4Answer(ex, ex.userAnswer);
    applyAtom3LockedUI(qid, ex);
    ['network', 'broadcast'].forEach(boundary => {
        const correctRows = boundary === 'network' ? result.networkCorrectArr : result.broadcastCorrectArr;
        document.querySelectorAll('.atom4-boundary-row[data-qid="' + qid + '"][data-boundary="' + boundary + '"]').forEach(row => {
            const rowPos = parseInt(row.dataset.row, 10);
            row.classList.remove('atom4-correct', 'atom4-incorrect', 'atom3-item-correct', 'atom3-item-incorrect');
            row.classList.add(correctRows[rowPos] ? 'atom4-correct' : 'atom4-incorrect');
            row.classList.add(correctRows[rowPos] ? 'atom3-item-correct' : 'atom3-item-incorrect');
        });
        document.querySelectorAll('.atom4-host-bit[data-qid="' + qid + '"][data-boundary="' + boundary + '"]').forEach(cell => cell.classList.add('atom4-locked'));
    });
    const feedback = document.getElementById('atom3Feedback-' + qid);
    if (feedback && !result.allCorrect) {
        const targetRows = result.networkCorrectArr.length;
        const networkScore = result.networkCorrectArr.filter(Boolean).length;
        const broadcastScore = result.broadcastCorrectArr.filter(Boolean).length;
        feedback.textContent = result.score + '/' + ex.answers.length + ' items correct. Network: ' + networkScore + '/' + targetRows + '; Broadcast: ' + broadcastScore + '/' + targetRows + '.';
        feedback.className = 'atom1-feedback ' + (result.score ? 'warning show' : 'error show');
    }
    updateAtom4ButtonState(qid);
}

function verifyAtom4Question(qid) {
    const ex = exerciseData[qid];
    if (!ex || ex.locked) return;
    ex.userAnswer = collectAtom4Answer(qid);
    const result = gradeAtom4Answer(ex, ex.userAnswer);
    ex.score = result.score;
    ex.isPartial = result.score > 0 && !result.allCorrect;
    ex.locked = true;
    applyAtom4LockedUI(qid, ex);
    updateAtom4NavScore();
    updateSummaryPanel();
    if (result.allCorrect) triggerConfetti();
    if (appSettings.mode === 'exam') saveExamSession();
}

function resetAtom4Question(qid) {
    if (appSettings.mode === 'exam') {
        showAlertModal('Reset Not Allowed', 'Reset is not allowed in Exam Mode.');
        return;
    }
    const ex = exerciseData[qid];
    if (!ex) return;
    resetAtom3Question(qid);
    ex.userAnswer = '';
    ex.score = 0;
    ex.isPartial = false;
    ex.locked = false;
    const panel = document.getElementById('atom3QPanel-' + qid);
    if (panel) panel.classList.remove('correct', 'incorrect');
    updateAtom4ButtonState(qid);
    const feedback = document.getElementById('atom3Feedback-' + qid);
    if (feedback) { feedback.textContent = ''; feedback.className = 'atom1-feedback'; }
    document.querySelectorAll('.atom4-boundary-row[data-qid="' + qid + '"]').forEach(row => {
        row.classList.remove('atom4-correct', 'atom4-incorrect', 'atom3-item-correct', 'atom3-item-incorrect');
    });
    const badge = document.getElementById('atom3ScoreBadge-' + qid);
    if (badge) badge.textContent = '0/' + ex.answers.length;
    updateAtom4NavScore();
    updateSummaryPanel();
}

function updateAtom4NavScore() {
    const scoreEl = document.getElementById('score-atom4');
    if (!scoreEl) return;
    let score = 0;
    let total = 0;
    for (const qid in exerciseData) {
        if (!qid.startsWith('atom4-q')) continue;
        score += Number(exerciseData[qid].score || 0);
        total += exerciseData[qid].answers.length;
    }
    scoreEl.textContent = score + '/' + total;
    scoreEl.classList.remove('completed-score', 'partial-score');
    if (total && score === total) scoreEl.classList.add('completed-score');
    else if (score) scoreEl.classList.add('partial-score');
}

function syncAtom4ViewDOM() {
    for (const qid in exerciseData) {
        if (!qid.startsWith('atom4-q')) continue;
        const ex = exerciseData[qid];
        const parts = typeof ex.userAnswer === 'string' ? ex.userAnswer.split('::') : [];
        const borrowed = parseInt(parts[0], 10);
        const safeBorrowed = isNaN(borrowed) ? 0 : Math.max(0, Math.min(borrowed, ex.maxBorrow));
        updateAtom3Grid(qid, ex, safeBorrowed);
        const savedMask = parts[1];
        updateAtom3MaskGrid(qid, ex, savedMask && savedMask.length === 32 ? savedMask : initAtom2MaskBits(ex.networkBits));
        const savedRows = parts[2] || '';
        if (savedRows) {
            savedRows.split(',').forEach((bits, position) => {
                if (bits && bits.length === safeBorrowed) updateAtom3Row(qid, position, bits.split('').map(Number));
            });
        }
        const networkRows = (parts[3] || '').split(',');
        const broadcastRows = (parts[4] || '').split(',');
        document.querySelectorAll('.atom4-boundary-row[data-qid="' + qid + '"]').forEach(row => {
            const rowPos = parseInt(row.dataset.row, 10);
            const subnetRow = document.getElementById('atom3Row-' + qid + '-' + rowPos);
            const subnetBits = subnetRow ? (subnetRow.dataset.bits || '') : '';
            const boundaries = document.getElementById('atom4RowBoundaries-' + qid + '-' + rowPos);
            if (boundaries) {
                boundaries.innerHTML = buildAtom4BoundaryHtml(qid, ex, 'network', atom4BitsFromAnswer(networkRows[rowPos], ex), subnetBits, rowPos) +
                    buildAtom4BoundaryHtml(qid, ex, 'broadcast', atom4BitsFromAnswer(broadcastRows[rowPos], ex), subnetBits, rowPos);
            }
        });
        if (ex.locked) applyAtom4LockedUI(qid, ex);
        else updateAtom4ButtonState(qid);
    }
    updateAtom4NavScore();
}

function showAtom4Page() {
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    document.getElementById('nav-atom4')?.classList.add('active');
    ['exerciseArea', 'subnetVisualizerView', 'atomPlaceholderView', 'atom1View', 'atom2View', 'atom3View'].forEach(id => {
        const view = document.getElementById(id);
        if (view) view.style.display = 'none';
    });
    document.getElementById('atom4View').style.display = 'flex';
    document.getElementById('timerContainer').style.display = timerIntervalId ? 'flex' : 'none';
    showAtomPaginationBar('atom4');
    currentFile = '';
    closeSampleOutputModal();
    updateConsoleDrawerTab(false);
    closeSidebarIfMobile();
}

// --- Sidebar navigation into the Atom 3 view (Tools → Atoms → Atom 3) ---
// Mirrors showAtom1Page/showAtom2Page exactly.
function showAtom3Page() {
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    const navItem = document.getElementById('nav-atom3');
    if (navItem) navItem.classList.add('active');

    document.getElementById('exerciseArea').style.display = 'none';
    document.getElementById('subnetVisualizerView').style.display = 'none';
    document.getElementById('atomPlaceholderView').style.display = 'none';
    document.getElementById('atom1View').style.display = 'none';
    document.getElementById('atom2View').style.display = 'none';
    document.getElementById('atom4View').style.display = 'none';
    document.getElementById('atom3View').style.display = 'flex';
    document.getElementById('timerContainer').style.display = timerIntervalId ? 'flex' : 'none';

    showAtomPaginationBar('atom3');

    currentFile = ''; // no single graded exercise is "current" on this page

    closeSampleOutputModal();
    updateConsoleDrawerTab(false);

    closeSidebarIfMobile();
}

function renderQuestionHtml(qid, q) {
    if (q.type === 'atom1') return renderAtom1QuestionHtml(qid, q);
    // Atom 2 lives entirely in its own dedicated view, rendered directly
    // from exerciseData via buildAtom2PanelHtml (see renderAtom2View) —
    // this .html field is never read for it, so nothing further to build.
    if (q.type === 'atom2') return '';
    // Same rationale for Atom 3 (see renderAtom3View/buildAtom3PanelHtml).
    if (q.type === 'atom3') return '';
    // Atom 4 reuses Atom 3's dedicated panel and adds its own boundary rows.
    if (q.type === 'atom4') return '';
    let inputHtml = '';
    let answerRowClass = 'conversion-answer-row';
    if (q.type === 'd2b') {
        inputHtml = renderBitGroup(qid, q.bitWidth);
    } else if (q.type === 'b2d') {
        const givenGroup = renderReadOnlyBitGroup(qid, q.given, q.bitWidth);
        inputHtml = `<div class="b2d-given-wrap">
                        <span class="b2d-given-label">Given</span>
                        ${givenGroup}
                     </div>
                     <span class="conversion-equals" aria-hidden="true">=</span>
                     <input type="text" class="answer-input-num" data-qid="${qid}" inputmode="numeric" placeholder="decimal">`;
        // The "Given" label sits above the bit grid, making that column
        // taller than the bare "=" and decimal input beside it. Row-level
        // `align-items: center` would center against that extra height and
        // visibly sink the equals sign/input below the bit boxes — this
        // modifier switches just this row to bottom alignment instead, so
        // the bit-box row and the decimal field line up on the same
        // baseline regardless of the label above.
        answerRowClass += ' answer-row-bottom-align';
    } else if (q.type === 'ip_d2b' || q.type === 'mask_d2b') {
        // Phase 3 (IP Dec→Bin) and Phase 6 (Mask Dec→Bin) are structurally
        // identical input-wise — both ask for four 8-bit binary octets —
        // so they share the same expand-on-focus bit-grid UI. Grading stays
        // untouched: buildConversionExerciseData still only awards partial,
        // per-octet credit for 'ip_d2b' (see isOctetScored there); this is
        // purely about how the value gets typed in, not how it's scored.
        inputHtml = renderIpOctetBinExpandable(qid);
    } else if (q.type === 'ip_b2d' || q.type === 'mask_c2d') {
        inputHtml = renderIpOctetInputs(qid, 'dec');
    } else if (q.type === 'class_cidr') {
        inputHtml = renderClassCidrInput(qid, q.given);
    }
    return `<div class="conversion-question">
                <div class="conversion-prompt">${q.promptHtml}</div>
                <div class="${answerRowClass}">${inputHtml}</div>
            </div>`;
}

// Reads whatever is currently typed into the DOM for the active question.
// Only one question's inputs exist in #codeDisplay at a time, so no qid
// scoping is needed on the selectors.
function collectConversionAnswer(ex) {
    if (!ex) return '';
    if (ex.type === 'atom1') {
        const grid = document.getElementById('atom1BitGrid-' + currentFile);
        return grid ? (grid.dataset.borrowed || '0') : (ex.userAnswer || '');
    }
    if (ex.type === 'd2b') {
        return Array.from(document.querySelectorAll('.bitbox')).map(b => b.value || '_').join('');
    }
    if (ex.type === 'b2d' || ex.type === 'class_cidr') {
        const inp = document.querySelector('.answer-input-num');
        return inp ? inp.value.trim() : '';
    }
    if (ex.type === 'ip_d2b' || ex.type === 'mask_d2b') {
        const parts = [0, 1, 2, 3].map(i => {
            const el = document.querySelector(`.ip-octet-bin[data-oct="${i}"]`);
            return el ? el.value.trim() : '';
        });
        return parts.join('.');
    }
    if (ex.type === 'ip_b2d' || ex.type === 'mask_c2d') {
        const parts = [0, 1, 2, 3].map(i => {
            const el = document.querySelector(`.ip-octet-dec[data-oct="${i}"]`);
            return el ? el.value.trim() : '';
        });
        return parts.join('.');
    }
    return '';
}

function gradeConversionAnswer(ex, userAnswer) {
    if (!ex) return false;
    // Exact match required for binary answers (leading zeros matter).
    return (userAnswer || '').trim() === (ex.correct || '').trim();
}

// Returns { score, allCorrect } for the current question. IP address
// questions (Phase 3/4) are graded per octet — 1 point for each of the 4
// octets that matches — so partial credit is possible. Every other
// conversion type (individual dec/bin, subnet mask) is still all-or-nothing
// (1 point), matching ex.answers.length set in buildConversionExerciseData.
function gradeConversionScore(ex, userAnswer) {
    if (!ex) return { score: 0, allCorrect: false };
    if (ex.type === 'ip_d2b' || ex.type === 'ip_b2d') {
        const correctParts = (ex.correct || '').split('.');
        const userParts = (userAnswer || '').split('.');
        let score = 0;
        for (let i = 0; i < correctParts.length; i++) {
            if ((userParts[i] || '').trim() === correctParts[i].trim()) score++;
        }
        return { score, allCorrect: score === correctParts.length };
    }
    const isCorrect = gradeConversionAnswer(ex, userAnswer);
    return { score: isCorrect ? 1 : 0, allCorrect: isCorrect };
}

// Applies per-octet correct/incorrect visual feedback for the IP address
// conversion questions (Phase 3 · IP Dec→Bin and Phase 4 · IP Bin→Dec),
// where each of the 4 octets is scored independently. Mirrors the
// border-color convention already used for the legacy fill-in-the-blank
// inputs elsewhere in this file, so it stays visually consistent without
// needing new CSS. Called right after grading (checkAnswers) and when
// redisplaying an already-locked question (switchExercise), so the
// coloring survives navigating away and back.
function applyOctetFeedback(ex) {
    if (!ex || (ex.type !== 'ip_d2b' && ex.type !== 'ip_b2d')) return;

    const selectorClass = ex.type === 'ip_d2b' ? '.ip-octet-bin' : '.ip-octet-dec';
    const correctParts = (ex.correct || '').split('.');

    document.querySelectorAll(selectorClass).forEach(el => {
        const idx = parseInt(el.dataset.oct, 10);
        const userVal = (el.value || '').trim();
        const isRight = userVal === (correctParts[idx] || '').trim();

        el.classList.remove('octet-correct', 'octet-incorrect');
        el.classList.add(isRight ? 'octet-correct' : 'octet-incorrect');
        el.style.borderColor = isRight ? 'var(--secondary)' : 'var(--error)';
        el.style.borderBottomColor = isRight ? 'var(--secondary)' : 'var(--error)';
        el.setAttribute('aria-invalid', isRight ? 'false' : 'true');
        el.title = isRight ? 'Correct' : 'Incorrect';
    });
}

// Clears any per-octet correct/incorrect styling/attributes applied by
// applyOctetFeedback, used on reset so a fresh attempt doesn't start out
// still colored from the previous one.
function clearOctetFeedback() {
    document.querySelectorAll('.ip-octet-bin, .ip-octet-dec').forEach(el => {
        el.classList.remove('octet-correct', 'octet-incorrect');
        el.style.borderColor = '';
        el.style.borderBottomColor = '';
        el.removeAttribute('aria-invalid');
        el.removeAttribute('title');
    });
}

// Repopulates the current question's inputs from a previously saved
// ex.userAnswer (e.g. after switching away and back, or resuming an
// exam session mid-question).
function restoreConversionAnswer(ex) {
    if (!ex || !ex.userAnswer) return;
    if (ex.type === 'd2b') {
        const chars = ex.userAnswer.split('');
        document.querySelectorAll('.bitbox').forEach((box, i) => {
            const c = chars[i];
            box.classList.remove('on', 'off');
            if (c === '0' || c === '1') {
                box.value = c;
                box.classList.add(c === '1' ? 'on' : 'off');
            }
            updatePlainBitPlaceValueLabel(box.dataset.qid, i, box.value);
        });
    } else if (ex.type === 'b2d' || ex.type === 'class_cidr') {
        const inp = document.querySelector('.answer-input-num');
        if (inp) inp.value = ex.userAnswer;
    } else if (ex.type === 'ip_d2b' || ex.type === 'mask_d2b') {
        const parts = ex.userAnswer.split('.');
        document.querySelectorAll('.ip-octet-bin').forEach(el => {
            const idx = parseInt(el.dataset.oct, 10);
            el.value = parts[idx] || '';
        });
    } else if (ex.type === 'ip_b2d' || ex.type === 'mask_c2d') {
        const parts = ex.userAnswer.split('.');
        document.querySelectorAll('.ip-octet-dec').forEach(el => {
            const idx = parseInt(el.dataset.oct, 10);
            el.value = parts[idx] || '';
        });
    } else if (ex.type === 'atom1') {
        const borrowed = parseInt(ex.userAnswer, 10);
        if (!isNaN(borrowed)) {
            updateAtom1Grid(currentFile, ex, Math.max(0, Math.min(borrowed, ex.maxBorrow)));
        }
    }
}

// Persists the in-progress answer for the current question (debounced by
// the caller via the input event) and, in exam mode, saves the session so
// a reload mid-question doesn't lose it.
function saveConversionProgress() {
    const ex = exerciseData[currentFile];
    if (!ex || !ex.isConversionQuestion || ex.locked) return;
    ex.userAnswer = collectConversionAnswer(ex);
    if (appSettings.mode === 'exam') saveExamSession();
}

// --- PHASE 3 & PHASE 6: EXPAND-ON-FOCUS OCTET BINARY INPUT ---
// The bit-grid "card" is a floating popover (see .octet-bitgroup in
// style.css) anchored under its compact field. It uses position: fixed
// with JS-computed coordinates rather than position: absolute relative to
// its wrapper — .code-editor sets overflow-x: auto without an explicit
// overflow-y, which per spec silently forces overflow-y to 'auto' too,
// turning it into a clipping/scrolling container that cut an
// absolutely-positioned popover off before it could render below its
// field. Fixed positioning escapes any such ancestor clipping entirely.
//
// Showing/hiding is just a class toggle — the opacity/transform/
// visibility crossfade is entirely owned by CSS transitions on
// .octet-bitgroup / .octet-bitgroup.expanded and .ip-octet-collapsed /
// .ip-octet-collapsed.field-hidden, so both halves of the swap animate
// together as one continuous motion instead of two separately-timed
// animations that could drift out of sync.

// Computes and applies the popover's viewport position from its field's
// current on-screen location, clamping horizontally so it can't run off
// the right edge of the screen on narrow viewports. Safe to call while
// the card is still invisible (visibility: hidden doesn't remove it from
// layout, only display: none would), so its real measured size is
// available for the clamp check even before it's shown.
function positionOctetCard(collapsedInput, bitgroup) {
    const fieldRect = collapsedInput.getBoundingClientRect();
    const cardRect = bitgroup.getBoundingClientRect();
    const margin = 8;

    let left = fieldRect.left;
    const maxLeft = window.innerWidth - cardRect.width - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);

    bitgroup.style.left = `${Math.round(left)}px`;
    bitgroup.style.top = `${Math.round(fieldRect.bottom + 10)}px`;
}

// Keeps any currently-expanded octet card(s) glued to their field while
// the page (or any scrollable ancestor, e.g. the sidebar or a mobile
// keyboard-triggered scroll) moves underneath them — fixed-position
// elements don't follow scrolling on their own, so without this the
// popover would visually detach from its field the moment the page
// scrolled while it was open.
function repositionExpandedOctetCards() {
    document.querySelectorAll('.octet-bitgroup.expanded').forEach(bitgroup => {
        const collapsedInput = document.querySelector(
            `.ip-octet-collapsed[data-qid="${bitgroup.dataset.qid}"][data-oct="${bitgroup.dataset.oct}"]`
        );
        if (collapsedInput) positionOctetCard(collapsedInput, bitgroup);
    });
}
window.addEventListener('scroll', repositionExpandedOctetCards, { passive: true, capture: true });
window.addEventListener('resize', repositionExpandedOctetCards);

function showOctetCard(bitgroup) {
    bitgroup.classList.add('expanded');
}

function hideOctetCard(bitgroup) {
    bitgroup.classList.remove('expanded');
}

// tabIndex (not visibility) is what keeps a hidden compact field out of
// Tab-key reach — see the comment on expandOctetBinaryInput for why
// visibility can't be used here.
function hideCollapsedField(input) {
    input.classList.add('field-hidden');
    input.tabIndex = -1;
    input.title = 'Editing in the expanded view below';
    // NOT input.disabled — disabling a currently-focused element forces an
    // immediate blur (same reason visibility:hidden was ruled out for this
    // field, see the CSS comment on .ip-octet-collapsed.field-hidden), which
    // would fire ahead of the deferred focus handoff into the bit grid and
    // break it. readOnly has no such side effect: it still blocks the
    // student from typing/editing this field while it's muted, but doesn't
    // touch focus at all.
    input.readOnly = true;
}

function showCollapsedField(input) {
    input.classList.remove('field-hidden');
    input.removeAttribute('tabindex');
    input.removeAttribute('title');
    input.readOnly = false;
}

// Reconstructs the 8-bit string for one octet from its bit boxes (using
// '_' for any box left blank, same convention as Phase 1's own collector)
// and writes it into that octet's collapsed text field — the field
// collectConversionAnswer/applyOctetFeedback/restoreConversionAnswer
// already know how to read, so no changes were needed there.
function updateCollapsedOctetValue(qid, oct) {
    const boxes = Array.from(document.querySelectorAll(`.octet-bitbox[data-qid="${qid}"][data-oct="${oct}"]`))
        .sort((a, b) => parseInt(a.dataset.idx, 10) - parseInt(b.dataset.idx, 10));
    if (!boxes.length) return;
    const val = boxes.map(b => b.value || '_').join('');
    const collapsedInput = document.querySelector(`.ip-octet-collapsed[data-qid="${qid}"][data-oct="${oct}"]`);
    if (collapsedInput) collapsedInput.value = val;
}

// Shared core: flips a place-value label between "active" (bit is 1 — this
// place value counts toward the total) and "muted" (bit is 0 or not yet
// answered). Used by both the octet grid (Phase 3/6) and the plain grid
// (Phase 1) — they differ only in how the label element is looked up.
function setPlaceValueLabelState(label, value) {
    if (!label) return;
    label.classList.toggle('active', value === '1');
    label.classList.toggle('muted', value !== '1');
}

// Phase 3/6: each rendered exercise has four octets' worth of bit boxes in
// the DOM at once (idx 0–7 repeats per octet), so the lookup needs both
// data-oct and data-idx to find the right label.
function updateBitPlaceValueLabel(qid, oct, idx, value) {
    const label = document.querySelector(`.bit-place-value[data-qid="${qid}"][data-oct="${oct}"][data-idx="${idx}"]`);
    setPlaceValueLabelState(label, value);
}

// Phase 1: only one bit grid is ever rendered per exercise, so data-qid +
// data-idx alone is already unique — no octet to scope by.
function updatePlainBitPlaceValueLabel(qid, idx, value) {
    const label = document.querySelector(`.bit-place-value[data-qid="${qid}"][data-idx="${idx}"]`);
    setPlaceValueLabelState(label, value);
}

// --- PHASE 3 & PHASE 6: WHICH OCTET IS CURRENTLY EXPANDED ---
// Single source of truth for "which octet's popover is open right now",
// driven entirely by the delegated focusin/focusout listeners set up in
// attachExpandableOctetHandlers (below) rather than by each individual
// element deciding for itself. See the comment on expandOctetBinaryInput
// for why the old per-element approach was unreliable.
let currentlyExpandedOctet = null; // { qid, oct } | null

// Guards handleOctetFocusOutFallback from collapsing the octet card while
// we're in the middle of our own programmatic focus handoff (compact field
// -> first bit box). Without this, a focusout fired as a side effect of
// hiding/disabling the compact field (e.g. the tabIndex change inside
// hideCollapsedField, called from expandOctetBinaryInput) can race ahead of
// the setTimeout that actually moves focus into the bit grid, making the
// card flash open and immediately collapse again. It's set true the moment
// we decide to expand, and cleared once focus has genuinely landed inside
// the octet (or the handoff attempt has finished, successfully or not).
let suppressOctetCollapseUntilExpanded = false;

// Seeds the bit boxes for [qid, oct] from its compact field's current
// value and shows the popover card. Deliberately does NOT move focus
// itself — see attachExpandableOctetHandlers for why that's handled
// separately, in a fresh task. Returns the sorted box elements so the
// caller can decide what (if anything) to focus.
function expandOctetBinaryInput(qid, oct) {
    const wrapper = document.querySelector(`.octet-expand-wrapper[data-qid="${qid}"][data-oct="${oct}"]`);
    if (!wrapper) return null;
    const collapsedInput = wrapper.querySelector('.ip-octet-collapsed');
    const bitgroup = wrapper.querySelector('.octet-bitgroup');
    if (!collapsedInput || !bitgroup || collapsedInput.disabled) return null;

    const chars = (collapsedInput.value || '').split('');
    const boxes = Array.from(bitgroup.querySelectorAll('.octet-bitbox'))
        .sort((a, b) => parseInt(a.dataset.idx, 10) - parseInt(b.dataset.idx, 10));
    boxes.forEach((box, i) => {
        const c = chars[i];
        box.classList.remove('on', 'off');
        if (c === '0' || c === '1') {
            box.value = c;
            box.classList.add(c === '1' ? 'on' : 'off');
        } else {
            box.value = '';
        }
        updateBitPlaceValueLabel(qid, oct, i, box.value);
    });

    positionOctetCard(collapsedInput, bitgroup);
    showOctetCard(bitgroup);

    // Force a synchronous style/layout flush right here, immediately after
    // the 'expanded' class is added. Reading a layout property forces the
    // browser to resolve the just-added class into real computed style
    // (visibility, in particular) right now rather than lazily on whatever
    // later render pass happens to come next. Without this, a focus() call
    // shortly afterward could land while the card's focusability is still
    // effectively unresolved, and silently no-op.
    void bitgroup.offsetHeight;

    hideCollapsedField(collapsedInput);
    currentlyExpandedOctet = { qid, oct };

    return boxes;
}

// Swaps a Phase 3 octet's bit grid back to its compact text field,
// syncing whatever was typed into the boxes back into that field first.
function collapseOctetBinaryInput(qid, oct) {
    const wrapper = document.querySelector(`.octet-expand-wrapper[data-qid="${qid}"][data-oct="${oct}"]`);
    if (!wrapper) return;
    const collapsedInput = wrapper.querySelector('.ip-octet-collapsed');
    const bitgroup = wrapper.querySelector('.octet-bitgroup');
    if (!collapsedInput || !bitgroup) return;

    updateCollapsedOctetValue(qid, oct);
    hideOctetCard(bitgroup);
    showCollapsedField(collapsedInput);
    if (currentlyExpandedOctet && currentlyExpandedOctet.qid === qid && currentlyExpandedOctet.oct === oct) {
        currentlyExpandedOctet = null;
    }
}

// Attached once, globally (see the guard in attachExpandableOctetHandlers)
// rather than per-wrapper. This is the actual fix for "expands, then
// immediately collapses again": the previous version decided whether to
// expand/collapse from each field's own 'focus' handler, and — critically
// — called `someBox.focus()` synchronously FROM WITHIN that handler to
// hand focus off to the bit grid. Calling .focus() on a different element
// from inside another element's own focus event handler is a well-known
// cross-browser inconsistency: some browsers defer that re-focus to a
// later tick instead of applying it immediately. When that happened here,
// the code went on to hide the compact field before focus had actually,
// reliably landed in the bit grid, so the "did focus leave?" check fired
// against a field that — from the browser's perspective — hadn't
// finished losing focus yet, and collapsed the card right back.
//
// This version instead treats focusin as the single, authoritative signal
// for "focus is now here" (fired only once focus has actually landed,
// regardless of any deferral), and — when it needs to move focus into the
// bit grid itself — defers that .focus() call to a double
// requestAnimationFrame rather than setTimeout(0). Both approaches equally
// avoid the nested/reentrant-focus problem described above (they run as a
// fresh, top-level task outside any browser focus-dispatch call stack), but
// setTimeout(0) makes no promise that a style/layout pass has happened by
// the time it fires — only that ~0ms of real time has elapsed — so it can
// land while the just-expanded card's focusability is still unresolved and
// the focus() call silently no-ops. Two nested rAFs (the same pattern this
// file already uses in animateRowSwap for a similar "wait for the browser
// to actually render this" need) guarantee at least one full render pass
// has completed first. A one-shot retry immediately after covers the rare
// case where focus still didn't land on the first attempt.
function handleOctetFocusIn(e) {
    const wrapper = e.target.closest('.octet-expand-wrapper');

    if (!wrapper) {
        // Focus landed somewhere unrelated to any octet — collapse
        // whatever was open.
        if (currentlyExpandedOctet) {
            collapseOctetBinaryInput(currentlyExpandedOctet.qid, currentlyExpandedOctet.oct);
        }
        return;
    }

    const qid = wrapper.dataset.qid;
    const oct = wrapper.dataset.oct;
    const isSameOctet = currentlyExpandedOctet && currentlyExpandedOctet.qid === qid && currentlyExpandedOctet.oct === oct;

    // Focus has genuinely landed inside an octet's own markup (whether
    // it's the one already expanded or a new one we're about to expand),
    // so any handoff that was in flight has resolved — safe to stop
    // suppressing the fallback below.
    suppressOctetCollapseUntilExpanded = false;

    if (isSameOctet) {
        // Focus moved within the same already-expanded octet. The one case
        // that still needs handling here: focus landing back on the
        // octet's own compact field, which is muted + read-only while
        // expanded and was never meant to hold focus at all (a stray
        // .focus() call, browser autofill, or assistive-tech navigation
        // can still land it there even with tabIndex -1 and
        // pointer-events: none). Bounce it straight to the first bit box
        // instead of leaving focus stranded in a field the student can no
        // longer edit but could still select text in.
        if (e.target.classList.contains('ip-octet-collapsed')) {
            const firstBit = document.querySelector(
                `.octet-bitbox[data-qid="${qid}"][data-oct="${oct}"][data-idx="0"]`
            );
            if (firstBit) firstBit.focus();
        }
        return;
    }

    if (currentlyExpandedOctet) {
        collapseOctetBinaryInput(currentlyExpandedOctet.qid, currentlyExpandedOctet.oct);
    }

    // Set BEFORE expandOctetBinaryInput runs: that call mutates the still-
    // focused compact field (hideCollapsedField flips its tabIndex/opacity),
    // which can itself synchronously trigger a focusout in some browsers —
    // ahead of the deferred rAF callback below that actually moves focus
    // into the bit grid. Flagging the handoff as "in progress" first means
    // that incidental focusout gets ignored instead of collapsing the card
    // we just opened.
    suppressOctetCollapseUntilExpanded = true;

    const boxes = expandOctetBinaryInput(qid, oct);
    if (!boxes) {
        suppressOctetCollapseUntilExpanded = false;
        return;
    }

    // If focus landed on the compact field itself (a fresh click/tab into
    // this octet, as opposed to a programmatic .focus() aimed straight at
    // a box — e.g. the last-bit auto-advance below), hand focus to the
    // first bit box. Deferred (via rAF) to its own task so it's never
    // nested inside this focusin dispatch.
    if (e.target.classList.contains('ip-octet-collapsed')) {
        const firstBit = boxes[0];
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!firstBit) {
                    suppressOctetCollapseUntilExpanded = false;
                    return;
                }
                firstBit.focus();
                if (document.activeElement === firstBit) {
                    suppressOctetCollapseUntilExpanded = false;
                    return;
                }
                // Rare fallback: if focus still didn't land (e.g. an even
                // slower style/layout resolution on some browser/device),
                // give it one more attempt a frame later rather than
                // silently leaving focus stranded. Suppression stays on
                // through this retry too, so a stray focusout in between
                // can't collapse the card before the retry gets its chance.
                requestAnimationFrame(() => {
                    firstBit.focus();
                    suppressOctetCollapseUntilExpanded = false;
                });
            });
        });
    } else {
        suppressOctetCollapseUntilExpanded = false;
    }
}

// Fallback for the case focusin can't resolve on its own: focus leaving
// to nowhere at all (e.g. clicking non-interactive blank space, or the
// last octet's last box releasing focus with nothing next to take it) —
// this fires a focusout with no corresponding focusin anywhere.
function handleOctetFocusOutFallback(e) {
    // We're mid-handoff (compact field -> first bit box, or one octet
    // collapsing while another expands) — this focusout is incidental to
    // our own choreography, not a real "the user moved focus away" event.
    // Ignore it; handleOctetFocusIn will clear this flag once focus
    // actually lands, or the pending setTimeout will clear it either way.
    if (suppressOctetCollapseUntilExpanded) return;

    // When the browser tells us exactly where focus is going, resolve it
    // synchronously instead of guessing after a timeout.
    const next = e && e.relatedTarget;
    if (next) {
        const nextWrapper = next.closest && next.closest('.octet-expand-wrapper');
        if (currentlyExpandedOctet && nextWrapper &&
            nextWrapper.dataset.qid === currentlyExpandedOctet.qid &&
            nextWrapper.dataset.oct === currentlyExpandedOctet.oct) {
            return; // staying within the same expanded octet — nothing to do
        }
    }

    setTimeout(() => {
        // Re-check: a handoff may have started (and been flagged) after
        // this timeout was scheduled but before it ran.
        if (suppressOctetCollapseUntilExpanded) return;
        if (!currentlyExpandedOctet) return;
        const wrapper = document.querySelector(
            `.octet-expand-wrapper[data-qid="${currentlyExpandedOctet.qid}"][data-oct="${currentlyExpandedOctet.oct}"]`
        );
        if (wrapper && !wrapper.contains(document.activeElement)) {
            collapseOctetBinaryInput(currentlyExpandedOctet.qid, currentlyExpandedOctet.oct);
            saveConversionProgress();
        }
    }, 0);
}

let octetFocusTrackingAttached = false;

// Wires up Phase 3's expand-on-focus behavior: focusing a collapsed octet
// field expands it into Phase 1-style bit boxes; typing a bit auto-advances
// within the octet (mirroring Phase 1); filling the 8th bit auto-collapses
// and advances to the next octet; and focus leaving the octet entirely
// (tab, click elsewhere) also collapses it back to the compact field.
function attachExpandableOctetHandlers() {
    document.querySelectorAll('.ip-octet-collapsed').forEach(inp => {
        inp.addEventListener('input', () => saveConversionProgress());
        // Note: no direct 'focus' listener here that calls
        // expandOctetBinaryInput — that's handled centrally by the
        // delegated focusin listener attached once below. See the big
        // comment on handleOctetFocusIn for why.
    });

    // The delegated focusin/focusout listeners aren't tied to any
    // particular exercise's DOM (they look elements up by data-qid/
    // data-oct at the time they fire), so they only need attaching once
    // ever — attaching them again on every exercise switch would stack up
    // duplicate listeners.
    if (!octetFocusTrackingAttached) {
        octetFocusTrackingAttached = true;
        document.addEventListener('focusin', handleOctetFocusIn);
        document.addEventListener('focusout', handleOctetFocusOutFallback);
    }

    const boxes = Array.from(document.querySelectorAll('.octet-bitbox'));
    boxes.forEach(box => {
        // Select any existing digit when the box gains focus (via click,
        // Tab, or arrow-key navigation) so typing immediately overwrites
        // it instead of requiring a manual delete first. Deferred a tick
        // since some mobile browsers reset the selection right after the
        // focus event if select() is called synchronously.
        box.addEventListener('focus', () => {
            setTimeout(() => box.select(), 0);
        });
        box.addEventListener('input', e => {
            const qid = e.target.dataset.qid;
            const oct = e.target.dataset.oct;
            const idx = parseInt(e.target.dataset.idx, 10);

            let v = e.target.value.replace(/[^01]/g, '').slice(-1);
            e.target.value = v;
            e.target.classList.remove('on', 'off');
            if (v === '1') e.target.classList.add('on');
            else if (v === '0') e.target.classList.add('off');
            updateBitPlaceValueLabel(qid, oct, idx, v);

            updateCollapsedOctetValue(qid, oct);
            saveConversionProgress();

            if (v && idx < 7) {
                const nextBox = document.querySelector(`.octet-bitbox[data-qid="${qid}"][data-oct="${oct}"][data-idx="${idx + 1}"]`);
                if (nextBox) nextBox.focus();
            } else if (v && idx === 7) {
                // Last bit of this octet — hop to the next octet's field,
                // same "keep moving forward" feel as Phase 1's own
                // auto-advance. Just move focus: the delegated focusin
                // listener (handleOctetFocusIn) reacts to that focus
                // change and handles collapsing this octet's card and
                // expanding the next one, in that order, automatically.
                const nextOct = parseInt(oct, 10) + 1;
                const nextCollapsed = nextOct <= 3
                    ? document.querySelector(`.ip-octet-collapsed[data-qid="${qid}"][data-oct="${nextOct}"]`)
                    : null;

                if (nextCollapsed) {
                    nextCollapsed.focus();
                } else {
                    // Last bit of the last octet — nothing further to
                    // focus; releasing focus lets the focusout fallback
                    // collapse this card.
                    e.target.blur();
                }
            }
        });
        box.addEventListener('keydown', e => {
            const qid = e.target.dataset.qid;
            const oct = e.target.dataset.oct;
            const idx = parseInt(e.target.dataset.idx, 10);
            if (e.key === 'Backspace' && !e.target.value && idx > 0) {
                const prevBox = document.querySelector(`.octet-bitbox[data-qid="${qid}"][data-oct="${oct}"][data-idx="${idx - 1}"]`);
                if (prevBox) prevBox.focus();
            }
            if (e.key === 'ArrowLeft' && idx > 0) {
                const prevBox = document.querySelector(`.octet-bitbox[data-qid="${qid}"][data-oct="${oct}"][data-idx="${idx - 1}"]`);
                if (prevBox) prevBox.focus();
            }
            if (e.key === 'ArrowRight' && idx < 7) {
                const nextBox = document.querySelector(`.octet-bitbox[data-qid="${qid}"][data-oct="${oct}"][data-idx="${idx + 1}"]`);
                if (nextBox) nextBox.focus();
            }
        });
    });
}

// Wires up input formatting/auto-advance for bit boxes, and plain change
// listeners for the other input types, on whatever is currently rendered
// in #codeDisplay.
function attachConversionInputHandlers(ex) {
    if (!ex) return;
    if (ex.type === 'd2b') {
        const boxes = Array.from(document.querySelectorAll('.bitbox'));
        boxes.forEach((box, idx) => {
            // Select any existing digit on focus so typing overwrites it
            // instead of requiring a manual delete first (see the matching
            // comment in attachExpandableOctetHandlers for why this is
            // deferred a tick).
            box.addEventListener('focus', () => {
                setTimeout(() => box.select(), 0);
            });
            box.addEventListener('input', e => {
                let v = e.target.value.replace(/[^01]/g, '').slice(-1);
                e.target.value = v;
                e.target.classList.remove('on', 'off');
                if (v === '1') e.target.classList.add('on');
                else if (v === '0') e.target.classList.add('off');
                updatePlainBitPlaceValueLabel(e.target.dataset.qid, idx, v);
                if (v && idx < boxes.length - 1) boxes[idx + 1].focus();
                saveConversionProgress();
            });
            box.addEventListener('keydown', e => {
                if (e.key === 'Backspace' && !e.target.value && idx > 0) boxes[idx - 1].focus();
                if (e.key === 'ArrowLeft' && idx > 0) boxes[idx - 1].focus();
                if (e.key === 'ArrowRight' && idx < boxes.length - 1) boxes[idx + 1].focus();
            });
        });
    } else if (ex.type === 'ip_d2b' || ex.type === 'mask_d2b') {
        attachExpandableOctetHandlers();
    } else if (ex.type === 'atom1') {
        attachAtom1Handlers(currentFile, ex);
    } else {
        document.querySelectorAll('.answer-input-num, .ip-octet-bin, .ip-octet-dec').forEach(inp => {
            inp.addEventListener('input', () => saveConversionProgress());
        });
    }
}


function saveProgress(index, value) {
    if (exerciseData[currentFile]) {
        if (exerciseData[currentFile].isLineOrdering) {
            // For line ordering, progress tracking happens via drag/drop
            return;
        } else {
            // Legacy: for fill-in-the-blank
            exerciseData[currentFile].userProgress[index] = value;
        }
    }
}

function setInputsDisabled(disabled) {
    const ex = exerciseData[currentFile];
    
    // Handle line ordering exercises
    if (ex && ex.isLineOrdering) {
        const draggableLines = document.querySelectorAll('.draggable-line');
        draggableLines.forEach(line => {
            line.draggable = !disabled;
            const jumpSelect = line.querySelector('.jump-to-select');
            if (jumpSelect) jumpSelect.disabled = disabled;
            if (disabled) {
                line.classList.add('locked');
                line.setAttribute('title', 'Locked');
            } else {
                line.classList.remove('locked');
                line.removeAttribute('title');
            }
        });
        refreshUpDownButtonStates(disabled);
    }

    // Handle binary/IP conversion questions
    if (ex && ex.isConversionQuestion) {
        document.querySelectorAll('.bitbox, .answer-input-num, .ip-octet-bin, .ip-octet-dec').forEach(inp => {
            inp.disabled = disabled;
            if (disabled) {
                inp.classList.add('locked');
                inp.setAttribute('title', 'Locked');
            } else {
                inp.classList.remove('locked');
                inp.removeAttribute('title');
            }
        });
        // Atom 1's answer mechanism is clicking bits, not typing into an
        // <input>, so it gets its own lock toggle (pointer-events, see CSS).
        document.querySelectorAll('.atom1-bitgrid').forEach(grid => {
            grid.classList.toggle('atom1-locked', disabled);
        });
    }
    
    // Legacy: handle fill-in-the-blank exercises
    const inputs = document.querySelectorAll('.code-input');
    inputs.forEach(input => {
        input.disabled = disabled;
        if (disabled) {
            input.classList.add('locked');
            input.setAttribute('title', 'Locked');
        } else {
            input.classList.remove('locked');
            input.removeAttribute('title');
        }
    });
    
    const editor = document.querySelector('.code-editor');
    if (editor) {
        if (disabled) editor.classList.add('locked'); 
        else editor.classList.remove('locked');
    }
}

function updateSidebarScore(file) {
    const safeId = file.replace(/\./g, '-');
    const scoreSpan = document.getElementById(`score-${safeId}`);
    const ex = exerciseData[file];
    if (!scoreSpan || !ex) return;
    scoreSpan.textContent = `${ex.score}/${ex.answers.length}`;
    
    // Remove all score classes first
    scoreSpan.classList.remove('completed-score', 'partial-score');
    
    // Add appropriate class based on score
    if (ex.score === ex.answers.length) {
        scoreSpan.classList.add('completed-score');  // 100% correct
    } else if (ex.score > 0) {
        scoreSpan.classList.add('partial-score');     // Partial correct
    }
    // If score is 0, keep default styling (unanswered)
}

function updateSummaryPanel() {
    let totalGot = 0;
    let totalPossible = 0;
    for (const file in exerciseData) {
        const ex = exerciseData[file];
        totalGot += Number(ex.score || 0);
        totalPossible += ex.answers.length;
    }
    document.getElementById('summaryValue').textContent = `${totalGot} / ${totalPossible}`;

    // Keep the sidebar QR code in sync with the running total so it always
    // reflects the student's current score, not just the score at the end.
    // Encryption is async, so this fires and updates the QR once ready.
    if (currentUser) {
        buildResultsShareUrl(totalGot, totalPossible).then(shareUrl => {
            renderQrInto('sidebarQrCodeBox', shareUrl, 110);
        });
    }
}

// --- SUBNET VISUALIZER (ungraded tool) — sidebar view toggle ---
// Swaps the main content column between the graded exercise view and the
// Subnetify panels. Lazily initializes the visualizer engine on first
// open (its DOM already exists, just hidden, so this only wires up event
// listeners + does the first render — see SubnetVisualizer.init's guard).
function showSubnetVisualizer() {
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    const navItem = document.getElementById('nav-subnetVisualizer');
    if (navItem) navItem.classList.add('active');

    document.getElementById('exerciseArea').style.display = 'none';
    document.getElementById('timerContainer').style.display = 'none';
    document.getElementById('atomPlaceholderView').style.display = 'none';
    document.getElementById('atom1View').style.display = 'none';
    document.getElementById('atom2View').style.display = 'none';
    document.getElementById('atom3View').style.display = 'none';
    document.getElementById('atom4View').style.display = 'none';
    document.getElementById('subnetVisualizerView').style.display = 'flex';

    hideAllAtomPaginationBars();

    currentFile = ''; // no graded exercise is "current" while the tool is open

    // The console drawer/output panel is exercise-specific (sample output
    // for a conversion question) and has no meaning here — close it so it
    // doesn't linger over the visualizer. currentFile is cleared first so
    // updateConsoleDrawerTab correctly finds no sample output to pull up.
    closeSampleOutputModal();
    updateConsoleDrawerTab(false);

    SubnetVisualizer.init();

    closeSidebarIfMobile();
}

// --- ATOM PAGES (ungraded, placeholder) — sidebar sub-navigation under Subnetify ---
// Swaps the main content column to a simple "coming soon" placeholder view.
// Mirrors showSubnetVisualizer's pattern (hide every other view, clear
// currentFile, close the console drawer) so the same page-switching rules
// apply uniformly once real content replaces this placeholder.
function showAtomPage(atomNumber) {
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    const navItem = document.getElementById(`nav-atom${atomNumber}`);
    if (navItem) navItem.classList.add('active');

    document.getElementById('exerciseArea').style.display = 'none';
    document.getElementById('timerContainer').style.display = 'none';
    document.getElementById('subnetVisualizerView').style.display = 'none';
    document.getElementById('atom1View').style.display = 'none';
    document.getElementById('atom2View').style.display = 'none';
    document.getElementById('atom3View').style.display = 'none';
    document.getElementById('atom4View').style.display = 'none';
    document.getElementById('atomPlaceholderView').style.display = 'block';
    document.getElementById('atomPlaceholderTitle').textContent = `Atom ${atomNumber}`;

    hideAllAtomPaginationBars();

    currentFile = ''; // no graded exercise is "current" while a placeholder page is open

    // Same reasoning as showSubnetVisualizer: the console drawer/output
    // panel is exercise-specific and has no meaning here.
    closeSampleOutputModal();
    updateConsoleDrawerTab(false);

    closeSidebarIfMobile();
}

function switchExercise(name, el) {
    currentFile = name;
    document.getElementById('subnetVisualizerView').style.display = 'none';
    document.getElementById('atomPlaceholderView').style.display = 'none';
    document.getElementById('atom1View').style.display = 'none';
    document.getElementById('atom2View').style.display = 'none';
    document.getElementById('atom3View').style.display = 'none';
    document.getElementById('atom4View').style.display = 'none';
    document.getElementById('exerciseArea').style.display = 'block';
    // The atom pagination bars are direct children of <main> now (real
    // block-level siblings of #contentScrollArea, not nested inside their
    // own atomXView — see index.html), so hiding an atomXView no longer
    // hides its bar "for free"; hide all four explicitly here too.
    hideAllAtomPaginationBars();
    // The visualizer hides the timer bar (it's exercise-specific chrome)
    // without stopping the underlying interval — re-show it here if an
    // exam timer is actually still running, rather than leaving it hidden
    // for the rest of the session.
    if (timerIntervalId) {
        document.getElementById('timerContainer').style.display = 'flex';
    }
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
    el.classList.add('active');
    
    document.getElementById('currentFileName').textContent = exerciseData[name].label || name;
    const display = document.getElementById('codeDisplay');
    display.innerHTML = exerciseData[name].html;

    // Handle line ordering exercises
    if (exerciseData[name].isLineOrdering) {
        setupDragAndDrop();
        setupJumpToUI(name);
        restoreUserOrder(name);
        setupUpDownButtons();
    } else if (exerciseData[name].isConversionQuestion) {
        attachConversionInputHandlers(exerciseData[name]);
        restoreConversionAnswer(exerciseData[name]);
    } else {
        // Legacy: fill-in-the-blank handling
        const inputs = display.querySelectorAll('.code-input');
        inputs.forEach((input, index) => {
            input.value = exerciseData[name].userProgress[index];
        });
    }

    // Restore disabled state and styles if previously verified (locked)
    const ex = exerciseData[name];
    if (ex.locked) {
        if (ex.isLineOrdering) {
            document.querySelectorAll('.draggable-line').forEach(draggableEl => {
                draggableEl.draggable = false;
                draggableEl.classList.add('locked');
                const jumpSelect = draggableEl.querySelector('.jump-to-select');
                if (jumpSelect) jumpSelect.disabled = true;
            });
            // Re-derive correct/incorrect styling from the (possibly
            // restored) line order, since the DOM was just rebuilt from
            // ex.html above and doesn't carry the classes over on its own.
            applyLineOrderingLockedStyling(ex);
        } else if (ex.isConversionQuestion) {
            const { allCorrect } = gradeConversionScore(ex, ex.userAnswer);
            const qCard = document.querySelector('.conversion-question');
            if (qCard) qCard.classList.add(allCorrect ? 'correct' : 'incorrect');
            applyOctetFeedback(ex); // Phase 3/4: re-color each octet on return visits
        } else {
            const inputs = display.querySelectorAll('.code-input');
            inputs.forEach((input, idx) => {
                const val = input.value.trim();
                if (ex.answers[idx].includes(val)) {
                    input.style.borderBottomColor = "var(--secondary)";
                } else {
                    input.style.borderBottomColor = "var(--error)";
                }
            });
        }
        setInputsDisabled(true);
        
        // Only allow reset in practice mode
        if (appSettings.mode === 'practice') {
            document.getElementById('actionButton').textContent = 'Reset';
        } else {
            document.getElementById('actionButton').textContent = 'Locked';
            document.getElementById('actionButton').disabled = true;
        }
    } else {
        // Editable
        setInputsDisabled(false);
        if (!ex.isLineOrdering && !ex.isConversionQuestion) {
            display.querySelectorAll('.code-input').forEach(i => i.style.borderBottomColor = 'var(--secondary)');
        }
        document.getElementById('actionButton').textContent = 'Verify Answer';
        document.getElementById('actionButton').disabled = false;
    }

    updateSidebarScore(name);
    updateSummaryPanel();

    // Show the persisted feedback if this question was already checked
    // (so switching away and back — including across an exam-mode
    // reload — doesn't lose it), otherwise fully clear both the text AND
    // the class. Clearing text alone previously left the colored
    // success/error/warning box styling behind on a blank feedback area.
    const feedbackEl = document.getElementById('feedback');
    if (ex.locked) {
        const feedback = buildFeedbackForExercise(ex);
        renderFeedback(feedbackEl, feedback);
        feedbackEl.className = feedback.cls;
    } else {
        feedbackEl.textContent = "";
        feedbackEl.className = "";
    }

    // Auto-show/hide the console panel per the global "Sample Output"
    // setting (Settings modal), which now applies uniformly across every
    // activity rather than being toggled per exercise. The drawer tab
    // (updated inside showSampleOutput/closeSampleOutputModal) remains
    // available for the student to manually pull the panel into view for
    // this activity regardless of the setting.
    applyAutoShowForCurrentExercise();
}

// Marks each draggable line in the current #orderingArea as correct/incorrect
// based on its DOM position vs. ex.validPositionsMap. Shared by checkAnswers
// (right after verifying) and by switchExercise (when redisplaying an
// already-locked exercise, e.g. after restoring a persisted exam session),
// so the green/red styling matches the stored result either way.
function applyLineOrderingLockedStyling(ex) {
    if (!ex || !ex.isLineOrdering) return [];
    const orderingArea = document.getElementById('orderingArea');
    if (!orderingArea) return [];

    const orderedLines = Array.from(orderingArea.querySelectorAll('.draggable-line'));
    const usedValidPositions = new Set();

    orderedLines.forEach((lineEl, idx) => {
        lineEl.classList.remove('correct', 'incorrect');
        const originalIdx = parseInt(lineEl.getAttribute('data-original-idx'));
        const validPositions = ex.validPositionsMap[originalIdx];

        let isCorrect = false;
        if (validPositions && validPositions.length === 1) {
            isCorrect = (originalIdx === idx);
        } else if (validPositions && validPositions.length > 1) {
            isCorrect = validPositions.includes(idx) && !usedValidPositions.has(idx);
            if (isCorrect) usedValidPositions.add(idx);
        }

        lineEl.classList.add(isCorrect ? 'correct' : 'incorrect');
    });

    return orderedLines;
}

// Determines whether a conversion question's stored answer represents no
// attempt at all (as opposed to an attempt that happens to be wrong). This
// matters because exam-time-expiry force-locks every exercise — including
// ones the student never opened or typed into — and without this check
// those would be graded/labeled the same as a genuine wrong attempt.
function isConversionAnswerEmpty(ex) {
    if (!ex || !ex.isConversionQuestion) return true;
    const ans = ex.userAnswer || '';
    if (ex.type === 'd2b') {
        // Untouched bit boxes are represented as '_' by
        // collectConversionAnswer, so all-underscore (or empty) means
        // nothing was typed.
        return ans.length === 0 || /^_+$/.test(ans);
    }
    if (ex.type === 'ip_d2b' || ex.type === 'ip_b2d' || ex.type === 'mask_d2b' || ex.type === 'mask_c2d') {
        return ans.split('.').every(part => part.trim() === '');
    }
    // b2d, class_cidr
    return ans.trim() === '';
}

// Builds the feedback message + CSS class for an exercise based on its
// current score/lock state. Shared by checkAnswers (right after verifying)
// and switchExercise (to restore the same feedback when the student
// navigates back to an already-checked question, instead of leaving it
// blank) — so the message is always consistent no matter how it's reached,
// and exam mode never reveals the correct answer either way.
function buildFeedbackForExercise(ex) {
    const totalLines = ex.answers.length;
    const score = ex.score || 0;
    const perfect = score === totalLines;

    if (perfect) {
        return {
            text: ex.isConversionQuestion ? "Correct!" : "Perfect! All lines in correct order!",
            icon: "fa-solid fa-sparkles",
            cls: "success show",
            perfect: true
        };
    }
    if (ex.isConversionQuestion) {
        // If time ran out (or the student otherwise never entered anything)
        // before this question was ever attempted, say so plainly instead
        // of "Not quite" — there was nothing to grade as wrong.
        if (score === 0 && isConversionAnswerEmpty(ex)) {
            return {
                text: "No answer submitted.",
                icon: null,
                cls: "error show",
                perfect: false
            };
        }
        // Neither mode reveals the correct value here: practice mode lets
        // the student reset and try again, and exam mode has no reset, so
        // showing it would double as an answer key mid-exam.
        if (totalLines > 1) {
            // Octet-scored (Phase 3 · IP Dec→Bin / Phase 4 · IP Bin→Dec) or
            // item-scored (Atom 3: boundary + mask + each subnet row):
            // partial credit is possible either way, so surface how many
            // were right rather than a flat "not quite".
            const unit = ex.type === 'atom3' ? 'items' : 'octets';
            return {
                text: (appSettings.mode === 'practice')
                    ? `${score}/${totalLines} ${unit} correct — try again.`
                    : `${score}/${totalLines} ${unit} correct.`,
                icon: null,
                cls: score > 0 ? "warning show" : "error show",
                perfect: false
            };
        }
        return {
            text: "Not quite" + (appSettings.mode === 'practice' ? " — try again." : "."),
            icon: null,
            cls: "error show",
            perfect: false
        };
    }
    return {
        text: `Progress: ${score}/${totalLines} correct.`,
        icon: null,
        cls: "warning show",
        perfect: false
    };
}

// Renders a buildFeedbackForExercise() result into a target element as
// FontAwesome icon + text (when an icon is present) or plain text
// otherwise. Centralized here so every call site renders feedback the
// same way instead of duplicating the innerHTML-vs-textContent choice.
function renderFeedback(targetEl, feedback) {
    if (feedback.icon) {
        targetEl.innerHTML = `<i class="${feedback.icon}" aria-hidden="true"></i> ${feedback.text}`;
    } else {
        targetEl.textContent = feedback.text;
    }
}

function checkAnswers() {
    if (!currentFile) return;
    const ex = exerciseData[currentFile];
    let score = 0;

    if (ex.isLineOrdering) {
        // Save user's ordering before verification
        const orderingArea = document.getElementById('orderingArea');
        const orderedLinesBefore = Array.from(orderingArea.querySelectorAll('.draggable-line'));
        ex.userOrder = orderedLinesBefore.map(el => parseInt(el.getAttribute('data-original-idx')));

        // Verify line ordering (with semantic equivalence for identical
        // lines) and apply correct/incorrect styling in one pass.
        const orderedLines = applyLineOrderingLockedStyling(ex);
        score = orderedLines.filter(el => el.classList.contains('correct')).length;
    } else if (ex.isConversionQuestion) {
        ex.userAnswer = collectConversionAnswer(ex);
        const { score: earnedScore, allCorrect } = gradeConversionScore(ex, ex.userAnswer);
        score = earnedScore;
        const qCard = document.querySelector('.conversion-question');
        if (qCard) qCard.classList.add(allCorrect ? 'correct' : 'incorrect');
        applyOctetFeedback(ex); // Phase 3/4: color each octet individually
    } else {
        // Legacy: fill-in-the-blank verification
        const inputs = document.querySelectorAll('.code-input');
        const correctArr = ex.answers;

        inputs.forEach((input, index) => {
            const val = input.value.trim();
            if (correctArr[index].includes(val)) {
                input.style.borderBottomColor = "var(--secondary)";
                score++;
            } else {
                input.style.borderBottomColor = "var(--error)";
            }
        });
    }

    // Lock inputs and mark exercise locked
    setInputsDisabled(true);
    ex.score = score;
    ex.locked = true;
    
    const totalLines = ex.answers.length;
    ex.isPartial = score > 0 && score < totalLines;

    // Update Sidebar Score
    updateSidebarScore(currentFile);
    updateSummaryPanel();

    const msg = document.getElementById('feedback');
    const feedback = buildFeedbackForExercise(ex);
    renderFeedback(msg, feedback);
    msg.className = feedback.cls;
    if (feedback.perfect) {
        // Bigger & longer confetti
        triggerBigConfetti();
    }

    // Change action button based on mode
    const actionBtn = document.getElementById('actionButton');
    if (appSettings.mode === 'exam') {
        actionBtn.textContent = 'Locked';
        actionBtn.disabled = true;

        // Persist this student's progress so it survives a reload.
        saveExamSession();

        // Check if all exercises have been answered in exam mode
        if (checkIfAllAnswered()) {
            // Stop timer early and show score summary
            stopTimer();
            setTimeout(() => {
                showScoreSummaryModal('Congratulations! All exercises completed before time ran out!', 'success');
            }, 500);
        }
    } else {
        actionBtn.textContent = 'Reset';
    }
}

function resetCurrentExercise() {
    if (!currentFile) return;
    
    // Prevent reset in exam mode
    if (appSettings.mode === 'exam') {
        showAlertModal('Reset Not Allowed', 'Reset is not allowed in Exam Mode.');
        return;
    }
    
    const ex = exerciseData[currentFile];
    
    if (ex.isLineOrdering) {
        ex.userOrder = [];
        const orderingArea = document.getElementById('orderingArea');
        
        // Reshuffle the lines back to their original shuffled positions
        const shuffledLines = ex.shuffledIndices.map(origIdx => {
            const draggableEl = orderingArea.querySelector(`[data-original-idx="${origIdx}"]`);
            return draggableEl;
        });
        
        // Sort by current position in shuffled order and re-render
        shuffledLines.forEach((el, idx) => {
            if (el) {
                orderingArea.appendChild(el);
                el.classList.remove('correct', 'incorrect');
            }
        });
        setupDragAndDrop();
        setupJumpToUI(currentFile);
        setupUpDownButtons();
    } else if (ex.isConversionQuestion) {
        ex.userAnswer = '';
        document.querySelectorAll('.bitbox').forEach(b => {
            b.value = '';
            b.classList.remove('on', 'off');
        });
        document.querySelectorAll('.answer-input-num, .ip-octet-bin, .ip-octet-dec').forEach(i => i.value = '');
        const qCard = document.querySelector('.conversion-question');
        if (qCard) qCard.classList.remove('correct', 'incorrect');
        clearOctetFeedback(); // Phase 3/4: remove leftover per-octet coloring from the prior attempt
        if (ex.type === 'atom1') {
            updateAtom1Grid(currentFile, ex, 0);
        }
    } else {
        // Legacy: fill-in-the-blank reset
        ex.userProgress = ex.userProgress.map(() => "");
        const display = document.getElementById('codeDisplay');
        const inputs = display.querySelectorAll('.code-input');
        inputs.forEach((input) => {
            input.value = '';
            input.style.borderBottomColor = 'var(--secondary)';
        });
    }
    
    ex.score = 0;
    ex.locked = false;
    setInputsDisabled(false);

    // Update sidebar and summary
    updateSidebarScore(currentFile);
    updateSummaryPanel();

    // Reset feedback and action button
    const feedbackEl = document.getElementById('feedback');
    feedbackEl.textContent = '';
    feedbackEl.className = '';
    document.getElementById('actionButton').textContent = 'Verify Answer';
}

function triggerConfetti() {
    confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6200ee', '#03dac6', '#ffca28']
    });
}

function triggerBigConfetti() {
    // Burst multiple waves for a bigger, longer celebration
    const colors = ['#6200ee', '#03dac6', '#ffca28', '#ff4081', '#00bcd4'];
    const bursts = [
        { particleCount: 300, spread: 120, startVelocity: 40 },
        { particleCount: 200, spread: 140, startVelocity: 30 },
        { particleCount: 150, spread: 160, startVelocity: 20 }
    ];

    let delay = 0;
    bursts.forEach(b => {
        setTimeout(() => {
            confetti(Object.assign({}, b, { origin: { y: 0.6 }, colors }));
        }, delay);
        delay += 500; // space the bursts
    });
}
function exportProgress() {
    let csv = "Student,Exercise,Score\n";
    for (const file in exerciseData) {
        const ex = exerciseData[file];
        const label = (ex.label || file).replace(/"/g, '""');
        csv += `${currentUser},"${label}",${ex.score || 0}/${ex.answers.length}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentUser}_results.csv`;
    a.click();
}

// --- SETTINGS AND MODE MANAGEMENT ---
function openSettingsModal() {
    document.getElementById('settingsModal').style.display = 'block';
    document.getElementById('settingsOverlay').style.display = 'block';
    
    // Set current settings in the modal
    document.querySelector(`input[name="mode"][value="${appSettings.mode}"]`).checked = true;
    document.getElementById('timerInput').value = appSettings.timerMinutes;

    const autoShowToggle = document.getElementById('autoShowSampleToggle');
    if (autoShowToggle) {
        autoShowToggle.checked = appSettings.autoShowSample;
    }

    const practiceSeedInput = document.querySelector(`input[name="practiceSeedMode"][value="${appSettings.practiceQuestionMode}"]`);
    if (practiceSeedInput) practiceSeedInput.checked = true;
    
    // Show/hide timer section (exam only) and practice seed section
    // (practice only) based on mode — the two are mutually exclusive.
    const timerSection = document.getElementById('timerSection');
    const practiceSeedSection = document.getElementById('practiceSeedSection');
    if (appSettings.mode === 'exam') {
        timerSection.style.display = 'block';
        if (practiceSeedSection) practiceSeedSection.style.display = 'none';
    } else {
        timerSection.style.display = 'none';
        if (practiceSeedSection) practiceSeedSection.style.display = 'block';
    }
}

function closeSettingsModal() {
    document.getElementById('settingsModal').style.display = 'none';
    document.getElementById('settingsOverlay').style.display = 'none';
}

function handleModeChange() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    const timerSection = document.getElementById('timerSection');
    const practiceSeedSection = document.getElementById('practiceSeedSection');
    
    if (selectedMode === 'exam') {
        timerSection.style.display = 'block';
        if (practiceSeedSection) practiceSeedSection.style.display = 'none';
    } else {
        timerSection.style.display = 'none';
        if (practiceSeedSection) practiceSeedSection.style.display = 'block';
    }
}

function validateTimerInput(input) {
    let value = parseInt(input.value, 10);
    
    if (isNaN(value)) {
        input.classList.add('invalid');
        return false;
    }
    
    if (value < 1) {
        input.value = '1';
        input.classList.remove('invalid');
    } else if (value > 999) {
        input.value = '999';
        input.classList.remove('invalid');
    } else {
        input.classList.remove('invalid');
    }
    
    return true;
}

function saveSettings() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    const timerInput = document.getElementById('timerInput');
    const timerValue = parseInt(timerInput.value, 10);
    
    // Validate timer input
    if (selectedMode === 'exam') {
        if (isNaN(timerValue) || timerValue < 1 || timerValue > 999) {
            alert('Please enter a valid timer value between 1 and 999 minutes.');
            return;
        }
        appSettings.timerMinutes = timerValue;
    }
    
    appSettings.mode = selectedMode;

    const autoShowToggle = document.getElementById('autoShowSampleToggle');
    if (autoShowToggle) {
        appSettings.autoShowSample = autoShowToggle.checked;
    }

    const practiceSeedInput = document.querySelector('input[name="practiceSeedMode"]:checked');
    if (practiceSeedInput) {
        const previousPracticeQuestionMode = appSettings.practiceQuestionMode;
        appSettings.practiceQuestionMode = practiceSeedInput.value;
        // Clear any already-generated random seed whenever the setting
        // changes, so the next login/session generates a genuinely fresh
        // one rather than reusing whatever was current before the switch
        // (relevant mainly if this setting is ever changed mid-session in
        // the future; currently Settings is only reachable pre-login).
        if (previousPracticeQuestionMode !== appSettings.practiceQuestionMode) {
            currentPracticeSeed = null;
        }
    }

    closeSettingsModal();

    // Re-apply the (possibly just-changed) auto-show preference to
    // whatever exercise is currently open, so the console panel reacts
    // immediately rather than waiting for the next exercise switch.
    applyAutoShowForCurrentExercise();
    
    // Show toast notification
    showNotification(`Settings saved! Mode: ${selectedMode === 'exam' ? 'Exam (' + timerValue + ' min)' : 'Practice'}`);
}

function showNotification(message) {
    // Create a temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--primary);
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 2001;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// --- EXAM SESSION PERSISTENCE (keyed by student email) ---
// Exam mode only: keeps each student's in-progress or completed exam
// (locked/unlocked state, score, and line order per exercise, plus the
// real timer deadline) in localStorage so a page reload, browser crash,
// or accidental tab close doesn't cost them their progress or hand them
// a brand-new full-length timer. Practice mode is intentionally not
// persisted — there's nothing at stake in a reset there.
function getExamStorageKey(email) {
    return `examSession_${email}`;
}

function saveExamSession() {
    if (appSettings.mode !== 'exam' || !currentUser) return;

    const exercises = {};
    for (const file in exerciseData) {
        const ex = exerciseData[file];
        exercises[file] = {
            locked: !!ex.locked,
            score: ex.score || 0,
            isPartial: !!ex.isPartial,
            userOrder: ex.isLineOrdering ? (ex.userOrder || []) : undefined,
            userAnswer: ex.isConversionQuestion ? (ex.userAnswer || '') : undefined
        };
    }

    const isTimeUp = typeof examEndTimestamp === 'number' && Date.now() >= examEndTimestamp;

    const session = {
        timerMinutes: appSettings.timerMinutes,
        examEndTimestamp: examEndTimestamp,
        completed: checkIfAllAnswered() || isTimeUp,
        exercises,
        savedAt: Date.now()
    };

    try {
        localStorage.setItem(getExamStorageKey(currentUser), JSON.stringify(session));
    } catch (e) {
        console.warn('Could not save exam session progress:', e);
    }
}

function loadExamSession(email) {
    try {
        const raw = localStorage.getItem(getExamStorageKey(email));
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.warn('Could not load exam session progress:', e);
        return null;
    }
}

// Timer Management
// resumeSeconds, when provided, resumes a persisted exam session at the
// real remaining time (e.g. after a page reload) instead of granting a
// fresh full-length timer.
function startTimer(resumeSeconds) {
    if (appSettings.mode !== 'exam') {
        return;
    }

    if (typeof resumeSeconds === 'number' && resumeSeconds >= 0) {
        timeRemaining = resumeSeconds;
        examEndTimestamp = Date.now() + timeRemaining * 1000;
    } else {
        timeRemaining = appSettings.timerMinutes * 60; // Convert to seconds
        examEndTimestamp = Date.now() + timeRemaining * 1000;
    }

    const timerContainer = document.getElementById('timerContainer');
    timerContainer.style.display = 'flex';

    updateTimerDisplay();
    saveExamSession(); // persist the deadline right away, before any answers are checked

    let tickCount = 0;
    timerIntervalId = setInterval(() => {
        // Recompute from the fixed deadline each tick (rather than just
        // decrementing) so setInterval drift can't desync the displayed
        // time — or a persisted deadline — from the real cutoff.
        timeRemaining = Math.max(0, Math.round((examEndTimestamp - Date.now()) / 1000));
        updateTimerDisplay();

        // Throttle persistence to avoid writing to storage every second.
        tickCount++;
        if (tickCount % 5 === 0) {
            saveExamSession();
        }

        if (timeRemaining <= 0) {
            clearInterval(timerIntervalId);
            handleTimerExpired();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('timerDisplay').textContent = display;
    
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.classList.remove('warning', 'critical');
    
    if (timeRemaining <= 60) {
        timerDisplay.classList.add('critical');
    } else if (timeRemaining <= 300) {
        timerDisplay.classList.add('warning');
    }
}

function stopTimer() {
    if (timerIntervalId) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
    }
    const timerContainer = document.getElementById('timerContainer');
    timerContainer.style.display = 'none';
}

function handleTimerExpired() {
    stopTimer();
    
    // Lock all exercises
    for (const file in exerciseData) {
        if (!exerciseData[file].locked) {
            exerciseData[file].locked = true;
        }
    }
    setInputsDisabled(true);
    document.getElementById('actionButton').disabled = true;

    // Persist the final, fully-locked state for this student.
    saveExamSession();

    // Show score summary modal
    showScoreSummaryModal('Time is up! Your exam session has ended.', 'warning');
}

// --- DRAG AND DROP LINE ORDERING ---
function setupDragAndDrop() {
    const orderingArea = document.getElementById('orderingArea');
    
    if (!orderingArea) return;
    
    // Attach listeners to all draggable lines
    const draggableLines = orderingArea.querySelectorAll('.draggable-line');
    draggableLines.forEach(line => attachDragListeners(line));
    
    // Setup drop zone for the single ordering area
    setupDropZone(orderingArea);
}

function attachDragListeners(element) {
    element.addEventListener('dragstart', handleDragStart);
    element.addEventListener('dragend', handleDragEnd);
}

function handleDragStart(e) {
    if (exerciseData[currentFile]?.locked) {
        e.preventDefault();
        return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
    draggedElement = this;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    // Remove any drop placeholder when dragging ends
    document.querySelectorAll('.drop-placeholder').forEach(p => p.remove());
}

function setupDropZone(zone) {
    if (!zone) return;

    // Create a single placeholder element used during drag to indicate insertion point
    const placeholder = document.createElement('div');
    placeholder.className = 'drop-placeholder';

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');

        // Determine nearest element to insert before based on mouse Y
        const afterElement = getDragAfterElement(zone, e.clientY);

        if (!afterElement) {
            // Append to end
            if (zone.lastElementChild !== placeholder) zone.appendChild(placeholder);
        } else {
            if (afterElement !== placeholder) zone.insertBefore(placeholder, afterElement);
        }
    });

    zone.addEventListener('dragleave', (e) => {
        // If leaving the zone entirely, remove visual hints
        const related = e.relatedTarget;
        if (!related || !zone.contains(related)) {
            zone.classList.remove('drag-over');
            placeholder.remove();
        }
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');

        if (exerciseData[currentFile]?.locked || !draggedElement) return;

        // Insert dragged element at placeholder position if present
        const ph = zone.querySelector('.drop-placeholder');
        if (ph) {
            zone.insertBefore(draggedElement, ph);
            ph.remove();
        } else {
            zone.appendChild(draggedElement);
        }
    });
}

// Helper: returns the first element that the dragged item should be placed before
function getDragAfterElement(container, y) {
    const draggableLines = [...container.querySelectorAll('.draggable-line:not(.dragging)')];

    return draggableLines.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > (closest.offset || Number.NEGATIVE_INFINITY)) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element || null;
}

function restoreUserOrder(fileName) {
    const ex = exerciseData[fileName];
    if (!ex.isLineOrdering || ex.userOrder.length === 0) return;
    
    const orderingArea = document.getElementById('orderingArea');
    if (!orderingArea) return;
    
    // Reorder lines based on saved userOrder
    ex.userOrder.forEach(origIdx => {
        const draggableEl = orderingArea.querySelector(`[data-original-idx="${origIdx}"]`);
        if (draggableEl) {
            orderingArea.appendChild(draggableEl);
        }
    });
}

let draggedElement = null;

// --- UP/DOWN BUTTONS (touch-friendly alternative to drag-and-drop) ---
function setupUpDownButtons() {
    const orderingArea = document.getElementById('orderingArea');
    if (!orderingArea) return;

    const draggableLines = orderingArea.querySelectorAll('.draggable-line');

    draggableLines.forEach(lineEl => {
        const upBtn = lineEl.querySelector('.move-up-btn');
        const downBtn = lineEl.querySelector('.move-down-btn');
        if (!upBtn || !downBtn) return;

        // Avoid stacking duplicate listeners if this is called more than once
        upBtn.replaceWith(upBtn.cloneNode(true));
        downBtn.replaceWith(downBtn.cloneNode(true));
    });

    // Re-query after cloning, then attach fresh listeners
    orderingArea.querySelectorAll('.move-up-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            moveLineByOffset(btn.closest('.draggable-line'), -1);
        });
    });
    orderingArea.querySelectorAll('.move-down-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            moveLineByOffset(btn.closest('.draggable-line'), 1);
        });
    });

    refreshUpDownButtonStates();
}

function moveLineByOffset(lineEl, offset) {
    if (!lineEl || exerciseData[currentFile]?.locked) return;

    const orderingArea = document.getElementById('orderingArea');
    const allLines = Array.from(orderingArea.querySelectorAll('.draggable-line'));
    const currentIdx = allLines.indexOf(lineEl);
    const targetIdx = currentIdx + offset;

    if (targetIdx < 0 || targetIdx >= allLines.length) return; // out of bounds

    const targetEl = allLines[targetIdx];

    // Capture each affected row's position before the DOM move (FLIP: First)
    const movedFirstRect = lineEl.getBoundingClientRect();
    const targetFirstRect = targetEl.getBoundingClientRect();

    if (offset < 0) {
        orderingArea.insertBefore(lineEl, allLines[targetIdx]);
    } else {
        orderingArea.insertBefore(lineEl, targetEl.nextSibling);
    }

    // Animate both the moved row and the row it displaced sliding into place
    animateRowSwap(lineEl, movedFirstRect);
    animateRowSwap(targetEl, targetFirstRect);

    refreshUpDownButtonStates();
}

// Slides an element from its previous position (firstRect) to wherever it
// now sits in the DOM (Last), using the FLIP technique: Invert the visual
// position with a transform, then Play by transitioning that transform away.
function animateRowSwap(el, firstRect) {
    const lastRect = el.getBoundingClientRect();
    const deltaY = firstRect.top - lastRect.top;

    if (!deltaY) return; // already in place, nothing to animate

    el.style.transition = 'none';
    el.style.transform = `translateY(${deltaY}px)`;
    el.style.zIndex = '5';
    el.classList.add('swapping');

    // Wait a frame so the browser paints the inverted position before we
    // transition it away, otherwise the transform jump itself would animate.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
            el.style.transform = '';
        });
    });

    const cleanup = () => {
        el.style.transition = '';
        el.style.zIndex = '';
        el.classList.remove('swapping');
        el.removeEventListener('transitionend', cleanup);
    };
    el.addEventListener('transitionend', cleanup);
}

// Disable Up on the first line and Down on the last line.
// forceLocked lets callers (like setInputsDisabled) specify the lock state
// directly, since ex.locked isn't always updated yet at call time.
function refreshUpDownButtonStates(forceLocked) {
    const orderingArea = document.getElementById('orderingArea');
    if (!orderingArea) return;

    const allLines = Array.from(orderingArea.querySelectorAll('.draggable-line'));
    const locked = forceLocked !== undefined ? forceLocked : exerciseData[currentFile]?.locked;

    allLines.forEach((lineEl, idx) => {
        const upBtn = lineEl.querySelector('.move-up-btn');
        const downBtn = lineEl.querySelector('.move-down-btn');
        if (upBtn) upBtn.disabled = locked || idx === 0;
        if (downBtn) downBtn.disabled = locked || idx === allLines.length - 1;
    });
}

// --- JUMP-TO POSITIONING UI ---
function setupJumpToUI(fileName) {
    const orderingArea = document.getElementById('orderingArea');
    if (!orderingArea) return;

    const draggableLines = orderingArea.querySelectorAll('.draggable-line');
    const totalLines = draggableLines.length;

    draggableLines.forEach(draggableEl => {
        // Remove old dropdown if exists
        const oldDropdown = draggableEl.querySelector('.jump-to-container');
        if (oldDropdown) oldDropdown.remove();

        // Create jump-to dropdown container
        const jumpToDiv = document.createElement('div');
        jumpToDiv.className = 'jump-to-container';
        
        // Build options for all available line positions
        let optionsHtml = '<option value="">Jump to →</option>';
        for (let i = 1; i <= totalLines; i++) {
            optionsHtml += `<option value="${i - 1}">Line ${i}</option>`;
        }
        
        jumpToDiv.innerHTML = `<select class="jump-to-select">${optionsHtml}</select>`;
        
        // Add change handler
        jumpToDiv.querySelector('.jump-to-select').addEventListener('change', (e) => {
            if (e.target.value === '') return;
            const targetIdx = parseInt(e.target.value);
            moveLineToPosition(orderingArea, draggableEl, targetIdx);
            e.target.value = ''; // Reset dropdown
        });

        draggableEl.appendChild(jumpToDiv);
    });
}

function moveLineToPosition(container, draggableElement, targetIdx) {
    if (exerciseData[currentFile]?.locked) return;

    const allDraggableLines = Array.from(container.querySelectorAll('.draggable-line'));
    const currentIdx = allDraggableLines.indexOf(draggableElement);

    if (currentIdx === targetIdx) return; // Already at target

    // Remove from current position
    container.removeChild(draggableElement);

    // Insert at target position
    if (targetIdx >= allDraggableLines.length - 1) {
        container.appendChild(draggableElement);
    } else {
        const targetElement = allDraggableLines[targetIdx];
        container.insertBefore(draggableElement, targetElement);
    }

    refreshUpDownButtonStates();
}

// --- ALERT AND SCORE SUMMARY MODALS ---
function showAlertModal(title, message) {
    document.getElementById('alertTitle').textContent = title;
    document.getElementById('alertMessage').textContent = message;
    document.getElementById('alertModal').style.display = 'block';
    document.getElementById('alertOverlay').style.display = 'block';
}

function closeAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
    document.getElementById('alertOverlay').style.display = 'none';
}

// --- SAMPLE OUTPUT CONSOLE PANEL (slides in from the right) ---
function showSampleOutput(fileName) {
    const ex = exerciseData[fileName];
    const panel = document.getElementById('sampleOutputPanel');
    const overlay = document.getElementById('sampleOutputOverlay');
    const content = document.getElementById('sampleOutputContent');
    if (!ex || !panel || !overlay || !content) return;

    content.textContent = ex.sampleOutput && ex.sampleOutput.length ? ex.sampleOutput : 'No sample output available.';

    overlay.style.display = 'block';
    panel.setAttribute('aria-hidden', 'false');
    overlay.setAttribute('aria-hidden', 'false');
    updateConsoleDrawerTab(true);
    // Force the transform to its initial state before adding .open so the
    // slide-in transition actually plays (rather than snapping into place)
    // even if the panel was just re-shown right after being closed.
    requestAnimationFrame(() => {
        panel.classList.add('open');
    });
}

function closeSampleOutputModal() {
    const panel = document.getElementById('sampleOutputPanel');
    const overlay = document.getElementById('sampleOutputOverlay');
    if (!panel) return;

    const wasOpen = panel.classList.contains('open');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    updateConsoleDrawerTab(false);

    if (overlay) {
        overlay.setAttribute('aria-hidden', 'true');
        if (wasOpen) {
            // Wait for the slide-out transition to finish before hiding the
            // overlay, otherwise it disappears abruptly mid-animation.
            const onTransitionEnd = () => {
                overlay.style.display = 'none';
                panel.removeEventListener('transitionend', onTransitionEnd);
            };
            panel.addEventListener('transitionend', onTransitionEnd);
        } else {
            // Nothing was actually open, so there's no transition to wait
            // for — hide the overlay immediately instead of leaving a
            // transitionend listener that would never fire.
            overlay.style.display = 'none';
        }
    }
}

// --- CONSOLE DRAWER TAB ---
// A per-activity handle, always available (when the current exercise has
// sample output) for pulling the console into view by hand, independent of
// the global auto-show setting.
function toggleConsolePanel() {
    const panel = document.getElementById('sampleOutputPanel');
    if (!panel || !currentFile) return;
    if (panel.classList.contains('open')) {
        closeSampleOutputModal();
    } else {
        showSampleOutput(currentFile);
    }
}

function updateConsoleDrawerTab(forceOpen) {
    const tab = document.getElementById('consoleDrawerTab');
    const panel = document.getElementById('sampleOutputPanel');
    if (!tab || !panel) return;

    const ex = exerciseData[currentFile];
    const hasSampleOutput = !!(ex && ex.sampleOutput && ex.sampleOutput.trim().length > 0);
    const isOpen = forceOpen !== undefined ? forceOpen : panel.classList.contains('open');

    tab.style.display = (hasSampleOutput && !isOpen) ? 'flex' : 'none';
    tab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function getCleanSourceUrl() {
    // Full source URL — host and path — with the query string/hash AND
    // the protocol stripped off. The protocol isn't needed: results.html
    // already strips "https://" before displaying it, and every "/" or
    // ":" left in a URL param gets percent-encoded to 3 characters
    // (e.g. "/" -> "%2F"), which is the single biggest thing bloating
    // the QR's data length. Dropping "https://" alone removes 8 raw
    // characters (and avoids encoding its ":" and "//").
    return window.location.href.split(/[?#]/)[0].replace(/^https?:\/\//i, '');
}

function getActivityName() {
    // The web app's own page title, used as the "activity name" field.
    return document.title;
}

// --- QR PAYLOAD ENCRYPTION ---
// Runs entirely in the browser, so this passphrase is visible to anyone
// who reads this file — it is NOT a security boundary. It only keeps the
// score/email/timestamp out of the *plain* QR payload/URL so a casual
// scan or glance at the address bar doesn't show readable data. This
// passphrase MUST exactly match the one in results.html.
const QR_SHARED_PASSPHRASE = 'AA-9002341ds2sd14-dsfs12sd-54231hg';
const QR_SALT_STRING = 'java-activity-qr-salt-v1';

async function deriveQrKey() {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(QR_SHARED_PASSPHRASE),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: enc.encode(QR_SALT_STRING),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function encryptQrPayload(dataObj) {
    const key = await deriveQrKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const plaintext = enc.encode(JSON.stringify(dataObj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    // Pack iv + ciphertext into a single token so results.html only needs
    // one query parameter to decrypt.
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bufferToBase64Url(combined);
}

async function buildResultsShareUrl(rawScore, maxScore) {
    // Keep the ENCRYPTED payload as short as possible: short keys only,
    // no domain name inside it (see note below on why the domain travels
    // separately). A shorter encrypted payload lets the QR library pick
    // a lower "version," meaning fewer total modules (squares) — each
    // one rendered bigger and easier for a phone camera to resolve.
    const payload = {
        e: currentUser,
        t: Math.floor(Date.now() / 1000), // unix seconds, shorter than ISO string
        s: rawScore,
        m: maxScore
    };

    const token = await encryptQrPayload(payload);
    const url = new URL('https://mratamayo-tsatinc.github.io/qr/it5b-w4.html');
    url.searchParams.set('d', token);
    url.searchParams.set('a', getCleanSourceUrl());
    url.searchParams.set('n', getActivityName());
    return url.toString();
}

function renderResultsQrCode(shareUrl) {
    // Bigger box for the same module count = each square renders larger
    // and more visible, on top of the data-shrinking above.
    renderQrInto('qrCodeBox', shareUrl, 260);
    renderQrInto('sidebarQrCodeBox', shareUrl, 170);
}

function renderQrInto(boxId, shareUrl, size) {
    const box = document.getElementById(boxId);
    if (!box || typeof QRCode === 'undefined') return;
    box.innerHTML = ''; // clear any previously rendered code first
    new QRCode(box, {
        text: shareUrl,
        width: size,
        height: size,
        colorDark: '#1a1a1a',
        colorLight: '#ffffff',
        // L = lowest error correction (~7% recoverable). Combined with a
        // short payload, this keeps the QR at a low "version" — fewer
        // total modules (squares), each rendered bigger at the same box
        // size, which is what actually makes a phone camera able to
        // resolve it. (More error correction sounds safer but backfires:
        // it adds redundancy bytes, which forces MORE modules for the
        // same data, making each one smaller.)
        correctLevel: QRCode.CorrectLevel.L
    });
}

function calculateTotalScore() {
    let totalGot = 0;
    let totalPossible = 0;
    for (const file in exerciseData) {
        const ex = exerciseData[file];
        totalGot += Number(ex.score || 0);
        totalPossible += ex.answers.length;
    }
    return { got: totalGot, possible: totalPossible };
}

async function showScoreSummaryModal(completionMessage, messageType = 'success') {
    const { got, possible } = calculateTotalScore();
    
    document.getElementById('finalScore').textContent = got;
    document.getElementById('maxScore').textContent = possible;
    document.getElementById('summaryEmail').textContent = currentUser;
    
    const messageElement = document.getElementById('completionMessage');
    messageElement.textContent = completionMessage;
    messageElement.className = `completion-message ${messageType}`;

    const shareUrl = await buildResultsShareUrl(got, possible);
    renderResultsQrCode(shareUrl);
    
    document.getElementById('scoreSummaryModal').style.display = 'block';
    document.getElementById('scoreSummaryOverlay').style.display = 'block';
}

function closeSummaryModal() {
    document.getElementById('scoreSummaryModal').style.display = 'none';
    document.getElementById('scoreSummaryOverlay').style.display = 'none';
}

// Check if all exercises have been answered
function checkIfAllAnswered() {
    for (const file in exerciseData) {
        const ex = exerciseData[file];
        if (!ex.locked || ex.score === 0) {
            return false;
        }
    }
    return true;
}

/* ============================================================
   SUBNET VISUALIZER ENGINE — ported from Subnetify (app.js)
   Wrapped in an IIFE and exposed as window.SubnetVisualizer so its
   internal names (state, el, render, WEIGHTS, ...) never touch the
   global scope this file's own quiz-engine code runs in.
   ============================================================ */
const SubnetVisualizer = (function () {
'use strict';

let _initialized = false;

/* ============================================================
   SUBNETIFY — deterministic CIDR / subnetting engine
   No external IP math libraries. All arithmetic uses explicit
   spatial bit weights: 128, 64, 32, 16, 8, 4, 2, 1
   ============================================================ */

const WEIGHTS = [128, 64, 32, 16, 8, 4, 2, 1];

/* Renders the 128/64/32/16/8/4/2/1 header row for a single octet's worth of
   bits (8 values). Each weight number is "lit" when its corresponding bit
   is 1, and "muted" when the bit is 0 — reinforcing how the active weights
   sum to the decimal value. variantClass controls sizing (see CSS).
   kindsSlice (optional) is an array of 8 strings — 'locked' | 'borrowed' |
   'host' — so a lit weight picks up the SAME semantic color as its bit
   (blue / amber / green) instead of a single flat "active" color. This
   keeps host-side weights in Panel 5 visually distinct from subnet-side
   weights in Panel 4, matching the bit coloring itself. */
function buildWeightRowHtml(bitsSlice, variantClass, kindsSlice, weightsArr) {
  const weights = weightsArr || WEIGHTS;
  const n = bitsSlice.length;
  let html = '<div class="weight-row ' + variantClass + '">';
  for (let k = 0; k < n; k++) {
    const lit = bitsSlice[k] === 1;
    let cls = 'weight-num';
    if (lit) {
      const kind = kindsSlice ? kindsSlice[k] : null;
      cls += ' weight-lit' + (kind ? ' weight-lit-' + kind : '');
    } else {
      cls += ' weight-muted';
    }
    html += '<span class="' + cls + '">' + weights[k] + '</span>';
  }
  html += '</div>';
  return html;
}

/* Renders the decimal total that the octet's active weights sum to (the
   same value bitsToOctet would compute). Sits above the weight row so the
   summation reads top-down: "here's the answer" -> "here's the math" ->
   "here's the binary". Deliberately styled with NO locked/borrowed/host
   coloring — in decimal form (e.g. 192.168.1.0) there is no visual cue for
   which bits were network vs. host, and the total should reflect that same
   truth rather than borrowing the bit-level color language. appendDot, when
   true, suffixes a "." so that reading only the total badges left-to-right
   across an octet's siblings reconstructs the ordinary dotted-decimal IP
   notation that the rest of the visualization deliberately breaks apart. */
function buildOctetTotalHtml(bitsSlice, variantClass, appendDot) {
  const total = bitsToOctet(bitsSlice);
  const dot = appendDot ? '<span class="octet-total-dot">.</span>' : '';
  return '<div class="octet-total ' + variantClass + '">' + total + dot + '</div>';
}

/* ---------------- Global State (single source of truth) ---------------- */
const state = {
  octets: [192, 168, 1, 0],
  borrowedBits: 0,
  activeSubnetIndex: 0,
  subnetsExpanded: false,
  hostsExpanded: false,
  presenterMode: false,
  subnetFormulaVisible: false,
  hostFormulaVisible: false,
  compareExpanded: false,
  // 'viz' = bit-level octet visualization, 'decimal' = plain dotted-decimal.
  // Each panel key is either 'global' (defer to viewMode.global) or an
  // explicit override of its own.
  viewMode: {
    global: 'viz',
    panel2: 'global',
    panel3: 'global',
    panel4: 'global',
    panel5: 'global',
  },
};

/* Resolves a panel's effective display mode, following 'global' through to
   the global default when the panel hasn't been explicitly overridden. */
function effectiveMode(panelKey) {
  const v = state.viewMode[panelKey];
  return v === 'global' ? state.viewMode.global : v;
}

/* ---------------- Bit-level helpers ---------------- */
function toBinary8(n) {
  const v = Math.max(0, Math.min(255, Number(n) || 0));
  return v.toString(2).padStart(8, '0').split('').map(Number);
}

function bitsToOctet(bitsArr) {
  if (!bitsArr.length) return 0;
  return parseInt(bitsArr.join(''), 2);
}

function octetsToBits(octets) {
  return octets.flatMap(toBinary8);
}

function bitsToOctets(bits) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(bitsToOctet(bits.slice(i * 8, i * 8 + 8)));
  }
  return out;
}

function bitsArrayToInt(bitsArr) {
  let n = 0;
  for (let i = 0; i < bitsArr.length; i++) n = n * 2 + bitsArr[i];
  return n;
}

function intToBitsArray(n, len) {
  return n.toString(2).padStart(len, '0').split('').map(Number);
}

/* Given a fixed-length prefix (the bits that are locked for a given
   network/subnet — classful network bits alone, or network+borrowed bits
   for a specific subnet), derives every address-level fact about that
   block: network address, broadcast address, mask, host counts, and the
   usable range. Used by Panel 6 to compare a classful network against a
   classless subnet using the exact same math, just with a different
   prefix length/value. */
function summarizeAddressBlock(prefixBitsArr) {
  const prefixLen = prefixBitsArr.length;
  const hostBitsCount = 32 - prefixLen;
  const totalHosts = Math.pow(2, hostBitsCount);
  const usableHosts = Math.max(0, totalHosts - 2);

  const networkBitsFull = prefixBitsArr.concat(new Array(hostBitsCount).fill(0));
  const broadcastBitsFull = prefixBitsArr.concat(new Array(hostBitsCount).fill(1));
  const networkInt = bitsArrayToInt(networkBitsFull);
  const broadcastInt = bitsArrayToInt(broadcastBitsFull);
  const maskBits = new Array(prefixLen).fill(1).concat(new Array(hostBitsCount).fill(0));

  let firstUsableOctets = null;
  let lastUsableOctets = null;
  if (usableHosts > 0) {
    firstUsableOctets = bitsToOctets(intToBitsArray(networkInt + 1, 32));
    lastUsableOctets = bitsToOctets(intToBitsArray(broadcastInt - 1, 32));
  }

  return {
    prefixLen,
    totalHosts,
    usableHosts,
    networkOctets: bitsToOctets(networkBitsFull),
    broadcastOctets: bitsToOctets(broadcastBitsFull),
    maskOctets: bitsToOctets(maskBits),
    firstUsableOctets,
    lastUsableOctets,
  };
}

/* ---------------- Class detection ---------------- */
function detectClass(o1) {
  if (o1 >= 1 && o1 <= 126) {
    return { label: 'A', networkBits: 8, warning: null };
  }
  if (o1 === 127) {
    return {
      label: 'Loopback',
      networkBits: 8,
      warning: 'Loopback range (127.0.0.0/8): reserved for a host to talk to itself. Not used for subnetting exercises — bit-borrowing is disabled.',
    };
  }
  if (o1 >= 128 && o1 <= 191) {
    return { label: 'B', networkBits: 16, warning: null };
  }
  if (o1 >= 192 && o1 <= 223) {
    return { label: 'C', networkBits: 24, warning: null };
  }
  if (o1 >= 224 && o1 <= 239) {
    return {
      label: 'D (Multicast)',
      networkBits: 32,
      warning: 'Multicast range (224.0.0.0 – 239.255.255.255): addresses identify a group of receivers, not a single host. There is no host/network split to subnet — bit-borrowing is disabled.',
    };
  }
  return {
    label: 'E (Experimental)',
    networkBits: 32,
    warning: 'Experimental / reserved range (240.0.0.0+): reserved for future use and not routable. Bit-borrowing is disabled.',
  };
}

/* ---------------- Derived state ---------------- */
function computeDerived() {
  const classInfo = detectClass(state.octets[0]);
  const networkBits = classInfo.networkBits;
  const maxBorrow = classInfo.warning ? 0 : Math.max(0, 30 - networkBits);
  const borrowedBits = classInfo.warning ? 0 : Math.min(state.borrowedBits, maxBorrow);
  const hostBits = 32 - networkBits - borrowedBits;
  const inputBits = octetsToBits(state.octets);
  const totalSubnets = Math.pow(2, borrowedBits);
  const totalHosts = Math.pow(2, hostBits);

  return { classInfo, networkBits, maxBorrow, borrowedBits, hostBits, inputBits, totalSubnets, totalHosts };
}

/* ---------------- DOM references ---------------- */
const el = {
  octetInputs: [0, 1, 2, 3].map((i) => document.getElementById('octet' + i)),
  octetFields: [0, 1, 2, 3].map((i) => document.getElementById('octetField' + i)),
  octetLockIcons: [0, 1, 2, 3].map((i) => document.getElementById('octetLock' + i)),
  classBadge: document.getElementById('classBadge'),
  cidrBadge: document.getElementById('cidrBadge'),
  borrowBadge: document.getElementById('borrowBadge'),
  warningBanner: document.getElementById('warningBanner'),
  bitGrid: document.getElementById('bitGrid'),
  bitGridLegend: document.getElementById('bitGridLegend'),
  panel2Hint: document.getElementById('panel2Hint'),
  classfulMaskBinary: document.getElementById('classfulMaskBinary'),
  classfulMaskDecimal: document.getElementById('classfulMaskDecimal'),
  classlessMaskBinary: document.getElementById('classlessMaskBinary'),
  classlessMaskDecimal: document.getElementById('classlessMaskDecimal'),
  maskDotDecimal: document.getElementById('maskDotDecimal'),
  maskCidr: document.getElementById('maskCidr'),
  subnetCountMeta: document.getElementById('subnetCountMeta'),
  subnetFormulaToggle: document.getElementById('subnetFormulaToggle'),
  subnetFormulaBox: document.getElementById('subnetFormulaBox'),
  subnetTableBody: document.getElementById('subnetTableBody'),
  activeSubnetMeta: document.getElementById('activeSubnetMeta'),
  hostFormulaToggle: document.getElementById('hostFormulaToggle'),
  hostFormulaBox: document.getElementById('hostFormulaBox'),
  hostTableBody: document.getElementById('hostTableBody'),
  presenterToggle: document.getElementById('presenterToggle'),
  resetBorrowBtn: document.getElementById('resetBorrowBtn'),
  globalViewModeSegmented: document.getElementById('globalViewModeSegmented'),
  panel2ViewSelect: document.getElementById('panel2ViewMode'),
  panel3ViewSelect: document.getElementById('panel3ViewMode'),
  panel4ViewSelect: document.getElementById('panel4ViewMode'),
  panel5ViewSelect: document.getElementById('panel5ViewMode'),
  classfulCompareStats: document.getElementById('classfulCompareStats'),
  classfulCompareCards: document.getElementById('classfulCompareCards'),
  classlessCompareStats: document.getElementById('classlessCompareStats'),
  classlessCompareCards: document.getElementById('classlessCompareCards'),
};

/* ---------------- Octet edit-lock guard (Panel 1) ---------------- */
/* Only the octets that make up the CLASSFUL network portion are editable —
   Class A: octet 1 only. Class B: octets 1-2. Class C: octets 1-3.
   Everything after that is the host portion of the base network address
   and must stay 0 (that's what "classful base network" means — 10.0.0.0,
   172.16.0.0, 192.168.1.0). Only Octet 1 ever drives class detection, so
   this is safe to compute before the rest of computeDerived() runs, and
   must run BEFORE it — it mutates state.octets so every downstream panel
   (bit grid, masks, subnet/host tables) sees the already-zeroed values
   rather than stale digits left over from a previous class. */
function syncOctetLocking() {
  const classInfo = detectClass(state.octets[0]);
  const editableCount = classInfo.networkBits / 8;
  for (let i = editableCount; i < 4; i++) {
    state.octets[i] = 0;
  }
  return editableCount;
}

/* Reflects the lock state onto the actual <input> elements: disables the
   host-portion octets (so they can't be typed into at all, not just
   validated after the fact), keeps their displayed value pinned to 0, and
   surfaces a lock icon next to the label. Skips overwriting an input the
   teacher currently has focused, so mid-typing on an editable octet is
   never clobbered by its own re-render. */
function updateOctetInputsUI(editableCount) {
  el.octetInputs.forEach((inp, i) => {
    const isEditable = i < editableCount;
    inp.disabled = !isEditable;
    if (el.octetFields[i]) el.octetFields[i].classList.toggle('octet-locked', !isEditable);
    if (el.octetLockIcons[i]) el.octetLockIcons[i].classList.toggle('hidden', isEditable);
    if (!isEditable) {
      inp.value = '0';
    } else if (document.activeElement !== inp) {
      inp.value = String(state.octets[i]);
    }
  });
}

/* ---------------- Renderers ---------------- */

function renderPanel1(d) {
  el.classBadge.textContent = d.classInfo.label;
  el.classBadge.classList.toggle('class-value-long', d.classInfo.label.length > 2);
  el.cidrBadge.textContent = '/' + d.networkBits;
  el.borrowBadge.textContent = d.borrowedBits + ' bit' + (d.borrowedBits === 1 ? '' : 's') + ' borrowed';

  const cantReset = Boolean(d.classInfo.warning) || d.borrowedBits === 0;
  el.resetBorrowBtn.disabled = cantReset;
  el.resetBorrowBtn.title = d.classInfo.warning
    ? 'Bit-borrowing is disabled for this address range'
    : d.borrowedBits === 0
      ? 'Already classful (0 bits borrowed)'
      : 'Reset to classful (0 bits borrowed)';

  if (d.classInfo.warning) {
    el.warningBanner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + d.classInfo.warning;
    el.warningBanner.classList.remove('hidden');
  } else {
    el.warningBanner.classList.add('hidden');
  }
}

function renderPanel2(d) {
  const decimalMode = effectiveMode('panel2') === 'decimal';
  el.bitGridLegend.classList.toggle('hidden', decimalMode);
  el.panel2Hint.classList.toggle('hidden', decimalMode);

  const totalPrefix = d.networkBits + d.borrowedBits;

  if (decimalMode) {
    let html = '<div class="decimal-ip-row">';
    for (let g = 0; g < 4; g++) {
      const bitsSlice = d.inputBits.slice(g * 8, g * 8 + 8);
      html += buildOctetTotalHtml(bitsSlice, 'octet-total-main', g < 3);
    }
    html += '<span class="decimal-cidr-suffix">/' + totalPrefix + '</span>';
    html += '</div>';
    el.bitGrid.innerHTML = html;
    return;
  }

  el.bitGrid.innerHTML = '';
  const totalBorrowEnd = d.networkBits + d.borrowedBits;

  for (let g = 0; g < 4; g++) {
    const octetBlock = document.createElement('div');
    octetBlock.className = 'octet-block';

    const bitsSlice = d.inputBits.slice(g * 8, g * 8 + 8);
    const kindsSlice = bitsSlice.map((_, k) => {
      const globalIndex = g * 8 + k;
      if (globalIndex < d.networkBits) return 'locked';
      if (globalIndex < totalBorrowEnd) return 'borrowed';
      return 'host';
    });

    // The last octet (Octet 4) has no trailing dot, since it's the end
    // of the address — this is exactly where the CIDR suffix belongs too,
    // read the same way it is in Decimal Only: "...0/27" at the very end
    // of the address, not a separate label elsewhere on the panel.
    const totalHtml = g === 3
      ? '<div class="octet-total-cidr-wrap">' +
          buildOctetTotalHtml(bitsSlice, 'octet-total-main', false) +
          '<span class="decimal-cidr-suffix cidr-suffix-viz">/' + totalPrefix + '</span>' +
        '</div>'
      : buildOctetTotalHtml(bitsSlice, 'octet-total-main', g < 3);

    octetBlock.innerHTML =
      totalHtml +
      buildWeightRowHtml(bitsSlice, 'weight-row-main', kindsSlice);

    const group = document.createElement('div');
    group.className = 'bit-octet-group';

    for (let b = 0; b < 8; b++) {
      const globalIndex = g * 8 + b;
      const cell = document.createElement('div');
      cell.dataset.index = String(globalIndex);
      const bitVal = d.inputBits[globalIndex];

      if (globalIndex < d.networkBits) {
        cell.className = 'bit-cell locked';
        cell.innerHTML = '<span class="lock-icon"><i class="fa-solid fa-lock"></i></span><span class="bit-value">' + bitVal + '</span>';
      } else if (globalIndex < totalBorrowEnd) {
        cell.className = 'bit-cell borrowed';
        cell.innerHTML = '<span class="bit-value">' + bitVal + '</span>';
        cell.title = 'Click to set subnet boundary here';
      } else {
        cell.className = 'bit-cell host';
        cell.innerHTML = '<span class="bit-value">' + bitVal + '</span>';
        cell.title = 'Click to set subnet boundary here';
      }

      cell.addEventListener('click', () => onBitClick(globalIndex));
      group.appendChild(cell);
    }

    octetBlock.appendChild(group);

    const label = document.createElement('div');
    label.className = 'octet-viz-label';
    label.textContent = 'Octet ' + (g + 1);
    octetBlock.appendChild(label);

    el.bitGrid.appendChild(octetBlock);

    if (g < 3) {
      const sep = document.createElement('div');
      sep.className = 'octet-dot-separator';
      sep.textContent = '.';
      el.bitGrid.appendChild(sep);
    }
  }
}

function renderPanel3(d) {
  const classfulBits = new Array(32).fill(0).map((_, i) => (i < d.networkBits ? 1 : 0));
  const classlessBits = new Array(32).fill(0).map((_, i) => (i < d.networkBits + d.borrowedBits ? 1 : 0));

  const renderMaskBinary = (bits, container, borrowedStart, borrowedEnd) => {
    container.innerHTML = '';
    for (let g = 0; g < 4; g++) {
      const block = document.createElement('div');
      block.className = 'mask-octet-block';

      const bitsSlice = bits.slice(g * 8, g * 8 + 8);
      const kindsSlice = bitsSlice.map((_, k) => {
        const i = g * 8 + k;
        return (i >= borrowedStart && i < borrowedEnd) ? 'borrowed' : 'locked';
      });
      block.innerHTML =
        buildOctetTotalHtml(bitsSlice, 'octet-total-mask', g < 3) +
        buildWeightRowHtml(bitsSlice, 'weight-row-mask', kindsSlice);

      const bitRow = document.createElement('div');
      bitRow.className = 'mask-bit-row';
      for (let k = 0; k < 8; k++) {
        const i = g * 8 + k;
        const span = document.createElement('span');
        const isBorrowed = i >= borrowedStart && i < borrowedEnd;
        span.className = 'mask-bit bit-' + bits[i] + ' ' + (bits[i] === 1 ? (isBorrowed ? 'borrowed-bit' : 'locked-bit') : '');
        span.textContent = bits[i];
        bitRow.appendChild(span);
      }
      block.appendChild(bitRow);

      const label = document.createElement('div');
      label.className = 'octet-viz-label';
      label.textContent = 'Octet ' + (g + 1);
      block.appendChild(label);

      container.appendChild(block);

      if (g < 3) {
        const sep = document.createElement('div');
        sep.className = 'mask-dot-separator';
        sep.textContent = '.';
        container.appendChild(sep);
      }
    }
  };

  const decimalMode = effectiveMode('panel3') === 'decimal';
  el.classfulMaskBinary.classList.toggle('hidden', decimalMode);
  el.classlessMaskBinary.classList.toggle('hidden', decimalMode);

  if (!decimalMode) {
    renderMaskBinary(classfulBits, el.classfulMaskBinary, d.networkBits, d.networkBits);
    renderMaskBinary(classlessBits, el.classlessMaskBinary, d.networkBits, d.networkBits + d.borrowedBits);
  }

  const classfulOctets = bitsToOctets(classfulBits.concat());
  const classlessOctets = bitsToOctets(classlessBits.concat());
  el.classfulMaskDecimal.textContent = classfulOctets.join('.') + '  (/' + d.networkBits + ')';
  el.classlessMaskDecimal.textContent = classlessOctets.join('.') + '  (/' + (d.networkBits + d.borrowedBits) + ')';

  el.maskDotDecimal.textContent = classlessOctets.join('.');
  el.maskCidr.textContent = '/' + (d.networkBits + d.borrowedBits);
}

/* Renders the borrowed-bits pattern (Panel 4) using the same top-to-bottom
   octet visualization language: total -> weight row -> bits -> label. The
   key difference from a real octet is that the weight row is NOT always
   128-1 — it's scaled to however many bits were borrowed. 3 borrowed bits
   means the pattern can only ever represent 0-7, so the place values are
   4-2-1, not 128-64-32. All bits here are inherently "borrowed" bits, so
   lit weights consistently use the borrowed (amber) color — there's no
   locked/host ambiguity to represent, unlike a full octet. */
function buildBorrowedPatternViz(borrowedPattern) {
  const n = borrowedPattern.length;
  const weights = [];
  for (let k = 0; k < n; k++) weights.push(Math.pow(2, n - 1 - k));
  const kindsSlice = borrowedPattern.map(() => 'borrowed');

  let cellsHtml = '';
  for (let k = 0; k < n; k++) {
    cellsHtml += '<span class="u-bit borrowed-bit">' + borrowedPattern[k] + '</span>';
  }

  // Explicit width (bits * 20px u-bit + 2px border) is required here: with
  // container-type:inline-size set on .octet-bits-group (below, via CSS),
  // container-SIZE containment strips the element's ability to size itself
  // from its own inline-flex content, so an auto/shrink-to-fit width
  // collapses toward 0. That both starves the 30cqi font calc (font stays
  // pinned to its minimum forever) AND makes adjacent .octet-bits-group
  // siblings overlap in normal flow, since the box reports ~0 width while
  // still painting its full content. A definite pixel width sidesteps
  // containment entirely and gives cqi a real basis to scale against.
  const groupWidthPx = n * 20 + 2;

  return '<div class="octet-bits-group" style="width:' + groupWidthPx + 'px">' +
    buildOctetTotalHtml(borrowedPattern, 'octet-total-compact') +
    (n > 0 ? buildWeightRowHtml(borrowedPattern, 'weight-row-compact', kindsSlice, weights) : '') +
    '<span class="unified-octet-cell">' + cellsHtml + '</span>' +
    '<span class="octet-viz-label">Subnet</span>' +
    '</div>';
}

/* Panel 4 formula box: how the borrowed bits determine the subnet count.
   2^n, where n is the number of borrowed bits. */
function buildSubnetFormulaHtml(d) {
  const n = d.borrowedBits;
  return (
    '<span class="formula-line">' +
      '<span class="formula-term">Total Subnets</span> = 2<sup>borrowed bits</sup> = 2<sup>' + n + '</sup> = ' +
      '<span class="formula-highlight-subnet">' + d.totalSubnets + '</span>' +
    '</span>' +
    '<span class="formula-note">Each borrowed bit doubles the number of possible subnets. With ' +
      n + ' bit' + (n === 1 ? '' : 's') + ' borrowed, the classful network splits into 2<sup>' + n + '</sup> = ' +
      d.totalSubnets + ' equal-sized subnet' + (d.totalSubnets === 1 ? '' : 's') + '.</span>'
  );
}

/* Panel 5 formula box: how the remaining host bits determine both the total
   address count (2^h) and the usable host count (2^h - 2, reserving the
   all-zeros Network ID and all-ones Broadcast Address). */
function buildHostFormulaHtml(d) {
  const h = d.hostBits;
  const usable = Math.max(0, d.totalHosts - 2);
  return (
    '<span class="formula-line">' +
      '<span class="formula-term">Total Addresses</span> = 2<sup>host bits</sup> = 2<sup>' + h + '</sup> = ' +
      '<span class="formula-highlight-host">' + d.totalHosts + '</span>' +
    '</span>' +
    '<span class="formula-line">' +
      '<span class="formula-term">Usable Hosts</span> = 2<sup>host bits</sup> &minus; 2 = ' + d.totalHosts + ' &minus; 2 = ' +
      '<span class="formula-highlight-host">' + usable + '</span>' +
    '</span>' +
    '<span class="formula-note">The two reserved addresses are the all-zeros Network ID and the all-ones Broadcast Address — every other host-bit pattern is assignable to a device.</span>'
  );
}

function buildSubnetRows(d) {
  const rows = [];
  const netPrefixBits = d.inputBits.slice(0, d.networkBits);
  for (let n = 0; n < d.totalSubnets; n++) {
    const borrowedPattern = n.toString(2).padStart(d.borrowedBits, '0').split('').map(Number);
    const fullBits = netPrefixBits.concat(borrowedPattern).concat(new Array(d.hostBits).fill(0));
    const octets = bitsToOctets(fullBits);
    rows.push({ index: n, binaryIndex: borrowedPattern.join(''), borrowedBitsArr: borrowedPattern, octets, fullBits });
  }
  return rows;
}

function renderPanel4(d) {
  const rows = buildSubnetRows(d);
  el.subnetCountMeta.innerHTML =
    '<i class="fa-solid fa-list-ol"></i> <strong>' + d.totalSubnets + '</strong> total subnet' + (d.totalSubnets === 1 ? '' : 's') +
    '<span class="meta-caret"> — sets the ' + d.totalSubnets + ' row' + (d.totalSubnets === 1 ? '' : 's') + ' below</span>';
  el.subnetCountMeta.title = 'Every borrowed-bit permutation becomes one row in the table below.';

  el.subnetFormulaBox.innerHTML = buildSubnetFormulaHtml(d);
  el.subnetFormulaBox.classList.toggle('hidden', !state.subnetFormulaVisible);
  el.subnetFormulaToggle.classList.toggle('active', state.subnetFormulaVisible);
  el.subnetFormulaToggle.setAttribute('aria-expanded', String(state.subnetFormulaVisible));
  el.subnetFormulaToggle.innerHTML = state.subnetFormulaVisible
    ? '<i class="fa-solid fa-square-root-variable"></i> Hide Formula'
    : '<i class="fa-solid fa-square-root-variable"></i> Show Formula';

  // clamp active index if borrowed bits changed
  if (state.activeSubnetIndex >= d.totalSubnets) state.activeSubnetIndex = 0;

  el.subnetTableBody.innerHTML = '';

  const decimalMode = effectiveMode('panel4') === 'decimal';

  const renderRow = (row) => {
    const tr = document.createElement('tr');
    const isActive = row.index === state.activeSubnetIndex;
        tr.innerHTML = buildPanel4SubnetRow(row, d, decimalMode, isActive).replace(/^<tr[^>]*>|<\/tr>$/g, '');
        const subnetRow = tr.querySelector('.panel4-selectable');
        const selectRow = () => {
      state.activeSubnetIndex = row.index;
      render();
            requestAnimationFrame(() => {
                const panel5 = document.getElementById('panel5');
                if (panel5) panel5.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        };
        subnetRow.addEventListener('click', selectRow);
        subnetRow.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            selectRow();
        });
    el.subnetTableBody.appendChild(tr);
  };

  if (d.totalSubnets <= 8) {
    rows.forEach(renderRow);
  } else if (!state.subnetsExpanded) {
    rows.slice(0, 5).forEach(renderRow);
    const hiddenCount = d.totalSubnets - 8;
    const trExp = document.createElement('tr');
    trExp.className = 'expansion-row';
    trExp.innerHTML =
      '<td class="expansion-index" title="' + hiddenCount + ' hidden rows"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></td>' +
      '<td colspan="3"><button class="expansion-btn" id="subnetExpandBtn"><i class="fa-solid fa-eye"></i> Show ' + hiddenCount + ' Hidden Subnets</button></td>';
    el.subnetTableBody.appendChild(trExp);
    document.getElementById('subnetExpandBtn').addEventListener('click', () => {
      state.subnetsExpanded = true;
      render();
    });
    rows.slice(-3).forEach(renderRow);
  } else {
    rows.forEach(renderRow);
    const trCollapse = document.createElement('tr');
    trCollapse.className = 'expansion-row';
    trCollapse.innerHTML = '<td colspan="4"><button class="expansion-btn" id="subnetCollapseBtn"><i class="fa-solid fa-chevron-up"></i> Collapse</button></td>';
    el.subnetTableBody.appendChild(trCollapse);
    document.getElementById('subnetCollapseBtn').addEventListener('click', () => {
      state.subnetsExpanded = false;
      render();
    });
  }

  return rows;
}

function roleForHostIndex(h, total) {
  if (h === 0) return { label: '<i class="fa-solid fa-ban"></i> Network ID', cls: 'role-network' };
  if (h === 1) return { label: '<i class="fa-solid fa-circle-check"></i> First Usable Host', cls: 'role-first' };
  if (h === total - 2) return { label: '<i class="fa-solid fa-circle-check"></i> Last Usable Host', cls: 'role-last' };
  if (h === total - 1) return { label: '<i class="fa-solid fa-bullhorn"></i> Broadcast Address', cls: 'role-broadcast' };
  return { label: 'Usable Host', cls: 'role-usable' };
}

function buildSingleOctetBits(fullBits, d, octetIndex) {
  const octetStart = octetIndex * 8;
  const bitsSlice = fullBits.slice(octetStart, octetStart + 8);
  const kindsSlice = [];
  let cellsHtml = '';
  for (let k = 0; k < 8; k++) {
    const globalIndex = octetStart + k;
    let kind = 'host';
    if (globalIndex < d.networkBits) kind = 'locked';
    else if (globalIndex < d.networkBits + d.borrowedBits) kind = 'borrowed';
    kindsSlice.push(kind);
    const isCurtainBit = globalIndex === d.networkBits + d.borrowedBits - 1 && d.borrowedBits > 0 && globalIndex < octetStart + 7;
    cellsHtml += '<span class="u-bit ' + kind + '-bit' + (isCurtainBit ? ' curtain-before' : '') + '">' + fullBits[globalIndex] + '</span>';
  }
    const groupWidthPx = 8 * 20 + 2;
    return '<div class="octet-bits-group" style="width:' + groupWidthPx + 'px">' +
        buildOctetTotalHtml(bitsSlice, 'octet-total-compact', octetIndex < 3) +
        buildWeightRowHtml(bitsSlice, 'weight-row-compact', kindsSlice) +
        '<span class="unified-octet-cell">' + cellsHtml + '</span>' +
        '<span class="octet-viz-label">Octet ' + (octetIndex + 1) + '</span>' +
        '</div>';
}

function buildPanel4AddressViz(fullBits, d) {
    const borrowEnd = d.networkBits + d.borrowedBits;
    let out = '<div class="addr-row">';
    for (let o = 0; o < 4; o++) {
        out += atom3BuildSingleOctetBits(fullBits, d.networkBits, borrowEnd, o);
    }
    return out + '</div>';
}

function buildPanel4SubnetIndex(row, decimalMode) {
    const indexValue = decimalMode ? row.index : parseInt(row.binaryIndex || '0', 2);
    const indexDisplay = decimalMode
        ? '<div class="idx-pill-row"><span class="idx-pill-label">Subnet Index <span class="idx-hint">&middot; read-only</span></span><span class="idx-pill-badge">' + indexValue + '</span></div>' +
            '<div class="panel4-index-decimal">' + row.index + '</div>'
        : '<div class="panel4-index-bits" aria-label="Binary subnet index ' + row.binaryIndex + '">' + buildSubnetIndexInner(row.borrowedBitsArr, {
                interactive: false,
                bitClass: 'panel4-index-bit',
                hint: '&middot; read-only',
                footerHtml: '<div class="idx-viz-label">Derived from borrowed bits</div>'
            }) + '</div>';

    return '<div class="idx-block panel4-index-block">' +
        indexDisplay +
        (decimalMode ? '<div class="idx-viz-label">Derived from borrowed bits</div>' : '') +
    '</div>';
}

function buildPanel4SubnetRow(row, d, decimalMode, isActive) {
    const address = decimalMode
        ? '<div class="panel4-address-decimal">' + row.octets.join('.') + '</div>'
        : buildPanel4AddressViz(row.fullBits, d);

    return '<tr class="panel4-subnet-table-row' + (isActive ? ' active-row' : '') + '">' +
        '<td colspan="4"><div class="subnet-row panel4-subnet-row panel4-selectable' + (isActive ? ' panel4-selected' : '') + '" role="button" tabindex="0" aria-current="' + (isActive ? 'true' : 'false') + '" aria-label="' + (isActive ? 'Active subnet ' : 'Select subnet ') + row.index + '">' +
            buildPanel4SubnetIndex(row, decimalMode) +
            '<div class="atom3-row-network panel4-address-block"><div class="panel4-address-heading">Subnet ' + row.index + ' address</div>' + address + '</div>' +
        '</div></td></tr>';
}
// Renders bit-level detail for all 4 octets, including any that are
// 100% locked network bits. Showing the locked octets too (not just the
// ones touched by borrowed/host bits) keeps the full 32-bit picture
// consistent with Panel 2/3 above, and makes it visually obvious *why*
// e.g. a Class A address only has 3 octets left to subnet/host: the first
// octet is right there, fully blue, instead of silently missing.
function buildOctetBitsDisplay(fullBits, d) {
  let out = '<div class="octet-bits-row">';
  for (let o = 0; o < 4; o++) {
    out += buildSingleOctetBits(fullBits, d, o);
  }
  out += '</div>';
  return out;
}

function renderPanel5(d, subnetRows) {
  const activeSubnet = subnetRows[state.activeSubnetIndex] || subnetRows[0];
  el.activeSubnetMeta.innerHTML =
    '<i class="fa-solid fa-crosshairs"></i> Inspecting <strong>Subnet ' + (activeSubnet ? activeSubnet.index : 0) + '</strong>' +
    ' (' + (activeSubnet ? activeSubnet.octets.join('.') : '') + ')' +
    '<span class="meta-caret"> — generates the ' + d.totalHosts + ' addresses below</span>';
  el.activeSubnetMeta.title = 'This is the subnet selected in the table above; every row below is an address within it.';

  el.hostFormulaBox.innerHTML = buildHostFormulaHtml(d);
  el.hostFormulaBox.classList.toggle('hidden', !state.hostFormulaVisible);
  el.hostFormulaToggle.classList.toggle('active', state.hostFormulaVisible);
  el.hostFormulaToggle.setAttribute('aria-expanded', String(state.hostFormulaVisible));
  el.hostFormulaToggle.innerHTML = state.hostFormulaVisible
    ? '<i class="fa-solid fa-square-root-variable"></i> Hide Formula'
    : '<i class="fa-solid fa-square-root-variable"></i> Show Formula';

  el.hostTableBody.innerHTML = '';
  if (!activeSubnet) return;

  const baseBits = activeSubnet.fullBits.slice(0, d.networkBits + d.borrowedBits);
  const decimalMode = effectiveMode('panel5') === 'decimal';

  const renderHostRow = (h) => {
    const hostBitsArr = h.toString(2).padStart(d.hostBits, '0').split('').map(Number);
    const fullBits = baseBits.concat(hostBitsArr);
    const role = roleForHostIndex(h, d.totalHosts);
    const addressCell = decimalMode ? bitsToOctets(fullBits).join('.') : buildOctetBitsDisplay(fullBits, d);

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (h + 1) + '</td>' +
      '<td class="nowrap-cell">' + addressCell + '</td>' +
      '<td><span class="badge-role ' + role.cls + '">' + role.label + '</span></td>';
    el.hostTableBody.appendChild(tr);
  };

  if (d.totalHosts <= 8) {
    for (let h = 0; h < d.totalHosts; h++) renderHostRow(h);
  } else if (!state.hostsExpanded) {
    for (let h = 0; h < 5; h++) renderHostRow(h);
    const hiddenCount = d.totalHosts - 8;
    const trExp = document.createElement('tr');
    trExp.className = 'expansion-row';
        trExp.innerHTML =
      '<td colspan="2"><button class="expansion-btn" id="hostExpandBtn"><i class="fa-solid fa-eye"></i> Show ' + hiddenCount + ' Hidden Hosts</button></td>';
    el.hostTableBody.appendChild(trExp);
        document.getElementById('hostExpandBtn').addEventListener('click', () => {
      state.hostsExpanded = true;
      render();
    });
    for (let h = d.totalHosts - 3; h < d.totalHosts; h++) renderHostRow(h);
  } else {
    const cap = Math.min(d.totalHosts, 4096);
    for (let h = 0; h < cap; h++) renderHostRow(h);
    const trCollapse = document.createElement('tr');
    trCollapse.className = 'expansion-row';
    trCollapse.innerHTML = '<td colspan="3"><button class="expansion-btn" id="hostCollapseBtn"><i class="fa-solid fa-chevron-up"></i> Collapse</button></td>';
    el.hostTableBody.appendChild(trCollapse);
    document.getElementById('hostCollapseBtn').addEventListener('click', () => {
      state.hostsExpanded = false;
      render();
    });
  }
}

/* ---------------- Master render ---------------- */
/* Panel 6: side-by-side decimal comparison of the original classful network
   against the currently-inspected classless subnet (Panel 4's active
   row). No bit representation here by design — this panel is the plain-
   language payoff after Panels 2-5 walked through the binary reasoning. */
const fmtOctets = (octets) => (octets ? octets.join('.') : '—');

function buildCompareCommonStatsHtml(summary, countLabel, count, usableHostsLabel) {
  return (
    '<div class="compare-stat">' +
      '<span class="compare-stat-label">Subnet Mask</span>' +
      '<span class="compare-stat-value">' + fmtOctets(summary.maskOctets) + ' (/' + summary.prefixLen + ')</span>' +
    '</div>' +
    '<div class="compare-stat">' +
      '<span class="compare-stat-label">' + countLabel + '</span>' +
      '<span class="compare-stat-value">' + count + '</span>' +
    '</div>' +
    '<div class="compare-stat">' +
      '<span class="compare-stat-label">' + (usableHostsLabel || 'Usable Hosts') + '</span>' +
      '<span class="compare-stat-value">' + summary.usableHosts + '</span>' +
    '</div>'
  );
}

function buildCompareCardHtml(indexLabel, summary) {
  const usableRangeText = summary.usableHosts > 0
    ? fmtOctets(summary.firstUsableOctets) + ' – ' + fmtOctets(summary.lastUsableOctets)
    : '—';
  return (
    '<div class="compare-card">' +
      '<div class="compare-card-index">' + indexLabel + '</div>' +
      '<div class="compare-card-row"><span class="compare-card-label">Network Address</span><span class="compare-card-value">' + fmtOctets(summary.networkOctets) + '</span></div>' +
      '<div class="compare-card-row"><span class="compare-card-label">Usable Host Range</span><span class="compare-card-value">' + usableRangeText + '</span></div>' +
      '<div class="compare-card-row"><span class="compare-card-label">Broadcast</span><span class="compare-card-value">' + fmtOctets(summary.broadcastOctets) + '</span></div>' +
    '</div>'
  );
}

/* Renders one card per item into a container, applying the same First 5 /
   Interactive Ellipsis / Last 3 truncation rule used by Panels 4 & 5 once
   there are more than 8 items. */
function renderCompareCards(container, items, buildIndexLabel, expandBtnId, onToggle) {
  container.innerHTML = '';
  const total = items.length;

  const appendCard = (item) => {
    container.insertAdjacentHTML('beforeend', buildCompareCardHtml(buildIndexLabel(item), item.summary));
  };

  if (total <= 8) {
    items.forEach(appendCard);
    return;
  }

  if (!state.compareExpanded) {
    items.slice(0, 5).forEach(appendCard);
    const hiddenCount = total - 8;
    container.insertAdjacentHTML(
      'beforeend',
      '<div class="compare-expand-card"><button class="expansion-btn" id="' + expandBtnId + '">' +
        '<i class="fa-solid fa-eye"></i> Show ' + hiddenCount + ' Hidden Subnets</button></div>'
    );
    document.getElementById(expandBtnId).addEventListener('click', () => onToggle(true));
    items.slice(-3).forEach(appendCard);
  } else {
    items.forEach(appendCard);
    const collapseBtnId = expandBtnId + 'Collapse';
    container.insertAdjacentHTML(
      'beforeend',
      '<div class="compare-expand-card"><button class="expansion-btn" id="' + collapseBtnId + '">' +
        '<i class="fa-solid fa-chevron-up"></i> Collapse</button></div>'
    );
    document.getElementById(collapseBtnId).addEventListener('click', () => onToggle(false));
  }
}

/* Panel 6: decimal-only comparison of the original classful network against
   every classless subnet it splits into — no bit representation, no
   dependency on Panel 4's currently-inspected row. Each group shows its
   shared facts (mask, count, usable hosts) once up top, then one card per
   network (Classful: always exactly 1) or per subnet (Classless: all of
   them, subject to the same >8 truncation rule as Panels 4/5). */
function renderPanel6(d, subnetRows) {
  const classfulSummary = summarizeAddressBlock(d.inputBits.slice(0, d.networkBits));
  el.classfulCompareStats.innerHTML = buildCompareCommonStatsHtml(classfulSummary, 'Number of Networks', 1);
  el.classfulCompareCards.innerHTML = buildCompareCardHtml('Whole Network', classfulSummary);

  const classlessItems = subnetRows.map((row) => ({
    index: row.index,
    summary: summarizeAddressBlock(row.fullBits.slice(0, d.networkBits + d.borrowedBits)),
  }));
  const referenceSummary = classlessItems[0]
    ? classlessItems[0].summary
    : summarizeAddressBlock(d.inputBits.slice(0, d.networkBits + d.borrowedBits));
  el.classlessCompareStats.innerHTML = buildCompareCommonStatsHtml(referenceSummary, 'Number of Subnets', d.totalSubnets, 'Usable Hosts / Subnet');

  renderCompareCards(
    el.classlessCompareCards,
    classlessItems,
    (item) => 'Subnet ' + item.index,
    'compareExpandBtn',
    (expand) => {
      state.compareExpanded = expand;
      render();
    }
  );
}

function render() {
  const editableCount = syncOctetLocking();
  const d = computeDerived();
  // keep state.borrowedBits clamped so UI/state stay in sync
  state.borrowedBits = d.borrowedBits;

  updateOctetInputsUI(editableCount);
  renderPanel1(d);
  renderPanel2(d);
  renderPanel3(d);
  const subnetRows = renderPanel4(d);
  renderPanel5(d, subnetRows);
  renderPanel6(d, subnetRows);
}

/* ---------------- Event handlers ---------------- */
function onBitClick(globalIndex) {
  const d = computeDerived();
  if (d.classInfo.warning) return; // borrowing disabled
  if (globalIndex < d.networkBits) return; // locked network bit

  let newBorrowed = globalIndex - d.networkBits + 1;
  newBorrowed = Math.max(0, Math.min(newBorrowed, d.maxBorrow));

  state.borrowedBits = newBorrowed;
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  render();
}

function onOctetInput() {
  state.octets = el.octetInputs.map((inp) => {
    const v = parseInt(inp.value, 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(255, v)) : 0;
  });
  // Reset subnetting context on IP change (class may have changed). Borrowed
  // bits reset to 0 (classful) rather than an assumed default — the teacher
  // picks the boundary themselves by clicking a bit in Panel 2.
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  state.borrowedBits = 0;
  render();
}

function applyPreset(name) {
  const presets = {
    A: [10, 0, 0, 0],
    B: [172, 16, 0, 0],
    C: [192, 168, 1, 0],
  };
  state.octets = presets[name];
  el.octetInputs.forEach((inp, i) => (inp.value = state.octets[i]));
  // Load classful (0 bits borrowed) — the teacher clicks a bit in Panel 2
  // to choose where the subnet boundary starts.
  state.borrowedBits = 0;
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  render();
}

function resetToClassful() {
  const d = computeDerived();
  if (d.classInfo.warning) return; // nothing to reset when borrowing is already disabled
  state.borrowedBits = 0;
  state.activeSubnetIndex = 0;
  state.subnetsExpanded = false;
  state.hostsExpanded = false;
  render();
}

function togglePresenterMode() {
  state.presenterMode = !state.presenterMode;
  document.body.classList.toggle('presenter-mode', state.presenterMode);
  el.presenterToggle.classList.toggle('active', state.presenterMode);
  el.presenterToggle.innerHTML = state.presenterMode
    ? '<i class="fa-solid fa-tv"></i> Presenter Mode: On'
    : '<i class="fa-solid fa-tv"></i> Presenter Mode';
}

/* ---------------- Init ---------------- */
function init() {
  if (_initialized) { render(); return; }
  _initialized = true;
  el.octetInputs.forEach((inp) => inp.addEventListener('input', onOctetInput));
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
  el.presenterToggle.addEventListener('click', togglePresenterMode);
  el.resetBorrowBtn.addEventListener('click', resetToClassful);
  el.subnetFormulaToggle.addEventListener('click', () => {
    state.subnetFormulaVisible = !state.subnetFormulaVisible;
    render();
  });
  el.hostFormulaToggle.addEventListener('click', () => {
    state.hostFormulaVisible = !state.hostFormulaVisible;
    render();
  });

  el.globalViewModeSegmented.querySelectorAll('.segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode.global = btn.dataset.mode;
      el.globalViewModeSegmented.querySelectorAll('.segment-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      render();
    });
  });

  [
    ['panel2ViewSelect', 'panel2'],
    ['panel3ViewSelect', 'panel3'],
    ['panel4ViewSelect', 'panel4'],
    ['panel5ViewSelect', 'panel5'],
  ].forEach(([elKey, panelKey]) => {
    el[elKey].addEventListener('change', () => {
      state.viewMode[panelKey] = el[elKey].value;
      render();
    });
  });

  render();
}

// init() is called by showSubnetVisualizer() in script.js instead of on DOMContentLoaded,
// since this panel starts hidden and its DOM elements only need to be wired up once, lazily.

  return { init, render };
})();