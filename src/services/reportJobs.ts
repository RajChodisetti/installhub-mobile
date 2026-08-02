import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import {
  apiClient,
  runWithCloudAccessToken,
  type ExportJobStatus,
} from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';
import type { ReportJobPin } from './reportVersioning';
import { authenticatedFileDownload } from './authenticatedFileDownload';

const ACTIVE_REPORT_JOBS_KEY = 'installhub.active-report-jobs.v1';
const POLL_INTERVAL_MS = 3_000;

export type RememberedReportJob = {
  jobId: string;
  recordVersionNumber?: number | null;
  recordVersionPayloadHash?: string | null;
  reportSource?: string | null;
};

type ActiveReportJobs = Record<string, RememberedReportJob>;

function safeFilename(value: string): string {
  const normalized = value
    .replace(/[^a-z0-9 ._()-]+/gi, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return normalized.toLowerCase().endsWith('.pdf')
    ? normalized
    : `${normalized || 'field-app-complete-report'}.pdf`;
}

async function readActiveJobs(): Promise<ActiveReportJobs> {
  const raw = await AsyncStorage.getItem(ACTIVE_REPORT_JOBS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        // v1 stored only job IDs. Keep them readable, but callers will verify
        // the echoed version/hash before resuming.
        if (typeof value === 'string') return [[key, { jobId: value }]];
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        if (typeof row.jobId !== 'string' || !row.jobId) return [];
        return [[key, {
          jobId: row.jobId,
          ...(typeof row.recordVersionNumber === 'number' || row.recordVersionNumber === null
            ? { recordVersionNumber: row.recordVersionNumber }
            : {}),
          ...(typeof row.recordVersionPayloadHash === 'string' || row.recordVersionPayloadHash === null
            ? { recordVersionPayloadHash: row.recordVersionPayloadHash }
            : {}),
          ...(typeof row.reportSource === 'string' || row.reportSource === null
            ? { reportSource: row.reportSource }
            : {}),
        } satisfies RememberedReportJob]];
      }),
    );
  } catch {
    return {};
  }
}

export async function rememberReportJob(
  entityKey: string,
  jobId: string,
  pin: ReportJobPin = {},
): Promise<void> {
  const jobs = await readActiveJobs();
  jobs[entityKey] = { jobId, ...pin };
  await AsyncStorage.setItem(ACTIVE_REPORT_JOBS_KEY, JSON.stringify(jobs));
}

export async function rememberedReportJob(entityKey: string): Promise<RememberedReportJob | null> {
  return (await readActiveJobs())[entityKey] ?? null;
}

export async function clearRememberedReportJob(entityKey: string): Promise<void> {
  const jobs = await readActiveJobs();
  if (!(entityKey in jobs)) return;
  delete jobs[entityKey];
  await AsyncStorage.setItem(ACTIVE_REPORT_JOBS_KEY, JSON.stringify(jobs));
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('PDF generation was cancelled.'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('PDF generation was cancelled.'));
      },
      { once: true },
    );
  });
}

export async function waitForReportJob(
  jobId: string,
  onStatus: (status: ExportJobStatus) => void = () => {},
  signal?: AbortSignal,
): Promise<ExportJobStatus> {
  while (!signal?.aborted) {
    const status = await apiClient.getExportJobStatus(jobId);
    onStatus(status);
    if (status.status === 'complete') return status;
    if (status.status === 'failed') {
      throw new Error(status.error || 'PDF generation failed on the API server.');
    }
    await wait(POLL_INTERVAL_MS, signal);
  }
  throw new Error('PDF generation was cancelled.');
}

export async function downloadReportJob(
  jobId: string,
  filename: string,
): Promise<string> {
  const directory = new Directory(Paths.cache, 'form-reports');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(
    directory,
    `${Date.now()}-${safeFilename(filename)}`,
  );
  const url =
    `${SYNC_API_URL}/v1/export/jobs/${encodeURIComponent(jobId)}/download`;
  const downloaded = await runWithCloudAccessToken(
    (token) => authenticatedFileDownload({
      url,
      destination,
      token,
      expectedContentType: 'application/pdf',
    }),
  );
  return downloaded.uri;
}

export {
  formReportJobKey,
  installationReportJobKey,
} from './reportJobKeys';
