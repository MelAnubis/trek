import { describe, it, expect } from 'vitest';
import { makePreview } from '../../src/services/plannerPreview';

describe('makePreview', () => {
  it('PV-001 — keeps first and last point and caps the size', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => [40 + i * 0.001, -3, 500]);
    const p = makePreview(pts, 50);
    expect(p).toHaveLength(50);
    expect(p[0]).toEqual([40, -3]);
    expect(p[49]).toEqual([40.999, -3]);
  });
  it('PV-002 — short tracks are kept whole; garbage gives []', () => {
    expect(makePreview([[1, 2, null], [3, 4, null]])).toEqual([[1, 2], [3, 4]]);
    expect(makePreview([])).toEqual([]);
    expect(makePreview('nope')).toEqual([]);
    expect(makePreview([['a', 'b']])).toEqual([]);
  });
});
