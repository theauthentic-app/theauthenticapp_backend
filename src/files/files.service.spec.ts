import { FilesService } from './files.service';

describe('FilesService', () => {
  const previous = process.env.R2_PUBLIC_BASE_URL;

  afterAll(() => {
    if (previous === undefined) {
      delete process.env.R2_PUBLIC_BASE_URL;
    } else {
      process.env.R2_PUBLIC_BASE_URL = previous;
    }
  });

  it('builds public R2 URLs when a CDN base is configured', () => {
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.authentic.test/';
    const files = new FilesService({} as never);
    expect(files.publicUrl('product_image/file_abc.jpg')).toBe(
      'https://cdn.authentic.test/product_image/file_abc.jpg',
    );
  });
});
