# 🎲 Ludo — Multiplayer + vs Computer

A polished, browser-only **Ludo** game: create a private room and play **2–4 players**
across devices over **WebRTC (peer-to-peer)**, or play **offline vs the computer** (4 AI
difficulties) or **pass & play** on one device. No backend, no database, no accounts.

**▶ Play:** open `index.html`, or visit `/Game/Ludo/` on the deployed site.

---

## Architecture

- **Static client** — HTML/CSS/vanilla JS on GitHub Pages. The board is drawn on a 2.5D-styled
  `<canvas>`.
- **Rules engine** (`ludo.js`) — a pure, deterministic, DOM-free state machine (fully unit-testable
  in Node). It owns positions, legal moves, captures, the six rule, win detection and standings.
- **AI** (`ai.js`) — Easy / Normal / Hard / Expert move selection (heuristic scoring:
  bring-out, capture, reach-home, safe cells, progress, risk avoidance).
- **Networking** (`network.js`) — a thin abstraction over **PeerJS** (WebRTC DataChannels).
- **Controller** (`game.js`) — screens, rendering, dice, animation and the turn flow that ties
  everything together.

### Multiplayer model (host-authoritative, P2P)

- **Star topology.** The room **host** is the authority. All other players connect directly to
  the host via WebRTC DataChannels. Actual game data flows **browser-to-browser** (P2P).
- Clients send tiny **actions** (`ROLL`, `MOVE`); they never send board state. The host
  **validates** turn ownership, dice and move legality, applies it to the rules engine, then
  **broadcasts** the resulting state + a small event. This is the anti-cheat model.
- Only meaningful events are sent (join, roster, start, roll, move/capture, turn, state). Ludo is
  turn-based, so bandwidth is tiny — the board is **not** streamed continuously.

### Signalling

WebRTC needs a brief signalling handshake to establish the P2P connection. This project uses
**PeerJS's free cloud broker** (loaded from a CDN) *only* for that handshake — no game data or
secrets pass through it, and no server of your own is required. The **room code** is mapped to a
namespaced PeerJS id (`config.js` → `NET.idPrefix`). To self-host the broker later, set
`NET.host/port/path` in `config.js`. No credentials live in the frontend.

> **Works on ANY network mix (same / different / mixed):** connectivity is handled by ICE
> servers in `config.js` → `NET`.
> - **STUN** (many providers preconfigured) covers same-Wi-Fi and most different-network cases
>   by punching directly through NAT.
> - **TURN** relays traffic when direct P2P is blocked (strict firewalls, symmetric NAT, mobile
>   carriers). A live TURN server makes **every** combination connect, since relay always works.
>
> Best-effort public TURN is included (no account needed). For **guaranteed** cross-network
> play you can optionally paste your own free relay's `{ urls, username, credential }` into
> `config.js` → `NET.userTurn` (checked first).
>
> TURN credentials are meant to live in the client, so this is safe. If a connection still can't
> be made, the game shows a clear message with recovery instead of hanging.

> **Dice fairness:** the authority generates dice with `crypto.getRandomValues` and broadcasts
> the result. This is a lightweight casual-game anti-cheat model — not cryptographic,
> casino-grade randomness (a malicious host could bias its own rolls). Fine for playing with
> friends.

### Room lifecycle

Rooms exist only while players are connected. Create → share code → friends join the lobby →
host starts → play → results → **Play Again** (keeps the room) or leave. When everyone leaves,
the room simply disappears — there is **no** stored state anywhere.

### Reconnect & host migration

- **Player disconnect:** a grace period is shown; on reconnect the client re-joins with its
  `pid` and the host re-sends the latest state to resynchronise (no duplicated moves).
- **Host disconnect:** clients are notified. Full seamless host-migration over a fixed room id is
  a **best-effort V2 item**; V1 offers a clean "return to menu" recovery so nobody is stuck.

### Anti-cheat (validated by the host)

Room membership · turn ownership · dice generation · move legality · turn order · win state.
Clients cannot change `dice = 6` and cheat — the host recomputes everything.

## Files

```text
Game/Ludo/
├── index.html   # screens: menu, create, join, vs-computer, lobby, game, results
├── style.css    # polished responsive UI, touch-friendly
├── config.js    # board geometry, colours, safe cells, signalling config
├── ludo.js      # pure rules engine (authoritative, deterministic)
├── ai.js        # Easy/Normal/Hard/Expert AI
├── network.js   # PeerJS WebRTC abstraction (createRoom/joinRoom/sendAction/…)
├── game.js      # controller: rendering, dice, turn flow, offline + online
├── assets/{board,pieces,ui,audio}/   # generated procedurally at runtime
└── README.md
```

## Controls

Roll on your turn, then **tap a highlighted token** to move it (touch-friendly, no hover/right-click).
A **6** brings a token out and grants another turn; capturing or reaching home also grants another
turn; three 6s in a row skips your turn. Landing on an opponent that isn't on a ★ **safe cell**
sends it home.

## Local development

It's fully static — just open `index.html` or serve the repo root:

```bash
python3 -m http.server 8000    # http://localhost:8000/Game/Ludo/
```
Test online play with **two browser windows/devices**: create a room in one, join with the code in
the other. (WebRTC/PeerJS needs an internet connection.)

## GitHub Pages

Works at `https://USERNAME.github.io/REPOSITORY/Game/Ludo/`. All internal paths are relative
(favicon `../../assets/...`, local scripts, back link `../index.html`); the site root is never
assumed to be `/`.

## Privacy

No accounts, email, phone, login, chat or tracking. An optional temporary display name exists only
for the current session. `localStorage` stores only local preferences (sound, fast animation).

## Roadmap

**V1 (this):** 2–4 human P2P rooms + vs-computer (4 AI levels) + pass & play. **V2:** mixed
human/AI online, seamless host migration. **V3:** more difficulty tuning. **V4:** board variants,
persistent personal stats, achievements, themes.

---

© 2025 Sheikh Thanbir Alam. Original work — see repository `LICENSE`.
