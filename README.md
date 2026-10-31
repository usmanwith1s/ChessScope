# ChessScope

ChessScope is a focused chess game review interface. It imports PGN games, replays the moves on an interactive board and analyzes positions with the bundled Stockfish 19 Lite WebAssembly engine.

## Run

Serve this folder over HTTP/HTTPS (for example with GitHub Pages or a local static web server). Open `index.html` through that server; the Stockfish worker and WebAssembly files need to be served as files, so opening the HTML directly with `file://` may not work.

## Included

- PGN paste and `.pgn` file import
- Interactive move list and board navigation
- Stockfish position analysis (depth 14 default)
- Evaluation graph, player accuracy estimates and move classification breakdown
- Optional Chess.com public player avatar lookup (only player usernames are queried; PGN analysis remains client-side)

## Analysis notes

Move grades and accuracy are ChessScope estimates, not official Chess.com or Lichess scores. The current book reference is intentionally small and offline. Brilliant, Great and Miss are heuristic categories and should be evaluated against a broad labelled game set before they are treated as authoritative. Browser/device performance and selected engine depth affect results.

The chess.js library is loaded from its existing CDN reference in `index.html`; Stockfish files are included locally under `engine/`.
