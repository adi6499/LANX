// LANX 2.16.0: the 3D card table every card game shares — a felt table with
// a wooden rim, real cards (a face, a back and an edge) that are dealt,
// played, drawn and turned over with a little arc, your hand fanned in front
// of you, the others' hands face down at their places, piles and tricks in
// the middle, and chips for the betting games. A game only says where each
// card is (and which of yours you may play); the table animates the rest.
// Other players' cards are only ever backs here: their faces never reach
// the scene until the rules show them.

import * as THREE from "three";
import { BoardScene, type PieceSpec } from "./boardScene";
import { FONT, canvasTexture, felt, labelMesh, mesh, roundRect, slab, wood } from "./kit";
import { cardText, isRed, rankOf, suitOf, SUIT_SYMBOL } from "../../../lib/games/cards.ts";

export const CW = 0.86;
export const CH = 1.2;
const TABLE_W = 12.4;
const TABLE_D = 8.6;
export const TOP = 0.32;

export interface CardSpot {
  key: string;
  /** The card's face (null = we only know its back). */
  card: string | null;
  faceUp: boolean;
  pos: THREE.Vector3;
  yaw?: number;
  /** Stood up towards you (your hand). */
  tilt?: number;
  /** Raised a little (selected, or in a meld). */
  lit?: boolean;
  /** Greyed out (you cannot play it now). */
  dim?: boolean;
  /** Where a new card comes from (the deck, a player's place). */
  from?: THREE.Vector3;
  onClick?: () => void;
}

export interface SeatSpot {
  name: string;
  colour: string;
  at: THREE.Vector3;
  active: boolean;
  /** A short line under the name ("12 cards", "bid 3"…). */
  note?: string;
}

export interface ChipStack {
  key: string;
  amount: number;
  pos: THREE.Vector3;
}

/** How a card's face is painted (standard cards by default; Ocho has its own). */
export type FacePainter = (card: string, ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export const paintStandard: FacePainter = (card, ctx, w, h) => {
  ctx.fillStyle = "#fdfdfb";
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,0.12)";
  ctx.lineWidth = 4;
  roundRect(ctx, 3, 3, w - 6, h - 6, 24);
  ctx.stroke();
  const red = isRed(card);
  ctx.fillStyle = red ? "#dc2626" : "#111827";
  const label = cardText(card);
  const sym = SUIT_SYMBOL[suitOf(card)] ?? "";
  ctx.font = `800 ${w * 0.2}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label.replace(sym, ""), w * 0.07, h * 0.04);
  ctx.font = `700 ${w * 0.17}px "Segoe UI Symbol", ${FONT}`;
  ctx.fillText(sym, w * 0.08, h * 0.04 + w * 0.21);
  ctx.save();
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  ctx.font = `800 ${w * 0.2}px ${FONT}`;
  ctx.fillText(label.replace(sym, ""), w * 0.07, h * 0.04);
  ctx.font = `700 ${w * 0.17}px "Segoe UI Symbol", ${FONT}`;
  ctx.fillText(sym, w * 0.08, h * 0.04 + w * 0.21);
  ctx.restore();
  const r = rankOf(card);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ("JQK".includes(r)) {
    ctx.strokeStyle = red ? "rgba(220,38,38,0.4)" : "rgba(17,24,39,0.35)";
    ctx.lineWidth = 5;
    roundRect(ctx, w * 0.22, h * 0.2, w * 0.56, h * 0.6, 14);
    ctx.stroke();
    ctx.font = `800 ${w * 0.38}px ${FONT}`;
    ctx.fillText(r, w / 2, h / 2 - h * 0.06);
    ctx.font = `700 ${w * 0.2}px "Segoe UI Symbol", ${FONT}`;
    ctx.fillText(sym, w / 2, h / 2 + h * 0.16);
  } else {
    ctx.font = `700 ${w * (r === "A" ? 0.5 : 0.36)}px "Segoe UI Symbol", ${FONT}`;
    ctx.fillText(sym, w / 2, h / 2 + 4);
  }
};

function paintBack(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#fdfdfb";
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fill();
  ctx.fillStyle = "#3730a3";
  roundRect(ctx, 14, 14, w - 28, h - 28, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 3;
  for (let k = -h; k < w + h; k += 18) {
    ctx.beginPath();
    ctx.moveTo(k, 14);
    ctx.lineTo(k + h, h - 14);
    ctx.moveTo(k + h, 14);
    ctx.lineTo(k, h - 14);
    ctx.stroke();
  }
  ctx.fillStyle = "#3730a3";
  ctx.fillRect(0, 0, 14, h);
  ctx.fillRect(w - 14, 0, 14, h);
  ctx.fillRect(0, 0, w, 14);
  ctx.fillRect(0, h - 14, w, 14);
  ctx.fillStyle = "#fdfdfb";
  ctx.fillRect(0, 0, 8, h);
  ctx.fillRect(w - 8, 0, 8, h);
  ctx.fillRect(0, 0, w, 8);
  ctx.fillRect(0, h - 8, w, 8);
}

const CHIP_COLOURS = [0xf8fafc, 0xdc2626, 0x2563eb, 0x16a34a, 0x111827];

export class CardTableScene extends BoardScene<null> {
  private faces = new Map<string, THREE.Texture>();
  private backTex: THREE.Texture | null = null;
  private seatGroup = new THREE.Group();
  private painter: FacePainter = paintStandard;
  private chipGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.045, 28);

  constructor(host: HTMLElement, colour = "#17603f") {
    super(host, { fov: 26 });
    this.top = TOP;
    makeTable(this.stage.scene, colour);
    this.stage.scene.add(this.seatGroup);
    this.chipGeo.userData.shared = false;
    this.stage.allowViewDrag("cards", 50, 30);
    this.stage.frame(new THREE.Box3(new THREE.Vector3(-TABLE_W / 2 - 0.4, 0, -TABLE_D / 2 - 0.4), new THREE.Vector3(TABLE_W / 2 + 0.4, 0.8, TABLE_D / 2 + 0.4)), [0, 2.4, 1], 1.02);
  }

  setPainter(p: FacePainter) {
    this.painter = p;
  }

  protected replay() {
    return null;
  }
  protected snap() {}
  protected async animateStep() {}

  private faceTex(card: string) {
    let t = this.faces.get(card);
    if (!t) {
      t = canvasTexture(256, 356, (ctx, w, h) => this.painter(card, ctx, w, h), this.stage.renderer);
      t.userData.shared = true;
      this.faces.set(card, t);
    }
    return t;
  }

  private cardMesh(spot: CardSpot): THREE.Object3D {
    this.backTex ??= (() => {
      const t = canvasTexture(256, 356, (ctx, w, h) => paintBack(ctx, w, h), this.stage.renderer);
      t.userData.shared = true;
      return t;
    })();
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);
    const edge = mesh(slab(CW, 0.012, CH, 0.06), new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.6 }));
    edge.position.y = -0.006;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), new THREE.MeshStandardMaterial({ map: spot.card ? this.faceTex(spot.card) : this.backTex, roughness: 0.45, alphaTest: 0.5 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.0065;
    face.castShadow = true;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), new THREE.MeshStandardMaterial({ map: this.backTex, roughness: 0.45, alphaTest: 0.5 }));
    back.rotation.x = Math.PI / 2;
    back.position.y = -0.0065;
    inner.add(edge, face, back);
    outer.userData = { inner, face, card: spot.card };
    return outer;
  }

  private quatOf(spot: CardSpot) {
    const e = new THREE.Euler(-(spot.tilt ?? 0), spot.yaw ?? 0, spot.faceUp ? 0 : Math.PI, "YXZ");
    return new THREE.Quaternion().setFromEuler(e);
  }

  private cards: CardSpot[] = [];
  private chips: ChipStack[] = [];

  /** Shows exactly these cards (animating whatever changed). */
  setCards(spots: CardSpot[], animate = true) {
    this.cards = spots;
    this.apply(animate);
  }

  /** Chip stacks (Hold'em, Blackjack): a stack per spot. */
  setChips(stacks: ChipStack[], animate = true) {
    this.chips = stacks;
    this.apply(animate);
  }

  private apply(animate: boolean) {
    const specs: PieceSpec[] = this.cards.map((spot) => ({
      key: spot.key,
      pos: spot.pos,
      quat: this.quatOf(spot),
      from: spot.from,
      fromQuat: spot.from ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spot.yaw ?? 0, Math.PI)) : undefined,
      make: () => this.cardMesh(spot),
      update: (o: THREE.Object3D) => this.dress(o, spot),
    }));
    for (const st of this.chips) {
      const n = Math.min(14, Math.max(0, Math.ceil(st.amount / 25)));
      for (let k = 0; k < n; k++)
        specs.push({
          key: `chip:${st.key}:${k}`,
          pos: st.pos.clone().setY(TOP + 0.023 + k * 0.046),
          make: () => mesh(this.chipGeo, new THREE.MeshStandardMaterial({ color: CHIP_COLOURS[(k + st.key.length) % CHIP_COLOURS.length], roughness: 0.4 })),
        });
    }
    // Picking: only your playable cards.
    for (const o of this.pieces.values()) this.stage.unpick(o);
    void this.place(specs, animate, { appear: "pop", vanish: "shrink", sound: "card" }).then(() => this.stage.refreshHover());
    for (const spot of this.cards) {
      const o = this.pieces.get(spot.key);
      if (!o || !spot.onClick) continue;
      const inner = o.userData.inner as THREE.Group;
      this.stage.pickable(o, {
        onClick: spot.onClick,
        onHover: (on) => {
          inner.position.y = (spot.lit ? 0.14 : 0) + (on ? 0.16 : 0);
          inner.position.z = on ? -0.12 : 0;
          this.stage.invalidate();
        },
      });
    }
  }

  /** A card's look: its face (a back turning into a known card), raised or greyed. */
  private dress(o: THREE.Object3D, spot: CardSpot) {
    const u = o.userData as { inner: THREE.Group; face: THREE.Mesh; card: string | null };
    if (spot.card && u.card !== spot.card) {
      (u.face.material as THREE.MeshStandardMaterial).map = this.faceTex(spot.card);
      (u.face.material as THREE.MeshStandardMaterial).needsUpdate = true;
      u.card = spot.card;
    }
    (u.face.material as THREE.MeshStandardMaterial).color.setHex(spot.dim ? 0xb9bcc4 : 0xffffff);
    u.inner.position.y = spot.lit ? 0.14 : 0;
    u.inner.position.z = 0;
  }

  /** Names and markers at each player's place. */
  setSeats(seats: SeatSpot[]) {
    for (const c of [...this.seatGroup.children]) {
      this.seatGroup.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        mat?.map?.dispose();
        mat?.dispose();
      });
    }
    for (const s of seats) {
      const g = new THREE.Group();
      g.position.copy(s.at).setY(TOP + 0.004);
      const name = labelMesh(s.name, { size: 0.32, color: "#ffffff", bg: s.active ? s.colour : "rgba(15,23,42,0.6)" });
      g.add(name);
      if (s.note) {
        const note = labelMesh(s.note, { size: 0.24, color: "#e2e8f0", weight: 600, bg: "rgba(15,23,42,0.45)" });
        note.position.z = 0.36;
        g.add(note);
      }
      // Names stay readable over the cards.
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m) m.depthTest = false;
        o.renderOrder = 10;
      });
      // A little further out than the cards.
      const out = new THREE.Vector3(s.at.x, 0, s.at.z).normalize().multiplyScalar(0.35);
      g.position.add(out);
      this.seatGroup.add(g);
    }
    this.stage.invalidate();
  }

  dispose() {
    for (const t of this.faces.values()) t.dispose();
    this.faces.clear();
    this.backTex?.dispose();
    this.chipGeo.dispose();
    super.dispose();
  }
}


/** A card table: a rounded felt top in a wooden rim, its cloth at height TOP. */
export function makeTable(scene: THREE.Scene, colour: string) {
  const rim = mesh(slab(TABLE_W + 0.7, TOP - 0.01, TABLE_D + 0.7, 1.2), wood("walnut", 2));
  scene.add(rim);
  const shape = new THREE.Shape();
  const r = 1.1;
  const w = TABLE_W / 2;
  const d = TABLE_D / 2;
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);
  const cloth = mesh(new THREE.ShapeGeometry(shape, 16), felt(colour));
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = TOP + 0.002;
  cloth.castShadow = false;
  scene.add(cloth);
}
export const TABLE_BOX = new THREE.Box3(new THREE.Vector3(-TABLE_W / 2 - 0.4, 0, -TABLE_D / 2 - 0.4), new THREE.Vector3(TABLE_W / 2 + 0.4, 0.8, TABLE_D / 2 + 0.4));

// ------------------------------------------------------------ layouts

/** Your hand along the near edge: a gentle fan, stood up towards you. */
export function handSpots(n: number): { pos: THREE.Vector3; yaw: number; tilt: number }[] {
  const width = Math.min(10.4, Math.max(1, n) * 0.78);
  const step = n > 1 ? width / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    return { pos: new THREE.Vector3(-width / 2 + i * step, TOP + 0.12 + i * 0.006, 3.05 + t * t * 0.5), yaw: -t * 0.14, tilt: 0.3 };
  });
}

/** The other players round the far side of the table (left to right). */
export function seatPlaces(count: number): THREE.Vector3[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, k) => {
    const a = Math.PI + (Math.PI * (k + 1)) / (count + 1);
    return new THREE.Vector3(Math.cos(a) * 5.0, TOP, Math.sin(a) * 3.0 - 0.2);
  });
}

/** A player's face-down hand: a small fan at their place. */
export function backFan(at: THREE.Vector3, count: number): { pos: THREE.Vector3; yaw: number }[] {
  const shown = Math.min(count, 9);
  const toward = Math.atan2(-at.x, -at.z);
  return Array.from({ length: shown }, (_, i) => {
    const t = shown > 1 ? i / (shown - 1) - 0.5 : 0;
    const side = new THREE.Vector3(Math.cos(toward), 0, -Math.sin(toward));
    const p = at.clone().addScaledVector(side, t * Math.min(2.2, shown * 0.24));
    const inward = new THREE.Vector3(-at.x, 0, -at.z).normalize();
    p.addScaledVector(inward, 0.55);
    p.y = TOP + 0.008 + i * 0.006;
    return { pos: p, yaw: toward + t * 0.5 };
  });
}

/** Between a place and the middle (a played card, a trick). */
export const towardMiddle = (at: THREE.Vector3, k = 0.45) => at.clone().multiplyScalar(1 - k).setY(TOP + 0.01);

/** A pile in the middle: cards stacked with a little scatter. */
export function pileSpots(centre: THREE.Vector3, n: number, scatter = 0.06): { pos: THREE.Vector3; yaw: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    pos: centre.clone().add(new THREE.Vector3(Math.sin(i * 2.3) * scatter, TOP + 0.008 + i * 0.012, Math.cos(i * 1.7) * scatter)),
    yaw: Math.sin(i * 3.1) * 0.12,
  }));
}
