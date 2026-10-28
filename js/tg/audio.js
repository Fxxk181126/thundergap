// ============================================================
//  雷隙 THUNDERGAP — 程序化音频（TG.audio）
//  WebAudio 全实时合成，无音频文件。
//  D5 空间化：雷声 / 落雷预警 / 碎片嗡鸣走 PannerNode（HRTF），
//  Listener 每帧跟随相机；不支持时退化为 equalpower 声像。
// ============================================================
window.TG = window.TG || {};

TG.audio = (function () {
  'use strict';

  var CFG = TG.config;
  var audio = { ctx: null, master: null, rainGain: null, muted: false, ready: false };
  var tmpDir = null;

  function initAudio() {
    if (audio.ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = new AC();
    audio.ctx = ctx;

    audio.master = ctx.createGain();
    audio.master.gain.value = 0.9;
    audio.master.connect(ctx.destination);

    // 白噪声缓冲（2 秒），所有噪声类音效的原料
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var dat = buf.getChannelData(0);
    for (var i = 0; i < len; i++) dat[i] = Math.random() * 2 - 1;
    audio.noiseBuf = buf;

    // 常驻层 · 雨声：白噪 → 带通 1750 → 高通 480 → 增益随穹顶
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1750; bp.Q.value = 0.55;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 480;
    audio.rainGain = ctx.createGain();
    audio.rainGain.gain.value = 0.10;
    src.connect(bp); bp.connect(hp); hp.connect(audio.rainGain); audio.rainGain.connect(audio.master);
    src.start();
    audio.rainSrc = src;

    // 常驻层 · 低频风声
    var wsrc = ctx.createBufferSource();
    wsrc.buffer = buf; wsrc.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    var wg = ctx.createGain(); wg.gain.value = 0.16;
    wsrc.connect(lp); lp.connect(wg); wg.connect(audio.master);
    wsrc.start();

    tmpDir = new THREE.Vector3();
    audio.ready = true;
  }

  // ---------- 空间化基建 ----------
  function makePanner(pos) {
    var p = audio.ctx.createPanner();
    try { p.panningModel = 'HRTF'; } catch (e) { /* 老浏览器保持默认 equalpower */ }
    p.distanceModel = 'inverse';
    p.refDistance = 8;
    p.maxDistance = 260;
    p.rolloffFactor = 1;
    setPanPos(p, pos);
    p.connect(audio.master);
    return p;
  }

  function setPanPos(p, pos) {
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
  }

  function listener(cam) {
    if (!audio.ready) return;
    var l = audio.ctx.listener;
    var p = cam.position;
    cam.getWorldDirection(tmpDir);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = tmpDir.x; l.forwardY.value = tmpDir.y; l.forwardZ.value = tmpDir.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(tmpDir.x, tmpDir.y, tmpDir.z, 0, 1, 0);
    }
  }

  // ---------- 事件音效 ----------
  // 雷鸣：距离延迟 + 低通扫频；d5 起带空间方位
  function thunder(dist, pos) {
    if (!audio.ready || audio.muted) return;
    var ctx = audio.ctx;
    var delay = Math.min(2.2, dist / 220 + 0.12);
    var t0 = ctx.currentTime + delay;

    var src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    src.loop = true;

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(560, t0);
    lp.frequency.exponentialRampToValueAtTime(70, t0 + 2.4);

    var g = ctx.createGain();
    var vol = Math.max(0.12, 1 - dist / 320) * 0.85;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.8);

    var out = (pos && ctx.createPanner) ? makePanner(pos) : audio.master;
    src.connect(lp); lp.connect(g); g.connect(out);
    src.start(t0); src.stop(t0 + 3.0);

    // 近距雷击的低频冲击（直达，不空间化）
    if (dist < 60) {
      var o = ctx.createOscillator();
      var og = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(64, t0);
      o.frequency.exponentialRampToValueAtTime(24, t0 + 0.9);
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      o.connect(og); og.connect(audio.master);
      o.start(t0); o.stop(t0 + 1.5);
    }
  }

  // 落雷轰鸣：零延迟近炸
  function boom() {
    if (!audio.ready || audio.muted) return;
    var ctx = audio.ctx, t0 = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf; src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.1);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    src.connect(lp); lp.connect(g); g.connect(audio.master);
    src.start(t0); src.stop(t0 + 1.7);
  }

  // 落雷预警滴答：在预警环位置播三声方位提示（听声辨位）
  function warn(pos) {
    if (!audio.ready || audio.muted) return;
    var ctx = audio.ctx, t0 = ctx.currentTime;
    var out = ctx.createPanner ? makePanner(pos) : audio.master;
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      var st = t0 + i * 0.45;
      o.type = 'sine'; o.frequency.value = 980;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.07, st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
      o.connect(g); g.connect(out);
      o.start(st); o.stop(st + 0.15);
    }
  }

  // 回声脉冲：声呐 ping
  function pulse() {
    if (!audio.ready || audio.muted) return;
    var ctx = audio.ctx, t0 = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400, t0);
    o.frequency.exponentialRampToValueAtTime(320, t0 + 0.55);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o.connect(g); g.connect(audio.master);
    o.start(t0); o.stop(t0 + 0.75);
  }

  // 碎片拾取：上行三连音
  function pickup() {
    if (!audio.ready || audio.muted) return;
    var ctx = audio.ctx, t0 = ctx.currentTime;
    [880, 1320, 1760].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      var st = t0 + i * 0.06;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.16, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.55);
      o.connect(g); g.connect(audio.master);
      o.start(st); o.stop(st + 0.6);
    });
  }

  // 无线电底噪：高 Q 带通模拟静电人声频段
  function radio() {
    if (!audio.ready || audio.muted) return;
    var ctx = audio.ctx, t0 = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf; src.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.05);
    g.gain.setValueAtTime(0.09, t0 + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    src.connect(bp); bp.connect(g); g.connect(audio.master);
    src.start(t0); src.stop(t0 + 2.3);
  }

  // 碎片嗡鸣：常驻空间音源，音量随显形/距离由 updateFragments 驱动
  function hum(pos) {
    if (!audio.ready) return { set: function () {}, pan: null };
    var ctx = audio.ctx;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 168 + Math.random() * 44;
    var g = ctx.createGain();
    g.gain.value = 0;
    var pan = makePanner(pos);
    o.connect(g); g.connect(pan);
    o.start();
    return {
      set: function (v) { g.gain.setTargetAtTime(v, ctx.currentTime, 0.12); },
      pan: pan
    };
  }

  function setRainLevel(v) {
    if (audio.rainGain) audio.rainGain.gain.value = v;
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.9;
    return audio.muted;
  }

  function resume() {
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  }

  return {
    state: audio,
    init: initAudio,
    resume: resume,
    listener: listener,
    thunder: thunder,
    boom: boom,
    warn: warn,
    pulse: pulse,
    pickup: pickup,
    radio: radio,
    hum: hum,
    setRainLevel: setRainLevel,
    toggleMute: toggleMute
  };
})();
