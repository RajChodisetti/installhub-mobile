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

/** Fetch exposes decoded bytes; Content-Length describes the encoded HTTP representation. */
function downloadLengthPolicy(response: DownloadResponseLike) {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  // Unknown codings may pass through fetch undecoded. Never publish those bytes
  // as a PDF/image/CSV just because the server supplied its underlying MIME type.
  if (encoding !== undefined && !['identity', 'gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) {
    throw new Error('Authenticated download returned an unsupported content encoding.');
  }
  const contentLength = response.headers.get('content-length');
  let expectedLength: number | undefined;
  if (contentLength !== null) {
    expectedLength = Number(contentLength.trim());
    if (!/^\d+$/.test(contentLength.trim()) || !Number.isSafeInteger(expectedLength) || expectedLength < 1) {
      throw new Error('Authenticated download returned an invalid content length.');
    }
  }
  return { expectedLength, encoded: encoding !== undefined && encoding !== 'identity' };
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
    if (response.status === 206 || response.headers.get('content-range') !== null) {
      throw new Error('Authenticated download returned a partial response.');
    }
    if (!response.body) throw new Error('Authenticated download returned no response body.');
    const contentType = normalizedContentType(response);
    if (!contentType || !contentTypeMatches(contentType, input.expectedContentType)) {
      throw new Error(`Authenticated download returned unexpected content type ${contentType || '(missing)'}.`);
    }
    const { expectedLength, encoded } = downloadLengthPolicy(response);

    partial = input.createPartialFile();
    partial.create({ intermediates: true, overwrite: true });
    let streamedBytes = 0;
    await response.body.pipeThrough(new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform(chunk, controller) {
        streamedBytes += chunk.byteLength;
        if (!Number.isSafeInteger(streamedBytes)) throw new Error('Authenticated download is too large.');
        controller.enqueue(chunk);
      },
    })).pipeTo(partial.writableStream());
    const size = partial.info().size;
    if (!Number.isSafeInteger(size) || (size ?? 0) < 1) {
      throw new Error('Authenticated download returned an empty file.');
    }
    // Successful pipe completion includes native transport/decompression EOF and
    // the file writer's close. Independently verify every decoded byte reached
    // disk even when a compressed wire length cannot describe the saved file.
    if (streamedBytes !== size) {
      throw new Error('Authenticated download file size did not match the streamed bytes.');
    }
    if (!encoded && expectedLength !== undefined && expectedLength !== streamedBytes) {
      throw new Error('Authenticated download content length did not match the streamed file.');
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
