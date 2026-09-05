# 🏎️ 3D Racing — Arcade Highway Racer

A polished **3D arcade racing game** built with **Three.js + vanilla JavaScript + CSS**.
Drive a sports car down an endless highway, dodge traffic, grab coins & power-ups, chain
nitro boosts, and survive as the speed keeps climbing.

> No build step, no backend. Three.js is loaded from a CDN. All 3D models are built
> **procedurally from primitives** and all sounds are **synthesized** with the Web Audio API —
> there are no external model/texture/audio files.

**▶ Play:** open `index.html`, or visit `/Game/Racing3D/` on the deployed site.

---

## ✨ Features

- Third-person chase camera (smooth follow, turn roll, nitro pull-back, collision shake)
- Procedural sports car: body, roof, glass, 4 spinning wheels, spoiler, head/tail/brake lights, body tilt & suspension
- Multi-lane highway with lane dashes, red curbs, grass, and **pooled** roadside scenery (trees, buildings, street lights, road signs, rocks, bushes, mountains, clouds)
- AI **traffic** (car / SUV / truck / bus) with lanes, varied speeds, and occasional lane changes — all **object-pooled**
- Reliable collision system with health loss, screen shake, hit-flash, temporary slowdown, and knockback
- **Collectibles:** coins (score), nitro (energy), shield (temp protection), repair (+life)
- **Nitro boost:** speed-up, speed-lines overlay, exhaust particles, camera shake, boost sound; regenerates over time
- **Dynamic day → sunset → night** cycle (sky, fog, lighting, glowing windows/street lights, headlights)
- **3 modes:** Endless · Time Trial (checkpoints add time) · Challenges (progressive objectives)
- HUD: score, best, distance, speed (km/h), coins, level, lives, nitro bar, mode/challenge tag
- Screens: Main Menu, Countdown (3·2·1·GO!), Pause, Game Over, High Scores, Settings
- **localStorage** high scores per mode
- Web Audio SFX: engine (speed-reactive), nitro, crash, coin, power-up, countdown, buttons, game over
- Auto **quality** (High on desktop / Low on mobile) + manual override; capped `devicePixelRatio`
- Fully responsive; keyboard + large touch controls + swipe steering; page-scroll locked while playing

## 🕹️ Controls

**Desktop**

| Action | Keys |
|---|---|
| Steer left / right | ← → or `A` `D` |
| Accelerate / brake (bias auto-speed) | ↑ ↓ or `W` `S` |
| Nitro | `Space` |
| Pause | `P` |
| Restart | `R` |

**Mobile** — on-screen ◀ ▶ (steer), ▲ ▼ (speed), round **NITRO** button; swipe left/right also steers.

## 📁 Structure

```text
Game/Racing3D/
├── index.html      # HUD, all screens, touch controls, Three.js CDN
├── style.css       # neon arcade HUD, responsive, touch controls
├── game.js         # engine: Game, PlayerCar, TrafficManager, Road, Environment,
│                   #   CollectibleManager, ParticleSystem, CameraController,
│                   #   CollisionSystem, AudioManager, InputManager, ScoreManager, UI
└── assets/         # models / textures / sounds  (all generated at runtime)
```

## 🚀 Run locally

Open `index.html` directly, or serve the repo root and browse to `/Game/Racing3D/`:

```bash
python3 -m http.server 8000   # then http://localhost:8000/Game/Racing3D/
```

> Three.js loads from `cdnjs`, so an internet connection is required the first time
> (the browser caches it afterwards).

## 🌐 GitHub Pages

Works as-is at `https://thanbirtamim.github.io/Game/Racing3D/`. All internal links use
relative paths (favicon `../../assets/...`, back link `../index.html` → games hub), so the
site root is never assumed to be `/`.

## ⚡ Performance notes

Traffic, scenery, collectibles and particles are **pooled** (recycled, never continuously
created/destroyed). Geometries and materials are shared. Shadows and antialiasing are only
enabled on High quality; `devicePixelRatio` is capped (2 on desktop, 1.25 on mobile).

---

© 2025 Sheikh Thanbir Alam. Original work — see repository `LICENSE`.
