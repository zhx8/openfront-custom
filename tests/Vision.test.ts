import { VisionTracker } from "../src/client/render/frame/Vision";

describe("VisionTracker", () => {
  const W = 200;
  const H = 200;
  const ref = (x: number, y: number) => y * W + x;

  test("sees around own land and own units, not far away", () => {
    const tiles = new Uint16Array(W * H);
    tiles[ref(10, 10)] = 7; // our tile
    const v = new VisionTracker(W, H, 40, 16);
    v.update(tiles, null, 7, [ref(150, 150)]);
    expect(v.isVisible(ref(30, 30))).toBe(true);
    expect(v.isVisible(ref(150, 160))).toBe(true); // around our ship/plane
    expect(v.isVisible(ref(100, 100))).toBe(false);
  });

  test("follows land changes from per-tick deltas", () => {
    const tiles = new Uint16Array(W * H);
    const v = new VisionTracker(W, H, 40, 16);
    v.update(tiles, null, 7, []);
    expect(v.isVisible(ref(100, 100))).toBe(false);
    tiles[ref(100, 100)] = 7;
    v.update(tiles, [ref(100, 100)], 7, []);
    expect(v.isVisible(ref(110, 110))).toBe(true);
    tiles[ref(100, 100)] = 3; // lost it
    v.update(tiles, [ref(100, 100)], 7, []);
    expect(v.isVisible(ref(110, 110))).toBe(false);
  });
});
