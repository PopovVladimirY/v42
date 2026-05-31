import { useEffect, useRef } from 'react';
import { useThemeStore, type Theme } from '@/stores/useTheme';

// Maps theme name to the integer sent as u_theme to the fragment shader.
const THEME_IDX: Record<Theme, number> = {
  'deep-dive':    0,
  'night-sky':    1,
  'new-york':     2,
  'classic-dark': 3,
  'ocean-blue':   4,
  'paper-white':  5,
  'sunrise':      6,
  'high-contrast':    7,
  'classic-light':    8,
  'gray-scale-light': 9,
};

// ── Vertex: full-screen quad, nothing fancy ──────────────────────────
const VERT_SRC = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// ── Fragment: 8 theme-specific ambient effects ────────────────────────
// UV convention: (0,0) = bottom-left, (1,1) = top-right of the canvas.
// Most effects rise from the bottom (uv.y = 0).
const FRAG_SRC = /* glsl */ `#version 300 es
precision mediump float;

uniform float u_time;
uniform vec2  u_res;     // canvas pixel dimensions (sidebar size)
uniform int   u_theme;   // 0-7

out vec4 fragColor;

// ──────────────────────────────── Utilities ───────────────────────────

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i),           hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.1; a *= 0.5; }
  return v;
}

// ──────────────────────────── DeepDive: soap bubbles ─────────────────
// 22 rings wobble up from the bottom. Classic diver exhale.
vec4 effect_deep_dive(vec2 uv, float asp, float t) {
  // Aspect-corrected space so circles are circles, not ovals.
  // asp = w/h ~ 0.23 for a narrow sidebar.
  vec2  p     = vec2(uv.x * asp, uv.y);
  float total = 0.0;
  vec3  colSum = vec3(0.0);
  // DeepDive accent: #5b7cf6
  vec3  accent = vec3(0.357, 0.486, 0.965);

  for (int i = 0; i < 22; i++) {
    float fi  = float(i);
    float r   = 0.008 + fract(fi * 0.27183) * 0.018; // radius in asp-space
    float sp  = 0.022 + fract(fi * 0.41421) * 0.040; // rise speed
    float xb  = fract(fi * 0.13793) * asp;            // base x position
    float ph  = fract(fi * 0.56234) * 6.28318;        // wobble phase
    float age = fract(t * sp + fi * 0.04545);         // 0..1 lifetime
    float y   = age;
    float x   = xb + sin(age * 10.0 + ph) * 0.025 * asp;
    float fade = smoothstep(0.0, 0.08, age) * smoothstep(1.0, 0.90, age);

    vec2  c    = vec2(x, y);
    float d    = length(p - c);
    // Thin ring + soft inner glow + specular highlight
    float ring = smoothstep(r + 0.0020, r, d) - smoothstep(r, r - 0.0030, d);
    float glow = smoothstep(r - 0.003, r * 0.50, d) * 0.12;
    float spec = smoothstep(r * 0.20, 0.0, length(p - (c + vec2(-r * 0.25, r * 0.35))));
    float contrib = clamp((ring * 0.70 + glow + spec * 0.45) * fade, 0.0, 1.0);
    colSum += accent * contrib;
    total  += contrib;
  }

  total = clamp(total, 0.0, 1.0);
  vec3 fc = (total > 0.001) ? colSum / max(total, 0.001) : accent;
  return vec4(fc, total * 0.88);
}

// ─────────────────────────── NightSky: aurora + stars ────────────────
// Twinkling stars throughout, three aurora ribbons in the upper portion.
vec4 effect_night_sky(vec2 uv, float t) {
  vec3  col   = vec3(0.0);
  float alpha = 0.0;

  // Stars: 55 tiny points, each with independent twinkle rhythm
  for (int i = 0; i < 55; i++) {
    float fi = float(i);
    vec2  pos = vec2(hash21(vec2(fi * 0.1373, 1.0)),
                     hash21(vec2(fi * 0.2511, 2.0)));
    float sz  = 0.0025 + fract(fi * 0.0731) * 0.0030;
    float tw  = 0.35 + 0.65 * sin(t * (1.5 + fract(fi * 0.1741) * 3.0) + fi * 4.17);
    float d   = length(uv - pos);
    float star = smoothstep(sz, 0.0, d) * tw;
    // Stars range from cool-white to slightly warm
    vec3  sc  = mix(vec3(0.80, 0.90, 1.00), vec3(1.00, 1.00, 0.80), fract(fi * 0.0873));
    col   += sc * star * 0.85;
    alpha += star * 0.70;
  }

  // Aurora: three undulating ribbons, each a different color
  for (int r = 0; r < 3; r++) {
    float fr    = float(r);
    float yBase = 0.58 + fr * 0.14;
    float warp  = sin(uv.x * 3.5 + t * (0.25 + fr * 0.11) + fr * 1.57) * 0.038
                + sin(uv.x * 8.1 - t * 0.17 + fr * 2.31) * 0.014;
    float dist   = abs(uv.y - yBase - warp);
    float ribbon = smoothstep(0.032, 0.0, dist);
    // Vary curtain density along x
    ribbon *= 0.30 + 0.70 * fbm(vec2(uv.x * 5.5 + fr * 3.7, t * 0.12 + fr));
    // Fade out near screen top / bottom boundary
    ribbon *= smoothstep(1.02, 0.65, uv.y) * smoothstep(0.38, 0.50, uv.y);

    // Green / Cyan / Violet
    vec3 aColor = (r == 0) ? vec3(0.10, 0.92, 0.45)  // emerald green
                : (r == 1) ? vec3(0.00, 0.76, 0.88)  // arctic cyan
                :             vec3(0.55, 0.14, 0.96); // deep violet
    col   += aColor * ribbon;
    alpha += ribbon * 0.82;
  }

  return vec4(col, clamp(alpha, 0.0, 1.0));
}

// ─────────────────────────── NewYork: steam from manholes ────────────
// Four heat sources at the bottom emit soft gaussian blobs that rise
// and curl via fbm turbulence.
vec4 effect_new_york(vec2 uv, float asp, float t) {
  float alpha = 0.0;

  for (int m = 0; m < 4; m++) {
    float fm   = float(m);
    // Four manhole positions across the sidebar width
    float srcX = (m == 0) ? 0.10
               : (m == 1) ? 0.32
               : (m == 2) ? 0.63
               :             0.85;
    // Small jitter per source so they look independent
    srcX += (hash21(vec2(fm, 99.0)) - 0.5) * 0.04;

    // Ten puffs per source, each at a different lifecycle phase
    for (int p = 0; p < 10; p++) {
      float fp    = float(p);
      float speed = 0.055 + fract(fm * 0.313 + fp * 0.173) * 0.055;
      float phase = fract(fp / 10.0 + fm * 0.25 + t * speed);
      float y     = phase * 0.70; // rise up to 70% of sidebar height

      // Turbulent horizontal drift
      float tx   = (fbm(vec2(srcX * 6.0 + fp + fm * 3.0,
                             phase * 5.0 + t * 0.25)) - 0.5) * 0.13;
      vec2  pPos = vec2(srcX + tx, y);

      // Blob grows as it rises (starts tight at source)
      float radius  = 0.018 + phase * 0.055;
      float fadeIn  = smoothstep(0.00, 0.08, phase);
      float fadeOut = smoothstep(0.70, 0.22, phase);
      vec2  diff    = uv - pPos;
      // Elliptical gaussian: slightly wider than tall
      float blob    = exp(-(diff.x * diff.x / (radius * radius)
                          + diff.y * diff.y / (radius * radius * 0.6)));
      alpha += blob * fadeIn * fadeOut * 0.52;
    }

    // Manhole hot-spot glow right at the bottom
    float d = length(uv - vec2(srcX, 0.0));
    alpha += smoothstep(0.06, 0.0, d) * 0.65;
  }

  vec3 steamCol = vec3(0.87, 0.87, 0.91); // off-white with a hint of cool grey
  return vec4(steamCol, clamp(alpha, 0.0, 0.92));
}

// ─────────────────────────── ClassicDark: CRT phosphor ───────────────
// Scan lines, film grain, and a slow glowing sweep line.
vec4 effect_classic_dark(vec2 uv, float t) {
  // Horizontal scan bands: wide ~16px stripes (0.3927 = pi/8 -> 16px period)
  float scan = 0.55 + 0.45 * sin(uv.y * u_res.y * 0.3927);

  // Film grain: hash of floor-quantised UV + 24-fps-quantised time
  vec2  grainUV = floor(uv * u_res * 0.5 + floor(t * 24.0) * vec2(1.3, 0.71));
  float grain   = hash21(grainUV);

  // Slow phosphor sweep line drifting upward
  float sweepY = fract(t * 0.055);
  float sweep  = smoothstep(0.010, 0.0, abs(uv.y - sweepY)) * 0.70;

  // Very mild flicker (nearly imperceptible -- ambiance, not annoyance)
  float flicker = 0.93 + 0.07 * sin(t * 43.7 + 1.9);

  float combined = (scan * 0.18 + grain * 0.14 + sweep) * flicker;
  vec3  phosphor = vec3(0.28, 0.52, 0.22); // classic green phosphor
  return vec4(phosphor, clamp(combined * 0.85, 0.0, 1.0));
}

// ─────────────────────────── OceanBlue: surf at the base ─────────────
// A multi-frequency wave crest at the bottom with foam and rising droplets.
vec4 effect_ocean_blue(vec2 uv, float t) {
  float alpha = 0.0;
  vec3  foam  = vec3(1.0, 1.0, 1.0);

  // Wave crest: raised to mid-lower sidebar, layered sine + fbm
  float wave = 0.18
    + sin(uv.x * 9.1 + t * 1.30) * 0.022
    + sin(uv.x * 3.7 - t * 0.85) * 0.035
    + sin(uv.x * 17.3 + t * 2.10) * 0.009
    + (fbm(vec2(uv.x * 4.2, t * 0.5)) - 0.5) * 0.018;

  // Foam band at the wave crest
  float wDist = abs(uv.y - wave);
  float crest = smoothstep(0.020, 0.0, wDist)
              * (0.30 + vnoise(vec2(uv.x * 9.0, t * 2.8)) * 0.55);

  // Thin solid fill just below the wave
  float below = smoothstep(wave - 0.004, wave - 0.016, uv.y) * 0.18;
  alpha += crest + below;

  // No rising droplets here: Ocean Blue is a clean surf crest, not a
  // bubble bath. (Those bubbles wandered in from DeepDive -- shooed out.)

  return vec4(foam, clamp(alpha, 0.0, 0.78));
}

// ─────────────────────────── PaperWhite: ink tendrils ────────────────
// FBM isoline contours create slowly-spreading ink patterns.
// Works as dark ink on the light sidebar background.
vec4 effect_paper_white(vec2 uv, float t) {
  float slowT = t * 0.022; // slow but perceptible drift
  float ink   = 0.0;

  // Two layers of fbm contour lines at slightly different thresholds
  float d1 = fbm(vec2(uv.x * 3.2 + slowT, uv.y * 4.5 - slowT * 0.4));
  ink += smoothstep(0.036, 0.0, abs(d1 - 0.520));

  float d2 = fbm(vec2(uv.x * 5.1 - slowT * 1.3, uv.y * 3.0 + slowT * 0.8));
  ink += smoothstep(0.026, 0.0, abs(d2 - 0.475)) * 0.75;

  // Third thinner layer for fine detail
  float d3 = fbm(vec2(uv.x * 8.0 + slowT * 0.5, uv.y * 6.5 - slowT * 0.3));
  ink += smoothstep(0.018, 0.0, abs(d3 - 0.510)) * 0.50;

  // Tendrils are most dense at the bottom, fading toward the top
  ink *= smoothstep(0.85, 0.05, uv.y);
  ink  = clamp(ink, 0.0, 1.0);

  vec3 inkCol = vec3(0.07, 0.09, 0.15); // dark blue-black ink
  return vec4(inkCol, ink * 0.55);
}

// ─────────────────────────── Sunrise: dawn glow ──────────────────────
// Warm radiant gradient from the bottom + fbm light rays.
vec4 effect_sunrise(vec2 uv, float t) {
  float pulse = 0.78 + 0.22 * sin(t * 0.55);

  // Colour gradient: deep orange at base → warm gold → blush pink near top
  vec3 orange = vec3(1.00, 0.48, 0.08);
  vec3 gold   = vec3(1.00, 0.82, 0.32);
  vec3 blush  = vec3(1.00, 0.62, 0.68);
  float t1    = clamp(uv.y * 1.8, 0.0, 1.0);
  float t2    = clamp(uv.y * 2.5, 0.0, 1.0);
  vec3  grad  = mix(orange, mix(gold, blush, t2), t1);

  // Radial glow: strongest at bottom, decays upward
  float glow = smoothstep(0.70, 0.0, uv.y) * pulse;

  // Light rays: multi-layer fbm angular pattern, brighter and denser
  vec2  src  = vec2(0.5, -0.06);
  float ang  = atan(uv.x - src.x, uv.y - src.y + 0.001);
  float dist = length(uv - src);
  float rays  = fbm(vec2(ang * 3.0 + t * 0.040, dist * 1.6)) * 0.38;
  float rays2 = fbm(vec2(ang * 5.5 - t * 0.025, dist * 2.5)) * 0.22;
  float allRays = (rays + rays2) * smoothstep(0.85, 0.0, uv.y);

  float alpha = clamp(glow * 0.52 + allRays, 0.0, 0.70);
  return vec4(grad, alpha);
}

// ─────────────────────────── HighContrast: digital rain ──────────────
// Sparse Matrix-style character columns: bright head, fading green trail.
vec4 effect_high_contrast(vec2 uv, float t) {
  float numCols = 11.0;
  float colIdx  = floor(uv.x * numCols);
  float colFrac = fract(uv.x * numCols); // position within column [0,1]

  float ph    = hash11(colIdx);
  float speed = 0.045 + ph * 0.07; // 2x slower than before

  // Head falls from top (uv.y=1) to bottom (uv.y=0)
  float headY    = 1.0 - fract(t * speed + ph);
  float trailLen = 0.13 + hash11(colIdx + 7.7) * 0.09;

  float dy = uv.y - headY; // +ve = above head (already visited = trail)

  // Bright head at dy≈0, fading trail for dy > 0
  float headGlow = smoothstep(0.007, 0.0, abs(dy));
  float trailGlow = step(0.004, dy) * smoothstep(trailLen, 0.0, dy) * 0.50;
  // Character cell grid: brightens at cell centres to suggest glyphs
  float cellFrac  = fract(uv.y * 24.0);
  float charPulse = 0.55 + 0.45 * smoothstep(0.18, 0.0, abs(cellFrac - 0.5));
  trailGlow *= charPulse;

  // Subtle column edge darkening (makes columns feel distinct)
  float edgeFade = 0.55 + 0.45 * smoothstep(0.50, 0.08, abs(colFrac - 0.5));
  float intensity = clamp((headGlow + trailGlow) * edgeFade, 0.0, 1.0);

  vec3 rainCol = vec3(0.12, 1.00, 0.38); // classic matrix green
  return vec4(rainCol, intensity * 0.88);
}

// ───────────── Classic Light: notebook ruled lines drifting up ───────
// Pale blue horizontal lines scroll upward, red margin line on the left.
// Very subtle -- like staring at a legal pad for too long.
vec4 effect_classic_light(vec2 uv, float t) {
  float speed  = 0.014;
  float period = 0.038;

  // Primary ruled lines
  float phase  = fract((uv.y + t * speed) / period);
  float line   = smoothstep(0.90, 1.0, phase) + smoothstep(0.10, 0.0, phase);

  // Secondary offset lines (half opacity, slower drift)
  float phase2 = fract((uv.y + 0.5 * period + t * speed * 0.65) / period);
  float line2  = (smoothstep(0.90, 1.0, phase2) + smoothstep(0.10, 0.0, phase2)) * 0.35;

  // Horizontal fade: soft vignette at edges
  float hfade = smoothstep(0.0, 0.10, uv.x) * smoothstep(1.0, 0.90, uv.x);
  float lineAlpha = max(line, line2) * hfade * 0.11;

  // Red margin line that breathes -- oscillates between 0.06 and 0.26 opacity
  float pulse      = 0.06 + 0.20 * (0.5 + 0.5 * sin(t * 0.75));
  // Also drifts slightly left/right so it's never stuck in one spot
  float shift      = 0.013 * sin(t * 0.38);
  float marginDist = abs(uv.x - 0.15 - shift);
  float margin     = smoothstep(0.007, 0.002, marginDist) * pulse;

  vec3 marginCol = vec3(0.82, 0.18, 0.18);
  vec3 lineCol   = vec3(0.13, 0.53, 0.85);

  float marginMask = smoothstep(0.015, 0.003, marginDist);
  vec3  col  = mix(lineCol, marginCol, marginMask);
  float alpha= max(lineAlpha, margin);
  return vec4(col, alpha);
}

// ───────────── Gray Scale Light: single incense-stick smoke strand ──────────
// One narrow tendril rises from a fixed tip near the bottom.
// Axis drifts with two-layer noise: a slow primary sway + fast fine wiggles.
// Every ~11s a tilted-disc ring puffs out and rises (smoke ring from the side).
vec4 effect_gray_scale_light(vec2 uv, float t) {
  float s = t * 0.45;
  float h = uv.y;  // 0=bottom 1=top

  // ─── Tendril: two-layer wiggle ───
  float fh     = h * 0.60 + s * 0.22;
  // Slow, wide sway (primary curve)
  float drift  = fbm(vec2(fh,          s * 0.15)) * 2.0 - 1.0;
  // Faster, smaller wiggles layered on top
  float drift2 = fbm(vec2(fh * 2.4 + 4.3, s * 0.38)) * 2.0 - 1.0;
  float turb   = smoothstep(0.05, 0.80, h);
  float axisX  = 0.46 + (drift * 0.22 + drift2 * 0.09) * turb;

  // Thin strand: ~3px at base, ~9px at top (240px wide sidebar)
  float spread = 0.013 + h * 0.023;
  float ddx    = (uv.x - axisX) / spread;
  float column = exp(-ddx * ddx * 4.0);

  // Density: rises from base, fades near top
  float dens = smoothstep(0.0, 0.04, h) * smoothstep(1.0, 0.65, h);

  // Puffs: density varies along the strand, scrolls upward
  float puff  = 0.60 + 0.40 * vnoise(vec2(h * 3.0 + s * 1.2, 0.5));
  float smoke = column * dens * puff;

  // ─── Ring: tilted disc (smoke ring viewed from slight angle) ───
  // Ellipse: 1:3 height-to-width ratio. Independent trajectory. Blurry gaussian.
  float phi   = fract(s * 0.20);              // 0->1 lifetime
  float ry    = 0.04 + phi * 0.90;            // rises from near-base to near-top
  float rx    = 0.016 + phi * 0.080;          // horizontal expand
  float asp_s = u_res.x / u_res.y;            // sidebar aspect ratio (<1, narrow)
  float tilt  = asp_s / 3.0;                  // 1:3 in physical pixels
  float rfade = smoothstep(0.0, 0.06, phi) * (1.0 - phi);
  float thick = 0.012 + phi * 0.012;          // thicker = blurrier / smokier

  // Independent ring trajectory -- different fbm seeds from the tendril
  float rh     = ry * 0.55 + s * 0.18;
  float rdrift = fbm(vec2(rh + 7.5,          s * 0.11 + 2.3)) * 2.0 - 1.0;
  float rdrift2= fbm(vec2(rh * 1.9 + 11.7,  s * 0.29 + 5.1)) * 2.0 - 1.0;
  float rturb  = smoothstep(0.05, 0.80, ry);
  float ringX  = 0.46 + (rdrift * 0.20 + rdrift2 * 0.10) * rturb;

  // Ellipse distance: squashed 1:3 ring with soft gaussian blur
  float ex    = (uv.x - ringX) / rx;
  float ey    = (uv.y - ry)    / (rx * tilt);
  float er    = sqrt(ex * ex + ey * ey);
  float rdist = abs(er - 1.0) * rx;
  float ring  = exp(-(rdist / thick) * (rdist / thick)) * rfade * 0.65;

  vec3 col = vec3(0.28, 0.28, 0.34); // cool blue-gray
  return vec4(col, clamp(smoke + ring, 0.0, 1.0) * 0.60);
}

// ─────────────────────────── Dispatch ────────────────────────────────
void main() {
  vec2  uv  = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y; // <1 for tall narrow sidebar

  vec4 result;
  if      (u_theme == 0) result = effect_deep_dive(uv, asp, u_time);
  else if (u_theme == 1) result = effect_night_sky(uv, u_time);
  else if (u_theme == 2) result = effect_new_york(uv, asp, u_time);
  else if (u_theme == 3) result = effect_classic_dark(uv, u_time);
  else if (u_theme == 4) result = effect_ocean_blue(uv, u_time);
  else if (u_theme == 5) result = effect_paper_white(uv, u_time);
  else if (u_theme == 6) result = effect_sunrise(uv, u_time);
  else if (u_theme == 7) result = effect_high_contrast(uv, u_time);
  else if (u_theme == 8) result = effect_classic_light(uv, u_time);
  else                   result = effect_gray_scale_light(uv, u_time);

  fragColor = result;
}
`;

// ── WebGL helpers ─────────────────────────────────────────────────────
function makeShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[SidebarAmbient] shader compile error:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

// ── Component ─────────────────────────────────────────────────────────
interface Props {
  /** Fades in the overlay when true (user is idle). */
  isIdle: boolean;
}

export function SidebarAmbient({ isIdle }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const themeRef    = useRef<number>(0); // current theme idx, read by render loop
  const theme       = useThemeStore((s) => s.theme);

  // Keep themeRef in sync so the render loop picks it up without recreating GL state
  themeRef.current = THEME_IDX[theme];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) {
      console.warn('[SidebarAmbient] WebGL2 unavailable -- ambient art disabled');
      return;
    }

    // ── Build shader program ──────────────────────────────────────────
    const vert = makeShader(gl, gl.VERTEX_SHADER,   VERT_SRC);
    const frag = makeShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[SidebarAmbient] program link error:', gl.getProgramInfoLog(prog));
      return;
    }

    // ── Full-screen quad (two triangles via TRIANGLE_STRIP) ───────────
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);

    const uTime  = gl.getUniformLocation(prog, 'u_time');
    const uRes   = gl.getUniformLocation(prog, 'u_res');
    const uTheme = gl.getUniformLocation(prog, 'u_theme');

    // ── Canvas sizing via ResizeObserver ──────────────────────────────
    const resize = () => {
      const w = canvas.clientWidth  * devicePixelRatio;
      const h = canvas.clientHeight * devicePixelRatio;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── Render loop ───────────────────────────────────────────────────
    const start = performance.now();
    const render = () => {
      const t = (performance.now() - start) / 1000;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1i(uTheme, themeRef.current);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteBuffer(vbo);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, []); // GL context created once; theme changes via themeRef

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:       'absolute',
        inset:          0,
        width:          '100%',
        height:         '100%',
        pointerEvents:  'none',
        opacity:        isIdle ? 1 : 0,
        transition:     isIdle ? 'opacity 3s ease' : 'opacity 1.5s ease',
        zIndex:         5,
      }}
    />
  );
}
