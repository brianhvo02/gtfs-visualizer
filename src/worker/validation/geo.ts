export type LonLat = readonly [number, number];

const EARTH_RADIUS_METERS = 6_371_000;
const RADIANS_PER_DEGREE = Math.PI / 180;

export function haversineMeters(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * RADIANS_PER_DEGREE;
  const lat2 = b[1] * RADIANS_PER_DEGREE;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * RADIANS_PER_DEGREE;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Minimum distance from `point` to the polyline, using an equirectangular projection centered on `point`.
 * A one-point line gives the distance to that point.
 */
export function distanceToPolylineMeters(point: LonLat, line: readonly LonLat[]): number {
  const cosLat = Math.cos(point[1] * RADIANS_PER_DEGREE);
  const project = (p: LonLat): [number, number] => [
    (p[0] - point[0]) * RADIANS_PER_DEGREE * cosLat * EARTH_RADIUS_METERS,
    (p[1] - point[1]) * RADIANS_PER_DEGREE * EARTH_RADIUS_METERS,
  ];
  let best = Infinity;
  let prev: [number, number] | null = null;
  for (const vertex of line) {
    const cur = project(vertex);
    best = Math.min(best, prev === null ? Math.hypot(cur[0], cur[1]) : distanceToSegmentFromOrigin(prev, cur));
    prev = cur;
  }
  return best;
}

function distanceToSegmentFromOrigin(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  // Parameter of the origin's projection onto the segment, clamped to its ends.
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}
