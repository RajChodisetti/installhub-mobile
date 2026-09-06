import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  FORM_DEFINITION_BY_TYPE,
  FORM_DEFINITIONS,
  SENSOR_OPTIONS_BY_DEVICE,
  answersAfterChange,
  createInitialFormAnswers,
  hiddenFormPhotoSlots,
  isFieldVisible,
  isSectionVisible,
  meterAfterCommsReplacement,
  optionsForField,
  supportedFormAnswers,
  validateForm,
  withMirroredDeviceIdentityAnswers,
} from '../src/forms/catalog';
import { buildFormReportHtml } from '../src/services/formReportHtml';
import { formPdfFilename } from '../src/services/reportFilenames';
import type {
  FormAttachment,
  FormSubmission,
  Installation,
  User,
} from '../src/types';

test('new forms prefer the installation customer over the contracting client', () => {
  const user = {
    full_name: 'Field Technician',
  } as User;
  const baseInstallation = {
    client_name: 'Contracting Client',
    customer_name: 'End Customer',
    site_name: 'Customer Site',
    site_address: '1 Test Street',
  } as Installation;

  assert.equal(
    createInitialFormAnswers(baseInstallation, user)['site.customer_name'],
    'End Customer',
  );
  assert.equal(
    createInitialFormAnswers(
      { ...baseInstallation, customer_name: '   ' },
      user,
    )['site.customer_name'],
    'Contracting Client',
  );
});

test('form write projection omits unrelated prefill and photo answers without mutating source evidence', () => {
  const original = {
    'site.date_time': '2026-09-05T00:00:00Z', 'site.customer_name': 'Customer',
    'site.address': 'Address', 'installer.name': 'Technician',
    'existing.device_id': 'EXISTING', 'device.id': 'WW',
    'water.lcd_photo': 'file:///photo.jpg',
  };
  assert.deepEqual(supportedFormAnswers('ace-switchboard', original), {
    'site.date_time': original['site.date_time'], 'installer.name': 'Technician',
  });
  assert.equal(supportedFormAnswers('ww-installation', original)['existing.device_id'], undefined);
  assert.equal(supportedFormAnswers('comms-fault', original)['device.id'], undefined);
  assert.equal(supportedFormAnswers('honeywell-q400', original)['water.lcd_photo'], undefined);
  assert.equal(original['water.lcd_photo'], 'file:///photo.jpg');
  assert.deepEqual(supportedFormAnswers('a3rm-installation', original, 1), original);
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(
        (value as Record<string, unknown>)[key],
      )}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

test('the picker catalog contains the six supplied form families', () => {
  assert.deepEqual(
    FORM_DEFINITIONS
      .filter((definition) => definition.availableForNew !== false)
      .map((definition) => definition.type),
    [
      'ww-installation',
      'comms-fault',
      'ace-switchboard',
      'honeywell-q400',
      'captis-logger',
      'sums-logger',
    ],
  );
});

test('legacy A3RM and A6M form types remain readable', () => {
  assert.equal(FORM_DEFINITION_BY_TYPE['a3rm-installation'].availableForNew, false);
  assert.equal(FORM_DEFINITION_BY_TYPE['a6m-installation'].availableForNew, false);
});

test('optional field identity is presented as a distinct site or asset tag', () => {
  const installation = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const deviceTag = installation.sections
    .flatMap((section) => section.fields)
    .find((field) => field.key === 'device.number');
  assert.equal(
    deviceTag?.label,
    'Site / asset tag (optional — not the Device ID / serial)',
  );
  assert.equal(deviceTag?.required, false);

  const replacement = FORM_DEFINITION_BY_TYPE['comms-fault'].sections
    .flatMap((section) => section.fields)
    .find((field) => field.key === 'works.new_device_number');
  assert.equal(
    replacement?.label,
    'New site / asset tag (optional — not the Device ID / serial)',
  );
  assert.equal(replacement?.required, false);
});

test('every field matches the audited portal capture contract', () => {
  // Extracted from sustainability-wise-api/apps/ecoaudit/src/modules/installhub/forms/catalog.ts
  // on 2026-09-05. Field ordering is presentation-only; identifiers, labels,
  // kinds, options, conditions, scanner modes and optionality are all pinned.
  const expected: Record<string, string> = {
    "ww-installation": "c53deff86d0b5cc3147ca630e81f4c5024d986e46a6ae4df932131e28089eeac",
    "a3rm-installation": "65f4c78a28644ff68df3c41749901ca70d5b9e5ceedb2a88ebc9747d081b3d43",
    "a6m-installation": "a3474aab08e77a5cade9d3c71a300bcc0548ca5d34419d248614a3e184f4cba0",
    "comms-fault": "892fc38f5bb7b8249e93bbb3a9631133970c1dbc16ee2cfc461eb5340a0d3598",
    "ace-switchboard": "af9961e2a4ef7b5bf47aa816592efc00d593eac97e9c209a08f091f3f663ef12",
    "honeywell-q400": "1db113e59034d1c70fb79fd7f9f10e96b066ef288cec7a3759b109707aad54a2",
    "captis-logger": "10b9380dbef2bc7342b81ef887619d2695a2dd6074f99824d5100f9bba01fa9d",
    "sums-logger": "e0d57aca02b5a6fa63d9b6d147844d45aa489a92594c9fe193da95dc435da21b"
};
  for (const definition of FORM_DEFINITIONS) {
    const contract = {
      type: definition.type,
      schemaVersion: definition.schemaVersion,
      availableForNew: definition.availableForNew !== false,
      sections: definition.sections.map((section) => ({
        title: section.title,
        showWhen: section.showWhen,
        fields: [...section.fields].sort((a, b) => a.key.localeCompare(b.key)).map((field) => ({
          key: field.key, label: field.label, kind: field.kind,
          required: field.required ?? false, options: field.options,
          showWhen: field.showWhen, optionsWhen: field.optionsWhen,
          scanModes: field.scanModes, allowNotApplicable: field.allowNotApplicable,
          multiple: field.multiple,
        })),
      })),
    };
    assert.equal(createHash('sha256').update(canonicalJson(contract)).digest('hex'), expected[definition.type], definition.type);
  }
  assert.equal(FORM_DEFINITIONS.flatMap((definition) => definition.sections.flatMap((section) => section.fields)).length, 392);
});

test('Installation form dynamically exposes exact A3RM and A6M options', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channels = definition.sections.filter((section) =>
    section.title.startsWith('Channel '),
  );
  const firstRating = channels[0].fields.find(
    (field) => field.key === 'channel.1.rating',
  )!;
  assert.equal(channels.length, 6);
  assert.deepEqual(optionsForField(firstRating, { 'device.type': 'A3RM' }), [
    '10cm-200A',
    '10cm-333mV',
    '20cm-3000A',
    '30cm-3000A',
    '45cm-3000A',
    'Not Used',
  ]);
  assert.deepEqual(optionsForField(firstRating, { 'device.type': 'A6M' }), [
    'CT-60A',
    'CT-120A',
    'CT-250A',
    'CT-400A',
    'CT-600A',
    'Not Used',
  ]);
  assert.deepEqual(
    optionsForField(firstRating, {
      'device.type': 'A3RM',
      'channel.1.rating': '3000A - 9cm',
    }),
    [
      '10cm-200A', '10cm-333mV', '20cm-3000A', '30cm-3000A',
      '45cm-3000A', 'Not Used', '3000A - 9cm',
    ],
  );
  assert.equal(isSectionVisible(channels[2], { 'device.type': 'A3RM' }), true);
  assert.equal(isSectionVisible(channels[3], { 'device.type': 'A3RM' }), false);
  assert.equal(isSectionVisible(channels[5], { 'device.type': 'A6M' }), true);
  assert.deepEqual(SENSOR_OPTIONS_BY_DEVICE.A6M, [
    'CT-60A', 'CT-120A', 'CT-250A', 'CT-400A', 'CT-600A', 'Not Used',
  ]);
});

test('changing device type clears stale dependent ratings and hidden channels', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const next = answersAfterChange(
    definition,
    {
      'device.type': 'A6M',
      'channel.1.rating': '60A',
      'channel.4.rating': '120A',
    },
    'device.type',
    'A3RM',
  );
  assert.equal(next['channel.1.rating'], undefined);
  assert.equal(next['channel.4.rating'], undefined);
});

test('a spare WW channel clears and hides load, sensor, evidence and commissioning values', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const next = answersAfterChange(
    definition,
    {
      'device.type': 'A6M',
      'channel.4.purpose': 'Sub-circuit / asset',
      'channel.4.load': 'HVAC',
      'channel.4.custom_load_type': 'Legacy custom value',
      'channel.4.rating': '120A',
      'channel.4.description': 'Warehouse air conditioning',
      'commissioning.channel_4_polarity': 'yes',
      'commissioning.channel_4_current': '18.2',
    },
    'channel.4.purpose',
    'Spare / unused',
  );
  assert.equal(next['channel.4.purpose'], 'Spare / unused');
  assert.equal(next['channel.4.load'], undefined);
  assert.equal(next['channel.4.custom_load_type'], undefined);
  assert.equal(next['channel.4.rating'], undefined);
  assert.equal(next['channel.4.description'], undefined);
  assert.equal(next['commissioning.channel_4_polarity'], undefined);
  assert.equal(next['commissioning.channel_4_current'], undefined);

  const channel = definition.sections.find((section) => section.title === 'Channel 4')!;
  const field = (key: string) => channel.fields.find((item) => item.key === key)!;
  assert.equal(isFieldVisible(field('channel.4.rating'), next), false);
  assert.equal(isFieldVisible(field('channel.4.description'), next), false);
  assert.equal(isFieldVisible(field('channel.4.nameplate_photos'), next), false);

  const submission: FormSubmission = {
    id: 'unused-a6m-channel',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: next,
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.equal(
    validateForm(submission).some((error) => error.startsWith('Channel 4:')),
    false,
  );
});

test('WW channel options depend on purpose while capture remains optional', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channel = definition.sections.find((section) => section.title === 'Channel 1')!;
  const purpose = channel.fields.find((field) => field.key === 'channel.1.purpose')!;
  const load = channel.fields.find((field) => field.key === 'channel.1.load')!;
  assert.deepEqual(purpose.options, [
    'Main board supply',
    'Sub-circuit / asset',
    'Spare / unused',
  ]);
  assert.deepEqual(
    optionsForField(load, { 'channel.1.purpose': 'Main board supply' }),
    ['Mains Supply'],
  );
  assert.deepEqual(
    optionsForField(load, { 'channel.1.purpose': 'Sub-circuit / asset' }),
    ['HVAC', 'Lighting', 'Solar PV', 'Forklift Charger', 'Hot Water', 'General Power', 'Other'],
  );
  assert.deepEqual(
    optionsForField(load, { 'channel.1.purpose': 'Spare / unused' }),
    [],
  );
  assert.equal(isFieldVisible(load, { 'channel.1.purpose': 'Spare / unused' }), false);
  assert.equal(isFieldVisible(load, { 'channel.1.purpose': 'Sub-circuit / asset' }), true);

  const changedToMain = answersAfterChange(
    definition,
    {
      'device.type': 'A3RM',
      'channel.1.purpose': 'Sub-circuit / asset',
      'channel.1.load': 'HVAC',
      'channel.1.rating': '3000A - 9cm',
    },
    'channel.1.purpose',
    'Main board supply',
  );
  assert.equal(changedToMain['channel.1.purpose'], 'Main board supply');
  assert.equal(changedToMain['channel.1.load'], undefined);
  assert.equal(changedToMain['channel.1.rating'], undefined);

  const draft: FormSubmission = {
    id: 'purpose-validation', form_type: 'ww-installation', schema_version: 2,
    status: 'Draft', installation_id: 'installation-1', attachments: [],
    answers: {
      'device.type': 'A3RM',
      'channel.1.purpose': 'Sub-circuit / asset',
      'channel.2.purpose': 'Spare / unused',
      'channel.3.purpose': 'Spare / unused',
    },
    created_at: '2026-08-02T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
  };
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
  draft.answers['channel.1.load'] = 'Mains Supply';
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
  draft.answers['channel.1.load'] = 'Other';
  draft.answers['channel.1.rating'] = '3000A - 9cm';
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
  draft.answers['channel.1.custom_load_type'] = 'Refrigeration';
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
  draft.answers = answersAfterChange(
    definition,
    draft.answers,
    'channel.1.purpose',
    'Spare / unused',
  );
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
});

test('Comms replacement-only commissioning values are hidden and cleared when no replacement occurs', () => {
  const definition = FORM_DEFINITION_BY_TYPE['comms-fault'];
  const next = answersAfterChange(
    definition,
    {
      'works.replace_device': 'yes',
      'works.new_device_type': 'A3RM',
      'works.new_device_number': 'NEW-NUMBER',
      'works.new_device_id': 'NEW-ID',
      'works.new_sensor_rating': '3000A - 9cm',
      'commissioning.onboarding_complete': 'yes',
      'commissioning.details_same': 'yes',
      'commissioning.start_screenshot': 'legacy-answer-reference',
      'commissioning.energy_screenshot': 'legacy-answer-reference',
    },
    'works.replace_device',
    'no',
  );
  for (const key of [
    'works.new_device_type',
    'works.new_device_number',
    'works.new_device_id',
    'works.new_sensor_rating',
    'commissioning.onboarding_complete',
    'commissioning.details_same',
    'commissioning.start_screenshot',
    'commissioning.energy_screenshot',
  ]) {
    assert.equal(next[key], undefined, key);
  }
  const commissioning = definition.sections.find(
    (section) => section.title === 'Commissioning details',
  )!;
  for (const key of [
    'commissioning.onboarding_complete',
    'commissioning.details_same',
    'commissioning.start_screenshot',
    'commissioning.energy_screenshot',
  ]) {
    const field = commissioning.fields.find((item) => item.key === key)!;
    assert.equal(isFieldVisible(field, next), false, key);
    assert.equal(
      isFieldVisible(field, { 'works.replace_device': 'yes' }),
      true,
      key,
    );
  }
});

test('conditional fields follow their controlling answers', () => {
  const field = {
    key: 'child',
    label: 'Child',
    kind: 'text' as const,
    showWhen: { key: 'parent', equals: 'yes' },
  };
  assert.equal(isFieldVisible(field, { parent: 'no' }), false);
  assert.equal(isFieldVisible(field, { parent: 'yes' }), true);
});

test('yes/no controls stay binary while optional historical values do not block completion', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const prestart = definition.sections
    .find((section) => section.title === 'Pre-start information')!
    .fields.find((field) => field.key === 'prestart.safe_access')!;
  assert.equal(prestart.allowNotApplicable, undefined);

  const submission: FormSubmission = {
    id: 'binary-yes-no',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: { 'prestart.safe_access': 'not_applicable' },
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.equal(validateForm(submission).some((error) => error.includes('safe access')), false);
});

test('Comms replacement rebuilds channel count and sensor representation', () => {
  const existing = {
    id: 'meter-1',
    device_name: 'A6M Auditor',
    device_type: 'A6M' as const,
    device_id: 'OLD-ID',
    device_number: 'OLD-NUMBER',
    ww_channels: Array.from({ length: 6 }, (_, index) => ({
      load_type: index < 3 ? 'Mains Supply' : 'Not Used',
      description: `Channel ${index + 1}`,
      ct_ratio: '120A',
    })),
  };
  const replacement = meterAfterCommsReplacement(existing, {
    'works.new_device_type': 'A3RM',
    'works.new_device_id': 'NEW-ID',
    'works.new_device_number': 'NEW-NUMBER',
    'works.new_sensor_rating': '3000A - 20cm',
  });
  assert.equal(replacement.device_name, 'A3RM - NEW-ID');
  assert.equal(replacement.device_type, 'A3RM');
  assert.equal(replacement.device_id, 'NEW-ID');
  assert.equal(replacement.device_number, 'NEW-NUMBER');
  assert.equal(replacement.ww_channels?.length, 3);
  assert.equal(replacement.ww_channels?.[0]?.load_type, 'Mains Supply');
  assert.equal(replacement.ww_channels?.[0]?.rogowski_size, '3000A - 20cm');
  assert.equal(replacement.ww_channels?.[0]?.ct_ratio, undefined);

  const humanNamed = meterAfterCommsReplacement(existing, {
    'works.new_device_type': 'A3RM',
    'works.new_device_id': 'NEW-ID',
    'works.new_sensor_rating': '3000A - 20cm',
  }, 'Redgum Factory - Boiler Room');
  assert.equal(humanNamed.device_name, 'Redgum Factory - Boiler Room - A3RM - NEW-ID');

  const expanded = meterAfterCommsReplacement(replacement, {
    'works.new_device_type': 'A6M',
    'works.new_device_id': 'NEWER-ID',
    'works.new_device_number': 'NEWER-NUMBER',
    'works.new_sensor_rating': '400A',
  });
  assert.equal(expanded.ww_channels?.length, 6);
  assert.ok(expanded.ww_channels?.every((channel) => channel.ct_ratio === '400A'));
  assert.ok(expanded.ww_channels?.every((channel) => channel.rogowski_size === undefined));
});

test('each form validates with populated capture fields and evidence', () => {
  for (const definition of FORM_DEFINITIONS) {
    const answers: FormSubmission['answers'] = {};
    const attachments: FormAttachment[] = [];
    for (const section of definition.sections) {
      if (section.showWhen) {
        answers[section.showWhen.key] ??= Array.isArray(section.showWhen.equals)
          ? section.showWhen.equals[0]
          : section.showWhen.equals;
      }
      if (!isSectionVisible(section, answers)) continue;
      for (const field of section.fields) {
        if (field.showWhen) {
          answers[field.showWhen.key] ??= Array.isArray(field.showWhen.equals)
            ? field.showWhen.equals[0]
            : field.showWhen.equals;
        }
        if (field.kind === 'photo') {
          attachments.push({
            id: `photo-${field.key}`,
            slot: field.key,
            uri: 'file:///fixture.jpg',
            mime_type: 'image/jpeg',
            captured_at: '2026-07-20T00:00:00.000Z',
          });
        } else {
          answers[field.key] =
            field.kind === 'yesno'
              ? 'yes'
              : field.kind === 'number'
                ? '1'
                : field.kind === 'select'
                  ? (
                      field.optionsWhen
                        ? (
                            answers[field.optionsWhen.key] ||= Object.keys(
                              field.optionsWhen.values,
                            )[0]
                          ) && optionsForField(field, answers)[0]
                        : field.options?.[0]
                    ) ?? 'fixture'
                  : 'fixture';
        }
      }
    }
    const submission: FormSubmission = {
      id: `form-${definition.type}`,
      form_type: definition.type,
      schema_version: definition.schemaVersion,
      status: 'Draft',
      installation_id: 'installation-1',
      answers,
      attachments,
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
    };
    assert.deepEqual(validateForm(submission), [], definition.type);
  }
});

test('scanner requirements are attached to every ingestion field', () => {
  const fields = Object.fromEntries(
    FORM_DEFINITIONS.flatMap((definition) =>
      definition.sections.flatMap((section) =>
        section.fields.map((field) => [`${definition.type}:${field.key}`, field]),
      )),
  );
  for (const key of [
    'ww-installation:device.id',
    'ww-installation:device.number',
    'comms-fault:existing.device_id',
    'comms-fault:existing.device_number',
    'comms-fault:works.new_device_id',
    'comms-fault:works.new_device_number',
    'ace-switchboard:job.number',
    'ace-switchboard:install.ct_serial_a',
    'ace-switchboard:install.ct_serial_b',
    'ace-switchboard:install.ct_serial_c',
    'honeywell-q400:water.serial_number',
    'captis-logger:meter.serial_number',
    'captis-logger:logger.serial_number',
  ]) {
    assert.deepEqual(fields[key]?.scanModes, ['barcode'], key);
  }
  assert.deepEqual(fields['ace-switchboard:job.qr_link']?.scanModes, ['qr']);
  assert.deepEqual(
    fields['sums-logger:meter.serial_number']?.scanModes,
    ['barcode', 'qr'],
  );
  assert.deepEqual(
    fields['sums-logger:logger.serial_number']?.scanModes,
    ['barcode', 'qr'],
  );
});

test('device identity authoring seeds blank compatibility numbers but preserves distinct values', () => {
  const ww = FORM_DEFINITION_BY_TYPE['ww-installation'];
  assert.deepEqual(
    answersAfterChange(ww, {}, 'device.id', 'SERIAL-100'),
    { 'device.id': 'SERIAL-100', 'device.number': 'SERIAL-100' },
  );
  assert.deepEqual(
    answersAfterChange(
      ww,
      { 'device.number': 'FIELD-100' },
      'device.id',
      'SERIAL-100',
    ),
    { 'device.id': 'SERIAL-100', 'device.number': 'FIELD-100' },
  );
  assert.equal(
    answersAfterChange(ww, {}, 'device.type', 'A3RM')['device.name'],
    'A3RM Meter',
  );
  assert.equal(
    answersAfterChange(
      ww,
      { 'device.type': 'A3RM', 'device.name': 'A3RM Meter' },
      'device.type',
      'A6M',
    )['device.name'],
    'A6M Meter',
  );
  assert.equal(
    answersAfterChange(
      ww,
      { 'device.type': 'A3RM', 'device.name': 'Boiler Meter' },
      'device.type',
      'A6M',
    )['device.name'],
    'Boiler Meter',
  );

  const comms = FORM_DEFINITION_BY_TYPE['comms-fault'];
  assert.deepEqual(
    answersAfterChange(comms, {}, 'existing.device_id', 'SERIAL-OLD'),
    { 'existing.device_id': 'SERIAL-OLD', 'existing.device_number': 'SERIAL-OLD' },
  );
  assert.deepEqual(
    answersAfterChange(
      comms,
      { 'works.replace_device': 'yes' },
      'works.new_device_id',
      'SERIAL-NEW',
    ),
    {
      'works.replace_device': 'yes',
      'works.new_device_id': 'SERIAL-NEW',
      'works.new_device_number': 'SERIAL-NEW',
    },
  );

  assert.deepEqual(withMirroredDeviceIdentityAnswers({
    'device.number': 'LEGACY-WW',
    'existing.device_number': 'LEGACY-OLD',
    'works.new_device_number': 'LEGACY-NEW',
  }), {
    'device.id': 'LEGACY-WW',
    'device.number': 'LEGACY-WW',
    'existing.device_id': 'LEGACY-OLD',
    'existing.device_number': 'LEGACY-OLD',
    'works.new_device_id': 'LEGACY-NEW',
    'works.new_device_number': 'LEGACY-NEW',
  });
});

test('every catalog photo slot remains a multi-photo collection', () => {
  const photoFields = FORM_DEFINITIONS.flatMap((definition) =>
    definition.sections.flatMap((section) =>
      section.fields.filter((field) => field.kind === 'photo'),
    ),
  );
  assert.ok(photoFields.length > 0);
  assert.equal(photoFields.every((field) => field.multiple === true), true);
});

test('hidden evidence follows channel purpose, model and replacement branches', () => {
  const ww = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const next = answersAfterChange(ww, {
    'device.type': 'A6M',
    'channel.4.purpose': 'Sub-circuit / asset',
    'channel.4.load': 'HVAC',
  }, 'channel.4.purpose', 'Spare / unused');
  assert.ok(hiddenFormPhotoSlots(ww, next).includes('channel.4.nameplate_photos'));
  assert.ok(hiddenFormPhotoSlots(ww, { 'device.type': 'A3RM' }).includes('channel.6.nameplate_photos'));
  const comms = FORM_DEFINITION_BY_TYPE['comms-fault'];
  assert.ok(hiddenFormPhotoSlots(comms, { 'works.replace_device': 'no' }).includes('commissioning.start_screenshot'));
  assert.equal(hiddenFormPhotoSlots(comms, { 'works.replace_device': 'yes' }).includes('commissioning.start_screenshot'), false);
});

test('legacy switchboard values remain selectable while sensor legacy choices stay model-specific', () => {
  const fields = FORM_DEFINITION_BY_TYPE['ww-installation'].sections.flatMap((section) => section.fields);
  const boardType = fields.find((field) => field.key === 'auditor.switchboard_type')!;
  assert.ok(optionsForField(boardType, { 'auditor.switchboard_type': 'Existing custom board' }).includes('Existing custom board'));
  const rating = fields.find((field) => field.key === 'channel.1.rating')!;
  assert.equal(optionsForField(rating, { 'device.type': 'A3RM', 'channel.1.rating': '60A' }).includes('60A'), false);
  assert.ok(optionsForField(rating, { 'device.type': 'A6M', 'channel.1.rating': '60A' }).includes('60A'));
});

test('minimal capture completes for every family while visible safety stays mandatory', () => {
  for (const definition of FORM_DEFINITIONS) {
    const submission: FormSubmission = {
      id: definition.type, form_type: definition.type, schema_version: definition.schemaVersion,
      installation_id: 'installation', status: 'Draft', answers: {}, attachments: [],
      created_at: '', updated_at: '',
    };
    const hasSafety = definition.sections.some((section) => section.fields.some((field) => field.key === 'prestart.safe_to_proceed'));
    assert.equal(validateForm(submission).length, hasSafety ? 1 : 0, definition.type);
    submission.answers['prestart.safe_to_proceed'] = 'yes';
    assert.deepEqual(validateForm(submission), [], definition.type);
  }
});

test('replacement completion needs valid new identity and model-specific sensor capture', () => {
  const submission: FormSubmission = {
    id: 'replacement', form_type: 'comms-fault', schema_version: 2,
    installation_id: 'installation', status: 'Draft', attachments: [],
    answers: { 'prestart.safe_to_proceed': 'yes', 'works.replace_device': 'yes' },
    created_at: '', updated_at: '',
  };
  assert.equal(validateForm(submission).length, 3);
  Object.assign(submission.answers, { 'works.new_device_type': 'A3RM', 'works.new_device_id': 'SERIAL', 'works.new_sensor_rating': '60A' });
  assert.equal(validateForm(submission).length, 1);
  submission.answers['works.new_sensor_rating'] = '3000A - 9cm';
  assert.deepEqual(validateForm(submission), []);
  submission.answers['works.replace_device'] = 'no';
  delete submission.answers['works.new_device_id'];
  assert.deepEqual(validateForm(submission), []);
});

test('SUMS has the same stored field keys as Captis', () => {
  const fieldKeys = (type: 'captis-logger' | 'sums-logger') =>
    FORM_DEFINITION_BY_TYPE[type].sections.flatMap((section) =>
      section.fields.map((field) => field.key),
    );
  assert.deepEqual(fieldKeys('sums-logger'), fieldKeys('captis-logger'));
});

test('report HTML escapes field values and retains the form title', () => {
  const submission: FormSubmission = {
    id: 'form-escape',
    form_type: 'honeywell-q400',
    schema_version: 1,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {
      'site.customer_name': '<script>alert("x")</script>',
    },
    attachments: [],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  const html = buildFormReportHtml(submission);
  assert.match(html, /Honeywell Q400 Water Meter Installation Form/);
  assert.match(html, /Prepared by Sustainability Wise/);
  assert.match(html, /Field App Complete/);
  assert.doesNotMatch(html, /InstallHub/);
  assert.match(html, /SUSTAINABILITY/);
  assert.match(html, /#142F70/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('report HTML renders escaped photo captions and still accepts legacy image strings', () => {
  const submission: FormSubmission = {
    id: 'form-caption',
    form_type: 'honeywell-q400',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {},
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  const html = buildFormReportHtml(submission, {
    'water.lcd_photo': [{
      uri: 'data:image/jpeg;base64,captioned',
      caption: '<script>alert("caption")</script>',
    }],
    'water.completed_photo': ['data:image/jpeg;base64,legacy'],
  });

  assert.match(html, /class="photo-caption"/);
  assert.match(
    html,
    /&lt;script&gt;alert\(&quot;caption&quot;\)&lt;\/script&gt;/,
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /src="data:image\/jpeg;base64,legacy"/);
});

test('Installation PDF omits A6M-only channels for an A3RM submission', () => {
  const submission: FormSubmission = {
    id: 'form-a3rm-v2',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {
      'device.type': 'A3RM',
    },
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  const html = buildFormReportHtml(submission);
  assert.match(html, /Channel 3/);
  assert.doesNotMatch(html, /Channel 4/);
});

test('SUMS report uses the SUMS form identity', () => {
  const submission: FormSubmission = {
    id: 'form-sums',
    form_type: 'sums-logger',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: {},
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.match(buildFormReportHtml(submission), /SUMS Logger Installation Form/);
});

test('optional numeric observations do not block completion', () => {
  const submission: FormSubmission = {
    id: 'form-number',
    form_type: 'captis-logger',
    schema_version: 1,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: { 'logger.rsrp': 'not-a-number' },
    attachments: [],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  assert.deepEqual(validateForm(submission), []);
});

test('stored clamp-current observations remain non-blocking for both models', () => {
  const base: FormSubmission = {
    id: 'a6-current-observation',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: {
      'device.type': 'A6M',
      'channel.1.purpose': 'Sub-circuit / asset',
      'channel.1.load': 'HVAC',
      'channel.1.rating': 'CT-60A',
      'commissioning.channel_1_current': 'Not Connected',
    },
    attachments: [],
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
  };
  assert.equal(
    validateForm(base).some((error) =>
      error.includes('Channel 1 current - AC clamp tester must be a number')),
    false,
  );
  assert.equal(
    validateForm({
      ...base,
      answers: { ...base.answers, 'device.type': 'A3RM' },
    }).some((error) =>
      error.includes('Channel 1 current - AC clamp tester must be a number')),
    false,
  );
});

test('optional numeric and select observations are preserved without completion errors', () => {
  const honeywell: FormSubmission = {
    id: 'form-optional-number',
    form_type: 'honeywell-q400',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: { 'site.latitude': 'not-a-coordinate' },
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.deepEqual(validateForm(honeywell), []);

  const comms: FormSubmission = {
    ...honeywell,
    id: 'form-optional-select',
    form_type: 'comms-fault',
    answers: { 'existing.signal': 'Invented signal' },
  };
  assert.equal(validateForm(comms).some((error) => error.includes('Existing signal')), false);

  const savedLegacySignal: FormSubmission = {
    ...comms,
    id: 'form-legacy-select',
    answers: { 'existing.signal': 'Excellent' },
  };
  assert.equal(
    validateForm(savedLegacySignal).some((error) =>
      error.includes('Existing signal strength has an invalid selection')),
    false,
  );
});

test('same-type form PDFs keep distinct stable paths for pack merging', () => {
  const base: FormSubmission = {
    id: 'form-first',
    form_type: 'honeywell-q400',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {
      'site.customer_name': 'Example Site',
      'site.date_time': '2026-07-23T09:30:00.000Z',
    },
    attachments: [],
    created_at: '2026-07-23T09:30:00.000Z',
    updated_at: '2026-07-23T09:30:00.000Z',
  };
  const first = formPdfFilename(base);
  const second = formPdfFilename({ ...base, id: 'form-amendment' });
  assert.notEqual(first, second);
  assert.match(first, /form-first\.pdf$/);
  assert.match(second, /form-amendment\.pdf$/);
});
