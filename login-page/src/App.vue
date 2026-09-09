<template>
  <div class="stars" aria-hidden="true"></div>

  <!-- 灯泡烧掉时飞出的萤火虫 -->
  <transition name="fade">
    <div v-if="burnout" class="fireflies" aria-hidden="true">
      <span
        v-for="(f, i) in flies"
        :key="i"
        :style="{
          left: f.left + '%',
          top: f.top + '%',
          '--dx': f.dx + 'px',
          '--dy': f.dy + 'px',
          '--s': f.s,
          animationDuration: f.dur + 's',
          animationDelay: f.delay + 's',
        }"
      ></span>
    </div>
  </transition>

  <main class="wrap">
    <div class="brand">灯 / LAMP LOGIN<span class="brand-no">no.001</span></div>

    <div class="stage">
      <LampScene
        :lamp-on="lampOn"
        :lamp-state="lampState"
        :nudge="nudge"
        @toggle="requestToggle"
      />
      <LoginCard
        :lamp-on="lampOn"
        :finale="finale"
        @peek="onPeek"
        @idle="onIdle"
        @surprise="onSurprise"
        @success="onSuccess"
        @dark-poke="onDarkPoke"
      />
    </div>
  </main>

  <!-- 登录成功谢幕 -->
  <transition name="banner">
    <div v-if="finale" class="finale-banner" aria-hidden="true">
      <p class="banner-cn">{{ T.bannerMain }}</p>
      <p class="banner-en">{{ T.bannerSub }}</p>
    </div>
  </transition>

  <!-- 语言切换 -->
  <button class="lang-switch" type="button" :title="T.langSwitch" @click="toggleLang">
    <span :class="{ on: lang === 'zh' }">中</span><i>/</i><span :class="{ on: lang === 'en' }">EN</span>
  </button>

  <div class="vignette" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>

  <div class="toast" :class="[toast.type, { show: toast.show }]" role="status">
    <span class="toast-icon">{{ toast.type === 'success' ? '✓' : '!' }}</span>
    {{ toast.msg }}
  </div>

  <footer class="footer">
    <span class="mono">{{ clock }}</span>
    <span class="dot"></span>
    <span class="mono">{{ today }}</span>
    <span class="dot"></span>
    <span v-if="isTouch">{{ T.footerTouch }}</span>
    <span v-else>{{ T.footerPre }} <kbd>L</kbd> {{ T.footerPost }}</span>
  </footer>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import LampScene from './components/LampScene.vue'
import LoginCard from './components/LoginCard.vue'
import { T, lang, toggleLang } from './i18n'

const lampOn = ref(false)
const lampState = ref('idle')
const toast = reactive({ msg: '', type: 'error', show: false })
const clock = ref('')
const today = ref('')
const nudge = ref(0)
const burnout = ref(false)
const finale = ref(false)
const flies = ref([])
const isTouch = window.matchMedia('(pointer: coarse)').matches

let toastTimer = null
let clockTimer = null
let happyTimer = null
let finaleTimer = null
let finaleEndTimer = null
let burnoutTimers = []
let idleTimer = null
let angryTimer = null
let lastActivity = 0
let lastHue = 38
let failCount = 0
let pullTimes = []

const rootStyle = document.documentElement.style
const rootClass = document.documentElement.classList

function tick() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  clock.value = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  today.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------- 开关灯 ----------
function toggleLamp() {
  if (lampState.value === 'sleepy') wake()
  lampOn.value = !lampOn.value
  if (lampOn.value) {
    // 每次点亮换一种灯色，且保证与上次差异足够大
    let hue = Math.floor(Math.random() * 360)
    if (Math.abs(hue - lastHue) < 60) hue = (hue + 120) % 360
    lastHue = hue
    rootStyle.setProperty('--shade-hue', hue)
  }
  rootStyle.setProperty('--on', lampOn.value ? 1 : 0)
  resetIdle()
}

// 灯绳/键盘拉动入口：负责识别“连拉作死”
function requestToggle() {
  if (burnout.value || finale.value) return
  const now = performance.now()
  pullTimes = pullTimes.filter((t) => now - t < 3200)
  pullTimes.push(now)
  if (pullTimes.length >= 5) {
    triggerBurnout()
    return
  }
  toggleLamp()
}

// ---------- 彩蛋：灯泡烧掉 ----------
function triggerBurnout() {
  pullTimes = []
  burnout.value = true
  lampOn.value = false
  lampState.value = 'burnt'
  flies.value = Array.from({ length: 10 }, () => ({
    left: 6 + Math.random() * 88,
    top: 10 + Math.random() * 72,
    dx: (Math.random() * 2 - 1) * 140,
    dy: (Math.random() * 2 - 1) * 90,
    dur: 4 + Math.random() * 4,
    delay: Math.random() * 1.6,
    s: 0.5 + Math.random() * 0.9,
  }))
  // 光瞬间熄灭
  rootClass.add('snap')
  rootStyle.setProperty('--on', 0)
  document.documentElement.dataset.burnout = ''
  setTimeout(() => rootClass.remove('snap'), 300)

  showToast(T.value.toastBurnout, 'error')
  burnoutTimers = [
    setTimeout(() => showToast(T.value.toastChanging, 'error'), 2600),
    setTimeout(() => {
      delete document.documentElement.dataset.burnout
      burnout.value = false
      lampState.value = 'idle'
      lampOn.value = false
      toggleLamp()
      showToast(T.value.toastNewBulb, 'success')
    }, 6200),
  ]
}

// ---------- 睡意系统：太久没动静，台灯会打瞌睡 ----------
function resetIdle() {
  clearTimeout(idleTimer)
  if (lampState.value === 'sleepy') wake()
  idleTimer = setTimeout(() => {
    if (lampOn.value && lampState.value === 'idle' && !burnout.value && !finale.value) doze()
  }, 18000)
}

function doze() {
  lampState.value = 'sleepy'
  rootClass.add('dozing')
  rootStyle.setProperty('--on', 0.42)
}

function wake() {
  rootClass.remove('dozing')
  if (lampOn.value) rootStyle.setProperty('--on', 1)
  if (lampState.value === 'sleepy') lampState.value = 'idle'
}

function onActivity() {
  const now = Date.now()
  if (now - lastActivity < 700) return
  lastActivity = now
  resetIdle()
}

// ---------- 提示条 ----------
function showToast(msg, type = 'error') {
  toast.msg = msg
  toast.type = type
  toast.show = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.show = false }, 2400)
}

// ---------- 台灯情绪 ----------
function onPeek() {
  if (lampState.value === 'sleepy') wake()
  if (lampState.value !== 'happy') lampState.value = 'peek'
}

function onIdle() {
  if (lampState.value === 'peek') lampState.value = 'idle'
}

function onSurprise(msg) {
  failCount++
  if (failCount >= 3) {
    // 连错三次：从“吓一跳”升级为“无语”，灯色愠怒地泛红
    lampState.value = 'annoyed'
    showToast(failCount >= 4 ? T.value.toastAdminHint : T.value.toastAnnoyed, 'error')
    flashAngry()
  } else {
    lampState.value = 'surprise'
    showToast(msg, 'error')
  }
  setTimeout(() => {
    if (lampState.value === 'surprise' || lampState.value === 'annoyed') lampState.value = 'idle'
  }, 2000)
}

function flashAngry() {
  clearTimeout(angryTimer)
  rootClass.add('flash')
  rootStyle.setProperty('--shade-hue', 15)
  angryTimer = setTimeout(() => {
    rootStyle.setProperty('--shade-hue', lastHue)
    setTimeout(() => rootClass.remove('flash'), 1600)
  }, 1300)
}

function onDarkPoke() {
  showToast(T.value.toastDark, 'error')
  nudge.value++
}

// ---------- 登录成功：谢幕 ----------
function onSuccess() {
  failCount = 0
  lampState.value = 'happy'
  showToast(T.value.toastSuccess, 'success')
  clearTimeout(happyTimer)
  clearTimeout(finaleTimer)
  clearTimeout(finaleEndTimer)
  finaleTimer = setTimeout(() => { finale.value = true }, 1400)
  finaleEndTimer = setTimeout(() => {
    finale.value = false
    lampState.value = 'idle'
    resetIdle()
  }, 5400)
}

function onKeydown(e) {
  if (e.repeat) return
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === 'l' || e.key === 'L') requestToggle()
}

onMounted(() => {
  tick()
  clockTimer = setInterval(tick, 1000)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keydown', onActivity, true)
  window.addEventListener('pointermove', onActivity, { passive: true })
  window.addEventListener('pointerdown', onActivity, { passive: true })
  resetIdle()
})

onUnmounted(() => {
  clearInterval(clockTimer)
  clearTimeout(toastTimer)
  clearTimeout(happyTimer)
  clearTimeout(finaleTimer)
  clearTimeout(finaleEndTimer)
  clearTimeout(idleTimer)
  clearTimeout(angryTimer)
  burnoutTimers.forEach(clearTimeout)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keydown', onActivity, true)
  window.removeEventListener('pointermove', onActivity)
  window.removeEventListener('pointerdown', onActivity)
})
</script>

<style>
.wrap {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px 90px;
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 64px;
  flex-wrap: wrap;
  width: 100%;
  max-width: 1100px;
}

/* ---- 品牌角标 ---- */
.brand {
  position: fixed;
  top: 24px;
  left: 28px;
  z-index: 5;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--ink-dim);
  writing-mode: vertical-rl;
  user-select: none;
  opacity: 0.8;
}
.brand-no {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: color-mix(in oklab, var(--accent) 70%, var(--ink-dim));
  transition: color 0.6s;
}

/* ---- 语言切换 ---- */
.lang-switch {
  position: fixed;
  top: 22px;
  right: 26px;
  z-index: 6;
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: color-mix(in oklab, var(--card-bg) 70%, transparent);
  backdrop-filter: blur(6px);
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--ink-dim);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.3s, color 0.3s;
}
.lang-switch:hover { border-color: var(--accent); }
.lang-switch i {
  font-style: normal;
  margin: 0 5px;
  opacity: 0.4;
}
.lang-switch span { transition: color 0.3s, text-shadow 0.3s; }
.lang-switch span.on {
  color: var(--accent);
  text-shadow: 0 0 10px var(--accent-glow);
}

/* ---- 氛围层：星空 ---- */
.stars {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 22% 28%, #dfe6f6 50%, transparent 51%),
    radial-gradient(1px 1px at 68% 14%, #b9c4dd 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 84% 42%, #eef2fb 50%, transparent 51%),
    radial-gradient(1px 1px at 38% 66%, #aab6d0 50%, transparent 51%),
    radial-gradient(1px 1px at 8% 52%, #d4dcef 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 55% 82%, #c8d2e8 50%, transparent 51%);
  background-size: 560px 560px, 440px 440px, 700px 700px, 520px 520px, 620px 620px, 480px 480px;
  opacity: calc(0.55 - var(--on) * 0.32);
  animation: twinkle 8s ease-in-out infinite;
  transition: opacity 1.2s ease;
}
/* 灯泡烧掉时，星空反而亮起来 */
html[data-burnout] .stars {
  opacity: 0.95;
  animation-duration: 4s;
}
@keyframes twinkle {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(0.55); }
}

/* ---- 萤火虫 ---- */
.fireflies {
  position: fixed;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}
.fireflies span {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #e4f8b0;
  box-shadow: 0 0 12px 3px rgba(196, 240, 130, 0.75);
  animation: firefly ease-in-out infinite alternate;
}
@keyframes firefly {
  0%   { transform: translate(0, 0) scale(var(--s)); opacity: 0; }
  15%  { opacity: 1; }
  45%  { opacity: 0.25; }
  70%  { opacity: 0.95; }
  100% { transform: translate(var(--dx), var(--dy)) scale(var(--s)); opacity: 0.1; }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.8s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ---- 谢幕横幅 ---- */
.finale-banner {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-content: center;
  text-align: center;
  pointer-events: none;
}
.banner-cn {
  margin: 0 0 14px;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: clamp(34px, 6vw, 52px);
  letter-spacing: 6px;
  color: var(--ink);
  text-shadow:
    0 0 34px var(--accent-glow),
    0 0 90px color-mix(in oklab, var(--accent-glow) 60%, transparent);
}
.banner-en {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 6px;
  color: color-mix(in oklab, var(--accent) 65%, var(--ink-dim));
}
.banner-enter-active { transition: opacity 0.9s ease, transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
.banner-leave-active { transition: opacity 0.6s ease, transform 0.6s ease; }
.banner-enter-from { opacity: 0; transform: translateY(22px) scale(0.96); }
.banner-leave-to   { opacity: 0; transform: translateY(-14px); }

/* ---- 氛围层：暗角 + 颗粒 ---- */
.vignette {
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: radial-gradient(ellipse 80% 75% at 50% 45%, transparent 55%, rgba(0, 0, 0, 0.5) 100%);
}
.grain {
  position: fixed;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  opacity: 0.05;
  mix-blend-mode: overlay;
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(%23n)"/></svg>');
}

/* ---- 提示条 ---- */
.toast {
  position: fixed;
  top: 32px;
  left: 50%;
  transform: translate(-50%, -20px);
  z-index: 100;
  padding: 12px 22px;
  border-radius: 12px;
  font-size: 14px;
  letter-spacing: 0.3px;
  color: var(--ink);
  background: color-mix(in oklab, var(--card-bg) 88%, var(--danger) 12%);
  border: 1.5px solid var(--danger);
  box-shadow: 0 10px 30px -6px rgba(0, 0, 0, 0.6);
  opacity: 0;
  pointer-events: none;
  backdrop-filter: blur(6px);
  transition: opacity 0.35s ease, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}
.toast.success {
  background: color-mix(in oklab, var(--card-bg) 85%, var(--accent) 15%);
  border-color: var(--accent);
  box-shadow:
    0 10px 30px -6px color-mix(in oklab, var(--accent-glow) 50%, #000),
    0 0 30px -4px var(--accent-glow);
}
.toast-icon {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin-right: 10px;
  border-radius: 50%;
  background: var(--danger);
  color: #0a0f17;
  font-weight: 800;
  text-align: center;
  line-height: 18px;
  font-size: 12px;
  vertical-align: middle;
}
.toast.success .toast-icon { background: var(--accent); }

/* ---- 页脚 ---- */
.footer {
  position: fixed;
  bottom: 18px;
  left: 0;
  right: 0;
  z-index: 5;
  text-align: center;
  font-size: 12px;
  color: var(--ink-dim);
  letter-spacing: 0.5px;
  opacity: 0.8;
  user-select: none;
}
.footer .mono { font-family: var(--font-mono); }
.footer kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 5px;
  color: color-mix(in oklab, var(--accent) 75%, var(--ink-dim));
  transition: color 0.6s, border-color 0.6s;
}
.footer .dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  margin: 0 12px;
  vertical-align: middle;
  box-shadow: 0 0 8px var(--accent-glow);
  transition: background 0.6s, box-shadow 0.6s;
}

@media (max-width: 820px) {
  .wrap { padding: 24px 16px 80px; }
  .stage { gap: 8px; }
  .brand { display: none; }
  .lang-switch { top: 14px; right: 14px; }
}
</style>
