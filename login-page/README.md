# Lamp Login · 深夜台灯

[中文说明 → README.zh-CN.md](./README.zh-CN.md)

A login page with a personality: the room is dark — **pull the lamp cord (or press `L`) to light it up before you can sign in**.

**Live demo → <https://phj2001.github.io/Desk-Lamp-Login-Page/>**

Fully bilingual (English / 中文) — auto-detects your browser language, with a `中 / EN` toggle in the corner.

## Interactive easter eggs

- 🪢 **Pull-cord switch**: drag the cord past a threshold and release to toggle; a light tap works too. The cord has springy physics and the lamp sways like a pendulum
- 💡 **Tungsten flicker**: the light stutters like an old bulb before settling, with a random new lamp color every time
- 👀 **It has a face**: pupils track your cursor, it blinks at random; it squints to *peek* while you type your password; a wrong password startles it; success makes it beam
- 🌑 **The dark is really dark**: with the lamp off, the login card is illegible — text dissolves into smudges and your cursor becomes a tiny flashlight; poke it in the dark and the lamp jiggles its cord at you
- 😴 **It dozes off**: leave it alone too long and it nods off — head tilting, light dimming, Zzz floating up; any movement wakes it
- 🙄 **It gets fed up**: three wrong passwords in a row escalate "startled" into "half-lidded, cold sweat", and the lamp blushes an angry red; on the fourth it caves and tells you the answer
- 🫣 **Ticklish and shy**: poke the shade and it wobbles like jelly, giggling; move your cursor too close and its pupils bashfully look away
- ⏰ **It nags you**: leave the lamp off and it will rattle its own cord now and then: "hey, pull me"
- 💥 **Hidden easter egg**: yank the cord 5 times in a row and the bulb burns out with a pop — total darkness, wisps of smoke, brighter stars, fireflies drifting in; after changing the bulb in the dark it begs you to be gentle
- 🎬 **Finale**: on successful login the card drifts away and the screen glows "Good night, welcome back"
- 🔊 **Sound**: synthesized live with WebAudio — switch clicks, a success chime, weary sighs, giggles, and the pop of a dying bulb

Demo account: `admin` / `123456`

## Tech

Vue 3 (`<script setup>`) + Vite + GSAP (Draggable). No backend, no i18n library — the bilingual layer is one `ref` and a dictionary.

The lighting system rides on two CSS `@property` registered custom properties, `--on` and `--shade-hue`. Because they are transitionable, every lamp-dependent color, shadow and opacity across the page glides in sync automatically — no per-element transitions. Dozing dim-down, burnout blackout and the angry flush are just swapping the `transition` speed class on `<html>`.

Also: focusable cord with Enter/Space support, touch drag, and `prefers-reduced-motion` respected.

## Run

```bash
npm install
npm run dev     # dev server
npm run build   # production build
```
