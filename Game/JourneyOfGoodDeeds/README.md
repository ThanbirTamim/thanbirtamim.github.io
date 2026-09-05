# 🌙 Journey of Good Deeds

A gentle **3D children's adventure** where you explore a warm, friendly fictional Muslim
town, help the people around you, and learn good manners & Islamic values **by playing** —
not by reading a quiz. Built with **Three.js + vanilla JavaScript + CSS**.

> Fun first, educational naturally through gameplay. No accounts, no ads, no chat,
> no data collection — everything runs and saves locally in the browser.

**▶ Play:** open `index.html`, or visit `/Game/JourneyOfGoodDeeds/` on the deployed site.

---

## 🎮 What you do

Walk around the town, find townspeople with a bobbing **!** above them, talk to them
(press **E** / ✋), and choose the kind thing to do. Helping others, being honest,
sharing, greeting with Salam, caring for a cat, and cleaning the park all earn
**⭐ Good Deed Points** and show a short, friendly learning card.

Gameplay loop: **Explore → Meet someone → Get a mission → Make choices → Do a good deed → Earn points → Learn a short lesson → Grow.**

## 🌟 Missions & values

| Mission | Value taught |
|---|---|
| Lost grocery bags (collect & return) | Kindness, helping others |
| The found coin | Honesty, trustworthiness |
| Sharing a snack | Sharing, generosity |
| The thirsty cat | Kindness to animals |
| Clean the park (collect litter) | Cleanliness, caring for environment |
| Helping a parent | Respect, helping family |
| Saying Salam | Good manners, greeting |
| Bakery queue | Patience |
| Thanking the librarian | Gratitude |
| Good Choice quiz | Good character & reflection |
| Mosque courtyard etiquette | Respect, cleanliness |

Ranks: 🌱 Beginner → 🤝 Kind Helper (50) → 😊 Helpful Friend (100) → 🏘️ Community Helper (200) → 🏆 Good Deed Champion (500). Points are **game progression only** — the game never claims they are religious reward.

## 🧒 Respectful design

- No depiction of Allah, prophets, angels, or companions. Only fictional ordinary characters (neighbors, parents, teachers, shopkeepers, children, a gardener, a librarian, a baker).
- A respectful fictional mosque is part of the scenery; the game teaches **etiquette** (walk calmly, be quiet, keep it clean, remove shoes) — it never turns worship into an arcade mechanic.
- Gentle, never shaming: a poor choice simply says *"Let's try another choice."*
- Character creator (boy/girl, skin tones, clothing colors, optional headscarf) — appearance is **never** tied to virtue.
- No combat, weapons, blood, or horror.

## 🕹️ Controls

**Desktop:** `W A S D` / arrows to move · drag mouse to rotate camera · **E** to talk/help · **Esc** to pause.
**Mobile:** left **virtual joystick** to move · drag the right side to look · big **✋** button to interact.

## 📁 Structure

```text
Game/JourneyOfGoodDeeds/
├── index.html      # menus, HUD, dialogue, cards, joystick
├── style.css       # warm friendly theme, responsive, touch controls
├── game.js         # Game, Player, World, NPCManager, DialogueSystem,
│                   #   MissionSystem, GoodDeedSystem, InteractionSystem,
│                   #   PickupManager, CameraController, AchievementSystem,
│                   #   AudioManager, InputManager, UIManager, SaveSystem
└── assets/{models,textures,sounds}/   # all generated procedurally at runtime
```

## 🚀 Run locally

Open `index.html`, or serve the repo root and browse to `/Game/JourneyOfGoodDeeds/`:

```bash
python3 -m http.server 8000   # http://localhost:8000/Game/JourneyOfGoodDeeds/
```
> Three.js loads from `cdnjs` (needs internet on first load; then browser-cached).

## 🌐 GitHub Pages

Works at `https://thanbirtamim.github.io/Game/JourneyOfGoodDeeds/`. All links are relative
(favicon `../../assets/...`, back link `../index.html`), so the site root is never assumed
to be `/`.

## 🔒 Child safety

No login · no chat · no user content · no ads · no purchases · no external social features ·
no data collection. Progress is stored only in this browser's `localStorage`.

## 🔮 Future improvements

More areas & missions, additional mini-games (bakery sorting, library shelving, garden
watering, sharing game), verified age-appropriate Qur'an/Hadith "Learn More" section for
parents, richer character animation, and a day/night cycle.

---

© 2025 Sheikh Thanbir Alam. Original work — see repository `LICENSE`.
