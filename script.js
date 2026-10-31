console.log("Chess.js:", typeof Chess);

// ======================================================
// MAIN ELEMENTS
// ======================================================

const pgnInput = document.getElementById("pgn-input");
const analyzeButton = document.getElementById("analyze-button");
const result = document.getElementById("result");

// ======================================================
// GLOBAL GAME DATA
// ======================================================

let gameData = null;
let currentPosition = 0;
let autoplayTimer = null;
let soundsEnabled = true;
let soundAudioContext = null;

// ======================================================
// STOCKFISH
// ======================================================

let stockfish = null;
let enginePromise = null;
let activeEngineRequest = null;
let analysisRunId = 0;
let engineGeneration = 0;

const engineCache = new Map();

// Keep full-game analysis responsive. Higher depths can take a long time per move.
const ENGINE_DEPTH = 16;

// ======================================================
// HTML SAFETY
// ======================================================

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ======================================================
// ANALYZER STYLES
// ======================================================

function injectAnalyzerStyles() {
    // All presentation now lives in review.css. Keep this compatibility hook
    // because the analysis flow already calls it before rendering the report.
    if (!document.getElementById("chess-analyzer-styles")) {
        const style = document.createElement("style");
        style.id = "chess-analyzer-styles";
        style.textContent = "/* ChessScope review styles are loaded from review.css. */";
        document.head.appendChild(style);
    }
}

// ======================================================
// CREATE EMPTY STATS
// ======================================================

const CLASSIFICATION_PRESENTATION = {
    Book:       { label: "Theory",          icon: "▤", description: "A recognized opening continuation." },
    Brilliant:  { label: "Spark",           icon: "✧", description: "A rare, high-precision tactical idea." },
    Great:      { label: "Masterstroke",     icon: "✦", description: "A strong response in a critical position." },
    Best:       { label: "Optimal",          icon: "◆", description: "The engine's preferred move at the analyzed depth." },
    Excellent:  { label: "Precise",          icon: "✓", description: "A highly accurate move." },
    Good:       { label: "Sound",            icon: "●", description: "A sensible move with limited evaluation loss." },
    Inaccuracy: { label: "Slip",             icon: "↘", description: "A small loss of advantage or precision." },
    Mistake:    { label: "Error",            icon: "!", description: "A meaningful evaluation loss." },
    Miss:       { label: "Missed chance",    icon: "◎", description: "A significant opportunity was not taken." },
    Blunder:    { label: "Breakdown",        icon: "⚡", description: "A major loss of evaluation." }
};

function getClassificationPresentation(classification) {
    return CLASSIFICATION_PRESENTATION[classification] || {
        label: classification || "Pending",
        icon: "·",
        description: "Move classification is not available yet."
    };
}

function classificationMarkup(classification) {
    if (!classification) return "";
    const info = getClassificationPresentation(classification);
    const key = String(classification).toLowerCase();
    return `<span class="cs-classification cs-class-${key}" title="${escapeHtml(info.description)}"><span class="cs-classification-icon" aria-hidden="true">${info.icon}</span><span>${escapeHtml(info.label)}</span></span>`;
}

function createEmptyStats() {

    return {

        Book: 0,
        Brilliant: 0,
        Great: 0,
        Best: 0,
        Excellent: 0,
        Good: 0,
        Inaccuracy: 0,
        Mistake: 0,
        Miss: 0,
        Blunder: 0,

        totalAccuracy: 0,
        moves: 0
    };
}

// ======================================================
// SAFE ENGINE CANCELLATION
// ======================================================

function cancelActiveEngineRequest() {

    // Invalidate all messages from the old worker first.
    engineGeneration++;

    if (activeEngineRequest) {
        const request = activeEngineRequest;
        activeEngineRequest = null;

        try {
            request.reject(new Error("Analysis cancelled."));
        } catch (e) {
            // The request may already have settled.
        }
    }

    if (stockfish) {
        try {
            stockfish.terminate();
        } catch (e) {
            // Ignore worker termination errors.
        }
    }

    stockfish = null;
    enginePromise = null;
}

// ======================================================
// ANALYZE BUTTON
// ======================================================

analyzeButton.addEventListener("click", async () => {

    const pgn =
        pgnInput.value.trim();

    if (!pgn) {

        result.textContent =
            "Please paste a PGN first.";

        return;
    }

    stopAutoplay();

    // New analysis run
    analysisRunId++;

    // Cancel the previous worker completely so a late bestmove
    // cannot be mistaken for the next position's result.
    cancelActiveEngineRequest();

    engineCache.clear();

    injectAnalyzerStyles();

    // ==================================================
    // HEADERS
    // ==================================================

    const headers = {};

    const headerRegex =
        /^\[(\w+)\s+"([^"]*)"\]$/gm;

    let match;

    while (
        (match = headerRegex.exec(pgn)) !== null
    ) {

        headers[match[1]] =
            match[2];
    }

    // ==================================================
    // MOVE TEXT
    // ==================================================

    const moveText =
        pgn
            .replace(/^\[.*\]$/gm, "")
            .replace(/\{[^}]*\}/g, "")
            .replace(/\([^)]*\)/g, "")
            .replace(/\$\d+/g, "")
            .replace(/\d+\.(\.\.)?/g, "")
            .replace(/\s+/g, " ")
            .trim();

    const results = [
        "1-0",
        "0-1",
        "1/2-1/2",
        "*"
    ];

    const moves =
        moveText
            .split(" ")
            .filter(move =>
                move &&
                !results.includes(move)
            );

    // ==================================================
    // CHESS.JS
    // ==================================================

    const chess =
        new Chess();

    // ==================================================
    // POSITION HISTORY
    // ==================================================

    const positions = [];

    // Starting position
    positions.push({

        index: 0,

        moveNumber: 0,

        san: "",

        side: "w",

        label: "Starting Position",

        from: null,

        to: null,

        fen: chess.fen(),

        analysis: null,

        classification: null,

        loss: 0,

        accuracy: 100
    });

    const validMoves = [];

    let invalidMove = null;

    // ==================================================
    // REPLAY ALL MOVES
    // ==================================================

    for (
        let i = 0;
        i < moves.length;
        i++
    ) {

        const move =
            moves[i];

        try {

            const playedMove =
                chess.move(
                    move,
                    {
                        sloppy: true
                    }
                );

            if (!playedMove) {

                invalidMove = {

                    move: move,

                    index: i,

                    moveNumber:
                        Math.floor(i / 2) + 1,

                    side:
                        i % 2 === 0
                            ? "White"
                            : "Black"
                };

                break;
            }

            validMoves.push(
                playedMove.san
            );

            const moveIndex =
                i + 1;

            const fullMoveNumber =
                Math.floor(i / 2) + 1;

            const moveLabel =
                playedMove.color === "w"
                    ? `${fullMoveNumber}.`
                    : `${fullMoveNumber}...`;

            positions.push({

                index:
                    moveIndex,

                moveNumber:
                    fullMoveNumber,

                san:
                    playedMove.san,

                side:
                    playedMove.color,

                label:
                    `${moveLabel} ${playedMove.san}`,

                from:
                    playedMove.from,

                to:
                    playedMove.to,

                promotion:
                    playedMove.promotion || null,

                captured:
                    playedMove.captured || null,

                flags:
                    playedMove.flags || "",

                fen:
                    chess.fen(),

                analysis: null,

                classification: null,

                loss: 0,

                accuracy: 100
            });

        } catch (error) {

            invalidMove = {

                move: move,

                index: i,

                moveNumber:
                    Math.floor(i / 2) + 1,

                side:
                    i % 2 === 0
                        ? "White"
                        : "Black",

                error:
                    error.message
            };

            break;
        }
    }

    // ==================================================
    // INVALID
    // ==================================================

    if (invalidMove) {

        const moveLabel =
            invalidMove.side === "White"
                ? `${invalidMove.moveNumber}.`
                : `${invalidMove.moveNumber}...`;

        result.innerHTML = `

            <div class="ca-wrapper">

                <div class="ca-engine-status">

                    ❌ PGN error at

                    <strong>
                        ${escapeHtml(
                            moveLabel +
                            " " +
                            invalidMove.move
                        )}
                    </strong>

                    (${escapeHtml(
                        invalidMove.side
                    )})

                    <br><br>

                    Valid moves processed:

                    <strong>
                        ${validMoves.length}
                    </strong>

                </div>

            </div>
        `;

        return;
    }

    // ==================================================
    // SAVE GAME
    // ==================================================

    gameData = {

        headers: headers,

        moves: validMoves,

        positions: positions,

        finalFEN:
            chess.fen(),

        whiteStats:
            createEmptyStats(),

        blackStats:
            createEmptyStats(),

        whiteAccuracy: 0,

        blackAccuracy: 0,

        analyzed: false
    };

    currentPosition = 0;

    // ==================================================
    // RENDER
    // ==================================================

    renderAnalyzer();
    result.scrollIntoView({ behavior: "smooth", block: "start" });

    // ==================================================
    // AUTOMATIC ANALYSIS
    // ==================================================

    await runAutomaticAnalysis();
});

// ======================================================
// RENDER MAIN ANALYZER
// ======================================================


// ======================================================
// CHESS.COM PLAYER AVATARS
// ======================================================

// PGN player tags sometimes contain a Chess.com username, but they can
// also contain display names. Only try a lookup when the tag looks like
// a username; never guess from a person's real/display name.
function looksLikeChessComUsername(value) {
    return /^[a-zA-Z0-9_-]{3,25}$/.test(String(value || "").trim());
}

function playerInitials(name) {
    const parts = String(name || "Player").trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1
        ? parts[0][0] + parts[parts.length - 1][0]
        : (parts[0] || "P").slice(0, 2)).toUpperCase();
}

async function loadChessComPlayerCard(color, name, rating) {
    const card = document.querySelector(`[data-player-card="${color}"]`);
    if (!card) return;

    const avatar = card.querySelector(".ca-player-avatar");
    const fallback = card.querySelector(".ca-player-fallback");
    const status = card.querySelector(".ca-player-status");
    const nameLink = card.querySelector(".ca-player-name");

    fallback.textContent = playerInitials(name);
    fallback.hidden = false;
    avatar.hidden = true;

    if (!looksLikeChessComUsername(name)) {
        status.textContent = "Avatar unavailable from PGN";
        return;
    }

    status.textContent = "Looking up Chess.com profile…";

    try {
        const response = await fetch(
            `https://api.chess.com/pub/player/${encodeURIComponent(name.trim())}`,
            { headers: { "Accept": "application/json" } }
        );

        if (!response.ok) throw new Error("Profile lookup failed");

        const profile = await response.json();
        if (!profile || !profile.username) throw new Error("Profile not found");

        const profileUsername = String(profile.username);
        const profileUrl = `https://www.chess.com/member/${encodeURIComponent(profileUsername)}`;

        nameLink.href = profileUrl;
        nameLink.target = "_blank";
        nameLink.rel = "noopener noreferrer";
        nameLink.title = "Open Chess.com profile";

        if (profile.avatar && typeof profile.avatar === "string") {
            avatar.src = profile.avatar;
            avatar.alt = `${name} Chess.com avatar`;
            avatar.onload = () => {
                avatar.hidden = false;
                fallback.hidden = true;
            };
            avatar.onerror = () => {
                avatar.hidden = true;
                fallback.hidden = false;
            };
            status.textContent = "Chess.com profile";
        } else {
            status.textContent = "Profile found · no public avatar";
        }
    } catch (error) {
        // GitHub Pages/browser cross-origin restrictions or a non-username
        // PGN tag may prevent the public API lookup. Keep the fallback.
        status.textContent = "Profile not available";
    }
}

function loadChessComPlayerCards(headers) {
    loadChessComPlayerCard(
        "white",
        headers.White || "White",
        headers.WhiteElo || "Rating unavailable"
    );
    loadChessComPlayerCard(
        "black",
        headers.Black || "Black",
        headers.BlackElo || "Rating unavailable"
    );
}

function renderAnalyzer() {
    if (!gameData) return;

    const headers = gameData.headers;
    const whiteName = headers.White || "White";
    const blackName = headers.Black || "Black";
    const rawResult = headers.Result || "*";
    const resultLabel = rawResult === "1-0" ? "1–0" : rawResult === "0-1" ? "0–1" : rawResult === "1/2-1/2" ? "½–½" : "In progress";
    const openingLabel = headers.Opening || headers.ECO || "Opening not identified";
    const dateLabel = headers.Date || "Date unavailable";
    const eventLabel = headers.Event || headers.Site || "Imported PGN";
    const timeLabel = headers.TimeControl || "Time control unavailable";

    result.innerHTML = `
        <section class="cs-report-view" aria-label="ChessScope game review">
            <header class="cs-report-heading">
                <div class="cs-report-heading-copy">
                    <div class="cs-eyebrow"><span class="cs-eyebrow-dot"></span> CHESSSCOPE <span class="cs-eyebrow-divider">/</span> GAME REVIEW</div>
                    <h2>${escapeHtml(whiteName)} <span class="cs-vs">vs</span> ${escapeHtml(blackName)}</h2>
                    <p>${escapeHtml(openingLabel)} <span class="cs-heading-separator">·</span> ${escapeHtml(eventLabel)}</p>
                </div>
                <div class="cs-result-block">
                    <span class="cs-result-label">GAME RESULT</span>
                    <strong>${escapeHtml(resultLabel)}</strong>
                </div>
            </header>

            <div class="cs-game-meta" aria-label="Game details">
                <div class="cs-meta-item"><span class="cs-meta-icon">▦</span><span><small>DATE</small><strong>${escapeHtml(dateLabel)}</strong></span></div>
                <div class="cs-meta-item"><span class="cs-meta-icon">♙</span><span><small>OPENING</small><strong>${escapeHtml(openingLabel)}</strong></span></div>
                <div class="cs-meta-item"><span class="cs-meta-icon">◷</span><span><small>TIME CONTROL</small><strong>${escapeHtml(timeLabel)}</strong></span></div>
                <div class="cs-meta-item"><span class="cs-meta-icon">⇄</span><span><small>HALF-MOVES</small><strong>${gameData.moves.length}</strong></span></div>
            </div>

            <div class="ca-wrapper">
                <div class="ca-analyzer">
                    <section class="ca-board-area" aria-label="Interactive game board">
                        <div class="cs-board-card">
                            <div class="cs-card-topline">
                                <div><span class="cs-section-kicker">THE GAME</span><h3>Move review</h3></div>
                                <div class="cs-board-live"><span></span> INTERACTIVE BOARD</div>
                            </div>

                            <div class="ca-player-cards" aria-label="Game players">
                                <div class="ca-player-card" data-player-card="black">
                                    <div class="ca-player-fallback" aria-hidden="true">B</div>
                                    <img class="ca-player-avatar" alt="" hidden>
                                    <div class="ca-player-copy">
                                        <span class="ca-player-color">BLACK</span>
                                        <a class="ca-player-name">${escapeHtml(blackName)}</a>
                                        <span class="ca-player-rating">${escapeHtml(headers.BlackElo || "Rating unavailable")}</span>
                                        <span class="ca-player-status">Player details</span>
                                    </div>
                                    <span class="cs-player-piece" aria-hidden="true">♚</span>
                                </div>
                                <div class="ca-player-card" data-player-card="white">
                                    <div class="ca-player-fallback" aria-hidden="true">W</div>
                                    <img class="ca-player-avatar" alt="" hidden>
                                    <div class="ca-player-copy">
                                        <span class="ca-player-color">WHITE</span>
                                        <a class="ca-player-name">${escapeHtml(whiteName)}</a>
                                        <span class="ca-player-rating">${escapeHtml(headers.WhiteElo || "Rating unavailable")}</span>
                                        <span class="ca-player-status">Player details</span>
                                    </div>
                                    <span class="cs-player-piece" aria-hidden="true">♔</span>
                                </div>
                            </div>

                            <div class="ca-board-line">
                                <div class="ca-eval-sidebar" aria-label="Position evaluation">
                                    <div id="ca-eval-label" class="ca-eval-label">ANALYZING</div>
                                    <div class="ca-eval-bar">
                                        <div id="ca-eval-bar-fill" class="ca-eval-bar-fill"></div>
                                        <div class="ca-eval-bar-top">B</div>
                                        <div class="ca-eval-bar-bottom">W</div>
                                        <div class="ca-eval-zero"></div>
                                    </div>
                                </div>
                                <div id="ca-board" class="ca-board" aria-label="Chessboard position"></div>
                            </div>
                            <div id="ca-board-caption" class="ca-board-caption">Initial chess position</div>

                            <div class="ca-controls" aria-label="Move navigation controls">
                                <button id="ca-start" class="ca-control" type="button" title="Go to the start">|◀</button>
                                <button id="ca-prev" class="ca-control" type="button" title="Previous move">‹</button>
                                <button id="ca-play" class="ca-control ca-control-play" type="button" title="Autoplay moves">▶ Play</button>
                                <button id="ca-next" class="ca-control" type="button" title="Next move">›</button>
                                <button id="ca-end" class="ca-control" type="button" title="Go to the end">▶|</button>
                                <button id="ca-sound" class="ca-control ca-control-sound" type="button" aria-pressed="true" title="Toggle move sounds">♫</button>
                            </div>
                            <div class="cs-keyboard-hint"><kbd>←</kbd><kbd>→</kbd> navigate moves <span>·</span> <kbd>Space</kbd> play / pause</div>
                        </div>

                        <section class="cs-timeline-card" aria-label="Move list">
                            <div class="cs-card-topline cs-timeline-heading">
                                <div><span class="cs-section-kicker">FOLLOW THE GAME</span><h3>Move timeline</h3></div>
                                <span class="cs-hint-text">Select any move to inspect its position</span>
                            </div>
                            <div id="ca-move-list" class="ca-move-list"></div>
                        </section>
                    </section>

                    <aside class="ca-panel" aria-label="Game review report">
                        <div class="cs-panel-heading">
                            <div><span class="cs-section-kicker">YOUR GAME, EXPLAINED</span><h3>Review report</h3></div>
                            <span class="cs-report-mark">CS<span>·</span></span>
                        </div>

                        <div class="ca-engine-status" id="ca-engine-status" role="status" aria-live="polite">Preparing Stockfish…</div>
                        <div class="ca-progress-box"><div class="cs-progress-caption"><span>ENGINE ANALYSIS</span><span id="ca-progress-label">0%</span></div><div class="ca-progress-track"><div id="ca-progress-fill" class="ca-progress-fill"></div></div></div>

                        <section class="cs-panel-section cs-eval-section">
                            <div class="cs-section-row"><div><span class="cs-section-kicker">POSITION BY POSITION</span><h4>Evaluation flow</h4></div><span class="cs-chart-key"><i></i> White advantage</span></div>
                            <div class="ca-evaluation"><svg id="ca-eval-graph" viewBox="0 0 900 180" preserveAspectRatio="none" role="img" aria-label="Evaluation graph"></svg></div>
                            <div class="cs-chart-axis"><span>Black advantage</span><span>Equal</span><span>White advantage</span></div>
                        </section>

                        <section class="cs-panel-section cs-accuracy-section">
                            <div class="cs-section-row"><div><span class="cs-section-kicker">MOVE QUALITY ESTIMATE</span><h4>Player accuracy</h4></div><span class="cs-estimate-tag">ESTIMATED</span></div>
                            <div class="ca-accuracy-grid">
                                <div class="ca-accuracy-card cs-accuracy-white"><span class="ca-accuracy-player">${escapeHtml(whiteName)}</span><strong id="ca-white-accuracy" class="ca-accuracy-value">—</strong><span class="cs-accuracy-caption">WHITE</span></div>
                                <div class="ca-accuracy-card cs-accuracy-black"><span class="ca-accuracy-player">${escapeHtml(blackName)}</span><strong id="ca-black-accuracy" class="ca-accuracy-value">—</strong><span class="cs-accuracy-caption">BLACK</span></div>
                            </div>
                        </section>

                        <section class="cs-selected-move" aria-live="polite">
                            <div class="cs-section-row"><div><span class="cs-section-kicker">POSITION INSIGHT</span><h4>Selected move</h4></div><span class="cs-insight-icon">⌖</span></div>
                            <div id="ca-current-move" class="ca-current-move-value">Starting Position</div>
                            <div id="ca-current-classification" class="ca-current-classification">Initial position</div>
                        </section>

                        <section class="cs-panel-section cs-engine-section">
                            <div class="cs-section-row"><div><span class="cs-section-kicker">STOCKFISH</span><h4>Move comparison</h4></div><span id="ca-engine-depth" class="cs-engine-depth">DEPTH —</span></div>
                            <div class="ca-engine-grid">
                                <div class="ca-engine-stat"><span class="ca-engine-stat-label">Evaluation</span><strong id="ca-engine-evaluation" class="ca-engine-stat-value">—</strong></div>
                                <div class="ca-engine-stat"><span class="ca-engine-stat-label">Engine choice</span><strong id="ca-engine-best" class="ca-engine-stat-value">—</strong></div>
                                <div class="ca-engine-stat"><span class="ca-engine-stat-label">Played</span><strong id="ca-engine-played" class="ca-engine-stat-value">—</strong></div>
                                <div class="ca-engine-stat"><span class="ca-engine-stat-label">Move grade</span><strong id="ca-engine-quality" class="ca-engine-stat-value">—</strong></div>
                            </div>
                            <div class="cs-engine-line"><span>PRINCIPAL VARIATION</span><code id="ca-engine-pv" class="ca-fen">—</code></div>
                        </section>

                        <section class="cs-panel-section cs-breakdown-section">
                            <div class="cs-section-row"><div><span class="cs-section-kicker">CLASSIFICATION MIX</span><h4>Move breakdown</h4></div></div>
                            <div class="cs-player-breakdown"><div class="ca-fen-box"><span class="ca-fen-label">WHITE</span><div id="ca-white-counts" class="ca-count-grid"></div></div><div class="ca-fen-box"><span class="ca-fen-label">BLACK</span><div id="ca-black-counts" class="ca-count-grid"></div></div></div>
                        </section>

                        <section class="cs-panel-section cs-critical-section">
                            <div class="cs-section-row"><div><span class="cs-section-kicker">KEY MOMENTS</span><h4>Turning points</h4></div></div>
                            <div id="ca-critical-moments" class="cs-critical-list"><p class="cs-empty-note">Critical moments appear as the engine reviews the game.</p></div>
                        </section>

                        <details class="cs-technical-details">
                            <summary>Technical position data</summary>
                            <span class="ca-fen-label">CURRENT FEN</span><code id="ca-fen" class="ca-fen"></code>
                        </details>
                        <p class="ca-analysis-note">ChessScope estimates move quality from Stockfish evaluations and its own classification rules. It is not an official Chess.com or Lichess accuracy score. Results depend on engine depth, hardware and the grading model.</p>
                    </aside>
                </div>
            </div>
        </section>
    `;

    // Resolve the player names and load optional public Chess.com avatars.
    const blackCard = document.querySelector('[data-player-card="black"]');
    const whiteCard = document.querySelector('[data-player-card="white"]');
    if (blackCard) blackCard.querySelector(".ca-player-name").textContent = blackName;
    if (whiteCard) whiteCard.querySelector(".ca-player-name").textContent = whiteName;
    loadChessComPlayerCards(headers);

    renderMoveList();
    renderPosition();

    document.getElementById("ca-start").addEventListener("click", () => {
        stopAutoplay();
        goToPosition(0);
    });
    document.getElementById("ca-prev").addEventListener("click", () => {
        stopAutoplay();
        goToPosition(currentPosition - 1);
    });
    document.getElementById("ca-next").addEventListener("click", () => goToPosition(currentPosition + 1));
    document.getElementById("ca-end").addEventListener("click", () => {
        stopAutoplay();
        goToPosition(gameData.positions.length - 1);
    });
    document.getElementById("ca-play").addEventListener("click", toggleAutoplay);

    const soundButton = document.getElementById("ca-sound");
    if (soundButton) {
        soundButton.addEventListener("click", () => {
            soundsEnabled = !soundsEnabled;
            soundButton.textContent = soundsEnabled ? "♫" : "♪̸";
            soundButton.setAttribute("aria-pressed", String(soundsEnabled));
            soundButton.title = soundsEnabled ? "Turn move sounds off" : "Turn move sounds on";
            if (soundsEnabled) playUiTone("move");
        });
    }
}

// ======================================================
// AUTOMATIC ANALYSIS
// ======================================================

async function runAutomaticAnalysis() {

    if (!gameData) {
        return;
    }

    const runId =
        analysisRunId;

    const total =
        gameData.positions.length;

    const statusElement =
        document.getElementById(
            "ca-engine-status"
        );

    const progressFill =
        document.getElementById(
            "ca-progress-fill"
        );

    try {

        // ------------------------------------------------
        // START ENGINE
        // ------------------------------------------------

        if (statusElement) {

            statusElement.textContent =
                "⏳ Starting Stockfish...";
        }

        await initStockfish();

        if (
            runId !== analysisRunId
        ) {

            return;
        }

        // ------------------------------------------------
        // ANALYZE EVERY POSITION
        // ------------------------------------------------

        for (
            let i = 0;
            i < total;
            i++
        ) {

            if (
                runId !== analysisRunId
            ) {

                return;
            }

            const position =
                gameData.positions[i];

            if (statusElement) {

                statusElement.textContent =
                    `🧠 Analyzing position ${i + 1} of ${total}...`;
            }

            const engineResult =
                await evaluateFen(
                    position.fen,
                    ENGINE_DEPTH
                );

            if (
                runId !== analysisRunId
            ) {

                return;
            }

            position.analysis = {

                bestMove:
                    engineResult.bestMove,

                evaluation:
                    engineResult.evaluation,

                depth:
                    engineResult.depth,

                pv:
                    engineResult.pv,

                whiteScore:
                    scoreFromWhitePerspective(
                        engineResult.evaluation,
                        position.fen
                    )
            };

            // ------------------------------------------------
            // CLASSIFY THE MOVE THAT CREATED THIS POSITION
            // ------------------------------------------------

            if (i > 0) {

                await classifyMove(i);

                if (runId !== analysisRunId) {
                    return;
                }
            }

            // ------------------------------------------------
            // PROGRESS
            // ------------------------------------------------

            const percent =
                ((i + 1) / total) * 100;

            if (progressFill) {
                progressFill.style.width = `${percent}%`;
            }
            const progressLabel = document.getElementById("ca-progress-label");
            if (progressLabel) progressLabel.textContent = `${Math.round(percent)}%`;

            // ------------------------------------------------
            // UPDATE UI
            // ------------------------------------------------

            calculateFinalStats();
            updateAnalysisUI();

            if (
                i === currentPosition
            ) {

                renderPosition();
            }
        }

        // ------------------------------------------------
        // FINISHED
        // ------------------------------------------------

        gameData.analyzed = true;
        const progressLabel = document.getElementById("ca-progress-label");
        if (progressLabel) progressLabel.textContent = "100%";

        calculateFinalStats();

        updateAnalysisUI();

        renderMoveList();
        renderPosition();

        if (statusElement) {

            statusElement.textContent =
                `✅ Analysis complete — ${gameData.moves.length} moves analyzed.`;
        }

    } catch (error) {

        // Ignore cancellation errors from an older analysis run.
        if (runId !== analysisRunId) {
            return;
        }

        console.error(
            "Automatic analysis failed:",
            error
        );

        if (statusElement) {

            statusElement.textContent =
                "❌ Stockfish analysis failed. Check the browser console.";
        }
    }
}

// ======================================================
// SCORE FROM WHITE PERSPECTIVE
// ======================================================

function scoreFromWhitePerspective(
    evaluation,
    fen
) {

    if (!evaluation) {
        return null;
    }

    let value =
        Number(
            evaluation.value
        );

    // Mate scores become very large values
    // for graph/comparison purposes.
    if (
        evaluation.type === "mate"
    ) {

        const mateValue =
            100000 -
            (
                Math.abs(value) *
                100
            );

        value =
            value > 0
                ? mateValue
                : -mateValue;
    }

    // UCI score starts from side-to-move perspective.
    if (
        fen.split(" ")[1] === "b"
    ) {

        value =
            -value;
    }

    return value;
}

// ======================================================
// SMALL BUILT-IN OPENING REFERENCE
// ======================================================
// Book labels are used only for recognized lines below. This is a small
// offline reference, not a complete opening database.

const BUILT_IN_BOOK_LINES = [
    "e4 e5 Nf3 Nc6 Bc4 Bc5",
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7",
    "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3",
    "e4 e5 Nf3 Nc6 d4 exd4 Nxd4",
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3",
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4",
    "e4 e6 d4 d5 Nc3 Nf6",
    "e4 e6 d4 d5 e5 c5",
    "d4 d5 c4 e6 Nc3 Nf6 Bg5",
    "d4 d5 c4 c6 Nf3 Nf6 Nc3",
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6",
    "d4 Nf6 c4 e6 Nc3 Bb4",
    "d4 Nf6 Nf3 g6 Bf4",
    "d4 Nf6 Nf3 e6 g3 d5 Bg2",
    "d4 f5 g3 Nf6 Bg2 g6",
    "e4 e5 f4 exf4 Nf3",
    "e4 e5 d4 exd4 c3",
    "e4 Nc6 d4 d5 Nc3"
].map(line => line.split(/\s+/));

function normalizeSan(san) {
    return String(san || "").replace(/[+#?!]+/g, "");
}

function isKnownBookMove(index) {
    const played = gameData.positions
        .slice(1, index + 1)
        .map(position => normalizeSan(position.san));

    if (!played.length) return false;

    return BUILT_IN_BOOK_LINES.some(line =>
        played.length <= line.length &&
        played.every((move, i) => move === normalizeSan(line[i]))
    );
}

function isEngineBestMove(before, after) {
    const bestMove = before.analysis && before.analysis.bestMove;
    if (!bestMove || !after.from || !after.to) return false;

    const playedUci = (after.from + after.to + (after.promotion || "")).toLowerCase();
    return playedUci === String(bestMove).toLowerCase();
}

async function isSoundPieceSacrifice(before, after, moverBefore, moverAfter, pawnLoss) {
    // A Brilliant/Spark candidate must first be a top or near-top engine move.
    // The old detector required the engine PV to capture the piece and then
    // recover material inside a short PV. That missed sound sacrifices whose
    // opponent declines the capture, or whose compensation is positional.
    const nearBest = after.bestMovePlayed || pawnLoss <= 0.18;
    if (!nearBest || moverBefore >= 300 || moverAfter < -75) return false;

    let position;
    try {
        position = new Chess(after.fen);
    } catch (error) {
        return false;
    }

    const movedPiece = position.get(after.to);
    if (!movedPiece || !["n", "b", "r", "q"].includes(movedPiece.type)) {
        return false;
    }

    // A genuine piece sacrifice gives the opponent a legal way to take the
    // newly moved piece. Test those capture continuations with Stockfish,
    // rather than relying on a short principal-variation string heuristic.
    const moverColor = after.side;

    // First inspect Stockfish's full continuation. Sometimes the opponent
    // cannot take the offered piece immediately because they must answer a
    // check or another forcing move first.
    const pvMoves = String(after.analysis?.pv || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const pvPosition = new Chess(after.fen);
    for (const uci of pvMoves.slice(0, 10)) {
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
        let pvMove;
        try {
            pvMove = pvPosition.move({
                from: uci.slice(0, 2),
                to: uci.slice(2, 4),
                promotion: uci[4]
            });
        } catch (error) {
            break;
        }
        if (!pvMove) break;
        if (
            pvMove.color !== moverColor &&
            pvMove.to === after.to &&
            pvMove.captured === movedPiece.type
        ) {
            // The engine's best reply accepts the sacrifice, while its
            // evaluation still says the sacrificing side is doing fine.
            return moverAfter >= -75;
        }
        if (pvMove.color === moverColor && pvMove.from === after.to) {
            break;
        }
    }

    const captures = position.moves({ verbose: true }).filter(move =>
        move.to === after.to && move.captured === movedPiece.type
    );

    if (!captures.length) return false;

    const validationDepth = Math.max(12, ENGINE_DEPTH - 2);

    for (const capture of captures.slice(0, 3)) {
        try {
            const capturePosition = new Chess(after.fen);
            const madeCapture = capturePosition.move({
                from: capture.from,
                to: capture.to,
                promotion: capture.promotion
            });
            if (!madeCapture) continue;

            const captureFen = capturePosition.fen();
            const captureAnalysis = await evaluateFen(captureFen, validationDepth);
            const captureWhiteScore = scoreFromWhitePerspective(
                captureAnalysis.evaluation,
                captureFen
            );
            if (captureWhiteScore === null) continue;

            const moverAfterCapture = moverColor === "w"
                ? captureWhiteScore
                : -captureWhiteScore;

            // The opponent can take the offered piece, yet the player who
            // sacrificed it is not left in a clearly bad position. Allow a
            // little search noise, but reject simple hanging-piece blunders.
            if (
                moverAfterCapture >= -75 &&
                moverAfterCapture >= moverAfter - 110
            ) {
                return true;
            }
        } catch (error) {
            // If an optional sacrifice-validation search fails, fall back to
            // the ordinary classification rather than failing the whole game.
            continue;
        }
    }

    return false;
}

// ======================================================
// CLASSIFY MOVE
// ======================================================

async function classifyMove(index) {
    const after = gameData.positions[index];
    const before = gameData.positions[index - 1];
    if (!before.analysis || !after.analysis) return;

    const beforeScore = before.analysis.whiteScore;
    const afterScore = after.analysis.whiteScore;
    if (beforeScore === null || afterScore === null) return;

    // Evaluations are converted to the perspective of the player who made
    // this move. Comparing the best evaluation before and after the played
    // move gives an engine-estimated centipawn loss (CPL).
    const moverBefore = after.side === "w" ? beforeScore : -beforeScore;
    const moverAfter = after.side === "w" ? afterScore : -afterScore;
    const pawnLoss = Math.max(0, moverBefore - moverAfter) / 100;
    const centipawnLoss = pawnLoss * 100;

    // Keep the expected-points estimate for the accuracy display only. The
    // move label itself uses centipawn loss, as Chessigma publicly describes
    // its broad grading approach; its exact thresholds are not public.
    const expectedBefore = scoreToExpectedScore(moverBefore);
    const expectedAfter = scoreToExpectedScore(moverAfter);
    const expectedPointsLoss = Math.max(0, expectedBefore - expectedAfter);

    after.loss = pawnLoss;
    after.centipawnLoss = centipawnLoss;
    after.expectedPointsLoss = expectedPointsLoss;
    after.accuracy = lossToAccuracy(expectedPointsLoss);

    const bestMove = isEngineBestMove(before, after);
    after.bestMovePlayed = bestMove;
    const bookMove = isKnownBookMove(index);

    const brilliantCandidate = await isSoundPieceSacrifice(
        before,
        after,
        moverBefore,
        moverAfter,
        pawnLoss
    );

    // Great is reserved for a precise move that converts an opponent's
    // serious error into a clear advantage. It is separate from the sacrifice
    // test used for Brilliant/Spark.
    const greatCandidate = bestMove &&
        ["Mistake", "Blunder"].includes(before.classification) &&
        moverBefore >= 150 &&
        moverAfter >= 150 &&
        centipawnLoss <= 15;

    const opponentErr = ["Mistake", "Blunder"].includes(before.classification);
    const missedOpportunity = opponentErr &&
        moverBefore >= 150 &&
        moverAfter <= 0 &&
        centipawnLoss >= 30 &&
        !bestMove;

    if (bookMove) {
        after.classification = "Book";
    } else if (brilliantCandidate) {
        after.classification = "Brilliant";
    } else if (greatCandidate) {
        after.classification = "Great";
    } else if (bestMove) {
        after.classification = "Best";
    } else if (missedOpportunity) {
        after.classification = "Miss";
    } else {
        after.classification = classifyCentipawnLoss(centipawnLoss);
    }
}

// Public information from Chessigma describes a centipawn-loss-based grade
// scale, but does not publish its exact thresholds. These are ChessScope's
// explicit, tunable thresholds and must be calibrated against real PGNs.
function classifyCentipawnLoss(loss) {
    if (loss <= 10) return "Excellent";
    if (loss <= 25) return "Good";
    if (loss <= 50) return "Inaccuracy";
    if (loss <= 100) return "Mistake";
    return "Blunder";
}

// Chessigma's precise accuracy formula is not public. This smooth score
// mapping is retained for the separate accuracy estimate, not move labels.
function scoreToExpectedScore(centipawns) {
    const cp = Math.max(-100000, Math.min(100000, Number(centipawns) || 0));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// ======================================================
// ACCURACY
// ======================================================

// Published Lichess move-accuracy curve; input is the loss in expected-score
// percentage points, not raw pawn/centipawn loss.
function lossToAccuracy(expectedPointsLoss) {
    if (expectedPointsLoss <= 0) return 100;

    const accuracy =
        103.1668 * Math.exp(-0.04354 * expectedPointsLoss) - 3.1669;

    return Math.max(0, Math.min(100, accuracy));
}

// ======================================================
// FINAL STATS
// ======================================================

function calculateFinalStats() {

    if (!gameData) {
        return;
    }

    const white =
        createEmptyStats();

    const black =
        createEmptyStats();

    for (
        let i = 1;
        i < gameData.positions.length;
        i++
    ) {

        const move =
            gameData.positions[i];

        if (
            !move.classification
        ) {

            continue;
        }

        const stats =
            move.side === "w"
                ? white
                : black;

        stats[
            move.classification
        ]++;

        stats.totalAccuracy +=
            move.accuracy;

        stats.moves++;
    }

    gameData.whiteStats =
        white;

    gameData.blackStats =
        black;

    gameData.whiteAccuracy =
        white.moves
            ? white.totalAccuracy /
                white.moves
            : 0;

    gameData.blackAccuracy =
        black.moves
            ? black.totalAccuracy /
                black.moves
            : 0;
}

function renderCriticalMoments() {
    const element = document.getElementById("ca-critical-moments");
    if (!element || !gameData) return;

    const moments = gameData.positions
        .map((position, index) => ({ position, index }))
        .filter(({ position }) => ["Inaccuracy", "Mistake", "Miss", "Blunder"].includes(position.classification))
        .sort((a, b) => (b.position.expectedPointsLoss || 0) - (a.position.expectedPointsLoss || 0))
        .slice(0, 5)
        .sort((a, b) => a.index - b.index);

    if (!moments.length) {
        element.innerHTML = `<p class="cs-empty-note">${gameData.analyzed ? "No major turning points were flagged by the current grading model." : "The engine is still reviewing the rest of the game."}</p>`;
        return;
    }

    element.innerHTML = "";
    moments.forEach(({ position, index }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cs-critical-item";
        button.innerHTML = `<span class="cs-critical-move">${position.moveNumber}${position.side === "w" ? "." : "..."} ${escapeHtml(position.san)}</span>${classificationMarkup(position.classification)}<span class="cs-critical-loss">−${(position.expectedPointsLoss || 0).toFixed(1)} pts</span>`;
        button.addEventListener("click", () => {
            stopAutoplay();
            goToPosition(index);
        });
        element.appendChild(button);
    });
}

// ======================================================
// UPDATE ANALYSIS UI
// ======================================================

function updateAnalysisUI() {

    if (!gameData) {
        return;
    }

    const whiteAccuracy =
        document.getElementById(
            "ca-white-accuracy"
        );

    const blackAccuracy =
        document.getElementById(
            "ca-black-accuracy"
        );

    if (whiteAccuracy) {

        whiteAccuracy.textContent =
            gameData.whiteAccuracy
                ? `${gameData.whiteAccuracy.toFixed(1)}%`
                : "—";
    }

    if (blackAccuracy) {

        blackAccuracy.textContent =
            gameData.blackAccuracy
                ? `${gameData.blackAccuracy.toFixed(1)}%`
                : "—";
    }

    updateCountGrid(
        "ca-white-counts",
        gameData.whiteStats
    );

    updateCountGrid(
        "ca-black-counts",
        gameData.blackStats
    );

    drawEvaluationGraph();

    updateMoveButtonClassifications();
    renderCriticalMoments();
}

// ======================================================
// UPDATE MOVE BUTTON COLORS
// ======================================================

function updateMoveButtonClassifications() {

    const moveButtons =
        document.querySelectorAll(
            ".ca-move-button"
        );

    gameData.positions.forEach(
        (
            position,
            index
        ) => {

            const button =
                moveButtons[index];

            if (!button) {
                return;
            }

            const badge = button.querySelector(".ca-move-badge");

            if (position.classification) {
                button.dataset.classification = position.classification;
                if (badge) badge.innerHTML = classificationMarkup(position.classification);
            } else {
                delete button.dataset.classification;
                if (badge) badge.innerHTML = "";
            }
        }
    );
}

// ======================================================
// COUNT GRID
// ======================================================

function updateCountGrid(
    elementId,
    stats
) {

    const element =
        document.getElementById(
            elementId
        );

    if (!element) {
        return;
    }

    const classifications = [
        "Book", "Brilliant", "Great", "Best", "Excellent",
        "Good", "Inaccuracy", "Mistake", "Miss", "Blunder"
    ];

    element.innerHTML = "";

    classifications.forEach(
        classification => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "ca-count-row";

            const left =
                document.createElement(
                    "span"
                );

            left.className =
                "ca-count-left";

            const info = getClassificationPresentation(classification);
            left.innerHTML = `<span class="cs-count-icon" aria-hidden="true">${info.icon}</span><span>${escapeHtml(info.label)}</span>`;

            const right =
                document.createElement(
                    "span"
                );

            right.className =
                "ca-count-right";

            right.textContent =
                stats[classification];

            row.appendChild(left);
            row.appendChild(right);

            element.appendChild(row);
        }
    );
}

// ======================================================
// EVALUATION GRAPH
// ======================================================

function drawEvaluationGraph() {

    const svg =
        document.getElementById(
            "ca-eval-graph"
        );

    if (
        !svg ||
        !gameData
    ) {

        return;
    }

    const evaluated =
        gameData.positions.filter(
            position =>
                position.analysis &&
                position.analysis.whiteScore !== null
        );

    svg.innerHTML = "";

    if (
        evaluated.length === 0
    ) {

        return;
    }

    const width = 900;
    const height = 180;
    const padding = 12;

    const maxEvaluation =
        5;

    svg.setAttribute(
        "viewBox",
        `0 0 ${width} ${height}`
    );

    // --------------------------------------------------
    // ZERO LINE
    // --------------------------------------------------

    const zeroY =
        height / 2;

    const zeroLine =
        document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
        );

    zeroLine.setAttribute(
        "x1",
        "0"
    );

    zeroLine.setAttribute(
        "x2",
        width
    );

    zeroLine.setAttribute(
        "y1",
        zeroY
    );

    zeroLine.setAttribute(
        "y2",
        zeroY
    );

    zeroLine.setAttribute(
        "stroke",
        "rgba(255,255,255,0.18)"
    );

    svg.appendChild(
        zeroLine
    );

    // --------------------------------------------------
    // POINTS
    // --------------------------------------------------

    const points =
        evaluated.map(
            (
                position,
                index
            ) => {

                const score =
                    position.analysis.whiteScore;

                const pawns =
                    Math.max(
                        -maxEvaluation,
                        Math.min(
                            maxEvaluation,
                            score / 100
                        )
                    );

                const x =
                    padding +
                    (
                        index /
                        Math.max(
                            1,
                            evaluated.length - 1
                        )
                    ) *
                    (
                        width -
                        padding * 2
                    );

                const y =
                    zeroY -
                    (
                        pawns /
                        maxEvaluation
                    ) *
                    (
                        height / 2 -
                        padding
                    );

                return {
                    x,
                    y,
                    position
                };
            }
        );

    // --------------------------------------------------
    // AREA
    // --------------------------------------------------

    let areaData =
        `M ${points[0].x} ${zeroY} `;

    points.forEach(
        point => {

            areaData +=
                `L ${point.x} ${point.y} `;
        }
    );

    areaData +=
        `L ${points[points.length - 1].x} ${zeroY} Z`;

    const area =
        document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
        );

    area.setAttribute(
        "d",
        areaData
    );

    area.setAttribute(
        "fill",
        "rgba(255,255,255,0.08)"
    );

    svg.appendChild(area);

    // --------------------------------------------------
    // LINE
    // --------------------------------------------------

    let lineData = "";

    points.forEach(
        (
            point,
            index
        ) => {

            lineData +=
                `${index === 0 ? "M" : "L"} ` +
                `${point.x} ${point.y} `;
        }
    );

    const line =
        document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
        );

    line.setAttribute(
        "d",
        lineData
    );

    line.setAttribute(
        "fill",
        "none"
    );

    line.setAttribute(
        "stroke",
        "#ffffff"
    );

    line.setAttribute(
        "stroke-width",
        "3"
    );

    line.setAttribute(
        "stroke-linejoin",
        "round"
    );

    line.setAttribute(
        "stroke-linecap",
        "round"
    );

    svg.appendChild(line);

    // --------------------------------------------------
    // DOTS
    // --------------------------------------------------

    points.forEach(
        point => {

            const classification =
                point.position.classification;

            let dotColor =
                "#7aa7d9";

            if (
                classification === "Best"
            ) {

                dotColor =
                    "#a9d34f";

            } else if (
                classification === "Excellent"
            ) {

                dotColor =
                    "#6bd15c";

            } else if (
                classification === "Inaccuracy"
            ) {

                dotColor =
                    "#ffd03c";

            } else if (
                classification === "Mistake"
            ) {

                dotColor =
                    "#ff9c45";

            } else if (
                classification === "Blunder"
            ) {

                dotColor =
                    "#ff4e4e";
            }

            const circle =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "circle"
                );

            circle.setAttribute(
                "cx",
                point.x
            );

            circle.setAttribute(
                "cy",
                point.y
            );

            circle.setAttribute(
                "r",
                classification
                    ? "4"
                    : "2"
            );

            circle.setAttribute(
                "fill",
                dotColor
            );

            svg.appendChild(circle);
        }
    );
}

// ======================================================
// UPDATE CURRENT POSITION ENGINE DATA
// ======================================================

function updateCurrentEnginePanel() {

    if (!gameData) {
        return;
    }

    const position =
        gameData.positions[
            currentPosition
        ];

    const evaluationElement =
        document.getElementById(
            "ca-engine-evaluation"
        );

    const bestElement =
        document.getElementById(
            "ca-engine-best"
        );

    const playedElement =
        document.getElementById(
            "ca-engine-played"
        );

    const qualityElement =
        document.getElementById(
            "ca-engine-quality"
        );

    const pvElement =
        document.getElementById(
            "ca-engine-pv"
        );

    const depthElement = document.getElementById("ca-engine-depth");
    if (depthElement) {
        const depthSource = currentPosition === 0 ? position : gameData.positions[currentPosition - 1];
        depthElement.textContent = depthSource.analysis?.depth ? `DEPTH ${depthSource.analysis.depth}` : "DEPTH —";
    }

    // Starting position
    if (
        currentPosition === 0
    ) {

        if (evaluationElement) {
            evaluationElement.textContent =
                position.analysis
                    ? formatEngineScore(
                        position.analysis.evaluation,
                        position.fen
                    )
                    : "Analyzing...";
        }

        if (bestElement) {

            bestElement.textContent =
                position.analysis
                    ? convertBestMoveToSan(
                        position.fen,
                        position.analysis.bestMove
                    )
                    : "Analyzing...";
        }

        if (playedElement) {
            playedElement.textContent =
                "—";
        }

        if (qualityElement) {
            qualityElement.textContent =
                "Starting Position";
        }

        if (pvElement) {

            pvElement.textContent =
                position.analysis
                    ? convertPvToSan(
                        position.fen,
                        position.analysis.pv
                    )
                    : "—";
        }

        return;
    }

    // --------------------------------------------------
    // For a move, use the ENGINE RESULT BEFORE
    // THE MOVE to determine the best move.
    // --------------------------------------------------

    const before =
        gameData.positions[
            currentPosition - 1
        ];

    const after =
        gameData.positions[
            currentPosition
        ];

    // Evaluation after the move
    if (evaluationElement) {

        evaluationElement.textContent =
            after.analysis
                ? formatEngineScore(
                    after.analysis.evaluation,
                    after.fen
                )
                : "Analyzing...";
    }

    // Best move BEFORE the player's move
    if (bestElement) {

        bestElement.textContent =
            before.analysis
                ? convertBestMoveToSan(
                    before.fen,
                    before.analysis.bestMove
                )
                : "Analyzing...";
    }

    // Actual move played
    if (playedElement) {

        playedElement.textContent =
            after.san;
    }

    // Classification
    if (qualityElement) {

        qualityElement.innerHTML = after.classification
            ? `${classificationMarkup(after.classification)}<small class="cs-loss-note">${after.loss.toFixed(2)} pawn loss · estimated</small>`
            : "Analyzing...";
    }

    // Principal variation BEFORE move
    if (pvElement) {

        pvElement.textContent =
            before.analysis
                ? convertPvToSan(
                    before.fen,
                    before.analysis.pv
                )
                : "—";
    }
}

// ======================================================
// EVALUATION SIDEBAR
// ======================================================

function updateEvaluationSidebar() {

    const label =
        document.getElementById(
            "ca-eval-label"
        );

    const fill =
        document.getElementById(
            "ca-eval-bar-fill"
        );

    if (!label || !fill) {
        return;
    }

    if (!gameData) {

        label.textContent =
            "Waiting";

        fill.style.height =
            "50%";

        return;
    }

    const position =
        gameData.positions[
            currentPosition
        ];

    if (
        !position.analysis ||
        position.analysis.whiteScore === null
    ) {

        label.textContent =
            "Analyzing";

        fill.style.height =
            "50%";

        return;
    }

    const whiteScore =
        position.analysis.whiteScore;

    const whitePawns =
        whiteScore / 100;

    // --------------------------------------------------
    // Convert evaluation into bar percentage.
    //
    // -5 = mostly Black
    //  0 = equal
    // +5 = mostly White
    // --------------------------------------------------

    const clamped =
        Math.max(
            -5,
            Math.min(
                5,
                whitePawns
            )
        );

    const whitePercent =
        50 +
        (
            Math.tanh(
                clamped / 2
            ) *
            45
        );

    fill.style.height =
        `${whitePercent}%`;

    // --------------------------------------------------
    // Label
    // --------------------------------------------------

    if (
        position.analysis.evaluation &&
        position.analysis.evaluation.type ===
            "mate"
    ) {

        const mateScore =
            position.analysis.evaluation.value;

        let whiteMateScore =
            mateScore;

        if (
            position.fen.split(" ")[1] === "b"
        ) {

            whiteMateScore =
                -mateScore;
        }

        if (
            whiteMateScore > 0
        ) {

            label.textContent =
                "WHITE • MATE";

        } else {

            label.textContent =
                "BLACK • MATE";
        }

        return;
    }

    if (
        whiteScore > 100
    ) {

        label.textContent =
            `WHITE • +${whitePawns.toFixed(2)}`;

    } else if (
        whiteScore < -100
    ) {

        label.textContent =
            `BLACK • ${whitePawns.toFixed(2)}`;

    } else {

        label.textContent =
            `EQUAL • ${whitePawns >= 0 ? "+" : ""}${whitePawns.toFixed(2)}`;
    }
}

// ======================================================
// RENDER POSITION
// ======================================================

function renderPosition() {

    if (!gameData) {
        return;
    }

    const position =
        gameData.positions[
            currentPosition
        ];

    const boardElement =
        document.getElementById(
            "ca-board"
        );

    const currentMoveElement =
        document.getElementById(
            "ca-current-move"
        );

    const currentClassificationElement =
        document.getElementById(
            "ca-current-classification"
        );

    const fenElement =
        document.getElementById(
            "ca-fen"
        );

    const captionElement =
        document.getElementById(
            "ca-board-caption"
        );

    if (!boardElement) {
        return;
    }

    // ==================================================
    // UPDATE SIDEBAR
    // ==================================================

    updateEvaluationSidebar();

    // ==================================================
    // UPDATE ENGINE PANEL
    // ==================================================

    updateCurrentEnginePanel();

    // ==================================================
    // LOAD FEN
    // ==================================================

    const chess =
        new Chess();

    const loaded =
        chess.load(
            position.fen
        );

    if (!loaded) {

        console.error(
            "Could not load FEN:",
            position.fen
        );

        return;
    }

    // ==================================================
    // BOARD
    // ==================================================

    const board =
        chess.board();

    boardElement.innerHTML =
        "";

    // ==================================================
    // KING IN CHECK
    // ==================================================

    let checkedKingSquare =
        null;

    if (
        chess.in_check()
    ) {

        const sideInCheck =
            chess.turn();

        for (
            let row = 0;
            row < 8;
            row++
        ) {

            for (
                let col = 0;
                col < 8;
                col++
            ) {

                const piece =
                    board[row][col];

                if (
                    piece &&
                    piece.type === "k" &&
                    piece.color ===
                        sideInCheck
                ) {

                    checkedKingSquare =
                        String.fromCharCode(
                            97 + col
                        ) +
                        (8 - row);
                }
            }
        }
    }

    // ==================================================
    // DRAW 64 SQUARES
    // ==================================================

    for (
        let row = 0;
        row < 8;
        row++
    ) {

        for (
            let col = 0;
            col < 8;
            col++
        ) {

            const piece =
                board[row][col];

            const squareName =
                String.fromCharCode(
                    97 + col
                ) +
                (8 - row);

            const square =
                document.createElement(
                    "div"
                );

            square.classList.add(
                "ca-square"
            );

            // Board colors
            if (
                (row + col) % 2 === 0
            ) {

                square.classList.add(
                    "ca-light"
                );

            } else {

                square.classList.add(
                    "ca-dark"
                );
            }

            // ------------------------------------------------
            // LAST MOVE FROM
            // ------------------------------------------------

            if (
                position.from &&
                squareName ===
                    position.from
            ) {

                square.classList.add(
                    "ca-last-from"
                );
            }

            // ------------------------------------------------
            // LAST MOVE TO
            // ------------------------------------------------

            if (
                position.to &&
                squareName ===
                    position.to
            ) {

                square.classList.add("ca-last-to");
                const moveGradeClass = position.classification
                    ? `ca-last-to-${String(position.classification).toLowerCase()}`
                    : "ca-last-to-pending";
                square.classList.add(moveGradeClass);
            }

            // ------------------------------------------------
            // CHECK
            // ------------------------------------------------

            if (
                squareName ===
                    checkedKingSquare
            ) {

                square.classList.add(
                    "ca-check"
                );
            }

            // ------------------------------------------------
            // FILE
            // ------------------------------------------------

            if (
                row === 7
            ) {

                const file =
                    document.createElement(
                        "span"
                    );

                file.className =
                    "ca-coordinate ca-file";

                file.textContent =
                    String.fromCharCode(
                        97 + col
                    );

                square.appendChild(
                    file
                );
            }

            // ------------------------------------------------
            // RANK
            // ------------------------------------------------

            if (
                col === 0
            ) {

                const rank =
                    document.createElement(
                        "span"
                    );

                rank.className =
                    "ca-coordinate ca-rank";

                rank.textContent =
                    8 - row;

                square.appendChild(
                    rank
                );
            }

            // ------------------------------------------------
            // PIECE
            // ------------------------------------------------

            if (piece) {

                const pieceElement =
                    document.createElement(
                        "span"
                    );

                pieceElement.className =
                    piece.color === "w"
                        ? "ca-piece ca-piece-white"
                        : "ca-piece ca-piece-black";

                pieceElement.textContent =
                    getUnicodePiece(
                        piece.color,
                        piece.type
                    );

                // --------------------------------------------
                // MARK THE PIECE THAT JUST MOVED
                // --------------------------------------------

                if (
                    position.to &&
                    squareName ===
                        position.to
                ) {

                    const marker =
                        document.createElement(
                            "span"
                        );

                    marker.className =
                        "ca-move-marker";

                    pieceElement.appendChild(
                        marker
                    );
                }

                square.appendChild(
                    pieceElement
                );
            }

            boardElement.appendChild(
                square
            );
        }
    }

    // ==================================================
    // CURRENT MOVE
    // ==================================================

    if (currentMoveElement) {
        currentMoveElement.textContent =
            currentPosition === 0 ? "Starting Position" : position.label;
    }

    if (currentClassificationElement) {
        currentClassificationElement.innerHTML = currentPosition === 0
            ? '<span class="cs-empty-classification">Initial position</span>'
            : (position.classification
                ? classificationMarkup(position.classification)
                : '<span class="cs-empty-classification">Awaiting engine review</span>');
        currentClassificationElement.className =
            "ca-current-classification" +
            (position.classification
                ? " ca-" + position.classification.toLowerCase()
                : "");
    }

    // ==================================================
    // CAPTION
    // ==================================================

    const turnName =
        chess.turn() === "w"
            ? "White"
            : "Black";

    if (
        captionElement
    ) {

        captionElement.textContent =
            currentPosition === 0

                ? "Initial chess position"

                : `${position.label} • ${turnName} to move`;
    }

    // ==================================================
    // FEN
    // ==================================================

    if (
        fenElement
    ) {

        fenElement.textContent =
            position.fen;
    }

    // ==================================================
    // ACTIVE MOVE
    // ==================================================

    const moveButtons =
        document.querySelectorAll(
            ".ca-move-button"
        );

    moveButtons.forEach(
        (
            button,
            index
        ) => {

            button.classList.remove(
                "ca-active"
            );

            if (
                index ===
                currentPosition
            ) {

                button.classList.add(
                    "ca-active"
                );
            }
        }
    );

    // ==================================================
    // IMPORTANT:
    // NO scrollIntoView()
    //
    // The page will remain where it is when you press
    // Next / Previous.
    // ==================================================

    // ==================================================
    // MOVE QUALITY STATUS
    // ==================================================

    const statusElement = document.getElementById("ca-engine-status");

    if (statusElement && gameData.analyzed) {
        if (currentPosition === 0) {
            delete statusElement.dataset.classification;
            statusElement.textContent = "♟ Initial position — select a move to review its quality.";
        } else {
            const quality = position.classification ? getClassificationPresentation(position.classification).label : "Move reviewed";
            statusElement.textContent = `${quality} move · ${position.label}`;
            if (position.classification) statusElement.dataset.classification = position.classification;
            else delete statusElement.dataset.classification;
        }
    }

}

// ======================================================
// MOVE LIST
// ======================================================

function renderMoveList() {

    const moveList =
        document.getElementById(
            "ca-move-list"
        );

    if (!moveList || !gameData) {
        return;
    }

    moveList.innerHTML =
        "";

    // --------------------------------------------------
    // START
    // --------------------------------------------------

    const startButton =
        document.createElement(
            "button"
        );

    startButton.className =
        "ca-move-button";

    startButton.textContent =
        "Start";

    startButton.addEventListener(
        "click",
        () => {

            stopAutoplay();

            goToPosition(0);
        }
    );

    moveList.appendChild(
        startButton
    );

    // --------------------------------------------------
    // MOVES
    // --------------------------------------------------

    gameData.positions.forEach(
        (
            position,
            index
        ) => {

            if (
                index === 0
            ) {

                return;
            }

            const button =
                document.createElement(
                    "button"
                );

            button.className =
                "ca-move-button";

            if (
                position.classification
            ) {

                button.dataset.classification =
                    position.classification;
            }

            const moveLabel =
                position.side === "w"

                    ? `${position.moveNumber}.`

                    : `${position.moveNumber}...`;

            button.innerHTML = `

                <span
                    class="ca-move-number">

                    ${moveLabel}

                </span>

                ${escapeHtml(
                    position.san
                )}

                <span class="ca-move-badge">
                    ${classificationMarkup(position.classification)}
                </span>
            `;

            button.addEventListener(
                "click",
                () => {

                    stopAutoplay();

                    goToPosition(
                        index
                    );
                }
            );

            moveList.appendChild(
                button
            );
        }
    );
}

// ======================================================
// ORIGINAL SYNTHESIZED CHESS SOUNDS (no copied third-party audio)
// ======================================================

function getSoundContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!soundAudioContext) soundAudioContext = new AudioContextClass();
    if (soundAudioContext.state === "suspended") soundAudioContext.resume().catch(() => {});
    return soundAudioContext;
}

function playUiTone(kind = "move") {
    if (!soundsEnabled) return;
    const ctx = getSoundContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const tones = kind === "check" ? [520, 390] : kind === "promotion" ? [540, 720, 900] : kind === "capture" ? [190, 125] : kind === "castle" ? [240, 330] : [220];
    tones.forEach((frequency, index) => {
        const start = now + index * (kind === "check" ? 0.075 : 0.045);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = kind === "promotion" ? "sine" : "triangle";
        osc.frequency.setValueAtTime(frequency, start);
        if (kind === "move" || kind === "capture") {
            osc.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.58), start + 0.065);
        }
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(kind === "capture" ? 1100 : 1800, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(kind === "promotion" ? 0.075 : 0.11, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === "promotion" ? 0.14 : 0.085));
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + (kind === "promotion" ? 0.15 : 0.095));
    });
}

function playMoveSound(position) {
    if (!soundsEnabled || !position || !position.fen) return;
    let kind = position.captured ? "capture" : "move";
    if (position.promotion) kind = "promotion";
    else if (String(position.flags || "").includes("k") || String(position.flags || "").includes("q")) kind = "castle";
    try {
        const chess = new Chess(position.fen);
        if (typeof chess.in_check === "function" && chess.in_check()) kind = "check";
    } catch (error) { /* Keep the normal move sound if position parsing fails. */ }
    playUiTone(kind);
}

// ======================================================
// GO TO POSITION
// ======================================================

function goToPosition(index) {

    if (!gameData) {
        return;
    }

    if (
        index < 0
    ) {

        index = 0;
    }

    if (
        index >=
        gameData.positions.length
    ) {

        index =
            gameData.positions.length - 1;
    }

    const previousPosition = currentPosition;
    currentPosition = index;

    if (index === previousPosition + 1) {
        playMoveSound(gameData.positions[index]);
    }

    renderPosition();
}

// ======================================================
// UNICODE PIECES
// ======================================================

function getUnicodePiece(
    color,
    type
) {

    const whitePieces = {

        p: "♙",
        n: "♘",
        b: "♗",
        r: "♖",
        q: "♕",
        k: "♔"
    };

    const blackPieces = {

        p: "♟",
        n: "♞",
        b: "♝",
        r: "♜",
        q: "♛",
        k: "♚"
    };

    return color === "w"
        ? whitePieces[type]
        : blackPieces[type];
}

// ======================================================
// PLAY / PAUSE
// ======================================================

function toggleAutoplay() {

    const playButton =
        document.getElementById(
            "ca-play"
        );

    if (!playButton) {
        return;
    }

    if (
        autoplayTimer
    ) {

        stopAutoplay();

        return;
    }

    playButton.textContent =
        "⏸ Pause";

    autoplayTimer =
        setInterval(
            () => {

                if (
                    currentPosition >=
                    gameData.positions.length - 1
                ) {

                    stopAutoplay();

                    return;
                }

                currentPosition++;

                playMoveSound(gameData.positions[currentPosition]);
                renderPosition();

            },
            700
        );
}

// ======================================================
// STOP AUTOPLAY
// ======================================================

function stopAutoplay() {

    if (
        autoplayTimer
    ) {

        clearInterval(
            autoplayTimer
        );

        autoplayTimer =
            null;
    }

    const playButton =
        document.getElementById(
            "ca-play"
        );

    if (playButton) {

        playButton.textContent =
            "▶ Play";
    }
}

// ======================================================
// KEYBOARD CONTROLS
// ======================================================

document.addEventListener(
    "keydown",
    event => {

        if (!gameData) {
            return;
        }

        // Don't interfere with PGN typing
        if (
            document.activeElement ===
                pgnInput ||

            document.activeElement.tagName ===
                "TEXTAREA" ||

            document.activeElement.tagName ===
                "INPUT"
        ) {

            return;
        }

        if (event.code === "Space") {
            event.preventDefault();
            toggleAutoplay();
            return;
        }

        if (
            event.key ===
            "ArrowLeft"
        ) {

            stopAutoplay();

            goToPosition(
                currentPosition - 1
            );

        } else if (
            event.key ===
            "ArrowRight"
        ) {

            goToPosition(
                currentPosition + 1
            );

        } else if (
            event.key ===
            "Home"
        ) {

            stopAutoplay();

            goToPosition(0);

        } else if (
            event.key ===
            "End"
        ) {

            stopAutoplay();

            goToPosition(
                gameData.positions.length - 1
            );
        }
    }
);

// ======================================================
// STOCKFISH INITIALIZATION
// ======================================================

function initStockfish() {

    if (enginePromise) {
        return enginePromise;
    }

    enginePromise =
        new Promise(
            (resolve, reject) => {

                // Keep this in the Promise executor scope so the worker callbacks
                // below can access it (a const inside try would be out of scope).
                const workerGeneration = ++engineGeneration;

                try {

                    stockfish =
                        new Worker(
                            "engine/stockfish-19-lite-single.js"
                        );

                } catch (error) {

                    enginePromise =
                        null;

                    reject(error);

                    return;
                }

                let gotUciOk = false;

                const timeout =
                    setTimeout(
                        () => {

                            if (workerGeneration !== engineGeneration) {
                                reject(new Error("Stockfish initialization cancelled."));
                                return;
                            }

                            enginePromise = null;

                            try {
                                stockfish.terminate();
                            } catch (e) {
                                // Ignore
                            }

                            reject(
                                new Error(
                                    "Stockfish initialization timeout."
                                )
                            );

                        },
                        20000
                    );

                stockfish.onmessage =
                    event => {

                        if (workerGeneration !== engineGeneration) {
                            return;
                        }

                        const line =
                            String(
                                event.data
                            ).trim();

                        console.log(
                            "[Stockfish]",
                            line
                        );

                        // --------------------------
                        // UCI OK
                        // --------------------------

                        if (
                            line ===
                            "uciok"
                        ) {

                            gotUciOk =
                                true;

                            stockfish.postMessage(
                                "isready"
                            );

                            return;
                        }

                        // --------------------------
                        // READY OK
                        // --------------------------

                        if (
                            line ===
                                "readyok" &&
                            gotUciOk
                        ) {

                            clearTimeout(
                                timeout
                            );

                            resolve();

                            return;
                        }

                        // --------------------------
                        // INFO
                        // --------------------------

                        if (
                            activeEngineRequest &&
                            line.startsWith(
                                "info "
                            )
                        ) {

                            parseEngineInfo(
                                line
                            );

                            return;
                        }

                        // --------------------------
                        // BESTMOVE
                        // --------------------------

                        if (
                            activeEngineRequest &&
                            line.startsWith(
                                "bestmove "
                            )
                        ) {

                            const request =
                                activeEngineRequest;

                            activeEngineRequest =
                                null;

                            const parts =
                                line.split(
                                    /\s+/
                                );

                            request.resolve({

                                bestMove:
                                    parts[1] ||
                                    null,

                                evaluation:
                                    request.evaluation,

                                depth:
                                    request.depth,

                                pv:
                                    request.pv
                            });

                            return;
                        }
                    };

                stockfish.onerror =
                    error => {

                        if (workerGeneration !== engineGeneration) {
                            return;
                        }

                        console.error(
                            "Stockfish worker error:",
                            error
                        );

                        if (
                            activeEngineRequest
                        ) {

                            activeEngineRequest.reject(
                                error
                            );

                            activeEngineRequest =
                                null;
                        }

                        enginePromise =
                            null;

                        reject(error);
                    };

                // Start UCI
                stockfish.postMessage(
                    "uci"
                );
            }
        );

    return enginePromise;
}

// ======================================================
// PARSE STOCKFISH INFO
// ======================================================

function parseEngineInfo(line) {

    if (!activeEngineRequest) {
        return;
    }

    // DEPTH
    const depthMatch =
        line.match(
            /\bdepth\s+(\d+)/
        );

    if (depthMatch) {

        activeEngineRequest.depth =
            Number(
                depthMatch[1]
            );
    }

    // SCORE
    const scoreMatch =
        line.match(
            /\bscore\s+(cp|mate)\s+(-?\d+)/
        );

    if (scoreMatch) {

        activeEngineRequest.evaluation = {

            type:
                scoreMatch[1],

            value:
                Number(
                    scoreMatch[2]
                )
        };
    }

    // PV
    const pvMatch =
        line.match(
            /\bpv\s+(.+)$/
        );

    if (pvMatch) {

        activeEngineRequest.pv =
            pvMatch[1].trim();
    }
}

// ======================================================
// EVALUATE FEN
// ======================================================

function evaluateFen(
    fen,
    depth = ENGINE_DEPTH
) {

    const cacheKey =
        `${fen}|${depth}`;

    // Use cached result if available
    if (
        engineCache.has(
            cacheKey
        )
    ) {

        return Promise.resolve(
            engineCache.get(
                cacheKey
            )
        );
    }

    return initStockfish()
        .then(
            () => {

                return new Promise(
                    (
                        resolve,
                        reject
                    ) => {

                        // Analysis is sequential. Never replace a live request:
                        // its bestmove could otherwise resolve the wrong position.
                        if (activeEngineRequest) {
                            reject(
                                new Error(
                                    "Stockfish is already analyzing another position."
                                )
                            );
                            return;
                        }

                        activeEngineRequest = {

                            resolve:
                                result => {

                                    engineCache.set(
                                        cacheKey,
                                        result
                                    );

                                    resolve(
                                        result
                                    );
                                },

                            reject:
                                reject,

                            evaluation:
                                null,

                            depth:
                                0,

                            pv:
                                ""
                        };

                        stockfish.postMessage(
                            `position fen ${fen}`
                        );

                        stockfish.postMessage(
                            `go depth ${depth}`
                        );
                    }
                );
            }
        );
}

// ======================================================
// FORMAT ENGINE SCORE
// ======================================================

function formatEngineScore(
    evaluation,
    fen
) {

    if (!evaluation) {
        return "Calculating...";
    }

    let value =
        Number(
            evaluation.value
        );

    // UCI score is from side-to-move perspective.
    if (
        fen.split(" ")[1] === "b"
    ) {

        value =
            -value;
    }

    // Mate
    if (
        evaluation.type ===
        "mate"
    ) {

        if (
            value > 0
        ) {

            return `M White in ${Math.abs(value)}`;

        } else {

            return `M Black in ${Math.abs(value)}`;
        }
    }

    const pawns =
        value / 100;

    if (
        pawns >= 0
    ) {

        return `+${pawns.toFixed(2)}`;
    }

    return pawns.toFixed(2);
}

// ======================================================
// UCI → SAN
// ======================================================

function convertBestMoveToSan(
    fen,
    uciMove
) {

    if (
        !uciMove ||
        uciMove === "(none)"
    ) {

        return "—";
    }

    try {

        const chess =
            new Chess();

        if (
            !chess.load(
                fen
            )
        ) {

            return uciMove;
        }

        const from =
            uciMove.substring(
                0,
                2
            );

        const to =
            uciMove.substring(
                2,
                4
            );

        const promotion =
            uciMove.length >= 5
                ? uciMove[4]
                : undefined;

        const move =
            chess.move({

                from:
                    from,

                to:
                    to,

                promotion:
                    promotion
            });

        return move
            ? move.san
            : uciMove;

    } catch (error) {

        console.error(
            "UCI to SAN error:",
            error
        );

        return uciMove;
    }
}

// ======================================================
// PV → SAN
// ======================================================

function convertPvToSan(
    fen,
    pv
) {

    if (!pv) {
        return "—";
    }

    try {

        const chess =
            new Chess();

        if (
            !chess.load(
                fen
            )
        ) {

            return pv;
        }

        const uciMoves =
            pv.split(/\s+/);

        const sanMoves = [];

        for (
            let i = 0;
            i < uciMoves.length;
            i++
        ) {

            const uci =
                uciMoves[i];

            if (
                uci.length < 4
            ) {

                break;
            }

            const from =
                uci.substring(
                    0,
                    2
                );

            const to =
                uci.substring(
                    2,
                    4
                );

            const promotion =
                uci.length >= 5
                    ? uci[4]
                    : undefined;

            const move =
                chess.move({

                    from:
                        from,

                    to:
                        to,

                    promotion:
                        promotion
                });

            if (!move) {
                break;
            }

            sanMoves.push(
                move.san
            );
        }

        return sanMoves.length
            ? sanMoves.join(" ")
            : pv;

    } catch (error) {

        console.error(
            "PV conversion error:",
            error
        );

        return pv;
    }
}
