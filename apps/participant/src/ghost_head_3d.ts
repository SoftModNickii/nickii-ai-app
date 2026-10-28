// The floating point-cloud head as a real 3D object (Three.js): slowly turning, floating, flickering.
// Falls back to the flat SVG when WebGL is missing or the person prefers reduced motion.
// Three.js: https://threejs.org/docs/

import * as THREE from 'three';
import { headPoints } from './head_points';

const ACCENT = new THREE.Color('#B23E66');
const POINTS = 2600;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Head3D {
  el: HTMLCanvasElement;
  /** Dim and slow down (Nickii is away). */
  setAway(away: boolean): void;
  dispose(): void;
}

export function ghostHead3D(): Head3D {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const el = renderer.domElement;
  el.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 300 / 360, 0.1, 10);
  camera.position.set(0, 0.02, 2.4);

  const pts = headPoints(POINTS);
  const positions = new Float32Array(pts.length * 3);
  const colors = new Float32Array(pts.length * 3);
  const sizes = new Float32Array(pts.length);
  pts.forEach((p, i) => {
    positions.set([p.x, p.y, p.z], i * 3);
    colors.set([ACCENT.r, ACCENT.g, ACCENT.b], i * 3);
    sizes[i] = p.a;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('brightness', new THREE.BufferAttribute(sizes, 1));

  // Small round dots; brighter on the face side; fade with depth so the back stays quiet.
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0.9 }, uSize: { value: 2.2 * renderer.getPixelRatio() } },
    vertexShader: `
      attribute float brightness;
      varying float vA;
      uniform float uSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = brightness * clamp((mv.z + 2.9) / 0.9, 0.25, 1.0);
        gl_PointSize = uSize * (0.6 + 0.6 * brightness);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      uniform float uOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float edge = smoothstep(0.5, 0.3, d);
        gl_FragColor = vec4(${ACCENT.r.toFixed(3)}, ${ACCENT.g.toFixed(3)}, ${ACCENT.b.toFixed(3)}, vA * uOpacity * edge);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  let away = false;
  let frame = 0;
  let disposed = false;
  const start = performance.now();
  const still = reducedMotion();

  function resize() {
    const w = el.clientWidth || 300;
    const h = el.clientHeight || (w * 1.2);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(el);

  function render(now: number) {
    if (disposed) return;
    const t = (now - start) / 1000;
    const speed = away ? 0.5 : 1;
    if (!still) {
      points.rotation.y = Math.sin(t * 0.25 * speed) * 0.45;      // turns slowly left and right
      points.rotation.x = Math.sin(t * 0.17 * speed) * 0.08;
      points.position.y = Math.sin(t * 0.6 * speed) * 0.02;        // floats
      // Flicker: short random dips, like a weak signal.
      const flicker = Math.random() < 0.02 ? 0.55 : 1;
      material.uniforms.uOpacity!.value = (away ? 0.45 : 0.9) * flicker;
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  }
  resize();
  frame = requestAnimationFrame(render);

  // Save battery: stop drawing while the app is hidden.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') cancelAnimationFrame(frame);
    else frame = requestAnimationFrame(render);
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    el,
    setAway(v) { away = v; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
