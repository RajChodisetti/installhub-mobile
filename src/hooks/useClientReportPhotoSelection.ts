import { useCallback, useEffect, useRef, useState } from 'react';
import { withClientReportPhotoIncluded, type ClientReportPhoto, type ClientReportPhotoExclusions } from '../domain/clientReport';
import { readClientReportPhotoExclusions, subscribeClientReportPhotoExclusions, writeClientReportPhotoExclusions } from '../repositories/clientReportPreferencesRepository';

type SelectionState = {
  installationId: string;
  excluded: ClientReportPhotoExclusions;
  loading: boolean;
  loaded: boolean;
  readError: string;
  writeError: string;
};
const emptySelection = (installationId: string): SelectionState => ({
  installationId, excluded: {}, loading: true, loaded: false, readError: '', writeError: '',
});

export function useClientReportPhotoSelection(installationId: string) {
  const [state, setState] = useState(() => emptySelection(installationId));
  const stateRef = useRef(state);
  stateRef.current = state;
  const scope = useRef(installationId);
  scope.current = installationId;
  const mounted = useRef(true);
  const readVersion = useRef(0);
  const writeVersion = useRef(0);
  const publish = (next: SelectionState) => { stateRef.current = next; setState(next); };

  const refresh = useCallback(async () => {
    if (!mounted.current || scope.current !== installationId) return;
    const version = ++readVersion.current;
    const isCurrent = () => mounted.current && scope.current === installationId && version === readVersion.current;
    const previous = stateRef.current.installationId === installationId ? stateRef.current : emptySelection(installationId);
    publish({ ...previous, loading: true, readError: '' });
    try {
      const excluded = await readClientReportPhotoExclusions(installationId);
      if (isCurrent()) publish({ ...stateRef.current, excluded, loaded: true, loading: false, readError: '' });
    } catch (caught) {
      if (isCurrent()) publish({ ...stateRef.current, loading: false,
        readError: 'Saved photo choices could not be loaded. Retry before preparing the client report.' });
      throw caught;
    }
  }, [installationId]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeClientReportPhotoExclusions(installationId, (excluded) => {
      if (!mounted.current || scope.current !== installationId) return;
      // A choice explicitly made on another retained screen is valid for this
      // session and must not be replaced by an older pending storage read.
      readVersion.current += 1;
      const previous = stateRef.current.installationId === installationId ? stateRef.current : emptySelection(installationId);
      const changed = previous.excluded !== excluded;
      if (changed) writeVersion.current += 1;
      publish({ ...previous, excluded, loaded: true, loading: false, readError: '', writeError: changed ? '' : previous.writeError });
    });
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false; readVersion.current += 1; writeVersion.current += 1; unsubscribe();
    };
  }, [installationId, refresh]);

  const toggle = useCallback(async (photo: ClientReportPhoto, included: boolean) => {
    const previous = stateRef.current;
    if (!mounted.current || scope.current !== installationId || previous.installationId !== installationId
      || !previous.loaded || previous.loading || previous.readError) return;
    const version = ++writeVersion.current;
    const excluded = withClientReportPhotoIncluded(previous.excluded, photo, included);
    publish({ ...previous, excluded, writeError: '' });
    const isCurrent = () => mounted.current && scope.current === installationId && version === writeVersion.current;
    try {
      await writeClientReportPhotoExclusions(installationId, excluded);
      if (isCurrent()) publish({ ...stateRef.current, writeError: '' });
    } catch {
      if (isCurrent()) publish({ ...stateRef.current,
        writeError: 'Photo choices work for this session but could not be saved for the next app launch.' });
    }
  }, [installationId]);

  const scoped = state.installationId === installationId ? state : emptySelection(installationId);
  return { ...scoped, error: scoped.readError || scoped.writeError, refresh, toggle };
}
