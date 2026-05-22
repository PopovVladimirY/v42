import { useEffect, useRef } from 'react';

// WebGL2 / GLSL ES 3.00 -- universally supported since Safari 15 (2021).
const VERT_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Three bubble modes:
//   0 = normal   -- monochrome DeepDive accent rings, the meditative classic
//   1 = colorful -- same circles but each bubble has its own HSL hue cycling in time
//   2 = psycho   -- rotating squares with full rainbow palette, maximum chaos
const FRAG_SRC = `#version 300 es
precision mediump float;

uniform float u_time;
uniform vec2  u_res;
uniform float u_mode;   // 0 | 1 | 2

out vec4 fragColor;

// Compact HSL rainbow: h in [0,1] -> RGB
vec3 rainbow(float h) {
  return 0.55 + 0.45 * cos(6.28318 * (h + vec3(0.0, 0.333, 0.667)));
}

// Signed distance to an axis-aligned square of half-size s at origin
float sdBox(vec2 p, float s) {
  vec2 d = abs(p) - s;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Round soap-bubble ring with specular glint
float circleBubble(vec2 p, vec2 c, float r) {
  float d    = length(p - c);
  float ring = smoothstep(r + 0.0020, r, d) - smoothstep(r, r - 0.0040, d);
  float glow = smoothstep(r - 0.004, r * 0.5, d) * 0.12;
  float spec = smoothstep(r * 0.22, 0.0, length(p - (c + vec2(-r * 0.30, r * 0.38))));
  return clamp(ring * 0.70 + glow + spec, 0.0, 1.0);
}

// Square ring that rotates at angle rot -- psychedelic mode
float squareBubble(vec2 p, vec2 c, float r, float rot) {
  float s = sin(rot), co = cos(rot);
  vec2  d = p - c;
  d = vec2(co * d.x + s * d.y, -s * d.x + co * d.y);  // rotate into local frame
  float dist = sdBox(d, r * 0.65);
  float ring = smoothstep(0.0045, 0.0, abs(dist));
  float glow = smoothstep(r * 0.5, 0.0, max(dist, 0.0)) * 0.10;
  float spec = smoothstep(r * 0.22, 0.0, length(p - (c + vec2(-r * 0.30, r * 0.38))));
  return clamp(ring * 0.75 + glow + spec * 0.8, 0.0, 1.0);
}

void main() {
  vec2  uv  = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  vec2  p   = vec2(uv.x * asp, uv.y);  // aspect-corrected so circles stay round

  vec3  colSum   = vec3(0.0);
  float alphaSum = 0.0;

  // DeepDive accent #5b7cf6 = rgb(91/255, 124/255, 246/255)
  vec3 accent = vec3(0.357, 0.486, 0.965);

  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    // Pseudo-random bubble properties from irrational-constant hashing
    float r   = 0.010 + fract(fi * 0.27183) * 0.032;  // radius 10..42 px
    float sp  = 0.025 + fract(fi * 0.41421) * 0.050;  // rise speed
    float xb  = fract(fi * 0.13793) * asp;             // base x
    float ph  = fract(fi * 0.56234) * 6.28318;         // wobble phase

    float t    = fract(u_time * sp + fi * 0.04167);    // 0..1 lifecycle
    float y    = t;
    float x    = xb + sin(t * 12.56637 + ph) * 0.038 * asp;
    float fade = smoothstep(0.0, 0.10, t) * smoothstep(1.0, 0.88, t);
    vec2  c    = vec2(x, y);

    float contrib;
    if (u_mode > 1.5) {
      // Mode 2: rotating square -- each one spins at its own speed
      float rpm = (fract(fi * 0.71828) - 0.5) * 4.0;  // -2..+2 rad/s
      contrib = squareBubble(p, c, r, u_time * rpm + ph);
    } else {
      contrib = circleBubble(p, c, r);
    }
    contrib *= fade;

    // Color: monochrome accent (mode 0) or per-bubble HSL cycling (modes 1+2)
    vec3 bubbleCol = (u_mode > 0.5)
      ? rainbow(fi / 24.0 + u_time * 0.06 + t * 0.15)
      : accent;

    colSum   += bubbleCol * contrib;
    alphaSum += contrib;
  }

  alphaSum = clamp(alphaSum, 0.0, 1.0);
  // Weighted-average color across overlapping bubbles
  vec3 finalCol = (alphaSum > 0.001) ? colSum / max(alphaSum, 0.001) : accent;
  fragColor = vec4(finalCol, alphaSum * 0.88);
}
`;

function makeShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[BubbleCanvas] shader error:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

interface Props {
  active: boolean;
  /** 0 = classic blue  1 = colorful circles  2 = rotating psycho squares */
  mode?: 0 | 1 | 2;
}

export function BubbleCanvas({ active, mode = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  // modeRef lets the render loop read the latest mode without re-creating WebGL state
  const modeRef   = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // WebGL2 -- supported everywhere since Safari 15 (2021)
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
    if (!gl) {
      console.warn('[BubbleCanvas] WebGL2 not available -- easter egg disabled');
      return;
    }

    const vert = makeShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
    const frag = makeShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    // Full-screen quad (triangle strip: BL, BR, TL, TR)
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes  = gl.getUniformLocation(prog, 'u_res');
    const uMode = gl.getUniformLocation(prog, 'u_mode');

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const start = performance.now();

    const render = () => {
      const t = (performance.now() - start) / 1000;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uMode, modeRef.current);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      gl.deleteProgram(prog);
      gl.deleteBuffer(vbo);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        opacity: active ? 1 : 0,
        transition: 'opacity 2s ease',
        zIndex: 10,
      }}
    />
  );
}
