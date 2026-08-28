import type { Installation } from '../types';

/**
 * Additive fields that did not exist in older local installation records.
 * An absent key means that this client has never materialized the server value;
 * it is different from an explicit null chosen after the field was loaded.
 */
export const ADDITIVE_INSTALLATION_FORM_FIELDS = [
  'client_id',
  'client_site_id',
  'customer_name',
  'site_locality',
  'site_state',
  'site_postcode',
  'site_latitude',
  'site_longitude',
  'site_geocode_provider',
  'site_geocode_place_id',
  'site_address_source',
  'site_geocoding_status',
  'site_address_fingerprint',
  'maas',
  'service_type',
  'metering_solution_type',
  'planned_meter_type',
  'custom_job_number',
  'site_contact_name',
  'site_contact_phone',
  'site_contact_email',
  'fergus_job_number',
  'quote_number',
  'job_comments',
  'access_information',
  'warranty_device',
  'monitoring_installed',
  'hardware_installed',
  'solar_capacity_kw',
  'additional_monitoring_required',
  'additional_monitoring_hardware',
] as const satisfies readonly (keyof Installation)[];

/**
 * Opening an upgraded legacy record renders unknown fields as blank controls.
 * Do not turn those display defaults into explicit clears when another field is
 * saved. A non-null value entered by the technician is still authored, and a
 * field that was previously materialized may still be explicitly cleared.
 */
export function preserveUnmaterializedInstallationFields<
  T extends Partial<Installation>,
>(initial: Partial<Installation> | undefined, values: T): T {
  if (!initial) return values;
  const next = { ...values };
  for (const field of ADDITIVE_INSTALLATION_FORM_FIELDS) {
    if (
      !Object.prototype.hasOwnProperty.call(initial, field)
      && next[field] === null
    ) {
      delete next[field];
    }
  }
  return next;
}
