interface Env {
  LIBRARY_KV?: KVNamespace;
}

type BookRecord = {
  id?: string;
  timestamp?: number;
  images?: string[];
};

const jsonResponse = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

const getIndexKey = (syncKey: string) => `sync-v2:${syncKey}:index`;
const getBookPrefix = (syncKey: string) => `sync-v2:${syncKey}:book:`;
const getBookKey = (syncKey: string, bookId: string) => `${getBookPrefix(syncKey)}${bookId}`;
const getImageKey = (syncKey: string, bookId: string, index: number) =>
  `sync-v2:${syncKey}:image:${bookId}:${index}`;

const splitBookForStorage = (book: BookRecord) => {
  const images = Array.isArray(book.images) ? book.images : [];
  const storedBook = {
    ...book,
    images: images.map((image, index) => (image ? { kvImageIndex: index } : '')),
  };

  return { storedBook, images };
};

const hydrateBookImages = async (env: Env, syncKey: string, book: BookRecord) => {
  if (!book.id || !Array.isArray(book.images)) {
    return book;
  }

  const images = await Promise.all(
    book.images.map((imageRef, index) => {
      if (imageRef && typeof imageRef === 'object' && 'kvImageIndex' in imageRef) {
        return env.LIBRARY_KV!.get(getImageKey(syncKey, book.id as string, index));
      }
      return Promise.resolve(typeof imageRef === 'string' ? imageRef : '');
    })
  );

  return { ...book, images };
};

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const urlObj = new URL(request.url);

  // Check KV Namespace binding
  if (!env.LIBRARY_KV) {
    return jsonResponse({
      error: "KV_NOT_BOUND",
      message: "Cloudflare KV namespace 'LIBRARY_KV' is not bound. Please bind a KV namespace named 'LIBRARY_KV' in your Pages project settings.",
    });
  }

  try {
    if (request.method === 'GET') {
      const syncKey = urlObj.searchParams.get('key');
      if (!syncKey) {
        return jsonResponse({ error: "Missing 'key' query parameter" }, { status: 400 });
      }

      const indexData = await env.LIBRARY_KV.get(getIndexKey(syncKey), 'json') as string[] | null;
      if (!Array.isArray(indexData) || indexData.length === 0) {
        return jsonResponse([]);
      }

      const bookEntries = await Promise.all(
        indexData.map((id) => env.LIBRARY_KV!.get(getBookKey(syncKey, id), 'json'))
      );
      const storedBooks = bookEntries.filter((book): book is BookRecord => !!book && typeof book === 'object');
      const books = await Promise.all(
        storedBooks.map((book) => hydrateBookImages(env, syncKey, book))
      );
      books.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return jsonResponse(books);
    } 
    
    if (request.method === 'POST') {
      const body: any = await request.json();
      const { key, books } = body;

      if (!key) {
        return jsonResponse({ error: "Missing 'key' in body" }, { status: 400 });
      }

      if (!books || !Array.isArray(books)) {
        return jsonResponse({ error: "Missing or invalid 'books' array in body" }, { status: 400 });
      }

      const validBooks = books.filter((book: BookRecord) => book && typeof book === 'object' && book.id);
      const nextIds = validBooks.map((book: BookRecord) => book.id as string);
      const previousIds = await env.LIBRARY_KV.get(getIndexKey(key), 'json') as string[] | null;
      const previousOnlyIds = Array.isArray(previousIds)
        ? previousIds.filter((id) => !nextIds.includes(id))
        : [];
      const imageDeleteKeys: string[] = [];

      for (const id of previousOnlyIds) {
        const storedBook = await env.LIBRARY_KV.get(getBookKey(key, id), 'json') as BookRecord | null;
        if (storedBook && Array.isArray(storedBook.images)) {
          storedBook.images.forEach((_image, index) => imageDeleteKeys.push(getImageKey(key, id, index)));
        }
      }

      await Promise.all([
        env.LIBRARY_KV.put(getIndexKey(key), JSON.stringify(nextIds)),
        ...validBooks.flatMap((book: BookRecord) => {
          const bookId = book.id as string;
          const { storedBook, images } = splitBookForStorage(book);
          return [
            env.LIBRARY_KV!.put(getBookKey(key, bookId), JSON.stringify(storedBook)),
            ...images.map((image, index) =>
              image
                ? env.LIBRARY_KV!.put(getImageKey(key, bookId, index), image)
                : env.LIBRARY_KV!.delete(getImageKey(key, bookId, index))
            ),
          ];
        }),
        ...previousOnlyIds.map((id) => env.LIBRARY_KV!.delete(getBookKey(key, id))),
        ...imageDeleteKeys.map((imageKey) => env.LIBRARY_KV!.delete(imageKey)),
      ]);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error: any) {
    return jsonResponse({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
