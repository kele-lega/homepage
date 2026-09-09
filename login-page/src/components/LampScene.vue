<template>
  <div class="lamp-area">
    <svg
      ref="svgEl"
      class="lamp-svg"
      :class="{ ignite: igniting, sleeping: lampState === 'sleepy', burnt: lampState === 'burnt' }"
      viewBox="0 0 360 470"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="coneGrad" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.55" />
          <stop offset="55%" stop-color="currentColor" stop-opacity="0.18" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
        <radialGradient id="bulbHalo" cx="0.5" cy="0.35" r="0.55">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.85" />
          <stop offset="40%" stop-color="currentColor" stop-opacity="0.25" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="floorPool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.6" />
          <stop offset="50%" stop-color="currentColor" stop-opacity="0.18" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </radialGradient>
        <filter id="coneBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <clipPath id="peekClipL"><rect x="149" y="148" width="22" height="5" /></clipPath>
        <clipPath id="peekClipR"><rect x="189" y="148" width="22" height="5" /></clipPath>
        <clipPath id="lowClipL"><rect x="149" y="147" width="22" height="13" /></clipPath>
        <clipPath id="lowClipR"><rect x="189" y="147" width="22" height="13" /></clipPath>
      </defs>

      <!-- 天花板 -->
      <line x1="0" y1="6" x2="360" y2="6" stroke="#1a2230" stroke-width="3" />

      <!-- 地面光池（不随灯摆动） -->
      <ellipse class="cone pool-shape" cx="180" cy="438" rx="140" ry="22" fill="url(#floorPool)" />

      <!-- 灯体（整体可摆动） -->
      <g ref="swingEl">
        <line class="arm" x1="180" y1="6" x2="180" y2="70" />

        <path class="cone cone-shape" d="M 130 210 Q 120 320 70 448 L 290 448 Q 240 320 230 210 Z" fill="url(#coneGrad)" :filter="lampOn ? 'url(#coneBlur)' : 'none'" />
        <ellipse class="cone halo-shape" cx="180" cy="230" rx="90" ry="70" fill="url(#bulbHalo)" />

        <!-- 光锥中的浮尘 -->
        <g class="motes">
          <circle class="mote" style="--d:0s"    cx="158" cy="400" r="1.4" />
          <circle class="mote" style="--d:-1.2s" cx="196" cy="372" r="1.1" />
          <circle class="mote" style="--d:-2.6s" cx="172" cy="418" r="1.7" />
          <circle class="mote" style="--d:-3.4s" cx="214" cy="405" r="1.2" />
          <circle class="mote" style="--d:-4.5s" cx="142" cy="356" r="1.0" />
          <circle class="mote" style="--d:-5.3s" cx="188" cy="336" r="1.3" />
          <circle class="mote" style="--d:-6.1s" cx="226" cy="352" r="0.9" />
        </g>

        <!-- 灯泡烧掉时的青烟 -->
        <g class="smoke" aria-hidden="true">
          <circle cx="180" cy="64" r="5" />
          <circle cx="189" cy="59" r="4" />
          <circle cx="173" cy="54" r="3" />
        </g>

        <!-- 灯罩（怕痒，可以戳） -->
        <path class="shade" d="M 100 80 Q 180 55 260 80 L 240 200 Q 180 215 120 200 Z" @pointerdown="poke" />
        <path class="shade-hl" d="M 108 82 Q 180 59 252 82 L 249 100 Q 180 78 111 100 Z" />
        <path class="shade-inner" d="M 123 198 Q 180 212 237 198 L 232 206 Q 180 220 128 206 Z" />

        <!-- 灯泡辉光 -->
        <g class="bulb-glow-group">
          <ellipse class="bulb-soft-outer" cx="180" cy="210" rx="42" ry="16" />
          <ellipse class="bulb-soft-inner" cx="180" cy="208" rx="18" ry="7" />
          <ellipse class="bulb-hotspot" cx="180" cy="206" rx="6" ry="3" />
        </g>

        <!-- 打瞌睡的 Zzz -->
        <g class="zzz" aria-hidden="true">
          <text class="z z1" x="248" y="116">z</text>
          <text class="z z2" x="262" y="98">z</text>
          <text class="z z3" x="278" y="78">Z</text>
        </g>

        <!-- 表情 -->
        <g ref="faceEl" class="face">
          <!-- 正常的眼睛（可眨眼、可追踪鼠标） -->
          <g ref="normalEyesEl">
            <circle class="eye-white" cx="160" cy="150" r="9" />
            <circle class="eye-white" cx="200" cy="150" r="9" />
            <g ref="pupilLEl"><circle class="eye" cx="160" cy="150" r="5.5" /><circle class="eye-gleam" cx="161.5" cy="147.5" r="2" /></g>
            <g ref="pupilREl"><circle class="eye" cx="200" cy="150" r="5.5" /><circle class="eye-gleam" cx="201.5" cy="147.5" r="2" /></g>
          </g>

          <!-- 眯眼偷看（输入密码时） -->
          <g ref="eyelidsEl" style="display:none">
            <g clip-path="url(#peekClipL)">
              <circle class="eye-white" cx="160" cy="150" r="9" />
              <circle class="eye" cx="164" cy="150" r="4.5" />
              <circle class="eye-gleam" cx="165" cy="149" r="1.3" />
            </g>
            <g clip-path="url(#peekClipR)">
              <circle class="eye-white" cx="200" cy="150" r="9" />
              <circle class="eye" cx="204" cy="150" r="4.5" />
              <circle class="eye-gleam" cx="205" cy="149" r="1.3" />
            </g>
            <path class="eyelid" d="M 150 148 Q 160 144 170 148" />
            <path class="eyelid" d="M 190 148 Q 200 144 210 148" />
            <path class="eyelid" d="M 150 153 Q 160 155 170 153" />
            <path class="eyelid" d="M 190 153 Q 200 155 210 153" />
          </g>

          <!-- 惊讶（登录出错时） -->
          <g ref="surpriseEl" style="display:none">
            <circle class="eye-white" cx="160" cy="150" r="11" />
            <circle class="eye-white" cx="200" cy="150" r="11" />
            <circle class="eye" cx="160" cy="150" r="3" />
            <circle class="eye" cx="200" cy="150" r="3" />
            <path class="eyelid" d="M 150 135 Q 160 131 170 135" />
            <path class="eyelid" d="M 190 135 Q 200 131 210 135" />
          </g>

          <!-- 开心（登录成功 / 被挠痒时） -->
          <g ref="happyEl" style="display:none">
            <path class="happy-eye" d="M 151 153 Q 160 143 169 153" />
            <path class="happy-eye" d="M 191 153 Q 200 143 209 153" />
            <ellipse class="blush" cx="143" cy="164" rx="6.5" ry="3.5" />
            <ellipse class="blush" cx="217" cy="164" rx="6.5" ry="3.5" />
          </g>

          <!-- 打瞌睡（闭眼） -->
          <g ref="sleepyEl" style="display:none">
            <path class="eyelid" d="M 151 151 Q 160 157 169 151" />
            <path class="eyelid" d="M 191 151 Q 200 157 209 151" />
          </g>

          <!-- 无语（连续输错密码时：半睁眼 + 冷汗） -->
          <g ref="annoyedEl" style="display:none">
            <circle class="eye-white" cx="160" cy="150" r="9" />
            <circle class="eye-white" cx="200" cy="150" r="9" />
            <g clip-path="url(#lowClipL)"><circle class="eye" cx="160" cy="152" r="5" /></g>
            <g clip-path="url(#lowClipR)"><circle class="eye" cx="200" cy="152" r="5" /></g>
            <line class="eyelid-flat" x1="150" y1="147" x2="170" y2="147" />
            <line class="eyelid-flat" x1="190" y1="147" x2="210" y2="147" />
            <path class="sweat" d="M 224 126 q 6 9 0 14 q -6 -5 0 -14 Z" />
          </g>

          <!-- 晕头转向（灯泡被拉烧时） -->
          <g ref="dizzyEl" class="dizzy" style="display:none">
            <line x1="153" y1="143" x2="167" y2="157" />
            <line x1="167" y1="143" x2="153" y2="157" />
            <line x1="193" y1="143" x2="207" y2="157" />
            <line x1="207" y1="143" x2="193" y2="157" />
          </g>

          <path ref="mouthEl" class="mouth" d="M 165 172 Q 180 178 195 172" />
        </g>

        <!-- 灯绳 -->
        <path ref="cordEl" class="cord-path" d="M 230 195 Q 230 260 230 320" />
        <g
          ref="knobEl"
          class="knob-group"
          tabindex="0"
          role="button"
          :aria-label="lampOn ? T.ariaCordOff : T.ariaCordOn"
          @keydown.enter.prevent="kbToggle"
          @keydown.space.prevent="kbToggle"
        >
          <circle class="knob-ring" cx="230" cy="320" r="10" />
          <circle class="cord-knob" cx="230" cy="320" r="10" />
          <circle cx="230" cy="320" r="4" fill="color-mix(in oklab, #fff 30%, transparent)" />
        </g>
        <text class="cord-hint" x="230" y="350" text-anchor="middle">{{ T[hintKey] }}</text>
      </g>

      <!-- 吊装底座 -->
      <rect class="base" x="170" y="0" width="20" height="10" rx="2" />
    </svg>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { gsap } from 'gsap'
import { Draggable } from 'gsap/Draggable'
import { T } from '../i18n'

gsap.registerPlugin(Draggable)

const props = defineProps({
  lampOn: Boolean,
  lampState: String,
  nudge: Number,
})
const emit = defineEmits(['toggle'])

const svgEl        = ref(null)
const swingEl      = ref(null)
const faceEl       = ref(null)
const normalEyesEl = ref(null)
const pupilLEl     = ref(null)
const pupilREl     = ref(null)
const eyelidsEl    = ref(null)
const surpriseEl   = ref(null)
const happyEl      = ref(null)
const sleepyEl     = ref(null)
const annoyedEl    = ref(null)
const dizzyEl      = ref(null)
const mouthEl      = ref(null)
const cordEl       = ref(null)
const knobEl       = ref(null)

const igniting = ref(false)
const hintKey = ref('hintPull')
let igniteTimer = null
let blinkCall = null
let fidgetCall = null
let fidgetIdx = 0
let pokeBusy = false
let pokeResetTimer = null

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const MOUTH = {
  idle:     'M 165 172 Q 180 178 195 172',
  peek:     'M 168 174 Q 180 170 192 174',
  surprise: 'M 173 174 Q 180 182 187 174 Q 180 168 173 174 Z',
  happy:    'M 166 170 Q 180 185 194 170 Q 180 175 166 170 Z',
  sleepy:   'M 174 173 Q 180 179 186 173 Q 180 169 174 173 Z',
  annoyed:  'M 168 174 L 192 174',
  burnt:    'M 165 175 Q 170 171 175 175 Q 180 179 185 175 Q 190 171 195 175',
}

// 灯灭太久时，台灯会不耐烦地自己晃灯绳催你（存字典键名，切换语言即时生效）
const OFF_HINTS = ['offHint1', 'offHint2', 'offHint3', 'hintPull']

// ---------- WebAudio 合成音效 ----------
let actx = null
function audioCtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)()
  return actx
}
function blip(freq, delay, dur, type, vol) {
  const ctx = audioCtx()
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(vol, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur)
}
function playClick() {
  try {
    blip(2400, 0, 0.035, 'square', 0.05)
    blip(680, 0.02, 0.06, 'triangle', 0.09)
  } catch (e) { /* 音频不可用时静默 */ }
}
function playChime() {
  try {
    blip(659, 0, 0.18, 'sine', 0.1)
    blip(880, 0.12, 0.24, 'sine', 0.1)
    blip(1319, 0.24, 0.4, 'sine', 0.07)
  } catch (e) { /* 音频不可用时静默 */ }
}
function playPop() {
  try {
    blip(150, 0, 0.2, 'sawtooth', 0.16)
    blip(55, 0.02, 0.28, 'sine', 0.2)
  } catch (e) { /* 音频不可用时静默 */ }
}
function playSigh() {
  try {
    blip(430, 0, 0.24, 'triangle', 0.05)
    blip(330, 0.18, 0.34, 'triangle', 0.04)
  } catch (e) { /* 音频不可用时静默 */ }
}
function playGiggle() {
  try {
    blip(880, 0, 0.07, 'sine', 0.07)
    blip(1175, 0.09, 0.07, 'sine', 0.07)
    blip(988, 0.18, 0.09, 'sine', 0.06)
  } catch (e) { /* 音频不可用时静默 */ }
}

// ---------- 灯绳 ----------
function cordPath(knobY, bendX = 0) {
  const topX = 230, topY = 195
  return `M ${topX} ${topY} Q ${topX + bendX} ${(topY + knobY) / 2} 230 ${knobY}`
}

function setKnob(y) {
  if (!knobEl.value) return
  knobEl.value.querySelectorAll('circle').forEach(c => c.setAttribute('cy', y))
}

function bounceCord(pullDistance) {
  const amp = Math.min(Math.max(pullDistance * 0.35, 10), 40)
  const frames = [
    { y: 320 + Math.min(pullDistance, 90), bendX: 10 },
    { y: 320 - amp * 0.4,  bendX: -amp * 0.6 },
    { y: 320 + amp * 0.25, bendX:  amp * 0.35 },
    { y: 320 - amp * 0.12, bendX: -amp * 0.18 },
    { y: 320, bendX: 0 },
  ]
  const tl = gsap.timeline()
  frames.forEach((f, i) => {
    const dur = i === 0 ? 0.18 : 0.22 - i * 0.02
    const ease = i === 0 ? 'power2.out' : 'power2.inOut'
    tl.to({}, {
      duration: dur, ease,
      onUpdate() {
        const p = this.progress()
        const prev = i === 0 ? { y: 320, bendX: 0 } : frames[i - 1]
        const y  = prev.y     + (f.y     - prev.y)     * p
        const bx = prev.bendX + (f.bendX - prev.bendX) * p
        cordEl.value?.setAttribute('d', cordPath(y, bx))
        setKnob(y)
      }
    })
  })
}

// ---------- 灯体钟摆 ----------
function swing(intensity) {
  const deg = Math.min(Math.max(intensity, 1.2), 5)
  gsap.fromTo(swingEl.value,
    { rotation: -deg, svgOrigin: '180 6' },
    { rotation: 0, duration: 2.4, ease: 'elastic.out(1, 0.12)', svgOrigin: '180 6' }
  )
}

// ---------- 眨眼 ----------
function scheduleBlink() {
  blinkCall = gsap.delayedCall(2.5 + Math.random() * 3.5, () => {
    if (props.lampOn && props.lampState === 'idle') {
      gsap.to(normalEyesEl.value, {
        scaleY: 0.08, svgOrigin: '180 150',
        duration: 0.08, yoyo: true, repeat: 1, ease: 'power2.inOut',
      })
    }
    scheduleBlink()
  })
}

// ---------- 不耐烦：灯灭太久自己晃灯绳 ----------
function scheduleFidget() {
  fidgetCall?.kill()
  fidgetCall = gsap.delayedCall(9 + Math.random() * 5, () => {
    if (!props.lampOn && props.lampState !== 'burnt') {
      hintKey.value = OFF_HINTS[fidgetIdx++ % OFF_HINTS.length]
      if (!REDUCED_MOTION) {
        bounceCord(26)
        swing(1.5)
      }
    }
    scheduleFidget()
  })
}

// ---------- 挠痒 / 戳灯罩 ----------
function poke() {
  if (pokeBusy || props.lampState === 'burnt') return
  pokeBusy = true
  clearTimeout(pokeResetTimer)
  pokeResetTimer = setTimeout(() => { pokeBusy = false }, 1000)

  if (!props.lampOn) {
    // 黑灯瞎火地戳它，它会不满地晃一晃
    hintKey.value = 'hintPokeOff'
    if (!REDUCED_MOTION) {
      gsap.fromTo(swingEl.value,
        { rotation: -2.5, svgOrigin: '180 6' },
        { rotation: 0, duration: 1.1, ease: 'elastic.out(1.2, 0.25)', svgOrigin: '180 6' }
      )
    }
    return
  }
  if (props.lampState !== 'idle') return

  // 怕痒：果冻式抖动 + 眯眼偷笑
  playGiggle()
  fadeEyes(0, 0.1)
  showOnly(happyEl.value)
  morphMouth(MOUTH.happy, 0.15)
  gsap.timeline()
    .to(swingEl.value, { scaleX: 1.06, scaleY: 0.94, duration: 0.1, svgOrigin: '180 130', ease: 'power2.out' })
    .to(swingEl.value, { scaleX: 1, scaleY: 1, duration: 0.9, ease: 'elastic.out(1.5, 0.22)' })
  setTimeout(() => {
    if (props.lampOn) applyState(props.lampState)
  }, 950)
}

function kbToggle() {
  emit('toggle')
  bounceCord(56)
  swing(2)
}

// ---------- 开灯 / 关灯 ----------
function faceVisible() {
  return props.lampOn || props.lampState === 'burnt'
}

watch(faceVisible, (visible) => {
  gsap.to(faceEl.value, {
    scale: visible ? 1 : 0,
    opacity: visible ? 1 : 0,
    duration: 0.5,
    ease: visible ? 'back.out(1.8)' : 'back.in(1.4)',
    svgOrigin: '180 160',
  })
})

watch(() => props.lampOn, (on) => {
  playClick()
  if (on) {
    hintKey.value = 'hintOff'
    // 钨丝灯点亮时的闪烁
    igniting.value = true
    clearTimeout(igniteTimer)
    igniteTimer = setTimeout(() => { igniting.value = false }, 950)
    // 重新点亮时按当前状态重置表情，清掉熄灯期间可能残留的旧表情
    applyState(props.lampState)
  } else {
    hintKey.value = 'hintPull'
  }
})

// ---------- 表情状态机 ----------
function showOnly(target) {
  for (const el of [eyelidsEl.value, surpriseEl.value, happyEl.value, sleepyEl.value, annoyedEl.value, dizzyEl.value]) {
    el.style.display = el === target ? '' : 'none'
  }
}

// GSAP 默认不覆盖同属性的旧补间：快速连续切换表情时，两条方向相反的
// opacity 补间会并存，先建且更长的那条最后收尾，把睁眼组拉回不透明，
// 与已显示的闭眼表情叠在一起。开新补间前先杀掉旧的。
function fadeEyes(opacity, duration) {
  gsap.killTweensOf(normalEyesEl.value, 'opacity')
  gsap.to(normalEyesEl.value, { opacity, duration })
}
function morphMouth(d, duration) {
  gsap.killTweensOf(mouthEl.value)
  gsap.to(mouthEl.value, { duration, attr: { d } })
}

function applyState(state, prevState) {
  if (!props.lampOn && state !== 'burnt') return
  if (state === 'peek') {
    fadeEyes(0, 0.18)
    showOnly(eyelidsEl.value)
    morphMouth(MOUTH.peek, 0.18)
  } else if (state === 'surprise') {
    fadeEyes(0, 0.12)
    showOnly(surpriseEl.value)
    morphMouth(MOUTH.surprise, 0.15)
    gsap.fromTo(faceEl.value, { x: -3 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' })
  } else if (state === 'happy') {
    fadeEyes(0, 0.12)
    showOnly(happyEl.value)
    morphMouth(MOUTH.happy, 0.2)
    gsap.fromTo(faceEl.value, { y: 4 }, { y: 0, duration: 0.6, ease: 'elastic.out(1.4, 0.3)' })
    swing(2.2)
    playChime()
  } else if (state === 'sleepy') {
    fadeEyes(0, 0.5)
    showOnly(sleepyEl.value)
    morphMouth(MOUTH.sleepy, 0.5)
    // 头慢慢歪向一边
    gsap.to(swingEl.value, { rotation: -2.2, duration: 2.4, ease: 'sine.out', svgOrigin: '180 6' })
  } else if (state === 'annoyed') {
    fadeEyes(0, 0.12)
    showOnly(annoyedEl.value)
    morphMouth(MOUTH.annoyed, 0.15)
    // 无语地摇头叹气
    gsap.timeline()
      .fromTo(faceEl.value, { x: -3 }, { x: 3, duration: 0.09, repeat: 3, yoyo: true })
      .to(faceEl.value, { x: 0, duration: 0.15 })
    playSigh()
  } else if (state === 'burnt') {
    fadeEyes(0, 0.1)
    showOnly(dizzyEl.value)
    morphMouth(MOUTH.burnt, 0.2)
    hintKey.value = 'hintBurnt'
    playPop()
    swing(3)
  } else {
    fadeEyes(1, 0.2)
    showOnly(null)
    morphMouth(MOUTH.idle, 0.2)
    // 从瞌睡中醒来时把头摆正
    if (prevState === 'sleepy') {
      gsap.to(swingEl.value, { rotation: 0, duration: 1.4, ease: 'elastic.out(1, 0.2)', svgOrigin: '180 6' })
    }
  }
}

watch(() => props.lampState, applyState)

// 黑暗中点登录卡片时，灯绳晃一晃提醒
watch(() => props.nudge, () => {
  if (props.lampOn) return
  hintKey.value = 'hintNudge'
  if (!REDUCED_MOTION) {
    bounceCord(34)
    swing(1.8)
  }
})

// ---------- 瞳孔追踪鼠标（凑太近会害羞地躲开） ----------
function updatePupils(mx, my) {
  if (!props.lampOn || props.lampState !== 'idle') return
  const r = svgEl.value.getBoundingClientRect()
  const eyeCX = r.left + (180 / 360) * r.width
  const eyeCY = r.top  + (150 / 470) * r.height
  const dx = mx - eyeCX
  const dy = my - eyeCY
  const dist = Math.hypot(dx, dy) || 1
  const shy = dist < 75
  const k = shy ? 0.9 : Math.min(1, dist / 350)
  const dir = shy ? -1 : 1
  const ox = dir * (dx / dist) * 3 * k
  const oy = dir * (dy / dist) * 2 * k
  gsap.to([pupilLEl.value, pupilREl.value], { x: ox, y: oy, duration: 0.35, ease: 'power2.out' })
}

// pointer 事件同时覆盖鼠标移动与手指按下/滑动
function onPointerMove(e) { updatePupils(e.clientX, e.clientY) }

onMounted(() => {
  gsap.set(faceEl.value, { scale: 0, opacity: 0, svgOrigin: '180 160' })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerdown', onPointerMove, { passive: true })
  if (!REDUCED_MOTION) scheduleBlink()
  scheduleFidget()

  Draggable.create(knobEl.value, {
    type: 'y',
    bounds: { minY: 0, maxY: 120 },
    cursor: 'grab',
    activeCursor: 'grabbing',
    onDrag() {
      const y = 320 + this.y
      cordEl.value?.setAttribute('d', cordPath(y, this.y * 0.15))
    },
    onDragEnd() {
      const pulled = this.y
      gsap.set(knobEl.value, { y: 0 })
      if (pulled > 50) {
        emit('toggle')
        swing(pulled * 0.04)
      }
      bounceCord(pulled)
    },
    onClick() {
      // 轻点灯绳也可以开关灯
      emit('toggle')
      bounceCord(56)
      swing(2)
    },
  })
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerdown', onPointerMove)
  blinkCall?.kill()
  fidgetCall?.kill()
  clearTimeout(igniteTimer)
  clearTimeout(pokeResetTimer)
})
</script>

<style scoped>
.lamp-area {
  position: relative;
  width: 360px;
  height: 470px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  flex-shrink: 0;
}
.lamp-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  user-select: none;
}

/* ---- 灯罩 ---- */
.shade {
  fill: var(--accent);
  stroke: #0a0f17;
  stroke-width: 3;
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.55));
  transition: fill 0.6s ease;
  cursor: pointer;
}
.shade-hl {
  fill: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}
.shade-inner {
  fill: var(--accent-deep);
  transition: fill 0.6s ease;
}

/* ---- 光 ---- */
.bulb-glow-group {
  opacity: var(--on);
  mix-blend-mode: screen;
  color: var(--accent-glow);
  pointer-events: none;
}
.bulb-soft-outer { fill: currentColor; opacity: 0.35; filter: blur(6px); }
.bulb-soft-inner { fill: currentColor; opacity: 0.7;  filter: blur(2px); }
.bulb-hotspot {
  fill: color-mix(in oklab, #fff calc(var(--on) * 90%), currentColor);
  opacity: calc(var(--on) * 0.95);
}
.cone {
  opacity: var(--on);
  mix-blend-mode: screen;
  color: var(--accent-glow);
  pointer-events: none;
}
.cone-shape { animation: cone-flicker 5s ease-in-out infinite; }
.halo-shape { animation: halo-pulse 3.5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.pool-shape { animation: pool-pulse 4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes cone-flicker {
  0%, 100% { opacity: var(--on); }
  45%      { opacity: calc(var(--on) * 0.86); }
  70%      { opacity: var(--on); }
}
@keyframes halo-pulse {
  0%, 100% { transform: scale(1);    opacity: var(--on); }
  50%      { transform: scale(1.08); opacity: calc(var(--on) * 0.9); }
}
@keyframes pool-pulse {
  0%, 100% { transform: scaleX(1);    opacity: var(--on); }
  50%      { transform: scaleX(1.05); opacity: calc(var(--on) * 0.88); }
}

/* 钨丝点亮闪烁：开灯瞬间覆盖基础透明度 */
.ignite .cone,
.ignite .bulb-glow-group {
  animation: ignite 0.9s ease-out;
}
@keyframes ignite {
  0%   { opacity: 0; }
  16%  { opacity: 0.9; }
  26%  { opacity: 0.12; }
  40%  { opacity: 0.95; }
  54%  { opacity: 0.3; }
  70%  { opacity: 1; }
  100% { opacity: 1; }
}

/* ---- 浮尘 ---- */
.mote {
  fill: var(--accent-glow);
  mix-blend-mode: screen;
  opacity: 0;
  animation: mote-drift 7s linear infinite;
  animation-delay: var(--d);
  pointer-events: none;
}
@keyframes mote-drift {
  0%   { transform: translate(0, 0);       opacity: 0; }
  18%  { opacity: calc(var(--on) * 0.7); }
  50%  { transform: translate(5px, -46px); opacity: calc(var(--on) * 0.45); }
  82%  { opacity: calc(var(--on) * 0.6); }
  100% { transform: translate(-4px, -92px); opacity: 0; }
}

/* ---- 青烟（仅烧毁时） ---- */
.smoke circle {
  fill: #8b93a5;
  opacity: 0;
  pointer-events: none;
}
.burnt .smoke circle {
  animation: smoke-rise 1.9s ease-out infinite;
}
.burnt .smoke circle:nth-child(2) { animation-delay: 0.55s; }
.burnt .smoke circle:nth-child(3) { animation-delay: 1.1s; }
@keyframes smoke-rise {
  0%   { transform: translate(0, 0) scale(0.6);   opacity: 0; }
  20%  { opacity: 0.5; }
  100% { transform: translate(7px, -36px) scale(1.8); opacity: 0; }
}

/* ---- Zzz（仅打瞌睡时） ---- */
.z {
  font-family: var(--font-mono);
  font-weight: 600;
  fill: #cfd8ea;
  opacity: 0;
  pointer-events: none;
}
.z1 { font-size: 12px; }
.z2 { font-size: 15px; }
.z3 { font-size: 19px; }
.sleeping .z { animation: z-float 2.8s ease-in-out infinite; }
.sleeping .z2 { animation-delay: 0.5s; }
.sleeping .z3 { animation-delay: 1s; }
@keyframes z-float {
  0%   { transform: translate(0, 4px);  opacity: 0; }
  30%  { opacity: 0.85; }
  100% { transform: translate(5px, -12px); opacity: 0; }
}

/* ---- 结构 ---- */
.base { fill: #1a2230; stroke: #0a0f17; stroke-width: 3; }
.arm  { stroke: #2a3240; stroke-width: 6; stroke-linecap: round; fill: none; }

/* ---- 表情 ---- */
.eye       { fill: #0a0f17; }
.eye-white { fill: #f5f0e8; stroke: #0a0f17; stroke-width: 1.5; }
.eye-gleam {
  fill: color-mix(in oklab, #fff calc(var(--on) * 100%), transparent);
}
.eyelid { stroke: #0a0f17; stroke-width: 3; fill: none; stroke-linecap: round; }
.eyelid-flat { stroke: #0a0f17; stroke-width: 3; stroke-linecap: round; }
.happy-eye { stroke: #0a0f17; stroke-width: 3.5; fill: none; stroke-linecap: round; }
.blush { fill: color-mix(in oklab, #ff8d7a 55%, var(--accent)); opacity: 0.55; }
.mouth { stroke: #0a0f17; stroke-width: 2.5; fill: none; stroke-linecap: round; }
.sweat { fill: #9fc9ee; opacity: 0.85; animation: sweat-slide 1.7s ease-in infinite; }
@keyframes sweat-slide {
  0%   { transform: translateY(0);   opacity: 0; }
  25%  { opacity: 0.85; }
  100% { transform: translateY(9px); opacity: 0; }
}
/* 烧毁时房间全黑，五官改用浅色描边 */
.dizzy line { stroke: #cfd8ea; stroke-width: 3; stroke-linecap: round; }
.burnt .mouth { stroke: #cfd8ea; }

/* ---- 灯绳 ---- */
.cord-path {
  stroke: color-mix(in oklab, var(--accent) calc(var(--on) * 30% + 40%), #4a5464);
  stroke-width: 2.5;
  fill: none;
  stroke-linecap: round;
}
.knob-group {
  cursor: grab;
  touch-action: none;
  outline: none;
}
.knob-group:active { cursor: grabbing; }
.knob-group:focus-visible .cord-knob {
  stroke: #eaedf3;
  stroke-width: 2.5;
}
.cord-knob {
  fill: var(--accent);
  stroke: #0a0f17;
  stroke-width: 2;
  filter: drop-shadow(0 0 calc(var(--on) * 10px) var(--accent-glow));
}
/* 关灯时的呼吸光环，引导视线到灯绳 */
.knob-ring {
  fill: none;
  stroke: #97a2b8;
  stroke-width: 1.5;
  transform-box: fill-box;
  transform-origin: center;
  animation: ring-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes ring-pulse {
  0%   { transform: scale(0.7); opacity: calc((1 - var(--on)) * 0.9); }
  70%  { opacity: 0; }
  100% { transform: scale(1.9); opacity: 0; }
}
.cord-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  fill: var(--ink-dim);
  opacity: calc(0.85 - var(--on) * 0.55);
  pointer-events: none;
  animation: hint-bob 2.4s ease-in-out infinite;
}
@keyframes hint-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(3px); }
}

@media (max-width: 820px) {
  .lamp-area { width: 300px; height: 390px; }
}
</style>
