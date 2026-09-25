/**
 * The shape of a wire: where it leaves a socket and how far its curve reaches.
 *
 * ONE HOME for three readers — the resting edge (edges.tsx), the wire being dragged
 * (connection-line.tsx) and the hit test (geometry.ts). They each carried their own copy of the
 * control-point arithmetic, and the copies had drifted: the dragged wire capped its bend at 50px
 * where the resting edge used 20, so a connection changed shape the instant it was dropped, and the
 * hit test knew nothing of the rim or the leader, so a press landed beside the line it was aimed at.
 */

import { SOCKET_RADIUS } from '../core/constants';

/** An edge starts on the socket's drawn rim, not its centre. */
export const EDGE_SOCKET_RIM = SOCKET_RADIUS;

/** The straight run an edge leaves a socket along, before the curve begins. */
export const EDGE_LEADER = 6;

/**
 * The smallest reach a curve's control points get, however close the sockets are horizontally.
 *
 * A bend needs room to turn in. The old rule tied the reach to the horizontal gap alone and floored
 * it at `min(dx / 4, 20)`, so two sockets 45px apart and 85px apart vertically — one node sitting a
 * little right of and above the next — got control points 9px long after the rim and leaders took
 * their share. The curve went straight up with two turns tight enough to read as corners, joined to
 * the leaders at what looked like kinks. The floor now comes from the VERTICAL distance, capped, so a
 * tall short edge turns in a curve and a long flat one is unchanged.
 */
export const EDGE_MIN_BEND = 40;

/**
 * How far a bezier's control points reach from its two ends, along each socket's axis.
 *
 * Half the horizontal gap, which is the familiar node-editor S; never less than half the vertical
 * gap up to `EDGE_MIN_BEND`, so an edge that is mostly vertical still has room to turn.
 */
export function bezierControlOffset(dx: number, dy: number): number {
  return Math.max(Math.abs(dx) * 0.5, Math.min(Math.abs(dy) * 0.5, EDGE_MIN_BEND));
}
