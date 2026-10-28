// Points of the placeholder point-cloud head, as a 3D shape. Pure function, tested.
// Replaced by Nickii's real head scan later (CLAUDE.md "3D mask route"). Units: the head is
// about 1 unit tall. Face looks along +z.

export interface HeadPoint {
  x: number; y: number; z: number;
  /** 0..1 brightness; the face side is brighter than the back. */
  a: number;
}

/** Deterministic pseudo-random numbers (so tests and renders are repeatable). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Radius of the head surface in direction (theta, phi): an egg with a narrower chin and a few face features. */
function surface(dir: { x: number; y: number; z: number }): { r: number; shade: number } {
  let r = 1;
  let shade = 1; // 1 = lit, lower inside dents (eye sockets, under the nose, mouth)
  // Egg: narrower towards the chin (y < 0), slightly flatter at the back.
  r *= 1 - 0.18 * Math.max(0, -dir.y) ** 1.5;
  r *= 1 - 0.05 * Math.max(0, -dir.z);
  const front = Math.max(0, dir.z);
  // Eye sockets: two dents left/right above the middle.
  for (const sx of [-0.33, 0.33]) {
    const d = Math.hypot(dir.x - sx, dir.y - 0.22, dir.z - 0.9);
    const dent = front * Math.exp(-(d * d) / 0.05);
    r -= 0.13 * dent;
    shade -= 0.75 * dent;
  }
  // Nose: a ridge down the middle.
  const nose = Math.exp(-((dir.x * dir.x) / 0.015 + ((dir.y + 0.02) ** 2) / 0.06)) * front;
  r += 0.14 * nose * Math.max(0, dir.z - 0.75) * 4;
  shade += 0.25 * nose * Math.max(0, dir.z - 0.75) * 4;
  // Mouth: a shallow horizontal dent.
  const mouth = Math.exp(-((dir.x * dir.x) / 0.08 + ((dir.y + 0.36) ** 2) / 0.006)) * front;
  r -= 0.06 * mouth;
  shade -= 0.6 * mouth;
  // Brows: a slight ridge above the eyes.
  const brow = Math.exp(-(((Math.abs(dir.x) - 0.33) ** 2) / 0.03 + ((dir.y - 0.4) ** 2) / 0.008)) * front;
  r += 0.03 * brow;
  shade += 0.15 * brow;
  return { r, shade: Math.max(0.1, Math.min(1.2, shade)) };
}

/**
 * About `n` points on the head surface, laid out along horizontal contour rings (like a scan), so the eye
 * sockets, nose and mouth show as bent lines. More points on the face than on the back.
 * Vertical size ≈ 1 (y from -0.5 to 0.5), width ≈ 0.72, depth ≈ 0.8, like the 2D placeholder (300×360).
 */
export function headPoints(n: number, seed = 7): HeadPoint[] {
  const rnd = seededRandom(seed);
  const rings = Math.max(8, Math.round(Math.sqrt(n) * 1.1));
  const out: HeadPoint[] = [];
  for (let i = 0; i < rings; i++) {
    const v = ((i + 0.5) / rings) * 2 - 1;            // -1..1 from chin to crown
    const u = Math.sin(v * Math.PI / 2);                // more rings near the middle than at the poles
    const s = Math.sqrt(1 - u * u);
    const around = Math.max(6, Math.round((n / rings) * 2.2 * s)); // longer rings get more points
    const offset = rnd() * Math.PI * 2;
    for (let k = 0; k < around; k++) {
      const t = offset + (k / around) * Math.PI * 2;
      const dir = { x: s * Math.cos(t), y: u, z: s * Math.sin(t) };
      const keep = 0.3 + 0.7 * (dir.z + 1) / 2;         // thin out the back
      if (rnd() > keep) continue;
      const { r, shade } = surface(dir);
      const jitter = 1 + (rnd() - 0.5) * 0.015;
      out.push({
        x: dir.x * r * 0.36 * jitter,
        y: dir.y * r * 0.5 * jitter,
        z: dir.z * r * 0.4 * jitter,
        a: Math.min(1, (0.3 + 0.7 * Math.max(0, dir.z) ** 0.8) * shade),
      });
    }
  }
  return out;
}
