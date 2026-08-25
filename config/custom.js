/**
 * 外网搜索联想：通过 Homepage API 获取候选词，最多显示 10 条。
 */
(function () {
  "use strict";

  var SEARCH_SELECTOR = ".information-widget-search input";
  var LIST_ID = "external-search-suggestions";
  var timer = null;
  var request = null;
  var URLS = {
    Google: "https://www.google.com/search?q=",
    Bing: "https://www.bing.com/search?q=",
    DuckDuckGo: "https://duckduckgo.com/?q=",
    Brave: "https://search.brave.com/search?q=",
  };

  function providerName() {
    var stored = localStorage.getItem("search-name");
    return URLS[stored] ? stored : "Google";
  }

  function closeList() {
    var list = document.getElementById(LIST_ID);
    if (list) list.remove();
  }

  function renderList(input, values) {
    closeList();
    if (!input.value.trim() || !values.length) return;
    var list = document.createElement("div");
    list.id = LIST_ID;
    list.className = "external-search-suggestions";
    list.setAttribute("role", "listbox");
    values.slice(0, 10).forEach(function (value) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "external-search-suggestion";
      button.textContent = value;
      button.setAttribute("role", "option");
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        window.open(URLS[providerName()] + encodeURIComponent(value), "_blank");
        closeList();
      });
      list.appendChild(button);
    });
    var wrapper = input.closest(".information-widget-search");
    if (wrapper) wrapper.appendChild(list);
  }

  function fetchSuggestions(input) {
    var query = input.value.trim();
    closeList();
    if (!query) return;
    if (request) request.abort();
    request = new AbortController();
    fetch("/api/search/searchSuggestion?query=" + encodeURIComponent(query) + "&providerName=" + providerName(), {
      signal: request.signal,
    })
      .then(function (response) { return response.json(); })
      .then(function (data) { if (data && Array.isArray(data[1])) renderList(input, data[1]); })
      .catch(function () {});
  }

  function initSuggestions() {
    var input = document.querySelector(SEARCH_SELECTOR);
    if (!input || input.dataset.suggestionsReady) return;
    input.dataset.suggestionsReady = "true";
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { fetchSuggestions(input); }, 180);
    });
    input.addEventListener("blur", function () { setTimeout(closeList, 150); });
  }

  initSuggestions();
  new MutationObserver(initSuggestions).observe(document.documentElement, { childList: true, subtree: true });
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
  var draft = ""; // 输入框内容，React 重渲染冲掉卡片后不丢
  var expanded = true; // 页面生命周期内保留展开状态，完整刷新后恢复展开
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

  function fmtNav(value) {
    return typeof value === "number" ? value.toFixed(4) : "--";
  }

  function fmtPct(value) {
    if (typeof value !== "number") return "--";
    return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  }

  // 涨绿跌红：跟随 A 股习惯，与 CSS 里的 .up/.down 对应
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
    nameLine.appendChild(el("span", "ios-fund-code", fund.code));
    main.appendChild(nameLine);

    var meta = el("div", "ios-fund-meta");
    meta.appendChild(el("span", "ios-fund-kind ios-fund-kind-" + (fund.kind || "pending"),
      kindLabel(fund.kind)));
    meta.appendChild(el("span", "ios-fund-date", fund.nav_date || "--"));
    main.appendChild(meta);
    row.appendChild(main);

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

    var del = el("button", "ios-fund-del", "×");
    del.type = "button";
    var label = "删除 " + (fund.name || fund.code);
    del.setAttribute("aria-label", label);
    del.title = label;
    del.addEventListener("click", function () {
      del.disabled = true;
      api("/api/funds/" + fund.code, { method: "DELETE" })
        .then(load)
        .catch(function (err) {
          del.disabled = false;
          state.netError = "删除失败：" + err.message;
          render();
        });
    });
    row.appendChild(del);
    return row;
  }

  function buildAddForm() {
    var form = el("form", "ios-fund-add");

    var input = el("input", "ios-fund-input");
    input.type = "text";
    input.inputMode = "numeric";
    input.maxLength = 6;
    input.placeholder = "6 位基金代码";
    input.setAttribute("aria-label", "基金代码");
    input.value = draft;
    input.addEventListener("input", function () {
      // 只留数字，避免提交明显非法的值
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      draft = input.value;
    });

    var submit = el("button", "ios-fund-submit", "添加");
    submit.type = "submit";

    form.appendChild(input);
    form.appendChild(submit);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var code = input.value.trim();
      if (!/^\d{6}$/.test(code)) {
        state.netError = "请输入 6 位基金代码";
        render();
        return;
      }
      submit.disabled = true;
      api("/api/funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code }),
      })
        .then(function () {
          draft = "";
          state.netError = null;
          return load();
        })
        .catch(function (err) {
          submit.disabled = false;
          state.netError = "添加失败：" + err.message;
          render();
        });
    });
    return form;
  }

  function render() {
    if (!mounted) return;
    mounted.textContent = "";

    var head = el("div", "ios-fund-head");
    head.appendChild(el("span", "ios-fund-title", "基金净值"));

    var toggleLabel = expanded ? "收起基金净值内容" : "展开基金净值内容";
    var toggle = el("button", "ios-fund-toggle", expanded ? "⌃" : "⌄");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", "ios-fund-body");
    toggle.setAttribute("aria-label", toggleLabel);
    toggle.title = toggleLabel;
    toggle.addEventListener("click", function () {
      expanded = !expanded;
      render();
    });
    head.appendChild(toggle);

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
    body.hidden = !expanded;

    // 错误提示：保留下方缓存数据继续显示，不遮挡内容
    var problem = state.netError || state.lastError;
    if (problem) {
      var warn = el("div", "ios-fund-warn", problem);
      warn.setAttribute("role", "status");
      body.appendChild(warn);
    }

    var list = el("div", "ios-fund-list");
    if (state.loaded && !state.funds.length) {
      list.appendChild(el("div", "ios-fund-empty", "还没有监控的基金，输入代码添加"));
    } else {
      state.funds.forEach(function (fund) {
        list.appendChild(buildRow(fund));
      });
    }
    body.appendChild(list);
    body.appendChild(buildAddForm());
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
      })
      .catch(function (err) {
        // 拉不到就沿用上一次的数据，只加一行错误说明
        state.netError = "读取监控服务失败：" + err.message;
        state.loaded = true;
        render();
      });
  }

  // 卡片放进甲分组的展开内容末尾，紧贴甲组服务列表正下方。
  // 这样它不会参与甲/乙/丙/丁的横向分栏，而是作为甲组内的单独一行显示。
  function insertionPoint() {
    var groups = document.getElementById("layout-groups");
    if (groups) {
      var serviceGroups = groups.querySelectorAll(".services-group");
      for (var i = 0; i < serviceGroups.length; i++) {
        var title = serviceGroups[i].querySelector(".service-group-name");
        if (title && title.textContent.trim() === "甲") {
          var panel = serviceGroups[i].querySelector('[id^="headlessui-disclosure-panel"]');
          if (panel) return { parent: panel, before: null };
        }
      }
    }

    // 甲分组尚未渲染时暂不挂载，避免先插到错误位置后又被 React 重排。
    // 没有 layout-groups 时保留旧的 footer 兜底，兼容 Homepage 结构变化。
    var footer = document.getElementById("footer");
    if (!groups && footer && footer.parentElement) {
      return { parent: footer.parentElement, before: footer };
    }
    return null;
  }

  function mount() {
    var point = insertionPoint();
    if (!point) return false;

    if (mounted && document.body.contains(mounted)) {
      // 已挂载：Homepage 重渲染后，确保卡片仍在甲组内容末尾。
      if (mounted.parentElement !== point.parent || mounted.nextElementSibling !== point.before) {
        point.parent.insertBefore(mounted, point.before);
      }
      return true;
    }

    var node = el("div", "ios-fund");
    node.id = CARD_ID;
    point.parent.insertBefore(node, point.before);
    mounted = node;
    render();      // 先用已有 state 画出来，避免闪空白
    load();        // 再拉最新数据
    return true;
  }

  var inited = false;

  function init() {
    // 只初始化一次：重复执行会叠加 observer/timer/监听器，导致请求翻倍、旧 timer 泄漏
    if (inited) return;
    inited = true;

    mount();

    // React 水合/重渲染可能把卡片冲掉，持续守护并按需重新插入
    var obs = new MutationObserver(function () {
      mount();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      // 页面在后台时不必轮询，省流量；切回来会立即刷新
      if (document.hidden) return;
      if (mounted && document.body.contains(mounted)) load();
    }, POLL_MS);

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

