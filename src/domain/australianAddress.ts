import type {
  AddressGeocodingStatus,
  AddressProvider,
  AddressSource,
  AustralianAddress,
  Installation,
} from '../types';

const ADDRESS_SEPARATOR = '\u001f';
const FINGERPRINT_DOMAIN_SEPARATOR = '\u001e2';

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;

const MD5_CONSTANTS = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
);

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function wordHex(value: number): string {
  return [0, 8, 16, 24]
    .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0'))
    .join('');
}

/** Small UTF-8 MD5 implementation used to match the PostgreSQL-compatible server fingerprint. */
export function md5Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const lowBits = bitLength >>> 0;
  const highBits = Math.floor(bitLength / 0x1_0000_0000) >>> 0;
  for (const word of [lowBits, highBits]) {
    for (let shift = 0; shift < 32; shift += 8) bytes.push((word >>> shift) & 0xff);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => {
      const start = offset + index * 4;
      return (
        bytes[start]!
        | (bytes[start + 1]! << 8)
        | (bytes[start + 2]! << 16)
        | (bytes[start + 3]! << 24)
      ) >>> 0;
    });
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let mixed: number;
      let wordIndex: number;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      const sum = (a + mixed + MD5_CONSTANTS[index]! + words[wordIndex]!) >>> 0;
      b = (b + rotateLeft(sum, MD5_SHIFTS[index]!)) >>> 0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map(wordHex).join('');
}

/** Normalization is for equality only; the display value is preserved separately. */
export function normalizeAustralianAddressText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

/** Client keys additionally apply Unicode NFKC to prevent visually equivalent duplicates. */
export function normalizeClientNameKey(value: string): string {
  return normalizeAustralianAddressText(value.normalize('NFKC'));
}

export function australianAddressFingerprint(value: Pick<
  AustralianAddress,
  'display_address' | 'locality' | 'state' | 'postcode' | 'country_code'
>): string {
  const canonical = [
    value.display_address,
    value.locality ?? '',
    value.state ?? '',
    value.postcode ?? '',
    value.country_code || 'AU',
  ].map(normalizeAustralianAddressText).join(ADDRESS_SEPARATOR);
  return md5Hex(canonical) + md5Hex(`${canonical}${FINGERPRINT_DOMAIN_SEPARATOR}`);
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validCoordinatePair(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number'
    && Number.isFinite(latitude)
    && latitude >= -44
    && latitude <= -9
    && typeof longitude === 'number'
    && Number.isFinite(longitude)
    && longitude >= 112
    && longitude <= 154;
}

function addressSource(value: unknown): AddressSource {
  return value === 'suggested' || value === 'client_saved' ? value : 'manual';
}

function geocodingStatus(value: unknown): AddressGeocodingStatus {
  return value === 'resolved' || value === 'manual' || value === 'failed'
    ? value
    : 'unresolved';
}

function provider(value: unknown): AddressProvider | null {
  return value === 'geoapify' || value === 'photon' ? value : null;
}

export function normalizeAustralianAddress(
  value: Partial<AustralianAddress> & Pick<AustralianAddress, 'display_address'>,
): AustralianAddress {
  const coordinatesAreValid = validCoordinatePair(value.latitude, value.longitude);
  const nextProvider = provider(value.provider);
  const nextPlaceId = optionalText(value.place_id);
  let source = addressSource(value.source);
  let status = geocodingStatus(value.geocoding_status);
  if (source === 'suggested' && (!coordinatesAreValid || !nextProvider || !nextPlaceId)) {
    source = 'manual';
    status = 'unresolved';
  }
  if (status === 'resolved' && (!coordinatesAreValid || !nextProvider || !nextPlaceId)) {
    status = 'unresolved';
  }
  const normalized: AustralianAddress = {
    display_address: value.display_address.trim(),
    locality: optionalText(value.locality),
    state: optionalText(value.state)?.toUpperCase() ?? null,
    postcode: optionalText(value.postcode),
    country_code: 'AU',
    latitude: coordinatesAreValid ? value.latitude! : null,
    longitude: coordinatesAreValid ? value.longitude! : null,
    provider: coordinatesAreValid ? nextProvider : null,
    place_id: coordinatesAreValid ? nextPlaceId : null,
    source,
    geocoding_status: status,
    fingerprint: '',
  };
  // The fingerprint describes these normalized fields, so never retain a
  // caller-supplied digest after the address text has changed. Recomputing is
  // deterministic and also upgrades legacy records with missing metadata.
  normalized.fingerprint = australianAddressFingerprint(normalized);
  return normalized;
}

export function australianAddressFromInstallation(
  installation: Partial<Installation> | undefined,
): AustralianAddress {
  return normalizeAustralianAddress({
    display_address: installation?.site_address ?? '',
    locality: installation?.site_locality,
    state: installation?.site_state,
    postcode: installation?.site_postcode,
    country_code: 'AU',
    latitude: installation?.site_latitude,
    longitude: installation?.site_longitude,
    provider: installation?.site_geocode_provider,
    place_id: installation?.site_geocode_place_id,
    source: installation?.site_address_source,
    geocoding_status: installation?.site_geocoding_status,
    fingerprint: installation?.site_address_fingerprint,
  });
}

/** Any authored address-part edit invalidates coordinates that described the previous text. */
export function manualAustralianAddressEdit(
  current: AustralianAddress,
  patch: Partial<Pick<AustralianAddress, 'display_address' | 'locality' | 'state' | 'postcode'>>,
): AustralianAddress {
  return normalizeAustralianAddress({
    ...current,
    ...patch,
    latitude: null,
    longitude: null,
    provider: null,
    place_id: null,
    source: 'manual',
    geocoding_status: 'unresolved',
    fingerprint: '',
  });
}

export function installationAddressFields(address: AustralianAddress): Pick<
  Installation,
  | 'site_address'
  | 'site_locality'
  | 'site_state'
  | 'site_postcode'
  | 'site_country_code'
  | 'site_latitude'
  | 'site_longitude'
  | 'site_geocode_provider'
  | 'site_geocode_place_id'
  | 'site_address_source'
  | 'site_geocoding_status'
  | 'site_address_fingerprint'
> {
  const normalized = normalizeAustralianAddress(address);
  return {
    site_address: normalized.display_address,
    site_locality: normalized.locality,
    site_state: normalized.state,
    site_postcode: normalized.postcode,
    site_country_code: 'AU',
    site_latitude: normalized.latitude,
    site_longitude: normalized.longitude,
    site_geocode_provider: normalized.provider,
    site_geocode_place_id: normalized.place_id,
    site_address_source: normalized.source,
    site_geocoding_status: normalized.geocoding_status,
    site_address_fingerprint: normalized.fingerprint,
  };
}
