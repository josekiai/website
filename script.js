const canvas = document.getElementById("motion-field");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const vertexShaderSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform vec2 u_pointer;
  uniform vec4 u_anchors[5];
  uniform float u_energy;
  uniform float u_time;
  varying vec2 v_uv;

  mat2 rotate2d(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 curve = local * local * (3.0 - 2.0 * local);

    float bottomLeft = hash21(cell);
    float bottomRight = hash21(cell + vec2(1.0, 0.0));
    float topLeft = hash21(cell + vec2(0.0, 1.0));
    float topRight = hash21(cell + vec2(1.0, 1.0));

    float bottom = mix(bottomLeft, bottomRight, curve.x);
    float top = mix(topLeft, topRight, curve.x);

    return mix(bottom, top, curve.y);
  }

  float fbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = rotate2d(0.58);

    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(point);
      point = turn * point * 2.04 + 17.13;
      amplitude *= 0.5;
    }

    return value;
  }

  float fbmLite(vec2 point) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = rotate2d(0.62);

    for (int i = 0; i < 3; i++) {
      value += amplitude * noise(point);
      point = turn * point * 2.12 + 9.71;
      amplitude *= 0.5;
    }

    return value;
  }

  float contour(float value, float width) {
    float line = abs(fract(value) - 0.5);
    return smoothstep(width, 0.0, line);
  }

  void main() {
    vec2 pixel = gl_FragCoord.xy;
    vec2 uv = (pixel * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
    vec2 screen = v_uv;
    float t = u_time;

    vec2 pointer = (u_pointer * 2.0 - 1.0);
    pointer.x *= u_resolution.x / u_resolution.y;
    pointer.y *= -1.0;

    vec2 lens = uv - pointer * 0.22;
    float distanceToLens = length(lens);
    float lensPull = exp(-distanceToLens * 1.85);
    float anchorField = 0.0;
    float anchorRings = 0.0;
    vec2 anchorDrift = vec2(0.0);

    for (int i = 0; i < 5; i++) {
      vec4 anchorData = u_anchors[i];
      vec2 anchor = anchorData.xy * 2.0 - 1.0;
      anchor.x *= u_resolution.x / u_resolution.y;
      anchor.y *= -1.0;

      float strength = anchorData.z;
      float seed = anchorData.w;
      vec2 delta = uv - anchor;
      float radius = length(delta * vec2(1.0, 0.82));
      float soft = exp(-radius * 1.42) * strength;
      float localTexture = fbmLite(delta * (2.2 + seed * 0.035) + vec2(seed));
      float localRing = contour(radius * (4.35 + seed * 0.08) - t * 0.075 + localTexture * 0.86, 0.044);

      anchorField += soft;
      anchorRings += localRing * soft;
      anchorDrift += normalize(delta + vec2(0.001, -0.001)) * soft * 0.032 * sin(t * 0.16 + seed);
    }

    vec2 flow = uv;
    flow += anchorDrift;
    flow += 0.18 * vec2(
      fbm(uv * 1.8 + vec2(t * 0.05, -t * 0.035)),
      fbm(uv * 1.8 + vec2(-t * 0.04, t * 0.052) + 8.0)
    );
    flow = rotate2d(0.08 * sin(t * 0.12)) * flow;

    float impact = smoothstep(0.0, 1.0, min(1.0, u_energy + anchorField * 0.34));
    float expansion = 1.0 + impact * 0.72;

    float lowField = fbm(flow * (1.28 - impact * 0.16) + vec2(t * 0.018, -t * 0.014));
    float highField = fbm(flow * (4.7 - impact * 0.62) - vec2(t * 0.045, t * 0.03));
    float folded = sin((flow.x * 1.8 - flow.y * 0.9 + lowField * (2.8 + impact * 1.9)) * (3.4 - impact * 0.52) + t * 0.34);

    float rings =
      contour(length(flow * vec2(1.04, 0.76)) * (4.8 / expansion) + lowField * (3.2 + impact * 2.8) - t * 0.12, 0.034 + impact * 0.012) *
      smoothstep(1.62, 0.1, length(uv));

    float interference =
      contour((flow.x * 2.0 + flow.y * 1.35 + highField * (1.5 + impact * 1.2) + t * 0.07), 0.025 + impact * 0.01) *
      smoothstep(1.7, 0.2, length(uv));

    float membrane = pow(max(0.0, folded), 5.0) * (0.52 + impact * 0.36);
    float lensRing = contour(distanceToLens * (8.0 / expansion) - t * 0.24 + highField * (0.7 + impact * 0.42), 0.04 + impact * 0.012) * lensPull;
    float edge = pow(1.0 - smoothstep(0.0, 1.9, length(uv)), 1.7);

    vec3 base = vec3(0.014, 0.017, 0.022);
    vec3 ink = vec3(0.034, 0.041, 0.052);
    vec3 teal = vec3(0.20, 0.86, 0.75);
    vec3 amber = vec3(0.95, 0.54, 0.28);
    vec3 rose = vec3(0.78, 0.22, 0.36);
    vec3 bone = vec3(0.93, 0.89, 0.80);

    vec3 color = mix(base, ink, edge + lowField * 0.55);
    color += teal * rings * (0.36 + impact * 0.2);
    color += mix(teal, amber, 0.42 + screen.x * 0.32) * anchorRings * 0.42;
    color += amber * interference * (0.28 + impact * 0.18);
    color += rose * membrane * (0.34 + impact * 0.18);
    color += mix(teal, amber, screen.x) * lensRing * (0.42 + impact * 0.28);
    color += bone * pow(lensPull, 2.4) * 0.055;

    float sheen = smoothstep(0.26, 0.92, lowField + highField * 0.4) * edge;
    color += vec3(0.055, 0.047, 0.037) * sheen;

    float grain = hash21(pixel + floor(t * 24.0)) - 0.5;
    color += grain * 0.035;

    float vignette = smoothstep(1.76, 0.28, length(uv));
    color *= 0.34 + vignette * 0.82;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const fallbackPalette = ["#040507", "#123b3a", "#5a2835", "#8a5430"];
const anchorCount = 5;
const anchorInterval = 4200;
const anchorUniformData = new Float32Array(anchorCount * 4);
let gl = null;
let program = null;
let uniforms = {};
let animationFrame = null;
let startTime = performance.now();
let pointer = { x: 0.54, y: 0.48 };
let targetPointer = { x: 0.54, y: 0.48 };
let pointerVelocity = { x: 0, y: 0 };
let motionEnergy = 0;
let targetEnergy = 0;
let anchors = Array.from({ length: anchorCount }, () => ({
  x: 0.54,
  y: 0.48,
  createdAt: -Infinity,
  seed: 1,
  strength: 0,
}));
let anchorCursor = 0;
let hasSpawnedAnchor = false;
let nextAnchorAt = 0;

function createShader(context, type, source) {
  const shader = context.createShader(type);
  context.shaderSource(shader, source);
  context.compileShader(shader);

  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    throw new Error(context.getShaderInfoLog(shader) || "Shader compile failed.");
  }

  return shader;
}

function createProgram(context) {
  const vertexShader = createShader(context, context.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(context, context.FRAGMENT_SHADER, fragmentShaderSource);
  const shaderProgram = context.createProgram();

  context.attachShader(shaderProgram, vertexShader);
  context.attachShader(shaderProgram, fragmentShader);
  context.linkProgram(shaderProgram);

  if (!context.getProgramParameter(shaderProgram, context.LINK_STATUS)) {
    throw new Error(context.getProgramInfoLog(shaderProgram) || "Program link failed.");
  }

  context.deleteShader(vertexShader);
  context.deleteShader(fragmentShader);

  return shaderProgram;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function spawnAnchor(now) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * 0.04;
  const anchor = anchors[anchorCursor];

  anchor.x = clamp(targetPointer.x + Math.cos(angle) * distance, 0.08, 0.92);
  anchor.y = clamp(targetPointer.y + Math.sin(angle) * distance, 0.08, 0.92);
  anchor.createdAt = now;
  anchor.seed = 1 + Math.random() * 11;
  anchor.strength = 0.7 + Math.random() * 0.16;

  anchorCursor = (anchorCursor + 1) % anchorCount;
  hasSpawnedAnchor = true;
}

function buildAnchorUniforms(now) {
  if (!hasSpawnedAnchor) {
    spawnAnchor(now - 1800);
    nextAnchorAt = now + anchorInterval;
  }

  if (!prefersReducedMotion.matches && now >= nextAnchorAt) {
    spawnAnchor(now);
    nextAnchorAt = now + anchorInterval + Math.random() * 900;
  }

  for (let index = 0; index < anchorCount; index += 1) {
    const anchor = anchors[index];
    const age = Math.max(0, (now - anchor.createdAt) / 1000);
    const fadeIn = 1 - Math.exp(-age * 0.72);
    const fadeOut = Math.exp(-age / 22);
    const strength = anchor.strength * fadeIn * fadeOut;
    const offset = index * 4;

    anchorUniformData[offset] = anchor.x;
    anchorUniformData[offset + 1] = anchor.y;
    anchorUniformData[offset + 2] = strength;
    anchorUniformData[offset + 3] = anchor.seed;
  }

  return anchorUniformData;
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(window.innerWidth * ratio);
  const height = Math.floor(window.innerHeight * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }

  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
}

function render(now) {
  resize();

  const pull = 0.00105;
  const drag = 0.978;
  pointerVelocity.x = pointerVelocity.x * drag + (targetPointer.x - pointer.x) * pull;
  pointerVelocity.y = pointerVelocity.y * drag + (targetPointer.y - pointer.y) * pull;
  pointer.x += pointerVelocity.x;
  pointer.y += pointerVelocity.y;
  targetEnergy *= 0.975;
  motionEnergy += (targetEnergy - motionEnergy) * 0.024;

  gl.useProgram(program);
  gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
  gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
  gl.uniform4fv(uniforms.anchors, buildAnchorUniforms(now));
  gl.uniform1f(uniforms.energy, motionEnergy);
  gl.uniform1f(uniforms.time, (now - startTime) * 0.001);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (!prefersReducedMotion.matches) {
    animationFrame = window.requestAnimationFrame(render);
  }
}

function renderFallback(now = performance.now()) {
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.style.background =
      "radial-gradient(circle at 52% 48%, #123b3a, #5a2835 38%, #040507 78%)";
    return;
  }

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const gradient = context.createRadialGradient(width * 0.52, height * 0.48, 0, width * 0.52, height * 0.48, Math.max(width, height));
  fallbackPalette.forEach((color, index) => {
    gradient.addColorStop(index / (fallbackPalette.length - 1), color);
  });
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = "screen";
  for (let i = 0; i < 18; i += 1) {
    context.beginPath();
    for (let x = -40; x <= width + 40; x += 18) {
      const y =
        height * 0.5 +
        Math.sin(x * 0.012 + now * 0.0004 + i) * 96 +
        Math.cos(x * 0.006 - now * 0.0003 + i * 0.7) * 42 +
        i * 18 - 160;
      if (x === -40) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = `rgba(244, 240, 232, ${0.025 + i * 0.004})`;
    context.lineWidth = 1.25;
    context.stroke();
  }

  if (!prefersReducedMotion.matches) {
    animationFrame = window.requestAnimationFrame(renderFallback);
  }
}

function start() {
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
  }

  try {
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      throw new Error("WebGL unavailable.");
    }

    program = createProgram(gl);
    uniforms = {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      pointer: gl.getUniformLocation(program, "u_pointer"),
      anchors: gl.getUniformLocation(program, "u_anchors[0]"),
      energy: gl.getUniformLocation(program, "u_energy"),
      time: gl.getUniformLocation(program, "u_time"),
    };

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);

    render(performance.now());
  } catch (error) {
    console.warn(error);
    renderFallback();
  }
}

window.addEventListener("resize", resize);
window.addEventListener("pointermove", (event) => {
  const nextX = event.clientX / window.innerWidth;
  const nextY = event.clientY / window.innerHeight;
  const movement = Math.hypot(nextX - targetPointer.x, nextY - targetPointer.y);

  targetEnergy = Math.min(0.7, targetEnergy + movement * 1.05);
  targetPointer.x = nextX;
  targetPointer.y = nextY;
});

prefersReducedMotion.addEventListener("change", start);
start();
