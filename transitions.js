import Clutter from "gi://Clutter";
import St from "gi://St";

const Mode = Clutter.AnimationMode;

const BOARD_PIECES = 96;
const SNAP_PIECES = 220;

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

function joiner(ctx, count, done) {
  let left = count;
  return () => {
    if (ctx.cancelled) return;
    if (--left === 0) done();
  };
}

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

function crossfade(ctx, done) {
  const layer = makePiece(ctx, 0, 0, ctx.width, ctx.height);
  animatePiece(
    ctx,
    layer,
    { opacity: 0, duration: 350, mode: Mode.EASE_IN_OUT_QUAD },
    joiner(ctx, 1, done),
  );
}

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

function snap(ctx, done) {
  const tiles = makeGrid(ctx, SNAP_PIECES);
  const finished = joiner(ctx, tiles.length, done);
  const WAVE_MS = 600;
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

export const TRANSITIONS = {
  none: { run: (_ctx, done) => done() },
  crossfade: { run: crossfade },
  chessboard: { run: chessboard },
  snap: { run: snap },
  blinds: { run: blinds },
};
