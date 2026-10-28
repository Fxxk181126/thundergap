// ============================================================
//  雷隙 THUNDERGAP — 特效层（TG.fx）
//  环境闪电 / 威胁落雷 / 回声脉冲 / 涟漪与后期衰减
//  随机数走 TG.rng；雷声与预警走空间音频（D5）。
// ============================================================
window.TG = window.TG || {};

TG.fx = (function () {
  'use strict';

  var CFG = TG.config;
  var boltFx = [];
  var boltTimer = 1.5, strikeTimer = 4;

  // ---------- 折线闪电 ----------
  function makeBoltPath(from, to, jitter) {
    var pts = [];
    var segs = 14;
    for (var i = 0; i <= segs; i++) {
      var t = i / segs;
      var p = new THREE.Vector3().lerpVectors(from, to, t);
      if (i > 0 && i < segs) {
        p.x += (TG.rng.next() - 0.5) * jitter;
        p.z += (TG.rng.next() - 0.5) * jitter;
        p.y += (TG.rng.next() - 0.5) * jitter * 0.4;
      }
      pts.push(p);
    }
    return pts;
  }

  function spawnBolt(from, to, jitter, color) {
    var scene = TG.scene;
    var pts = makeBoltPath(from, to, jitter);
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineBasicMaterial({
      color: color || 0xdff0ff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var line = new THREE.Line(geo, mat);
    scene.add(line);
    // 用两条轻微偏移的线模拟粗细
    var pts2 = makeBoltPath(from, to, jitter * 1.5);
    var line2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), mat.clone());
    line2.material.opacity = 0.5;
    scene.add(line2);
    return { lines: [line, line2], life: 0.13 + TG.rng.next() * 0.1, max: 0.23 };
  }

  // ---------- 环境闪电（舞台灯光 + 免费视野，无伤害） ----------
  function atmosphericBolt() {
    var s = TG.state;
    var player = TG.playerGroup;
    var bx = (TG.rng.next() - 0.5) * CFG.CITY * 1.4;
    var bz = (TG.rng.next() - 0.5) * CFG.CITY * 1.4;
    var from = new THREE.Vector3(bx, 90 + TG.rng.next() * 40, bz);
    var to = new THREE.Vector3(bx + (TG.rng.next() - 0.5) * 30, 0, bz + (TG.rng.next() - 0.5) * 30);
    boltFx.push(spawnBolt(from, to, 14, 0xcfe6ff));

    s.flash = Math.max(s.flash, 0.55 + TG.rng.next() * 0.4);
    TG.lights.lightning.position.set(bx, 100, bz);
    TG.lights.lightning.intensity = 2.6 + TG.rng.next() * 2.2;
    TG.lights.ambient.intensity = 1.5;
    TG.skyUniforms.uFlash.value = 0.5;
    TG.rain.material.uniforms.uBright.value = 1.0;

    var dist = to.distanceTo(player.position);
    TG.audio.thunder(dist, to);
  }

  // ---------- 威胁落雷 ----------
  function spawnStrike() {
    var scene = TG.scene;
    var player = TG.playerGroup;
    // 在玩家附近随机落雷；未拾取碎片 8m 内不生成（试玩反馈 #8：落雷公平性），重试采样
    var x = 0, z = 0;
    for (var attempt = 0; attempt < CFG.STRIKE.fragSafeRetry; attempt++) {
      var ang = TG.rng.next() * Math.PI * 2;
      var rad = CFG.STRIKE.rangeMin + TG.rng.next() * (CFG.STRIKE.rangeMax - CFG.STRIKE.rangeMin);
      x = player.position.x + Math.cos(ang) * rad;
      z = player.position.z + Math.sin(ang) * rad;
      x = Math.max(-CFG.CITY * 0.62, Math.min(CFG.CITY * 0.62, x));
      z = Math.max(-CFG.CITY * 0.62, Math.min(CFG.CITY * 0.62, z));
      var nearFragment = false;
      for (var fi = 0; fi < TG.fragments.length; fi++) {
        var fr = TG.fragments[fi];
        if (fr.taken) continue;
        if (Math.hypot(fr.obj.position.x - x, fr.obj.position.z - z) < CFG.STRIKE.fragSafeR) {
          nearFragment = true;
          break;
        }
      }
      if (!nearFragment) break;
    }

    var warn = new THREE.Mesh(
      new THREE.RingGeometry(2.9, 3.5, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff3222, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    warn.rotation.x = -Math.PI / 2;
    warn.position.set(x, 0.06, z);
    scene.add(warn);

    var inner = new THREE.Mesh(
      new THREE.CircleGeometry(2.9, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff3222, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(x, 0.05, z);
    scene.add(inner);

    // D5：预警滴答从落点方位传来
    TG.audio.warn(new THREE.Vector3(x, 0.5, z));
    TG.state.tut.warned = true;

    TG.strikes.push({ x: x, z: z, t: 0, delay: CFG.STRIKE.warnDelay, warn: warn, inner: inner, done: false });
  }

  function detonate(st) {
    var scene = TG.scene;
    var s = TG.state;
    var player = TG.playerGroup;
    var top = new THREE.Vector3(st.x, 100, st.z);
    var bot = new THREE.Vector3(st.x, 0.1, st.z);
    boltFx.push(spawnBolt(top, bot, 5, 0xffffff));

    s.flash = 1.0;
    s.camShake = Math.max(s.camShake, 0.85);
    TG.lights.lightning.position.set(st.x, 100, st.z);
    TG.lights.lightning.intensity = 6;
    TG.lights.ambient.intensity = 2.4;
    TG.audio.boom();

    // 冲击波
    var wave = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.2, 40),
      new THREE.MeshBasicMaterial({
        color: 0xbfe6ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(st.x, 0.12, st.z);
    scene.add(wave);
    st.wave = wave; st.waveT = 0;

    // 伤害（2D 平面距离；跳起不无敌）
    var d = Math.hypot(player.position.x - st.x, player.position.z - st.z);
    if (d < CFG.STRIKE.hitR && s.invuln <= 0) {
      var dmg = d < CFG.STRIKE.centerR ? CFG.STRIKE.dmgCenter : CFG.STRIKE.dmgEdge;
      s.hp -= dmg;
      s.invuln = CFG.STRIKE.invuln;
      s.hurt = 1;
      TG.player.setPose('hurt');
      // 击退：把玩家推出预警环的纠错机制
      var kx = player.position.x - st.x, kz = player.position.z - st.z;
      var kl = Math.hypot(kx, kz) || 1;
      s.vel.x += (kx / kl) * CFG.STRIKE.knock;
      s.vel.z += (kz / kl) * CFG.STRIKE.knock;
      s.vel.y = CFG.STRIKE.knockUp;
    }
  }

  // ---------- 回声脉冲 ----------
  function emitPulse() {
    var scene = TG.scene;
    var s = TG.state;
    var player = TG.playerGroup;
    if (s.resonance < CFG.RESONANCE.cost) {
      TG.hud.notify('共鸣值不足——等它回满。', 1.4);
      return;
    }
    s.resonance -= CFG.RESONANCE.cost;
    s.tut.pulsed = true;

    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 64),
      new THREE.MeshBasicMaterial({
        color: 0x7fe9ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(player.position);
    ring.position.y = 0.12;
    scene.add(ring);
    var pu = { ring: ring, r: 0.9, max: CFG.PULSE.maxR, life: 0 };

    // 半球扩散壳
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x7fe9ff, transparent: true, opacity: 0.22, wireframe: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    dome.position.copy(player.position);
    scene.add(dome);
    pu.dome = dome;

    TG.pulses.push(pu);
    TG.lights.pulse.intensity = 14;
    TG.audio.pulse();
  }

  // ---------- 定时器推进（由主循环调用） ----------
  function timers(dt) {
    var s = TG.state;
    // 环境闪电
    boltTimer -= dt;
    if (boltTimer <= 0) {
      atmosphericBolt();
      boltTimer = Math.max(0.8, 4.2 - s.storm * 3.0) * (0.4 + TG.rng.next());
    }
    // 落雷
    strikeTimer -= dt;
    if (strikeTimer <= 0) {
      spawnStrike();
      if (s.storm > 0.55 && TG.rng.chance(0.5)) spawnStrike();
      if (s.storm > 0.85 && TG.rng.chance(0.4)) spawnStrike();
      strikeTimer = Math.max(1.5, 6.2 - s.storm * 4.4) * (0.65 + TG.rng.next() * 0.7);
    }
  }

  // ---------- 特效更新 ----------
  function update(dt) {
    // D2：主渲染之前先把镜像视图烘进反射 RT（相机过远 / 在镜面下时内部自动跳过）
    if (TG.reflector) TG.reflector.update(TG.renderer, TG.camera, TG.scene, TG.clock.getElapsedTime());
    var scene = TG.scene;
    var s = TG.state;
    var camera = TG.camera;
    var clock = TG.clock;
    var player = TG.playerGroup;

    // 闪电衰减
    if (TG.lights.lightning.intensity > 0) {
      TG.lights.lightning.intensity = Math.max(0, TG.lights.lightning.intensity - dt * 7.5);
    }
    if (TG.lights.ambient.intensity > 0.55) TG.lights.ambient.intensity = Math.max(0.55, TG.lights.ambient.intensity - dt * 3.2);
    if (TG.skyUniforms.uFlash.value > 0) TG.skyUniforms.uFlash.value = Math.max(0, TG.skyUniforms.uFlash.value - dt * 2.6);
    var rb = TG.rain.material.uniforms.uBright;
    rb.value = Math.max(0.32 + s.storm * 0.25, rb.value - dt * 1.6);

    // 闪电折线淡出
    for (var i = boltFx.length - 1; i >= 0; i--) {
      var b = boltFx[i];
      b.life += dt;
      var k = 1 - b.life / b.max;
      b.lines.forEach(function (l) { l.material.opacity = Math.max(0, k); });
      if (b.life >= b.max) {
        b.lines.forEach(function (l) { scene.remove(l); l.geometry.dispose(); l.material.dispose(); });
        boltFx.splice(i, 1);
      }
    }

    // 屏幕闪白 / 受伤
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3.4);
    if (s.hurt > 0) s.hurt = Math.max(0, s.hurt - dt * 1.5);
    TG.hud.setFlash(s.flash * 0.62);
    TG.hud.setHurt(s.hurt * 0.9);

    // 雨跟随相机
    TG.rain.material.uniforms.uTime.value = clock.getElapsedTime();
    TG.rain.material.uniforms.uCam.value.copy(camera.position);

    // 涟漪
    var dummy = new THREE.Object3D();
    var col = new THREE.Color();
    var rippleMesh = TG.rippleMesh;
    for (var r = 0; r < TG.ripples.length; r++) {
      var rp = TG.ripples[r];
      rp.life += dt;
      if (rp.life > rp.dur) {
        rp.life = 0;
        rp.x = camera.position.x + (TG.rng.next() - 0.5) * 70;
        rp.z = camera.position.z + (TG.rng.next() - 0.5) * 70;
        rp.dur = 0.45 + TG.rng.next() * 0.7;
      }
      var t = rp.life / rp.dur;
      var sc = 0.4 + t * 2.4;
      dummy.position.set(rp.x, 0.04, rp.z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      rippleMesh.setMatrixAt(r, dummy.matrix);
      var a = (1 - t) * 0.55 * (0.4 + s.storm * 0.6);
      col.setRGB(a * 0.5, a * 0.75, a);
      rippleMesh.setColorAt(r, col);
    }
    rippleMesh.instanceMatrix.needsUpdate = true;
    if (rippleMesh.instanceColor) rippleMesh.instanceColor.needsUpdate = true;

    // 落雷预警
    for (var st = TG.strikes.length - 1; st >= 0; st--) {
      var s2 = TG.strikes[st];
      s2.t += dt;
      if (!s2.done) {
        var pulseT = (Math.sin(s2.t * 16) * 0.5 + 0.5);
        s2.warn.material.opacity = 0.35 + pulseT * 0.6;
        s2.inner.material.opacity = 0.06 + pulseT * 0.16;
        var ws = 1 + Math.sin(s2.t * 16) * 0.05;
        s2.warn.scale.set(ws, ws, ws);
        if (s2.t >= s2.delay) { s2.done = true; detonate(s2); }
      } else {
        s2.warn.material.opacity = Math.max(0, s2.warn.material.opacity - dt * 4);
        s2.inner.material.opacity = Math.max(0, s2.inner.material.opacity - dt * 4);
        if (s2.wave) {
          s2.waveT += dt;
          var wk = s2.waveT / 0.75;
          var sc2 = 0.6 + wk * 12;
          s2.wave.scale.set(sc2, sc2, sc2);
          s2.wave.material.opacity = Math.max(0, 0.9 * (1 - wk));
          if (wk >= 1) { scene.remove(s2.wave); s2.wave = null; }
        }
        if (s2.t > s2.delay + 1.4) {
          scene.remove(s2.warn); scene.remove(s2.inner);
          if (s2.wave) scene.remove(s2.wave);
          TG.strikes.splice(st, 1);
        }
      }
    }

    // 脉冲环
    for (var p = TG.pulses.length - 1; p >= 0; p--) {
      var pu = TG.pulses[p];
      pu.life += dt;
      pu.r += dt * CFG.PULSE.speed;
      var k2 = pu.r / pu.max;
      pu.ring.scale.set(pu.r, pu.r, pu.r);
      pu.ring.material.opacity = Math.max(0, 0.85 * (1 - k2));
      if (pu.dome) {
        var ds = pu.r * 0.9;
        pu.dome.scale.set(ds, ds * 0.7, ds);
        pu.dome.material.opacity = Math.max(0, 0.2 * (1 - k2));
      }
      TG.lights.pulse.position.set(player.position.x, 2.5, player.position.z);
      TG.lights.pulse.intensity = Math.max(0, 16 * (1 - k2));
      TG.lights.pulse.distance = 12 + pu.r;

      // 点亮碎片：|碎片距离 − 波前半径| < 带宽
      for (var f = 0; f < TG.fragments.length; f++) {
        var fr = TG.fragments[f];
        if (fr.taken) continue;
        var d = fr.obj.position.distanceTo(player.position);
        if (Math.abs(d - pu.r) < CFG.PULSE.revealBand) fr.lit = CFG.PULSE.revealTime;
      }

      if (k2 >= 1) {
        scene.remove(pu.ring);
        if (pu.dome) scene.remove(pu.dome);
        TG.pulses.splice(p, 1);
      }
    }

    // 屋顶警示灯闪烁
    var tt = clock.getElapsedTime();
    for (var q = 0; q < TG.skyBolts.length; q++) {
      var bc = TG.skyBolts[q];
      bc.visible = (Math.sin(tt * 2.2 + bc.userData.phase) > 0.55);
    }
    if (TG.towerBeacon) TG.towerBeacon.visible = (Math.sin(tt * 1.7) > 0.3);

    // 天空跟随相机
    TG.sky.position.copy(camera.position);
  }

  return {
    update: update,
    timers: timers,
    emitPulse: emitPulse
  };
})();
