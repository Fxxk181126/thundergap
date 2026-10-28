// ============================================================
//  雷隙 THUNDERGAP — 局部平面反射（TG.createReflector，D2 / FR-03）
//  移植 three.js 官方 Reflector 核心数学：镜像相机 + 纹理投影矩阵
//  + 斜截视锥体（oblique projection，只保留镜面上方）。
//  仅渲染 reflectLayer 层对象（楼体 / 塔 / 主角 / 天空），512² RT；
//  相机距镜面超过 maxDist 时跳过渲染、复用上一帧。
// ============================================================
window.TG = window.TG || {};

TG.createReflector = function (geometry, opts) {
  opts = opts || {};

  var textureWidth = opts.textureWidth || 512;
  var textureHeight = opts.textureHeight || 512;
  var clipBias = opts.clipBias || 0.0003;
  var maxDist = opts.maxDist || 90;
  var layer = opts.layer || 1;

  var renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight);
  if (opts.renderer) renderTarget.texture.encoding = opts.renderer.outputEncoding;

  var virtualCamera = new THREE.PerspectiveCamera();
  virtualCamera.layers.set(layer);

  var uniforms = {
    color:         { value: new THREE.Color(opts.color !== undefined ? opts.color : 0x0a1424) },
    tDiffuse:      { value: renderTarget.texture },
    textureMatrix: { value: new THREE.Matrix4() },
    strength:      { value: opts.strength !== undefined ? opts.strength : 0.5 },
    uFlash:        TG.skyUniforms.uFlash,   // 与天空共享同一个闪电 uniform 对象
    uTime:         { value: 0 }
  };

  var material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: [
      'uniform mat4 textureMatrix;',
      'varying vec4 vUv;',
      'varying vec2 vLocal;',
      'varying vec3 vWorld;',
      'void main() {',
      '  vUv = textureMatrix * vec4( position, 1.0 );',
      '  vLocal = uv;',
      '  vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 color; uniform sampler2D tDiffuse;',
      'uniform float strength; uniform float uFlash; uniform float uTime;',
      'varying vec4 vUv; varying vec2 vLocal; varying vec3 vWorld;',
      'void main() {',
      // 细微波纹扰动投影坐标，让倒影有「积水被雨点打碎」的呼吸感
      '  vec2 duv = vUv.xy / vUv.w;',
      '  float w = sin( vWorld.x * 2.3 + uTime * 1.9 ) * cos( vWorld.z * 2.1 - uTime * 1.4 );',
      '  duv += w * 0.0022;',
      '  vec3 refl = texture2D( tDiffuse, duv ).rgb;',
      // 边缘径向渐隐，融进普通湿地地面
      '  float edge = 1.0 - smoothstep( 0.78, 1.0, length( vLocal - 0.5 ) * 2.0 );',
      '  vec3 c = mix( color, refl, strength * edge );',
      '  c += uFlash * vec3( 0.30, 0.38, 0.50 ) * edge;',
      '  gl_FragColor = vec4( c, edge * 0.96 );',
      '}'
    ].join('\n')
  });

  var mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld();

  // ---------- 刮擦变量 ----------
  var textureMatrix = uniforms.textureMatrix.value;
  var reflectorWorldPosition = new THREE.Vector3();
  var cameraWorldPosition = new THREE.Vector3();
  var rotationMatrix = new THREE.Matrix4();
  var normal = new THREE.Vector3();
  var view = new THREE.Vector3();
  var target = new THREE.Vector3();
  var lookAtPosition = new THREE.Vector3();
  var clipPlane = new THREE.Plane();
  var clipVector = new THREE.Vector4();
  var q = new THREE.Vector4();

  // 渲染镜像视图到 RT；返回 false 表示本帧跳过（相机在镜面下 / 距离过远）
  function update(renderer, camera, scene, timeSec) {
    uniforms.uTime.value = timeSec || 0;

    reflectorWorldPosition.setFromMatrixPosition(mesh.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

    rotationMatrix.extractRotation(mesh.matrixWorld);
    normal.set(0, 0, 1);
    normal.applyMatrix4(rotationMatrix);

    view.subVectors(reflectorWorldPosition, cameraWorldPosition);
    if (view.dot(normal) > 0) return false;                       // 相机在镜面下方
    if (cameraWorldPosition.distanceTo(reflectorWorldPosition) > maxDist) return false;

    // 镜像相机：位置与观察目标对镜面做反射（参照点必须是镜面自身位置）
    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    lookAtPosition.set(0, 0, -1);
    lookAtPosition.applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);

    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0);
    virtualCamera.up.applyMatrix4(rotationMatrix);
    virtualCamera.up.reflect(normal);
    virtualCamera.lookAt(target);
    virtualCamera.near = camera.near;
    virtualCamera.far = camera.far;
    virtualCamera.fov = camera.fov;
    virtualCamera.aspect = camera.aspect;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    // 纹理投影矩阵：[-1,1] → [0,1] × P × V × 世界
    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);
    textureMatrix.multiply(mesh.matrixWorld);

    // 斜截视锥体：把近平面压到镜面上，镜面下的东西不进反射
    clipPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    clipPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
    clipVector.set(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);

    var projectionMatrix = virtualCamera.projectionMatrix;
    q.x = (Math.sign(clipVector.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(clipVector.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
    clipVector.multiplyScalar(2.0 / clipVector.dot(q));
    projectionMatrix.elements[2] = clipVector.x;
    projectionMatrix.elements[6] = clipVector.y;
    projectionMatrix.elements[10] = clipVector.z + 1.0 + clipBias;
    projectionMatrix.elements[14] = clipVector.w;

    var prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, virtualCamera);
    renderer.setRenderTarget(prevTarget);
    return true;
  }

  return { mesh: mesh, update: update, renderTarget: renderTarget };
};
