// transitions.js
//
// Prebuilt image-change effects for the banner.
//
// How it works: when the image changes, the banner puts the NEW image on its
// base layer straight away, then calls run() of the chosen effect. The effect
// covers the base with pieces of the OLD image (see makePiece) and animates
// those pieces away, so the new image is revealed underneath.
//
// Adding an effect:
//   1. write a function (ctx, done) => { ... } below
//   2. register it in TRANSITIONS
//   3. add its id + label to transition-choices.js and to the <choices> of
//      "transition-effect" in the schema
//
// ctx = {
//   overlay,    Clutter.Actor sitting on top of the new image
//   width,      size of the image area, in actor px (integers)
//   height,
//   oldStyle,   the exact style string the old image was shown with
//   cancelled,  set to true by the banner if a newer change interrupts us
// }
// Call done() once, when the effect has finished. Never call it (or touch
// the pieces) once ctx.cancelled is true; the banner has already cleaned up.

import Clutter from "gi://Clutter";
import St from "gi://St";

const Mode = Clutter.AnimationMode;

// Approximate number of pieces. The grid adapts to the banner size, so a
// screen-wide banner doesn't get thousands of actors.
const BOARD_PIECES = 96;
const SNAP_PIECES = 220;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// One piece of the old image: a clipping window onto a full-size copy of the
// old image. The copy uses the very same style the banner used, so it is
// rendered exactly like the base was (size, position, rounded corners) and the
// piece just shows the part of it that lies under the window.
function makePiece(ctx, x, y, w, h) {
  const piece = new Clutter.Actor({
    x,
    y,
    width: w,
    height: h,
    clip_to_allocation: true,
  });
  piece.set_pivot_point(0.5, 0.5);
  piece.add_child(
    new St.Bin({
      style: ctx.oldStyle,
      x: -x,
      y: -y,
      width: ctx.width,
      height: ctx.height,
    }),
  );
  ctx.overlay.add_child(piece);
  return piece;
}

// Split the area into a cols x rows grid with about `pieces` cells.
// Edges are rounded to whole pixels and neighbours share them, so cells
// never overlap and there are no seams.
export function gridEdges(width, height, pieces) {
  const size = Math.sqrt((width * height) / pieces);
  const cols = Math.max(1, Math.round(width / size));
  const rows = Math.max(1, Math.round(height / size));
  const xs = [];
  const ys = [];
  for (let i = 0; i <= cols; i++) xs.push(Math.round((i * width) / cols));
  for (let i = 0; i <= rows; i++) ys.push(Math.round((i * height) / rows));
  return { cols, rows, xs, ys };
}

function makeGrid(ctx, pieces) {
  const { cols, rows, xs, ys } = gridEdges(ctx.width, ctx.height, pieces);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        piece: makePiece(
          ctx,
          xs[c],
          ys[r],
          xs[c + 1] - xs[c],
          ys[r + 1] - ys[r],
        ),
        r,
        c,
        cols,
        rows,
      });
    }
  }
  return out;
}

// Returns a function to call after each piece finishes; the last call
// invokes done(). Does nothing once the transition was cancelled.
function joiner(ctx, count, done) {
  let left = count;
  return () => {
    if (ctx.cancelled) return;
    if (--left === 0) done();
  };
}

// Animate a piece and remove it when it is finished
function animatePiece(ctx, piece, props, finished) {
  piece.ease({
    ...props,
    onComplete: () => {
      if (ctx.cancelled) return;
      piece.destroy();
      finished();
    },
  });
}

// ---------------------------------------------------------------------------
// effects
// ---------------------------------------------------------------------------

// Old image fades out over the new one
function crossfade(ctx, done) {
  const layer = makePiece(ctx, 0, 0, ctx.width, ctx.height);
  animatePiece(
    ctx,
    layer,
    { opacity: 0, duration: 350, mode: Mode.EASE_IN_OUT_QUAD },
    joiner(ctx, 1, done),
  );
}

// Squares shrink away in a checker pattern: one colour first, then the other
function chessboard(ctx, done) {
  const tiles = makeGrid(ctx, BOARD_PIECES);
  const finished = joiner(ctx, tiles.length, done);
  for (const { piece, r, c } of tiles) {
    animatePiece(
      ctx,
      piece,
      {
        scale_x: 0,
        scale_y: 0,
        delay: ((r + c) % 2) * 180,
        duration: 220,
        mode: Mode.EASE_IN_QUAD,
      },
      finished,
    );
  }
}

// Thanos snap: the image turns to dust, left to right. Every piece drifts up
// and to the right, spins, shrinks and fades, with a bit of randomness.
function snap(ctx, done) {
  const tiles = makeGrid(ctx, SNAP_PIECES);
  const finished = joiner(ctx, tiles.length, done);
  const WAVE_MS = 600; // time for the "snap" to sweep across the image
  for (const { piece, c, cols } of tiles) {
    animatePiece(
      ctx,
      piece,
      {
        translation_x: 20 + Math.random() * 50,
        translation_y: -(10 + Math.random() * 40),
        rotation_angle_z: (Math.random() - 0.5) * 140,
        scale_x: 0.2,
        scale_y: 0.2,
        opacity: 0,
        delay: (c / cols) * WAVE_MS + Math.random() * 120,
        duration: 450 + Math.random() * 250,
        mode: Mode.EASE_OUT_QUAD,
      },
      finished,
    );
  }
}

// Vertical slats close one after another, left to right
function blinds(ctx, done) {
  const n = Math.max(6, Math.min(24, Math.round(ctx.width / 36)));
  const finished = joiner(ctx, n, done);
  for (let i = 0; i < n; i++) {
    const x0 = Math.round((i * ctx.width) / n);
    const x1 = Math.round(((i + 1) * ctx.width) / n);
    animatePiece(
      ctx,
      makePiece(ctx, x0, 0, x1 - x0, ctx.height),
      {
        scale_x: 0,
        delay: i * (300 / n),
        duration: 260,
        mode: Mode.EASE_IN_OUT_QUAD,
      },
      finished,
    );
  }
}

// ---------------------------------------------------------------------------
// registry (ids match transition-choices.js and the schema)
// ---------------------------------------------------------------------------

export const TRANSITIONS = {
  none: { run: (_ctx, done) => done() },
  crossfade: { run: crossfade },
  chessboard: { run: chessboard },
  snap: { run: snap },
  blinds: { run: blinds },
};
