import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import {
  apiClient,
  getStoredCloudJwt,
  refreshStoredCloudJwt,
  type ExportJobStatus,
} from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';

const ACTIVE_REPORT_JOBS_KEY = 'installhub.active-report-jobs.v1';
const POLL_INTERVAL_MS = 3_000;

type ActiveReportJobs = Record<string, string>;

function safeFilename(value: string): string {
  const normalized = value
    .replace(/[^a-z0-9 ._()-]+/gi, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return normalized.toLowerCase().endsWith('.pdf')
    ? normalized
    : `${normalized || 'installhub-report'}.pdf`;
}

async function readActiveJobs(): Promise<ActiveReportJobs> {
  const raw = await AsyncStorage.getItem(ACTIVE_REPORT_JOBS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export async function rememberReportJob(
  entityKey: string,
  jobId: string,
): Promise<void> {
  const jobs = await readActiveJobs();
  jobs[entityKey] = jobId;
  await AsyncStorage.setItem(ACTIVE_REPORT_JOBS_KEY, JSON.stringify(jobs));
}

export async function rememberedReportJob(entityKey: string): Promise<string | null> {
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

async function authenticatedDownload(
  url: string,
  destination: File,
  token: string,
): Promise<File> {
  return File.downloadFileAsync(url, destination, {
    headers: { Authorization: `Bearer ${token}` },
    idempotent: true,
  });
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
  const token = await getStoredCloudJwt();
  if (!token) throw new Error('Cloud Backup is not connected.');

  try {
    return (await authenticatedDownload(url, destination, token)).uri;
  } catch (firstError) {
    const refreshed = await refreshStoredCloudJwt();
    if (!refreshed) throw firstError;
    return (await authenticatedDownload(url, destination, refreshed)).uri;
  }
}

export {
  formReportJobKey,
  installationReportJobKey,
} from './reportJobKeys';
