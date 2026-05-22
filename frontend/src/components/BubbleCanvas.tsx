import { useEffect, useRef } from 'react';

// Full-screen quad vertex shader -- nothing clever needed here.
const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Fragment shader: 24 procedural rising bubbles with ring + specular highlight.
// Pure math, no textures, no uniforms table -- just time and resolution.
const FRAG_SRC = `
precision mediump float;
uniform float u_time;
uniform vec2  u_res;

float bubble(vec2 p, vec2 c, float r) {
  float d    = length(p - c);
  // Thick ring -- visible even at small sizes
  float ring = smoothstep(r + 0.0020, r, d)
             - smoothstep(r, r - 0.0040, d);
  // Inner ambient glow (translucent interior)
  float glow = smoothstep(r - 0.004, r * 0.5, d) * 0.12;
  // Specular highlight -- upper-left (light from above-left)
  vec2  hl   = c + vec2(-r * 0.30, r * 0.38);
  float spec = smoothstep(r * 0.22, 0.0, length(p - hl));
  return clamp(ring * 0.70 + glow + spec * 1.0, 0.0, 1.0);
}

void main() {
  vec2  uv  = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  // Correct x for aspect ratio so bubbles are round, not elliptical
  vec2  p   = vec2(uv.x * asp, uv.y);
  float a   = 0.0;

  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    // Pseudo-random properties derived from index via irrational constants
    float r   = 0.010 + fract(fi * 0.27183) * 0.032;  // radius 10..42 px-ish
    float sp  = 0.025 + fract(fi * 0.41421) * 0.050;  // rise speed
    float xb  = fract(fi * 0.13793) * asp;             // base x position
    float ph  = fract(fi * 0.56234) * 6.28318;         // wobble phase

    // t in [0,1]: lifecycle of one bubble (loops via fract)
    float t    = fract(u_time * sp + fi * 0.04167);
    float y    = t;
    // Horizontal wobble: 2 full oscillations per rise (4*pi period)
    float x    = xb + sin(t * 12.56637 + ph) * 0.038 * asp;
    // Fade in at bottom, fade out before reaching top
    float fade = smoothstep(0.0, 0.10, t) * smoothstep(1.0, 0.88, t);

    a += bubble(p, vec2(x, y), r) * fade;
  }

  a = clamp(a, 0.0, 1.0);
  // DeepDive accent #5b7cf6 = rgb(91, 124, 246)
  gl_FragColor = vec4(0.357, 0.486, 0.965, a * 0.88);
}
`;

function makeShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Log and continue gracefully -- bubbles are optional
    console.warn('[BubbleCanvas] shader error:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

interface Props {
  active: boolean;
}

// Renders a full-screen WebGL canvas with rising bubbles.
// Always running (trivial GPU cost), CSS opacity driven by `active` prop.
export function BubbleCanvas({ active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) {
      console.warn('[BubbleCanvas] WebGL not available -- easter egg disabled');
      return;
    }

    // Compile & link
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

    // Alpha blending for translucent bubbles
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Cache uniform locations
    gl.useProgram(prog);
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes  = gl.getUniformLocation(prog, 'u_res');

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
