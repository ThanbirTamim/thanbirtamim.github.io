# 🎮 Star Impact — Retro Space Shooter

A modernized, retro-arcade **2D side-scrolling space shooter** inspired by classic
Nokia-era "Space Impact"–style gameplay. Built entirely with **HTML5 Canvas + vanilla
JavaScript + CSS** — no frameworks, no build step, no backend, no external assets.

> All graphics and sounds are **generated programmatically** (Canvas drawing + Web Audio API),
> so there are no copyrighted sprites, sounds, or branding.

**▶ Play:** open `index.html` (or visit `/Game/` on the deployed site).

---

## ✨ Features

- Player spaceship with engine flame + thruster feedback
- Horizontal side-scrolling with **parallax starfield** (3 depth layers)
- 4 enemy types: `drone`, `wave` (sine), `heavy` (tanky), `darter` (fast)
- Player projectiles, enemy projectiles (aimed)
- **Boss fights** at the end of every level, with a boss health bar and 2 attack patterns
- AABB collision detection + particle **explosions** + **screen shake**
- **Power-ups:** Rapid fire, Spread shot, Shield, Extra life
- Score system + **high score saved in `localStorage`**
- Lives HUD, level indicator, increasing difficulty
- Start / Pause / Game Over screens, restart
- Web Audio **sound effects** (synth blips, noise explosions, jingles) + mute toggle
- **Responsive** 16:9 layout, keyboard controls, and on-screen **touch controls**
- Auto-pause when the browser tab loses focus
- Runs at ~60 FPS via delta-timed `requestAnimationFrame`

## 🕹️ Controls

**Desktop**

| Action | Keys |
|---|---|
| Move | Arrow keys / `W` `A` `S` `D` |
| Shoot | `Space` |
| Pause | `P` |
| Restart | `R` |

**Mobile** — use the on-screen D-pad + **FIRE** button (they appear automatically on touch devices).

## 📁 Structure

```text
Game/space-impact/
├── index.html      # entry point / markup + overlays + HUD
├── style.css       # arcade theme, responsive layout, touch controls
├── game.js         # full engine: loop, entities, audio, input, states
├── assets/
│   ├── images/     # (empty — visuals are drawn on canvas)
│   └── sounds/     # (empty — audio is synthesized at runtime)
└── README.md
```

## 🚀 Run locally

Just open the file — no server needed:

```bash
open index.html        # macOS
```

Or serve the site root and browse to `/Game/`:

```bash
python3 -m http.server 8000   # from the repository root
# then visit http://localhost:8000/Game/
```

## 🌐 GitHub Pages

Works as-is when the repo is published via GitHub Pages. The games hub at `/Game/`
links to each game folder (e.g. `/Game/space-impact/`), and this game links back to the
hub with `../index.html`, so paths resolve correctly both locally and on GitHub Pages.

---

© 2025 Sheikh Thanbir Alam. Original work — see repository `LICENSE`.
