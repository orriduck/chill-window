// 铅笔素描后处理（WebGL）
// 参考 Chartogne-Taillet 的做法：
// 1. Sobel 边缘检测画轮廓
// 2. 方向性排线（hatching）：暗部排线密、亮部留白，Perlin 噪声打散线条
// 3. 纸色/铅笔色双色调合成 + 纸张纹理 + 噪点 + 暗角

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tPaper;
uniform sampler2D tPerlin;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uPaperColor;
uniform vec3 uPencilColor;
uniform float uPencilStrength;
uniform float uPaperStrength;
uniform float uNoiseStrength;
uniform float uVignetteStrength;

float random2d(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// 排线：沿固定方向的平行线，Perlin 抖动，暗处出现
float hatch(vec2 uv, float darkness, float angle, float freq, float perlinAmt) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float p = texture2D(tPerlin, uv * 3.0).r - 0.5;
  float d = dot(uv * uResolution, vec2(-dir.y, dir.x)) / freq;
  d += p * perlinAmt;
  float line = abs(fract(d) - 0.5) * 2.0;
  // 线条宽度随暗度变化
  float w = clamp(darkness * 1.6, 0.0, 0.95);
  return smoothstep(1.0 - w, 1.0 - w + 0.25, line) * darkness;
}

void main() {
  vec2 uv = vUv;
  vec3 scene = texture2D(tScene, uv).rgb;
  float lum = luma(scene);
  float darkness = 1.0 - lum;

  // ---- Sobel 轮廓（只在明暗交界处勾线）----
  vec2 texel = 1.0 / uResolution;
  float t00 = luma(texture2D(tScene, uv + texel * vec2(-1.0, -1.0)).rgb);
  float t10 = luma(texture2D(tScene, uv + texel * vec2(0.0, -1.0)).rgb);
  float t20 = luma(texture2D(tScene, uv + texel * vec2(1.0, -1.0)).rgb);
  float t01 = luma(texture2D(tScene, uv + texel * vec2(-1.0, 0.0)).rgb);
  float t21 = luma(texture2D(tScene, uv + texel * vec2(1.0, 0.0)).rgb);
  float t02 = luma(texture2D(tScene, uv + texel * vec2(-1.0, 1.0)).rgb);
  float t12 = luma(texture2D(tScene, uv + texel * vec2(0.0, 1.0)).rgb);
  float t22 = luma(texture2D(tScene, uv + texel * vec2(1.0, 1.0)).rgb);
  float gx = -t00 - 2.0 * t01 - t02 + t20 + 2.0 * t21 + t22;
  float gy = -t00 - 2.0 * t10 - t20 + t02 + 2.0 * t12 + t22;
  float outline = smoothstep(0.16, 0.42, sqrt(gx * gx + gy * gy));

  // ---- 排线（语义化：亮部大量留白，暗部层层加线）----
  float perlinBreak = texture2D(tPerlin, uv * vec2(2.0, 2.6)).r;
  // 第一层：中暗部（远山、树荫）稀疏斜线
  float h1 = hatch(uv, smoothstep(0.52, 0.88, darkness), 0.55, 9.0, 1.6);
  // 第二层：深暗部（近景暗处、夜景）交叉线加密
  float h2 = hatch(uv, smoothstep(0.72, 0.97, darkness), -0.95, 7.5, 1.8);
  float strokes = (h1 + h2 * 0.8) * uPencilStrength;
  // Perlin 打散：笔触呈块状断续，更像手绘；亮部几乎不打断（保持留白干净）
  strokes *= smoothstep(0.08, 0.45, perlinBreak + darkness * 0.5);

  // ---- 合成 ----
  vec3 color = uPaperColor;
  color = mix(color, uPencilColor, clamp(strokes, 0.0, 1.0));
  color = mix(color, uPencilColor, outline * 0.85);

  // 极暗区域加深
  color = mix(color, uPencilColor * 0.55, smoothstep(0.88, 1.0, darkness) * 0.75);

  // 噪点
  color += (random2d(uv * 100.0 + mod(uTime, 100.0)) - 0.5) * uNoiseStrength;

  // 暗角
  float vig = distance(uv, vec2(0.5, 0.5)) * uVignetteStrength;
  vig = clamp(vig - 0.15, 0.0, 1.0);
  color = mix(color, uPencilColor, vig * 0.5);

  // 纸纹理
  float paper = texture2D(tPaper, uv * uResolution / 256.0).r;
  paper = paper * uPaperStrength + (1.0 - uPaperStrength);
  color *= paper;

  gl_FragColor = vec4(color, 1.0);
}
`;

export class PencilRenderer {
  private prog: WebGLProgram;
  private srcTex: WebGLTexture;
  private out: HTMLCanvasElement; // 离屏 GL 画布
  private gl: WebGLRenderingContext;
  ready = false;

  constructor() {
    this.out = document.createElement('canvas');
    const gl = this.out.getContext('webgl', { premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.srcTex = gl.createTexture()!;
    this.loadTextures();
  }

  private makeTex(unit: number, wrap: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  private loadTextures() {
    const gl = this.gl;
    const load = (url: string, unit: number, assign: (t: WebGLTexture) => void) => {
      const img = new Image();
      img.onload = () => {
        const t = this.makeTex(unit, gl.REPEAT);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        assign(t);
        this.ready = true;
      };
      img.src = url;
    };
    load(import.meta.env.BASE_URL + 'textures/paper.jpg', 1, () => {});
    load(import.meta.env.BASE_URL + 'textures/perlin.jpg', 2, () => {});
  }

  // 渲染到离屏 GL 画布，并把结果合成到目标 2D 画布
  render(source: HTMLCanvasElement, target: HTMLCanvasElement, opts: {
    paperColor: [number, number, number];
    pencilColor: [number, number, number];
    time: number;
    strength?: number;
  }) {
    const gl = this.gl;
    const w = source.width, h = source.height;
    if (this.out.width !== w || this.out.height !== h) {
      this.out.width = w; this.out.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);

    // unit0: 场景
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const U = (n: string) => gl.getUniformLocation(this.prog, n);
    gl.uniform1i(U('tScene'), 0);
    gl.uniform1i(U('tPaper'), 1);
    gl.uniform1i(U('tPerlin'), 2);
    gl.uniform2f(U('uResolution'), w, h);
    gl.uniform1f(U('uTime'), opts.time);
    gl.uniform3f(U('uPaperColor'), ...opts.paperColor);
    gl.uniform3f(U('uPencilColor'), ...opts.pencilColor);
    gl.uniform1f(U('uPencilStrength'), opts.strength ?? 0.85);
    gl.uniform1f(U('uPaperStrength'), 0.5);
    gl.uniform1f(U('uNoiseStrength'), 0.035);
    gl.uniform1f(U('uVignetteStrength'), 0.9);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 把 GL 结果画回目标 2D 画布
    const tctx = target.getContext('2d');
    if (tctx) {
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.drawImage(this.out, 0, 0);
    }
  }
}
