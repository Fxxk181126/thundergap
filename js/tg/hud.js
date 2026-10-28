// ============================================================
//  雷隙 THUNDERGAP — HUD 层（TG.hud）
//  HUD 仪表 / 罗盘 / 字幕队列与分阶段引导（FR-15）/ 覆盖卡 / 后期层
// ============================================================
window.TG = window.TG || {};

TG.hud = (function () {
  'use strict';

  var CFG = TG.config;
  var el = {};
  var showUntil = 0;
  var queue = [];   // { html, dur, cond } — 引导节拍按条件就绪后依次展示

  function cache() {
    ['hpFill', 'hpTxt', 'resFill', 'resTxt', 'fragCount', 'stormFill', 'stormTxt',
     'fragCompass',
     'dirNeedle', 'distTxt', 'fragNeedle', 'fragDistTxt', 'subtitle', 'hud', 'overlay',
     'card', 'flash', 'hurt', 'loading', 'startBtn'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  // ---------- 即时字幕（打断当前显示，随后队列继续） ----------
  function notify(html, dur) {
    el.subtitle.innerHTML = html;
    el.subtitle.classList.add('on');
    showUntil = TG.clock.getElapsedTime() + (dur || 3.4);
  }

  // ---------- 引导队列：cond() 为真且当前无字幕时展示（FR-15） ----------
  function enqueue(html, dur, cond) {
    queue.push({ html: html, dur: dur, cond: cond });
  }

  function pump() {
    if (queue.length === 0) return;
    if (TG.clock.getElapsedTime() < showUntil) return;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].cond()) {
        var item = queue.splice(i, 1)[0];
        notify(item.html, item.dur);
        return;
      }
    }
  }

  // ---------- 后期层强度 ----------
  function setFlash(v) { el.flash.style.opacity = v.toFixed(3); }
  function setHurt(v) { el.hurt.style.opacity = v.toFixed(3); }

  // ---------- HUD ----------
  function update() {
    var s = TG.state;
    el.hpFill.style.transform = 'scaleX(' + Math.max(0, s.hp / 100) + ')';
    el.hpTxt.textContent = Math.max(0, Math.round(s.hp));
    el.resFill.style.transform = 'scaleX(' + (s.resonance / 100) + ')';
    el.resTxt.textContent = Math.round(s.resonance);
    el.fragCount.textContent = s.frags + ' / ' + CFG.GOAL_FRAGMENTS;
    el.stormFill.style.transform = 'scaleX(' + s.storm + ')';
    var left = Math.max(0, CFG.STORM_DURATION * (1 - s.storm));
    var m = Math.floor(left / 60), sec = Math.floor(left % 60);
    el.stormTxt.textContent =
      '距离穹顶闭合 — ' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // 罗盘：把目标方向投影到玩家视角前/右坐标系，指针以玩家朝向为上
  function setCompass(deg, dist) {
    el.dirNeedle.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
    el.distTxt.textContent = dist.toFixed(0) + ' m';
  }

  // 碎片方位小罗盘（试玩反馈 #3：显形 5 秒之外的持续追踪）
  function setFragCompass(deg, dist, visible) {
    var show = visible !== false;
    el.fragCompass.style.display = show ? '' : 'none';
    if (!show) return;
    el.fragNeedle.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
    el.fragDistTxt.textContent = dist.toFixed(0) + ' m';
  }

  // ---------- 暂停卡（复用 overlay 容器；endCard 同理，二者不会并存） ----------
  function showPauseCard(body) {
    el.card.innerHTML =
      '<div class="eyebrow">PAUSED</div>' +
      '<div id="endTitle" class="win">暂 雨</div>' +
      '<p id="endBody">' + body + '</p>' +
      '<div class="cta" id="resumeBtn">继 续</div>';
    el.overlay.classList.remove('hide');
    el.overlay.style.display = '';
    showHud(true);
    var btn = document.getElementById('resumeBtn');
    if (btn) btn.addEventListener('click', function () { TG.main.resumeGame(true); });
  }

  function hidePauseCard() {
    el.overlay.classList.add('hide');
  }

  function showHud(on) {
    el.hud.classList.toggle('on', on);
  }

  // ---------- 结局卡（TD-4：附本局编号） ----------
  function endCard(win_) {
    var s = TG.state;
    document.exitPointerLock && document.exitPointerLock();
    var left = CFG.STORM_DURATION * (1 - s.storm);
    var used = CFG.STORM_DURATION - left;
    var mm = Math.floor(used / 60), ss = Math.floor(used % 60);
    var seedHex = '#' + (s.seed >>> 0).toString(16).toUpperCase();

    el.card.innerHTML =
      '<div class="eyebrow">' + (win_ ? 'SIGNAL SENT' : 'SIGNAL LOST') + '</div>' +
      '<div id="endTitle" class="' + (win_ ? 'win' : 'lose') + '">' +
        (win_ ? '雷 隙 之 上' : '穹 顶 闭 合') + '</div>' +
      '<p id="endBody">' + (win_
        ? '林隙爬上塔顶，把最后一段频段推了出去。<br>整座城的雷声在同一秒里停顿了一下——<br>像是有人在很远的地方，终于听见了。'
        : '雨没有停。雷暴穹顶压到街面，最后一片雷纹的光被雨水掐灭。<br>塔顶的红灯闪了两下，然后什么都不剩了。') +
      '</p>' +
      '<div id="stats">' +
        '<div class="stat"><b>' + s.frags + ' / ' + CFG.GOAL_FRAGMENTS + '</b><i>雷纹碎片</i></div>' +
        '<div class="stat"><b>' + Math.max(0, Math.round(s.hp)) + '</b><i>剩余生命</i></div>' +
        '<div class="stat"><b>' + mm + ':' + (ss < 10 ? '0' : '') + ss + '</b><i>雨中时长</i></div>' +
        '<div class="stat"><b style="font-size:16px;padding-top:6px">' + seedHex + '</b><i>本局编号</i></div>' +
      '</div>' +
      '<div class="cta" onclick="location.reload()">再 走 一 夜</div>';
    el.overlay.classList.remove('hide');
    showHud(false);
  }

  function hideOverlay() { el.overlay.classList.add('hide'); }

  return {
    cache: cache,
    notify: notify,
    enqueue: enqueue,
    pump: pump,
    setFlash: setFlash,
    setHurt: setHurt,
    update: update,
    setCompass: setCompass,
    setFragCompass: setFragCompass,
    showPauseCard: showPauseCard,
    hidePauseCard: hidePauseCard,
    showHud: showHud,
    endCard: endCard,
    hideOverlay: hideOverlay,
    el: function (id) { return el[id]; }
  };
})();
