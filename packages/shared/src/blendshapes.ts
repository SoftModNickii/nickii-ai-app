// The 52 face blendshape categories MediaPipe Face Landmarker outputs (ARKit-compatible names, plus `_neutral`).
// Order here = column order in the face dataset. Never reorder; only append.
// Source: MediaPipe Face Landmarker docs, https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
export const BLENDSHAPE_NAMES = [
  '_neutral',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight',
] as const;

export type BlendshapeName = (typeof BLENDSHAPE_NAMES)[number];

/** Column names of the 4x4 facial transformation matrix (head pose), row-major. */
export const MATRIX_COLUMNS = Array.from({ length: 16 }, (_, i) => `m${Math.floor(i / 4)}${i % 4}`);

/** Header of one face CSV chunk. */
export const FACE_CSV_HEADER = ['t_ms', 'face_present', ...BLENDSHAPE_NAMES, ...MATRIX_COLUMNS];
