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
const ENGINE_DEPTH = 12;

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

    if (document.getElementById("chess-analyzer-styles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "chess-analyzer-styles";

    style.textContent = `

        /* =============================================
           MAIN
        ============================================= */

        .ca-wrapper {
            width: 100%;
            margin-top: 30px;
        }

        /* =============================================
           GAME INFORMATION
        ============================================= */

        .ca-game-info {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 22px;
        }

        .ca-info-card {
            padding: 16px;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            background: rgba(255,255,255,0.04);
        }

        .ca-info-label {
            display: block;
            font-size: 12px;
            opacity: 0.6;
            margin-bottom: 5px;
        }

        .ca-info-value {
            font-size: 16px;
            font-weight: 700;
            word-break: break-word;
        }

        /* =============================================
           MAIN ANALYZER LAYOUT
        ============================================= */

        .ca-analyzer {
            display: grid;
            grid-template-columns:
                minmax(280px, 600px)
                minmax(300px, 1fr);

            gap: 28px;
            align-items: start;
        }

        .ca-board-area {
            width: 100%;
        }

        /* =============================================
           BOARD + EVALUATION BAR
        ============================================= */

        .ca-board-line {
            width: min(100%, 600px);
            margin: 0 auto;

            display: grid;
            grid-template-columns: 42px minmax(0, 1fr);

            gap: 8px;
            align-items: stretch;
        }

        .ca-board {
            width: 100%;
            aspect-ratio: 1 / 1;

            display: grid;
            grid-template-columns: repeat(8, 1fr);

            border-radius: 14px;
            overflow: hidden;

            box-shadow:
                0 18px 45px rgba(0,0,0,0.35);
        }

        /* =============================================
           EVALUATION SIDEBAR
        ============================================= */

        .ca-eval-sidebar {
            display: flex;
            flex-direction: column;
            align-items: center;

            min-width: 0;
        }

        .ca-eval-label {
            width: 100%;
            margin-bottom: 7px;

            text-align: center;

            font-size: 9px;
            font-weight: 900;

            line-height: 1.2;

            word-break: break-word;
        }

        .ca-eval-bar {
            position: relative;

            width: 100%;
            height: 100%;

            min-height: 300px;

            border-radius: 8px;

            overflow: hidden;

            background: #202020;

            border:
                1px solid rgba(255,255,255,0.15);

            box-shadow:
                inset 0 0 12px rgba(0,0,0,0.28);
        }

        /*
           White occupies the bottom.
           Height changes according to evaluation.
        */

        .ca-eval-bar-fill {
            position: absolute;

            left: 0;
            bottom: 0;

            width: 100%;
            height: 50%;

            background: #f2f2f2;

            transition:
                height 0.35s ease;
        }

        .ca-eval-bar-top,
        .ca-eval-bar-bottom {
            position: absolute;

            left: 0;

            width: 100%;

            z-index: 5;

            text-align: center;

            font-size: 7px;
            font-weight: 900;

            pointer-events: none;
        }

        .ca-eval-bar-top {
            top: 5px;
            color: #ffffff;
        }

        .ca-eval-bar-bottom {
            bottom: 5px;
            color: #111111;
        }

        .ca-eval-zero {
            position: absolute;

            top: 50%;
            left: 0;

            width: 100%;
            height: 2px;

            z-index: 4;

            background:
                rgba(110,110,110,0.75);

            pointer-events: none;
        }

        /* =============================================
           BOARD SQUARES
        ============================================= */

        .ca-square {
            position: relative;

            aspect-ratio: 1 / 1;

            display: flex;
            align-items: center;
            justify-content: center;

            user-select: none;
        }

        .ca-light {
            background: #e7edf2;
        }

        .ca-dark {
            background: #547c68;
        }

        /* =============================================
           CHESS PIECES
        ============================================= */

        .ca-piece {
            position: relative;
            display: inline-block;

            font-family:
                "Segoe UI Symbol",
                "Noto Sans Symbols 2",
                "Arial Unicode MS",
                sans-serif;

            font-size:
                clamp(28px, 6vw, 58px);

            line-height: 1;

            filter:
                drop-shadow(
                    0 3px 2px rgba(0,0,0,0.30)
                );

            z-index: 2;
        }

        .ca-piece-white {
            color: #ffffff;
            -webkit-text-stroke: 1.2px #24313b;
            text-shadow:
                0 2px 0 #aeb9c2,
                0 4px 5px rgba(0,0,0,0.45);
        }

        .ca-piece-black {
            color: #17212a;
            -webkit-text-stroke: 1.1px #f5f7fa;
            text-shadow:
                0 2px 0 rgba(255,255,255,0.35),
                0 4px 5px rgba(0,0,0,0.45);
        }

        /* =============================================
           LAST MOVE HIGHLIGHT
        ============================================= */

        .ca-last-from {
            box-shadow:
                inset 0 0 0 5px
                rgba(255,235,59,0.40);
        }

        .ca-last-to {
            box-shadow:
                inset 0 0 0 5px
                rgba(255,235,59,0.75);
        }

        /*
           Small glowing sign on the piece that
           just moved.
        */

        .ca-move-marker {
            position: absolute;

            top: -7px;
            right: -8px;

            width: 11px;
            height: 11px;

            display: flex;
            align-items: center;
            justify-content: center;

            border-radius: 50%;

            background: #ffd737;

            border:
                2px solid #ffffff;

            box-shadow:
                0 0 0 3px
                rgba(255,215,55,0.22),

                0 0 12px
                rgba(255,215,55,0.90);

            z-index: 20;
        }

        .ca-move-marker::after {
            content: "";

            width: 4px;
            height: 4px;

            border-radius: 50%;

            background: #ffffff;
        }

        /* =============================================
           CHECK
        ============================================= */

        .ca-check {
            box-shadow:
                inset 0 0 0 6px
                rgba(255,70,70,0.85);
        }

        /* =============================================
           COORDINATES
        ============================================= */

        .ca-coordinate {
            position: absolute;

            font-size: 10px;
            font-weight: 700;

            opacity: 0.6;

            z-index: 3;
        }

        .ca-file {
            bottom: 4px;
            left: 5px;
        }

        .ca-rank {
            top: 4px;
            right: 5px;
        }

        .ca-board-caption {
            margin-top: 12px;

            text-align: center;

            opacity: 0.75;

            font-size: 14px;
        }

        /* =============================================
           CONTROLS
        ============================================= */

        .ca-controls {
            display: flex;
            flex-wrap: wrap;

            gap: 8px;

            margin-top: 18px;
        }

        .ca-control {
            border:
                1px solid rgba(255,255,255,0.10);

            background:
                rgba(255,255,255,0.06);

            color: inherit;

            border-radius: 9px;

            padding: 9px 13px;

            cursor: pointer;

            font-weight: 700;

            transition:
                background 0.15s ease,
                transform 0.15s ease;
        }

        .ca-control:hover {
            background:
                rgba(255,255,255,0.11);

            transform: translateY(-1px);
        }

        .ca-control:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        /* =============================================
           RIGHT PANEL
        ============================================= */

        .ca-panel {
            min-width: 0;

            padding: 20px;

            border-radius: 18px;

            border:
                1px solid rgba(255,255,255,0.08);

            background:
                rgba(255,255,255,0.04);
        }

        .ca-panel-title {
            margin: 0 0 14px;

            font-size: 21px;
        }

        /* =============================================
           STATUS
        ============================================= */

        .ca-engine-status {
            margin-top: 10px;
            padding: 11px 13px;
            border-radius: 10px;
            background: rgba(255,255,255,0.04);
            font-size: 13px;
            line-height: 1.45;
        }

        .ca-engine-status[data-classification="Brilliant"] { border-left: 3px solid #45d8c5; }
        .ca-engine-status[data-classification="Great"] { border-left: 3px solid #7ab7ff; }
        .ca-engine-status[data-classification="Best"] { border-left: 3px solid #a9d34f; }
        .ca-engine-status[data-classification="Excellent"] { border-left: 3px solid #6bd15c; }
        .ca-engine-status[data-classification="Good"] { border-left: 3px solid #8bb89b; }
        .ca-engine-status[data-classification="Book"] { border-left: 3px solid #b6a0ff; }
        .ca-engine-status[data-classification="Blunder"],
        .ca-engine-status[data-classification="Miss"] { border-left: 3px solid #ff5555; }

        /* =============================================
           PROGRESS
        ============================================= */

        .ca-progress-box {
            margin-bottom: 15px;
        }

        .ca-progress-track {
            width: 100%;
            height: 8px;

            margin-top: 8px;

            overflow: hidden;

            border-radius: 999px;

            background:
                rgba(255,255,255,0.08);
        }

        .ca-progress-fill {
            width: 0%;
            height: 100%;

            border-radius: 999px;

            background:
                linear-gradient(
                    90deg,
                    #44d07a,
                    #80e8ff
                );

            transition:
                width 0.18s ease;
        }

        /* =============================================
           CURRENT MOVE
        ============================================= */

        .ca-current-move {
            padding: 14px 16px;

            margin-top: 15px;

            margin-bottom: 14px;

            border-radius: 12px;

            background:
                rgba(255,255,255,0.05);
        }

        .ca-current-move-label {
            font-size: 12px;

            opacity: 0.6;

            margin-bottom: 5px;
        }

        .ca-current-move-value {
            font-size: 21px;

            font-weight: 800;
        }

        /* =============================================
           ENGINE STATS
        ============================================= */

        .ca-engine-grid {
            display: grid;

            grid-template-columns:
                repeat(2, minmax(0, 1fr));

            gap: 10px;

            margin-top: 12px;
        }

        .ca-engine-stat {
            padding: 13px;

            border-radius: 11px;

            background:
                rgba(255,255,255,0.035);
        }

        .ca-engine-stat-label {
            display: block;

            font-size: 11px;

            opacity: 0.55;

            margin-bottom: 4px;
        }

        .ca-engine-stat-value {
            display: block;

            font-size: 17px;

            font-weight: 800;

            word-break: break-word;
        }

        /* =============================================
           EVALUATION GRAPH
        ============================================= */

        .ca-evaluation {
            margin-top: 16px;

            overflow: hidden;

            border-radius: 14px;

            border:
                1px solid rgba(255,255,255,0.08);
        }

        .ca-evaluation-header {
            padding: 12px 14px;

            background:
                rgba(255,255,255,0.05);

            font-weight: 800;
        }

        #ca-eval-graph {
            display: block;

            width: 100%;
            height: 180px;

            background: #15181d;
        }

        /* =============================================
           ACCURACY
        ============================================= */

        .ca-accuracy-grid {
            display: grid;

            grid-template-columns:
                repeat(2, minmax(0,1fr));

            gap: 10px;

            margin-top: 15px;
        }

        .ca-accuracy-card {
            padding: 16px;

            border-radius: 14px;

            background:
                rgba(255,255,255,0.045);

            text-align: center;
        }

        .ca-accuracy-player {
            font-size: 13px;

            opacity: 0.65;
        }

        .ca-accuracy-value {
            display: block;

            margin-top: 5px;

            font-size: 30px;

            font-weight: 900;
        }

        /* =============================================
           MOVE COUNTS
        ============================================= */

        .ca-count-grid {
            display: grid;

            grid-template-columns:
                repeat(2,minmax(0,1fr));

            gap: 8px;

            margin-top: 10px;
        }

        .ca-count-row {
            display: flex;

            justify-content: space-between;

            padding: 9px 10px;

            border-radius: 9px;

            background:
                rgba(255,255,255,0.035);

            font-size: 13px;
        }

        .ca-count-left {
            opacity: 0.72;
        }

        .ca-count-right {
            font-weight: 800;
        }

        /* =============================================
           MOVE COLORS
        ============================================= */

        .ca-best {
            color: #9bdc4e;
        }

        .ca-excellent {
            color: #72d45c;
        }

        .ca-good {
            color: #8bb89b;
        }

        .ca-inaccuracy {
            color: #ffd23c;
        }

        .ca-mistake {
            color: #ff9b44;
        }

        .ca-blunder { color: #ff5555; }
        .ca-brilliant { color: #45d8c5; }
        .ca-great { color: #7ab7ff; }
        .ca-book { color: #b6a0ff; }
        .ca-miss { color: #ff7474; }

        .ca-move-badge {
            display: inline-block;
            margin-left: 6px;
            padding: 2px 5px;
            border-radius: 5px;
            font-size: 10px;
            font-weight: 800;
            vertical-align: middle;
            background: rgba(255,255,255,0.07);
            color: rgba(255,255,255,0.82);
        }

        .ca-move-badge:empty { display: none; }
        .ca-move-button[data-classification="Brilliant"] { border-color: rgba(69,216,197,0.75); }
        .ca-move-button[data-classification="Great"] { border-color: rgba(122,183,255,0.75); }
        .ca-move-button[data-classification="Book"] { border-color: rgba(182,160,255,0.65); }
        .ca-move-button[data-classification="Miss"] { border-color: rgba(255,116,116,0.75); }

        .ca-current-classification {
            display: inline-flex;
            align-items: center;
            margin-top: 9px;
            padding: 5px 9px;
            border-radius: 7px;
            font-size: 12px;
            font-weight: 800;
            background: rgba(255,255,255,0.07);
            color: rgba(255,255,255,0.82);
        }

        /* =============================================
           MOVE LIST
        ============================================= */

        .ca-move-list {
            display: flex;

            flex-wrap: wrap;

            gap: 7px;

            max-height: 290px;

            overflow-y: auto;

            padding-right: 4px;

            margin-top: 10px;
        }

        .ca-move-button {
            border:
                1px solid rgba(255,255,255,0.09);

            background:
                rgba(255,255,255,0.035);

            color: inherit;

            border-radius: 8px;

            padding: 7px 9px;

            cursor: pointer;

            font-size: 13px;

            transition:
                0.15s ease;
        }

        .ca-move-button:hover {
            transform: translateY(-1px);

            background:
                rgba(255,255,255,0.08);
        }

        .ca-move-button.ca-active {
            outline:
                2px solid rgba(120,255,140,0.70);

            background:
                rgba(80,220,100,0.13);
        }

        .ca-move-number {
            opacity: 0.55;

            margin-right: 4px;
        }

        .ca-move-button[data-classification="Best"] {
            border-color:
                rgba(150,220,60,0.55);
        }

        .ca-move-button[data-classification="Excellent"] {
            border-color:
                rgba(100,210,80,0.45);
        }

        .ca-move-button[data-classification="Good"] {
            border-color:
                rgba(100,180,120,0.35);
        }

        .ca-move-button[data-classification="Inaccuracy"] {
            border-color:
                rgba(255,205,60,0.60);
        }

        .ca-move-button[data-classification="Mistake"] {
            border-color:
                rgba(255,145,60,0.65);
        }

        .ca-move-button[data-classification="Blunder"] {
            border-color:
                rgba(255,65,65,0.70);
        }

        /* =============================================
           FEN
        ============================================= */

        .ca-fen-box {
            margin-top: 15px;
        }

        .ca-fen-label {
            display: block;

            font-size: 12px;

            opacity: 0.6;

            margin-bottom: 7px;
        }

        .ca-fen {
            display: block;

            width: 100%;

            box-sizing: border-box;

            padding: 10px 12px;

            border-radius: 9px;

            border:
                1px solid rgba(255,255,255,0.08);

            background:
                rgba(0,0,0,0.20);

            color: inherit;

            font-size: 12px;

            word-break: break-all;
        }

        /* =============================================
           NOTE
        ============================================= */

        .ca-analysis-note {
            margin-top: 14px;

            font-size: 11px;

            opacity: 0.5;

            line-height: 1.5;
        }

        /* =============================================
           RESPONSIVE
        ============================================= */

        @media (max-width: 850px) {

            .ca-analyzer {
                grid-template-columns: 1fr;
            }

            .ca-game-info {
                grid-template-columns:
                    repeat(2,1fr);
            }

            .ca-board {
                width: 100%;
            }

            .ca-board-line {
                width: 100%;
            }
        }

        @media (max-width: 500px) {

            .ca-game-info {
                grid-template-columns: 1fr;
            }

            .ca-engine-grid,
            .ca-accuracy-grid,
            .ca-count-grid {
                grid-template-columns: 1fr;
            }

            .ca-panel {
                padding: 15px;
            }

            .ca-board-line {
                grid-template-columns:
                    32px minmax(0,1fr);

                gap: 6px;
            }

            .ca-eval-bar {
                min-height: 220px;
            }

            .ca-eval-label {
                font-size: 8px;
            }
        }
    `;

    document.head.appendChild(style);
}

// ======================================================
// CREATE EMPTY STATS
// ======================================================

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

    // ==================================================
    // AUTOMATIC ANALYSIS
    // ==================================================

    await runAutomaticAnalysis();
});

// ======================================================
// RENDER MAIN ANALYZER
// ======================================================

function renderAnalyzer() {

    if (!gameData) {
        return;
    }

    const headers =
        gameData.headers;

    result.innerHTML = `

        <div class="ca-wrapper">

            <!-- ===================================== -->
            <!-- GAME INFO -->
            <!-- ===================================== -->

            <div class="ca-game-info">

                <div class="ca-info-card">

                    <span class="ca-info-label">
                        White
                    </span>

                    <span class="ca-info-value">
                        ${escapeHtml(
                            headers.White ||
                            "Unknown"
                        )}
                    </span>

                </div>

                <div class="ca-info-card">

                    <span class="ca-info-label">
                        Black
                    </span>

                    <span class="ca-info-value">
                        ${escapeHtml(
                            headers.Black ||
                            "Unknown"
                        )}
                    </span>

                </div>

                <div class="ca-info-card">

                    <span class="ca-info-label">
                        Result
                    </span>

                    <span class="ca-info-value">
                        ${escapeHtml(
                            headers.Result ||
                            "Unknown"
                        )}
                    </span>

                </div>

                <div class="ca-info-card">

                    <span class="ca-info-label">
                        White Rating
                    </span>

                    <span class="ca-info-value">
                        ${escapeHtml(
                            headers.WhiteElo ||
                            "Unknown"
                        )}
                    </span>

                </div>

                <div class="ca-info-card">

                    <span class="ca-info-label">
                        Black Rating
                    </span>

                    <span class="ca-info-value">
                        ${escapeHtml(
                            headers.BlackElo ||
                            "Unknown"
                        )}
                    </span>

                </div>

                <div class="ca-info-card">

                    <span class="ca-info-label">
                        Moves
                    </span>

                    <span class="ca-info-value">
                        ${gameData.moves.length}
                    </span>

                </div>

            </div>

            <!-- ===================================== -->
            <!-- ANALYZER -->
            <!-- ===================================== -->

            <div class="ca-analyzer">

                <!-- ================================= -->
                <!-- BOARD -->
                <!-- ================================= -->

                <div class="ca-board-area">

                    <div class="ca-board-line">

                        <!-- EVALUATION BAR -->

                        <div class="ca-eval-sidebar">

                            <div
                                id="ca-eval-label"
                                class="ca-eval-label">

                                Analyzing

                            </div>

                            <div class="ca-eval-bar">

                                <div
                                    id="ca-eval-bar-fill"
                                    class="ca-eval-bar-fill">
                                </div>

                                <div
                                    class="ca-eval-bar-top">
                                    BLACK
                                </div>

                                <div
                                    class="ca-eval-bar-bottom">
                                    WHITE
                                </div>

                                <div
                                    class="ca-eval-zero">
                                </div>

                            </div>

                        </div>

                        <!-- CHESSBOARD -->

                        <div
                            id="ca-board"
                            class="ca-board">
                        </div>

                    </div>

                    <div
                        id="ca-board-caption"
                        class="ca-board-caption">
                    </div>

                    <!-- CONTROLS -->

                    <div class="ca-controls">

                        <button
                            id="ca-start"
                            class="ca-control">

                            ⏮ Start

                        </button>

                        <button
                            id="ca-prev"
                            class="ca-control">

                            ◀ Previous

                        </button>

                        <button
                            id="ca-play"
                            class="ca-control">

                            ▶ Play

                        </button>

                        <button
                            id="ca-next"
                            class="ca-control">

                            Next ▶

                        </button>

                        <button
                            id="ca-end"
                            class="ca-control">

                            End ⏭

                        </button>

                        <button
                            id="ca-sound"
                            class="ca-control"
                            type="button"
                            aria-pressed="true"
                            title="Toggle original chess move sounds">

                            🔊 Sound on

                        </button>

                    </div>

                </div>

                <!-- ================================= -->
                <!-- RIGHT PANEL -->
                <!-- ================================= -->

                <div class="ca-panel">

                    <h2 class="ca-panel-title">
                        Game Analysis
                    </h2>

                    <!-- ANALYSIS STATUS -->

                    <div
                        id="ca-engine-status"
                        class="ca-engine-status">

                        ⏳ Preparing Stockfish...

                    </div>

                    <!-- PROGRESS -->

                    <div class="ca-progress-box">

                        <div
                            class="ca-progress-track">

                            <div
                                id="ca-progress-fill"
                                class="ca-progress-fill">
                            </div>

                        </div>

                    </div>

                    <!-- EVALUATION GRAPH -->

                    <div class="ca-evaluation">

                        <div class="ca-evaluation-header">
                            Evaluation
                        </div>

                        <svg
                            id="ca-eval-graph"
                            viewBox="0 0 900 180"
                            preserveAspectRatio="none">
                        </svg>

                    </div>

                    <!-- ACCURACY -->

                    <div class="ca-accuracy-grid">

                        <div class="ca-accuracy-card">

                            <span
                                class="ca-accuracy-player">

                                ${escapeHtml(
                                    headers.White ||
                                    "White"
                                )}

                            </span>

                            <span
                                id="ca-white-accuracy"
                                class="ca-accuracy-value">

                                —

                            </span>

                        </div>

                        <div class="ca-accuracy-card">

                            <span
                                class="ca-accuracy-player">

                                ${escapeHtml(
                                    headers.Black ||
                                    "Black"
                                )}

                            </span>

                            <span
                                id="ca-black-accuracy"
                                class="ca-accuracy-value">

                                —

                            </span>

                        </div>

                    </div>

                    <!-- CURRENT MOVE -->

                    <div class="ca-current-move">

                        <div class="ca-current-move-label">
                            Current Move
                        </div>

                        <div
                            id="ca-current-move"
                            class="ca-current-move-value">

                        </div>

                        <div
                            id="ca-current-classification"
                            class="ca-current-classification">
                            Waiting for analysis
                        </div>

                    </div>

                    <!-- ENGINE -->

                    <div class="ca-engine-grid">

                        <div class="ca-engine-stat">

                            <span
                                class="ca-engine-stat-label">
                                Evaluation
                            </span>

                            <span
                                id="ca-engine-evaluation"
                                class="ca-engine-stat-value">

                                —

                            </span>

                        </div>

                        <div class="ca-engine-stat">

                            <span
                                class="ca-engine-stat-label">
                                Best Move
                            </span>

                            <span
                                id="ca-engine-best"
                                class="ca-engine-stat-value">

                                —

                            </span>

                        </div>

                        <div class="ca-engine-stat">

                            <span
                                class="ca-engine-stat-label">
                                Played Move
                            </span>

                            <span
                                id="ca-engine-played"
                                class="ca-engine-stat-value">

                                —

                            </span>

                        </div>

                        <div class="ca-engine-stat">

                            <span
                                class="ca-engine-stat-label">
                                Move Quality
                            </span>

                            <span
                                id="ca-engine-quality"
                                class="ca-engine-stat-value">

                                —

                            </span>

                        </div>

                    </div>

                    <!-- MOVE COUNTS -->

                    <div class="ca-fen-box">

                        <span class="ca-fen-label">
                            White Moves
                        </span>

                        <div
                            id="ca-white-counts"
                            class="ca-count-grid">
                        </div>

                    </div>

                    <div class="ca-fen-box">

                        <span class="ca-fen-label">
                            Black Moves
                        </span>

                        <div
                            id="ca-black-counts"
                            class="ca-count-grid">
                        </div>

                    </div>

                    <!-- MOVE LIST -->

                    <div class="ca-fen-box">

                        <span class="ca-fen-label">
                            Moves
                        </span>

                        <div
                            id="ca-move-list"
                            class="ca-move-list">
                        </div>

                    </div>

                    <!-- FEN -->

                    <div class="ca-fen-box">

                        <span class="ca-fen-label">
                            Current FEN
                        </span>

                        <code
                            id="ca-fen"
                            class="ca-fen">
                        </code>

                    </div>

                    <!-- PV -->

                    <div class="ca-fen-box">

                        <span class="ca-fen-label">
                            Engine Line
                        </span>

                        <code
                            id="ca-engine-pv"
                            class="ca-fen">

                            —

                        </code>

                    </div>

                    <div class="ca-analysis-note">

                        Stockfish 19 Lite single-threaded analyzes each position to depth 12.
                        Analysis time depends on game length and your device. Move labels
                        are engine-based estimates, not Chess.com's proprietary review.
                        Opening-book coverage is limited; Brilliant, Great and Miss are
                        conservative heuristics and can differ from other platforms.

                    </div>

                </div>

            </div>

        </div>
    `;

    renderMoveList();
    renderPosition();

    // ==================================================
    // CONTROLS
    // ==================================================

    document
        .getElementById("ca-start")
        .addEventListener(
            "click",
            () => {

                stopAutoplay();

                goToPosition(0);
            }
        );

    document
        .getElementById("ca-prev")
        .addEventListener(
            "click",
            () => {

                stopAutoplay();

                goToPosition(
                    currentPosition - 1
                );
            }
        );

    document
        .getElementById("ca-next")
        .addEventListener(
            "click",
            () => {

                goToPosition(
                    currentPosition + 1
                );
            }
        );

    document
        .getElementById("ca-end")
        .addEventListener(
            "click",
            () => {

                stopAutoplay();

                goToPosition(
                    gameData.positions.length - 1
                );
            }
        );

    document
        .getElementById("ca-play")
        .addEventListener(
            "click",
            toggleAutoplay
        );

    const soundButton = document.getElementById("ca-sound");
    if (soundButton) {
        soundButton.addEventListener("click", () => {
            soundsEnabled = !soundsEnabled;
            soundButton.textContent = soundsEnabled ? "🔊 Sound on" : "🔇 Sound off";
            soundButton.setAttribute("aria-pressed", String(soundsEnabled));
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

                classifyMove(i);
            }

            // ------------------------------------------------
            // PROGRESS
            // ------------------------------------------------

            const percent =
                ((i + 1) / total) * 100;

            if (progressFill) {

                progressFill.style.width =
                    `${percent}%`;
            }

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

        gameData.analyzed =
            true;

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

function isApparentSoundSacrifice(after) {
    // High-precision filter: do not call a move Brilliant merely because the
    // opponent can capture the moved piece. Require a real piece sacrifice
    // AND a concrete tactical payoff in Stockfish's principal variation.
    const pvMoves = String(after.analysis?.pv || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (pvMoves.length < 3 || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(pvMoves[0])) {
        return false;
    }

    const movedPiece = new Chess(after.fen).get(after.to);
    if (!movedPiece || !["n", "b", "r", "q"].includes(movedPiece.type)) {
        return false; // pawn moves and promotions are not enough by themselves
    }

    const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    // PGN parsing stores playedMove.color in after.side, so this is the
    // color that made the candidate move (not the side-to-move in the FEN).
    const moverColor = after.side;
    let chess;
    try {
        chess = new Chess(after.fen);
    } catch (error) {
        return false;
    }

    let sacrificeWasTaken = false;
    let materialBalance = 0; // positive means the original mover gained material
    let foundTacticalPayoff = false;

    // Replay a short section of the engine PV. We only accept a clear material
    // recovery or a forced mate in the line; positional compensation alone is
    // deliberately not enough for this first-pass Brilliant detector.
    for (const uci of pvMoves.slice(0, 8)) {
        if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promotion = uci[4];
        let move;
        try {
            move = chess.move({ from, to, promotion });
        } catch (error) {
            return false;
        }
        if (!move) return false;

        if (move.color !== moverColor && move.to === after.to && move.captured) {
            sacrificeWasTaken = true;
            materialBalance -= pieceValue[move.captured] || 0;
        } else if (move.captured) {
            const value = pieceValue[move.captured] || 0;
            materialBalance += move.color === moverColor ? value : -value;
        }

        if (move.color === moverColor && move.san.endsWith("#")) {
            foundTacticalPayoff = true;
            break;
        }

        // Ignore the line before the alleged sacrifice is actually taken.
        if (sacrificeWasTaken && materialBalance >= 0) {
            foundTacticalPayoff = true;
            break;
        }

    }

    return sacrificeWasTaken && foundTacticalPayoff;
}

// ======================================================
// CLASSIFY MOVE
// ======================================================

function classifyMove(index) {
    const after = gameData.positions[index];
    const before = gameData.positions[index - 1];
    if (!before.analysis || !after.analysis) return;

    const beforeScore = before.analysis.whiteScore;
    const afterScore = after.analysis.whiteScore;
    if (beforeScore === null || afterScore === null) return;

    // Engine scores are stored from White's perspective. Convert both
    // positions to the perspective of the player who made this move.
    const moverBefore = after.side === "w" ? beforeScore : -beforeScore;
    const moverAfter = after.side === "w" ? afterScore : -afterScore;
    const pawnLoss = Math.max(0, moverBefore - moverAfter) / 100;

    // Centipawns are not equally meaningful in winning and equal positions.
    // Convert both evaluations to expected-score percentages before grading.
    const expectedBefore = scoreToExpectedScore(moverBefore);
    const expectedAfter = scoreToExpectedScore(moverAfter);
    const expectedPointsLoss = Math.max(0, expectedBefore - expectedAfter);

    after.loss = pawnLoss; // Keep the familiar pawn-loss display.
    after.expectedPointsLoss = expectedPointsLoss;
    after.accuracy = lossToAccuracy(expectedPointsLoss);

    const bestMove = isEngineBestMove(before, after);
    const bookMove = isKnownBookMove(index);
    const brilliantCandidate = bestMove && isApparentSoundSacrifice(after);
    // Great is an intentionally rare heuristic: a top-engine response that
    // correctly capitalizes on an opponent mistake/blunder while holding a
    // clear advantage. This is not Chess.com's private critical-move logic.
    const greatCandidate = bestMove &&
        ["Mistake", "Blunder"].includes(before.classification) &&
        moverBefore >= 150 &&
        moverAfter >= 150 &&
        expectedPointsLoss <= 1.5;

    // A missed opportunity is only considered when the opponent's previous
    // move was already marked as a mistake/blunder and this move gives away
    // a meaningful part of the resulting advantage.
    const opponentErr = ["Mistake", "Blunder"].includes(before.classification);
    const missedOpportunity = opponentErr &&
        moverBefore >= 150 &&
        expectedPointsLoss >= 5 &&
        expectedPointsLoss <= 20 &&
        !bestMove;

    if (bookMove) {
        after.classification = "Book";
    } else if (
        brilliantCandidate &&
        expectedPointsLoss <= 2 &&
        moverBefore < 300 &&
        moverAfter >= -100
    ) {
        // Deliberately conservative: a top engine move plus an apparent,
        // sound piece sacrifice. This remains a heuristic, not Chess.com's code.
        after.classification = "Brilliant";
    } else if (greatCandidate) {
        after.classification = "Great";
    } else if (bestMove) {
        after.classification = "Best";
    } else if (missedOpportunity) {
        after.classification = "Miss";
    } else {
        after.classification = classifyExpectedPointsLoss(expectedPointsLoss);
    }

    after.bestMovePlayed = bestMove;
}

// Map Stockfish centipawns to an expected-score percentage using the
// published Lichess win-percentage curve. It is a useful public model, not
// the private Chess.com rating-dependent Expected Points model.
function scoreToExpectedScore(centipawns) {
    const cp = Math.max(-100000, Math.min(100000, Number(centipawns) || 0));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Public Chess.com classification cutoffs are expressed as expected-points
// loss. Here they are applied to this site's Lichess-inspired estimate, so
// labels are consistent but are not promised to match Chess.com exactly.
function classifyExpectedPointsLoss(loss) {
    if (loss <= 2) return "Excellent";
    if (loss <= 5) return "Good";
    if (loss <= 10) return "Inaccuracy";
    if (loss <= 20) return "Mistake";
    return "Blunder";
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
                if (badge) badge.textContent = position.classification;
            } else {
                delete button.dataset.classification;
                if (badge) badge.textContent = "";
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

            left.textContent =
                classification;

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

        qualityElement.textContent =
            after.classification
                ? `${after.classification} • ${after.loss.toFixed(2)}`
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

                square.classList.add(
                    "ca-last-to"
                );
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
        currentClassificationElement.textContent =
            currentPosition === 0
                ? "Initial position"
                : (position.classification || "Not analyzed yet");
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
            const quality = position.classification || "Move reviewed";
            statusElement.textContent = `${quality} move · ${position.label}`;
            statusElement.dataset.classification = quality;
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
                    ${escapeHtml(position.classification || "")}
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
