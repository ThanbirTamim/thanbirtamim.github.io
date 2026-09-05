# 🐍 Neon Snake — Retro Arcade

A modernized, neon take on the timeless **Snake** game. Built entirely with
**HTML5 Canvas + vanilla JavaScript + CSS** — no frameworks, no build step, no backend,
no external assets.

> All graphics and sounds are **generated programmatically** (Canvas drawing + Web Audio API).

**▶ Play:** open `index.html`, or visit `/Game/snake/` on the deployed site.

---

## ✨ Features

- Classic grid-based snake with smooth neon rendering and a glowing head + eyes
- Pulsing food orbs
- Score system + **high score saved in `localStorage`**
- Progressive **speed levels** (faster every 50 points)
- Wall + self-collision detection
- Start / Pause / Game Over screens, restart
- Web Audio **sound effects** (eat, turn, level-up, game over) + mute toggle
- **Responsive** square board, keyboard, **swipe**, and on-screen D-pad controls
- Auto-pause when the browser tab loses focus
- ~60 FPS delta-timed loop with fixed-step grid movement

## 🕹️ Controls

| Action | Keys |
|---|---|
| Move | Arrow keys / `W` `A` `S` `D` |
| Pause | `P` |
| Restart | `R` |

**Mobile** — swipe on the board or use the on-screen D-pad (appears on touch devices).

## 📁 Structure

```text
Game/snake/
├── index.html      # entry point / markup + overlays + HUD
├── style.css       # neon theme, responsive layout, touch controls
├── game.js         # full engine: loop, grid logic, audio, input, states
└── README.md
```

## 🚀 Run locally

Open the file directly (no server needed), or serve the repo root and browse to `/Game/snake/`:

```bash
python3 -m http.server 8000   # then http://localhost:8000/Game/snake/
```

## 🌐 GitHub Pages

Works as-is. Links use relative paths, so the game runs both locally and at
`https://<user>.github.io/Game/snake/`. Back link returns to the games hub (`../index.html`).

---

© 2025 Sheikh Thanbir Alam. Original work — see repository `LICENSE`.
