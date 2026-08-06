import type {
  FormSubmission,
  FormType,
  FormValue,
  Installation,
  Meter,
  User,
} from '../types';
import type { ScanMode } from '../components/BarcodeScanField';
import { WW_CHANNEL_PURPOSE_FORM_OPTIONS } from '../domain/formMeterPrefill';
import { humanDeviceLabel } from '../domain/meterCommissioning';
import { defaultMeterCustomName, nameAfterTypeChange } from '../domain/namingV2';

export type FormFieldKind = 'text' | 'multiline' | 'number' | 'yesno' | 'select' | 'photo';

export interface ConditionalOptions {
  key: string;
  values: Record<string, string[]>;
}

export interface FormFieldDefinition {
  key: string;
  label: string;
  kind: FormFieldKind;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  multiple?: boolean;
  showWhen?: { key: string; equals: string | string[] };
  optionsWhen?: ConditionalOptions;
  /** Keep a saved value selectable when a controlled list changed after the draft was created. */
  preserveLegacyValue?: boolean;
  /** Bounded historical choices accepted when preserveLegacyValue is enabled. */
  legacyOptions?: string[];
  /** A numeric field may accept named observations for selected controller values. */
  nonNumericValuesWhen?: ConditionalOptions;
  scanModes?: ScanMode[];
  allowNotApplicable?: boolean;
}

export interface FormSectionDefinition {
  title: string;
  fields: FormFieldDefinition[];
  showWhen?: { key: string; equals: string | string[] };
}

export interface FormDefinition {
  type: FormType;
  title: string;
  shortTitle: string;
  description: string;
  schemaVersion: number;
  availableForNew?: boolean;
  sections: FormSectionDefinition[];
}

const yes = (key: string, label: string, required = true): FormFieldDefinition => ({
  key,
  label,
  kind: 'yesno',
  required,
});
const text = (key: string, label: string, required = false): FormFieldDefinition => ({
  key,
  label,
  kind: 'text',
  required,
});
const number = (key: string, label: string, required = false): FormFieldDefinition => ({
  key,
  label,
  kind: 'number',
  required,
});
const photo = (key: string, label: string, required = true): FormFieldDefinition => ({
  key,
  label,
  kind: 'photo',
  required,
  multiple: true,
});
const scan = (
  key: string,
  label: string,
  modes: ScanMode[] = ['barcode'],
  required = true,
): FormFieldDefinition => ({
  key,
  label,
  kind: 'text',
  required,
  scanModes: modes,
});

const siteFields: FormFieldDefinition[] = [
  text('site.date_time', 'Date and time', true),
  text('site.customer_name', 'Customer / site name', true),
  { ...text('site.address', 'Address', true), kind: 'multiline' },
  number('site.latitude', 'Latitude'),
  number('site.longitude', 'Longitude'),
];

const installerFields: FormFieldDefinition[] = [
  text('installer.name', 'Installer name', true),
  text('installer.electrical_license', 'Electrical licence number'),
];

const prestartFields: FormFieldDefinition[] = [
  yes('prestart.site_inspection', 'Initial site inspection / checklist completed?', false),
  yes('prestart.site_induction', 'Is a site induction required?'),
  yes('prestart.safe_access', 'Do you have safe access?'),
  yes('prestart.correct_ppe', 'Do you have the correct PPE?'),
  yes('prestart.live_points', 'Are you aware of all LIVE points?'),
  yes('prestart.can_isolate', 'Can the power source be safely isolated?'),
  yes('prestart.additional_hazards', 'Additional hazards identified?'),
  {
    ...text('prestart.hazard_comments', 'Additional hazard comments'),
    kind: 'multiline',
    showWhen: { key: 'prestart.additional_hazards', equals: 'yes' },
  },
  yes('prestart.safe_to_proceed', 'Can you safely proceed?'),
];

const signalOptions = ['Low', 'Medium', 'High'];
const antennaOptions = ['Internal', 'External', 'CSM550 - External High Gain', 'Other'];
const legacySignalOptions = ['Excellent', 'Good', 'Fair', 'Poor', 'No signal', 'N/A'];
const legacyAntennaOptions = ['N/A'];
const legacySensorOptions = [
  '3000A - 9cm',
  '3000A - 20cm',
  '3000A - 29cm',
  '60A',
  '120A',
  '200A',
  '400A',
  '600A',
];
export const DEVICE_TYPES = ['A3RM', 'A6M'] as const;
export const SENSOR_OPTIONS_BY_DEVICE: Record<(typeof DEVICE_TYPES)[number], string[]> = {
  A3RM: ['10cm-200A', '10cm-333mV', '20cm-3000A', '30cm-3000A', '45cm-3000A', 'Not Used'],
  A6M: ['CT-60A', 'CT-120A', 'CT-250A', 'CT-400A', 'CT-600A', 'Not Used'],
};
const loads = [
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
const usedLoads = loads.filter((load) => load !== 'Not Used');

function deviceTypeField(key: string, label = 'Meter / Device Type'): FormFieldDefinition {
  return {
    key,
    label,
    kind: 'select',
    options: [...DEVICE_TYPES],
    required: true,
  };
}

function sensorField(
  key: string,
  deviceTypeKey: string,
  label = 'CT / Rogowski coil',
): FormFieldDefinition {
  return {
    key,
    label,
    kind: 'select',
    required: true,
    showWhen: { key: deviceTypeKey, equals: [...DEVICE_TYPES] },
    optionsWhen: {
      key: deviceTypeKey,
      values: SENSOR_OPTIONS_BY_DEVICE,
    },
    preserveLegacyValue: true,
    legacyOptions: legacySensorOptions,
  };
}

function dynamicChannelFields(): FormSectionDefinition[] {
  return Array.from({ length: 6 }, (_, index) => {
    const n = index + 1;
    const prefix = `channel.${n}`;
    return {
      title: `Channel ${n}`,
      showWhen:
        n <= 3
          ? { key: 'device.type', equals: [...DEVICE_TYPES] }
          : { key: 'device.type', equals: 'A6M' },
      fields: [
        {
          key: `${prefix}.purpose`,
          label: 'Channel purpose',
          kind: 'select',
          options: [...WW_CHANNEL_PURPOSE_FORM_OPTIONS],
          required: true,
        },
        {
          key: `${prefix}.load`,
          label: 'Load',
          kind: 'select',
          required: true,
          showWhen: {
            key: `${prefix}.purpose`,
            equals: ['Main board supply', 'Sub-circuit / asset'],
          },
          optionsWhen: {
            key: `${prefix}.purpose`,
            values: {
              'Main board supply': ['Mains Supply'],
              'Sub-circuit / asset': loads.filter(
                (load) => load !== 'Mains Supply' && load !== 'Not Used',
              ),
            },
          },
        },
        {
          ...text(`${prefix}.custom_load_type`, 'Custom load type', true),
          showWhen: { key: `${prefix}.load`, equals: 'Other' },
        },
        {
          ...sensorField(
            `${prefix}.rating`,
            'device.type',
            'CT / Rogowski coil rating',
          ),
          showWhen: { key: `${prefix}.load`, equals: usedLoads },
        },
        {
          ...text(`${prefix}.description`, 'Load description'),
          showWhen: { key: `${prefix}.load`, equals: usedLoads },
        },
        {
          ...photo(`${prefix}.nameplate_photos`, 'Load / nameplate photos', false),
          showWhen: { key: `${prefix}.load`, equals: usedLoads },
        },
      ],
    };
  });
}

function channelFields(kind: 'A3RM' | 'A6M', count: number): FormSectionDefinition[] {
  const ratings =
    kind === 'A3RM'
      ? ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm', 'Not Used']
      : ['60A', '120A', '200A', '400A', '600A', 'Not Used'];
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const prefix = `channel.${n}`;
    return {
      title: `Channel ${n}`,
      fields: [
        {
          key: `${prefix}.rating`,
          label: kind === 'A3RM' ? 'Rogowski coil size' : 'CT rating',
          kind: 'select',
          options: ratings,
          required: true,
        },
        { key: `${prefix}.load`, label: 'Load', kind: 'select', options: loads, required: true },
        text(`${prefix}.description`, 'Load description'),
        photo(`${prefix}.nameplate_photos`, 'Load / nameplate photos', false),
      ],
    };
  });
}

function auditorDefinition(kind: 'A3RM' | 'A6M'): FormDefinition {
  const lower = kind.toLowerCase();
  const sensor = kind === 'A3RM' ? 'Rogowski coil' : 'CT';
  return {
    type: `${lower}-installation` as FormType,
    title: `SW MaaS - ${kind} Auditor Installation Form`,
    shortTitle: `${kind} Installation`,
    description: `${kind} installation, channel setup, evidence and commissioning.`,
    schemaVersion: 1,
    availableForNew: false,
    sections: [
      { title: 'Site details', fields: siteFields },
      { title: 'Installer details', fields: installerFields },
      { title: 'Pre-start information', fields: prestartFields },
      {
        title: `${kind} installation details`,
        fields: [
          text('auditor.switchboard_name', 'Switchboard name', true),
          text('auditor.switchboard_location', 'Switchboard location', true),
          text('auditor.switchboard_type', 'Type of switchboard', true),
          text('auditor.site_nmi', 'Site NMI'),
          photo('auditor.location_before', 'Auditor location photos'),
          photo('auditor.sensor_before', `${sensor} location photos`),
          photo('auditor.cb_before', 'Circuit breaker location photos'),
          text('auditor.serial_number', `${kind} 4G Auditor serial number`, true),
        ],
      },
      ...channelFields(kind, kind === 'A3RM' ? 3 : 6),
      {
        title: 'Installed evidence',
        fields: [
          photo('auditor.installed_location', 'Installed Auditor location photos'),
          photo('auditor.serial_photo', 'Auditor serial-number photos'),
          photo('auditor.sensor_installed', `Installed ${sensor} location photos`),
          photo('auditor.cb_installed', 'Installed circuit-breaker location photos'),
        ],
      },
      {
        title: 'Commissioning',
        fields: [
          yes('commissioning.energised', 'Is the Auditor energised?'),
          yes('commissioning.leds_visible', 'Are all three LEDs visible?'),
          yes('commissioning.online', 'Is the Auditor online in the WW Onboarding App?'),
          {
            key: 'commissioning.signal_strength',
            label: '4G signal strength',
            kind: 'select',
            options: signalOptions,
            required: true,
            preserveLegacyValue: true,
            legacyOptions: legacySignalOptions,
          },
          {
            key: 'commissioning.antenna_type',
            label: 'Antenna type',
            kind: 'select',
            options: antennaOptions,
            required: true,
            preserveLegacyValue: true,
            legacyOptions: legacyAntennaOptions,
          },
          yes('commissioning.start_complete', 'Start page completed?'),
          photo('commissioning.start_screenshot', 'Start page screenshot'),
          yes('commissioning.channels_complete', 'Channels page completed?'),
          photo('commissioning.channels_screenshot', 'Channels page screenshot'),
          number('commissioning.phase_a_voltage', 'Phase A voltage - multi meter', true),
          number('commissioning.phase_b_voltage', 'Phase B voltage - multi meter', true),
          number('commissioning.phase_c_voltage', 'Phase C voltage - multi meter', true),
          ...Array.from({ length: kind === 'A3RM' ? 3 : 6 }, (_, i) => {
            const n = i + 1;
            const usedRatings =
              kind === 'A3RM'
                ? ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm']
                : ['60A', '120A', '200A', '400A', '600A'];
            return [
              {
                ...yes(`commissioning.channel_${n}_polarity`, `Channel ${n} polarity correct?`, false),
                showWhen: { key: `channel.${n}.rating`, equals: usedRatings },
              },
              {
                ...(kind === 'A6M'
                  ? {
                      ...text(`commissioning.channel_${n}_current`, `Channel ${n} current - AC clamp tester`),
                      placeholder: 'e.g. 2.61 or Not Connected',
                    }
                  : number(`commissioning.channel_${n}_current`, `Channel ${n} current - AC clamp tester`)),
                showWhen: { key: `channel.${n}.rating`, equals: usedRatings },
              },
            ];
          }).flat(),
          photo('commissioning.energy_screenshot', 'Energy page screenshot'),
          photo('commissioning.completed_photos', 'Completed installation photos (include the antenna)'),
          { ...text('commissioning.final_comments', 'Final comments'), kind: 'multiline' },
        ],
      },
    ],
  };
}

function wattwatcherInstallationDefinition(): FormDefinition {
  return {
    type: 'ww-installation',
    title: 'SW MaaS - 4G Auditor Installation Form',
    shortTitle: 'Installation Form (WW)',
    description: 'A3RM/A6M installation, channel setup, evidence and commissioning.',
    schemaVersion: 2,
    sections: [
      { title: 'Site details', fields: siteFields },
      { title: 'Installer details', fields: installerFields },
      { title: 'Pre-start information', fields: prestartFields },
      {
        title: '4G Auditor installation details',
        fields: [
          text('auditor.switchboard_name', 'Switchboard name', true),
          text('auditor.switchboard_location', 'Switchboard location', true),
          text('auditor.switchboard_type', 'Type of switchboard', true),
          text('auditor.site_nmi', 'Site NMI'),
          text('auditor.address_map_locator', 'Address map locator (latitude / longitude)'),
          photo('auditor.location_before', 'Auditor location photos'),
          photo('auditor.sensor_before', 'CT / Rogowski coil location photos'),
          photo('auditor.cb_before', 'Circuit breaker location photos'),
          deviceTypeField('device.type'),
          scan('device.id', 'Device ID / serial'),
          scan(
            'device.number',
            'Site / asset tag (optional; not the Device ID / serial)',
            ['barcode'],
            false,
          ),
          text('device.name', 'Device name'),
        ],
      },
      ...dynamicChannelFields(),
      {
        title: 'Installed evidence',
        fields: [
          photo('auditor.installed_location', 'Installed Auditor location photos'),
          photo('auditor.serial_photo', 'Auditor serial-number photos'),
          photo('auditor.sensor_installed', 'Installed CT / Rogowski coil location photos'),
          photo('auditor.cb_installed', 'Installed circuit-breaker location photos'),
        ],
      },
      {
        title: 'Commissioning',
        fields: [
          yes('commissioning.energised', 'Is the Auditor energised?'),
          yes('commissioning.leds_visible', 'Are all three LEDs visible?'),
          yes('commissioning.online', 'Is the Auditor online in the WW Onboarding App?'),
          {
            key: 'commissioning.signal_strength',
            label: '4G signal strength',
            kind: 'select',
            options: signalOptions,
            required: true,
            preserveLegacyValue: true,
            legacyOptions: legacySignalOptions,
          },
          {
            key: 'commissioning.antenna_type',
            label: 'Antenna type',
            kind: 'select',
            options: antennaOptions,
            required: true,
            preserveLegacyValue: true,
            legacyOptions: legacyAntennaOptions,
          },
          yes('commissioning.start_complete', 'Start page completed?'),
          photo('commissioning.start_screenshot', 'Start page screenshot'),
          yes('commissioning.channels_complete', 'Channels page completed?'),
          photo('commissioning.channels_screenshot', 'Channels page screenshot'),
          number('commissioning.phase_a_voltage', 'Phase A voltage - multi meter', true),
          number('commissioning.phase_b_voltage', 'Phase B voltage - multi meter', true),
          number('commissioning.phase_c_voltage', 'Phase C voltage - multi meter', true),
          ...Array.from({ length: 6 }, (_, i) => {
            const n = i + 1;
            return [
              {
                ...yes(
                  `commissioning.channel_${n}_polarity`,
                  `Channel ${n} polarity correct?`,
                  false,
                ),
                showWhen: {
                  key: `channel.${n}.load`,
                  equals: usedLoads,
                },
              },
              {
                ...number(
                  `commissioning.channel_${n}_current`,
                  `Channel ${n} current - AC clamp tester`,
                ),
                placeholder: 'e.g. 2.61 or Not Connected',
                nonNumericValuesWhen: {
                  key: 'device.type',
                  values: { A6M: ['Not Connected'] },
                },
                showWhen: {
                  key: `channel.${n}.load`,
                  equals: usedLoads,
                },
              },
            ];
          }).flat(),
          photo('commissioning.energy_screenshot', 'Energy page screenshot'),
          photo('commissioning.completed_photos', 'Completed installation photos (include the antenna)'),
          { ...text('commissioning.final_comments', 'Final comments'), kind: 'multiline' },
        ],
      },
    ],
  };
}

export const FORM_DEFINITIONS: FormDefinition[] = [
  wattwatcherInstallationDefinition(),
  auditorDefinition('A3RM'),
  auditorDefinition('A6M'),
  {
    type: 'comms-fault',
    title: 'SW MaaS - Comms Fault',
    shortTitle: 'Comms Fault',
    description: 'Diagnose, replace and recommission an existing 4G Auditor.',
    schemaVersion: 2,
    sections: [
      { title: 'Customer details', fields: siteFields },
      { title: 'Installer details', fields: installerFields },
      { title: 'Pre-start information', fields: prestartFields },
      {
        title: 'Existing installation',
        fields: [
          text('existing.switchboard_location', 'Switchboard location', true),
          text('existing.switchboard_type', 'Type of switchboard', true),
          text('existing.site_nmi', 'Site NMI'),
          photo('existing.switchboard_photos', 'Whole switchboard photos'),
          deviceTypeField('existing.device_type', 'Existing Meter / Device Type'),
          scan('existing.device_id', 'Existing Device ID / serial'),
          sensorField(
            'existing.sensor_rating',
            'existing.device_type',
            'Existing CT / Rogowski coil rating',
          ),
          yes('existing.energised', 'Is the Auditor energised?'),
          yes('existing.leds_visible', 'Are LEDs visible?'),
          yes('existing.online', 'Is the Auditor online in the WW app?'),
          { key: 'existing.signal', label: 'Existing signal strength', kind: 'select', options: signalOptions, preserveLegacyValue: true, legacyOptions: legacySignalOptions },
          { key: 'existing.antenna', label: 'Existing antenna type', kind: 'select', options: antennaOptions, preserveLegacyValue: true, legacyOptions: legacyAntennaOptions },
        ],
      },
      {
        title: 'On-site works',
        fields: [
          yes('works.rebooted', 'Device rebooted?'),
          yes('works.leds_visible', 'Relevant LEDs visible after reboot?'),
          yes('works.replace_device', 'Does the device need replacement?'),
          {
            ...deviceTypeField('works.new_device_type', 'New Meter / Device Type'),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          {
            ...scan('works.new_device_id', 'New Device ID / serial'),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          {
            ...scan(
              'works.new_device_number',
              'New site / asset tag (optional; not the Device ID / serial)',
              ['barcode'],
              false,
            ),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          {
            ...sensorField(
              'works.new_sensor_rating',
              'works.new_device_type',
              'New CT / Rogowski coil rating',
            ),
          },
          { ...yes('works.new_online', 'Is the new device online?'), showWhen: { key: 'works.replace_device', equals: 'yes' } },
          { key: 'works.new_signal', label: 'New device signal strength', kind: 'select', options: signalOptions, preserveLegacyValue: true, legacyOptions: legacySignalOptions, showWhen: { key: 'works.replace_device', equals: 'yes' } },
          yes('works.external_antenna', 'Install an external antenna?'),
          { key: 'works.external_signal', label: 'Signal after external antenna', kind: 'select', options: signalOptions, preserveLegacyValue: true, legacyOptions: legacySignalOptions, showWhen: { key: 'works.external_antenna', equals: 'yes' } },
          yes('works.extend_antenna', 'Extend the external antenna?'),
          { key: 'works.extended_signal', label: 'Signal after antenna extension', kind: 'select', options: signalOptions, preserveLegacyValue: true, legacyOptions: legacySignalOptions, showWhen: { key: 'works.extend_antenna', equals: 'yes' } },
        ],
      },
      {
        title: 'Commissioning details',
        fields: [
          {
            ...yes(
              'commissioning.onboarding_complete',
              'WW Onboarding App completed for the new device?',
            ),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          {
            ...yes(
              'commissioning.details_same',
              'New device details match the old device?',
            ),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          {
            ...photo('commissioning.start_screenshot', 'Start page screenshot'),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          {
            ...photo('commissioning.energy_screenshot', 'Energy page screenshot'),
            showWhen: { key: 'works.replace_device', equals: 'yes' },
          },
          photo('commissioning.completed_photos', 'Final completed-work photos (include the antenna)'),
          { ...text('commissioning.final_comments', 'Final comments'), kind: 'multiline' },
        ],
      },
    ],
  },
  {
    type: 'ace-switchboard',
    title: 'ACE Switchboards - Installation, Testing and Commissioning Form',
    shortTitle: 'ACE Switchboard',
    description: 'CT chamber, meter panel, wiring, testing and final checks.',
    schemaVersion: 2,
    sections: [
      {
        title: 'Switchboard details',
        fields: [
          text('site.date_time', 'Date', true),
          text('job.name', 'Job name', true),
          scan('job.number', 'Job number'),
          scan('job.qr_link', 'Switchboard QR / document link', ['qr'], false),
        ],
      },
      {
        title: 'Installer details',
        fields: [...installerFields, text('installer.rec_number', 'REC number')],
      },
      {
        title: 'Installation information',
        fields: [
          yes('install.ct_installed', 'Have the CTs been installed?'),
          yes('install.ct_orientation', 'Are CTs installed with P1 facing the grid?'),
          text('install.ct_ratio', 'CT ratio', true),
          scan('install.ct_serial_a', 'Phase A CT serial number'),
          scan('install.ct_serial_b', 'Phase B CT serial number'),
          scan('install.ct_serial_c', 'Phase C CT serial number'),
          photo('install.ct_chamber_photo', 'CT chamber photos'),
          yes('install.test_block', 'Has a test block been installed?'),
          yes('install.remove_star_point', 'Does the star point need removal?'),
          yes('install.star_point_removed', 'Has the star point been removed?'),
          yes('install.ct_fuses', 'Fuses installed in CT chamber?'),
          text('install.ct_fuse_rating', 'CT chamber fuse rating'),
          yes('install.secondary_fuses', 'Secondary fuses installed on meter panel?'),
          text('install.secondary_fuse_rating', 'Meter panel fuse rating'),
          photo('install.meter_panel_photo', 'Meter panel photos'),
          yes('install.loom_installed', 'Has the loom cable been installed?'),
          text('install.loom_type', 'Loom cable type'),
          text('install.loom_size', 'Loom cable size'),
          yes('install.wiring_complete', 'CT chamber and meter panel wiring complete?'),
          photo('install.ct_wiring_photo', 'Completed CT chamber wiring photos'),
          photo('install.panel_wiring_photo', 'Completed meter panel wiring photos'),
        ],
      },
      {
        title: 'Pre-commissioning',
        fields: [
          yes('precommission.test_meter', 'Test meter connected?'),
          yes('precommission.point_to_point', 'Point-to-point testing completed?'),
          yes('precommission.load_box', '100A load box connected?'),
          yes('precommission.safe_energise', 'Safe to energise for testing?'),
          yes('precommission.correct_ppe', 'Correct PPE worn?'),
          yes('precommission.energised', 'Installation energised and live points understood?'),
          yes('precommission.ct_ratio_set', 'Correct CT ratio set in test meter?'),
        ],
      },
      {
        title: 'Commissioning / testing',
        fields: [
          ...['a', 'b', 'c'].flatMap((p) => [
            number(`testing.phase_${p}_voltage`, `Phase ${p.toUpperCase()} voltage`, true),
            number(`testing.phase_${p}_primary_current`, `Phase ${p.toUpperCase()} primary current`, true),
            number(`testing.phase_${p}_secondary_current`, `Phase ${p.toUpperCase()} secondary current`, true),
          ]),
          photo('testing.status_screen', 'EziView status-screen photos'),
          photo('testing.phasor_diagram', 'EziView phasor-diagram photos'),
        ],
      },
      {
        title: 'Final checks',
        fields: [
          yes('final.deenergised', 'Installation de-energised?'),
          yes('final.load_box_removed', 'Load box removed?'),
          yes('final.test_meter_removed', 'Test meter removed?'),
          yes('final.connectors_installed', 'Single-screw connectors installed?'),
          yes('final.connections_checked', 'All connections checked?'),
          yes('final.completed', 'Installation, testing and commissioning completed?'),
          photo('final.completed_photo', 'Completed installation photos (include the antenna)'),
        ],
      },
    ],
  },
  {
    type: 'honeywell-q400',
    title: 'SW MaaS - Honeywell Q400 Water Meter Installation Form',
    shortTitle: 'Honeywell Q400',
    description: 'Water-meter activation, registration and installation evidence.',
    schemaVersion: 2,
    sections: [
      { title: 'Installation details', fields: [...siteFields, text('water.physical_location', 'Physical meter location', true)] },
      { title: 'Installer details', fields: installerFields.slice(0, 1) },
      {
        title: 'Water meter information',
        fields: [
          scan('water.serial_number', 'Water meter serial number'),
          yes('water.activated', 'Activated per SW work instructions?'),
          yes('water.network_registered', 'Registered to the network?'),
          photo('water.lcd_photo', 'LCD screen showing 4 0 2'),
          photo('water.completed_photo', 'Completed water-meter installation'),
        ],
      },
    ],
  },
  {
    type: 'captis-logger',
    title: 'SW MaaS - Captis Logger Installation Form',
    shortTitle: 'Captis Logger',
    description: 'Water meter, pulse sensor and Captis/Cumulocity commissioning.',
    schemaVersion: 2,
    sections: [
      {
        title: 'Installation details',
        fields: [
          ...siteFields,
          text('captis.physical_location', 'Physical Captis Logger location', true),
          text('captis.supply_description', 'Meter supply description', true),
        ],
      },
      { title: 'Installer details', fields: installerFields.slice(0, 1) },
      {
        title: 'Meter information',
        fields: [
          text('meter.type', 'Meter type', true),
          text('meter.make', 'Meter make', true),
          text('meter.model', 'Meter model', true),
          scan('meter.serial_number', 'Meter serial number'),
          text('meter.sensor_type', 'Pulse / sensor type', true),
          text('meter.flow_rate', 'Pulse / flow rate', true),
          text('meter.current_read', 'Current meter read (offset value)', true),
          photo('meter.face_photo', 'Meter face close-up'),
        ],
      },
      {
        title: 'Captis Logger information',
        fields: [
          scan('logger.serial_number', 'Captis Logger serial number'),
          number('logger.rsrp', 'RSRP value / signal strength', true),
          yes('logger.external_antenna', 'External antenna installed?'),
          yes('logger.cumulocity_configured', 'Cumulocity configured?'),
          yes('logger.screenshot_taken', 'Cumulocity screenshot taken?'),
          photo('logger.cumulocity_screenshot', 'Cumulocity screenshot'),
        ],
      },
    ],
  },
  {
    type: 'sums-logger',
    title: 'SW MaaS - SUMS Logger Installation Form',
    shortTitle: 'SUMS Logger',
    description: 'Water meter, pulse sensor and SUMS/Cumulocity commissioning.',
    schemaVersion: 2,
    sections: [
      {
        title: 'Installation details',
        fields: [
          ...siteFields,
          text('captis.physical_location', 'Physical SUMS Logger location', true),
          text('captis.supply_description', 'Meter supply description', true),
        ],
      },
      { title: 'Installer details', fields: installerFields.slice(0, 1) },
      {
        title: 'Meter information',
        fields: [
          text('meter.type', 'Meter type', true),
          text('meter.make', 'Meter make', true),
          text('meter.model', 'Meter model', true),
          scan('meter.serial_number', 'Meter serial number', ['barcode', 'qr']),
          text('meter.sensor_type', 'Pulse / sensor type', true),
          text('meter.flow_rate', 'Pulse / flow rate', true),
          text('meter.current_read', 'Current meter read (offset value)', true),
          photo('meter.face_photo', 'Meter face close-up'),
        ],
      },
      {
        title: 'SUMS Logger information',
        fields: [
          scan('logger.serial_number', 'SUMS Logger serial number', ['barcode', 'qr']),
          number('logger.rsrp', 'RSRP value / signal strength', true),
          yes('logger.external_antenna', 'External antenna installed?'),
          yes('logger.cumulocity_configured', 'Cumulocity configured?'),
          yes('logger.screenshot_taken', 'Cumulocity screenshot taken?'),
          photo('logger.cumulocity_screenshot', 'Cumulocity screenshot'),
        ],
      },
    ],
  },
];

export const FORM_DEFINITION_BY_TYPE = Object.fromEntries(
  FORM_DEFINITIONS.map((definition) => [definition.type, definition]),
) as Record<FormType, FormDefinition>;

export function createInitialFormAnswers(
  installation: Installation,
  user: User,
): Record<string, FormValue> {
  return {
    'site.date_time': new Date().toISOString(),
    'site.customer_name': installation.client_name || installation.site_name,
    'site.address': installation.site_address,
    'installer.name': user.full_name,
  };
}

export function isFieldVisible(
  field: FormFieldDefinition,
  answers: Record<string, FormValue>,
): boolean {
  if (!field.showWhen) return true;
  const expected = Array.isArray(field.showWhen.equals)
    ? field.showWhen.equals
    : [field.showWhen.equals];
  return expected.includes(String(answers[field.showWhen.key] ?? ''));
}

export function isSectionVisible(
  section: FormSectionDefinition,
  answers: Record<string, FormValue>,
): boolean {
  if (!section.showWhen) return true;
  const expected = Array.isArray(section.showWhen.equals)
    ? section.showWhen.equals
    : [section.showWhen.equals];
  return expected.includes(String(answers[section.showWhen.key] ?? ''));
}

function authoredOptionsForField(
  field: FormFieldDefinition,
  answers: Record<string, FormValue>,
): string[] {
  if (!field.optionsWhen) return field.options ?? [];
  return field.optionsWhen.values[String(answers[field.optionsWhen.key] ?? '')] ?? [];
}

export function optionsForField(
  field: FormFieldDefinition,
  answers: Record<string, FormValue>,
): string[] {
  const options = authoredOptionsForField(field, answers);
  if (!field.preserveLegacyValue) return options;
  const saved = String(answers[field.key] ?? '').trim();
  return saved
    && !options.includes(saved)
    && (field.legacyOptions?.includes(saved) ?? false)
    ? [...options, saved]
    : options;
}

export function nonNumericValuesForField(
  field: FormFieldDefinition,
  answers: Record<string, FormValue>,
): string[] {
  if (!field.nonNumericValuesWhen) return [];
  return field.nonNumericValuesWhen.values[
    String(answers[field.nonNumericValuesWhen.key] ?? '')
  ] ?? [];
}

export function answersAfterChange(
  definition: FormDefinition,
  answers: Record<string, FormValue>,
  key: string,
  value: string,
): Record<string, FormValue> {
  const next = { ...answers, [key]: value };
  const compatibilityKey = {
    'device.id': 'device.number',
    'existing.device_id': 'existing.device_number',
    'works.new_device_id': 'works.new_device_number',
  }[key];
  if (compatibilityKey && !String(next[compatibilityKey] ?? '').trim()) {
    next[compatibilityKey] = value;
  }
  if (key === 'device.type' && DEVICE_TYPES.includes(value as (typeof DEVICE_TYPES)[number])) {
    const previousType = String(answers['device.type'] ?? '');
    const previousDefault = DEVICE_TYPES.includes(previousType as (typeof DEVICE_TYPES)[number])
      ? defaultMeterCustomName(previousType as (typeof DEVICE_TYPES)[number])
      : '';
    next['device.name'] = nameAfterTypeChange(
      String(answers['device.name'] ?? ''),
      previousDefault,
      defaultMeterCustomName(value as (typeof DEVICE_TYPES)[number]),
    );
  }
  for (const section of definition.sections) {
    if (!isSectionVisible(section, next)) {
      for (const field of section.fields) delete next[field.key];
      continue;
    }
    for (const field of section.fields) {
      if (!isFieldVisible(field, next)) {
        delete next[field.key];
        continue;
      }
      if (field.optionsWhen?.key !== key) continue;
      const selected = String(next[field.key] ?? '');
      if (selected && !authoredOptionsForField(field, next).includes(selected)) delete next[field.key];
    }
  }
  if (!next['works.new_device_id']) delete next['works.new_device_number'];
  return next;
}

/** Seed a missing compatibility identity without overwriting a distinct field
 * number that the installer scanned or typed explicitly. */
export function withMirroredDeviceIdentityAnswers(
  answers: Record<string, FormValue>,
): Record<string, FormValue> {
  const next = { ...answers };
  for (const [identityKey, compatibilityKey] of [
    ['device.id', 'device.number'],
    ['existing.device_id', 'existing.device_number'],
    ['works.new_device_id', 'works.new_device_number'],
  ] as const) {
    const identity = String(next[identityKey] ?? '').trim();
    const compatibility = String(next[compatibilityKey] ?? '').trim();
    if (!identity && compatibility) next[identityKey] = compatibility;
    if (!compatibility && identity) next[compatibilityKey] = identity;
  }
  return next;
}

export function validateForm(submission: FormSubmission): string[] {
  const definition = FORM_DEFINITION_BY_TYPE[submission.form_type];
  const errors: string[] = [];
  for (const section of definition.sections) {
    if (!isSectionVisible(section, submission.answers)) continue;
    for (const field of section.fields) {
      if (!isFieldVisible(field, submission.answers)) continue;
      if (field.kind === 'photo') {
        if (
          field.required &&
          !submission.attachments.some((item) => item.slot === field.key)
        ) {
          errors.push(`${section.title}: ${field.label}`);
        }
        continue;
      }
      const value = String(submission.answers[field.key] ?? '').trim();
      if (!value) {
        if (!field.required) continue;
        errors.push(`${section.title}: ${field.label}`);
      } else if (
        field.kind === 'yesno' &&
        ![
          'yes',
          'no',
          ...(field.allowNotApplicable ? ['not_applicable'] : []),
        ].includes(value)
      ) {
        errors.push(`${section.title}: ${field.label} has an invalid selection`);
      } else if (
        field.kind === 'number' &&
        !Number.isFinite(Number(value)) &&
        !nonNumericValuesForField(field, submission.answers).some(
          (allowed) => allowed.toLocaleLowerCase() === value.toLocaleLowerCase(),
        )
      ) {
        errors.push(`${section.title}: ${field.label} must be a number`);
      } else if (
        field.kind === 'select' &&
        !optionsForField(field, submission.answers).includes(
          value,
        )
      ) {
        errors.push(`${section.title}: ${field.label} has an invalid selection`);
      }
    }
  }
  return errors;
}

export function meterAfterCommsReplacement(
  meter: Meter,
  answers: Record<string, FormValue>,
  labelPrefix = '',
): Meter {
  const deviceType = String(answers['works.new_device_type'] ?? '');
  if (!DEVICE_TYPES.includes(deviceType as (typeof DEVICE_TYPES)[number])) return meter;

  const typedDevice = deviceType as (typeof DEVICE_TYPES)[number];
  const deviceId = String(answers['works.new_device_id'] ?? '');
  const sensorRating = String(answers['works.new_sensor_rating'] ?? '');
  const channelCount = typedDevice === 'A3RM' ? 3 : 6;
  const previousDefaultName = defaultMeterCustomName(meter.device_type);
  const customName = nameAfterTypeChange(
    meter.custom_name ?? '',
    previousDefaultName,
    defaultMeterCustomName(typedDevice),
  );
  return {
    ...meter,
    device_name: humanDeviceLabel(labelPrefix, typedDevice, deviceId),
    custom_name: customName,
    device_type: typedDevice,
    device_id: deviceId,
    device_number: String(answers['works.new_device_number'] ?? '').trim() || deviceId,
    ww_channels: Array.from({ length: channelCount }, (_, index) => {
      const {
        rogowski_size: _rogowskiSize,
        ct_ratio: _ctRatio,
        ...shared
      } = meter.ww_channels?.[index] ?? {};
      return {
        ...shared,
        ...(typedDevice === 'A3RM'
          ? { rogowski_size: sensorRating }
          : { ct_ratio: sensorRating }),
      };
    }),
  };
}
