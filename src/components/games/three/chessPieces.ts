// LANX 2.16.0: a Staunton-style chess set, turned on a lathe (and a carved
// knight's head), sized for squares one unit wide.

import * as THREE from "three";
import { merge, sharedGeo } from "./kit";

const lathe = (pts: number[][]) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 40);
const BASE = [
  [0, 0],
  [0.36, 0],
  [0.375, 0.03],
  [0.36, 0.075],
  [0.3, 0.095],
  [0.29, 0.13],
];

function pawn() {
  return lathe([...BASE, [0.22, 0.15], [0.17, 0.2], [0.13, 0.36], [0.12, 0.42], [0.2, 0.45], [0.2, 0.48], [0.11, 0.5], [0.15, 0.55], [0.17, 0.61], [0.16, 0.67], [0.12, 0.71], [0.06, 0.735], [0, 0.74]]);
}

function rook() {
  const body = lathe([...BASE, [0.24, 0.16], [0.21, 0.22], [0.2, 0.58], [0.24, 0.62], [0.27, 0.65], [0.27, 0.75], [0.17, 0.75], [0.17, 0.72], [0, 0.72]]);
  const parts: THREE.BufferGeometry[] = [body];
  for (let k = 0; k < 4; k++) {
    const m = new THREE.BoxGeometry(0.15, 0.12, 0.1);
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    m.rotateY(-a);
    m.translate(Math.cos(a) * 0.225, 0.8, Math.sin(a) * 0.225);
    parts.push(m);
  }
  return merge(parts);
}

function knight() {
  const base = lathe([...BASE, [0.25, 0.16], [0.24, 0.2], [0, 0.2]]);
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [-0.2, 0.16],
    [-0.23, 0.42],
    [-0.17, 0.62],
    [-0.08, 0.8],
    [-0.04, 0.95],
    [0.02, 0.86],
    [0.07, 0.9],
    [0.1, 0.8],
    [0.21, 0.7],
    [0.31, 0.56],
    [0.3, 0.48],
    [0.2, 0.46],
    [0.09, 0.5],
    [0.07, 0.42],
    [0.14, 0.3],
    [0.17, 0.16],
  ];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 3, curveSegments: 6 });
  head.translate(0, 0, -0.1);
  // Face along −Z (towards the far side of the board for white).
  head.rotateY(Math.PI / 2);
  return merge([base, head]);
}

function bishop() {
  const body = lathe([...BASE, [0.23, 0.16], [0.17, 0.24], [0.13, 0.5], [0.12, 0.56], [0.2, 0.59], [0.2, 0.62], [0.11, 0.64], [0.15, 0.7], [0.17, 0.78], [0.15, 0.86], [0.1, 0.92], [0.05, 0.95], [0, 0.955]]);
  const knob = new THREE.SphereGeometry(0.045, 16, 10);
  knob.translate(0, 0.99, 0);
  return merge([body, knob]);
}

function queen() {
  const body = lathe([[0, 0], [0.38, 0], [0.395, 0.03], [0.38, 0.075], [0.32, 0.1], [0.31, 0.135], [0.25, 0.16], [0.18, 0.25], [0.13, 0.62], [0.12, 0.68], [0.22, 0.71], [0.22, 0.74], [0.13, 0.76], [0.17, 0.86], [0.21, 0.98], [0.18, 1.0], [0.12, 0.99], [0.08, 1.02], [0, 1.03]]);
  const parts: THREE.BufferGeometry[] = [body];
  for (let k = 0; k < 8; k++) {
    const b = new THREE.SphereGeometry(0.042, 12, 8);
    const a = (k / 8) * Math.PI * 2;
    b.translate(Math.cos(a) * 0.19, 1.0, Math.sin(a) * 0.19);
    parts.push(b);
  }
  const top = new THREE.SphereGeometry(0.065, 16, 10);
  top.translate(0, 1.09, 0);
  parts.push(top);
  return merge(parts);
}

function king() {
  const body = lathe([[0, 0], [0.38, 0], [0.395, 0.03], [0.38, 0.075], [0.32, 0.1], [0.31, 0.135], [0.25, 0.16], [0.18, 0.26], [0.14, 0.68], [0.13, 0.74], [0.23, 0.77], [0.23, 0.8], [0.14, 0.82], [0.18, 0.94], [0.2, 1.05], [0.12, 1.08], [0, 1.09]]);
  const v = new THREE.BoxGeometry(0.07, 0.24, 0.07);
  v.translate(0, 1.2, 0);
  const h = new THREE.BoxGeometry(0.19, 0.065, 0.07);
  h.translate(0, 1.23, 0);
  return merge([body, v, h]);
}

const MAKERS: Record<string, () => THREE.BufferGeometry> = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };

/** The shape of a chess piece ("p", "r", "n", "b", "q", "k"). */
export const pieceGeometry = (type: string) => sharedGeo(`chess:${type}`, () => (MAKERS[type] ?? pawn)());

export const ivory = () => new THREE.MeshPhysicalMaterial({ color: 0xf1ebdd, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2 });
export const ebony = () => new THREE.MeshPhysicalMaterial({ color: 0x26272c, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 });
