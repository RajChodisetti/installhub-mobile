# Authenticated download parity — 5 September 2026

Status: fixed in source and focused tests; the next installed iPad build must repeat the financial-summary CSV download and native share action before marking the device gate passed.

The build 5 iPad financial-summary CSV action failed with `Authenticated download content length did not match the streamed file.` Evidence: `../tmp/field-parity-build5-csv-r1.log`, line 476. The dedicated API route remains `GET /v1/installhub/installations/:installationId/financial-summary.csv`, with `text/csv; charset=utf-8` and an attachment filename (`sustainability-wise-api/src/routes/installhub/finance.ts`, lines 32–50).

## Cause and correction

`authenticatedDownloadCore.ts` previously compared the saved file size directly with HTTP `Content-Length`. That comparison is invalid after transparent content decoding: the header describes the encoded representation, while fetch exposes decoded body bytes. The [HTTP representation and length rules](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4) and [Fetch content-decoding steps](https://fetch.spec.whatwg.org/#http-network-fetch) distinguish those quantities. Synthetic compressed CSV responses reproduce the original error without credentials or customer data. The physical log does not record response headers, so the actual QA response's encoding remains for the next device verification.

Installed Expo 57 source confirms that iOS `NativeResponse.swift` forwards `HTTPURLResponse.allHeaderFields` and URLSession body data, propagating native completion/errors. Expo's Metro `withMetroMultiPlatform.js` includes `expo/virtual/streams.js` as a native polyfill; that installed file provides `TransformStream`. The regression suite executes the production downloader inside those installed stream globals, in addition to real localhost fetch cases. Context7's Expo streaming documentation was consulted; the precise header/body behavior is grounded in the installed source and HTTP/Fetch standards.

The corrected downloader:

- Counts each decoded stream chunk without buffering the complete download, waits for successful transport/decompression completion and file-writer close, then requires the disk size to equal the counted bytes.
- Retains exact `Content-Length` equality for absent/identity encoding. A declared encoded length must still be a positive safe decimal integer; it is not compared to decoded size.
- Accepts the single supported content codings gzip, x-gzip, deflate and br. Unknown, empty or stacked codings fail explicitly because an unsupported fetch coding can pass through undecoded.
- Rejects partial HTTP responses, missing/empty bodies and missing/unexpected MIME types. Redirect rejection, bearer-only requests with omitted cookies, unique non-overwriting final destinations and partial cleanup remain in place.

This checks transport completion and exact saved byte counts; it does not claim an independent server-signed payload digest.

## Validation

`rtk node --import tsx --test --test-reporter=dot tests/authenticatedDownloadCore.test.ts`: 36 passing tests, exit 0. Coverage includes exact UTF-8 CSV bytes with gzip/deflate/br and encoded lengths, no-length streaming, identity truncation, malformed lengths/codings, corrupt gzip CRC, truncated compressed HTTP framing, silently short disk writes, close errors, empty/MIME/status failures, redirects, prior destination preservation and the installed Expo stream runtime.

No API routes, credentials, customer records, native dependencies or download adapters changed. The physical CSV export/share retest remains outstanding.
