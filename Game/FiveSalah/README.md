# 🕌 My Five Daily Salah

A peaceful **3D educational game** that helps children learn about the **five daily prayers
(Salah)** — their names, approximate times, preparation (Wudu), the Qiblah, and the basic
physical positions — by exploring a calm, friendly neighbourhood. Built with **Three.js +
vanilla JavaScript + CSS**.

> Education and habit awareness, **not** competition. A game can teach *about* Salah — real
> Salah is performed in real life. The game reminds children to ask their family to help them
> learn and pray.

**▶ Play:** open `index.html`, or visit `/Game/FiveSalah/` on the deployed site.

---

## 🌙 The five prayers (accurate)

| Prayer | Time | Obligatory (fard) rak'ahs |
|---|---|---|
| ☀ Fajr | Before sunrise (dawn) | 2 |
| 🌞 Dhuhr | After midday | 4 |
| 🌤 Asr | Late afternoon | 4 |
| 🌅 Maghrib | Just after sunset | 3 |
| 🌙 Isha | Night | 4 |

The game distinguishes obligatory (fard) rak'ahs from optional Sunnah prayers, and clearly
notes that **actual prayer times vary by location and date** — ask your family or local mosque.

## 🎮 What you do

Explore a 3D neighbourhood (home, mosque, gardens, wudu area, prayer area). Visit the mosque
courtyard and step onto a glowing **pedestal** for each prayer. First make **Wudu** 💧 (tap the
steps in order), face the **Qiblah** 🧭 (turn the mat toward the Ka'bah), then watch a fictional
child demonstrate the **basic positions** 🧎 (standing, bowing, prostrating, sitting). Each
prayer you learn earns a **learning badge**. A dynamic **day/night** environment moves through
Fajr → Dhuhr → Asr → Maghrib → Isha (use **⏩ Next Time**).

Also included: a **Learn Salah** encyclopedia, a **map** for quick travel, a **progress board**,
character customization (boy/girl, skin tone, clothes, optional headscarf), and a completion
screen that unlocks **Free Exploration**.

## 🕹️ Controls

**Desktop:** `W A S D` / arrows move · `Shift` run · drag mouse = camera · **E** interact · **Space** jump · **Esc** pause.
**Mobile:** left **joystick** move · drag screen = camera · **✋** interact · **⤒** jump.

## 📁 Structure

```text
Game/FiveSalah/
├── index.html      # HUD, menus, generic modal, joystick
├── style.css       # calm teal/gold theme, responsive, touch controls
├── game.js         # World, Player, Camera, Input, Audio, Save, UI, Game
├── assets/{models,textures,audio,icons}/   # generated procedurally at runtime
└── README.md
```

## 🤍 Respectful Islamic design

- **No depiction** of Allah, prophets, angels, or companions — only a fictional child and
  ordinary scenery.
- The mosque is treated respectfully — never an arcade attraction.
- Worship is **never** scored or gamified; there are **no "religious reward points."** Learning
  badges are for game progress only, and the game never claims virtual completion equals real Salah.
- Mistakes are gentle: *"Let's try that step again."*
- No fabricated Qur'an/Hadith. This version focuses on accurate general information; any future
  scripture would use only verified, referenced sources.

## 🔒 Child safety

No login · no chat · no user content · no ads · no purchases · no data collection. Progress is
stored only in this browser's `localStorage`.

## 🚀 Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000/Game/FiveSalah/
```
> Three.js loads from `cdnjs` (needs internet on first load; then browser-cached). If WebGL is
> unavailable, a friendly message is shown.

## 🌐 GitHub Pages

Works at `https://thanbirtamim.github.io/Game/FiveSalah/`. All links are relative (favicon
`../../assets/...`, back link `../index.html`), so the site root is never assumed to be `/`.

---

© 2025 Sheikh Thanbir Alam. Original work — see repository `LICENSE`.
