// ============================================================
//  雷隙 THUNDERGAP — 角色控制层（TG.player）
//  第三人称控制 / 自研物理 / 程序化动画 / 相机
//  TD-6：相机避障改 AABB 解析求交（不再走 Raycaster 三角面）
//  TD-7：跳跃土狼时间 + 输入缓冲
//  D3 ：事件姿态（受击/拾取/胜负）与跑动循环做程序化混合
// ============================================================
window.TG = window.TG || {};

TG.player = (function () {
  'use strict';

  var CFG = TG.config;
  var P = CFG.PLAYER;

  var group, parts = {};
  var camTarget = new THREE.Vector3();

  // ---------- D3 事件姿态表（相对基础跑动循环的目标关节角） ----------
  var POSES = {
    hurt:   { dur: 0.55, armL: -2.3, armR: -2.3, legL: 0.55, legR: -0.45, head: -0.30 },
    pickup: { dur: 0.80, armL:  0.5, armR: -2.7, legL: 0.0,  legR:  0.0,  head:  0.25 },
    win:    { dur: 3.0,  armL: -2.9, armR: -2.9, legL: 0.0,  legR:  0.0,  head: -0.35 },
    lose:   { dur: 3.0,  armL:  0.2, armR:  0.2, legL: 1.2,  legR: -1.0,  head:  0.50 }
  };

  function setPose(name) {
    var s = TG.state;
    if (s.pose && s.pose.name === name) return;
    s.pose = { name: name, t: 0, dur: POSES[name].dur };
  }

  // ---------- 角色构建（低多边形林隙） ----------
  function build() {
    var scene = TG.scene;
    group = new THREE.Group();

    var coat = new THREE.MeshStandardMaterial({ color: 0x1a2436, roughness: 0.32, metalness: 0.25 });
    var skin = new THREE.MeshStandardMaterial({ color: 0xd9b39a, roughness: 0.62, metalness: 0.05 });
    var hair = new THREE.MeshStandardMaterial({ color: 0x0d1420, roughness: 0.5, metalness: 0.15 });
    var glow = new THREE.MeshBasicMaterial({ color: 0x7fe9ff });
    var strip = new THREE.MeshBasicMaterial({ color: 0x2ecfe8 });

    // 躯干
    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 4, 10), coat);
    torso.position.y = 1.06;
    group.add(torso);

    // 风衣下摆
    var skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.42, 0.55, 10, 1, true), coat);
    skirt.position.y = 0.72;
    group.add(skirt);
    parts.skirt = skirt;

    // 湿发光泽描边
    var rim = new THREE.Mesh(new THREE.CapsuleGeometry(0.265, 0.44, 4, 10),
      new THREE.MeshBasicMaterial({ color: 0x6fd8ff, side: THREE.BackSide, transparent: true, opacity: 0.16 }));
    rim.position.y = 1.06;
    group.add(rim);

    // 头 + 头发 + 帽兜
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 12), skin);
    head.position.y = 1.53;
    group.add(head);
    parts.head = head;

    var hood = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hood.position.set(0, 1.55, -0.04);
    hood.rotation.x = -0.22;
    group.add(hood);

    var hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hair);
    hairBack.scale.set(1, 1.25, 0.72);
    hairBack.position.set(0, 1.48, -0.14);
    group.add(hairBack);

    // 手臂
    var armGeo = new THREE.CapsuleGeometry(0.075, 0.42, 3, 8);
    var armL = new THREE.Mesh(armGeo, coat); armL.position.set(-0.31, 1.12, 0);
    var armR = new THREE.Mesh(armGeo, coat); armR.position.set(0.31, 1.12, 0);
    group.add(armL); group.add(armR);
    parts.armL = armL; parts.armR = armR;

    // 手环（回声装置）
    var bandL = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 6, 14), glow);
    bandL.rotation.y = Math.PI / 2; bandL.position.set(-0.34, 1.30, 0.02);
    group.add(bandL);
    var bandR = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 6, 14), glow);
    bandR.rotation.y = Math.PI / 2; bandR.position.set(0.34, 1.30, 0.02);
    group.add(bandR);

    // 腿
    var legGeo = new THREE.CapsuleGeometry(0.095, 0.44, 3, 8);
    var legMat = new THREE.MeshStandardMaterial({ color: 0x101724, roughness: 0.4, metalness: 0.3 });
    var legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.12, 0.46, 0);
    var legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.12, 0.46, 0);
    group.add(legL); group.add(legR);
    parts.legL = legL; parts.legR = legR;

    // 背后反光条
    var s1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.022, 0.012), strip);
    s1.position.set(0, 1.16, -0.245);
    group.add(s1);
    var s2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.022, 0.012), strip);
    s2.position.set(0, 1.02, -0.27);
    group.add(s2);

    // 围巾（飘动）
    var scarf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x2b5f7a, roughness: 0.8 }));
    scarf.position.set(0, 1.32, -0.26);
    group.add(scarf);
    parts.scarf = scarf;

    // 贴地假阴影
    var sh = document.createElement('canvas'); sh.width = sh.height = 64;
    var sg = sh.getContext('2d');
    var grd = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,.62)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grd; sg.fillRect(0, 0, 64, 64);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    // 随身微光（让主角在暗处可见）
    var own = new THREE.PointLight(0x9fe4ff, 0.55, 9, 2);
    own.position.set(0, 1.3, 0);
    group.add(own);

    group.position.set(12, 0, 84);
    group.traverse(function (c) { c.layers.enable(1); });  // D2：主角入镜塔区反射
    scene.add(group);

    TG.playerGroup = group;
    TG.playerParts = parts;
  }

  // ---------- 碰撞：圆柱 vs AABB 最小穿透轴推出 ----------
  function collide(p, radius) {
    var boxes = TG.boxes;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (p.x + radius > b.minX && p.x - radius < b.maxX &&
          p.z + radius > b.minZ && p.z - radius < b.maxZ) {
        // 沿最小穿透轴推出
        var dl = (p.x + radius) - b.minX;
        var dr = b.maxX - (p.x - radius);
        var db = (p.z + radius) - b.minZ;
        var dt = b.maxZ - (p.z - radius);
        var m = Math.min(dl, dr, db, dt);
        if (m === dl) p.x = b.minX - radius;
        else if (m === dr) p.x = b.maxX + radius;
        else if (m === db) p.z = b.minZ - radius;
        else p.z = b.maxZ + radius;
      }
    }
  }

  // ---------- TD-6：射线 vs AABB（slab 法，含楼高） ----------
  function rayBox(o, d, b, maxT) {
    var tmin = 0, tmax = maxT, t1, t2, inv, tmp;
    // x slab
    if (Math.abs(d.x) < 1e-9) { if (o.x < b.minX || o.x > b.maxX) return -1; }
    else {
      inv = 1 / d.x; t1 = (b.minX - o.x) * inv; t2 = (b.maxX - o.x) * inv;
      if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // y slab（楼体从地面到 b.h）
    if (Math.abs(d.y) < 1e-9) { if (o.y < 0 || o.y > b.h) return -1; }
    else {
      inv = 1 / d.y; t1 = (0 - o.y) * inv; t2 = (b.h - o.y) * inv;
      if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // z slab
    if (Math.abs(d.z) < 1e-9) { if (o.z < b.minZ || o.z > b.maxZ) return -1; }
    else {
      inv = 1 / d.z; t1 = (b.minZ - o.z) * inv; t2 = (b.maxZ - o.z) * inv;
      if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  function raycastBoxes(o, d, maxT) {
    var boxes = TG.boxes, best = -1;
    for (var i = 0; i < boxes.length; i++) {
      var t = rayBox(o, d, boxes[i], maxT);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  // ---------- 玩家更新 ----------
  function update(dt) {
    var s = TG.state;
    var keys = TG.keys;
    var pos = group.position;

    var fwd = 0, side = 0;
    if (keys['KeyW'] || keys['ArrowUp']) fwd += 1;
    if (keys['KeyS'] || keys['ArrowDown']) fwd -= 1;
    if (keys['KeyA']) side -= 1;
    if (keys['KeyD']) side += 1;
    if (keys['ArrowLeft']) s.yaw += 1.7 * dt;
    if (keys['ArrowRight']) s.yaw -= 1.7 * dt;

    var sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    var speed = sprint ? P.sprint : P.walk;
    if (s.storm > 0.75) speed *= 0.94;

    var dir = new THREE.Vector3(0, 0, 0);
    if (fwd || side) {
      var sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
      dir.x = (-sinY * fwd) + (cosY * side);
      dir.z = (-cosY * fwd) + (-sinY * side);
      dir.normalize();
    }

    // 水平移动（带惯性）
    var target = dir.multiplyScalar(speed);
    s.vel.x += (target.x - s.vel.x) * Math.min(1, dt * P.accel);
    s.vel.z += (target.z - s.vel.z) * Math.min(1, dt * P.accel);

    // TD-7：跳跃 = 输入缓冲 ∩ 土狼时间
    s.jumpBuf = Math.max(0, s.jumpBuf - dt);
    s.coyote = s.onGround ? P.coyote : Math.max(0, s.coyote - dt);
    if (s.jumpBuf > 0 && s.coyote > 0) {
      s.jumpBuf = 0; s.coyote = 0;
      s.vel.y = P.jump;
      s.onGround = false;
    }
    s.vel.y -= P.gravity * dt;

    pos.x += s.vel.x * dt;
    pos.z += s.vel.z * dt;
    pos.y += s.vel.y * dt;

    if (pos.y <= 0) {
      pos.y = 0;
      s.vel.y = 0;
      s.onGround = true;
    }

    collide(pos, P.radius);

    // 世界边界
    var L = CFG.CITY * 0.72;
    pos.x = Math.max(-L, Math.min(L, pos.x));
    pos.z = Math.max(-L, Math.min(L, pos.z));

    // 朝向
    if (dir.lengthSq() > 0.001) {
      var want = Math.atan2(dir.x, dir.z);
      var cur = group.rotation.y;
      var diff = ((want - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
      group.rotation.y = cur + diff * Math.min(1, dt * P.turnLerp);
    }

    // ---------- 程序化动画：跑动循环 ⊕ 事件姿态混合（D3） ----------
    var sp = Math.hypot(s.vel.x, s.vel.z);
    s.runPhase += dt * (3.2 + sp * 1.5);
    s.movedDist += sp * dt;

    var sw = Math.sin(s.runPhase) * Math.min(0.62, sp * 0.09);
    var pw = 0, pose = null;
    if (s.pose) {
      s.pose.t += dt;
      var k = s.pose.t / s.pose.dur;
      if (k >= 1) s.pose = null;
      else { pose = POSES[s.pose.name]; pw = Math.sin(Math.PI * k); }
    }
    function mix(base, target) { return base * (1 - pw) + target * pw; }

    if (parts.legL) parts.legL.rotation.x = mix(sw, pose ? pose.legL : 0);
    if (parts.legR) parts.legR.rotation.x = mix(-sw, pose ? pose.legR : 0);
    if (parts.armL) parts.armL.rotation.x = mix(-sw * 0.8, pose ? pose.armL : 0);
    if (parts.armR) parts.armR.rotation.x = mix(sw * 0.8, pose ? pose.armR : 0);
    if (parts.head) parts.head.rotation.x = mix(0, pose ? pose.head : 0);
    pos.y += Math.abs(Math.sin(s.runPhase)) * 0.03 * Math.min(1, sp / 4) * (1 - pw);
    if (parts.scarf) {
      parts.scarf.rotation.x = -0.5 - sp * 0.05 + Math.sin(s.runPhase * 0.7) * 0.12;
      parts.scarf.position.z = -0.26 - sp * 0.012;
    }
    if (parts.skirt) parts.skirt.rotation.z = Math.sin(s.runPhase * 0.5) * 0.05;

    // 状态恢复
    s.resonance = Math.min(CFG.RESONANCE.max, s.resonance + dt * CFG.RESONANCE.regen);
    if (s.invuln > 0) s.invuln -= dt;
  }

  // ---------- 相机 ----------
  function updateCamera(dt) {
    var s = TG.state;
    var pos = group.position;
    camTarget.set(pos.x, pos.y + 1.55, pos.z);

    var dist = 7.2;
    var ox = Math.sin(s.yaw) * Math.cos(s.pitch) * dist;
    var oz = Math.cos(s.yaw) * Math.cos(s.pitch) * dist;
    var oy = Math.sin(s.pitch) * dist + 1.6;

    var desired = new THREE.Vector3(camTarget.x + ox, camTarget.y + oy, camTarget.z + oz);

    // TD-6：对碰撞盒做解析射线求交，命中则拉近（相机不穿墙）
    var dvec = desired.clone().sub(camTarget);
    var dlen = dvec.length();
    var dirv = dvec.normalize();
    var t = raycastBoxes(camTarget, dirv, dlen);
    if (t >= 0) {
      var d2 = Math.max(1.6, t - 0.7);
      desired = camTarget.clone().add(dirv.multiplyScalar(d2));
    }

    TG.camera.position.lerp(desired, Math.min(1, dt * 7));

    if (s.camShake > 0) {
      TG.camera.position.x += (Math.random() - 0.5) * s.camShake * 0.55;
      TG.camera.position.y += (Math.random() - 0.5) * s.camShake * 0.55;
      TG.camera.position.z += (Math.random() - 0.5) * s.camShake * 0.55;
      s.camShake = Math.max(0, s.camShake - dt * 2.4);
    }

    if (TG.camera.position.y < 0.9) TG.camera.position.y = 0.9;
    TG.camera.lookAt(camTarget);
  }

  return {
    build: build,
    update: update,
    updateCamera: updateCamera,
    setPose: setPose,
    raycastBoxes: raycastBoxes,
    group: function () { return group; }
  };
})();
