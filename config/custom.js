/**
 * 明暗壁纸路径来自 settings.yaml 的 wallpapers.light / wallpapers.dark。
 * 图片放 public/ 后只改 yaml 路径，刷新即可。
 */
(function () {
  "use strict";

  var DEFAULTS = {
    dark: "/images/background.png",
    light: "/images/background-light.jpg",
  };

  function sanitizePath(value) {
    if (typeof value !== "string") return null;
    var path = value.trim();
    if (!path || path.length > 500) return null;
    if (/["'\\]|url\s*\(/i.test(path)) return null;
    if (path.charAt(0) === "/" && path.charAt(1) !== "/") return path;
    if (/^https:\/\//i.test(path)) return path;
    return null;
  }

  function readWallpapers() {
    try {
      var settings = window.__NEXT_DATA__.props.pageProps.initialSettings.wallpapers;
      return {
        dark: sanitizePath(settings && settings.dark) || DEFAULTS.dark,
        light: sanitizePath(settings && settings.light) || DEFAULTS.light,
      };
    } catch (error) {
      return DEFAULTS;
    }
  }

  var wallpapers = readWallpapers();
  var root = document.documentElement;
  root.style.setProperty("--wallpaper-dark", 'url("' + wallpapers.dark + '")');
  root.style.setProperty("--wallpaper-light", 'url("' + wallpapers.light + '")');
})();

/**
 * Homepage custom.js — iOS/macOS 风格时钟
 *
 * 在页面顶部 #widgets-wrap 左侧插入一个跟随 Asia/Shanghai 时区的数字时钟。
 * 纯客户端注入，每秒刷新，水合后/SPA 切换后自动重新挂载。
 */
(function () {
  "use strict";

  var CLOCK_ID = "ios-clock";
  var TZ = "Asia/Shanghai";
  var LOCALE = "zh-CN";

  // 中文星期映射，避免不同 ICU 对 weekday: 'short' 输出差异（"周一"/"星期一"）
  var WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  // 用 Intl 拿到指定时区下的各部分，保证不受本机时区影响
  function shanghaiParts() {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
      weekday: "short",
    });
    var parts = fmt.formatToParts(new Date());
    var o = {};
    for (var i = 0; i < parts.length; i++) {
      o[parts[i].type] = parts[i].value;
    }
    // weekday 在 en-US 下是 "Sun/Mon/..."，映射回中文
    var dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    o.weekdayZh = WEEKDAYS[dowMap[o.weekday] !== undefined ? dowMap[o.weekday] : 0];
    // hour12:false 在某些环境对 0 点可能返回 "24"，归一化为 "00"
    if (o.hour === "24") o.hour = "00";
    return o;
  }

  function buildClock() {
    var wrap = document.createElement("div");
    wrap.id = CLOCK_ID;
    wrap.className = "ios-clock";

    var time = document.createElement("div");
    time.className = "ios-clock-time";

    var hm = document.createElement("span");
    hm.className = "ios-clock-hm";
    var s = document.createElement("span");
    s.className = "ios-clock-s";
    time.appendChild(hm);
    time.appendChild(s);

    var date = document.createElement("div");
    date.className = "ios-clock-date";

    wrap.appendChild(time);
    wrap.appendChild(date);
    return wrap;
  }

  function tick(node) {
    var p = shanghaiParts();
    var hh = pad(parseInt(p.hour, 10));
    var mm = pad(parseInt(p.minute, 10));
    var ss = pad(parseInt(p.second, 10));
    var hmEl = node.querySelector(".ios-clock-hm");
    var sEl = node.querySelector(".ios-clock-s");
    var dateEl = node.querySelector(".ios-clock-date");
    if (hmEl) hmEl.textContent = hh + ":" + mm;
    if (sEl) sEl.textContent = ":" + ss; // 秒用更小更淡的样式
    if (dateEl) {
      dateEl.textContent =
        p.year + "年" + parseInt(p.month, 10) + "月" + parseInt(p.day, 10) + "日 " + p.weekdayZh;
    }
  }

  var timer = null;
  var mounted = null;

  function mount() {
    var host = document.getElementById("widgets-wrap");
    if (!host) return false;
    if (mounted && document.getElementById(CLOCK_ID)) return true;

    var node = buildClock();
    // 插到最前面，让时钟出现在顶部左侧首位
    host.insertBefore(node, host.firstChild);
    mounted = node;
    tick(node);
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (mounted && document.body.contains(mounted)) {
        tick(mounted);
      } else {
        clearInterval(timer);
        timer = null;
        mounted = null;
      }
    }, 1000);
    return true;
  }

  function init() {
    // 先尝试直接挂载
    mount();

    // 持续守护：水合未完成时等 #widgets-wrap 出现；
    // 已挂载后若 React 重渲染把时钟冲掉，则重新插入。
    var obs = new MutationObserver(function () {
      mount();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/**
 * 站内搜索：筛选当前页面上的服务和书签，Enter 打开首个匹配项。
 */
(function () {
  "use strict";

  var SEARCH_ID = "homepage-local-search";
  var ITEM_SELECTOR = "li.service, li.bookmark";

  function normalize(value) {
    return (value || "").toLocaleLowerCase("zh-CN").trim();
  }

  function searchableText(item) {
    return normalize((item.dataset.name || "") + " " + (item.textContent || ""));
  }

  function filterItems(query) {
    var keyword = normalize(query);
    var items = document.querySelectorAll(ITEM_SELECTOR);
    var firstMatch = null;

    for (var i = 0; i < items.length; i++) {
      var matches = !keyword || searchableText(items[i]).indexOf(keyword) !== -1;
      items[i].classList.toggle("local-search-hidden", !matches);
      if (matches && keyword && !firstMatch) firstMatch = items[i];
    }

    return firstMatch;
  }

  function buildSearch() {
    var form = document.createElement("form");
    form.id = SEARCH_ID;
    form.className = "homepage-local-search information-widget-form";
    form.setAttribute("role", "search");

    var input = document.createElement("input");
    input.type = "search";
    input.placeholder = "搜索本站服务和书签…";
    input.setAttribute("aria-label", "搜索本站服务和书签");
    input.autocomplete = "off";

    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "homepage-local-search-clear";
    clear.textContent = "×";
    clear.title = "清空站内搜索";
    clear.setAttribute("aria-label", "清空站内搜索");

    input.addEventListener("input", function () {
      filterItems(input.value);
      clear.hidden = !input.value;
    });
    clear.addEventListener("click", function () {
      input.value = "";
      clear.hidden = true;
      filterItems("");
      input.focus();
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var firstMatch = filterItems(input.value);
      if (!firstMatch) return;
      var link = firstMatch.querySelector("a[href]");
      if (link) link.click();
    });

    clear.hidden = true;
    form.appendChild(input);
    form.appendChild(clear);
    return form;
  }

  function mountSearch() {
    var host = document.getElementById("widgets-wrap");
    if (!host || document.getElementById(SEARCH_ID)) return;
    var externalSearch = host.querySelector(".information-widget-search");
    if (externalSearch && externalSearch.parentElement) {
      externalSearch.parentElement.insertBefore(buildSearch(), externalSearch);
    } else {
      host.appendChild(buildSearch());
    }
  }

  function initSearch() {
    mountSearch();
    var observer = new MutationObserver(mountSearch);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSearch);
  } else {
    initSearch();
  }
})();

/**
 * 农历注入 —— 在日历每个日期格子的公历数字下方加上中文农历日。
 * 仅在 li.service[data-name="Calendar"] 内生效；翻月时自动重新注入。
 */
(function () {
  "use strict";

  // 1900-2099 农历数据：每年一个整数，位编码该年农历月大小 + 闰月
  // 数据来自公开的农历算法（寿星天文历精简表）
  var LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, //1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, //1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, //1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, //1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, //1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, //1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, //1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, //1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, //1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, //1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, //2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, //2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, //2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, //2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, //2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, //2050-2059
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, //2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, //2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, //2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, //2090-2099
  ];

  // 农历日名 / 月名（节气暂不计算，保持格子简洁）
  function lunarYearDays(y) {
    var sum = 348;
    for (var i = 0x8000; i > 0x8; i >>= 1) {
      sum += LUNAR_INFO[y - 1900] & i ? 1 : 0;
    }
    return sum + leapDays(y);
  }
  function leapMonth(y) {
    return LUNAR_INFO[y - 1900] & 0xf;
  }
  function leapDays(y) {
    if (leapMonth(y)) {
      return LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29;
    }
    return 0;
  }
  function monthDays(y, m) {
    return LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29;
  }

  // 公历 Date -> {year, month, day, isLeap} 农历
  function solar2lunar(date) {
    var baseDate = new Date(1900, 0, 31); // 1900-01-31 = 农历 1900 正月初一
    var offset = Math.floor((date.getTime() - baseDate.getTime()) / 86400000);
    var y, temp = 0;
    for (y = 1900; y < 2100 && offset > 0; y++) {
      temp = lunarYearDays(y);
      offset -= temp;
    }
    if (offset < 0) {
      offset += temp;
      y--;
    }
    var leap = leapMonth(y);
    var isLeap = false;
    var m, d;
    for (m = 1; m < 13 && offset > 0; m++) {
      if (leap > 0 && m === leap + 1 && !isLeap) {
        --m;
        isLeap = true;
        d = leapDays(y);
      } else {
        d = monthDays(y, m);
      }
      offset -= d;
      if (isLeap && m === leap + 1) isLeap = false;
    }
    if (offset === 0 && leap > 0 && m === leap + 1) {
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        --m;
      }
    }
    if (offset < 0) {
      offset += d;
      --m;
    }
    return { year: y, month: m, day: offset + 1, isLeap: isLeap };
  }

  var LUNAR_DAY_NAME = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
  ];
  var LUNAR_MONTH_NAME = [
    "正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月",
  ];

  // 给一个公历 Date，返回要显示的农历标签（初一日显示月名，其余显示日名）
  function lunarLabel(date) {
    var l = solar2lunar(date);
    if (l.day === 1) {
      return (l.isLeap ? "闰" : "") + LUNAR_MONTH_NAME[l.month - 1];
    }
    return LUNAR_DAY_NAME[l.day - 1];
  }

  // 英文月份名 -> 月号
  var MONTHS_EN = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  // 从月份标题按钮解析当前年月，返回 {year, month} 或 null
  function parseHeader(li) {
    var btn = li.querySelector(".w-full.text-center > .flex-col > span:nth-child(2) button");
    if (!btn) return null;
    var txt = (btn.textContent || "").trim();
    // 形如 "August 2026" / "8月 2026" / "2026年 8月"
    var m = txt.match(/([A-Za-z]+)\s+(\d{4})/);
    if (m) {
      var mon = MONTHS_EN[m[1].toLowerCase()];
      if (mon) return { year: parseInt(m[2], 10), month: mon };
    }
    m = txt.match(/(\d{4})[年\-\/.](\d{1,2})/);
    if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
    m = txt.match(/(\d{1,2})\s*月?\s*(\d{4})/);
    if (m) return { year: parseInt(m[2], 10), month: parseInt(m[1], 10) };
    return null;
  }

  // 给日历注入农历
  function injectLunar() {
    var li = document.querySelector('li.service[data-name="Calendar"]');
    if (!li) return;
    var grid = li.querySelector(
      ".pl-1.pr-1.pb-1.w-full .flex.justify-between.flex-wrap.pb-1"
    );
    if (!grid) return;
    var header = parseHeader(li);
    if (!header) return;

    var buttons = grid.querySelectorAll("button");
    // 若网格里已有农历标记，说明本次渲染已处理过，整体跳过（避免部分注入导致错位）
    if (grid.querySelector(".ios-lunar")) return;
    var days = []; // 按顺序收集每个 button 的公历日
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      // button 的第一个文本节点是公历日
      var dayText = "";
      b.childNodes.forEach(function (n) {
        if (!dayText && n.nodeType === 3) dayText = n.textContent.trim();
      });
      var day = parseInt(dayText, 10);
      if (!day) continue;
      days.push({ btn: b, day: day });
    }
    if (!days.length) return;

    // 推算第一个格子的真实日期：日历可能从上月某天开始。
    // 用 header 的年月构造一个“当月 day 号”，找到第一个属于当月的格子，
    // 再向前推算非本月格子。但更简单：用每个 button 的 day 序列 + 是否非本月 class 反推。
    // 这里采用：以当月 1 号为锚，找到 day==1 且非“非本月”的格子作为月初，其余按序号差推算。
    var year = header.year;
    var month = header.month; // 1-12

    // 找到第一个“本月”格子的索引（无 text-gray-500 / text-red-500/40 类）
    var firstInMonthIdx = -1;
    for (var j = 0; j < days.length; j++) {
      var cls = days[j].btn.className;
      var isOther = /text-gray-500/.test(cls) || /text-red-500\/40/.test(cls);
      if (!isOther) {
        firstInMonthIdx = j;
        break;
      }
    }
    // 兜底：若没靠 class 找到，退而找 day===1 的格子作为月初
    if (firstInMonthIdx < 0) {
      for (var j2 = 0; j2 < days.length; j2++) {
        if (days[j2].day === 1) {
          firstInMonthIdx = j2;
          break;
        }
      }
    }
    if (firstInMonthIdx < 0) return; // 仍找不到，放弃本次注入

    for (var k = 0; k < days.length; k++) {
      var info = days[k];
      var offset = k - firstInMonthIdx; // 相对本月初的偏移天数
      var date = new Date(year, month - 1, 1 + offset);
      var label = lunarLabel(date);
      var span = document.createElement("span");
      span.className = "ios-lunar";
      span.textContent = label;
      // 插在公历数字之后、事件点 span 之前
      info.btn.appendChild(span);
    }
  }

  function initLunar() {
    injectLunar();
    // 翻月/重渲染时重新注入
    var obs = new MutationObserver(function () {
      injectLunar();
    });
    var li = document.querySelector('li.service[data-name="Calendar"]');
    if (li) {
      obs.observe(li, { childList: true, subtree: true });
    } else {
      // 日历还没渲染，先观察整个文档等它出现
      var wait = new MutationObserver(function () {
        var li2 = document.querySelector('li.service[data-name="Calendar"]');
        if (li2) {
          wait.disconnect();
          injectLunar();
          obs.observe(li2, { childList: true, subtree: true });
        }
      });
      wait.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLunar);
  } else {
    initLunar();
  }
})();

/**
 * Homepage custom.js — 基金净值监控卡片
 *
 * 数据来自 fund-monitor 服务（后台常驻抓取，页面关了也在跑）。
 * 本卡片只展示净值和涨跌，不涉及金额、份额、盈亏。
 * 盘中显示估算净值并标注「估算」，正式净值发布后自动切换为「正式」。
 */
(function () {
  "use strict";

  var CARD_ID = "ios-fund";
  var GROUP_ID = "ios-fund-group";
  var FUND_PANEL_KEY = "homepage-fund-panel";
  var POLL_MS = 30000; // 前端只是读缓存，间隔可以比后端抓取更短

  // 后端地址在生产/本地不一样，而本地 homepage 端口还可能被改（3000/3001/…），
  // 所以不靠端口号猜：依次探测候选地址，谁的 /healthz 通就用谁，结果缓存下来。
  //   1. window.FUND_MONITOR_BASE —— 手动指定，优先级最高
  //   2. /fund-monitor          —— 生产由 Caddy 同源反代
  //   3. //<当前域名>:8090       —— 本地开发直连容器映射端口
  var BASE_PORT = "8090";
  var resolvedBase = null;
  var probing = null;

  function candidates() {
    var list = [];
    if (window.FUND_MONITOR_BASE) list.push(window.FUND_MONITOR_BASE);
    list.push("/fund-monitor");
    list.push(location.protocol + "//" + location.hostname + ":" + BASE_PORT);
    return list;
  }

  // 探测：/healthz 必须返回 JSON 且 ok=true。
  // homepage 自己的 404 页面是 HTML，解析就失败，能被正确排除。
  function probe(base) {
    return fetch(base + "/healthz", { cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error("非监控服务响应");
        return base;
      });
  }

  function resolveBase() {
    if (resolvedBase) return Promise.resolve(resolvedBase);
    if (probing) return probing;
    var list = candidates();
    probing = list
      .reduce(function (chain, base) {
        return chain.catch(function () { return probe(base); });
      }, Promise.reject())
      .then(function (base) {
        resolvedBase = base;
        probing = null;
        return base;
      })
      .catch(function (err) {
        probing = null;
        throw new Error("找不到监控服务（已试 " + list.join("、") + "）");
      });
    return probing;
  }

  var state = { funds: [], lastRefresh: null, lastError: null, netError: null, loaded: false };
  var calendar = { loaded: false, configured: false, url: "", draft: "", message: "", busy: false, operation: 0, request: 0 };
  var account = {
    loaded: false,
    user: "",
    admin: false,
    message: "",
    busy: false,
    operation: 0,
    request: 0,
    users: [],
    usersLoaded: false,
    usersMessage: "",
    usersBusy: false,
    newUser: "",
    newPassword: "",
    currentPassword: "",
    newSelfPassword: "",
    confirmPassword: "",
    passwordMessage: "",
    passwordBusy: false,
    resetUser: "",
    resetPassword: "",
  };
  var accountSession = 0;
  var fundPanelEnabled = true;
  var draft = ""; // 输入框内容，React 重渲染冲掉卡片后不丢
  var SETTINGS_LABELS = { calendar: "日历", panel: "面板", steam: "Steam", account: "账号", users: "账号管理" };
  var settingsOpen = false;
  var settingsPhase = "closed";
  var settingsSection = "calendar";
  var settingsMounted = null;
  var settingsLayer = null;
  var settingsDialog = null;
  var settingsRefs = null;
  var settingsOpener = null;
  var settingsCloseTimer = null;
  var settingsAnimationCancel = null;
  var settingsDrag = null;
  var timer = null;
  var mounted = null;

  function api(path, options) {
    return resolveBase().then(function (base) {
      return fetch(base + path, options || {}).then(function (resp) {
        return resp.json().then(
          function (body) {
            if (!resp.ok) throw new Error((body && body.error) || "HTTP " + resp.status);
            return body;
          },
          function () {
            // 响应不是 JSON：地址可能已失效（容器重启/端口变动），下次重新探测
            if (!resp.ok) resolvedBase = null;
            throw new Error("HTTP " + resp.status);
          }
        );
      });
    });
  }

  function calendarApi(options) {
    return fetch("/calendar/api/calendar", Object.assign({ cache: "no-store" }, options || {})).then(function (resp) {
      return resp.json().then(function (body) {
        if (!resp.ok) throw new Error((body && body.error) || "HTTP " + resp.status);
        return body;
      });
    });
  }

  function authApi(path, options) {
    return fetch(path, Object.assign({ cache: "no-store", credentials: "same-origin" }, options || {})).then(function (resp) {
      return resp.json().then(function (body) {
        if (!resp.ok) throw new Error((body && body.error) || "HTTP " + resp.status);
        return body;
      }, function () {
        throw new Error("HTTP " + resp.status);
      });
    });
  }

  function fundPanelStorageKey() {
    return FUND_PANEL_KEY + ":" + (account.user || "anon");
  }

  function readFundPanelEnabled() {
    if (!account.user) return true;
    try {
      var stored = window.localStorage.getItem(fundPanelStorageKey());
      if (stored === "off") return false;
      if (stored === "on") return true;
    } catch (error) {
      // Private browsing should keep the default visible panel.
    }
    return true;
  }

  function persistFundPanelEnabled(enabled) {
    if (!account.user) return;
    try {
      window.localStorage.setItem(fundPanelStorageKey(), enabled ? "on" : "off");
    } catch (error) {
      // Ignore storage failures; the current page still updates.
    }
  }

  function groupByName(name) {
    var groups = document.getElementById("layout-groups");
    if (!groups) return null;
    var nodes = groups.querySelectorAll(".services-group");
    for (var i = 0; i < nodes.length; i++) {
      var title = nodes[i].querySelector(".service-group-name");
      if (title && title.textContent.trim() === name) return nodes[i];
    }
    return null;
  }

  function applyLayoutColumns() {
    var groups = document.getElementById("layout-groups");
    if (!groups) return;
    var visible = 0;
    Array.prototype.forEach.call(groups.children, function (node) {
      if (node.classList && node.classList.contains("services-group") && !node.hidden) visible += 1;
    });
    groups.classList.remove("layout-cols-2", "layout-cols-3", "layout-cols-4");
    if (visible <= 2) groups.classList.add("layout-cols-2");
    else if (visible === 3) groups.classList.add("layout-cols-3");
    else groups.classList.add("layout-cols-4");
  }

  function hideEmptyFundShell(group) {
    if (!group) return;
    group.classList.add("ios-fund-group", "self-start");
    var panel = group.querySelector('[id^="headlessui-disclosure-panel"]');
    var panelHasFund = panel && (panel.contains(mounted) || panel.querySelector("#" + CARD_ID + "-item"));
    if (panel && !panelHasFund) {
      panel.style.setProperty("display", "none", "important");
      panel.style.setProperty("height", "0", "important");
      panel.style.setProperty("min-height", "0", "important");
      panel.style.setProperty("margin", "0", "important");
      panel.style.setProperty("padding", "0", "important");
      panel.style.setProperty("overflow", "hidden", "important");
    }
    Array.prototype.forEach.call(group.querySelectorAll(".services-list"), function (list) {
      if (list.contains(mounted) || list.querySelector("#" + CARD_ID + "-item")) return;
      if (list.querySelector("li.service") && list.querySelector("li.service").id !== CARD_ID + "-item") return;
      list.style.setProperty("display", "none", "important");
      list.style.setProperty("height", "0", "important");
      list.style.setProperty("margin", "0", "important");
    });
  }

  function fundItem(group) {
    var lists = group.querySelectorAll(".services-list");
    var list = null;
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].querySelector("#" + CARD_ID + "-item") || !lists[i].querySelector("li.service")) {
        list = lists[i];
        break;
      }
    }
    if (!list) {
      list = el("ul", "flex flex-col services-list");
      group.appendChild(list);
    }
    list.classList.add("flex", "flex-col", "mt-3", "services-list");
    ["display", "height", "min-height", "margin", "padding", "overflow"].forEach(function (prop) {
      list.style.removeProperty(prop);
    });
    var item = document.getElementById(CARD_ID + "-item");
    if (!item) {
      item = el("li", "service");
      item.id = CARD_ID + "-item";
      item.setAttribute("data-name", "基金净值");
    }
    if (item.parentElement !== list) list.appendChild(item);
    return item;
  }

  function applyRoleLayout() {
    var ding = groupByName("丁");
    if (ding) ding.hidden = !account.admin;
    var yi = groupByName("乙") || document.getElementById(GROUP_ID);
    if (yi) {
      yi.hidden = !fundPanelEnabled;
      if (!yi.hidden) hideEmptyFundShell(yi);
    }
    if (mounted) {
      var parentGroup = mounted.closest(".services-group");
      if (parentGroup) hideEmptyFundShell(parentGroup);
    }
    applyLayoutColumns();
  }

  function unmountFund() {
    document.querySelectorAll("#" + GROUP_ID + ", #" + CARD_ID + "-item, #" + CARD_ID).forEach(function (node) {
      node.remove();
    });
    mounted = null;
    applyRoleLayout();
  }

  function setFundPanelEnabled(enabled) {
    fundPanelEnabled = !!enabled;
    persistFundPanelEnabled(fundPanelEnabled);
    if (fundPanelEnabled) mount();
    else unmountFund();
    applyRoleLayout();
    syncAccountSettings();
  }

  function createStatefulButton(label, className) {
    var button = el("button", "ios-stateful-button " + (className || ""));
    button.type = "button";
    button.dataset.state = "idle";
    var content = el("span", "ios-stateful-content");
    var text = el("span", "ios-stateful-label", label);
    var spinner = el("span", "ios-stateful-spinner");
    spinner.setAttribute("aria-hidden", "true");
    var check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("class", "ios-stateful-check");
    check.setAttribute("viewBox", "0 0 16 16");
    check.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 3 8.5 L 6.5 12 L 13 4.5");
    path.setAttribute("pathLength", "1");
    check.appendChild(path);
    content.appendChild(text);
    content.appendChild(spinner);
    content.appendChild(check);
    button.appendChild(content);

    var timers = [];
    var sequence = 0;
    var running = false;
    function clearTimers() {
      timers.forEach(function (timerId) { clearTimeout(timerId); });
      timers = [];
    }
    function state(name) {
      button.dataset.state = name;
      button.disabled = name === "loading" || name === "done";
      button.setAttribute("aria-busy", String(name === "loading"));
      text.textContent = name === "done" ? "完成" : label;
      text.hidden = name === "loading";
      spinner.hidden = name !== "loading";
      check.hidden = name !== "done";
    }
    function delay(ms, current) {
      return new Promise(function (resolve) {
        var timerId = setTimeout(function () {
          timers = timers.filter(function (value) { return value !== timerId; });
          resolve(current === sequence);
        }, ms);
        timers.push(timerId);
      });
    }
    button.run = function (action, onError, onDone, onReady) {
      if (running) return Promise.resolve(false);
      running = true;
      var current = ++sequence;
      clearTimers();
      state("loading");
      var started = Date.now();
      return Promise.resolve().then(action).then(function (result) {
        return delay(Math.max(0, 1200 - (Date.now() - started)), current).then(function (valid) {
          if (!valid) return false;
          state("done");
          if (onReady) onReady(result);
          return delay(button.doneDuration || 1500, current).then(function (stillValid) {
            if (!stillValid) return false;
            state("idle");
            running = false;
            if (onDone) onDone(result);
            return result;
          });
        });
      }).catch(function (error) {
        if (current === sequence) {
          clearTimers();
          state("idle");
          running = false;
          if (onError) onError(error);
        }
        return false;
      });
    };
    button.doneDuration = 1500;
    button.reset = function () {
      sequence += 1;
      running = false;
      clearTimers();
      state("idle");
    };
    button.dispose = function () {
      sequence += 1;
      running = false;
      clearTimers();
    };
    state("idle");
    return button;
  }

  function loadCalendar() {
    calendar.message = "";
    var request = ++calendar.request;
    var session = accountSession;
    return calendarApi()
      .then(function (data) {
        if (request !== calendar.request || session !== accountSession) return;
        calendar.configured = data.configured === true;
        calendar.url = typeof data.url === "string" ? data.url : "";
        calendar.draft = calendar.url;
        calendar.loaded = true;
        renderSettings();
      })
      .catch(function (err) {
        if (request !== calendar.request || session !== accountSession) return;
        calendar.loaded = true;
        calendar.message = "读取日历设置失败：" + err.message;
        renderSettings();
      });
  }

  function loadAccount() {
    account.message = "";
    var request = ++account.request;
    var session = accountSession;
    return fetch("/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(function (resp) {
        return resp.json().then(function (body) {
          if (!resp.ok) throw new Error((body && body.error) || "HTTP " + resp.status);
          return body;
        });
      })
      .then(function (data) {
        if (request !== account.request || session !== accountSession) return;
        account.user = typeof data.user === "string" ? data.user : "";
        account.admin = data.admin === true;
        account.loaded = true;
        // Refresh this user's calendar after landing from the native login flow.
        fetch("/calendar/api/calendar/refresh", {
          method: "POST", cache: "no-store", credentials: "same-origin",
        }).catch(function () {});
        fundPanelEnabled = readFundPanelEnabled();
        applyRoleLayout();
        if (fundPanelEnabled) mount();
        else unmountFund();
        if (account.admin) loadManagedUsers();
        else {
          account.users = [];
          account.usersLoaded = true;
        }
        renderSettings();
      })
      .catch(function (err) {
        if (request !== account.request || session !== accountSession) return;
        account.loaded = true;
        account.message = "读取账号信息失败：" + err.message;
        renderSettings();
      });
  }

  function beginCalendarOperation(message) {
    if (calendar.busy) return null;
    calendar.busy = true;
    calendar.message = message;
    var operation = ++calendar.operation;
    renderSettings();
    return operation;
  }

  function finishCalendarOperation(operation, errorMessage) {
    if (operation !== calendar.operation) return;
    calendar.busy = false;
    if (errorMessage) calendar.message = errorMessage;
    renderSettings();
  }

  function saveCalendar(url) {
    var operation = beginCalendarOperation("保存中…");
    if (operation === null) return Promise.reject(new Error("已有日历操作正在进行"));
    return calendarApi({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    }).then(function (data) {
      if (operation !== calendar.operation) return data;
      calendar.configured = data.configured === true;
      calendar.url = typeof data.url === "string" ? data.url : "";
      calendar.draft = calendar.url;
      calendar.message = "日历地址已保存";
      renderSettings();
      return data;
    }).catch(function (err) {
      if (operation === calendar.operation) calendar.message = "保存失败：" + err.message;
      throw err;
    });
  }

  function clearCalendar() {
    var operation = beginCalendarOperation("清除中…");
    if (operation === null) return Promise.reject(new Error("已有日历操作正在进行"));
    return calendarApi({ method: "DELETE" }).then(function (data) {
      if (operation !== calendar.operation) return data;
      calendar.configured = false;
      calendar.url = "";
      calendar.draft = "";
      calendar.message = "日历地址已清除";
      renderSettings();
      return data;
    }).catch(function (err) {
      if (operation === calendar.operation) calendar.message = "清除失败：" + err.message;
      throw err;
    });
  }

  function loadManagedUsers() {
    if (!account.admin) return Promise.resolve();
    account.usersMessage = "";
    return authApi("/auth/users").then(function (data) {
      account.users = Array.isArray(data.users) ? data.users : [];
      account.usersLoaded = true;
      renderSettings();
    }).catch(function (err) {
      account.usersLoaded = true;
      account.usersMessage = "读取账号列表失败：" + err.message;
      renderSettings();
    });
  }

  function createManagedUser() {
    if (account.usersBusy) return Promise.reject(new Error("账号操作正在进行"));
    var username = (account.newUser || "").trim();
    var password = account.newPassword || "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username)) {
      return Promise.reject(new Error("用户名只能包含字母、数字、点、下划线或短横线"));
    }
    if (password.length < 8) {
      return Promise.reject(new Error("密码长度需要至少 8 个字符"));
    }
    account.usersBusy = true;
    account.usersMessage = "创建中…";
    renderSettings();
    return authApi("/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password }),
    }).then(function (data) {
      account.newUser = "";
      account.newPassword = "";
      account.usersBusy = false;
      account.usersMessage = "已创建账号 " + ((data.user && data.user.user) || username);
      return loadManagedUsers();
    }).catch(function (err) {
      account.usersBusy = false;
      account.usersMessage = "创建失败：" + err.message;
      renderSettings();
      throw err;
    });
  }

  function deleteManagedUser(username) {
    if (account.usersBusy) return Promise.reject(new Error("账号操作正在进行"));
    account.usersBusy = true;
    account.usersMessage = "删除中…";
    renderSettings();
    return authApi("/auth/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username }),
    }).then(function () {
      account.usersBusy = false;
      account.usersMessage = "已删除账号 " + username;
      return loadManagedUsers();
    }).catch(function (err) {
      account.usersBusy = false;
      account.usersMessage = "删除失败：" + err.message;
      renderSettings();
      throw err;
    });
  }

  function settingsSections() {
    var keys = ["calendar", "panel", "steam", "account"];
    if (account.admin) keys.push("users");
    return keys;
  }

  function changeOwnPassword() {
    if (account.passwordBusy) return Promise.reject(new Error("密码修改正在进行"));
    var current = account.currentPassword || "";
    var next = account.newSelfPassword || "";
    var confirm = account.confirmPassword || "";
    if (next.length < 8) return Promise.reject(new Error("新密码长度需要至少 8 个字符"));
    if (next !== confirm) return Promise.reject(new Error("两次输入的新密码不一致"));
    account.passwordBusy = true;
    account.passwordMessage = "保存中…";
    renderSettings();
    return authApi("/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next }),
    }).then(function () {
      account.currentPassword = "";
      account.newSelfPassword = "";
      account.confirmPassword = "";
      account.passwordBusy = false;
      account.passwordMessage = "密码已更新，请重新登录";
      setTimeout(function () { window.location.replace("/auth/signin?autologin=0"); }, 800);
      renderSettings();
    }).catch(function (err) {
      account.passwordBusy = false;
      account.passwordMessage = "修改失败：" + err.message;
      renderSettings();
      throw err;
    });
  }

  function resetManagedPassword(username, password) {
    if (account.usersBusy) return Promise.reject(new Error("账号操作正在进行"));
    if (!username) return Promise.reject(new Error("请选择要改密的账号"));
    if ((password || "").length < 8) return Promise.reject(new Error("新密码长度需要至少 8 个字符"));
    account.usersBusy = true;
    account.usersMessage = "修改密码中…";
    renderSettings();
    return authApi("/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, new_password: password }),
    }).then(function () {
      account.resetPassword = "";
      account.usersBusy = false;
      account.usersMessage = "已更新 " + username + " 的密码";
      renderSettings();
    }).catch(function (err) {
      account.usersBusy = false;
      account.usersMessage = "改密失败：" + err.message;
      renderSettings();
      throw err;
    });
  }

  function addFundCode(code) {
    if (!/^\d{6}$/.test(code)) return Promise.reject(new Error("请输入 6 位基金代码"));
    return api("/api/funds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code }),
    }).then(function () {
      draft = "";
      state.netError = null;
      return load();
    });
  }

  function removeFundCode(code) {
    return api("/api/funds/" + code, { method: "DELETE" }).then(function () {
      state.netError = null;
      return load();
    });
  }

  function buildCalendarSettings() {
    var wrap = el("div", "ios-settings-panel ios-settings-calendar-panel");
    wrap.id = "ios-settings-calendar-panel";
    wrap.appendChild(el("p", "ios-settings-panel-description", "仅填写公开的 iCalendar 订阅地址，保存后用于当前账号的日历。"));
    var form = el("form", "ios-fund-calendar-form");
    var input = el("input", "ios-fund-calendar-input");
    input.type = "url";
    input.inputMode = "url";
    input.placeholder = "https://…/basic.ics";
    input.setAttribute("aria-label", "iCalendar 订阅地址");
    input.addEventListener("input", function () { calendar.draft = input.value; });
    var actions = el("div", "ios-settings-actions");
    var save = createStatefulButton("保存", "ios-fund-calendar-save");
    save.type = "submit";
    var clear = createStatefulButton("清除", "ios-fund-calendar-clear");
    clear.addEventListener("click", function () {
      if (!calendar.configured || calendar.busy) return;
      var operation = calendar.operation + 1;
      clear.run(clearCalendar, function (err) {
        finishCalendarOperation(operation, "清除失败：" + err.message);
      }, function () {
        finishCalendarOperation(operation);
      });
    });
    actions.appendChild(save);
    actions.appendChild(clear);
    form.appendChild(input);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!/^https?:\/\//i.test(value)) {
        calendar.message = "请输入 http 或 https 日历地址";
        syncCalendarSettings();
        return;
      }
      save.run(function () { return saveCalendar(value); }, function (err) {
        finishCalendarOperation(calendar.operation, "保存失败：" + err.message);
      }, function () {
        finishCalendarOperation(calendar.operation);
      });
    });
    wrap.appendChild(form);
    var message = el("div", "ios-fund-calendar-message");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    wrap.appendChild(message);
    return { node: wrap, input: input, save: save, clear: clear, message: message };
  }


  function buildSteamSettings() {
    var wrap = el("div", "ios-settings-panel ios-settings-steam-panel");
    wrap.id = "ios-settings-steam-panel";
    wrap.setAttribute("role", "tabpanel");
    return { node: wrap };
  }

  function buildPanelSettings() {
    var wrap = el("div", "ios-settings-panel ios-settings-panel-panel");
    wrap.id = "ios-settings-panel-panel";
    wrap.setAttribute("role", "tabpanel");
    wrap.appendChild(el("div", "ios-settings-section-title", "基金净值"));
    wrap.appendChild(el("p", "ios-settings-panel-description", "关闭后整块乙组不再显示，其余分组会自动补齐。"));
    var panelRow = el("label", "ios-settings-toggle-row");
    var panelToggle = document.createElement("input");
    panelToggle.type = "checkbox";
    panelToggle.className = "ios-settings-switch";
    panelToggle.setAttribute("aria-label", "显示基金净值");
    panelToggle.addEventListener("change", function () {
      setFundPanelEnabled(panelToggle.checked);
    });
    panelRow.appendChild(panelToggle);
    panelRow.appendChild(el("span", "", "显示基金净值"));
    wrap.appendChild(panelRow);

    wrap.appendChild(el("div", "ios-settings-section-title", "基金代码"));
    var list = el("div", "ios-settings-fund-list");
    var form = el("form", "ios-settings-user-form");
    var input = el("input", "ios-fund-calendar-input");
    input.type = "text";
    input.inputMode = "numeric";
    input.maxLength = 6;
    input.placeholder = "6 位基金代码";
    input.setAttribute("aria-label", "基金代码");
    input.addEventListener("input", function () {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      draft = input.value;
    });
    var add = createStatefulButton("添加", "ios-settings-add-fund");
    add.type = "submit";
    form.appendChild(input);
    form.appendChild(add);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var code = input.value.trim();
      add.run(function () { return addFundCode(code); }, function (err) {
        state.netError = "添加失败：" + err.message;
        renderSettings();
      }, function () {
        draft = "";
        renderSettings();
      });
    });
    var message = el("div", "ios-settings-account-message");
    message.setAttribute("role", "status");
    wrap.appendChild(list);
    wrap.appendChild(form);
    wrap.appendChild(message);
    return { node: wrap, panelToggle: panelToggle, fundsList: list, fundInput: input, addFund: add, fundMessage: message };
  }

  function buildAccountSettings() {
    var wrap = el("div", "ios-settings-panel ios-settings-account-panel");
    wrap.id = "ios-settings-account-panel";
    wrap.setAttribute("role", "tabpanel");
    wrap.appendChild(el("div", "ios-settings-section-title", "当前账号"));
    var user = el("div", "ios-settings-user", "加载中…");
    var role = el("div", "ios-settings-role");
    var description = el("p", "ios-settings-panel-description", "退出后需要重新登录才能访问此站点。修改密码需要验证原密码。");
    wrap.appendChild(user);
    wrap.appendChild(role);
    wrap.appendChild(description);

    var form = el("form", "ios-settings-password-form");
    var current = el("input", "ios-fund-calendar-input");
    current.type = "password";
    current.autocomplete = "current-password";
    current.placeholder = "原密码";
    current.setAttribute("aria-label", "原密码");
    current.addEventListener("input", function () { account.currentPassword = current.value; });
    var next = el("input", "ios-fund-calendar-input");
    next.type = "password";
    next.autocomplete = "new-password";
    next.placeholder = "新密码，至少 8 位";
    next.setAttribute("aria-label", "新密码");
    next.addEventListener("input", function () { account.newSelfPassword = next.value; });
    var confirm = el("input", "ios-fund-calendar-input");
    confirm.type = "password";
    confirm.autocomplete = "new-password";
    confirm.placeholder = "再次输入新密码";
    confirm.setAttribute("aria-label", "确认新密码");
    confirm.addEventListener("input", function () { account.confirmPassword = confirm.value; });
    var save = createStatefulButton("修改密码", "ios-settings-change-password");
    save.type = "submit";
    form.appendChild(current);
    form.appendChild(next);
    form.appendChild(confirm);
    form.appendChild(save);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      save.run(changeOwnPassword, function () {}, function () {});
    });
    var passwordMessage = el("div", "ios-settings-account-message");
    passwordMessage.setAttribute("role", "status");
    wrap.appendChild(form);
    wrap.appendChild(passwordMessage);

    var message = el("div", "ios-settings-account-message");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    wrap.appendChild(message);
    return {
      node: wrap,
      user: user,
      role: role,
      message: message,
      currentPassword: current,
      newSelfPassword: next,
      confirmPassword: confirm,
      changePassword: save,
      passwordMessage: passwordMessage,
    };
  }

  function buildUsersSettings() {
    var wrap = el("div", "ios-settings-panel ios-settings-users-panel");
    wrap.id = "ios-settings-users-panel";
    wrap.setAttribute("role", "tabpanel");
    wrap.appendChild(el("div", "ios-settings-section-title", "账号管理"));
    wrap.appendChild(el("p", "ios-settings-panel-description", "仅管理员可以添加、删除普通账号，或直接修改其他账号密码。管理员账号 kele 不能删除。"));
    var list = el("div", "ios-settings-user-list");
    var form = el("form", "ios-settings-user-form");
    var username = el("input", "ios-fund-calendar-input");
    username.autocomplete = "off";
    username.placeholder = "新用户名";
    username.setAttribute("aria-label", "新用户名");
    username.addEventListener("input", function () { account.newUser = username.value; });
    var password = el("input", "ios-fund-calendar-input");
    password.type = "password";
    password.autocomplete = "new-password";
    password.placeholder = "至少 8 位密码";
    password.setAttribute("aria-label", "新账号密码");
    password.addEventListener("input", function () { account.newPassword = password.value; });
    var create = createStatefulButton("添加账号", "ios-settings-create-user");
    create.type = "submit";
    form.appendChild(username);
    form.appendChild(password);
    form.appendChild(create);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      create.run(createManagedUser, function () {}, function () {});
    });
    var resetForm = el("form", "ios-settings-user-form");
    var resetUser = el("input", "ios-fund-calendar-input");
    resetUser.autocomplete = "off";
    resetUser.placeholder = "要改密的用户名";
    resetUser.setAttribute("aria-label", "要改密的用户名");
    resetUser.addEventListener("input", function () { account.resetUser = resetUser.value; });
    var resetPassword = el("input", "ios-fund-calendar-input");
    resetPassword.type = "password";
    resetPassword.autocomplete = "new-password";
    resetPassword.placeholder = "该账号的新密码";
    resetPassword.setAttribute("aria-label", "其他账号新密码");
    resetPassword.addEventListener("input", function () { account.resetPassword = resetPassword.value; });
    var reset = createStatefulButton("修改密码", "ios-settings-reset-password");
    reset.type = "submit";
    resetForm.appendChild(resetUser);
    resetForm.appendChild(resetPassword);
    resetForm.appendChild(reset);
    resetForm.addEventListener("submit", function (event) {
      event.preventDefault();
      reset.run(function () { return resetManagedPassword((account.resetUser || "").trim(), account.resetPassword); }, function () {}, function () {});
    });
    var usersMessage = el("div", "ios-settings-account-message");
    usersMessage.setAttribute("role", "status");
    wrap.appendChild(list);
    wrap.appendChild(form);
    wrap.appendChild(resetForm);
    wrap.appendChild(usersMessage);
    return {
      node: wrap,
      usersList: list,
      newUser: username,
      newPassword: password,
      createUser: create,
      resetUser: resetUser,
      resetPassword: resetPassword,
      resetPasswordButton: reset,
      usersMessage: usersMessage,
    };
  }

  function syncCalendarSettings() {
    if (!settingsRefs) return;
    var input = settingsRefs.input;
    if (document.activeElement !== input && input.value !== calendar.draft) input.value = calendar.draft;
    input.disabled = calendar.busy;
    if (settingsRefs.save.dataset.state !== "loading" && settingsRefs.save.dataset.state !== "done") settingsRefs.save.disabled = calendar.busy;
    if (settingsRefs.clear.dataset.state !== "loading" && settingsRefs.clear.dataset.state !== "done") {
      settingsRefs.clear.disabled = calendar.busy || !calendar.configured;
    }
    if (!calendar.loaded) settingsRefs.message.textContent = "加载中…";
    else if (calendar.message) settingsRefs.message.textContent = calendar.message;
    else if (calendar.configured) settingsRefs.message.textContent = "已配置当前登录用户的日历";
    else settingsRefs.message.textContent = "尚未配置日历";
  }

  function idleButton(button, disabled) {
    if (!button) return;
    if (button.dataset.state !== "loading" && button.dataset.state !== "done") button.disabled = !!disabled;
  }

  function syncValue(input, value) {
    if (input && document.activeElement !== input) input.value = value || "";
  }

  function syncPanelSettings() {
    if (!settingsRefs || !settingsRefs.panelToggle) return;
    settingsRefs.panelToggle.checked = fundPanelEnabled;
    syncValue(settingsRefs.fundInput, draft);
    idleButton(settingsRefs.addFund, false);
    if (settingsRefs.fundInput) settingsRefs.fundInput.disabled = false;
    if (settingsRefs.fundMessage) {
      settingsRefs.fundMessage.textContent = state.netError || (state.loaded ? "" : "加载基金列表…");
    }
    if (!settingsRefs.fundsList) return;
    settingsRefs.fundsList.textContent = "";
    if (!state.loaded) {
      settingsRefs.fundsList.appendChild(el("div", "ios-settings-user-empty", "加载中…"));
      return;
    }
    if (!state.funds.length) {
      settingsRefs.fundsList.appendChild(el("div", "ios-settings-user-empty", "还没有监控的基金"));
      return;
    }
    state.funds.forEach(function (fund) {
      var row = el("div", "ios-settings-user-row");
      row.appendChild(el("div", "ios-settings-user-name", (fund.name || "未知名称") + "  " + fund.code));
      var remove = el("button", "ios-settings-user-delete", "删除");
      remove.type = "button";
      remove.disabled = false;
      remove.addEventListener("click", function () {
        remove.disabled = true;
        removeFundCode(fund.code).catch(function (err) {
          state.netError = "删除失败：" + err.message;
          renderSettings();
        });
      });
      row.appendChild(remove);
      settingsRefs.fundsList.appendChild(row);
    });
  }

  function syncAccountSettings() {
    if (!settingsRefs || !settingsRefs.accountUser) return;
    settingsRefs.accountUser.textContent = account.loaded ? (account.user || "未知账号") : "加载中…";
    if (settingsRefs.accountRole) {
      settingsRefs.accountRole.textContent = account.loaded
        ? (account.admin ? "管理员" : "普通用户")
        : "";
    }
    if (settingsRefs.accountMessage) {
      settingsRefs.accountMessage.textContent = account.message || (account.loaded ? "当前会话有效" : "");
    }
    syncValue(settingsRefs.currentPassword, account.currentPassword);
    syncValue(settingsRefs.newSelfPassword, account.newSelfPassword);
    syncValue(settingsRefs.confirmPassword, account.confirmPassword);
    idleButton(settingsRefs.changePassword, account.passwordBusy || !account.loaded);
    if (settingsRefs.passwordMessage) settingsRefs.passwordMessage.textContent = account.passwordMessage || "";
  }

  function syncUsersSettings() {
    if (!settingsRefs) return;
    if (settingsRefs.usersTab) settingsRefs.usersTab.hidden = !account.admin;
    if (settingsRefs.usersPanel) settingsRefs.usersPanel.hidden = !account.admin || settingsSection !== "users";
    if (!account.admin) return;
    syncValue(settingsRefs.newUser, account.newUser);
    syncValue(settingsRefs.newPassword, account.newPassword);
    syncValue(settingsRefs.resetUser, account.resetUser);
    syncValue(settingsRefs.resetPassword, account.resetPassword);
    idleButton(settingsRefs.createUser, account.usersBusy);
    idleButton(settingsRefs.resetPasswordButton, account.usersBusy);
    if (settingsRefs.usersMessage) {
      settingsRefs.usersMessage.textContent = account.usersMessage || (!account.usersLoaded ? "加载账号列表…" : "");
    }
    if (!settingsRefs.usersList) return;
    settingsRefs.usersList.textContent = "";
    if (!account.usersLoaded) {
      settingsRefs.usersList.appendChild(el("div", "ios-settings-user-empty", "加载中…"));
      return;
    }
    if (!account.users.length) {
      settingsRefs.usersList.appendChild(el("div", "ios-settings-user-empty", "暂无账号"));
      return;
    }
    account.users.forEach(function (item) {
      var row = el("div", "ios-settings-user-row");
      row.appendChild(el("div", "ios-settings-user-name", item.user + (item.admin ? "（管理员）" : "")));
      if (!item.admin) {
        var actions = el("div", "ios-settings-user-actions");
        var reset = el("button", "ios-settings-user-reset", "改密");
        reset.type = "button";
        reset.disabled = account.usersBusy;
        reset.addEventListener("click", function () {
          account.resetUser = item.user;
          renderSettings();
          if (settingsRefs.resetPassword) settingsRefs.resetPassword.focus();
        });
        var remove = el("button", "ios-settings-user-delete", "删除");
        remove.type = "button";
        remove.disabled = account.usersBusy;
        remove.addEventListener("click", function () { deleteManagedUser(item.user); });
        actions.appendChild(reset);
        actions.appendChild(remove);
        row.appendChild(actions);
      }
      settingsRefs.usersList.appendChild(row);
    });
  }

  function syncSettingsSection() {
    if (!settingsRefs) return;
    var keys = settingsSections();
    if (keys.indexOf(settingsSection) < 0) settingsSection = "calendar";
    Object.keys(settingsRefs.tabs).forEach(function (section) {
      var active = settingsSection === section;
      var available = keys.indexOf(section) >= 0;
      settingsRefs.tabs[section].hidden = !available;
      settingsRefs.tabs[section].setAttribute("aria-selected", String(active));
      settingsRefs.tabs[section].tabIndex = active ? 0 : -1;
      settingsRefs.panels[section].hidden = !available || !active;
    });
    syncCalendarSettings();
    syncPanelSettings();
    syncAccountSettings();
    syncUsersSettings();
  }

  function selectSettingsSection(section, focus) {
    if (settingsSections().indexOf(section) < 0) return;
    settingsSection = section;
    syncSettingsSection();
    if (focus && settingsRefs && settingsRefs.tabs[section]) settingsRefs.tabs[section].focus();
  }

  function buildCalendarDialog() {
    var dialog = el("section", "ios-settings-dialog");
    dialog.id = "ios-calendar-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "ios-settings-title");
    dialog.setAttribute("aria-describedby", "ios-settings-description");
    dialog.tabIndex = -1;
    var handle = el("div", "ios-settings-drag-handle");
    handle.setAttribute("aria-hidden", "true");
    dialog.appendChild(handle);
    var header = el("div", "ios-settings-dialog-header");
    var copy = el("div");
    var title = el("h2", "ios-settings-dialog-title", "设置");
    title.id = "ios-settings-title";
    var description = el("p", "ios-settings-dialog-description", "管理日历、面板、Steam 和账号");
    description.id = "ios-settings-description";
    copy.appendChild(title);
    copy.appendChild(description);
    header.appendChild(copy);
    var close = el("button", "ios-settings-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭设置");
    close.addEventListener("click", function () { requestCloseSettings("close-button"); });
    header.appendChild(close);
    dialog.appendChild(header);

    var layout = el("div", "ios-settings-layout");
    var nav = el("nav", "ios-settings-nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "设置分类");
    var tabs = {};
    ["calendar", "panel", "steam", "account", "users"].forEach(function (section) {
      var tab = el("button", "ios-settings-tab", SETTINGS_LABELS[section]);
      tab.type = "button";
      tab.id = "ios-settings-tab-" + section;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "ios-settings-" + section + "-panel");
      tab.addEventListener("click", function () { selectSettingsSection(section, false); });
      nav.appendChild(tab);
      tabs[section] = tab;
    });
    nav.addEventListener("keydown", function (event) {
      var keys = settingsSections();
      var index = keys.indexOf(settingsSection);
      if (event.key === "ArrowRight" || event.key === "ArrowDown") index = (index + 1) % keys.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") index = (index + keys.length - 1) % keys.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = keys.length - 1;
      else return;
      event.preventDefault();
      selectSettingsSection(keys[index], true);
    });
    layout.appendChild(nav);
    var content = el("div", "ios-settings-content");
    var calendarContent = buildCalendarSettings();
    calendarContent.node.setAttribute("role", "tabpanel");
    calendarContent.node.setAttribute("aria-labelledby", "ios-settings-tab-calendar");
    var panelContent = buildPanelSettings();
    panelContent.node.setAttribute("aria-labelledby", "ios-settings-tab-panel");
    var steamContent = buildSteamSettings();
    steamContent.node.setAttribute("aria-labelledby", "ios-settings-tab-steam");
    var accountContent = buildAccountSettings();
    accountContent.node.setAttribute("aria-labelledby", "ios-settings-tab-account");
    var usersContent = buildUsersSettings();
    usersContent.node.setAttribute("aria-labelledby", "ios-settings-tab-users");
    content.appendChild(calendarContent.node);
    content.appendChild(panelContent.node);
    content.appendChild(steamContent.node);
    content.appendChild(accountContent.node);
    content.appendChild(usersContent.node);
    layout.appendChild(content);
    dialog.appendChild(layout);
    settingsRefs = {
      input: calendarContent.input,
      save: calendarContent.save,
      clear: calendarContent.clear,
      message: calendarContent.message,
      panelToggle: panelContent.panelToggle,
      fundsList: panelContent.fundsList,
      fundInput: panelContent.fundInput,
      addFund: panelContent.addFund,
      fundMessage: panelContent.fundMessage,
      accountUser: accountContent.user,
      accountRole: accountContent.role,
      accountMessage: accountContent.message,
      currentPassword: accountContent.currentPassword,
      newSelfPassword: accountContent.newSelfPassword,
      confirmPassword: accountContent.confirmPassword,
      changePassword: accountContent.changePassword,
      passwordMessage: accountContent.passwordMessage,
      usersTab: tabs.users,
      usersPanel: usersContent.node,
      usersList: usersContent.usersList,
      newUser: usersContent.newUser,
      newPassword: usersContent.newPassword,
      createUser: usersContent.createUser,
      resetUser: usersContent.resetUser,
      resetPassword: usersContent.resetPassword,
      resetPasswordButton: usersContent.resetPasswordButton,
      usersMessage: usersContent.usersMessage,
      tabs: tabs,
      panels: {
        calendar: calendarContent.node,
        panel: panelContent.node,
        steam: steamContent.node,
        account: accountContent.node,
        users: usersContent.node,
      },
      buttons: [
        calendarContent.save,
        calendarContent.clear,
        panelContent.addFund,
        accountContent.changePassword,
        usersContent.createUser,
        usersContent.resetPasswordButton,
      ],
      handle: handle,
      close: close,
    };
    handle.addEventListener("pointerdown", beginSettingsDrag);
    syncSettingsSection();
    return dialog;
  }

  function settingsReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function animateSettingsSpring(node, from, to, done) {
    if (settingsAnimationCancel) settingsAnimationCancel();
    if (settingsReducedMotion()) {
      node.style.transform = "translate3d(0, " + to.y + "px, 0) scale(" + to.scale + ")";
      node.style.opacity = String(to.opacity);
      if (done) done();
      return;
    }
    var stiffness = 260;
    var damping = 17;
    var value = { y: from.y, scale: from.scale, opacity: from.opacity };
    var velocity = { y: 0, scale: 0, opacity: 0 };
    var previous = performance.now();
    var frame;
    var cancelled = false;
    function draw() {
      node.style.transform = "translate3d(0, " + value.y.toFixed(2) + "px, 0) scale(" + value.scale.toFixed(4) + ")";
      node.style.opacity = String(Math.max(0, Math.min(1, value.opacity)));
    }
    function tick(now) {
      if (cancelled) return;
      var dt = Math.min((now - previous) / 1000, 0.032);
      previous = now;
      ["y", "scale", "opacity"].forEach(function (key) {
        var displacement = value[key] - to[key];
        velocity[key] += (-stiffness * displacement - damping * velocity[key]) * dt;
        value[key] += velocity[key] * dt;
      });
      draw();
      if (Math.abs(value.y - to.y) < 0.08 && Math.abs(velocity.y) < 0.08 &&
          Math.abs(value.scale - to.scale) < 0.001 && Math.abs(velocity.scale) < 0.001) {
        node.style.transform = "translate3d(0, " + to.y + "px, 0) scale(" + to.scale + ")";
        node.style.opacity = String(to.opacity);
        settingsAnimationCancel = null;
        if (done) done();
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    settingsAnimationCancel = function () {
      cancelled = true;
      cancelAnimationFrame(frame);
      settingsAnimationCancel = null;
    };
    draw();
    frame = requestAnimationFrame(tick);
  }

  function focusSettings() {
    if (!settingsDialog) return;
    var target = settingsRefs && settingsSection === "calendar" && settingsRefs.input && !settingsRefs.input.disabled
      ? settingsRefs.input
      : settingsRefs && settingsSection === "panel" && settingsRefs.fundInput
        ? settingsRefs.fundInput
        : settingsRefs && settingsSection === "steam"
        ? (document.getElementById("ios-steam-settings-input") || settingsRefs.close)
        : settingsRefs && settingsSection === "account" && settingsRefs.currentPassword
          ? settingsRefs.currentPassword
          : settingsRefs && settingsSection === "users" && settingsRefs.newUser
            ? settingsRefs.newUser
            : settingsRefs && settingsRefs.close;
    (target || settingsDialog).focus();
  }

  function focusableSettingsElements() {
    if (!settingsDialog) return [];
    return Array.prototype.slice.call(settingsDialog.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
    ));
  }

  function handleSettingsKeydown(event) {
    if (settingsPhase !== "open" && settingsPhase !== "opening") return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestCloseSettings("escape");
      return;
    }
    if (event.key !== "Tab") return;
    var items = focusableSettingsElements();
    if (!items.length) {
      event.preventDefault();
      settingsDialog.focus();
      return;
    }
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function finishCloseSettings() {
    if (settingsPhase !== "closing") return;
    if (settingsCloseTimer) clearTimeout(settingsCloseTimer);
    settingsCloseTimer = null;
    if (settingsAnimationCancel) settingsAnimationCancel();
    if (settingsRefs && settingsRefs.buttons) settingsRefs.buttons.forEach(function (button) { button.dispose(); });
    if (settingsLayer) settingsLayer.remove();
    settingsLayer = null;
    settingsDialog = null;
    settingsRefs = null;
    settingsPhase = "closed";
    var opener = settingsOpener;
    settingsOpener = null;
    settingsDrag = null;
    if (opener && document.body.contains(opener)) opener.focus();
  }

  function requestCloseSettings(reason) {
    if (settingsPhase === "closed" || settingsPhase === "closing") return;
    settingsOpen = false;
    settingsPhase = "closing";
    syncSettingsToggle();
    if (settingsAnimationCancel) settingsAnimationCancel();
    if (!settingsLayer || !settingsDialog) {
      finishCloseSettings();
      return;
    }
    var startOffset = settingsDrag ? settingsDrag.offset : 0;
    settingsDialog.style.setProperty("--ios-settings-exit-y", String(startOffset) + "px");
    settingsDrag = null;
    settingsLayer.setAttribute("data-phase", "closing");
    settingsDialog.addEventListener("animationend", finishCloseSettings, { once: true });
    settingsCloseTimer = setTimeout(finishCloseSettings, settingsReducedMotion() ? 20 : 240);
  }

  function openSettings(opener) {
    if (settingsPhase === "opening" || settingsPhase === "open") return;
    if (settingsCloseTimer) clearTimeout(settingsCloseTimer);
    settingsCloseTimer = null;
    settingsOpener = opener;
    settingsOpen = true;
    settingsPhase = "opening";
    mountSettingsLayer();
    if (!settingsLayer || !settingsDialog) {
      settingsPhase = "closed";
      settingsOpen = false;
      syncSettingsToggle();
      return;
    }
    syncSettingsToggle();
    syncSettingsSection();
    settingsLayer.setAttribute("data-phase", "opening");
    animateSettingsSpring(settingsDialog, { y: 40, scale: 0.6, opacity: 0 }, { y: 0, scale: 1, opacity: 1 }, function () {
      if (settingsPhase === "opening") settingsPhase = "open";
    });
    window.setTimeout(focusSettings, 0);
    if (!calendar.loaded) loadCalendar();
    if (!account.loaded) loadAccount();
    document.dispatchEvent(new CustomEvent("homepage-settings-open", { detail: { section: settingsSection } }));
  }

  function beginSettingsDrag(event) {
    if (settingsPhase !== "open" || event.button !== undefined && event.button !== 0) return;
    settingsDrag = { pointerId: event.pointerId, startY: event.clientY, offset: 0 };
    settingsRefs.handle.setPointerCapture(event.pointerId);
    if (settingsAnimationCancel) settingsAnimationCancel();
    function move(moveEvent) {
      if (!settingsDrag || moveEvent.pointerId !== settingsDrag.pointerId) return;
      settingsDrag.offset = Math.max(0, moveEvent.clientY - settingsDrag.startY);
      settingsDialog.style.transform = "translate3d(0, " + settingsDrag.offset + "px, 0) scale(1)";
      settingsDialog.style.opacity = String(Math.max(0.65, 1 - settingsDrag.offset / 360));
    }
    function end(endEvent) {
      if (!settingsDrag || endEvent.pointerId !== settingsDrag.pointerId) return;
      settingsRefs.handle.releasePointerCapture(endEvent.pointerId);
      var offset = settingsDrag.offset;
      settingsRefs.handle.removeEventListener("pointermove", move);
      settingsRefs.handle.removeEventListener("pointerup", end);
      settingsRefs.handle.removeEventListener("pointercancel", end);
      if (offset > 100) {
        requestCloseSettings("drag");
      } else {
        settingsDrag = null;
        animateSettingsSpring(settingsDialog, { y: offset, scale: 1, opacity: 1 }, { y: 0, scale: 1, opacity: 1 });
      }
    }
    settingsRefs.handle.addEventListener("pointermove", move);
    settingsRefs.handle.addEventListener("pointerup", end);
    settingsRefs.handle.addEventListener("pointercancel", end);
  }

  function syncSettingsToggle() {
    if (!settingsMounted) return;
    var toggle = settingsMounted.querySelector(".ios-settings-toggle");
    if (!toggle) return;
    var open = settingsOpen && settingsPhase !== "closed";
    toggle.setAttribute("aria-label", open ? "收起设置" : "打开设置");
    toggle.title = open ? "收起设置" : "打开设置";
    toggle.setAttribute("aria-expanded", String(open));
  }

  function mountSettingsLayer() {
    if (settingsLayer && document.body.contains(settingsLayer)) return;
    var point = settingsPoint();
    if (!point) return;
    settingsLayer = el("div", "ios-settings-layer");
    settingsLayer.setAttribute("data-phase", "opening");
    var backdrop = el("button", "ios-settings-backdrop");
    backdrop.type = "button";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", "关闭日历设置");
    backdrop.addEventListener("click", function () { requestCloseSettings("backdrop"); });
    settingsDialog = buildCalendarDialog();
    settingsLayer.appendChild(backdrop);
    settingsLayer.appendChild(settingsDialog);
    document.body.appendChild(settingsLayer);
  }

  function renderSettings() {
    syncSettingsToggle();
    if (settingsPhase !== "closed") {
      syncSettingsSection();
    }
  }

  function fmtNav(value) {
    return typeof value === "number" ? value.toFixed(4) : "--";
  }

  function fmtPct(value) {
    if (typeof value !== "number") return "--";
    return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  }

  // 涨绿跌红：跟随基金市场习惯
  function trendClass(value) {
    if (typeof value !== "number" || value === 0) return "flat";
    return value > 0 ? "up" : "down";
  }

  function kindLabel(kind) {
    if (kind === "estimate") return "估算";
    if (kind === "official") return "正式";
    return "待获取";
  }

  function shortTime(iso) {
    if (!iso) return "--";
    var m = /T(\d{2}:\d{2})/.exec(iso);
    return m ? m[1] : iso;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function buildRow(fund) {
    var row = el("div", "ios-fund-row");

    var main = el("div", "ios-fund-main");
    var nameLine = el("div", "ios-fund-nameline");
    var fullName = fund.name || "未知名称";
    var name = el("span", "ios-fund-name", fullName);
    // 视觉上过长名称使用 CSS 省略号，悬停时仍可查看完整基金名称。
    name.title = fullName;
    nameLine.appendChild(name);
    main.appendChild(nameLine);

    var meta = el("div", "ios-fund-meta");
    meta.appendChild(el("span", "ios-fund-kind ios-fund-kind-" + (fund.kind || "pending"),
      kindLabel(fund.kind)));
    meta.appendChild(el("span", "ios-fund-date", fund.nav_date || "--"));
    main.appendChild(meta);
    row.appendChild(main);
    row.appendChild(el("span", "ios-fund-code", fund.code));

    var trend = trendClass(fund.change_pct);
    var nums = el("div", "ios-fund-nums " + trend);
    nums.appendChild(el("div", "ios-fund-nav", fmtNav(fund.nav)));
    nums.appendChild(el("div", "ios-fund-pct", fmtPct(fund.change_pct)));
    // 当前显示的是估算净值时，正式净值另起一行留个对照，不然用户分不清哪个是官方数字
    if (fund.kind === "estimate" && typeof fund.official_nav === "number") {
      var officialText = "正式 " + fmtNav(fund.official_nav);
      if (fund.official_date) officialText += " " + fund.official_date.slice(5);
      nums.appendChild(el("div", "ios-fund-official", officialText));
    }
    row.appendChild(nums);
    return row;
  }

  function render() {
    if (!mounted) return;
    mounted.textContent = "";

    var head = el("div", "ios-fund-head");
    head.appendChild(el("span", "ios-fund-title", "基金净值"));

    var right = el("span", "ios-fund-head-right");
    var status = el("span", "ios-fund-status");
    if (!state.loaded) {
      status.textContent = "加载中…";
    } else {
      status.textContent = "更新 " + shortTime(state.lastRefresh);
    }
    right.appendChild(status);
    var detailLink = el("a", "ios-fund-detail", "详细查看 ›");
    detailLink.href = "https://fund.cc.cd/";
    detailLink.target = "_blank";
    detailLink.rel = "noopener noreferrer";
    right.appendChild(detailLink);
    head.appendChild(right);
    mounted.appendChild(head);

    var body = el("div", "ios-fund-body");
    body.id = "ios-fund-body";

    // 错误提示：保留下方缓存数据继续显示，不遮挡内容
    var problem = state.netError || state.lastError;
    if (problem) {
      var warn = el("div", "ios-fund-warn", problem);
      warn.setAttribute("role", "status");
      body.appendChild(warn);
    }

    var list = el("div", "ios-fund-list");
    if (state.loaded && !state.funds.length) {
      list.appendChild(el("div", "ios-fund-empty", "还没有监控的基金，可在设置的面板中添加"));
    } else {
      state.funds.forEach(function (fund) {
        list.appendChild(buildRow(fund));
      });
    }
    body.appendChild(list);
    mounted.appendChild(body);
  }

  function load() {
    return api("/api/funds")
      .then(function (data) {
        state.funds = Array.isArray(data.funds) ? data.funds : [];
        state.lastRefresh = data.last_refresh;
        state.lastError = data.last_error;
        state.netError = null;
        state.loaded = true;
        render();
        renderSettings();
      })
      .catch(function (err) {
        // 拉不到就沿用上一次的数据，只加一行错误说明
        state.netError = "读取监控服务失败：" + err.message;
        state.loaded = true;
        render();
        renderSettings();
      });
  }

  // Homepage 的 services API 会过滤空服务组，因此乙没有原生服务时由这里补一个
  // 同结构的宿主。宿主只包含标题和基金卡片，不创建可点击的占位服务。
  function insertionPoint() {
    if (!fundPanelEnabled) return null;
    var groups = document.getElementById("layout-groups");
    if (!groups) return null;

    var serviceGroups = groups.querySelectorAll(".services-group");
    for (var i = 0; i < serviceGroups.length; i++) {
      if (serviceGroups[i].id === GROUP_ID) continue;
      var title = serviceGroups[i].querySelector(".service-group-name");
      if (title && title.textContent.trim() === "乙") {
        document.querySelectorAll("#" + GROUP_ID).forEach(function (node) {
          node.remove();
        });
        hideEmptyFundShell(serviceGroups[i]);
        return { parent: fundItem(serviceGroups[i]), before: null };
      }
    }

    var host = document.getElementById(GROUP_ID);
    document.querySelectorAll("#" + GROUP_ID).forEach(function (node, index) {
      if (index > 0) node.remove();
    });
    if (host && host.parentElement !== groups) host.remove();
    host = groups.querySelector("#" + GROUP_ID);
    if (!host) {
      host = el("div", "services-group ios-fund-group flex-1 basis-full md:basis-1/2 lg:basis-1/3 xl:basis-1/4 p-1 pb-0 self-start");
      host.id = GROUP_ID;
    }
    var heading = host.querySelector(".service-group-name");
    if (!heading) {
      heading = el("h2", "flex text-theme-800 dark:text-theme-300 text-xl font-medium service-group-name", "乙");
    }
    var header = heading.closest(".group") || heading.parentElement;
    if (!header || header === host) {
      header = el("div", "flex w-full select-none items-center group");
      header.appendChild(heading);
    }
    if (header.parentElement !== host) {
      host.insertBefore(header, host.firstChild);
    }

    var before = null;
    for (var j = 0; j < serviceGroups.length; j++) {
      var nextTitle = serviceGroups[j].querySelector(".service-group-name");
      if (nextTitle && (nextTitle.textContent.trim() === "游戏" || nextTitle.textContent.trim() === "丙")) {
        before = serviceGroups[j];
        break;
      }
    }
    if (host.parentElement !== groups || host.nextElementSibling !== before) {
      groups.insertBefore(host, before);
    }
    host.classList.add("self-start");
    hideEmptyFundShell(host);
    host.hidden = !fundPanelEnabled;
    applyRoleLayout();
    return { parent: fundItem(host), before: null };
  }

  function settingsPoint() {
    var toolbar = document.getElementById("style")
      || document.getElementById("information-widgets-right")
      || document.getElementById("inner_wrapper");
    if (!toolbar) return null;
    return { parent: toolbar, host: document.body };
  }

  function styleSettings() {
    if (!settingsMounted) return;
    settingsMounted.style.cssText = "order:10;display:flex;align-items:center;justify-content:center;flex:0 0 2rem;width:2rem;height:2rem;margin:0;padding:0;border:0;background:transparent;";
    var button = settingsMounted.querySelector(".ios-settings-toggle");
    if (button) {
      button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;padding:0;border:0;border-radius:999px;color:var(--ios-label);background:transparent;font:inherit;font-size:1.25rem;line-height:1;cursor:pointer;";
    }
  }

  function mountSettings() {
    var point = settingsPoint();
    if (!point) return false;
    document.querySelectorAll(".ios-settings").forEach(function (node) {
      if (node !== settingsMounted && node.parentElement !== point.parent) node.remove();
    });
    if (settingsMounted && document.body.contains(settingsMounted)) {
      if (settingsMounted.parentElement !== point.parent) point.parent.appendChild(settingsMounted);
      styleSettings();
      if (settingsLayer && settingsLayer.parentElement !== document.body) {
        document.body.appendChild(settingsLayer);
      }
      return true;
    }
    settingsMounted = el("div", "ios-settings");
    point.parent.appendChild(settingsMounted);
    var head = el("div", "ios-settings-head");
    var toggle = el("button", "ios-settings-toggle", "⚙");
    toggle.type = "button";
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.setAttribute("aria-controls", "ios-calendar-settings-dialog");
    toggle.addEventListener("click", function (event) {
      if (settingsOpen) requestCloseSettings("toggle");
      else openSettings(event.currentTarget);
    });
    head.appendChild(toggle);
    settingsMounted.appendChild(head);
    styleSettings();
    syncSettingsToggle();
    if (settingsLayer && settingsLayer.parentElement !== document.body) document.body.appendChild(settingsLayer);
    return true;
  }

  function mount() {
    applyRoleLayout();
    if (!fundPanelEnabled) {
      unmountFund();
      return false;
    }
    var point = insertionPoint();
    if (!point) return false;

    if (mounted && document.body.contains(mounted)) {
      if (mounted.parentElement !== point.parent || mounted.nextElementSibling !== point.before) {
        point.parent.insertBefore(mounted, point.before);
      }
      applyRoleLayout();
      return true;
    }

    var node = el("div", "service-card ios-fund mb-2 rounded-md shadow-md");
    node.id = CARD_ID;
    point.parent.insertBefore(node, point.before);
    mounted = node;
    render();
    load();
    applyRoleLayout();
    return true;
  }


  window.__homepageOpenSettings = function (section) {
    if (section) settingsSection = section;
    if (settingsPhase === "open" || settingsPhase === "opening") {
      selectSettingsSection(section || settingsSection, false);
      return;
    }
    var toggle = settingsMounted && settingsMounted.querySelector(".ios-settings-toggle");
    openSettings(toggle);
  };

  var inited = false;

  function init() {
    // 只初始化一次：重复执行会叠加 observer/timer/监听器，导致请求翻倍、旧 timer 泄漏
    if (inited) return;
    inited = true;

    mountSettings();
    loadAccount();
    load();
    mount();

    // React 水合/重渲染可能把卡片冲掉，持续守护并按需重新插入
    var obs = new MutationObserver(function () {
      mountSettings();
      if (fundPanelEnabled) mount();
      else applyRoleLayout();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      // 页面在后台时不必轮询，省流量；切回来会立即刷新
      if (document.hidden) return;
      if (mounted && document.body.contains(mounted)) load();
    }, POLL_MS);

    document.addEventListener("keydown", handleSettingsKeydown);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && mounted && document.body.contains(mounted)) load();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


/**
 * Homepage custom.js — Steam 游戏卡片
 *
 * 数据来自 steam-monitor。未绑定不报错，只引导去设置填写主页链接。
 * 最近游戏支持列表 / 封面两种样式，可在卡片上切换。
 */
(function () {
  "use strict";

  var CARD_ID = "ios-steam";
  var GROUP_ID = "ios-steam-group";
  var GROUP_NAME = "游戏";
  var PLACE_AFTER = "乙";
  var PLACE_BEFORE = "丙";
  var STYLE_KEY = "homepage-steam-style";
  var FILTER_KEY = "homepage-steam-min-minutes";
  var POLL_MS = 60000;
  var BASE_PORT = "8091";
  var resolvedBase = null;
  var probing = null;
  var state = {
    loaded: false,
    bound: false,
    hasApiKey: true,
    input: "",
    profile: null,
    games: [],
    lastRefresh: null,
    lastError: null,
    netError: null
  };
  var settings = { draft: "", message: "", busy: false, refs: null };
  var styleMode = readStyle();
  var minMinutes = readMinMinutes();
  var timer = null;
  var mounted = null;
  var inited = false;

  function candidates() {
    var list = [];
    if (window.STEAM_MONITOR_BASE) list.push(window.STEAM_MONITOR_BASE);
    list.push("/steam-monitor");
    list.push(location.protocol + "//" + location.hostname + ":" + BASE_PORT);
    return list;
  }

  function probe(base) {
    return fetch(base + "/healthz", { cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error("非 Steam 监控服务");
        return base;
      });
  }

  function resolveBase() {
    if (resolvedBase) return Promise.resolve(resolvedBase);
    if (probing) return probing;
    var list = candidates();
    probing = list.reduce(function (chain, base) {
      return chain.catch(function () { return probe(base); });
    }, Promise.reject()).then(function (base) {
      resolvedBase = base;
      probing = null;
      return base;
    }).catch(function () {
      probing = null;
      throw new Error("找不到 Steam 监控服务");
    });
    return probing;
  }

  function api(path, options) {
    return resolveBase().then(function (base) {
      return fetch(base + path, Object.assign({ cache: "no-store" }, options || {})).then(function (resp) {
        return resp.json().then(function (body) {
          if (!resp.ok) throw new Error((body && body.error) || ("HTTP " + resp.status));
          return body;
        }, function () {
          if (!resp.ok) resolvedBase = null;
          throw new Error("HTTP " + resp.status);
        });
      });
    });
  }

  function readStyle() {
    try {
      return window.localStorage.getItem(STYLE_KEY) === "tiles" ? "tiles" : "list";
    } catch (error) {
      return "list";
    }
  }

  function persistStyle(value) {
    styleMode = value === "tiles" ? "tiles" : "list";
    try { window.localStorage.setItem(STYLE_KEY, styleMode); } catch (error) {}
  }

  function clampMinutes(value) {
    var minutes = Math.round(Number(value));
    if (!isFinite(minutes) || minutes < 0) return 0;
    if (minutes > 10080) return 10080;
    return minutes;
  }

  function readMinMinutes() {
    try {
      var raw = window.localStorage.getItem(FILTER_KEY);
      if (raw == null) {
        var legacy = window.localStorage.getItem("homepage-steam-min-hours");
        if (legacy != null) return clampMinutes(parseFloat(legacy) * 60);
      }
      return clampMinutes(raw);
    } catch (error) {
      return 0;
    }
  }

  function persistMinMinutes(value) {
    minMinutes = clampMinutes(value);
    try { window.localStorage.setItem(FILTER_KEY, String(minMinutes)); } catch (error) {}
  }

  function visibleGames() {
    var games = Array.isArray(state.games) ? state.games : [];
    if (!minMinutes) return games.slice();
    return games.filter(function (game) {
      return (Number(game && game.playtime_2weeks) || 0) >= minMinutes;
    });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function groupByName(name) {
    var groups = document.getElementById("layout-groups");
    if (!groups) return null;
    var nodes = groups.querySelectorAll(".services-group");
    for (var i = 0; i < nodes.length; i++) {
      var title = nodes[i].querySelector(".service-group-name");
      if (title && title.textContent.trim() === name) return nodes[i];
    }
    return null;
  }

  function shortTime(iso) {
    if (!iso) return "--";
    var match = /T(\d{2}:\d{2})/.exec(iso);
    return match ? match[1] : iso;
  }

  function formatHours(minutes) {
    var value = Number(minutes) || 0;
    if (value < 60) return value + " 分钟";
    var hours = value / 60;
    if (hours >= 100) return Math.round(hours) + " 小时";
    var rounded = Math.round(hours * 10) / 10;
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1)) + " 小时";
  }

  function formatRecentHours(game) {
    var value = Number(game && game.playtime_2weeks) || 0;
    if (value > 0) return formatHours(value);
    return "有运行";
  }

  function openSteamSettings() {
    if (typeof window.__homepageOpenSettings === "function") {
      window.__homepageOpenSettings("steam");
    }
  }

  function applyImageFallback(img, urls) {
    var index = 0;
    img.addEventListener("error", function () {
      index += 1;
      if (index < urls.length && urls[index]) img.src = urls[index];
      else img.style.visibility = "hidden";
    });
  }

  function proxiedImage(url) {
    if (!url) return "";
    var base = resolvedBase || "/steam-monitor";
    return base + "/img?url=" + encodeURIComponent(url);
  }

  function steamImage(img, urls) {
    var list = [];
    (urls || []).forEach(function (url) {
      if (url) list.push(proxiedImage(url));
    });
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    if (!list.length) return;
    img.src = list[0];
    applyImageFallback(img, list);
  }

  function profileLink(profile) {
    return profile.profile_url || (profile.steamid ? ("https://steamcommunity.com/profiles/" + profile.steamid) : "");
  }

  function steamItem(group) {
    var lists = group.querySelectorAll(".services-list");
    var list = null;
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].querySelector("#" + CARD_ID + "-item") || !lists[i].querySelector("li.service")) {
        list = lists[i];
        break;
      }
    }
    if (!list) {
      list = el("ul", "flex flex-col mt-3 services-list");
      group.appendChild(list);
    }
    list.classList.add("flex", "flex-col", "mt-3", "services-list");
    var item = document.getElementById(CARD_ID + "-item");
    if (!item) {
      item = el("li", "service");
      item.id = CARD_ID + "-item";
      item.setAttribute("data-name", "Steam");
    }
    if (item.parentElement !== list) list.appendChild(item);
    return item;
  }

  function insertionPoint() {
    var groups = document.getElementById("layout-groups");
    if (!groups) return null;
    var serviceGroups = groups.querySelectorAll(".services-group");
    for (var i = 0; i < serviceGroups.length; i++) {
      if (serviceGroups[i].id === GROUP_ID) continue;
      var title = serviceGroups[i].querySelector(".service-group-name");
      if (title && title.textContent.trim() === GROUP_NAME) {
        document.querySelectorAll("#" + GROUP_ID).forEach(function (node) { node.remove(); });
        return { parent: steamItem(serviceGroups[i]), before: null };
      }
    }

    var host = document.getElementById(GROUP_ID);
    document.querySelectorAll("#" + GROUP_ID).forEach(function (node, index) {
      if (index > 0) node.remove();
    });
    if (host && host.parentElement !== groups) host.remove();
    host = groups.querySelector("#" + GROUP_ID);
    if (!host) {
      host = el("div", "services-group ios-steam-group flex-1 basis-full md:basis-1/2 lg:basis-1/3 xl:basis-1/4 p-1 pb-0 self-start");
      host.id = GROUP_ID;
    }
    var heading = host.querySelector(".service-group-name");
    if (!heading) {
      heading = el("h2", "flex text-theme-800 dark:text-theme-300 text-xl font-medium service-group-name", GROUP_NAME);
    }
    var header = heading.closest(".group") || heading.parentElement;
    if (!header || header === host) {
      header = el("div", "flex w-full select-none items-center group");
      header.appendChild(heading);
    }
    if (header.parentElement !== host) host.insertBefore(header, host.firstChild);

    var before = groupByName(PLACE_BEFORE);
    var after = groupByName(PLACE_AFTER);
    var desiredBefore = null;
    if (after && after.parentElement === groups) desiredBefore = after.nextElementSibling === host ? host.nextElementSibling : after.nextElementSibling;
    else if (before && before.parentElement === groups) desiredBefore = before;
    if (host.parentElement !== groups || (desiredBefore && host.nextElementSibling !== desiredBefore)) {
      groups.insertBefore(host, desiredBefore);
    }
    return { parent: steamItem(host), before: null };
  }

  function timePair(game) {
    var recent = el("span", "ios-steam-time-recent");
    recent.appendChild(document.createTextNode("近两周 "));
    recent.appendChild(el("strong", "", formatRecentHours(game)));
    var total = el("span", "ios-steam-time-total");
    total.appendChild(document.createTextNode("总计 "));
    total.appendChild(el("strong", "", formatHours(game.playtime_forever)));
    return { recent: recent, total: total };
  }

  function buildList(games) {
    var list = el("div", "ios-steam-list");
    games.forEach(function (game) {
      var row = el("div", "ios-steam-row");
      var icon = el("img", "ios-steam-row-icon");
      icon.alt = "";
      icon.loading = "lazy";
      steamImage(icon, [game.icon, game.capsule, game.header]);
      row.appendChild(icon);
      var body = el("div", "ios-steam-row-body");
      var name = el("span", "ios-steam-row-name", game.name || "未知游戏");
      name.title = game.name || "";
      body.appendChild(name);
      var meta = el("div", "ios-steam-row-meta");
      var pair = timePair(game);
      meta.appendChild(pair.recent);
      meta.appendChild(pair.total);
      body.appendChild(meta);
      row.appendChild(body);
      list.appendChild(row);
    });
    return list;
  }

  function buildTiles(games) {
    var grid = el("div", "ios-steam-tiles");
    games.forEach(function (game) {
      var tile = el("div", "ios-steam-tile");
      var img = el("img");
      img.alt = game.name || "";
      img.loading = "lazy";
      steamImage(img, [game.header, game.capsule, game.icon]);
      tile.appendChild(img);
      var meta = el("div", "ios-steam-tile-meta");
      meta.appendChild(el("span", "ios-steam-tile-name", game.name || "未知游戏"));
      var time = el("span", "ios-steam-tile-time");
      time.appendChild(el("em", "", formatRecentHours(game)));
      time.appendChild(document.createTextNode(" · 总计 " + formatHours(game.playtime_forever)));
      meta.appendChild(time);
      tile.appendChild(meta);
      grid.appendChild(tile);
    });
    return grid;
  }

  function renderEmpty(title, text, actionLabel) {
    var box = el("div", "ios-steam-empty");
    box.appendChild(el("div", "ios-steam-empty-title", title));
    box.appendChild(el("p", "ios-steam-empty-text", text));
    if (actionLabel) {
      var button = el("button", "ios-steam-bind", actionLabel);
      button.type = "button";
      button.addEventListener("click", openSteamSettings);
      box.appendChild(button);
    }
    return box;
  }

  function render() {
    if (!mounted) return;
    mounted.textContent = "";

    var head = el("div", "ios-steam-head");
    var user = el("div", "ios-steam-user");
    var profile = state.profile || {};
    var href = profileLink(profile);
    if (profile.avatar) {
      var avatar = el("img", "ios-steam-avatar");
      avatar.alt = profile.name || "Steam 头像";
      steamImage(avatar, [profile.avatar, profile.avatar_medium, profile.avatar_small]);
      if (href) {
        var avatarLink = el("a", "ios-steam-avatar-link");
        avatarLink.href = href;
        avatarLink.target = "_blank";
        avatarLink.rel = "noopener noreferrer";
        avatarLink.title = "打开 Steam 主页";
        avatarLink.appendChild(avatar);
        user.appendChild(avatarLink);
      } else {
        user.appendChild(avatar);
      }
    } else if (href) {
      var fallbackLink = el("a", "ios-steam-avatar-link");
      fallbackLink.href = href;
      fallbackLink.target = "_blank";
      fallbackLink.rel = "noopener noreferrer";
      fallbackLink.title = "打开 Steam 主页";
      fallbackLink.appendChild(el("div", "ios-steam-avatar ios-steam-avatar-fallback", "ST"));
      user.appendChild(fallbackLink);
    } else {
      user.appendChild(el("div", "ios-steam-avatar ios-steam-avatar-fallback", "ST"));
    }
    var identity = el("div", "ios-steam-identity");
    var displayName = profile.name || (state.bound ? "Steam" : "尚未绑定");
    if (href && state.bound) {
      var nameLink = el("a", "ios-steam-name");
      nameLink.href = href;
      nameLink.target = "_blank";
      nameLink.rel = "noopener noreferrer";
      nameLink.title = "打开 Steam 主页";
      nameLink.textContent = displayName;
      identity.appendChild(nameLink);
    } else {
      identity.appendChild(el("span", "ios-steam-name", displayName));
    }
    var status = el("span", "ios-steam-status");
    if (!state.loaded) status.textContent = "加载中…";
    else if (!state.bound) status.textContent = "绑定后显示最近游戏";
    else if (profile.playing && profile.playing.name) {
      status.textContent = "正在玩 " + profile.playing.name;
      status.classList.add("is-playing");
    } else if (profile.online) status.textContent = "在线";
    else status.textContent = "最近在玩";
    identity.appendChild(status);
    user.appendChild(identity);
    head.appendChild(user);

    var tools = el("div", "ios-steam-tools");
    tools.appendChild(el("span", "ios-steam-updated", state.loaded ? ("更新 " + shortTime(state.lastRefresh)) : ""));
    head.appendChild(tools);
    mounted.appendChild(head);

    var body = el("div", "ios-steam-body");
    if (state.netError) body.appendChild(el("div", "ios-steam-warn", state.netError));
    else if (state.lastError) body.appendChild(el("div", "ios-steam-warn", state.lastError));

    var games = visibleGames();
    if (!state.loaded) {
      body.appendChild(el("div", "ios-steam-empty-text", "正在读取 Steam…"));
    } else if (!state.hasApiKey && !state.bound) {
      body.appendChild(renderEmpty("还不能连接 Steam", "管理员需要先在服务器配置 Steam Web API Key，然后你再绑定主页链接。", "去设置看看"));
    } else if (!state.bound) {
      body.appendChild(renderEmpty("还没有绑定 Steam", "打开设置，粘贴你的 Steam 个人主页链接。资料和游戏详情需要公开。", "去绑定"));
    } else if (!state.games.length) {
      body.appendChild(renderEmpty("近两周没有游戏记录", "玩过之后这里会显示游戏图标、近两周时长和总时长。", null));
    } else if (!games.length) {
      body.appendChild(renderEmpty("没有符合条件的游戏", "近两周时长少于 " + minMinutes + " 分钟的已隐藏，可在设置里调低门槛。", "去设置"));
    } else if (styleMode === "tiles") {
      body.appendChild(buildTiles(games));
    } else {
      body.appendChild(buildList(games));
    }
    mounted.appendChild(body);
    syncSteamSettings();
  }

  function applySnapshot(data) {
    state.bound = data.bound === true;
    state.hasApiKey = data.has_api_key !== false;
    state.input = typeof data.input === "string" ? data.input : "";
    state.profile = data.profile || null;
    state.games = Array.isArray(data.games) ? data.games : [];
    state.lastRefresh = data.last_refresh || null;
    state.lastError = data.last_error || null;
    state.netError = null;
    state.loaded = true;
    if (!settings.draft || settings.draft === state.input) settings.draft = state.input;
  }

  function load() {
    return api("/api/steam").then(function (data) {
      applySnapshot(data);
      render();
    }).catch(function () {
      state.loaded = true;
      state.netError = "暂时读不到 Steam 服务，稍后再试。";
      render();
    });
  }

  function bindSteam(url) {
    settings.busy = true;
    settings.message = "保存中…";
    syncSteamSettings();
    return api("/api/steam", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    }).then(function (data) {
      applySnapshot(data);
      settings.busy = false;
      settings.message = "已绑定 " + ((state.profile && state.profile.name) || "Steam");
      settings.draft = state.input;
      render();
    }).catch(function (err) {
      settings.busy = false;
      settings.message = err.message || "绑定失败";
      syncSteamSettings();
      throw err;
    });
  }

  function unbindSteam() {
    settings.busy = true;
    settings.message = "清除中…";
    syncSteamSettings();
    return api("/api/steam", { method: "DELETE" }).then(function (data) {
      applySnapshot(data);
      settings.busy = false;
      settings.message = "已解除绑定";
      settings.draft = "";
      render();
    }).catch(function (err) {
      settings.busy = false;
      settings.message = err.message || "清除失败";
      syncSteamSettings();
      throw err;
    });
  }

  function ensureSteamSettings() {
    var panel = document.getElementById("ios-settings-steam-panel");
    if (!panel) return;
    if (settings.refs && panel.contains(settings.refs.form)) {
      syncSteamSettings();
      return;
    }
    panel.textContent = "";
    panel.appendChild(el("p", "ios-settings-panel-description", "粘贴 Steam 个人主页链接，例如 https://steamcommunity.com/id/你的名字 。资料和游戏详情需设为公开。"));
    var form = el("form", "ios-fund-calendar-form");
    var input = el("input", "ios-fund-calendar-input");
    input.id = "ios-steam-settings-input";
    input.type = "text";
    input.placeholder = "https://steamcommunity.com/id/…";
    input.setAttribute("aria-label", "Steam 主页链接");
    input.addEventListener("input", function () { settings.draft = input.value; });
    var actions = el("div", "ios-settings-actions");
    var save = el("button", "ios-stateful-button ios-fund-calendar-save", "保存");
    save.type = "submit";
    var clear = el("button", "ios-stateful-button ios-fund-calendar-clear", "清除");
    clear.type = "button";
    clear.addEventListener("click", function () {
      if (settings.busy || !state.bound) return;
      unbindSteam();
    });
    actions.appendChild(save);
    actions.appendChild(clear);
    form.appendChild(input);
    form.appendChild(actions);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = (input.value || "").trim();
      if (!value) {
        settings.message = "请填写 Steam 主页链接";
        syncSteamSettings();
        return;
      }
      bindSteam(value);
    });
    panel.appendChild(form);
    var message = el("div", "ios-fund-calendar-message");
    message.setAttribute("role", "status");
    panel.appendChild(message);

    var styleBlock = el("div", "ios-settings-steam-block");
    styleBlock.appendChild(el("div", "ios-settings-section-title", "显示样式"));
    var styles = el("div", "ios-settings-steam-styles");
    var styleButtons = {};
    ["list", "tiles"].forEach(function (mode) {
      var button = el("button", "ios-settings-steam-style", mode === "list" ? "列表" : "封面");
      button.type = "button";
      button.addEventListener("click", function () {
        persistStyle(mode);
        render();
        syncSteamSettings();
      });
      styleButtons[mode] = button;
      styles.appendChild(button);
    });
    styleBlock.appendChild(styles);
    panel.appendChild(styleBlock);

    var filterBlock = el("div", "ios-settings-steam-block");
    filterBlock.appendChild(el("div", "ios-settings-section-title", "时长过滤"));
    var filterRow = el("label", "ios-settings-steam-filter");
    filterRow.appendChild(document.createTextNode("近两周少于"));
    var filter = el("input", "ios-settings-steam-filter-input");
    filter.type = "number";
    filter.min = "0";
    filter.max = "10080";
    filter.step = "1";
    filter.inputMode = "numeric";
    filter.setAttribute("aria-label", "近两周少于多少分钟的游戏不显示");
    function applyFilterInput() {
      persistMinMinutes((filter.value || "").trim() === "" ? 0 : filter.value);
      render();
      syncSteamSettings();
    }
    filter.addEventListener("change", applyFilterInput);
    filter.addEventListener("blur", applyFilterInput);
    filter.addEventListener("input", function () {
      var raw = (filter.value || "").trim();
      if (raw === "") {
        persistMinMinutes(0);
        render();
        return;
      }
      if (!/^\d+$/.test(raw)) return;
      persistMinMinutes(raw);
      render();
    });
    filterRow.appendChild(filter);
    filterRow.appendChild(document.createTextNode("分钟的不显示"));
    filterBlock.appendChild(filterRow);
    filterBlock.appendChild(el("p", "ios-settings-steam-hint", "按近两周游戏时长过滤。填 0 则显示全部。"));
    panel.appendChild(filterBlock);

    settings.refs = {
      form: form,
      input: input,
      save: save,
      clear: clear,
      message: message,
      styleButtons: styleButtons,
      filter: filter
    };
    syncSteamSettings();
  }

  function syncSteamSettings() {
    if (!settings.refs) return;
    var nextValue = settings.draft || state.input || "";
    var nextMessage = settings.message || (state.bound && state.profile ? ("当前：" + state.profile.name) : "");
    if (settings.refs.input.value !== nextValue) settings.refs.input.value = nextValue;
    settings.refs.input.disabled = settings.busy;
    settings.refs.save.disabled = settings.busy;
    settings.refs.clear.disabled = settings.busy || !state.bound;
    if (settings.refs.message.textContent !== nextMessage) settings.refs.message.textContent = nextMessage;
    if (settings.refs.styleButtons) {
      ["list", "tiles"].forEach(function (mode) {
        var button = settings.refs.styleButtons[mode];
        if (button) button.setAttribute("aria-pressed", String(styleMode === mode));
      });
    }
    if (settings.refs.filter && document.activeElement !== settings.refs.filter) {
      var shown = String(minMinutes);
      if (settings.refs.filter.value !== shown) settings.refs.filter.value = shown;
    }
  }

  function mount() {
    if (mounted && document.body.contains(mounted)) return true;
    var point = insertionPoint();
    if (!point) return false;
    var node = el("div", "service-card ios-steam mb-2 rounded-md shadow-md");
    node.id = CARD_ID;
    point.parent.insertBefore(node, point.before);
    mounted = node;
    render();
    load();
    return true;
  }

  function init() {
    if (inited) return;
    inited = true;
    mount();
    ensureSteamSettings();
    var obs = new MutationObserver(function () {
      if (!mounted || !document.body.contains(mounted)) mount();
      var panel = document.getElementById("ios-settings-steam-panel");
      if (panel && !(settings.refs && panel.contains(settings.refs.form))) ensureSteamSettings();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    timer = setInterval(function () {
      if (document.hidden) return;
      if (mounted && document.body.contains(mounted)) load();
    }, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && mounted && document.body.contains(mounted)) load();
    });
    document.addEventListener("homepage-settings-open", function () {
      ensureSteamSettings();
      if (!state.loaded) load();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ============ 主题：仅保留明暗模式并同步原生颜色 ============ */
(function () {
  "use strict";

  var STORAGE_KEY = "theme-mode";
  var CONTROLLER_KEY = "__homepageLightDarkThemeController";
  var root = document.documentElement;
  var palettePrefix = "theme-";
  var mode = "dark";
  var syncScheduled = false;
  var applying = false;

  if (!root || window[CONTROLLER_KEY]) return;
  window[CONTROLLER_KEY] = true;

  function normalizeMode(value) {
    return value === "light" ? "light" : "dark";
  }

  function readStoredMode() {
    try {
      return normalizeMode(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return "dark";
    }
  }

  function persistMode(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Private browsing or a blocked storage backend must not break the page.
    }
  }

  function modeFromRoot() {
    if (root.classList.contains("light") || root.classList.contains("scheme-light")) {
      return "light";
    }
    if (root.classList.contains("dark") || root.classList.contains("scheme-dark")) {
      return "dark";
    }
    return null;
  }

  function expectedColor(value) {
    return value === "light" ? "theme-white" : "theme-slate";
  }

  function needsSync(value) {
    var color = expectedColor(value);
    var expectedScheme = value === "light" ? "scheme-light" : "scheme-dark";
    if (!root.classList.contains(value) || !root.classList.contains(expectedScheme) ||
        !root.classList.contains(color)) return true;

    return Array.prototype.some.call(root.classList, function (name) {
      return name.indexOf(palettePrefix) === 0 && name !== color;
    }) || root.classList.contains(value === "light" ? "dark" : "light") ||
      root.classList.contains(value === "light" ? "scheme-dark" : "scheme-light");
  }

  function applyMode(value) {
    value = normalizeMode(value);
    if (!needsSync(value)) return;

    var color = expectedColor(value);
    applying = true;
    Array.prototype.slice.call(root.classList).forEach(function (name) {
      if (name === "dark" || name === "light" || name === "scheme-dark" ||
          name === "scheme-light" || name.indexOf(palettePrefix) === 0) {
        root.classList.remove(name);
      }
    });
    root.classList.add(value, value === "light" ? "scheme-light" : "scheme-dark", color);
    applying = false;
  }

  function reconcile() {
    syncScheduled = false;
    if (applying) return;

    var detected = modeFromRoot();
    if (detected) {
      mode = detected;
      persistMode(mode);
    }
    applyMode(mode);
  }

  function scheduleReconcile() {
    if (syncScheduled) return;
    syncScheduled = true;
    if (typeof window.queueMicrotask === "function") {
      window.queueMicrotask(reconcile);
    } else {
      Promise.resolve().then(reconcile);
    }
  }

  mode = readStoredMode();
  persistMode(mode);
  applyMode(mode);

  if (typeof MutationObserver === "function") {
    var observer = new MutationObserver(function () {
      scheduleReconcile();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  }

  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    mode = normalizeMode(event.newValue);
    persistMode(mode);
    applyMode(mode);
  });
})();
