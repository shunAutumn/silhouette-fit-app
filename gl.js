/* シルエット試着 gl: WebGL2 の描画（素材の質感・ライト・ドラッグで回転） */
(function (G) {
  'use strict';

  const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in vec4 aAux;
uniform mat4 uProj; uniform mat4 uView; uniform float uYaw; uniform float uLift;
out vec3 vObj; out vec3 vObjN; out vec3 vW; out vec3 vN; out vec2 vUv; out vec4 vAux;
void main(){
  float c = cos(uYaw), s = sin(uYaw);
  vec3 p = aPos, n = aNrm;
  vec3 wp = vec3(c*p.x + s*p.z, p.y + uLift, -s*p.x + c*p.z);
  vObj = p; vObjN = n; vW = wp; vN = vec3(c*n.x + s*n.z, n.y, -s*n.x + c*n.z);
  vUv = aUv; vAux = aAux;
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 vObj; in vec3 vObjN; in vec3 vW; in vec3 vN; in vec2 vUv; in vec4 vAux;
uniform vec3 uColor; uniform vec3 uCam; uniform int uMat; uniform float uFit; uniform float uHi;
uniform vec4 uCutA; uniform vec4 uCutB; uniform float uPlacket; uniform vec2 uLegY; uniform float uTint;
uniform sampler2D uTex; uniform float uPrint; uniform vec4 uPrintRect; uniform vec4 uPrintUV;
out vec4 o;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vn(p); p *= 2.03; a *= .5; } return s; }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  if (uCutA.x > .5) {
    vec3 p = vObj;
    if (uCutA.x < 1.5) {
      if (p.z > 0. && abs(p.x) < uCutA.w && p.y > uCutA.y - uCutA.z*(1. - abs(p.x)/uCutA.w)) discard;
    } else {
      if (p.y > uCutB.z && abs(p.x) > uCutB.y) discard;
      if (abs(p.x) < uCutB.x && p.y > (p.z > 0. ? uCutA.y - uCutA.z : uCutA.y - uCutB.w)) discard;
    }
  }
  vec2 uv = vUv;
  float aa = 1. - smoothstep(.015, .09, length(fwidth(uv)));
  vec3 alb = lin(uColor); float h = 0.; float spec = .04; float gloss = 8.; float sheen = 0.; float emit = 0.;
  if (uMat == 0) {
    h = fbm(vObj.xy*3.)*.04 + vn(vObj.yz*9.)*.02; spec = .16; gloss = 18.;
  } else if (uMat == 15) {
    float f = dot(normalize(vObjN), vec3(0., 0., 1.));
    alb = f > .975 ? vec3(.01) : f > .91 ? lin(vec3(.27, .17, .11))*(.7 + .5*vn(vObj.xy*30.)) : lin(vec3(.9, .88, .86));
    spec = .9; gloss = 80.;
  } else if (uMat == 16) {
    float st = fbm(vec2(vObj.x*3., vObj.y*.6 + vObj.z*3.));
    h = st*.5; alb *= .7 + .5*st; spec = .25; gloss = 30.; sheen = .3;
  } else if (uMat == 1) {
    float col = abs(fract(uv.x*3.2)-.5)*2.; float row = fract(uv.y*4.2);
    float stc = smoothstep(.15, .9, 1.-col)*(.6+.4*sin(row*6.283));
    float heather = fbm(uv*vec2(2.2, .9));
    h = stc*.35*aa + fbm(uv*.6)*.12; alb *= .95 + .1*mix(.5, heather, aa); spec = .02; gloss = 6.; sheen = .35;
  } else if (uMat == 2) {
    float tw = fract((uv.x + uv.y)*4.5);
    float line = smoothstep(0., .35, tw)*smoothstep(1., .65, tw);
    float slub = fbm(vec2(uv.x*1.6, uv.y*.5));
    float weft = vn(uv*40.);
    alb = mix(alb, lin(vec3(.86,.88,.92)), .06*weft*aa + .02*slub);
    alb *= .9 + .2*mix(.5, line, aa);
    float wr = clamp(vObjN.z + .25, 0., 1.)*(exp(-pow((vObj.y-uLegY.x)/13., 2.)) + .3*exp(-pow((vObj.y-uLegY.y)/9., 2.)));
    wr *= .6 + .4*fbm(uv*vec2(.25, .5));
    alb = mix(alb, mix(alb, lin(vec3(.62,.7,.82)), .4), clamp(wr*.35, 0., .22));
    h = line*.35*aa + slub*.015; spec = .03; gloss = 10.; sheen = .15;
  } else if (uMat == 3) {
    float r = .5+.5*sin(uv.x*6.283*2.6);
    h = r*.55*aa + fbm(uv)*.1; alb *= .93 + .1*mix(.5, r, aa); spec = .02; gloss = 6.; sheen = .3;
  } else if (uMat == 4) {
    float c = fbm(uv*3.5); float crk = smoothstep(.45, .5, vn(uv*9.));
    h = c*.3 - crk*.1*aa; alb *= .88 + .18*c; spec = .38; gloss = 42.;
  } else if (uMat == 5) {
    float a = .5+.5*sin(uv.x*6.283*9.), b = .5+.5*sin(uv.y*6.283*9.);
    float wv = mix(a, b, step(.5, fract(uv.x*4.5 + .5*step(.5, fract(uv.y*4.5)))));
    h = wv*.4*aa + fbm(uv*2.)*.2; alb *= .94 + .08*wv*aa; spec = .04; gloss = 8.;
  } else if (uMat == 6) {
    h = fbm(uv*1.2)*.2 + vn(uv*6.)*.08*aa; spec = .16; gloss = 22.; sheen = .12;
  } else if (uMat == 17) {
    float fz = fbm(uv*2.5); float pile = vn(uv*12.);
    h = fz*.35 + pile*.25*aa; alb *= .9 + .14*fz; spec = .0; gloss = 2.; sheen = .75;
  } else if (uMat == 7) {
    float col = fract(uv.x*1.1); float row = fract(uv.y*1.5 + abs(col-.5)*.9);
    float v = smoothstep(0., .5, row)*smoothstep(1., .5, row);
    h = v*.8*aa + fbm(uv*1.5)*.2; alb *= .88 + .18*mix(.5, v, aa); spec = .01; gloss = 4.; sheen = .6;
  } else if (uMat == 8) {
    h = vn(uv*4.)*.1; spec = .1; gloss = 16.;
  } else if (uMat == 9) {
    emit = 1.;
  } else if (uMat == 10) {
    float a = .5+.5*sin(uv.x*6.283*14.), b = .5+.5*sin(uv.y*6.283*14.);
    h = a*b*.25*aa + fbm(uv*1.5)*.12; alb *= .96 + .06*a*b*aa; spec = .08; gloss = 14.; sheen = .15;
  } else if (uMat == 11) {
    float tw = fract((uv.x + uv.y)*6.); float line = smoothstep(0., .4, tw)*smoothstep(1., .6, tw);
    h = line*.35*aa + fbm(uv*2.)*.12; alb *= .94 + .08*line*aa; spec = .04; gloss = 10.; sheen = .15;
  } else if (uMat == 12) {
    h = fbm(uv*8.)*.35*aa + fbm(uv*1.2)*.1; alb *= .92 + .12*mix(.5, fbm(uv*14.), aa); spec = .01; gloss = 4.; sheen = .5;
  } else if (uMat == 13) {
    float sl = fbm(vec2(uv.x*14., uv.y*1.2)); float s2 = fbm(vec2(uv.x*1.2, uv.y*14.));
    h = (sl + s2)*.25*aa; alb *= .92 + .14*mix(.25, sl*s2, aa); spec = .03; gloss = 8.;
  } else if (uMat == 14) {
    vec2 gg = fract(uv*3.); float hole = smoothstep(.22, .34, length(gg-.5));
    h = hole*.5*aa + .2; alb *= .78 + .26*mix(.7, hole, aa); spec = .1; gloss = 12.;
  }
  if (vAux.x > .5 && uMat != 9) {
    if (uMat == 2 || uMat == 4 || uMat == 11) { alb *= .9; h += .15; }
    else { float r = .5+.5*sin(uv.x*6.283*3.); h = r*.5*aa; alb *= .95 + .07*r; }
  }
  if (uPrint > .5) {
    float pu = (vObj.x - uPrintRect.x)/(uPrintRect.y - uPrintRect.x);
    float pv = (uPrintRect.z - vObj.y)/(uPrintRect.z - uPrintRect.w);
    if (pu > 0. && pu < 1. && pv > 0. && pv < 1.) {
      vec4 tx = texture(uTex, vec2(mix(uPrintUV.x, uPrintUV.y, pu), mix(uPrintUV.z, uPrintUV.w, pv)));
      float front = smoothstep(-.05, .45, normalize(vObjN).z);
      alb = mix(alb, lin(tx.rgb)*(.93 + .14*h), tx.a*front);
    }
  }
  if (uPlacket > .5 && vObj.z > 0. && vObjN.z > .2) {
    float ax = abs(vObj.x);
    if (ax < 1.7) { alb *= .95; float q = length(vec2(vObj.x, mod(vObj.y, 9.) - 4.5));
      if (q < .55) { alb = mix(alb, lin(vec3(.95,.94,.9)), .7); spec = .3; gloss = 30.; h += .3; } }
    if (abs(ax - 1.7) < .08) alb *= .82;
  }
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 dpx = dFdx(vW), dpy = dFdy(vW); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
  if (abs(det) > 1e-8) N = normalize(abs(det)*N - .09*sign(det)*(dhx*r1 + dhy*r2));
  vec3 V = normalize(uCam - vW);
  vec3 L1 = normalize(vec3(-.45, .75, .65)); vec3 L2 = normalize(vec3(.75, .25, .4)); vec3 L3 = normalize(vec3(.15, .45, -1.));
  float wrap = uMat == 0 ? .5 : .28;
  float d1 = max((dot(N, L1) + wrap)/(1. + wrap), 0.);
  float d2 = max((dot(N, L2) + wrap)/(1. + wrap), 0.);
  vec3 hemi = mix(vec3(.36, .34, .33), vec3(.92, .95, 1.), N.y*.5 + .5);
  float occ = .78 + .22*smoothstep(-.6, .5, N.y);
  vec3 col = alb*(hemi*.42*occ + vec3(1., .96, .9)*d1*.9 + vec3(.7, .8, 1.)*d2*.3);
  vec3 H1 = normalize(L1 + V);
  col += spec*pow(max(dot(N, H1), 0.), gloss)*vec3(1.)*.9;
  float fres = pow(1. - max(dot(N, V), 0.), 3.);
  col += sheen*fres*alb*.7 + fres*.06*vec3(.9, .95, 1.)*(1. - sheen);
  col += pow(max(dot(N, L3), 0.), 2.)*.12;
  if (uMat == 0) col += alb*vec3(.18, .05, .03)*(1. - d1)*d1*1.6;
  if (!gl_FrontFacing) col *= .55;
  if (uFit > .5) {
    float e = vAux.y;
    vec3 hc = e > 900. ? vec3(.62, .64, .68) : e < 0. ? vec3(.86, .24, .22) : e < 3. ? vec3(.95, .6, .18) : e < 12. ? vec3(.2, .72, .48) : e < 24. ? vec3(.28, .55, .95) : vec3(.6, .42, .9);
    col = mix(col, lin(hc)*(d1*.65 + .45), .7);
  }
  if (emit > .5) col = alb*(.55 + .55*d1) + uHi*.18;
  col = mix(col, vec3(dot(col, vec3(.3, .59, .11))), uTint);
  col = col/(1. + col*.15);
  o = vec4(pow(col, vec3(1./2.2)), 1.);
}`;

  const SVS = `#version 300 es
in vec2 aP; uniform mat4 uProj; uniform mat4 uView; uniform float uR; out vec2 vP;
void main(){ vP = aP; gl_Position = uProj*uView*vec4(aP.x*uR, 0.02, aP.y*uR*.6, 1.); }`;
  const SFS = `#version 300 es
precision highp float; in vec2 vP; uniform float uA; out vec4 o;
void main(){ float d = length(vP); float a = (1. - smoothstep(.15, 1., d))*uA; o = vec4(vec3(.08, .09, .12)*a, a); }`;

  function compile(gl, vs, fs) {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([t, src]) => {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  }

  function perspective(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2);
    return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
  }
  function lookAt(e, c) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const nrm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const z = nrm(sub(e, c)); const x = nrm(cr([0, 1, 0], z)); const y = cr(z, x);
    const d = (a) => -(a[0] * e[0] + a[1] * e[1] + a[2] * e[2]);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, d(x), d(y), d(z), 1]);
  }

  function create(canvas, opts) {
    opts = opts || {};
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
    if (!gl) return null;
    const prog = compile(gl, VS, FS);
    const sh = compile(gl, SVS, SFS);
    const quad = gl.createVertexArray();
    gl.bindVertexArray(quad);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const la = gl.getAttribLocation(sh.p, 'aP'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const view = { yaw: 0.35, vel: 0, zoom: 1, panY: 0, H: 165, lift: 0 };
    let items = []; let dirty = true; let raf = 0;
    const attrs = ['aPos', 'aNrm', 'aUv', 'aAux'].map((n) => gl.getAttribLocation(prog.p, n));

    function upload(mesh) {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const bufs = [];
      [[mesh.pos, 3], [mesh.nrm, 3], [mesh.uv, 2], [mesh.aux, 4]].forEach(([arr, n], i) => {
        const b = gl.createBuffer(); bufs.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(attrs[i]); gl.vertexAttribPointer(attrs[i], n, gl.FLOAT, false, 0, 0);
      });
      const ib = gl.createBuffer(); bufs.push(ib);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, bufs, count: mesh.idx.length };
    }
    // 服に貼る写真（dataURL ごとに 1 回だけ読み込む）
    const texCache = new Map();
    const blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    function texture(src) {
      if (texCache.has(src)) return texCache.get(src);
      const rec = { tex: null };
      texCache.set(src, rec);
      const im = new Image();
      im.onload = () => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        rec.tex = t; dirty = true; loop();
      };
      im.src = src;
      return rec;
    }
    function free(list) { list.forEach((it) => { gl.deleteVertexArray(it.g.vao); it.g.bufs.forEach((b) => gl.deleteBuffer(b)); }); }

    // list: [{ mesh, mat, color:[r,g,b], cut, placket, fit, hi, tint }]
    function setScene(list, sc) {
      free(items);
      items = list.map((it) => Object.assign({}, it, { g: upload(it.mesh) }));
      if (sc) Object.assign(view, sc);
      dirty = true; loop();
    }
    function update(fn) { items.forEach(fn); dirty = true; loop(); }

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)); const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return [w, h];
    }

    function draw() {
      const [w, h] = size();
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const asp = w / h; const fov = 0.5;
      const H = view.H + view.lift;
      const fitH = (H * (asp < 1 ? 0.66 : 0.58)) / Math.tan(fov / 2);
      const fitW = (H * 0.42) / (Math.tan(fov / 2) * asp);
      const dist = Math.max(fitH, fitW) / view.zoom;
      const ty = clamp(H * 0.5 + view.panY, H * 0.12, H * 0.95);
      const eye = [0, ty + dist * 0.06, dist];
      // 奥行きの範囲は人型のまわりだけに絞る（広いと体と服の 0.4cm の差を描き分けられず、肌が透ける）
      const proj = perspective(fov, asp, Math.max(5, dist - 160), dist + 160);
      const vw = lookAt(eye, [0, ty, 0]);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.useProgram(prog.p);
      const U = prog.u;
      gl.uniformMatrix4fv(U.uProj, false, proj); gl.uniformMatrix4fv(U.uView, false, vw);
      gl.uniform1f(U.uYaw, view.yaw); gl.uniform1f(U.uLift, view.lift); gl.uniform3fv(U.uCam, eye);
      gl.uniform2fv(U.uLegY, view.legY || [80, 45]);
      items.forEach((it) => {
        if (it.hidden) return;
        gl.uniform3fv(U.uColor, it.color); gl.uniform1i(U.uMat, it.mat);
        gl.uniform1f(U.uFit, it.fit ? 1 : 0); gl.uniform1f(U.uHi, it.hi || 0); gl.uniform1f(U.uTint, it.tint || 0);
        const c = it.cut || [0, 0, 0, 0, 0, 0, 0, 0];
        gl.uniform4fv(U.uCutA, c.slice(0, 4)); gl.uniform4fv(U.uCutB, c.slice(4, 8));
        gl.uniform1f(U.uPlacket, it.placket || 0);
        const pr = it.print && it.print.img && it.print.rect ? texture(it.print.img.src) : null;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pr && pr.tex ? pr.tex : blank);
        gl.uniform1i(U.uTex, 0);
        gl.uniform1f(U.uPrint, pr && pr.tex ? 1 : 0);
        if (pr && pr.tex) { gl.uniform4fv(U.uPrintRect, it.print.rect); gl.uniform4fv(U.uPrintUV, it.print.img.uv || [0, 1, 0, 1]); }
        gl.bindVertexArray(it.g.vao);
        gl.drawElements(gl.TRIANGLES, it.g.count, gl.UNSIGNED_INT, 0);
      });
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.useProgram(sh.p);
      gl.uniformMatrix4fv(sh.u.uProj, false, proj); gl.uniformMatrix4fv(sh.u.uView, false, vw);
      gl.uniform1f(sh.u.uR, view.H * 0.24); gl.uniform1f(sh.u.uA, 0.42);
      gl.bindVertexArray(quad); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true); gl.bindVertexArray(null);
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    function loop() {
      if (raf) return;
      raf = requestAnimationFrame(function tick() {
        raf = 0;
        if (!dragging && Math.abs(view.vel) > 0.0004) { view.yaw += view.vel; view.vel *= 0.94; dirty = true; }
        if (dirty) { dirty = false; draw(); if (opts.onView) opts.onView(view); }
        if (dirty || (!dragging && Math.abs(view.vel) > 0.0004)) loop();
      });
    }

    // 操作: 横ドラッグで回転（慣性つき）、縦ドラッグで上下、ホイール/ピンチで拡大
    let dragging = false; let last = null; let lastT = 0; const pts = new Map(); let pinch0 = 0; let zoom0 = 1;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = view.zoom; }
      dragging = true; last = [e.clientX, e.clientY]; lastT = performance.now(); view.vel = 0;
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch0 > 0) { view.zoom = clamp(zoom0 * (d / pinch0), 0.8, 4); dirty = true; loop(); }
        return;
      }
      const dx = e.clientX - last[0]; const dy = e.clientY - last[1];
      const now = performance.now(); const dt = Math.max(1, now - lastT);
      view.yaw += dx * 0.011;
      view.vel = (dx * 0.011) * Math.min(1, 16 / dt);
      const k = (view.H * 1.1) / (canvas.clientHeight * view.zoom);
      view.panY = clamp(view.panY + dy * k, -view.H * 0.4, view.H * 0.45);
      last = [e.clientX, e.clientY]; lastT = now; dirty = true; loop();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 0) { dragging = false; canvas.classList.remove('grabbing'); if (performance.now() - lastT > 80) view.vel = 0; loop(); }
      else { const v = [...pts.values()][0]; last = [v[0], v[1]]; }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0015), 0.8, 4); dirty = true; loop();
    }, { passive: false });
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') view.yaw -= 0.2; else if (e.key === 'ArrowRight') view.yaw += 0.2;
      else if (e.key === '+' || e.key === '=') view.zoom = clamp(view.zoom * 1.15, 0.8, 4);
      else if (e.key === '-') view.zoom = clamp(view.zoom / 1.15, 0.8, 4);
      else return;
      e.preventDefault(); dirty = true; loop();
    });
    if (window.ResizeObserver) new ResizeObserver(() => { dirty = true; loop(); }).observe(canvas);

    return {
      setScene, update, view,
      reset() { view.yaw = 0; view.vel = 0; view.zoom = 1; view.panY = 0; dirty = true; loop(); },
      spin(v) { view.vel = v; loop(); },
      focus(y, zoom) { view.panY = y - (view.H + view.lift) * 0.5; view.zoom = zoom || view.zoom; dirty = true; loop(); },
      redraw() { dirty = true; loop(); },
      snapshot(w, h) {
        draw();
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d');
        const s = Math.min(w / canvas.width, h / canvas.height) * 1.15;
        const dw = canvas.width * s; const dh = canvas.height * s;
        x.drawImage(canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return c.toDataURL('image/webp', 0.8);
      },
    };
  }

  G.SF3D = { create };
})(typeof globalThis !== 'undefined' ? globalThis : window);
