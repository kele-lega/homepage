<template>
  <div
    ref="wrapEl"
    class="card-wrap"
    :class="{ off: dark, finale }"
    @pointermove="onTorchMove"
    @pointerdown="onDarkClick"
  >
    <form class="card" :class="{ shake: shaking }" @submit.prevent="handleSubmit" autocomplete="off">
      <p class="eyebrow">{{ t.eyebrow }}</p>
      <h1>{{ t.title }}</h1>
      <p class="sub">{{ t.sub }}</p>

      <div class="field">
        <label for="user">{{ t.userLabel }}</label>
        <input
          id="user"
          v-model="username"
          name="user"
          type="text"
          :placeholder="t.userPh"
          spellcheck="false"
          :disabled="loading || dark"
        />
      </div>

      <div class="field">
        <label for="pass">{{ t.passLabel }}</label>
        <div class="pass-box">
          <input
            id="pass"
            v-model="password"
            name="pass"
            :type="showPass ? 'text' : 'password'"
            :placeholder="t.passPh"
            :disabled="loading || dark"
            @focus="emit('peek')"
            @blur="emit('idle')"
          />
          <button
            type="button"
            class="eye-toggle"
            :aria-label="showPass ? T.hidePass : T.showPass"
            :disabled="dark"
            @click="showPass = !showPass"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
              <line v-if="!showPass" x1="4" y1="20" x2="20" y2="4" />
            </svg>
          </button>
        </div>
      </div>

      <p class="error" :class="{ show: errKey }">{{ errKey ? T[errKey] : ' ' }}</p>

      <div class="row">
        <label class="remember">
          <input v-model="remember" type="checkbox" :disabled="loading || dark" />
          <span>{{ t.remember }}</span>
        </label>
        <a href="#" class="forget" @click.prevent>{{ t.forget }}</a>
      </div>

      <button type="submit" class="btn" :disabled="loading || dark">{{ dark ? T.btnDark : T[btnKey] }}</button>

      <p class="demo">{{ T.demoDark }}</p>
    </form>

    <!-- 关灯后的“手电筒”微光 -->
    <div class="torch" aria-hidden="true"></div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { T } from '../i18n'

const props = defineProps({
  lampOn: Boolean,
  finale: Boolean,
})
const emit = defineEmits(['peek', 'idle', 'surprise', 'success', 'dark-poke'])

const wrapEl = ref(null)
const username = ref('')
const password = ref('')
const remember = ref(false)
const showPass = ref(false)
const loading = ref(false)
const shaking = ref(false)
const errKey = ref('')
const btnKey = ref('btnLogin')

const dark = computed(() => !props.lampOn)

// 关灯后，文案“黑到看不清”
const t = computed(() =>
  dark.value
    ? {
        eyebrow: '▓▓▓▓ ▓▓▓▓ · ▓▓▓▓',
        title: T.value.titleDark,
        sub: T.value.subDark,
        userLabel: '▓▓',
        userPh: '░░░░░░░░',
        passLabel: '▓▓',
        passPh: '░░░░░░░░',
        remember: '▓▓▓',
        forget: '▓▓▓▓？',
      }
    : {
        eyebrow: T.value.eyebrow,
        title: T.value.title,
        sub: T.value.sub,
        userLabel: T.value.userLabel,
        userPh: T.value.userPh,
        passLabel: T.value.passLabel,
        passPh: T.value.passPh,
        remember: T.value.remember,
        forget: T.value.forget,
      }
)

// ---------- 黑暗中的手电筒 ----------
function setTorch(e) {
  if (!wrapEl.value) return
  const r = wrapEl.value.getBoundingClientRect()
  wrapEl.value.style.setProperty('--tx', `${e.clientX - r.left}px`)
  wrapEl.value.style.setProperty('--ty', `${e.clientY - r.top}px`)
}

function onTorchMove(e) {
  if (!dark.value) return
  setTorch(e)
}

let lastPoke = 0
function onDarkClick(e) {
  if (!dark.value) return
  // 手指点按时，微光直接出现在指尖
  setTorch(e)
  const now = Date.now()
  if (now - lastPoke < 1500) return
  lastPoke = now
  emit('dark-poke')
}

// ---------- 登录 ----------
function fail(key) {
  errKey.value = key
  shaking.value = false
  // 强制重启抖动动画
  requestAnimationFrame(() => { shaking.value = true })
  setTimeout(() => { shaking.value = false }, 500)
  emit('surprise', T.value[key])
}

async function handleSubmit() {
  if (loading.value || dark.value) return
  errKey.value = ''
  if (!username.value.trim() || !password.value.trim()) {
    fail('errEmpty')
    return
  }
  loading.value = true
  btnKey.value = 'btnLoading'
  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
    })
    if (!response.ok) {
      fail('errWrong')
      return
    }
    btnKey.value = 'btnWelcome'
    emit('success')
    setTimeout(() => {
      window.location.assign('/')
    }, 900)
  } catch {
    fail('errWrong')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.card-wrap {
  position: relative;
  width: 384px;
  transform-origin: left center;
  transition:
    opacity 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s,
    transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s;
}
/* 关灯：卡片没入黑暗，只剩轮廓 */
.card-wrap.off {
  opacity: 0.6;
  transform: scale(0.985);
  cursor: pointer;
  touch-action: none;
  transition-delay: 0s;
}
.card-wrap.off .card {
  pointer-events: none;
  border-color: #1c2433;
  background: #0b101a;
  box-shadow: none;
  filter: saturate(0.15) brightness(0.55) blur(0.7px);
}
/* 登录成功：谢幕退场 */
.card-wrap.finale {
  opacity: 0;
  transform: translateY(-26px) scale(0.95);
  pointer-events: none;
}

/* 黑暗中的手电筒：跟随鼠标的一小圈微光 */
.torch {
  position: absolute;
  inset: -14px;
  z-index: 2;
  border-radius: 28px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.7s ease;
  background: radial-gradient(
    circle 110px at var(--tx, 50%) var(--ty, 42%),
    transparent 0%,
    rgba(4, 7, 12, 0.55) 45%,
    rgba(4, 7, 12, 0.92) 72%
  );
}
.card-wrap.off .torch { opacity: 1; }

.card {
  background: var(--card-bg);
  border: 1.5px solid var(--accent);
  border-radius: 18px;
  padding: 30px 30px 22px;
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--accent) 25%, transparent),
    0 18px 50px -8px color-mix(in oklab, var(--accent-glow) 40%, #000),
    0 0 60px -10px var(--accent-glow),
    inset 0 1px 0 color-mix(in oklab, var(--accent) 20%, transparent);
  backdrop-filter: blur(6px);
  transition: border-color 0.7s ease, background 0.7s ease, box-shadow 0.7s ease, filter 0.7s ease;
}
.card.shake { animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
@keyframes shake {
  10%, 90%      { transform: translateX(-1px); }
  20%, 80%      { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60%      { transform: translateX(4px); }
}

.eyebrow {
  margin: 0 0 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 3px;
  color: color-mix(in oklab, var(--accent) 80%, var(--ink-dim));
  transition: color 0.6s;
}
.card h1 {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 27px;
  letter-spacing: 1px;
  color: var(--ink);
}
.card .sub {
  margin: 0 0 22px;
  font-size: 12.5px;
  color: var(--ink-dim);
  letter-spacing: 0.3px;
}

.field { margin-bottom: 14px; }
.field label {
  display: block;
  font-size: 12px;
  color: var(--ink-dim);
  margin-bottom: 6px;
  letter-spacing: 0.4px;
}
.field input {
  width: 100%;
  background: #0e1420;
  border: 1.5px solid #232b38;
  border-radius: 10px;
  padding: 12px 14px;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.25s, box-shadow 0.25s, background 0.25s;
}
.field input::placeholder { color: #4a5364; }
.field input:disabled { opacity: 0.6; }
.field input:focus {
  border-color: var(--accent);
  background: #121a28;
  box-shadow:
    0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent),
    0 0 18px color-mix(in oklab, var(--accent-glow) 35%, transparent),
    inset 0 0 14px color-mix(in oklab, var(--accent-glow) 10%, transparent);
}

.pass-box { position: relative; }
.pass-box input { padding-right: 44px; }
.eye-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: none;
  padding: 8px;
  color: var(--ink-dim);
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  transition: color 0.25s;
}
.eye-toggle:hover { color: var(--accent); }

.error {
  margin: 0 0 4px;
  min-height: 16px;
  font-size: 12px;
  color: var(--danger);
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 0.25s, transform 0.25s;
}
.error.show { opacity: 1; transform: none; }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.remember {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--ink-dim);
  cursor: pointer;
  user-select: none;
}
.remember input {
  appearance: none;
  width: 15px;
  height: 15px;
  margin: 0;
  border: 1.5px solid #2c3646;
  border-radius: 4px;
  background: #0e1420;
  cursor: pointer;
  display: grid;
  place-content: center;
  transition: border-color 0.25s, background 0.25s;
}
.remember input::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: #0a0f17;
  transform: scale(0);
  transition: transform 0.15s;
}
.remember input:checked {
  border-color: var(--accent);
  background: var(--accent);
}
.remember input:checked::before { transform: scale(1); }

.forget {
  font-size: 12px;
  color: var(--ink-dim);
  text-decoration: none;
  letter-spacing: 0.3px;
  transition: color 0.25s;
}
.forget:hover { color: var(--accent); }

.btn {
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--accent) 90%, #fff 10%),
    var(--accent) 60%,
    color-mix(in oklab, var(--accent) 85%, #000 15%));
  color: #0a0f17;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 2px;
  cursor: pointer;
  box-shadow:
    0 8px 20px -6px var(--accent-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transition: filter 0.2s, transform 0.1s, box-shadow 0.3s;
}
.btn:hover:not(:disabled)  { filter: brightness(1.08); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { cursor: default; filter: saturate(0.85); }

.demo {
  margin: 14px 0 0;
  text-align: center;
  font-size: 11px;
  color: color-mix(in oklab, var(--ink-dim) 75%, transparent);
  letter-spacing: 0.3px;
}
.demo code {
  font-family: var(--font-mono);
  color: var(--ink-dim);
  background: #0e1420;
  border: 1px solid #1e2735;
  border-radius: 5px;
  padding: 1px 6px;
}

@media (max-width: 820px) {
  .card-wrap { width: min(384px, 100%); }
}
</style>
