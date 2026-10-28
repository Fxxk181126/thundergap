// ============================================================
//  雷隙 THUNDERGAP — 世界构建层（TG.world）
//  天空 / 灯光 / 地面 / 程序化城市 / 广播塔 / GPU 雨幕 / 涟漪 / 碎片
//  TD-1：楼体与街道标线合批（逐三角形按法线拆面 → 2 次 Draw Call）
//  全部随机数来自 TG.rng（可播种，TD-4）。
// ============================================================
window.TG = window.TG || {};

TG.world = (function () {
  'use strict';

  var CFG = TG.config;
  var CITY = CFG.CITY;

  var skyUniforms, lightningLight, ambient, hemi, pulseLight;
  var towerBeacon;
  var rain, rippleMesh;

  // ---------- 合批器：把若干几何体拼成一个 BufferGeometry ----------
  function MergedBuilder() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.v = 0; }
  MergedBuilder.prototype.addGeo = function (geo) {
    var p = geo.attributes.position.array, n = geo.attributes.normal.array, u = geo.attributes.uv.array;
    var ix = geo.index.array, i;
    for (i = 0; i < p.length; i++) this.pos.push(p[i]);
    for (i = 0; i < n.length; i++) this.nrm.push(n[i]);
    for (i = 0; i < u.length; i++) this.uv.push(u[i]);
    for (i = 0; i < ix.length; i++) this.idx.push(ix[i] + this.v);
    this.v += p.length / 3;
  };
  // 按三角形法线拆进两个桶：|ny|>0.5 视为顶/底面（屋顶），其余为立面
  MergedBuilder.prototype.addBoxSplit = function (geo, facade, roof) {
    var p = geo.attributes.position.array, n = geo.attributes.normal.array, u = geo.attributes.uv.array;
    var ix = geo.index.array, t, k, c, vi, bucket;
    for (t = 0; t < ix.length; t += 3) {
      bucket = Math.abs(n[ix[t] * 3 + 1]) > 0.5 ? roof : facade;
      for (k = 0; k < 3; k++) {
        vi = ix[t + k];
        for (c = 0; c < 3; c++) bucket.pos.push(p[vi * 3 + c]);
        for (c = 0; c < 3; c++) bucket.nrm.push(n[vi * 3 + c]);
        for (c = 0; c < 2; c++) bucket.uv.push(u[vi * 2 + c]);
        bucket.idx.push(bucket.v++);
      }
    }
  };
  MergedBuilder.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  };

  // ---------- 天空穹顶 ----------
  function buildSky() {
    var scene = TG.scene;
    var geo = new THREE.SphereGeometry(500, 32, 20);
    skyUniforms = {
      uFlash:   { value: 0 },
      uTop:     { value: new THREE.Color(0x04060d) },
      uMid:     { value: new THREE.Color(0x14203a) },
      uHorizon: { value: new THREE.Color(0x2a3350) }
    };
    var mat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform float uFlash; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; varying vec3 vP;' +
        'void main(){' +
        '  float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);' +
        '  vec3 c = mix(uHorizon, uMid, smoothstep(0.42, 0.62, h));' +
        '  c = mix(c, uTop, smoothstep(0.6, 0.95, h));' +
        '  c += uFlash * vec3(0.55, 0.68, 0.85) * (0.35 + 0.65 * h);' +
        '  gl_FragColor = vec4(c, 1.0);' +
        '}'
    });
    var sky = new THREE.Mesh(geo, mat);
    scene.add(sky);
    TG.sky = sky;
    TG.skyUniforms = skyUniforms;
  }

  // ---------- 灯光 ----------
  function buildLights() {
    var scene = TG.scene;
    ambient = new THREE.AmbientLight(0x2a3a55, 0.55);
    scene.add(ambient);

    hemi = new THREE.HemisphereLight(0x3b4d70, 0x05070f, 0.5);
    scene.add(hemi);

    lightningLight = new THREE.DirectionalLight(0xcfe6ff, 0);
    lightningLight.position.set(-40, 90, 20);
    scene.add(lightningLight);

    pulseLight = new THREE.PointLight(0x7fe9ff, 0, 60, 1.6);
    pulseLight.position.set(0, 3, 0);
    scene.add(pulseLight);

    TG.lights = { ambient: ambient, hemi: hemi, lightning: lightningLight, pulse: pulseLight };
  }

  // ---------- 地面（湿沥青 + 积水 + 合批标线） ----------
  function buildGround() {
    var scene = TG.scene;
    var wet = new THREE.MeshStandardMaterial({
      color: 0x080c15, roughness: 0.24, metalness: 0.92
    });
    var g = new THREE.Mesh(new THREE.PlaneGeometry(CITY * 2.4, CITY * 2.4), wet);
    g.rotation.x = -Math.PI / 2;
    scene.add(g);

    // 积水潭：更亮的镜面（保留独立 Mesh，D2 反射改造的挂点）
    var poolMat = new THREE.MeshStandardMaterial({
      color: 0x0a1220, roughness: 0.05, metalness: 1.0
    });
    for (var i = 0; i < 26; i++) {
      var r = 3 + TG.rng.next() * 9;
      var pool = new THREE.Mesh(new THREE.CircleGeometry(r, 24), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set((TG.rng.next() - 0.5) * CITY * 1.5, 0.012 + i * 0.0004, (TG.rng.next() - 0.5) * CITY * 1.5);
      pool.scale.y = 1 + TG.rng.next() * 0.7;
      scene.add(pool);
    }

    // 街道标线：18 块面板合成 1 个 Mesh（TD-1）
    var lineMat = new THREE.MeshBasicMaterial({ color: 0x1d2b3d, transparent: true, opacity: 0.5 });
    var lines = new MergedBuilder();
    for (var k = -4; k <= 4; k++) {
      var seg = new THREE.PlaneGeometry(CITY * 1.6, 0.5);
      seg.rotateX(-Math.PI / 2); seg.translate(0, 0.02, k * 22);
      lines.addGeo(seg);
      var seg2 = new THREE.PlaneGeometry(0.5, CITY * 1.6);
      seg2.rotateX(-Math.PI / 2); seg2.translate(k * 22, 0.02, 0);
      lines.addGeo(seg2);
    }
    scene.add(new THREE.Mesh(lines.build(), lineMat));
  }

  // ---------- 窗格纹理 ----------
  function makeWindowTexture() {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
    for (var y = 5; y < 124; y += 11) {
      for (var x = 5; x < 60; x += 13) {
        var on = TG.rng.next() < 0.42;
        if (on) {
          var t = TG.rng.next();
          g.fillStyle = t < 0.25 ? '#ffd9a8' : (t < 0.7 ? '#fff4d8' : '#cfe4ff');
        } else {
          g.fillStyle = '#080c14';
        }
        g.fillRect(x, y, 8, 7);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function scaleBoxUV(geo, w, h, d) {
    var uv = geo.attributes.uv;
    // BoxGeometry 面顺序：+X, -X, +Y, -Y, +Z, -Z，每面 4 个顶点
    var faceIdx = [
      [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11],
      [12, 13, 14, 15], [16, 17, 18, 19], [20, 21, 22, 23]
    ];
    var reps = [
      [d / 3.2, h / 3.4], [d / 3.2, h / 3.4], [1, 1],
      [1, 1], [w / 3.2, h / 3.4], [w / 3.2, h / 3.4]
    ];
    for (var f = 0; f < 6; f++) {
      var idx = faceIdx[f];
      var rx = reps[f][0], ry = reps[f][1];
      for (var i = 0; i < idx.length; i++) {
        uv.setXY(idx[i], uv.getX(idx[i]) * rx, uv.getY(idx[i]) * ry);
      }
    }
    // 屋顶不显示窗格
    for (var t = 8; t < 16; t++) uv.setXY(t, 0, 0);
    uv.needsUpdate = true;
  }

  // ---------- 城市：程序化街区（TD-1 合批：全城 2 次 Draw Call） ----------
  function buildCity() {
    var scene = TG.scene;
    var winTex = makeWindowTexture();
    var facade = new THREE.MeshStandardMaterial({
      color: 0x121826, roughness: 0.72, metalness: 0.22,
      emissive: 0xffc98a, emissiveMap: winTex, emissiveIntensity: 0.85
    });
    var roofMat = new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.9, metalness: 0.3 });
    var beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4433 });

    var facadeB = new MergedBuilder(), roofB = new MergedBuilder();
    var beaconGeo = new THREE.SphereGeometry(0.28, 8, 8);

    var step = 24;
    var half = (CITY / 2) | 0;
    var count = 0;
    for (var x = -half; x <= half; x += step) {
      for (var z = -half; z <= half; z += step) {
        if (Math.abs(x) < 18 && Math.abs(z) < 18) continue;      // 中央广场（广播塔）
        if (Math.abs(x) > half - 26 && Math.abs(z) > half - 26) continue;
        if (TG.rng.chance(0.16)) continue;                        // 空地

        var w = 9 + TG.rng.next() * 6;
        var d = 9 + TG.rng.next() * 6;
        var h = 10 + Math.pow(TG.rng.next(), 1.7) * 58;
        var px = x + (TG.rng.next() - 0.5) * 3;
        var pz = z + (TG.rng.next() - 0.5) * 3;

        var geo = new THREE.BoxGeometry(w, h, d);
        scaleBoxUV(geo, w, h, d);
        geo.translate(px, h / 2, pz);
        facadeB.addBoxSplit(geo, facadeB, roofB);
        count++;

        TG.boxes.push({
          minX: px - w / 2, maxX: px + w / 2,
          minZ: pz - d / 2, maxZ: pz + d / 2,
          h: h
        });

        // 屋顶航空警示灯
        if (h > 40 && TG.rng.chance(0.7)) {
          var beacon = new THREE.Mesh(beaconGeo, beaconMat);
          beacon.position.set(px, h + 0.4, pz);
          beacon.userData.phase = TG.rng.next() * 6.28;
          scene.add(beacon);
          TG.skyBolts.push(beacon);
        }
      }
    }

    var facadeMesh = new THREE.Mesh(facadeB.build(), facade);
    var roofMesh = new THREE.Mesh(roofB.build(), roofMat);
    scene.add(facadeMesh);
    scene.add(roofMesh);
    TG.facadeMesh = facadeMesh;
    TG.roofMesh = roofMesh;
    TG.worldStats = { buildings: count, beacons: TG.skyBolts.length };
  }

  // ---------- 广播塔（终点） ----------
  var towerPos = new THREE.Vector3(0, 0, 0);
  function buildTower() {
    var scene = TG.scene;
    var g = new THREE.Group();

    var legMat = new THREE.MeshStandardMaterial({ color: 0x1a2333, roughness: 0.55, metalness: 0.85 });
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2 + Math.PI / 4;
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 46, 6), legMat);
      leg.position.set(Math.cos(a) * 2.2, 23, Math.sin(a) * 2.2);
      leg.rotation.z = Math.cos(a) * 0.045;
      leg.rotation.x = -Math.sin(a) * 0.045;
      g.add(leg);
    }
    for (var r = 0; r < 7; r++) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(2.3 - r * 0.08, 0.09, 5, 4), legMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 4 + r * 6.4;
      g.add(ring);
    }

    var spire = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.34, 18, 6), legMat);
    spire.position.y = 55;
    g.add(spire);

    towerBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff4433 })
    );
    towerBeacon.position.y = 64.5;
    g.add(towerBeacon);

    // 塔顶红色导航光柱（雾夜地标）
    var navBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.6, 130, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff3222, transparent: true, opacity: 0.09,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    navBeam.position.y = 70;
    g.add(navBeam);

    // 塔基平台（终点触发区）
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(7.2, 8, 1.2, 20),
      new THREE.MeshStandardMaterial({ color: 0x141c2a, roughness: 0.4, metalness: 0.7 })
    );
    base.position.y = 0.6;
    g.add(base);

    var gate = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 6.4, 0.12, 24),
      new THREE.MeshBasicMaterial({ color: 0x2b3a4d, transparent: true, opacity: 0.85 })
    );
    gate.position.y = 1.24;
    gate.name = 'gate';
    g.add(gate);

    scene.add(g);
    TG.towerGroup = g;
    TG.towerPos = towerPos;
    TG.towerBeacon = towerBeacon;
    TG.boxes.push({ minX: -5.6, maxX: 5.6, minZ: -5.6, maxZ: 5.6, h: 2 });  // 塔基不可穿越（走到边缘触发）
  }

  // ---------- 雨（GPU 驱动线段） ----------
  function buildRain() {
    var scene = TG.scene;
    var COUNT = CFG.RAIN.count;
    var AREA = CFG.RAIN.area, HEIGHT = CFG.RAIN.height;
    var pos = new Float32Array(COUNT * 2 * 3);
    var seed = new Float32Array(COUNT * 2 * 3);
    var spd = new Float32Array(COUNT * 2);
    var end = new Float32Array(COUNT * 2);

    for (var i = 0; i < COUNT; i++) {
      var sx = (TG.rng.next() - 0.5) * AREA;
      var sy = TG.rng.next() * HEIGHT;
      var sz = (TG.rng.next() - 0.5) * AREA;
      var s = 17 + TG.rng.next() * 13;
      for (var k = 0; k < 2; k++) {
        var j = i * 2 + k;
        seed[j * 3] = sx; seed[j * 3 + 1] = sy; seed[j * 3 + 2] = sz;
        spd[j] = s;
        end[j] = k;               // 0 = 雨滴头，1 = 拖尾
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));

    var mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:  { value: 0 },
        uCam:   { value: new THREE.Vector3() },
        uArea:  { value: AREA },
        uHeight:{ value: HEIGHT },
        uBright:{ value: 0.5 },
        uWind:  { value: new THREE.Vector2(3.2, 1.1) }
      },
      vertexShader: [
        'attribute vec3 aSeed; attribute float aSpeed; attribute float aEnd;',
        'uniform float uTime; uniform vec3 uCam; uniform float uArea; uniform float uHeight; uniform vec2 uWind;',
        'varying float vA;',
        'void main(){',
        '  vec3 p = aSeed;',
        '  float fall = mod(aSeed.y - uTime * aSpeed, uHeight);',
        '  p.y = fall;',
        '  p.x += uWind.x * (uHeight - fall) * 0.06;',
        '  p.z += uWind.y * (uHeight - fall) * 0.06;',
        '  p.y -= aEnd * (0.55 + aSpeed * 0.035);',
        '  vec3 rel = p - uCam;',
        '  rel.x = mod(rel.x + uArea * 0.5, uArea) - uArea * 0.5;',
        '  rel.z = mod(rel.z + uArea * 0.5, uArea) - uArea * 0.5;',
        '  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  vA = 1.0 - aEnd * 0.9;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uBright; varying float vA;',
        'void main(){',
        '  vec3 c = mix(vec3(0.42,0.62,0.86), vec3(0.86,0.95,1.0), uBright);',
        '  gl_FragColor = vec4(c, vA * (0.20 + uBright * 0.30));',
        '}'
      ].join('\n')
    });

    rain = new THREE.LineSegments(geo, mat);
    rain.frustumCulled = false;
    scene.add(rain);
    TG.rain = rain;
  }

  // ---------- 地面涟漪 ----------
  function buildRipples() {
    var scene = TG.scene;
    var COUNT = CFG.RIPPLE.count;
    var geo = new THREE.RingGeometry(0.10, 0.17, 14);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    rippleMesh = new THREE.InstancedMesh(geo, mat, COUNT);
    rippleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    rippleMesh.frustumCulled = false;
    scene.add(rippleMesh);

    var dummy = new THREE.Object3D();
    for (var i = 0; i < COUNT; i++) {
      TG.ripples.push({
        x: (TG.rng.next() - 0.5) * 60, z: (TG.rng.next() - 0.5) * 60,
        life: TG.rng.next() * 1.2, dur: 0.5 + TG.rng.next() * 0.7,
        active: TG.rng.chance(0.5)
      });
      dummy.position.set(0, -999, 0);
      dummy.updateMatrix();
      rippleMesh.setMatrixAt(i, dummy.matrix);
    }
    TG.rippleMesh = rippleMesh;
  }

  // ---------- 碎片布点 ----------
  // 把碎片挪到不会被楼体挡死的空地上（向日葵螺旋搜索）
  function freeSpot(x, z) {
    var boxes = TG.boxes;
    for (var r = 0; r < 60; r++) {
      var a = r * 2.399, rad = r * 1.7;
      var nx = x + Math.cos(a) * rad, nz = z + Math.sin(a) * rad;
      if (Math.abs(nx) < 13 && Math.abs(nz) < 13) continue;
      if (Math.abs(nx) > CITY * 0.62 || Math.abs(nz) > CITY * 0.62) continue;
      var ok = true;
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (nx + 2.4 > b.minX && nx - 2.4 < b.maxX && nz + 2.4 > b.minZ && nz - 2.4 < b.maxZ) { ok = false; break; }
      }
      if (ok) return [nx, nz];
    }
    return [x, z];
  }

  function buildFragments() {
    var scene = TG.scene;
    var spots = [
      [ 46,  40], [-52,  34], [ 60, -22], [-38, -56],
      [ 22, -70], [-66,  -8], [ 12,  58], [-18,  66]
    ];
    for (var i = 0; i < spots.length; i++) {
      var sp = freeSpot(spots[i][0], spots[i][1]);
      var g = new THREE.Group();
      g.position.set(sp[0], 1.5, sp[1]);

      var core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.34, 0),
        new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.9 })
      );
      g.add(core);

      var cage = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.56, 0),
        new THREE.MeshBasicMaterial({ color: 0x7fe9ff, wireframe: true, transparent: true, opacity: 0.35 })
      );
      g.add(cage);

      // 指引光柱
      var beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.22, 26, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x7fe9ff, transparent: true, opacity: 0.10,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        })
      );
      beam.position.y = 12;
      g.add(beam);

      var light = new THREE.PointLight(0x7fe9ff, 0.0, 16, 2);
      g.add(light);

      scene.add(g);
      var frag = { obj: g, core: core, cage: cage, beam: beam, light: light, lit: 0, taken: false, phase: TG.rng.next() * 6.28, hum: null };
      TG.fragments.push(frag);
    }
  }

  // 音频就绪后为碎片挂上空间嗡鸣（D5）
  function attachHums() {
    for (var i = 0; i < TG.fragments.length; i++) {
      var f = TG.fragments[i];
      f.hum = TG.audio.hum(f.obj.position);
    }
  }

  // ---------- 塔前主广场真实反射（D2 / FR-03） ----------
  // 局部平面反射：仅 512² RT + 反射层对象入镜；外围积水潭保留高光近似。
  function buildPlazaReflection() {
    var scene = TG.scene;
    var L = 1; // 反射层：镜像相机只渲染该层

    var geo = new THREE.CircleGeometry(15, 48);
    // 注意：旋转必须挂在 mesh 上（Reflector 从 matrixWorld 提取法线），不能烘进几何体
    var refl = TG.createReflector(geo, {
      renderer: TG.renderer,
      textureWidth: 512, textureHeight: 512,
      color: 0x0a1424, strength: 0.62, maxDist: 110
    });
    // 放在出生点 → 塔的主通道上：不被塔基平台遮挡，接近全程可见
    refl.mesh.position.set(0, 0.035, 24);
    refl.mesh.rotation.x = -Math.PI / 2;
    refl.mesh.updateMatrixWorld();
    scene.add(refl.mesh);
    TG.reflector = refl;

    // 入镜名单：天空 / 楼体 / 塔 / 屋顶信标 / 相关灯光（雨、涟漪、碎片留在外层）
    [TG.sky, TG.facadeMesh, TG.roofMesh, TG.towerGroup].forEach(function (o) {
      if (o) o.traverse(function (c) { c.layers.enable(L); });
    });
    TG.skyBolts.forEach(function (b) { b.layers.enable(L); });
    [TG.lights.ambient, TG.lights.hemi, TG.lights.lightning, TG.lights.pulse].forEach(function (l) {
      l.layers.enable(L);
    });
  }

  function buildAll() {
    buildSky();
    buildLights();
    buildGround();
    buildCity();
    buildTower();
    buildRain();
    buildRipples();
    buildFragments();
    buildPlazaReflection();
  }

  return {
    buildAll: buildAll,
    buildCity: buildCity,
    buildFragments: buildFragments,
    freeSpot: freeSpot,
    attachHums: attachHums,
    buildPlazaReflection: buildPlazaReflection
  };
})();
