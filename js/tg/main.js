// ============================================================
//  雷隙 THUNDERGAP — 主模块（TG.main）
//  状态机 / 初始化 / 输入 / 主循环 / 碎片与目标更新 / 引导节拍
// ============================================================
window.TG = window.TG || {};

TG.main = (function () {
  'use strict';

  var CFG = TG.config;
  var scene, camera, renderer, clock;
  var keys = {};
  var subTimer = null; // 兼容保留（队列接管后不再使用 setTimeout 字幕）

  function newState() {
    return {
      started: false, over: false, won: false, paused: false,
      hp: 100, resonance: CFG.RESONANCE.max, frags: 0, storm: 0, time: 0,
      yaw: 0, pitch: 0.22, camShake: 0, flash: 0, hurt: 0,
      vel: new THREE.Vector3(), onGround: true,
      invuln: 0, runPhase: 0, movedDist: 0,
      coyote: 0, jumpBuf: 0,          // TD-7
      pose: null,                     // D3
      tut: { moved: false, pulsed: false, warned: false, half: false },  // FR-15
      lockGrace: null,                // 开局指针锁定宽限计时器
      seed: 0
    };
  }

  // ------------------------------------------------------------
  //  初始化
  // ------------------------------------------------------------
  function init() {
    // TD-4：本局种子（控制台可查，结算卡展示）
    var seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
    TG.state = newState();
    TG.state.seed = seed;
    TG.rng = TG.util.makeRng(seed);
    console.log('[THUNDERGAP] run seed: ' + seed.toString(16).toUpperCase());

    TG.boxes = [];
    TG.fragments = [];
    TG.pulses = [];
    TG.strikes = [];
    TG.ripples = [];
    TG.skyBolts = [];
    TG.keys = keys;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(CFG.FOG.color, CFG.FOG.density);
    TG.scene = scene;

    camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 900);
    camera.position.set(0, 6, 14);
    TG.camera = camera;

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.85));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    document.body.appendChild(renderer.domElement);
    TG.renderer = renderer;

    clock = new THREE.Clock();
    TG.clock = clock;

    TG.hud.cache();
    TG.world.buildAll();
    TG.player.build();

    addEventListener('resize', onResize);
    addEventListener('keydown', function (e) {
      keys[e.code] = true;
      onKey(e);
    });
    addEventListener('keyup', function (e) { keys[e.code] = false; });
    addEventListener('mousemove', onMouseMove);

    // 指针锁定保护（试玩反馈 #1）：锁定/解锁驱动暂停
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', function () {
      // 锁定失败（iframe / 不支持）：按无锁模式继续，方向键仍可转向
      if (TG.state.started && !TG.state.over) {
        resumeGame(false);
        TG.hud.notify('鼠标视角不可用——可用 ←→ 转向。', 3.5);
      }
    });

    renderer.domElement.addEventListener('click', function () {
      var s = TG.state;
      if (s.started && !s.over) renderer.domElement.requestPointerLock();
    });
    TG.hud.el('startBtn').addEventListener('click', startGame);

    TG.hud.el('loading').style.display = 'none';
    renderer.setAnimationLoop(tick);
  }

  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }

  // ------------------------------------------------------------
  //  输入
  // ------------------------------------------------------------
  function onKey(e) {
    var s = TG.state;
    // 防止空格/方向键触发页面滚动或按钮焦点
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.code === 'KeyE' && s.started && !s.over && !s.paused) TG.fx.emitPulse();
    if (e.code === 'KeyP' && s.started && !s.over) {
      if (s.paused) resumeGame(true);
      else pauseGame('已暂停——按 <b>P</b> 或点击「继续」回到雨夜。');
    }
    if (e.code === 'KeyM') {
      var muted = TG.audio.toggleMute();
      TG.hud.notify(muted ? '音频已静音' : '音频已开启', 1.2);
    }
    if (e.code === 'KeyR' && s.started) location.reload();
  }

  // ------------------------------------------------------------
  //  暂停 / 继续（试玩反馈 #1）
  // ------------------------------------------------------------
  function onPointerLockChange() {
    var s = TG.state;
    if (!s.started || s.over) return;
    var locked = document.pointerLockElement === renderer.domElement;
    if (locked) {
      resumeGame(false);                       // 拿到锁定 → 直接开跑
    } else if (!s.paused) {
      pauseGame('视角已解锁——雨停了一拍。<br>点击「继续」重新锁定视角。');  // Esc / 丢锁 → 自动暂停
    }
  }

  function pauseGame(body) {
    var s = TG.state;
    if (!s.started || s.over || s.paused) return;
    s.paused = true;
    TG.hud.showPauseCard(body);
  }

  function resumeGame(requestLock) {
    var s = TG.state;
    s.paused = false;
    TG.hud.hidePauseCard();
    if (requestLock && renderer) renderer.domElement.requestPointerLock();
  }

  function onMouseMove(e) {
    if (document.pointerLockElement !== renderer.domElement) return;
    var s = TG.state;
    s.yaw -= e.movementX * 0.0024;
    s.pitch += e.movementY * 0.0018;
    s.pitch = Math.max(-0.15, Math.min(0.78, s.pitch));
  }

  // ------------------------------------------------------------
  //  开始 / 结束
  // ------------------------------------------------------------
  function startGame() {
    var s = TG.state;
    TG.audio.init();
    TG.audio.resume();
    if (TG.fragments[0] && !TG.fragments[0].hum) TG.world.attachHums();
    TG.hud.hideOverlay();
    TG.hud.showHud(true);
    s.started = true;
    s.paused = true;   // 倒计时等玩家锁定视角后才开始（试玩反馈 #1）
    setupTutorial();
    console.log('[THUNDERGAP] seed ' + s.seed.toString(16).toUpperCase() +
      ' · buildings ' + (TG.worldStats ? TG.worldStats.buildings : '?'));

    // 用户手势内直接请求锁定；成功则 lockchange 立即开跑
    if (renderer.domElement.requestPointerLock) {
      try { renderer.domElement.requestPointerLock(); } catch (e) { /* 走宽限回退 */ }
    }
    // 宽限期内既没锁定也没报错（如 iOS）：按无锁模式开局
    clearTimeout(s.lockGrace);
    s.lockGrace = setTimeout(function () {
      if (s.started && !s.over && s.paused &&
          document.pointerLockElement !== renderer.domElement) {
        resumeGame(false);
        TG.hud.notify('倒计时开始。点击画面可锁定鼠标视角。', 4);
      }
    }, CFG.PAUSE.lockGraceMs);
  }

  // FR-15：分阶段引导节拍（按条件就绪、按序展示）
  function setupTutorial() {
    var s = TG.state;
    var hud = TG.hud;
    hud.enqueue('林隙在这里。雨声太大了——先熟悉脚下。', 3.2, function () { return s.time > 1; });
    hud.enqueue('<b>W A S D</b> 移动 · <b>Shift</b> 疾跑 · <b>鼠标</b> 视角', 4.0, function () { return s.time > 4.5 || s.tut.moved; });
    hud.enqueue('按 <b>E</b> 释放回声脉冲——让雷替你看路。', 4.5, function () { return s.movedDist > 8 || s.time > 11; });
    hud.enqueue('光纹扫过的东西会亮。<b>碎片显形后 5 秒内</b>赶过去。', 4.5, function () { return s.tut.pulsed; });
    hud.enqueue('<b>红色预警环</b>：1.35 秒后落雷。离开那个圈。', 4.0, function () { return s.tut.warned; });
    hud.enqueue('穹顶过半了。集齐 <b>8 片雷纹</b>，跟着罗盘去广播塔。', 4.5, function () { return s.storm > 0.5; });
  }

  function win() {
    var s = TG.state;
    if (s.over) return;
    s.over = true; s.won = true;
    TG.player.setPose('win');
    TG.hud.endCard(true);
  }

  function lose() {
    var s = TG.state;
    if (s.over) return;
    s.over = true; s.won = false;
    TG.player.setPose('lose');
    TG.hud.endCard(false);
  }

  // ------------------------------------------------------------
  //  碎片 / 目标
  // ------------------------------------------------------------
  function updateFragments(dt) {
    var s = TG.state;
    var player = TG.playerGroup;
    for (var i = 0; i < TG.fragments.length; i++) {
      var f = TG.fragments[i];
      if (f.taken) continue;
      f.phase += dt;
      f.obj.position.y = 1.5 + Math.sin(f.phase * 1.6) * 0.22;
      f.obj.rotation.y += dt * 0.9;
      f.cage.rotation.x += dt * 0.5;

      if (f.lit > 0) f.lit -= dt;
      // 拾取/显形判定用水平距离（试玩反馈 #4：悬浮高度不再让玩家"贴脸拿不到"）
      var dH = Math.hypot(f.obj.position.x - player.position.x, f.obj.position.z - player.position.z);
      var d = f.obj.position.distanceTo(player.position);
      var on = f.lit > 0 || dH < CFG.FRAGMENT.nearDist;
      var tgt = on ? 1 : 0;
      f.core.material.opacity += (0.35 + tgt * 0.6 - f.core.material.opacity) * Math.min(1, dt * 5);
      f.cage.material.opacity += (0.12 + tgt * 0.5 - f.cage.material.opacity) * Math.min(1, dt * 5);
      f.beam.material.opacity += (0.07 + tgt * 0.22 - f.beam.material.opacity) * Math.min(1, dt * 5);
      f.light.intensity += (tgt * 3.2 - f.light.intensity) * Math.min(1, dt * 5);

      // D5：空间嗡鸣音量 = 显形/临近为主 + 近距渐入
      if (f.hum) {
        var humV = tgt * 0.045 + Math.max(0, 1 - dH / CFG.FRAGMENT.humFalloff) * 0.018;
        f.hum.set(humV);
      }

      if (dH < CFG.FRAGMENT.pickupDist) {
        f.taken = true;
        TG.scene.remove(f.obj);
        if (f.hum) f.hum.set(0);
        s.frags++;
        s.storm = Math.max(0, s.storm - CFG.FRAGMENT.stormRelief);
        s.hp = Math.min(100, s.hp + CFG.FRAGMENT.heal);
        TG.audio.pickup(); TG.audio.radio();
        TG.player.setPose('pickup');
        TG.hud.notify('<b>雷纹碎片 ' + s.frags + ' / ' + CFG.GOAL_FRAGMENTS + '</b><br>' + CFG.fragLines[s.frags - 1], 4.2);
        if (s.frags === CFG.GOAL_FRAGMENTS) {
          setTimeout(function () {
            TG.hud.notify('八段信号齐了。广播塔的闸门开了——<b>去塔基</b>。', 5);
          }, 4400);
        }
      }
    }
  }

  function updateGoal() {
    var s = TG.state;
    var player = TG.playerGroup;
    var towerPos = TG.towerPos;
    var d = Math.hypot(player.position.x - towerPos.x, player.position.z - towerPos.z);

    // 罗盘投影：把目标方向投到玩家视角（前 / 右）坐标系
    var Y = s.yaw;
    var sinY = Math.sin(Y), cosY = Math.cos(Y);
    var vx = towerPos.x - player.position.x;
    var vz = towerPos.z - player.position.z;
    var deg = Math.atan2(vx * cosY - vz * sinY, -vx * sinY - vz * cosY) * 180 / Math.PI;
    TG.hud.setCompass(deg, d);

    // 最近未拾取碎片的方位小罗盘（试玩反馈 #3）
    var nd = Infinity, nx = 0, nz = 0, any = false;
    for (var i = 0; i < TG.fragments.length; i++) {
      var f = TG.fragments[i];
      if (f.taken) continue;
      var fx2 = f.obj.position.x - player.position.x;
      var fz2 = f.obj.position.z - player.position.z;
      var fd = Math.hypot(fx2, fz2);
      if (fd < nd) { nd = fd; nx = fx2; nz = fz2; any = true; }
    }
    if (any) {
      var fdeg = Math.atan2(nx * cosY - nz * sinY, -nx * sinY - nz * cosY) * 180 / Math.PI;
      TG.hud.setFragCompass(fdeg, nd, true);
    } else {
      TG.hud.setFragCompass(0, 0, false);   // 全收齐后隐藏
    }

    if (d < 9.2 && s.frags >= CFG.GOAL_FRAGMENTS) win();
  }

  // ------------------------------------------------------------
  //  主循环
  // ------------------------------------------------------------
  function tick() {
    var dt = Math.min(0.05, clock.getDelta());
    var s = TG.state;

    if (s.started && !s.over && !s.paused) {
      s.time += dt;
      s.storm = Math.min(1, s.time / CFG.STORM_DURATION);

      TG.player.update(dt);
      updateFragments(dt);
      updateGoal();
      TG.hud.update();
      TG.hud.pump();

      TG.fx.timers(dt);

      // 雨声随穹顶强度
      TG.audio.setRainLevel(0.09 + s.storm * 0.13);

      if (s.hp <= 0) lose();
      if (s.storm >= 1) lose();
    }

    if (s.started && !s.paused) TG.player.updateCamera(dt);
    TG.fx.update(dt);
    TG.audio.listener(camera);

    renderer.render(scene, camera);
  }

  // DOM 就绪后启动（脚本置于 body 末尾，直接执行亦可）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init: init, pauseGame: pauseGame, resumeGame: resumeGame };
})();
