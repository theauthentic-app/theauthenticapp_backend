import {
  parsePresentedCode,
  type PresentedCode,
} from '../common/utils/code-catalog.util';

export type CatalogLookupResult = {
  found: boolean;
  source:
    | 'open_library'
    | 'google_books'
    | 'open_food_facts'
    | 'open_beauty_facts'
    | 'open_products_facts'
    | 'upcitemdb'
    | null;
  kind: 'isbn' | 'gtin' | 'unknown';
  code: string;
  isbn13?: string;
  isbn10?: string;
  gtin?: string;
  title: string | null;
  brand: string | null;
  authors: string[];
  description: string | null;
  category: string | null;
  image: string | null;
  url: string | null;
};

export type HttpGet = (
  url: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type CatalogLookupOptions = {
  httpGet?: HttpGet;
  googleBooksApiKey?: string;
  upcitemdb?: boolean;
  onError?: (url: string, error: unknown) => void;
};

const TIMEOUT_MS = 4500;
const USER_AGENT =
  'AUTHENTIC/0.1 (product-trust; https://authentic.app; lookup@authentic.app)';

export function emptyLookup(
  parsed: PresentedCode,
  code?: string,
): CatalogLookupResult {
  return {
    found: false,
    source: null,
    kind: parsed.kind === 'isbn' || parsed.kind === 'gtin' ? parsed.kind : 'unknown',
    code: code ?? parsed.canonical,
    isbn13: parsed.isbn13,
    isbn10: parsed.isbn10,
    gtin: parsed.gtin,
    title: null,
    brand: null,
    authors: [],
    description: null,
    category: null,
    image: null,
    url: null,
  };
}

export async function lookupPublicCatalog(
  code: string | PresentedCode,
  options: CatalogLookupOptions = {},
): Promise<CatalogLookupResult | null> {
  const parsed = typeof code === 'string' ? parsePresentedCode(code) : code;
  if (parsed.kind !== 'isbn' && parsed.kind !== 'gtin') return null;
  const httpGet = options.httpGet ?? ((url, init) => fetch(url, init));
  if (parsed.kind === 'isbn') {
    return lookupIsbn(parsed, httpGet, options);
  }
  return lookupGtin(parsed, httpGet, options);
}

async function lookupIsbn(
  parsed: PresentedCode,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult | null> {
  const isbn = parsed.isbn13 ?? parsed.canonical;
  const fromOpenLibrary = await openLibrary(isbn, parsed, httpGet, options);
  if (fromOpenLibrary?.found) return fromOpenLibrary;
  const fromGoogle = await googleBooks(isbn, parsed, httpGet, options);
  if (fromGoogle?.found) return fromGoogle;
  return fromOpenLibrary ?? fromGoogle;
}

async function lookupGtin(
  parsed: PresentedCode,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult | null> {
  const gtin = parsed.gtin ?? parsed.canonical;
  const tasks = [
    openFacts(
      'https://world.openfoodfacts.org',
      'open_food_facts',
      gtin,
      parsed,
      httpGet,
      options,
    ),
    openFacts(
      'https://world.openbeautyfacts.org',
      'open_beauty_facts',
      gtin,
      parsed,
      httpGet,
      options,
    ),
    openFacts(
      'https://world.openproductsfacts.org',
      'open_products_facts',
      gtin,
      parsed,
      httpGet,
      options,
    ),
  ];
  if (options.upcitemdb) {
    tasks.push(upcItemDb(gtin, parsed, httpGet, options));
  }
  const settled = await Promise.allSettled(tasks);
  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value?.found) return item.value;
  }
  return null;
}

async function openLibrary(
  isbn: string,
  parsed: PresentedCode,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult | null> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const json = await getJson<Record<string, OpenLibraryBook>>(
    url,
    httpGet,
    options,
  );
  const book = json?.[`ISBN:${isbn}`];
  if (!book?.title) return null;
  return {
    found: true,
    source: 'open_library',
    kind: 'isbn',
    code: parsed.canonical,
    isbn13: parsed.isbn13 ?? isbn,
    isbn10: parsed.isbn10,
    title: book.title,
    brand: book.publishers?.[0]?.name ?? null,
    authors: (book.authors ?? []).map((author) => author.name).filter(Boolean),
    description: book.notes ?? book.excerpts?.[0]?.text ?? null,
    category: book.subjects?.[0]?.name ?? 'BOOKS',
    image: book.cover?.large ?? book.cover?.medium ?? null,
    url: book.url ?? `https://openlibrary.org/isbn/${isbn}`,
  };
}

async function googleBooks(
  isbn: string,
  parsed: PresentedCode,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult | null> {
  const query = new URLSearchParams({ q: `isbn:${isbn}`, maxResults: '1' });
  if (options.googleBooksApiKey) query.set('key', options.googleBooksApiKey);
  const json = await getJson<GoogleBooksResponse>(
    `https://www.googleapis.com/books/v1/volumes?${query.toString()}`,
    httpGet,
    options,
  );
  const info = json?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  return {
    found: true,
    source: 'google_books',
    kind: 'isbn',
    code: parsed.canonical,
    isbn13: parsed.isbn13 ?? isbn,
    isbn10: parsed.isbn10,
    title: info.title,
    brand: info.publisher ?? null,
    authors: info.authors ?? [],
    description: info.description ?? null,
    category: info.categories?.[0] ?? 'BOOKS',
    image: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null,
    url: info.infoLink ?? info.canonicalVolumeLink ?? null,
  };
}

async function openFacts(
  origin: string,
  source: Extract<
    CatalogLookupResult['source'],
    'open_food_facts' | 'open_beauty_facts' | 'open_products_facts'
  >,
  gtin: string,
  parsed: PresentedCode,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult | null> {
  const json = await getJson<OpenFactsResponse>(
    `${origin}/api/v2/product/${gtin}.json`,
    httpGet,
    options,
  );
  if (json?.status !== 1 || !json.product) return null;
  const product = json.product;
  const title =
    product.product_name ||
    product.generic_name ||
    product.product_name_en ||
    null;
  if (!title) return null;
  return {
    found: true,
    source,
    kind: 'gtin',
    code: parsed.canonical,
    gtin,
    title,
    brand: product.brands || null,
    authors: [],
    description: product.generic_name || null,
    category: product.categories || null,
    image: product.image_url || product.image_front_url || null,
    url: `${origin}/product/${gtin}`,
  };
}

async function upcItemDb(
  gtin: string,
  parsed: PresentedCode,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<CatalogLookupResult | null> {
  const json = await getJson<UpcItemDbResponse>(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(gtin)}`,
    httpGet,
    options,
  );
  const item = json?.items?.[0];
  if (!item?.title) return null;
  return {
    found: true,
    source: 'upcitemdb',
    kind: 'gtin',
    code: parsed.canonical,
    gtin,
    title: item.title,
    brand: item.brand || null,
    authors: [],
    description: item.description || null,
    category: item.category || null,
    image: item.images?.[0] || null,
    url: null,
  };
}

async function getJson<T>(
  url: string,
  httpGet: HttpGet,
  options: CatalogLookupOptions,
): Promise<T | null> {
  try {
    const response = await httpGet(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (error) {
    options.onError?.(url, error);
    return null;
  }
}

type OpenLibraryBook = {
  title?: string;
  notes?: string;
  url?: string;
  authors?: Array<{ name: string }>;
  publishers?: Array<{ name: string }>;
  subjects?: Array<{ name: string }>;
  excerpts?: Array<{ text: string }>;
  cover?: { large?: string; medium?: string };
};

type GoogleBooksResponse = {
  items?: Array<{
    volumeInfo?: {
      title?: string;
      authors?: string[];
      publisher?: string;
      description?: string;
      categories?: string[];
      infoLink?: string;
      canonicalVolumeLink?: string;
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }>;
};

type OpenFactsResponse = {
  status?: number;
  product?: {
    product_name?: string;
    product_name_en?: string;
    generic_name?: string;
    brands?: string;
    categories?: string;
    image_url?: string;
    image_front_url?: string;
  };
};

type UpcItemDbResponse = {
  items?: Array<{
    title?: string;
    brand?: string;
    description?: string;
    category?: string;
    images?: string[];
  }>;
};
