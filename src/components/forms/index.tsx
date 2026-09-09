import { electricalSourceFromSelection, siteAssetMeteringForSave, type SiteAssetMeteringDraft } from '../../domain/electricalCapture';
export type { SiteAssetMeteringDraft } from '../../domain/electricalCapture';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type {
  BoardTypeCode,
  ElectricalAsset,
  ElectricalSource,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeasurementDirection,
  Meter,
  MeterChannelPurpose,
  MeterDevice,
  MeterDeviceType,
  SiteAsset,
  SiteAssetTypeCode,
  WattwatcherChannel,
  Zone,
} from '../../types';
import { BOARD_TYPE_CODES, METER_DEVICE_TYPES, SITE_ASSET_TYPE_CODES } from '../../types';
import {
  BOARD_TYPE_LABELS,
  SITE_ASSET_TYPE_LABELS,
  boardTypeCode,
  boardTypeFromCode,
  cycleSafeBoardCandidates,
  normalizedSiteCode,
  siteAssetTypeCode,
  siteAssetTypeFromCode,
} from '../../domain/installationV2';
import { createId } from '../../utils';
import { useAuth, useTheme } from '../../context/AppProviders';
import {
  Button,
  FormScrollView,
  Card,
  PhotoThumbnailGrid,
  SearchBar,
  TextArea,
  TextField,
  SectionHeader,
} from '../ui';
import { BarcodeScanField, withLegacyOption } from '../BarcodeScanField';
import { ChannelCapabilitiesEditor } from '../ChannelCapabilitiesEditor';
import { assignmentApprovalSignature, type AssignmentTakeoverApprovals } from '../../domain/meterAssignmentTakeover';
import {
  addCustomMeterChannel,
  channelAfterPurposeChange,
  channelAfterSensorRatingChange,
  channelWithModelValidSensor,
  channelsAfterDeviceTypeChange,
  energyFlowLabel,
  meterChannelPurposeLabel,
  meterChannelsNeedLayoutRepair,
  normalizedMeterEditorChannels,
  phaseGroupingLabel,
  removeCustomMeterChannel,
  showsWattwatchersCommissioningSections,
} from '../../domain/meterCommissioning';
import { radii, spacing, typography } from '../../theme';
import { installationIdentityForWrite, validateInstallationIdentity } from '../../domain/installationValidation';
import { preserveUnmaterializedInstallationFields } from '../../domain/installationMetadata';
import {
  assetMeteringChannelDescription,
  assetMeteringDeviceChoices,
  compatibleAssetMeteringChannelIds,
  historicalAssetMeteringSelectionIsReadOnly,
  meteringRemovalPreview,
  resolveDeviceCommissioningDetour,
} from '../../domain/assetMeteringWorkflow';
import {
  SOURCE_BOARD_RESULT_LIMIT,
  inheritedSourceForQuickSwitchboard,
  searchSourceBoards,
  sourceKeyAfterKindSelection,
  type QuickSwitchboardDetails,
} from '../../domain/sourcePicker';
import {
  clearSiteAssetEditorDraft,
  loadSiteAssetEditorDraft,
  saveSiteAssetEditorDraft,
  siteAssetEditorDraftScope,
  type SiteAssetEditorDraftSnapshot,
} from '../../services/siteAssetEditorDraft';
import { booleanConsequenceHint } from '../../domain/accessibilityCopy';
import { searchEligibleMeters } from '../../domain/meterSearch';
import { ClientAddressPicker } from '../ClientAddressPicker';
import {
  australianAddressFromInstallation,
  installationAddressFields,
  manualAustralianAddressEdit,
} from '../../domain/australianAddress';
import {
  DISPLAY_CODE_MAX_LENGTH,
  defaultMeterCustomName,
  nameAfterTypeChange,
} from '../../domain/namingV2';
import {
  PHOTO_NOTE_MAX_LENGTH,
  photoNote,
  removeIndexedPhotoNote,
  setPhotoNote,
} from '../../domain/photoNotes';
import {
  deleteRemovedLocalPhotos,
  pickLocalPhoto,
  takeLocalPhoto,
} from '../../services';
import {
  MAX_REPLACEMENT_METERS,
  MAX_REPLACEMENT_METER_NUMBER_LENGTH,
  normalizeReplacementMeterNumbers,
  replacementMeterNumbersFromStored,
  storedReplacementMeterNumbers,
} from '../../domain/replacementMeterPlanning';

const ELIGIBLE_METER_RESULT_LIMIT = 100;
const FIELD_WORK_TYPES = ['M1 - New install', 'M2 - Faults / COMMS fault', 'M3 - Inspection', 'M4 - BD/Upselling', 'M5 - '];
const FIELD_WORK_TYPE_LABELS: Record<string, string> = {
  'M1 - New install': 'M1 — New install',
  'M2 - Faults / COMMS fault': 'M2 — Faults / COMMS fault',
  'M3 - Inspection': 'M3 — Inspection',
  'M4 - BD/Upselling': 'M4 — BD/Upselling',
  'M5 - ': 'M5 — Other',
};
const OTHER_WORK_TYPE = 'M5 - ';
const METERING_TYPES = ['NEM meter', 'Revenue metering', 'Monitoring / sub-meter', 'Water meter'];
const OTHER_METERING_TYPE = '__other_metering_type__';

export function SelectChips<T extends string>({
  label,
  value,
  options,
  onChange,
  getLabel = (option) => option,
  disabled = false,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
  getLabel?: (v: T) => string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: 8 }]}>{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
      >
        {options.map((opt, index) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt || `empty-${index}`}
              onPress={() => onChange(opt)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${getLabel(opt)}`}
              accessibilityHint={`${index + 1} of ${options.length}${active ? ', selected' : ''}`}
              accessibilityState={{ checked: active, disabled }}
              style={{
                paddingHorizontal: 10,
                minHeight: 44,
                justifyContent: 'center',
                paddingVertical: 10,
                borderRadius: radii.full,
                backgroundColor: active ? colors.primary : colors.muted,
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: '600' }}>
                {getLabel(opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function BoolRow({
  label,
  value,
  onChange,
  accessibilityHint,
}: {
  label: string;
  value?: boolean;
  onChange: (v: boolean) => void;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ flex: 1, color: colors.foreground, paddingRight: 12 }}>{label}</Text>
      <Switch
        value={!!value}
        onValueChange={onChange}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint ?? booleanConsequenceHint(label, Boolean(value))}
        accessibilityState={{ checked: Boolean(value) }}
      />
    </View>
  );
}

function PhotoAttachmentField({
  label,
  uris,
  photoNotes,
  noteField,
  onChange,
  single = false,
}: {
  label: string;
  uris: string[];
  photoNotes?: Record<string, string>;
  noteField: string;
  onChange: (uris: string[], photoNotes: Record<string, string>) => void;
  single?: boolean;
}) {
  const { colors } = useTheme();
  const [photoBusy, setPhotoBusy] = useState(false);

  const addPhoto = async (source: 'camera' | 'library') => {
    setPhotoBusy(true);
    try {
      const uri = source === 'camera' ? await takeLocalPhoto() : await pickLocalPhoto();
      if (uri) onChange(single ? [uri] : [...uris, uri], photoNotes ?? {});
    } catch (error) {
      Alert.alert(
        'Photo not added',
        error instanceof Error ? error.message : 'The photo could not be added.',
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const confirmRemove = (uri: string, index: number) => {
    Alert.alert('Remove photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const nextNotes = single
            ? setPhotoNote(photoNotes, noteField, '')
            : removeIndexedPhotoNote(photoNotes, noteField, index);
          onChange(single ? [] : uris.filter((_, itemIndex) => itemIndex !== index), nextNotes);
        },
      },
    ]);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>
        {label}
      </Text>
      {uris.length ? (
        <>
          <PhotoThumbnailGrid uris={uris} onRemove={confirmRemove} />
          {uris.map((uri, index) => {
            const fieldName = single ? noteField : `${noteField}[${index}]`;
            return (
              <TextArea
                key={`${uri}:${index}:note`}
                label={`${label} ${index + 1} title / notes / comments`}
                value={photoNote(photoNotes, fieldName)}
                maxLength={PHOTO_NOTE_MAX_LENGTH}
                placeholder="Add context for this photo"
                onChangeText={(value) => onChange(uris, setPhotoNote(photoNotes, fieldName, value))}
              />
            );
          })}
        </>
      ) : (
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
          No photo attached.
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Button
          title={photoBusy
            ? 'Opening…'
            : uris.length
              ? single ? 'Retake photo' : 'Take another photo'
              : 'Take photo'}
          disabled={photoBusy}
          onPress={() => { void addPhoto('camera'); }}
          style={{ flex: 1 }}
        />
        <Button
          title={uris.length
            ? single ? 'Replace from library' : 'Choose another photo'
            : 'Choose photo'}
          variant="secondary"
          disabled={photoBusy}
          onPress={() => { void addPhoto('library'); }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

export function InstallationForm({
  initial,
  initialElectricityNmi = '',
  knownReplacementMeters = [],
  onSubmit,
  submitLabel = 'Save',
}: {
  initial?: Partial<Installation>;
  initialElectricityNmi?: string;
  knownReplacementMeters?: Array<{ meterId: string; meterNumber: string; label: string }>;
  onSubmit: (values: Pick<Installation,
    | 'client_id'
    | 'client_site_id'
    | 'client_name'
    | 'site_name'
    | 'site_code'
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
    | 'inspector_name'
    | 'audit_date'
    | 'timezone'
    | 'maas'
    | 'service_type'
    | 'existing_device_id'
    | 'metering_solution_type'
    | 'custom_job_number'
    | 'site_contact_name'
    | 'site_contact_phone'
    | 'site_contact_email'
    | 'job_comments'
    | 'access_information'
    | 'warranty_device'
    | 'monitoring_installed'
    | 'hardware_installed'
    | 'solar_capacity_kw'
    | 'additional_monitoring_required'
    | 'additional_monitoring_hardware'
  >, planning: { electricityNmi: string | null }) => Promise<void> | void;
  submitLabel?: string;
}) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [client_id, setClientId] = useState(initial?.client_id ?? null);
  const [client_site_id, setClientSiteId] = useState(initial?.client_site_id ?? null);
  const [client_name, setClient] = useState(initial?.client_name ?? '');
  const [site_name, setSite] = useState(initial?.site_name ?? '');
  const [site_code, setSiteCode] = useState(
    initial?.site_code ?? '',
  );
  const siteCodeEdited = useRef(Boolean(initial?.site_code?.trim()));
  const siteNameEdited = useRef(Boolean(initial?.site_name?.trim()));
  const [siteAddress, setSiteAddress] = useState(
    australianAddressFromInstallation(initial),
  );
  const [inspector_name, setInspector] = useState(initial?.inspector_name ?? user?.full_name ?? user?.email ?? '');
  const [audit_date, setDate] = useState(initial?.audit_date ?? new Date().toISOString().slice(0, 10));
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? 'Australia/Sydney',
  );
  const [electricity_nmi, setElectricityNmi] = useState(initialElectricityNmi);
  const [maas, setMaas] = useState<'unknown' | 'yes' | 'no'>(
    initial?.maas === true ? 'yes' : initial?.maas === false ? 'no' : 'unknown',
  );
  const initialServiceType = initial?.service_type ?? '';
  const [service_type, setServiceType] = useState(
    initialServiceType,
  );
  const [replacement_meter_numbers, setReplacementMeterNumbers] = useState(
    replacementMeterNumbersFromStored(initial?.existing_device_id),
  );
  const [replacement_meter_entry, setReplacementMeterEntry] = useState('');
  const initialMeteringType = initial?.metering_solution_type ?? '';
  const [metering_solution_type, setMeteringSolutionType] = useState(
    METERING_TYPES.includes(initialMeteringType) ? initialMeteringType : initialMeteringType ? OTHER_METERING_TYPE : '',
  );
  const [other_metering_type, setOtherMeteringType] = useState(
    METERING_TYPES.includes(initialMeteringType) ? '' : initialMeteringType,
  );
  const [custom_job_number, setCustomJobNumber] = useState(initial?.custom_job_number ?? '');
  const [site_contact_name, setContactName] = useState(initial?.site_contact_name ?? '');
  const [site_contact_phone, setContactPhone] = useState(initial?.site_contact_phone ?? '');
  const [site_contact_email, setContactEmail] = useState(initial?.site_contact_email ?? '');
  const [job_comments, setJobComments] = useState(initial?.job_comments ?? '');
  const [access_information, setAccessInformation] = useState(initial?.access_information ?? '');
  const [warranty_device] = useState<'unknown' | 'yes' | 'no'>(
    initial?.warranty_device === true ? 'yes' : initial?.warranty_device === false ? 'no' : 'unknown',
  );
  const [monitoring_installed] = useState<'unknown' | 'yes' | 'no'>(
    initial?.monitoring_installed === true ? 'yes' : initial?.monitoring_installed === false ? 'no' : 'unknown',
  );
  const [hardware_installed] = useState<'unknown' | 'yes' | 'no'>(
    initial?.hardware_installed === true ? 'yes' : initial?.hardware_installed === false ? 'no' : 'unknown',
  );
  const [solar_capacity_kw] = useState(
    initial?.solar_capacity_kw === null || initial?.solar_capacity_kw === undefined
      ? ''
      : String(initial.solar_capacity_kw),
  );
  const [additional_monitoring_required] = useState<'unknown' | 'yes' | 'no'>(
    initial?.additional_monitoring_required === true
      ? 'yes'
      : initial?.additional_monitoring_required === false ? 'no' : 'unknown',
  );
  const [additional_monitoring_hardware] = useState(
    initial?.additional_monitoring_hardware ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ReturnType<typeof validateInstallationIdentity>>([]);
  const errorFor = (field: string) => validationErrors.find((error) => error.field === field)?.message;
  const selectedReplacementMeterKeys = new Set(
    replacement_meter_numbers.map((value) => value.toLocaleLowerCase('en-AU')),
  );
  const addReplacementMeter = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized || normalized.length > MAX_REPLACEMENT_METER_NUMBER_LENGTH) return;
    setReplacementMeterNumbers((current) => normalizeReplacementMeterNumbers([...current, normalized]));
    setReplacementMeterEntry('');
  };
  const removeReplacementMeter = (candidate: string) => {
    const key = candidate.toLocaleLowerCase('en-AU');
    setReplacementMeterNumbers((current) => current.filter(
      (value) => value.toLocaleLowerCase('en-AU') !== key,
    ));
  };

  return (
    <View>
      <SectionHeader title="Client and service" />
      {initial?.client_id && initial.client_site_id ? (
        <Card style={{ marginBottom: spacing.md }} accessibilityRole="summary">
          <Text style={{ color: colors.foreground, fontWeight: '800' }}>Existing site linked</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
            Saving edits updates the shared client, site, and installed-device association. Use
            “Save as a new client” or “Add a new address” only when this should be a separate record.
          </Text>
        </Card>
      ) : null}
      <ClientAddressPicker
        clientName={client_name}
        clientId={client_id}
        clientError={errorFor('client_name')}
        siteName={site_name}
        address={siteAddress}
        addressError={errorFor('site_address')}
        onClientChange={(name, nextClientId) => {
          if (nextClientId !== client_id) setClientSiteId(null);
          setClientId(nextClientId);
          setClient(name);
        }}
        onAddressChange={(nextAddress, nextClientSiteId, suggestedSiteName) => {
          setSiteAddress(nextAddress);
          if (nextClientSiteId !== undefined) setClientSiteId(nextClientSiteId);
          if (suggestedSiteName && (!site_name.trim() || !siteNameEdited.current)) {
            setSite(suggestedSiteName);
            if (!siteCodeEdited.current) setSiteCode(normalizedSiteCode(suggestedSiteName));
          }
        }}
      >
        <TextField
          label="Electricity NMI"
          value={electricity_nmi}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={100}
          onChangeText={setElectricityNmi}
        />
        <SelectChips
          label="MaaS"
          value={maas}
          options={['unknown', 'yes', 'no']}
          onChange={setMaas}
          getLabel={(value) => value === 'unknown' ? 'Not recorded' : value === 'yes' ? 'Yes' : 'No'}
        />
        <SelectChips
          label="Scope categorization"
          value={service_type && !FIELD_WORK_TYPES.includes(service_type) ? OTHER_WORK_TYPE : service_type}
          options={['', ...FIELD_WORK_TYPES]}
          onChange={(value) => {
            setServiceType(value);
            if (value !== 'M2 - Faults / COMMS fault') setReplacementMeterNumbers([]);
          }}
          getLabel={(value) => value ? FIELD_WORK_TYPE_LABELS[value] : 'Select scope'}
        />
        {service_type && !FIELD_WORK_TYPES.slice(0, 4).includes(service_type) ? <TextField label="Other scope" value={service_type.startsWith(OTHER_WORK_TYPE) ? service_type.slice(OTHER_WORK_TYPE.length) : service_type} maxLength={115} onChangeText={(value) => setServiceType(`${OTHER_WORK_TYPE}${value}`)} /> : null}
        {service_type === 'M2 - Faults / COMMS fault' ? (
          <Card style={{ marginBottom: spacing.md }} accessibilityRole="summary">
            <Text style={{ color: colors.foreground, fontWeight: '800' }}>Meters to replace</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
              Select one or more known site meters, or add a meter number that is not listed.
            </Text>
            {knownReplacementMeters.length ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                {knownReplacementMeters.map((meter) => {
                  const selected = selectedReplacementMeterKeys.has(
                    meter.meterNumber.toLocaleLowerCase('en-AU'),
                  );
                  return (
                    <Button
                      key={meter.meterId}
                      title={`${selected ? 'Selected' : 'Select'} · ${meter.label}`}
                      variant={selected ? 'primary' : 'secondary'}
                      disabled={!selected && replacement_meter_numbers.length >= MAX_REPLACEMENT_METERS}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => selected
                        ? removeReplacementMeter(meter.meterNumber)
                        : addReplacementMeter(meter.meterNumber)}
                    />
                  );
                })}
              </View>
            ) : (
              <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
                No copied site meters are available to suggest.
              </Text>
            )}
            <TextField
              label="Add another meter / device number"
              value={replacement_meter_entry}
              maxLength={MAX_REPLACEMENT_METER_NUMBER_LENGTH}
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setReplacementMeterEntry}
            />
            <Button
              title="Add meter"
              variant="secondary"
              disabled={!replacement_meter_entry.trim() || replacement_meter_numbers.length >= MAX_REPLACEMENT_METERS}
              onPress={() => addReplacementMeter(replacement_meter_entry)}
            />
            {replacement_meter_numbers.length ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.md }} accessibilityLabel="Selected meters to replace">
                {replacement_meter_numbers.map((meterNumber) => (
                  <Button
                    key={meterNumber.toLocaleLowerCase('en-AU')}
                    title={`Remove ${meterNumber}`}
                    variant="ghost"
                    onPress={() => removeReplacementMeter(meterNumber)}
                  />
                ))}
              </View>
            ) : (
              <Text style={{ color: colors.destructive, marginTop: spacing.sm, fontWeight: '700' }}>
                Select or add at least one meter for an M2 job.
              </Text>
            )}
          </Card>
        ) : null}
        <SelectChips label="Metering type selection" value={metering_solution_type} options={['', ...METERING_TYPES, OTHER_METERING_TYPE]} onChange={setMeteringSolutionType} getLabel={(value) => value === OTHER_METERING_TYPE ? 'Other' : value || 'Select metering type'} />
        {metering_solution_type === OTHER_METERING_TYPE ? <TextField label="Other metering type" value={other_metering_type} maxLength={120} onChangeText={setOtherMeteringType} /> : null}
        <TextField label="Custom job number" value={custom_job_number} maxLength={100} onChangeText={setCustomJobNumber} />

        <SectionHeader title="Site and schedule" />
        <TextField
          label="Site name"
          placeholder="Defaults to Untitled installation"
          value={site_name}
          error={errorFor('site_name')}
          onChangeText={(value) => {
            siteNameEdited.current = true;
            setSite(value);
            if (!siteCodeEdited.current) setSiteCode(normalizedSiteCode(value));
          }}
        />
        <TextField
          label="Site code (optional)"
          accessibilityHint="Used as the first segment of generated board, asset, and meter codes"
          value={site_code}
          error={errorFor('site_code')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          onChangeText={(value) => {
            siteCodeEdited.current = true;
            setSiteCode(value.toUpperCase());
          }}
        />
      </ClientAddressPicker>
      <TextField
        label="Suburb / locality"
        value={siteAddress.locality ?? ''}
        maxLength={120}
        onChangeText={(value) => {
          setSiteAddress(manualAustralianAddressEdit(siteAddress, { locality: value }));
        }}
      />
      <SelectChips
        label="State / territory"
        value={siteAddress.state ?? 'unknown'}
        options={['unknown', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']}
        onChange={(value) => {
          setSiteAddress(manualAustralianAddressEdit(siteAddress, {
            state: value === 'unknown' ? null : value,
          }));
        }}
        getLabel={(value) => value === 'unknown' ? 'Not confirmed' : value}
      />
      <TextField
        label="Country"
        value={siteAddress.country_code === 'AU' ? 'Australia (AU)' : siteAddress.country_code}
        editable={false}
      />
      <TextField
        label="Postcode"
        value={siteAddress.postcode ?? ''}
        keyboardType="number-pad"
        maxLength={4}
        onChangeText={(value) => {
          setSiteAddress(manualAustralianAddressEdit(siteAddress, { postcode: value }));
        }}
      />
      <TextField label="Assigned technician" value={inspector_name} error={errorFor('inspector_name')} onChangeText={setInspector} />
      <TextField label="Scheduled date (YYYY-MM-DD)" value={audit_date} error={errorFor('audit_date')} onChangeText={setDate} />
      <TextField
        label="Installation timezone"
        accessibilityHint="Use an IANA timezone such as Australia/Sydney"
        value={timezone}
        error={errorFor('timezone')}
        onChangeText={setTimezone}
      />

      <SectionHeader title="Site contact and access" />
      <TextField label="Site contact name" value={site_contact_name} maxLength={300} onChangeText={setContactName} />
      <TextField
        label="Site contact phone"
        value={site_contact_phone}
        keyboardType="phone-pad"
        maxLength={50}
        onChangeText={setContactPhone}
      />
      <TextField
        label="Site contact email"
        value={site_contact_email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={320}
        onChangeText={setContactEmail}
      />
      <TextArea
        label="Access information"
        accessibilityHint="Operational access details visible only to users authorised for this installation"
        value={access_information}
        maxLength={5000}
        onChangeText={setAccessInformation}
      />

      <SectionHeader title="Job notes" />
      <TextArea label="Job comments / scope notes" value={job_comments} maxLength={5000} onChangeText={setJobComments} />

      {validationErrors.length ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ color: colors.destructive, marginBottom: spacing.md, lineHeight: 20 }}
        >
          {validationErrors.length} installation detail{validationErrors.length === 1 ? '' : 's'} need attention. Correct the labelled fields above.
        </Text>
      ) : null}
      <Button
        title={busy ? 'Saving…' : submitLabel}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            if (!initial && (!service_type || service_type === OTHER_WORK_TYPE)) {
              Alert.alert('Select scope', 'Choose a scope category and enter the Other scope when applicable.');
              return;
            }
            if (metering_solution_type === OTHER_METERING_TYPE && !other_metering_type.trim()) {
              Alert.alert('Enter metering type', 'Enter the Other metering type before saving.');
              return;
            }
            if (
              service_type === 'M2 - Faults / COMMS fault'
              && replacement_meter_numbers.length === 0
            ) {
              Alert.alert('Select meters to replace', 'Select or add at least one meter for an M2 job.');
              return;
            }
            if (siteAddress.postcode && !/^\d{4}$/.test(siteAddress.postcode)) {
              Alert.alert('Check postcode', 'Australian postcodes must contain exactly four digits.');
              return;
            }
            const parsedSolarCapacity = solar_capacity_kw.trim()
              ? Number(solar_capacity_kw.trim())
              : null;
            if (
              parsedSolarCapacity !== null
              && (
                !Number.isFinite(parsedSolarCapacity)
                || parsedSolarCapacity < 0
                || parsedSolarCapacity > 1_000_000
              )
            ) {
              Alert.alert('Check solar capacity', 'Solar capacity must be between 0 and 1,000,000 kW.');
              return;
            }
            const nullableText = (value: string): string | null => value.trim() || null;
            const nullableBoolean = (value: 'unknown' | 'yes' | 'no'): boolean | null => (
              value === 'yes' ? true : value === 'no' ? false : null
            );
            const values = installationIdentityForWrite({
              client_id,
              client_site_id,
              client_name: client_name.trim(),
              site_name: site_name.trim(),
              site_code,
              ...installationAddressFields(siteAddress),
              inspector_name: inspector_name.trim(),
              audit_date: audit_date.trim(),
              timezone: timezone.trim(),
              maas: nullableBoolean(maas),
              service_type: nullableText(service_type),
              existing_device_id: service_type === 'M2 - Faults / COMMS fault'
                ? storedReplacementMeterNumbers(replacement_meter_numbers)
                : null,
              metering_solution_type: nullableText(metering_solution_type === OTHER_METERING_TYPE ? other_metering_type : metering_solution_type),
              custom_job_number: nullableText(custom_job_number),
              site_contact_name: nullableText(site_contact_name),
              site_contact_phone: nullableText(site_contact_phone),
              site_contact_email: nullableText(site_contact_email),
              job_comments: nullableText(job_comments),
              access_information: nullableText(access_information),
              warranty_device: nullableBoolean(warranty_device),
              monitoring_installed: nullableBoolean(monitoring_installed),
              hardware_installed: nullableBoolean(hardware_installed),
              solar_capacity_kw: parsedSolarCapacity,
              additional_monitoring_required: nullableBoolean(additional_monitoring_required),
              additional_monitoring_hardware: nullableText(additional_monitoring_hardware),
            }, initial);
            const errors = validateInstallationIdentity(values, initial);
            if (errors.length) {
              setValidationErrors(errors);
              return;
            }
            setValidationErrors([]);
            await onSubmit(
              preserveUnmaterializedInstallationFields(initial, values),
              { electricityNmi: nullableText(electricity_nmi) },
            );
          } catch (error) {
            Alert.alert('Installation not saved', error instanceof Error ? error.message : 'Please try saving again.');
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

export function ElectricalAssetForm({
  initial,
  sourceBoards = [],
  gridSupplies = [],
  zones = [],
  onSubmit,
}: {
  initial?: Partial<ElectricalAsset>;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  zones?: Zone[];
  onSubmit: (values: Omit<ElectricalAsset, 'id' | 'created_at' | 'updated_at' | 'meters' | 'extra_photos'> & {
    meters?: Meter[];
    extra_photos?: string[];
  }, options: { commissionMeter: boolean; removeMeters: boolean }) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const initialTypeCode = initial?.type_code ?? boardTypeCode(initial?.asset_type ?? 'DB');
  const initialDefaultName = initialTypeCode === 'OTHER'
    ? initial?.custom_type_name?.trim() || BOARD_TYPE_LABELS[initialTypeCode]
    : BOARD_TYPE_LABELS[initialTypeCode];
  const [asset_name, setName] = useState(initial?.asset_name?.trim() || initialDefaultName);
  const nameEdited = useRef(Boolean(initial?.asset_name?.trim()));
  const display_code = initial?.display_code ?? '';
  const customCode = Boolean(initial?.display_code_meta?.isOverridden);
  const [type_code, setTypeCode] = useState<BoardTypeCode>(
    initialTypeCode,
  );
  const [custom_type_name, setCustomTypeName] = useState(initial?.custom_type_name ?? '');
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [photo, setPhoto] = useState(initial?.photo ?? '');
  const [extra_photos, setExtraPhotos] = useState(initial?.extra_photos ?? []);
  const [photo_notes, setPhotoNotes] = useState(initial?.photo_notes ?? {});
  const [sub_circuits_description, setSubCircuitsDescription] = useState(
    initial?.sub_circuits_description ?? '',
  );
  const [amperage_rating, setAmps] = useState(initial?.amperage_rating ?? '');
  const initialSource = initial?.electrical_source ?? (
    initial?.electrical_parent_tbc
      ? { kind: 'TBC' as const }
      : initial?.electrical_parent_id
        ? { kind: 'BOARD' as const, boardId: initial.electrical_parent_id }
        : { kind: 'TBC' as const }
  );
  const [sourceKey, setSourceKey] = useState(
    initialSource.kind === 'GRID'
      ? `GRID:${initialSource.gridSupplyId}`
      : initialSource.kind === 'BOARD'
        ? `BOARD:${initialSource.boardId}`
        : 'TBC',
  );
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [parentSearch, setParentSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const parentCandidateResults = useMemo(() => {
    const safe = cycleSafeBoardCandidates(sourceBoards, initial?.id);
    return searchSourceBoards(
      safe,
      zones,
      parentSearch,
      SOURCE_BOARD_RESULT_LIMIT,
      sourceKey.startsWith('BOARD:') ? sourceKey.slice(6) : undefined,
    );
  }, [initial?.id, parentSearch, sourceBoards, sourceKey, zones]);
  const parentCandidates = parentCandidateResults.visible;
  const sourceKind = sourceKey === 'TBC'
    ? 'TBC'
    : sourceKey.startsWith('GRID:')
      ? 'GRID'
      : 'BOARD';

  return (
    <View>
      <TextField
        label="Switchboard name"
        value={asset_name}
        maxLength={DISPLAY_CODE_MAX_LENGTH}
        error={asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH
          ? `Use ${DISPLAY_CODE_MAX_LENGTH} characters or fewer.`
          : undefined}
        onChangeText={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      <SelectChips
        label="Switchboard type"
        value={type_code}
        options={BOARD_TYPE_CODES}
        getLabel={(value) => BOARD_TYPE_LABELS[value]}
        onChange={(value) => {
          if (!nameEdited.current) setName(BOARD_TYPE_LABELS[value]);
          setTypeCode(value);
        }}
      />
      {type_code === 'OTHER' ? (
        <TextField label="Custom switchboard type" value={custom_type_name} onChangeText={(value) => {
          setCustomTypeName(value);
          if (!nameEdited.current) {
            setName((value.trim() || BOARD_TYPE_LABELS.OTHER).slice(0, DISPLAY_CODE_MAX_LENGTH));
          }
        }} />
      ) : null}
      <TextField
        label="Generated asset ID"
        value={display_code || 'Generated when saved'}
        editable={false}
      />
      <SelectChips
        label="What supplies this switchboard?"
        value={sourceKind}
        options={['GRID', 'BOARD', 'TBC']}
        getLabel={(value) => value === 'GRID' ? 'Grid / incoming supply' : value === 'BOARD' ? 'Another switchboard' : 'To be confirmed'}
        onChange={(value) => {
          if (value === 'TBC') setSourceKey('TBC');
          else if (value === 'GRID') setSourceKey(`GRID:${gridSupplies.find((item) => item.isDefault)?.id ?? gridSupplies[0]?.id ?? ''}`);
          else setSourceKey(sourceKeyAfterKindSelection('BOARD'));
        }}
      />
      {sourceKind === 'GRID' ? (
        <SelectChips
          label="Grid supply"
          value={sourceKey}
          options={gridSupplies.map((grid) => `GRID:${grid.id}`)}
          getLabel={(value) => {
            const grid = gridSupplies.find((item) => `GRID:${item.id}` === value);
            return grid ? `${grid.name}${grid.isDefault ? ' · default' : ''}` : 'Grid supply';
          }}
          onChange={setSourceKey}
        />
      ) : null}
      {sourceKind === 'BOARD' ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>Confirmed parent</Text>
          <SearchBar
            value={parentSearch}
            onChangeText={setParentSearch}
            placeholder="Search name, type, zone, or ID"
          />
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
            {parentCandidateResults.total > SOURCE_BOARD_RESULT_LIMIT
              ? `Showing ${SOURCE_BOARD_RESULT_LIMIT} of ${parentCandidateResults.total} cycle-safe matches. Refine the search to choose another board.`
              : `${parentCandidateResults.total} cycle-safe parent${parentCandidateResults.total === 1 ? '' : 's'}.`}
            {parentCandidateResults.selectedPinned ? ' The selected parent remains pinned.' : ''}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Parent board">
            {parentCandidates.map((board) => {
              const value = `BOARD:${board.id}`;
              const selected = sourceKey === value;
              const zone = zones.find((item) => item.id === board.zone_id);
              return (
                <Pressable
                  key={board.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${board.asset_name}, ${board.asset_type}, ${zone?.zone_name ?? 'unknown zone'}`}
                  onPress={() => setSourceKey(value)}
                  style={{
                    minHeight: 54,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    marginBottom: spacing.sm,
                    backgroundColor: selected ? colors.muted : colors.card,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {selected ? '✓ ' : ''}{board.asset_name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                    {board.asset_type} · {zone?.zone_name ?? 'Unknown zone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!parentCandidateResults.total ? (
            <Text style={{ color: colors.mutedForeground }}>No cycle-safe parent matches this search.</Text>
          ) : null}
        </View>
      ) : null}
      <TextField label="Location description" value={location_description} onChangeText={setLoc} />
      <PhotoAttachmentField
        label="Main switchboard photo"
        uris={photo ? [photo] : []}
        photoNotes={photo_notes}
        noteField="photo"
        single
        onChange={(uris, notes) => {
          setPhoto(uris[0] ?? '');
          setPhotoNotes(notes);
        }}
      />
      <TextField label="Amperage rating" value={amperage_rating} onChangeText={setAmps} />
      <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.xs }]}>Electricity NMI</Text>
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
        Electricity NMI is managed on the incoming Grid supply. Historical board NMI data is retained read-only for compatibility.
      </Text>
      <TextArea
        label="Sub-circuits description"
        value={sub_circuits_description}
        onChangeText={setSubCircuitsDescription}
        placeholder="Outgoing circuits from this board"
      />
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <PhotoAttachmentField
        label="Extra photos"
        uris={extra_photos}
        photoNotes={photo_notes}
        noteField="extraPhotos"
        onChange={(uris, notes) => {
          setExtraPhotos(uris);
          setPhotoNotes(notes);
        }}
      />
      <Button
        title={busy ? 'Saving…' : 'Save switchboard'}
        disabled={busy || asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH}
        onPress={async () => {
          setBusy(true);
          try {
            const normalizedSource = electricalSourceFromSelection(
              sourceKey, cycleSafeBoardCandidates(sourceBoards, initial?.id), gridSupplies,
            );
            await onSubmit({
              audit_id: initial?.audit_id ?? '',
              zone_id: initial?.zone_id ?? '',
              asset_name: asset_name.trim() || (type_code === 'OTHER' ? custom_type_name.trim() : '') || BOARD_TYPE_LABELS[type_code],
              display_code: customCode ? display_code : initial?.display_code_meta?.value ?? '',
              display_code_meta: customCode
                ? {
                    value: display_code.trim(),
                    generatedValue: initial?.display_code_meta?.generatedValue ?? display_code.trim(),
                    isOverridden: true,
                    ruleVersion: 1,
                    overrideReason: 'Installer custom code',
                    provisional: initial?.display_code_meta?.provisional ?? true,
                  }
                : initial?.display_code_meta,
              asset_type: boardTypeFromCode(type_code),
              type_code,
              custom_type_name: type_code === 'OTHER' ? custom_type_name.trim() : undefined,
              electrical_source: normalizedSource,
              location_description,
              // Retain imported legacy data on edit, but switchboards no longer
              // author a phase value. Phase belongs to meter/channel mappings.
              phase: initial?.phase,
              amperage_rating,
              site_nmi: initial?.site_nmi,
              electrical_parent_id: normalizedSource.kind === 'BOARD' ? normalizedSource.boardId : null,
              electrical_parent_tbc: normalizedSource.kind === 'TBC',
              photo,
              extra_photos,
              photo_notes,
              meter_present: (initial?.meters?.length ?? 0) > 0,
              sub_circuits_description,
              comments,
              meters: initial?.meters,
            }, {
              commissionMeter: false,
              removeMeters: false,
            });
            deleteRemovedLocalPhotos(
              [initial?.photo, ...(initial?.extra_photos ?? [])],
              [photo, ...extra_photos],
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

export function QuickSwitchboardForm({
  inheritedSource,
  sourceBoards = [],
  gridSupplies = [],
  onSubmit,
}: {
  inheritedSource: ElectricalSource;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  onSubmit: (details: QuickSwitchboardDetails) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState(BOARD_TYPE_LABELS.DB);
  const nameEdited = useRef(false);
  const [typeCode, setTypeCode] = useState<BoardTypeCode>('DB');
  const [customTypeName, setCustomTypeName] = useState('');
  const [busy, setBusy] = useState(false);
  const inheritedLabel = inheritedSource.kind === 'GRID'
    ? gridSupplies.find((grid) => grid.id === inheritedSource.gridSupplyId)?.name ?? 'Incoming grid connection'
    : inheritedSource.kind === 'BOARD'
      ? sourceBoards.find((board) => board.id === inheritedSource.boardId)?.asset_name ?? 'Upstream switchboard'
      : 'To be confirmed';
  const valid = name.trim().length <= DISPLAY_CODE_MAX_LENGTH;

  return (
    <View>
      <TextField
        label={`Switchboard name (${DISPLAY_CODE_MAX_LENGTH} characters max)`}
        value={name}
        maxLength={DISPLAY_CODE_MAX_LENGTH}
        error={name.trim().length > DISPLAY_CODE_MAX_LENGTH
          ? `Use ${DISPLAY_CODE_MAX_LENGTH} characters or fewer.`
          : undefined}
        onChangeText={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      <SelectChips
        label="Switchboard type"
        value={typeCode}
        options={BOARD_TYPE_CODES}
        getLabel={(value) => BOARD_TYPE_LABELS[value]}
        onChange={(value) => {
          if (!nameEdited.current) setName(BOARD_TYPE_LABELS[value]);
          setTypeCode(value);
        }}
      />
      {typeCode === 'OTHER' ? (
        <TextField label="Custom switchboard type" value={customTypeName} onChangeText={(value) => {
          setCustomTypeName(value);
          if (!nameEdited.current) {
            setName((value.trim() || BOARD_TYPE_LABELS.OTHER).slice(0, DISPLAY_CODE_MAX_LENGTH));
          }
        }} />
      ) : null}
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
        Upstream source inherited from the asset: {inheritedLabel}.
      </Text>
      <Button
        title={busy ? 'Adding…' : 'Add and select switchboard'}
        disabled={busy || !valid}
        onPress={() => { void (async () => {
          setBusy(true);
          try {
            await onSubmit({ name: name.trim() || (typeCode === 'OTHER' ? customTypeName.trim() : '') || BOARD_TYPE_LABELS[typeCode], typeCode, customTypeName });
          } finally {
            setBusy(false);
          }
        })(); }}
      />
    </View>
  );
}

export function SiteAssetForm({
  initial,
  sourceBoards = [],
  gridSupplies = [],
  zones = [],
  meterDevices = [],
  measurementAssignments = [],
  siteAssets = [],
  active = false,
  onAddSourceBoard,
  sourceBoardReturnToken = 0,
  newSourceBoardId,
  onAddDevice,
  deviceDetourReturnToken = 0,
  onDraftRestored,
  onDiscardDraft,
  onSubmit,
}: {
  initial?: Partial<SiteAsset>;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  zones?: Zone[];
  meterDevices?: MeterDevice[];
  measurementAssignments?: MeasurementAssignment[];
  siteAssets?: SiteAsset[];
  active?: boolean;
  onAddSourceBoard?: (inheritedSource: ElectricalSource) => void;
  sourceBoardReturnToken?: number;
  newSourceBoardId?: string;
  onAddDevice?: (boardId: string) => void;
  deviceDetourReturnToken?: number;
  onDraftRestored?: () => void;
  onDiscardDraft?: () => void;
  onSubmit: (values: Omit<SiteAsset, 'id' | 'created_at' | 'updated_at' | 'extra_photos' | 'meter_channels'> & {
    extra_photos?: string[];
    meter_channels?: SiteAsset['meter_channels'];
  }, metering: SiteAssetMeteringDraft) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const initialTypeCode = initial?.type_code ?? siteAssetTypeCode(initial?.asset_type ?? 'Other');
  const initialDefaultName = initialTypeCode === 'OTHER'
    ? initial?.custom_type_name?.trim() || SITE_ASSET_TYPE_LABELS[initialTypeCode]
    : SITE_ASSET_TYPE_LABELS[initialTypeCode];
  const [asset_name, setName] = useState(initial?.asset_name?.trim() || initialDefaultName);
  const nameEdited = useRef(Boolean(initial?.asset_name?.trim()));
  const [type_code, setTypeCode] = useState<SiteAssetTypeCode>(
    initialTypeCode,
  );
  const [custom_type_name, setCustomTypeName] = useState(initial?.custom_type_name ?? '');
  const [display_code, setCode] = useState(initial?.display_code ?? '');
  const [customCode, setCustomCode] = useState(Boolean(initial?.display_code_meta?.isOverridden));
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [location_photo, setLocationPhoto] = useState(initial?.location_photo ?? '');
  const [extra_photos, setExtraPhotos] = useState(initial?.extra_photos ?? []);
  const [photo_notes, setPhotoNotes] = useState(initial?.photo_notes ?? {});
  const initialSource = initial?.electrical_source ?? (
    initial?.electrical_board_tbc || !initial?.electrical_board_id
      ? { kind: 'TBC' as const }
      : { kind: 'BOARD' as const, boardId: initial.electrical_board_id }
  );
  const initialSourceKey = initialSource.kind === 'GRID'
    ? `GRID:${initialSource.gridSupplyId}`
    : initialSource.kind === 'BOARD'
      ? `BOARD:${initialSource.boardId}`
      : 'TBC';
  const [sourceKey, setSourceKey] = useState(initialSourceKey);
  const meteringState = initial?.metering_state ?? { kind: 'TBC' as const };
  const initialAssignmentIds = new Set(
    meteringState.kind === 'METERED' ? meteringState.measurementAssignmentIds : [],
  );
  const initialAssignment = meteringState.kind === 'METERED'
    ? measurementAssignments.find((item) =>
        initialAssignmentIds.has(item.id)
        && item.target.kind === 'SITE_ASSET'
        && item.target.siteAssetId === initial?.id)
    : undefined;
  const mappingBaseline = useRef(measurementAssignments.filter((assignment) =>
    assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === initial?.id).map((assignment) => structuredClone(assignment)));
  const [meteringKind, setMeteringKind] = useState<SiteAssetMeteringDraft['kind']>(meteringState.kind);
  const [selectedMeterId, setSelectedMeterId] = useState(initialAssignment?.meterId ?? '');
  const [selectedChannelIds, setSelectedChannelIds] = useState(initialAssignment?.channelIds ?? []);
  const [takeoverApprovals, setTakeoverApprovals] = useState<AssignmentTakeoverApprovals>({});
  const [phaseMode, setPhaseMode] = useState<MeasurementAssignment['phaseMode']>(
    initialAssignment?.phaseMode ?? 'SINGLE_PHASE',
  );
  const [direction, setDirection] = useState<MeasurementDirection | ''>(
    initialAssignment?.direction ?? '',
  );
  const [sourceBoardSearch, setSourceBoardSearch] = useState('');
  const [meterSearch, setMeterSearch] = useState('');
  const [deviceDetour, setDeviceDetour] = useState<{
    beforeMeterIds: string[];
    startReturnToken: number;
  } | null>(null);
  const [meterAnnouncement, setMeterAnnouncement] = useState('');
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [busy, setBusy] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftPersistenceError, setDraftPersistenceError] = useState('');
  const restoredDraft = useRef(false);
  const previousSourceBoardReturnToken = useRef(sourceBoardReturnToken);
  const draftScope = useMemo(() => siteAssetEditorDraftScope({
    assetId: initial?.id,
    installationId: initial?.audit_id,
    zoneId: initial?.zone_id,
  }), [initial?.audit_id, initial?.id, initial?.zone_id]);
  const draftInstallationId = initial?.audit_id ?? '';
  const draftAssetId = initial?.id;
  const selectedSourceBoardId = sourceKey.startsWith('BOARD:') ? sourceKey.slice(6) : '';
  const sourceKind = sourceKey === 'TBC'
    ? 'TBC'
    : sourceKey.startsWith('GRID:')
      ? 'GRID'
      : 'BOARD';
  const sourceBoardResults = useMemo(
    () => searchSourceBoards(
      sourceBoards,
      zones,
      sourceBoardSearch,
      SOURCE_BOARD_RESULT_LIMIT,
      selectedSourceBoardId || undefined,
    ),
    [selectedSourceBoardId, sourceBoardSearch, sourceBoards, zones],
  );
  const meteringDeviceChoices = useMemo(() => assetMeteringDeviceChoices({
    meters: meterDevices,
    assignments: measurementAssignments,
    supplyingBoardId: selectedSourceBoardId || undefined,
    assetId: initial?.id,
    takeoverApprovals,
  }), [initial?.id, measurementAssignments, meterDevices, selectedSourceBoardId, takeoverApprovals]);
  const eligibleMeterChoices = useMemo(
    () => meteringDeviceChoices.filter((choice) => choice.selectable),
    [meteringDeviceChoices],
  );
  const eligibleMeters = useMemo(
    () => eligibleMeterChoices.map((choice) => choice.meter),
    [eligibleMeterChoices],
  );
  const unavailableMeterChoices = useMemo(
    () => meteringDeviceChoices.filter((choice) => !choice.selectable),
    [meteringDeviceChoices],
  );
  const unavailableMeterResults = useMemo(
    () => searchEligibleMeters(
      unavailableMeterChoices.map((choice) => choice.meter),
      meterSearch,
      ELIGIBLE_METER_RESULT_LIMIT,
      selectedMeterId,
      (meter) => {
        const meterBoard = sourceBoards.find((item) => item.id === meter.installedOnBoardId);
        return [meter.deviceNumber, meterBoard?.asset_name];
      },
    ),
    [meterSearch, selectedMeterId, sourceBoards, unavailableMeterChoices],
  );
  const eligibleMeterResults = useMemo(
    () => searchEligibleMeters(
      eligibleMeters,
      meterSearch,
      ELIGIBLE_METER_RESULT_LIMIT,
      selectedMeterId,
      (meter) => {
        const meterBoard = sourceBoards.find((item) => item.id === meter.installedOnBoardId);
        return [meter.deviceNumber, meterBoard?.asset_name];
      },
    ),
    [eligibleMeters, meterSearch, selectedMeterId, sourceBoards],
  );
  const selectedMeter = meterDevices.find((item) => item.id === selectedMeterId);
  const selectedMeterChoice = eligibleMeterChoices.find((choice) => choice.meter.id === selectedMeterId);
  const selectedMeterTopology = meteringDeviceChoices.find((choice) => choice.meter.id === selectedMeterId);
  const selectableChannelIds = useMemo(() => new Set(
    selectedMeterChoice?.channels.filter((choice) => choice.selectable).map((choice) => choice.channel.id) ?? [],
  ), [selectedMeterChoice]);
  const selectedPhaseCount = phaseMode === 'SINGLE_PHASE' ? 1 : phaseMode === 'THREE_PHASE' ? 3 : null;
  const selectedGroupComplete = selectedPhaseCount === null
    ? selectedChannelIds.length > 0
    : selectedChannelIds.length === selectedPhaseCount;
  const removalPreview = useMemo(
    () => meteringRemovalPreview(initial?.metering_state, measurementAssignments, meterDevices),
    [initial?.metering_state, measurementAssignments, meterDevices],
  );

  const currentDraftSnapshot = (
    detourOverride: typeof deviceDetour = deviceDetour,
  ): SiteAssetEditorDraftSnapshot => ({
    version: 1,
    assetName: asset_name,
    typeCode: type_code,
    customTypeName: custom_type_name,
    displayCode: display_code,
    customCode,
    locationDescription: location_description,
    locationPhoto: location_photo,
    extraPhotos: extra_photos,
    photoNotes: photo_notes,
    sourceKey,
    sourceBoardSearch,
    meteringKind,
    selectedMeterId,
    selectedChannelIds,
    phaseMode,
    direction,
    meterSearch,
    comments,
    deviceDetour: detourOverride,
  });

  useEffect(() => {
    let live = true;
    setDraftHydrated(false);
    const applySaved = (saved: SiteAssetEditorDraftSnapshot) => {
      if (!live) return;
      restoredDraft.current = true;
      nameEdited.current = true;
      setName(saved.assetName);
      setTypeCode(saved.typeCode);
      setCustomTypeName(saved.customTypeName);
      setCode(saved.displayCode);
      setCustomCode(saved.customCode);
      setLoc(saved.locationDescription);
      setLocationPhoto(saved.locationPhoto ?? initial?.location_photo ?? '');
      setExtraPhotos(saved.extraPhotos ?? initial?.extra_photos ?? []);
      setPhotoNotes(saved.photoNotes ?? initial?.photo_notes ?? {});
      setSourceKey(saved.sourceKey);
      setSourceBoardSearch(saved.sourceBoardSearch);
      setMeteringKind(saved.meteringKind);
      setSelectedMeterId(saved.selectedMeterId);
      setSelectedChannelIds(saved.selectedChannelIds);
      setPhaseMode(saved.phaseMode);
      setDirection(saved.direction);
      setMeterSearch(saved.meterSearch);
      setComments(saved.comments);
      setDeviceDetour(saved.deviceDetour
        ? { ...saved.deviceDetour, startReturnToken: deviceDetourReturnToken - 1 }
        : null);
      setDraftHydrated(true);
      onDraftRestored?.();
    };
    void loadSiteAssetEditorDraft(draftScope).then((result) => {
      if (!live) return;
      if (result.status === 'READY') {
        applySaved(result.draft);
      } else if (result.status === 'CONFLICT') {
        Alert.alert(
          'Saved draft conflicts with newer site data',
          'The installation or asset changed after this recovery draft began. Review it explicitly, or discard it to keep the newer canonical data.',
          [
            {
              text: 'Discard saved draft',
              style: 'destructive',
              onPress: () => { void clearSiteAssetEditorDraft(draftScope).finally(() => {
                if (live) setDraftHydrated(true);
              }); },
            },
            { text: 'Review saved draft', onPress: () => applySaved(result.draft) },
          ],
          { cancelable: false },
        );
      } else {
        setDraftHydrated(true);
        if (result.status === 'CORRUPT') {
          Alert.alert('Recovery draft removed', 'The saved asset draft failed integrity verification and was not applied.');
        }
      }
    }).catch((error) => {
      if (!live) return;
      setDraftHydrated(true);
      setDraftPersistenceError(error instanceof Error ? error.message : 'The recovery draft could not be read.');
    });
    return () => { live = false; };
  }, [draftScope]);

  useEffect(() => {
    if (!draftHydrated || (!active && !restoredDraft.current)) return;
    void saveSiteAssetEditorDraft(draftScope, {
      installationId: draftInstallationId,
      assetId: draftAssetId,
      draft: currentDraftSnapshot(),
    })
      .then(() => setDraftPersistenceError(''))
      .catch((error) => setDraftPersistenceError(
        error instanceof Error ? error.message : 'The asset recovery draft could not be saved.',
      ));
  }, [
    active, asset_name, comments, customCode, custom_type_name, deviceDetour,
    direction, display_code, draftAssetId, draftHydrated, draftInstallationId, draftScope, extra_photos,
    location_description, location_photo, photo_notes,
    meterSearch, meteringKind, phaseMode, selectedChannelIds, selectedMeterId,
    sourceBoardSearch, sourceKey, type_code,
  ]);

  useEffect(() => {
    if (draftHydrated && restoredDraft.current) return;
    if (!selectedMeterId && initialAssignment?.meterId) {
      setSelectedMeterId(initialAssignment.meterId);
      setSelectedChannelIds(initialAssignment.channelIds);
      setPhaseMode(initialAssignment.phaseMode);
      setDirection(initialAssignment.direction);
    }
  }, [draftHydrated, initialAssignment, selectedMeterId]);

  const initialMappingSelectionUnchanged = Boolean(
    initialAssignment
    && selectedMeterId === initialAssignment.meterId
    && sourceKey === initialSourceKey
    && JSON.stringify(selectedChannelIds) === JSON.stringify(initialAssignment.channelIds)
    && phaseMode === initialAssignment.phaseMode
    && direction === initialAssignment.direction,
  );
  const historicalMappingReadOnly = historicalAssetMeteringSelectionIsReadOnly({
    selectionUnchanged: initialMappingSelectionUnchanged,
    selectedChannelIds,
    deviceChoice: selectedMeterChoice,
  });

  useEffect(() => {
    if (!draftHydrated || meteringKind !== 'METERED') return;
    if (!selectedMeterId) {
      if (selectedChannelIds.length) setSelectedChannelIds([]);
      return;
    }
    if (historicalMappingReadOnly) return;
    if (!selectedMeterChoice) {
      // Existing malformed, removed, or moved mappings stay visible read-only
      // so an unrelated asset edit does not silently destroy history.
      setSelectedMeterId('');
      setSelectedChannelIds([]);
      setTakeoverApprovals({});
      setMeterAnnouncement('The previous device selection is no longer compatible with this source or its captured channel topology. Choose an available device.');
      return;
    }
    const retained = compatibleAssetMeteringChannelIds({
      selectedChannelIds,
      deviceChoice: selectedMeterChoice,
    });
    if (retained.length !== selectedChannelIds.length) {
      setSelectedChannelIds(retained);
      setMeterAnnouncement('A channel became unavailable or incompatible and was removed from this asset mapping.');
    }
  }, [
    draftHydrated,
    historicalMappingReadOnly,
    initialMappingSelectionUnchanged,
    meteringKind,
    selectedChannelIds,
    selectedMeterChoice,
    selectedMeterId,
    selectableChannelIds,
  ]);

  useEffect(() => {
    if (previousSourceBoardReturnToken.current === sourceBoardReturnToken) return;
    previousSourceBoardReturnToken.current = sourceBoardReturnToken;
    if (!newSourceBoardId) return;
    setSourceKey(`BOARD:${newSourceBoardId}`);
    setSourceBoardSearch('');
    setSelectedMeterId('');
    setSelectedChannelIds([]);
    setMeterAnnouncement('The new switchboard is selected as this asset’s electrical source.');
  }, [newSourceBoardId, sourceBoardReturnToken]);

  useEffect(() => {
    if (!deviceDetour || deviceDetourReturnToken === deviceDetour.startReturnToken) return;
    const addedEligibleIds = eligibleMeters
      .map((item) => item.id)
      .filter((id) => !deviceDetour.beforeMeterIds.includes(id));
    const resolved = resolveDeviceCommissioningDetour({
      draft: true,
      beforeMeterIds: deviceDetour.beforeMeterIds,
      eligibleAfterMeterIds: eligibleMeters.map((item) => item.id),
      outcome: addedEligibleIds.length ? 'SUCCESS' : 'CANCELLED',
    });
    if (resolved.newMeterId) {
      const commissioned = eligibleMeters.find((item) => item.id === resolved.newMeterId);
      setSelectedMeterId(resolved.newMeterId);
      setSelectedChannelIds([]);
      setMeterAnnouncement(`${commissioned?.displayName.value ?? 'New device'} is selected. Choose its channels.`);
    } else if (addedEligibleIds.length > 1) {
      setMeterAnnouncement('More than one new eligible device was found. Choose the intended device; your asset draft is preserved.');
    } else {
      setMeterAnnouncement('No new device was commissioned. Your asset draft is preserved.');
    }
    setDeviceDetour(null);
  }, [deviceDetour, deviceDetourReturnToken, eligibleMeters]);

  const clearMeteringSelection = () => {
    setSelectedMeterId('');
    setSelectedChannelIds([]);
    setTakeoverApprovals({});
    setMeterSearch('');
  };

  const chooseSourceKey = (nextSourceKey: string) => {
    if (nextSourceKey !== sourceKey) {
      clearMeteringSelection();
      setMeterAnnouncement('The electrical source changed. Choose a compatible device and channels for the new source.');
    }
    setSourceKey(nextSourceKey);
  };

  const applyMeteringKind = (next: SiteAssetMeteringDraft['kind']) => {
    setMeteringKind(next);
    if (next !== 'METERED') {
      clearMeteringSelection();
      setMeterAnnouncement('');
    }
  };

  const requestMeteringKind = (next: SiteAssetMeteringDraft['kind']) => {
    if (
      initial?.metering_state?.kind === 'METERED' &&
      next !== 'METERED' &&
      removalPreview.assignmentIds.length
    ) {
      Alert.alert(
        next === 'UNMETERED' ? 'Confirm unmetered asset' : 'Move metering to TBC',
        [
          `This removes ${removalPreview.assignmentIds.length} exact assignment(s):`,
          removalPreview.assignmentIds.join('\n'),
          removalPreview.channelLabels.length
            ? `Channels released:\n${removalPreview.channelLabels.join('\n')}`
            : 'No channel labels are available.',
          'Commissioning forms and evidence remain retained.',
        ].join('\n\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: next === 'UNMETERED' ? 'Confirm unmetered' : 'Set TBC',
            style: next === 'UNMETERED' ? 'destructive' : 'default',
            onPress: () => applyMeteringKind(next),
          },
        ],
      );
      return;
    }
    applyMeteringKind(next);
  };

  return (
    <View>
      <TextField
        label={`Asset name (${DISPLAY_CODE_MAX_LENGTH} characters max)`}
        value={asset_name}
        maxLength={DISPLAY_CODE_MAX_LENGTH}
        error={asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH
          ? `Use ${DISPLAY_CODE_MAX_LENGTH} characters or fewer.`
          : undefined}
        onChangeText={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      <SelectChips
        label="Asset type"
        value={type_code}
        options={SITE_ASSET_TYPE_CODES}
        getLabel={(value) => SITE_ASSET_TYPE_LABELS[value]}
        onChange={(value) => {
          if (!nameEdited.current) setName(SITE_ASSET_TYPE_LABELS[value]);
          setTypeCode(value);
        }}
      />
      {type_code === 'OTHER' ? (
        <TextField label="Custom asset type" value={custom_type_name} onChangeText={(value) => {
          setCustomTypeName(value);
          if (!nameEdited.current) {
            setName((value.trim() || SITE_ASSET_TYPE_LABELS.OTHER).slice(0, DISPLAY_CODE_MAX_LENGTH));
          }
        }} />
      ) : null}
      <SelectChips
        label="What supplies this asset?"
        value={sourceKind}
        options={['GRID', 'BOARD', 'TBC']}
        getLabel={(value) => {
          if (value === 'GRID') return 'Incoming grid connection';
          if (value === 'BOARD') return 'Switchboard';
          return 'To be confirmed';
        }}
        onChange={(value) => chooseSourceKey(sourceKeyAfterKindSelection(value))}
      />
      <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 20 }}>
        This electrical relationship may cross physical zones.
      </Text>
      {sourceKind === 'GRID' ? (
        <SelectChips
          label="Grid supply"
          value={sourceKey}
          options={gridSupplies.map((grid) => `GRID:${grid.id}`)}
          getLabel={(value) => {
            const grid = gridSupplies.find((item) => `GRID:${item.id}` === value);
            return grid ? `${grid.name}${grid.isDefault ? ' · default' : ''}` : 'Grid supply';
          }}
          onChange={chooseSourceKey}
        />
      ) : null}
      {sourceKind === 'BOARD' ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>Supplying switchboard</Text>
          <SearchBar
            value={sourceBoardSearch}
            onChangeText={setSourceBoardSearch}
            placeholder="Search name, type, or zone"
          />
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
            {sourceBoardResults.total > SOURCE_BOARD_RESULT_LIMIT
              ? `Showing ${SOURCE_BOARD_RESULT_LIMIT} of ${sourceBoardResults.total} matches. Refine the search to choose another board.`
              : `${sourceBoardResults.total} matching board${sourceBoardResults.total === 1 ? '' : 's'}.`}
            {sourceBoardResults.selectedPinned ? ' The selected board remains pinned.' : ''}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Supplying switchboard">
            {sourceBoardResults.visible.map((sourceBoard) => {
              const value = `BOARD:${sourceBoard.id}`;
              const selected = sourceKey === value;
              const sourceZone = zones.find((item) => item.id === sourceBoard.zone_id);
              return (
                <Pressable
                  key={sourceBoard.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${sourceBoard.asset_name}, ${sourceBoard.asset_type}, ${sourceZone?.zone_name ?? 'unknown zone'}`}
                  onPress={() => chooseSourceKey(value)}
                  style={{
                    minHeight: 54,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    marginBottom: spacing.sm,
                    backgroundColor: selected ? colors.muted : colors.card,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {selected ? '✓ ' : ''}{sourceBoard.asset_name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                    {sourceBoard.asset_type} · {sourceZone?.zone_name ?? 'Unknown zone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!sourceBoardResults.total ? (
            <Text style={{ color: colors.mutedForeground }}>No boards match this search.</Text>
          ) : null}
          {onAddSourceBoard ? (
            <Button
              title="Add a new switchboard, then return here"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => {
                void saveSiteAssetEditorDraft(draftScope, {
                  installationId: draftInstallationId,
                  assetId: draftAssetId,
                  draft: currentDraftSnapshot(),
                })
                  .then(() => onAddSourceBoard(inheritedSourceForQuickSwitchboard(
                    sourceKey,
                    initialSource,
                    gridSupplies,
                  )))
                  .catch(() => Alert.alert(
                    'Draft not protected',
                    'The asset draft could not be saved, so switchboard creation was not opened.',
                  ));
              }}
            />
          ) : null}
        </View>
      ) : null}
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <PhotoAttachmentField
        label="Location photo"
        uris={location_photo ? [location_photo] : []}
        photoNotes={photo_notes}
        noteField="locationPhoto"
        single
        onChange={(uris, notes) => {
          setLocationPhoto(uris[0] ?? '');
          setPhotoNotes(notes);
        }}
      />
      <Card style={{ marginBottom: spacing.md }}>
        <SectionHeader title="How is this asset metered?" />
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
          Choose the observed state. Metered assets must be linked to the exact physical device and channels; confirmed-unmetered assets need no device link.
        </Text>
        <SelectChips<SiteAssetMeteringDraft['kind']>
          label="Metering state"
          value={meteringKind}
          options={['METERED', 'UNMETERED', 'TBC']}
          getLabel={(value) => value === 'METERED' ? 'Metered' : value === 'UNMETERED' ? 'Confirmed unmetered' : 'To be confirmed'}
          onChange={requestMeteringKind}
        />
        {meteringKind === 'TBC' ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive, marginBottom: spacing.md, lineHeight: 20 }}>
            This relationship will be saved as TBC. Resolve it before completing the installation.
          </Text>
        ) : null}
        {meteringKind === 'METERED' ? (
          <>
            {initialAssignment && selectedMeterId === initialAssignment.meterId && historicalMappingReadOnly ? <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
              Existing historical mapping: {selectedMeter?.displayName.value || selectedMeterId} · {initialAssignment.channelIds.join(', ')}. It is retained read-only when the source and mapping remain unchanged. {selectedMeterTopology?.topologyIssue ? `${selectedMeterTopology.topologyIssue} ` : ''}Choose a compatible device on the immediate supplying switchboard to replace it.
            </Text> : null}
            {!selectedSourceBoardId ? (
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
                Choose a board as the electrical source before selecting a device installed on that switchboard.
              </Text>
            ) : (
              <>
                <SearchBar
                  value={meterSearch}
                  onChangeText={setMeterSearch}
                  placeholder="Search device ID, name, type, or board"
                />
                <Text style={{ color: colors.foreground, fontWeight: '700', marginBottom: spacing.xs }}>
                  Exact metering device
                </Text>
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
                  Choose the physical device whose channels measure this asset. Only devices installed on the immediate supplying switchboard are shown.
                </Text>
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
                  {eligibleMeterResults.total > ELIGIBLE_METER_RESULT_LIMIT
                    ? `Showing ${ELIGIBLE_METER_RESULT_LIMIT} of ${eligibleMeterResults.total} matches. Refine the search to choose another device.`
                    : `${eligibleMeterResults.total} matching device${eligibleMeterResults.total === 1 ? '' : 's'}.`}
                  {eligibleMeterResults.selectedPinned ? ' The selected device remains pinned.' : ''}
                </Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Eligible meter device">
                  {eligibleMeterResults.visible.map((meter) => {
                    const selected = selectedMeterId === meter.id;
                    const meterBoard = sourceBoards.find((item) => item.id === meter.installedOnBoardId);
                    const availability = eligibleMeterChoices.find((choice) => choice.meter.id === meter.id)!;
                    return (
                      <Pressable
                        key={meter.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={`${meter.displayName.value}, ${meter.serialNumber}, ${availability.availableCount} free, ${availability.currentCount} current, ${availability.tbcCount} claimable TBC, and ${availability.occupiedCount} occupied channels, installed on ${meterBoard?.asset_name ?? 'switchboard'}`}
                        onPress={() => {
                          if (selectedMeterId !== meter.id || historicalMappingReadOnly) {
                            setSelectedMeterId(meter.id);
                            setSelectedChannelIds([]);
                            setTakeoverApprovals({});
                            setMeterAnnouncement(historicalMappingReadOnly
                              ? 'The historical mapping is ready to replace. Select the compatible channels again.'
                              : '');
                          }
                        }}
                        style={{
                          minHeight: 54,
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          borderRadius: radii.md,
                          paddingHorizontal: spacing.md,
                          marginBottom: spacing.sm,
                          backgroundColor: selected ? colors.muted : colors.card,
                        }}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                          {selected ? '✓ ' : ''}{meter.displayName.value}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                          {meter.deviceModel} · {meter.serialNumber || 'No serial'} · {meterBoard?.asset_name ?? 'Unknown switchboard'}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, marginTop: 3, fontSize: 12 }}>
                          {availability.availableCount} available
                          {availability.currentCount ? ` · ${availability.currentCount} current` : ''}
                          {availability.tbcCount ? ` · ${availability.tbcCount} claimable TBC` : ''}
                          {availability.occupiedCount ? ` · ${availability.occupiedCount} occupied` : ''}
                          {availability.takeoverCount ? ` · ${availability.takeoverCount} require reassignment` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!eligibleMeterResults.visible.length ? (
                  <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
                    No compatible device with a usable asset channel is available on this asset’s immediate supplying switchboard.
                  </Text>
                ) : null}
                {unavailableMeterResults.visible.map((meter) => {
                  const choice = unavailableMeterChoices.find((candidate) => candidate.meter.id === meter.id)!;
                  return (
                    <Text key={choice.meter.id} style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
                      {choice.meter.displayName.value} unavailable: {choice.topologyIssue
                        ?? `no configured sub-circuit channel is available (${choice.occupiedCount} occupied).`}
                    </Text>
                  );
                })}
                {unavailableMeterResults.total > ELIGIBLE_METER_RESULT_LIMIT ? (
                  <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
                    Refine the search to inspect the remaining incompatible devices.
                  </Text>
                ) : null}
                {onAddDevice ? (
                  <Button
                    title="Commission a new device, then return here"
                    variant="secondary"
                    onPress={() => {
                      const nextDetour = {
                        beforeMeterIds: meterDevices.map((item) => item.id),
                        startReturnToken: deviceDetourReturnToken,
                      };
                      setDeviceDetour(nextDetour);
                      setMeterAnnouncement('');
                      void saveSiteAssetEditorDraft(
                        draftScope,
                        {
                          installationId: draftInstallationId,
                          assetId: draftAssetId,
                          draft: currentDraftSnapshot(nextDetour),
                        },
                      )
                        .then(() => onAddDevice(selectedSourceBoardId))
                        .catch(() => Alert.alert(
                          'Draft not protected',
                          'The asset draft could not be saved on this device, so device commissioning was not opened.',
                        ));
                    }}
                    style={{ marginBottom: spacing.md }}
                  />
                ) : null}
                {meterAnnouncement ? (
                  <Text
                    accessibilityRole="summary"
                    accessibilityLiveRegion="polite"
                    style={{ color: colors.primary, marginBottom: spacing.md }}
                  >
                    {meterAnnouncement}
                  </Text>
                ) : null}
              </>
            )}
            {selectedMeter && selectedMeterChoice && !historicalMappingReadOnly ? (
              <>
                <SelectChips
                  label="Phase grouping"
                  value={phaseMode}
                  options={['SINGLE_PHASE', 'THREE_PHASE', 'OTHER']}
                  getLabel={phaseGroupingLabel}
                  onChange={(value) => {
                    if (value !== phaseMode) {
                      setPhaseMode(value);
                      setSelectedChannelIds([]);
                      setTakeoverApprovals({});
                      setMeterAnnouncement('The phase grouping changed. Select the matching channel group again.');
                    }
                  }}
                />
                <SelectChips
                  label="Energy flow"
                  value={direction}
                  options={['', 'CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL']}
                  getLabel={energyFlowLabel}
                  onChange={setDirection}
                />
                <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>Meter channels that measure this asset</Text>
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
                  Select the exact non-spare channel or group, then record its phase grouping and whether this asset consumes energy, generates energy, or can do both.
                </Text>
                <Text
                  accessibilityRole="summary"
                  accessibilityLiveRegion="polite"
                  style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}
                >
                  {phaseMode === 'SINGLE_PHASE'
                    ? `Single phase requires exactly 1 channel; ${selectedChannelIds.length} selected.`
                    : phaseMode === 'THREE_PHASE'
                      ? `Three phase requires exactly 3 channels; ${selectedChannelIds.length} selected.`
                      : `Other group requires at least 1 channel; ${selectedChannelIds.length} selected.`}
                  {selectedGroupComplete ? ' Channel group complete.' : ' Incomplete selections save as To be confirmed.'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                  {selectedMeterChoice.channels.map((channelChoice, channelIndex) => {
                    const { channel } = channelChoice;
                    const selected = selectedChannelIds.includes(channel.id);
                    const conflicts = channelChoice.conflictingAssignments.filter((assignment) =>
                      assignment.target.kind === 'SITE_ASSET');
                    const assignedElsewhere = channelChoice.conflictingAssignments.some((assignment) =>
                      assignment.target.kind !== 'TBC');
                    const forbidden = ['PROTECTED_ASSIGNMENT', 'NOT_ASSET_CHANNEL', 'CAPABILITY_REQUIRED', 'INVALID_TOPOLOGY']
                      .includes(channelChoice.availability);
                    const approved = channelChoice.availability === 'TAKEOVER_APPROVED';
                    const disabled = forbidden;
                    const statusLabel = channelChoice.availability === 'PROTECTED_ASSIGNMENT'
                      ? 'Board/Grid mapping'
                      : channelChoice.availability === 'NOT_ASSET_CHANNEL'
                        ? meterChannelPurposeLabel(channel.purpose)
                        : channelChoice.availability === 'CAPABILITY_REQUIRED'
                          ? 'Add custom capability first'
                          : channelChoice.availability === 'INVALID_TOPOLOGY'
                            ? 'Repair channel topology first'
                            : channelChoice.availability === 'TAKEOVER_REQUIRED'
                              ? 'Reassign from asset…'
                              : approved
                                ? 'Reassignment approved'
                                : channelChoice.availability === 'CURRENT'
                                  ? 'Current asset mapping'
                                  : channelChoice.availability === 'TBC_ASSIGNMENT'
                                    ? 'Available from TBC group'
                                    : 'Available';
                    return (
                      <Pressable
                        key={channel.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected, disabled }}
                        accessibilityLabel={`Channel ${channel.ordinal}, ${assetMeteringChannelDescription(selectedMeter, channel)}${assignedElsewhere ? ', included in another measured group' : ''}`}
                        accessibilityHint={`${channelIndex + 1} of ${selectedMeterChoice.channels.length}. ${disabled ? statusLabel : assignedElsewhere && !approved ? 'Shows the exact existing assignment for approval before selecting.' : 'Double tap to include or remove this channel.'}`}
                        disabled={disabled}
                        onPress={() => {
                          const toggle = () => setSelectedChannelIds((current) => current.includes(channel.id)
                            ? current.filter((id) => id !== channel.id) : [...current, channel.id]);
                          if (selected || approved) { toggle(); return; }
                          if (channelChoice.availability !== 'TAKEOVER_REQUIRED') { toggle(); return; }
                          Alert.alert('Reassign these physical channels?', conflicts.map((conflict) => {
                            const targetId = conflict.target.kind === 'SITE_ASSET' ? conflict.target.siteAssetId : '';
                            const owner = siteAssets.find((item) => item.id === targetId);
                            return `${owner?.asset_name || targetId}\nAsset ID: ${targetId}\nAssignment: ${conflict.id}\nDevice: ${conflict.meterId}\nChannels: ${conflict.channelIds.join(', ')}\n${phaseGroupingLabel(conflict.phaseMode)} · ${energyFlowLabel(conflict.direction)}`;
                          }).join('\n\n') + '\n\nSaving this asset replaces those exact assignments. The displaced assets and remaining channels become To be confirmed. Commissioning history stays retained.', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Approve reassignment', onPress: () => {
                              setTakeoverApprovals((current) => ({ ...current, ...Object.fromEntries(conflicts.map((conflict) => [conflict.id, assignmentApprovalSignature(conflict)])) }));
                              toggle();
                            } },
                          ]);
                        }}
                        style={{
                          minHeight: 48,
                          minWidth: 140,
                          flexGrow: 1,
                          flexBasis: 140,
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.muted : colors.card,
                          opacity: disabled ? 0.45 : 1,
                          borderRadius: radii.md,
                          paddingHorizontal: spacing.sm,
                        }}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                          {selected ? '✓ ' : ''}Ch {channel.ordinal}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
                          {assetMeteringChannelDescription(selectedMeter, channel)}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2, fontWeight: '700' }}>
                          {statusLabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </>
        ) : meteringKind === 'UNMETERED' ? (
          <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>
            Confirmed: this asset is intentionally not directly metered.
          </Text>
        ) : null}
      </Card>
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <PhotoAttachmentField
        label="Additional photos"
        uris={extra_photos}
        photoNotes={photo_notes}
        noteField="extraPhotos"
        onChange={(uris, notes) => {
          setExtraPhotos(uris);
          setPhotoNotes(notes);
        }}
      />
      {draftPersistenceError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: colors.destructive, marginBottom: spacing.md }}>
          Draft protection failed: {draftPersistenceError}
        </Text>
      ) : null}
      <Button
        title={busy ? 'Saving…' : 'Save asset'}
        disabled={busy || asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH}
        onPress={async () => {
          setBusy(true);
          try {
            const normalizedSource = electricalSourceFromSelection(sourceKey, sourceBoards, gridSupplies);
            const meteringDraft = siteAssetMeteringForSave({
              kind: meteringKind, source: normalizedSource, selectedMeter, selectedMeterId,
              draftSource: sourceKey.startsWith('BOARD:') ? { kind: 'BOARD', boardId: sourceKey.slice(6) }
                : sourceKey.startsWith('GRID:') ? { kind: 'GRID', gridSupplyId: sourceKey.slice(5) } : { kind: 'TBC' },
              eligibleMeterIds: eligibleMeters.map((meter) => meter.id), channelIds: selectedChannelIds,
              eligibleChannelIds: [...selectableChannelIds],
              assetId: initial?.id,
              phaseMode, direction, assignments: measurementAssignments,
              previousAssignmentId: initialAssignment?.id,
              previousAssignment: initialAssignment, previousSource: initialSource,
              takeoverApprovals,
            });
            await onSubmit({
              audit_id: initial?.audit_id ?? '',
              zone_id: initial?.zone_id ?? '',
              asset_name: asset_name.trim() || (type_code === 'OTHER' ? custom_type_name.trim() : '') || SITE_ASSET_TYPE_LABELS[type_code],
              asset_type: siteAssetTypeFromCode(type_code),
              type_code,
              custom_type_name: type_code === 'OTHER' ? custom_type_name.trim() : undefined,
              display_code: customCode ? display_code : initial?.display_code_meta?.value ?? '',
              display_code_meta: customCode
                ? {
                    value: display_code.trim(), generatedValue: initial?.display_code_meta?.generatedValue ?? display_code.trim(),
                    isOverridden: true, ruleVersion: 1, overrideReason: 'Installer custom code', provisional: initial?.display_code_meta?.provisional ?? true,
                  }
                : initial?.display_code_meta,
              location_description,
              location_photo,
              electrical_source: normalizedSource,
              electrical_board_id: normalizedSource.kind === 'BOARD' ? normalizedSource.boardId : null,
              electrical_board_tbc: normalizedSource.kind === 'TBC',
              metering_state: initial?.metering_state ?? { kind: 'TBC' },
              meter_present: initial?.meter_present ?? false,
              meter_switchboard_id: initial?.meter_switchboard_id ?? null,
              meter_switchboard_tbc: initial?.meter_switchboard_tbc ?? false,
              meter_channels: initial?.meter_channels ?? [],
              comments,
              extra_photos,
              photo_notes,
            }, { ...meteringDraft, baselineAssignments: mappingBaseline.current });
            deleteRemovedLocalPhotos(
              [initial?.location_photo, ...(initial?.extra_photos ?? [])],
              [location_photo, ...extra_photos],
            );
            try {
              await clearSiteAssetEditorDraft(draftScope);
              restoredDraft.current = false;
            } catch {
              Alert.alert(
                'Asset saved; draft cleanup pending',
                'The asset was saved, but its recovery draft could not be cleared. Discard the restored copy before making another edit.',
              );
            }
          } catch (error) {
            Alert.alert('Asset not saved', error instanceof Error ? error.message : 'The asset could not be saved.');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        title="Discard saved asset draft"
        variant="danger"
        style={{ marginTop: spacing.md }}
        onPress={() => {
          Alert.alert(
            'Discard asset draft?',
            'This clears the saved editor state, including a pending device-commissioning detour.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Discard draft',
                style: 'destructive',
                onPress: () => { void (async () => {
                  await clearSiteAssetEditorDraft(draftScope);
                  restoredDraft.current = false;
                  onDiscardDraft?.();
                })(); },
              },
            ],
          );
        }}
      />
    </View>
  );
}

const CHANNEL_PURPOSES = ['MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE'] as const;
const LOAD_TYPES = [
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
  'Not Used',
];
const ROGOWSKI = [
  '3000A – 9cm',
  '3000A – 20cm',
  '3000A – 29cm',
];
const CT_RATINGS = ['60A', '120A', '200A', '400A', '600A'];
const SIGNAL_STRENGTHS = ['Low', 'Medium', 'High'];
const ANTENNA_TYPES = ['Internal', 'External', 'CSM550 - External High Gain', 'Other'];
const METER_CLASSIFICATIONS = [
  'Utility / Gate Meter',
  'Sub-meter',
  'Check Meter',
  'Solar / Generation Meter',
  'Other',
];
const METER_COVERAGE = [
  'Entire Board Load',
  'Specific Outgoing Circuit',
  'Multiple Circuits',
  'Unknown',
];

export function WattwatcherForm({
  deviceType,
  data,
  onChange,
  lockDeviceType = false,
  channelsLocked = false,
  generatedAssetId,
  canAddSiteAssetForChannel,
  onAddSiteAssetForChannel,
  onChannelPurposeChange,
  onChannelStructureChange,
  onCapabilitiesValidityChange,
}: {
  deviceType: MeterDeviceType;
  data: Partial<Meter>;
  onChange: (next: Partial<Meter>) => void;
  lockDeviceType?: boolean;
  channelsLocked?: boolean;
  generatedAssetId?: string;
  canAddSiteAssetForChannel?: (channelId: string) => boolean;
  onAddSiteAssetForChannel?: (channelId: string) => void;
  onChannelPurposeChange?: (channelId: string, purpose: MeterChannelPurpose) => void;
  onChannelStructureChange?: (channels: WattwatcherChannel[]) => void;
  onCapabilitiesValidityChange?: (channelId: string, valid: boolean) => void;
}) {
  const { colors } = useTheme();
  const selectedType = data.device_type ?? deviceType;
  const channelCount = selectedType === 'A6M'
    ? 6
    : selectedType === 'A3RM'
      ? 3
      : data.ww_channels?.length ?? 0;
  const channels = normalizedMeterEditorChannels(data.id ?? 'meter', [
    ...(data.ww_channels ?? []),
    ...Array.from({ length: channelCount }, () => ({})),
  ].slice(0, channelCount)).map((channel) => (
    channelWithModelValidSensor(selectedType, channel)
  ));
  const isA6M = selectedType === 'A6M';
  const isA3RM = selectedType === 'A3RM';
  const isOther = selectedType === 'Other';
  const selectedFamily = isOther ? 'OTHER' : 'WATTWATCHERS';
  const showWattwatchersSections = showsWattwatchersCommissioningSections(selectedType);
  const channelLayoutInvalid = meterChannelsNeedLayoutRepair(
    selectedType,
    data.ww_channels ?? [],
  );

  const setSection = <K extends keyof Meter>(section: K, key: string, val: unknown) => {
    const prev = (data[section] as Record<string, unknown>) || {};
    onChange({ ...data, [section]: { ...prev, [key]: val } });
  };

  const setChannel = (idx: number, key: string, val: unknown) => {
    const next = channels.map((c, i) => (i === idx
      ? channelWithModelValidSensor(selectedType, { ...c, [key]: val })
      : c));
    onChange({ ...data, ww_channels: next });
  };

  const setChannelSensor = (idx: number, value: string) => {
    const next = channels.map((channel, index) => index === idx
      ? channelAfterSensorRatingChange(selectedType, channel, value)
      : channel);
    onChange({ ...data, ww_channels: next });
  };

  const setChannelPurpose = (idx: number, purpose: string) => {
    const next = channels.map((channel, index) =>
      index === idx ? channelAfterPurposeChange(channel, purpose) : channel);
    onChange({ ...data, ww_channels: next });
    onChannelPurposeChange?.(channels[idx]?.id ?? `${data.id ?? 'meter'}:${idx + 1}`, purpose as MeterChannelPurpose);
  };

  const chooseDeviceType = (value: MeterDeviceType) => {
    const nextChannels = normalizedMeterEditorChannels(data.id ?? 'meter', channelsAfterDeviceTypeChange(
      selectedType,
      value,
      data.ww_channels ?? [],
    ));
    onChange({
      ...data,
      device_type: value,
      custom_name: nameAfterTypeChange(
        data.custom_name ?? '',
        defaultMeterCustomName(
          selectedType,
          data.custom_model_name,
          data.custom_manufacturer_name,
        ),
        defaultMeterCustomName(
          value,
          value === 'Other' ? data.custom_model_name : undefined,
          value === 'Other' ? data.custom_manufacturer_name : undefined,
        ),
      ),
      custom_manufacturer_name: value === 'Other' ? data.custom_manufacturer_name : undefined,
      custom_model_name: value === 'Other' ? data.custom_model_name : undefined,
      ww_channels: nextChannels,
    });
    onChannelStructureChange?.(nextChannels);
  };

  const chooseDeviceFamily = (value: 'WATTWATCHERS' | 'OTHER') => {
    chooseDeviceType(value === 'OTHER' ? 'Other' : selectedType === 'A6M' ? 'A6M' : 'A3RM');
  };

  const pre = data.ww_prestart || {};
  const sb = data.ww_switchboard || {};
  const ver = data.ww_verification || {};
  const com = data.ww_commissioning || {};

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <SectionHeader title="Device identity" />
        <SelectChips
          label="Device family"
          value={selectedFamily}
          options={['WATTWATCHERS', 'OTHER']}
          getLabel={(value) => value === 'WATTWATCHERS' ? 'Wattwatchers' : 'Other manufacturer'}
          disabled={lockDeviceType}
          onChange={chooseDeviceFamily}
        />
        <SelectChips
          label="Device model"
          value={selectedType}
          options={METER_DEVICE_TYPES.filter((value) => selectedFamily === 'OTHER'
            ? value === 'Other'
            : value !== 'Other')}
          disabled={lockDeviceType}
          onChange={chooseDeviceType}
        />
        {lockDeviceType ? (
          <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md }}>
            This saved other-manufacturer meter keeps its existing device family.
          </Text>
        ) : null}
        {isOther ? (
          <>
            <TextField
              label="Manufacturer"
              value={data.custom_manufacturer_name ?? ''}
              onChangeText={(value) => onChange({
                ...data,
                custom_manufacturer_name: value,
                custom_name: nameAfterTypeChange(
                  data.custom_name ?? '',
                  defaultMeterCustomName(
                    'Other', data.custom_model_name, data.custom_manufacturer_name,
                  ),
                  defaultMeterCustomName('Other', data.custom_model_name, value),
                ),
              })}
            />
            <TextField
              label="Custom model"
              value={data.custom_model_name ?? ''}
              onChangeText={(value) => onChange({
                ...data,
                custom_model_name: value,
                custom_name: nameAfterTypeChange(
                  data.custom_name ?? '',
                  defaultMeterCustomName(
                    'Other', data.custom_model_name, data.custom_manufacturer_name,
                  ),
                  defaultMeterCustomName('Other', value, data.custom_manufacturer_name),
                ),
              })}
            />
          </>
        ) : null}
        <TextField
          label="Device name"
          maxLength={64}
          value={data.custom_name ?? defaultMeterCustomName(
            selectedType,
            data.custom_model_name,
            data.custom_manufacturer_name,
          )}
          onChangeText={(v) => onChange({ ...data, custom_name: v })}
        />
        <TextField
          label="Generated asset ID"
          value={generatedAssetId ?? 'Generated when saved'}
          editable={false}
        />
        <BarcodeScanField
          label="Device ID / serial"
          value={data.device_id ?? ''}
          onChangeText={(v) => onChange({
            ...data,
            device_id: v,
            device_number: isOther
              ? data.device_number
              : data.device_number?.trim() ? data.device_number : v,
          })}
          placeholder="e.g. DD03710160579"
        />
        <BarcodeScanField
          label="Site / asset tag (optional)"
          value={data.device_number ?? ''}
          onChangeText={(v) => onChange({ ...data, device_number: v })}
          placeholder="e.g. D001 or M-02"
        />
        <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 19 }}>
          This is a site-assigned operational tag, not the manufacturer Device ID / serial.
        </Text>
        <SelectChips
          label="Classification"
          value={data.classification ?? ''}
          options={['', ...withLegacyOption(METER_CLASSIFICATIONS, data.classification)]}
          getLabel={(value) => value || 'Select classification'}
          onChange={(value) => onChange({ ...data, classification: value })}
        />
        <SelectChips
          label="Coverage"
          value={data.coverage ?? ''}
          options={['', ...withLegacyOption(METER_COVERAGE, data.coverage)]}
          getLabel={(value) => value || 'Select coverage'}
          onChange={(value) => onChange({ ...data, coverage: value })}
        />
        <TextArea
          label="Operational notes"
          value={data.notes ?? ''}
          onChangeText={(value) => onChange({ ...data, notes: value })}
        />
      </Card>

      {showWattwatchersSections ? (
        <>
          <SectionHeader title="Verification & commissioning" />
          <Card>
            <SectionHeader title="Pre-start safety" />
            <BoolRow label="Site induction required?" value={pre.site_induction} onChange={(v) => setSection('ww_prestart', 'site_induction', v)} />
            <BoolRow label="Safe access?" value={pre.safe_access} onChange={(v) => setSection('ww_prestart', 'safe_access', v)} />
            <BoolRow label="Correct PPE?" value={pre.correct_ppe} onChange={(v) => setSection('ww_prestart', 'correct_ppe', v)} />
            <BoolRow label="Aware of LIVE points?" value={pre.live_points_aware} onChange={(v) => setSection('ww_prestart', 'live_points_aware', v)} />
            <BoolRow label="Can isolate power?" value={pre.can_isolate} onChange={(v) => setSection('ww_prestart', 'can_isolate', v)} />
            <BoolRow label="Additional hazards?" value={pre.additional_hazards} onChange={(v) => setSection('ww_prestart', 'additional_hazards', v)} />
            <BoolRow label="Safe to proceed?" value={pre.safe_to_proceed} onChange={(v) => setSection('ww_prestart', 'safe_to_proceed', v)} />
          </Card>

          <Card>
            <SectionHeader title="Switchboard details" />
            <TextField label="Switchboard name" value={sb.sb_name ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'sb_name', v)} />
            <TextField label="Location" value={sb.sb_location ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'sb_location', v)} />
            <BarcodeScanField
              label="Auditor serial (optional)"
              value={sb.device_serial ?? ''}
              onChangeText={(v) => setSection('ww_switchboard', 'device_serial', v)}
              placeholder="Scan or type serial"
            />
            <TextField label="Firmware" value={sb.firmware ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'firmware', v)} />
            <SelectChips
              label="Antenna"
              value={sb.antenna_type ?? ''}
              options={withLegacyOption(ANTENNA_TYPES, sb.antenna_type)}
              onChange={(v) => setSection('ww_switchboard', 'antenna_type', v)}
            />
            <SelectChips
              label="Signal"
              value={sb.signal_strength ?? ''}
              options={withLegacyOption(SIGNAL_STRENGTHS, sb.signal_strength)}
              onChange={(v) => setSection('ww_switchboard', 'signal_strength', v)}
            />
            <TextArea label="Notes" value={sb.notes ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'notes', v)} />
          </Card>
        </>
      ) : null}

      <View>
        <SectionHeader
          title="Channels"
          actionLabel={isOther && !channelsLocked ? 'Add channel' : undefined}
          onAction={isOther && !channelsLocked ? () => {
            const next = addCustomMeterChannel(data.id ?? 'meter', channels);
            onChange({ ...data, ww_channels: next });
            onChannelStructureChange?.(next);
          } : undefined}
        />
        <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>
          Three channels for A3RM, six for A6M, or one or more explicit custom channels.
        </Text>
      </View>
      {channelLayoutInvalid ? (
        <Card>
          <Text accessibilityRole="alert" style={{ color: colors.mutedForeground, lineHeight: 20 }}>
            {isOther
              ? 'Channel ordinals must be unique positive numbers in display order.'
              : `${selectedType} normally uses ${channelCount} channels numbered 1 through ${channelCount}.`}
          </Text>
          {!channelsLocked ? (
            <Button
              title="Restore channel layout"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => {
                const next = normalizedMeterEditorChannels(
                  data.id ?? 'meter',
                  channelsAfterDeviceTypeChange(selectedType, selectedType, data.ww_channels ?? []),
                );
                onChange({ ...data, ww_channels: next });
                onChannelStructureChange?.(next);
              }}
            />
          ) : null}
        </Card>
      ) : null}
      {channels.map((ch, idx) => (
        <Card key={ch.id ?? `ch-${idx}`}>
          <SectionHeader title={`Channel ${ch.ordinal ?? idx + 1}`} />
          {ch.purpose === 'SUB_CIRCUIT' && onAddSiteAssetForChannel
            && (canAddSiteAssetForChannel?.(ch.id ?? '') ?? true) ? (
            <Button
              title="Add site asset"
              variant="secondary"
              disabled={channelsLocked}
              onPress={() => onAddSiteAssetForChannel(ch.id ?? `${data.id ?? 'meter'}:${idx + 1}`)}
              style={{ marginBottom: spacing.sm }}
            />
          ) : null}
          {isOther && !channelsLocked ? (
            <Button
              title="Remove"
              variant="danger"
              onPress={() => {
                const result = removeCustomMeterChannel(data.id ?? 'meter', channels, idx);
                onChange({ ...data, ww_channels: result.channels });
                onChannelStructureChange?.(result.channels);
              }}
              style={{ marginBottom: spacing.sm }}
            />
          ) : null}
          <SelectChips
            label="Purpose"
            value={(ch.purpose as (typeof CHANNEL_PURPOSES)[number]) || 'SPARE'}
            options={[...CHANNEL_PURPOSES]}
            getLabel={meterChannelPurposeLabel}
            onChange={(v) => setChannelPurpose(idx, v)}
          />
          {ch.purpose !== 'SPARE' ? (
            <>
              <SelectChips
                label="Load type"
                value={(ch.load_type as string) || 'Not Used'}
                options={withLegacyOption(LOAD_TYPES, ch.load_type)}
                onChange={(v) => onChange({
                  ...data,
                  ww_channels: channels.map((channel, index) => index === idx
                    ? {
                        ...channel,
                        load_type: v,
                        custom_load_type_name: v === 'Other'
                          ? channel.custom_load_type_name
                          : undefined,
                      }
                    : channel),
                })}
              />
              {ch.load_type === 'Other' ? (
                <TextField
                  label="Custom load type"
                  value={ch.custom_load_type_name ?? ''}
                  onChangeText={(value) => setChannel(idx, 'custom_load_type_name', value)}
                />
              ) : null}
              {isA6M ? (
                <>
                  <SelectChips
                    label="CT rating"
                    value={CT_RATINGS.includes(ch.ct_ratio ?? '') ? ch.ct_ratio ?? '' : ''}
                    options={['', ...CT_RATINGS]}
                    getLabel={(value) => value || 'Select an option'}
                    onChange={(v) => setChannelSensor(idx, v)}
                  />
                  {ch.ct_ratio && !CT_RATINGS.includes(ch.ct_ratio) ? (
                    <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md }}>
                      Previously saved CT rating: {ch.ct_ratio}. Select a current option to replace it.
                    </Text>
                  ) : null}
                </>
              ) : null}
              {isA3RM ? (
                <>
                  <SelectChips
                    label="Rogowski coil"
                    value={ROGOWSKI.includes(ch.rogowski_size ?? '') ? ch.rogowski_size ?? '' : ''}
                    options={['', ...ROGOWSKI]}
                    getLabel={(value) => value || 'Select an option'}
                    onChange={(v) => setChannelSensor(idx, v)}
                  />
                  {ch.rogowski_size && !ROGOWSKI.includes(ch.rogowski_size) ? (
                    <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md }}>
                      Previously saved Rogowski coil: {ch.rogowski_size}. Select a current option to replace it.
                    </Text>
                  ) : null}
                </>
              ) : null}
              <TextField
                label="Description"
                value={ch.description ?? ''}
                onChangeText={(v) => setChannel(idx, 'description', v)}
              />
              {isOther ? (
                <TextField
                  label="Phase label"
                  value={ch.phase_label ?? ''}
                  onChangeText={(value) => setChannel(idx, 'phase_label', value)}
                  placeholder="e.g. L1, Red, Neutral"
                />
              ) : null}
              {isOther ? (
                <TextField
                  label="Sensor rating / metadata"
                  value={ch.rogowski_size || ch.ct_ratio || ''}
                  onChangeText={(value) => onChange({
                    ...data,
                    ww_channels: channels.map((channel, index) => index === idx
                      ? { ...channel, rogowski_size: value, ct_ratio: undefined }
                      : channel),
                  })}
                  placeholder="Observed sensor rating"
                />
              ) : null}
            </>
          ) : null}
          {isOther ? (
            <ChannelCapabilitiesEditor
              key={`${data.id}-${ch.id ?? idx}-${selectedType}`}
              value={ch.capabilities}
              onChange={(value) => setChannel(idx, 'capabilities', value)}
              onValidityChange={(valid) => onCapabilitiesValidityChange?.(ch.id ?? String(idx), valid)}
            />
          ) : null}
        </Card>
      ))}

      {showWattwatchersSections ? (
        <>
          <Card>
            <SectionHeader title="Verification" />
            <BoolRow label="Voltage checked" value={ver.voltage_checked} onChange={(v) => setSection('ww_verification', 'voltage_checked', v)} />
            <BoolRow label="Polarity checked" value={ver.polarity_checked} onChange={(v) => setSection('ww_verification', 'polarity_checked', v)} />
            <BoolRow label="Communications confirmed" value={ver.communications_ok} onChange={(v) => setSection('ww_verification', 'communications_ok', v)} />
            <TextArea label="Verification notes" value={ver.notes ?? ''} onChangeText={(v) => setSection('ww_verification', 'notes', v)} />
          </Card>

          <Card>
            <SectionHeader title="Commissioning" />
            <BoolRow label="Device online" value={com.device_online} onChange={(v) => setSection('ww_commissioning', 'device_online', v)} />
            <BoolRow label="Channels reporting" value={com.channels_reporting} onChange={(v) => setSection('ww_commissioning', 'channels_reporting', v)} />
            <BoolRow label="Device and channels labeled" value={com.labeled} onChange={(v) => setSection('ww_commissioning', 'labeled', v)} />
            <BoolRow label="Commissioning photos taken" value={com.photos_taken} onChange={(v) => setSection('ww_commissioning', 'photos_taken', v)} />
            <TextArea label="Commissioning notes" value={com.notes ?? ''} onChangeText={(v) => setSection('ww_commissioning', 'notes', v)} />
          </Card>
        </>
      ) : null}

      <Card>
        <SectionHeader title="Meter evidence" />
        <PhotoAttachmentField
          label="Installed device"
          uris={data.ww_photos?.device_installed ? [data.ww_photos.device_installed] : []}
          photoNotes={data.photo_notes}
          noteField="wwPhotos.deviceInstalled"
          single
          onChange={(uris, notes) => onChange({
            ...data,
            photo_notes: notes,
            ww_photos: {
              ...(data.ww_photos ?? {}),
              device_installed: uris[0],
            },
          })}
        />
        <PhotoAttachmentField
          label="Switchboard overview"
          uris={data.ww_photos?.switchboard_overview ? [data.ww_photos.switchboard_overview] : []}
          photoNotes={data.photo_notes}
          noteField="wwPhotos.switchboardOverview"
          single
          onChange={(uris, notes) => onChange({
            ...data,
            photo_notes: notes,
            ww_photos: {
              ...(data.ww_photos ?? {}),
              switchboard_overview: uris[0],
            },
          })}
        />
        <PhotoAttachmentField
          label="Device and channel labeling"
          uris={data.ww_photos?.labeling ? [data.ww_photos.labeling] : []}
          photoNotes={data.photo_notes}
          noteField="wwPhotos.labeling"
          single
          onChange={(uris, notes) => onChange({
            ...data,
            photo_notes: notes,
            ww_photos: {
              ...(data.ww_photos ?? {}),
              labeling: uris[0],
            },
          })}
        />
        <PhotoAttachmentField
          label="Extra meter photos"
          uris={data.ww_photos?.extra ?? []}
          photoNotes={data.photo_notes}
          noteField="wwPhotos.extra"
          onChange={(extra, notes) => onChange({
            ...data,
            photo_notes: notes,
            ww_photos: {
              ...(data.ww_photos ?? {}),
              extra,
            },
          })}
        />
        <Text style={{ color: colors.mutedForeground, lineHeight: 19 }}>
          Evidence is stored in app-owned local media and included when this installation is backed up.
        </Text>
      </Card>
    </View>
  );
}

export function createEmptyMeter(deviceType: MeterDeviceType = 'A3RM'): Meter {
  const id = createId('meter');
  return {
    id,
    device_name: '',
    custom_name: defaultMeterCustomName(deviceType),
    device_type: deviceType,
    device_id: '',
    device_number: '',
    notes: '',
    ww_prestart: {},
    ww_switchboard: {},
    ww_channels: Array.from(
      { length: deviceType === 'A6M' ? 6 : deviceType === 'A3RM' ? 3 : 1 },
      (_, index) => ({ id: `${id}:${index + 1}`, ordinal: index + 1, purpose: 'SPARE' }),
    ),
    ww_verification: {},
    ww_commissioning: {},
    ww_photos: { extra: [] },
  };
}

export function FormModal({
  visible,
  title,
  onClose,
  children,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            padding: spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={[typography.heading, { color: colors.foreground }]}>{title}</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
          >
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Close</Text>
          </Pressable>
        </View>
        {scroll ? (
          <FormScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>{children}</FormScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
      </View>
    </Modal>
  );
}
