import { lookupPublicCatalog } from './catalog-lookup.client';

describe('public catalog lookup', () => {
  it('looks up an ISBN from Open Library', async () => {
    const httpGet = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        'ISBN:9780141036144': {
          title: 'Nineteen Eighty-Four',
          authors: [{ name: 'George Orwell' }],
          publishers: [{ name: 'Penguin' }],
          cover: { large: 'https://covers.example/1984.jpg' },
          url: 'https://openlibrary.org/isbn/9780141036144',
        },
      }),
    });

    const result = await lookupPublicCatalog('978-0-14-103614-4', { httpGet });
    expect(result?.found).toBe(true);
    expect(result?.source).toBe('open_library');
    expect(result?.title).toBe('Nineteen Eighty-Four');
    expect(result?.authors).toEqual(['George Orwell']);
  });

  it('looks up a GTIN from Open Food Facts', async () => {
    const httpGet = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('openfoodfacts')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 1,
            product: {
              product_name: 'Nutella',
              brands: 'Ferrero',
              image_url: 'https://images.example/nutella.jpg',
              categories: 'Spreads',
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const result = await lookupPublicCatalog('3017620422003', { httpGet });
    expect(result?.found).toBe(true);
    expect(result?.source).toBe('open_food_facts');
    expect(result?.title).toBe('Nutella');
    expect(result?.brand).toBe('Ferrero');
  });
});
