interface Env {
  LIBRARY_KV?: KVNamespace;
}

type BookRecord = {
  id?: string;
  timestamp?: number;
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
      const books = bookEntries.filter((book): book is BookRecord => !!book && typeof book === 'object');
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

      await Promise.all([
        env.LIBRARY_KV.put(getIndexKey(key), JSON.stringify(nextIds)),
        ...validBooks.map((book: BookRecord) =>
          env.LIBRARY_KV!.put(getBookKey(key, book.id as string), JSON.stringify(book))
        ),
        ...(Array.isArray(previousIds)
          ? previousIds
              .filter((id) => !nextIds.includes(id))
              .map((id) => env.LIBRARY_KV!.delete(getBookKey(key, id)))
          : []),
      ]);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  } catch (error: any) {
    return jsonResponse({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
