import { routeEdge } from '../flowchart/edgeRoute';

const g = { gapBelow: 10, gapAbove: 31, colGap: 13 };
const box = (id: string, x: number, y: number) => ({ id, x, y, w: 100, h: 60 });

describe('routeEdge', () => {
  it('goes straight down a column', () => {
    expect(routeEdge(box('a', 0, 0), box('b', 0, 100), [], g)).toEqual([{ x: 50, y: 60 }, { x: 50, y: 100 }]);
  });

  it('bends at right angles to a box down and across, never diagonally', () => {
    const r = routeEdge(box('a', 0, 0), box('b', 130, 100), [], g);
    expect(r).toEqual([{ x: 50, y: 60 }, { x: 50, y: 70 }, { x: 180, y: 70 }, { x: 180, y: 100 }]);
  });
});
