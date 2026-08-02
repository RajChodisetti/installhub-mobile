export interface AtomicDownloadFile {
  readonly uri: string;
  readonly name: string;
  readonly exists: boolean;
  create(options?: { intermediates?: boolean; overwrite?: boolean }): void;
  delete(): void;
  info(): { size?: number };
  writableStream(): WritableStream<Uint8Array<ArrayBufferLike>>;
  move(destination: AtomicDownloadFile): Promise<void>;
}

export interface DownloadResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly redirected: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
}

export type AuthenticatedFetch = (
  url: string,
  init: {
    headers: { Authorization: string };
    redirect: 'error';
    credentials: 'omit';
  },
) => Promise<DownloadResponseLike>;

function normalizedContentType(response: DownloadResponseLike): string {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function contentTypeMatches(actual: string, expected: string): boolean {
  const normalizedExpected = expected.trim().toLowerCase();
  return normalizedExpected.endsWith('/')
    ? actual.startsWith(normalizedExpected)
    : actual === normalizedExpected;
}

/** Streams a bearer response to an isolated partial and exposes it only after validation. */
export async function authenticatedDownloadToFile(input: {
  url: string;
  token: string;
  destination: AtomicDownloadFile;
  createPartialFile: () => AtomicDownloadFile;
  fetcher: AuthenticatedFetch;
  expectedContentType: string;
}): Promise<AtomicDownloadFile> {
  let partial: AtomicDownloadFile | undefined;
  try {
    if (input.destination.exists) {
      throw new Error('Authenticated download destination already exists.');
    }
    const response = await input.fetcher(input.url, {
      headers: { Authorization: `Bearer ${input.token}` },
      redirect: 'error',
      credentials: 'omit',
    });
    if (response.redirected) throw new Error('Authenticated downloads cannot follow redirects.');
    if (!response.ok) throw new Error(`Authenticated download failed with status ${response.status}.`);
    if (!response.body) throw new Error('Authenticated download returned no response body.');
    const contentType = normalizedContentType(response);
    if (!contentType || !contentTypeMatches(contentType, input.expectedContentType)) {
      throw new Error(`Authenticated download returned unexpected content type ${contentType || '(missing)'}.`);
    }

    partial = input.createPartialFile();
    partial.create({ intermediates: true, overwrite: true });
    await response.body.pipeTo(partial.writableStream());
    const size = partial.info().size;
    if (!Number.isSafeInteger(size) || (size ?? 0) < 1) {
      throw new Error('Authenticated download returned an empty file.');
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const expectedLength = Number(contentLength);
      if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength !== size) {
        throw new Error('Authenticated download content length did not match the streamed file.');
      }
    }
    // The final name is unique and move is deliberately non-overwriting.
    // Expo iOS implements overwrite by deleting the destination first, which
    // creates a loss window if the subsequent move fails.
    await partial.move(input.destination);
    return input.destination;
  } catch (error) {
    if (partial?.exists) {
      try { partial.delete(); } catch { /* best-effort partial cleanup */ }
    }
    throw error;
  }
}
