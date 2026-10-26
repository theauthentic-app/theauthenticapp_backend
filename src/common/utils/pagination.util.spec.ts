import { paginatedResult, paginationOf } from './pagination.util';

describe('paginationOf', () => {
  it('clamps page and limit', () => {
    expect(paginationOf()).toEqual({ page: 1, limit: 20, skip: 0, take: 20 });
    expect(paginationOf({ page: 0, limit: 500 })).toEqual({
      page: 1,
      limit: 100,
      skip: 0,
      take: 100,
    });
    expect(paginationOf({ page: 3, limit: 10 })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
      take: 10,
    });
  });

  it('wraps items', () => {
    expect(paginatedResult(['a'], 11, 2, 10)).toEqual({
      items: ['a'],
      page: 2,
      limit: 10,
      total: 11,
    });
  });
});
