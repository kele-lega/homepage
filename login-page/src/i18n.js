import { ref, computed } from 'vue'

// 极简双语方案：一个 ref + 一份字典，不引入 vue-i18n
const KEY = 'lamp-lang'
const stored = localStorage.getItem(KEY)
const initial =
  stored === 'zh' || stored === 'en'
    ? stored
    : (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'

export const lang = ref(initial)

const messages = {
  zh: {
    // 谢幕横幅
    bannerMain: '晚安，欢迎回来',
    bannerSub: 'GOOD NIGHT · WELCOME BACK',
    // 页脚
    footerTouch: '拉一下灯绳开关灯 · 它有点怕痒',
    footerPre: '拉灯绳 或按',
    footerPost: '开关灯 · 它有点怕痒',
    // 提示条
    toastBurnout: '啪！灯泡被你拉烧了……',
    toastChanging: '它正在摸黑换灯泡…',
    toastNewBulb: '新灯泡换好了，温柔点拉 🙏',
    toastAdminHint: '……要不试试 admin / 123456？',
    toastAnnoyed: '又错了，台灯有点无语',
    toastDark: '太黑了，先拉一下灯绳',
    toastSuccess: '登录成功 · 欢迎回来',
    // 登录卡片
    eyebrow: 'NIGHT DESK · 深夜书桌',
    title: '夜深了，欢迎回来',
    sub: '台灯已为你亮起 · The lamp is on for you',
    titleDark: '好黑，什么都看不清',
    subDark: '░░░░░░░░ · The room is pitch dark',
    userLabel: '账号',
    userPh: '请输入账号',
    passLabel: '密码',
    passPh: '请输入密码',
    remember: '记住我',
    forget: '忘记密码？',
    btnLogin: '登 录',
    btnDark: '太黑了，先开灯',
    btnLoading: '正在点亮…',
    btnWelcome: '✓ 欢迎回来',
    demoUser: '演示账号',
    demoPass: '密码',
    demoDark: '（黑暗中隐约有一行小字）',
    errEmpty: '请输入账号和密码',
    errWrong: '账号或密码错误',
    showPass: '显示密码',
    hidePass: '隐藏密码',
    // 灯绳提示
    hintPull: '往下拉 ↓',
    hintOff: '拉一下关灯',
    hintPokeOff: '先拉灯绳啦',
    hintBurnt: '……灯泡烧了',
    hintNudge: '先拉我开灯',
    offHint1: '喂，拉我一下 ↓',
    offHint2: '黑着也不是办法…',
    offHint3: '按 L 也行',
    ariaCordOn: '拉灯绳开灯',
    ariaCordOff: '拉灯绳关灯',
    langSwitch: 'Switch to English',
  },
  en: {
    bannerMain: 'Good night, welcome back',
    bannerSub: '晚安 · 欢迎回来',
    footerTouch: 'Pull the cord to toggle the lamp · it’s a little ticklish',
    footerPre: 'Pull the cord or press',
    footerPost: 'to toggle · it’s a little ticklish',
    toastBurnout: 'Pop! You just burned the bulb out…',
    toastChanging: 'Changing the bulb in the dark…',
    toastNewBulb: 'New bulb in. Gently this time 🙏',
    toastAdminHint: '…maybe try admin / 123456?',
    toastAnnoyed: 'Wrong again. The lamp is speechless.',
    toastDark: 'Too dark — pull the cord first',
    toastSuccess: 'Signed in · Welcome back',
    eyebrow: 'NIGHT DESK · 深夜书桌',
    title: 'It’s late. Welcome back.',
    sub: 'The lamp is on for you · 台灯已为你亮起',
    titleDark: 'Too dark to see anything',
    subDark: '░░░░░░░░ · 伸手不见五指',
    userLabel: 'Username',
    userPh: 'Enter username',
    passLabel: 'Password',
    passPh: 'Enter password',
    remember: 'Remember me',
    forget: 'Forgot password?',
    btnLogin: 'SIGN IN',
    btnDark: 'Too dark — light the lamp',
    btnLoading: 'Lighting up…',
    btnWelcome: '✓ Welcome back',
    demoUser: 'Demo account',
    demoPass: 'password',
    demoDark: '(a faint line of text in the dark)',
    errEmpty: 'Enter your username and password',
    errWrong: 'Wrong username or password',
    showPass: 'Show password',
    hidePass: 'Hide password',
    hintPull: 'Pull down ↓',
    hintOff: 'Pull to turn off',
    hintPokeOff: 'Pull the cord first',
    hintBurnt: '…bulb’s dead',
    hintNudge: 'Light me first',
    offHint1: 'Hey, pull me ↓',
    offHint2: 'It can’t stay dark forever…',
    offHint3: 'Pressing L works too',
    ariaCordOn: 'Pull the cord to turn the lamp on',
    ariaCordOff: 'Pull the cord to turn the lamp off',
    langSwitch: '切换为中文',
  },
}

export const T = computed(() => messages[lang.value])

export function setLang(l) {
  lang.value = l
  localStorage.setItem(KEY, l)
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
}

export function toggleLang() {
  setLang(lang.value === 'zh' ? 'en' : 'zh')
}

document.documentElement.lang = lang.value === 'zh' ? 'zh-CN' : 'en'
