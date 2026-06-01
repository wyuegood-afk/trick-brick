// 会捣乱的积木 · 前端埋点
// 设计:一次「从头开始玩」= 一个 run;每关每次尝试结束时上报一条记录。
// 任何上报失败都不影响游戏(静默)。IP 由后端从请求获取,前端不采集、不上报。
(function () {
  'use strict';

  // 后端地址:与 index.html 的配置拉取保持同样的解析规则
  var API_BASE = (window.TRICK_BRICK_API)
    || (location.protocol === 'file:' ? 'http://localhost:3000' : '');
  var ENDPOINT = API_BASE + '/api/track';

  var state = {
    runId: null,
    attempts: {},     // level_index -> 该 run 内的尝试次数
    maxLevel: 0,      // 本 run 到达过的最高关
    started: false,   // 是否已发 game_start
    ended: false,     // 是否已结束(cleared/quit),避免 pagehide 重复上报
  };

  function uuid() {
    try { return crypto.randomUUID(); }
    catch (e) { return 'r-' + Date.now() + '-' + Math.floor(Math.random() * 1e9); }
  }

  function send(payload) {
    try {
      var body = JSON.stringify(Object.assign({ run_id: state.runId }, payload));
      // 优先 sendBeacon:不阻塞、页面关闭也能发出
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      // 兜底:keepalive fetch
      fetch(ENDPOINT, {
        method: 'POST', body: body, keepalive: true,
        headers: { 'Content-Type': 'application/json' },
      }).catch(function () {});
    } catch (e) { /* 埋点失败对玩家无感 */ }
  }

  var TBTrack = {
    // 开始一次全新游玩(从第 1 关从头开始)
    gameStart: function () {
      state.runId = uuid();
      state.attempts = {};
      state.maxLevel = 0;
      state.started = true;
      state.ended = false;
      send({ type: 'game_start', ua: navigator.userAgent });
    },
    // 某关正式开始(倒计时/说明结束、真正进入 play)。重试同一关会累加 attempt_no。
    levelStart: function (levelIndex, allottedSeconds) {
      if (!state.runId) this.gameStart();
      state.attempts[levelIndex] = (state.attempts[levelIndex] || 0) + 1;
      if (levelIndex > state.maxLevel) state.maxLevel = levelIndex;
      send({
        type: 'level_start',
        level_index: levelIndex,
        attempt_no: state.attempts[levelIndex],
        allotted_time: allottedSeconds,
      });
    },
    levelWin: function (levelIndex, allottedSeconds, durationMs, timeLeftMs) {
      send({
        type: 'level_win',
        level_index: levelIndex,
        attempt_no: state.attempts[levelIndex] || 1,
        allotted_time: allottedSeconds,
        duration_ms: Math.round(durationMs),
        time_left_ms: Math.round(timeLeftMs),
        completion_pct: 100,
      });
    },
    levelLose: function (levelIndex, allottedSeconds, durationMs, completionPct) {
      send({
        type: 'level_lose',
        level_index: levelIndex,
        attempt_no: state.attempts[levelIndex] || 1,
        allotted_time: allottedSeconds,
        duration_ms: Math.round(durationMs),
        completion_pct: completionPct,
      });
    },
    // 通关全部关卡
    runCleared: function () {
      if (state.ended) return;
      state.ended = true;
      send({ type: 'run_quit', reason: 'cleared', max_level_reached: state.maxLevel });
    },
  };

  // 离开页面且未通关 → 记一次中途退出(知道玩家在哪关流失)
  function quitOnce() {
    if (!state.started || state.ended) return;
    state.ended = true;
    send({ type: 'run_quit', reason: 'quit', max_level_reached: state.maxLevel });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') quitOnce();
  });
  window.addEventListener('pagehide', quitOnce);

  window.TBTrack = TBTrack;
})();
