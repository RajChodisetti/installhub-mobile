import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ApiError,
  AuthError,
  NetworkError,
  apiClient,
  type ClientAddressSuggestion,
  type SchedulerRouteCurrentLocation,
  type SchedulerRouteJob,
  type SchedulerRouteSuggestion,
  type SchedulerRouteSuggestionInput,
} from '../api/apiClient';
import { Badge, Button, Card, TextField } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  schedulerRouteAddCalendarDays,
  schedulerRouteCalendarDateIsValid,
  schedulerRouteCoordinatesFromAddress,
  schedulerRouteDistance,
  schedulerRouteDuration,
  schedulerRouteJobCanOpenInFieldApp,
  schedulerRouteJobTypeLabel,
  schedulerRouteLocalCalendarDate,
  schedulerRouteLocationIsAustralian,
  schedulerRouteScheduledTimeLabel,
  schedulerRouteStartingAddress,
  SCHEDULER_ROUTE_STARTING_ADDRESS_MAX_LENGTH,
  SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH,
} from '../domain/schedulerRoute';
import type { RootStackParamList } from '../navigation/types';
import { installationsRepo } from '../repositories';
import { loadAddressSuggestions } from '../services/clientAddressSuggestions';
import {
  captureCurrentRouteLocation,
  RouteLocationError,
} from '../services/routeLocation';
import {
  captureAuthenticatedCloudActionLease,
  type AuthenticatedCloudActionLease,
} from '../services/authenticatedCloudAction';
import {
  applyLeasedCloudActionState,
  runLeasedCloudActionStep,
} from '../services/cloudActionLease';
import { useSyncStatus } from '../services/SyncStatusContext';
import { radii, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DailyRoute'>;
type OriginMode = 'current' | 'address';

function routeErrorMessage(error: unknown): string {
  if (error instanceof RouteLocationError) return error.message;
  if (error instanceof AuthError) {
    return 'Your Field App session is unavailable. Sign in again before planning a route.';
  }
  if (error instanceof NetworkError) {
    return 'Route planning requires an internet connection. Check your connection and try again.';
  }
  if (error instanceof ApiError) {
    if (/^Scheduler user not found$/i.test(error.message)) {
      return 'This account is not linked to an active Field user. Ask an administrator to review your Scheduler user record.';
    }
    if (/^Assignee not found$/i.test(error.message)) {
      return 'Your Field user is no longer active. Ask an administrator to review your Scheduler user record.';
    }
    return error.message || `The route service returned error ${error.status}.`;
  }
  return error instanceof Error ? error.message : 'The route could not be planned.';
}

export function DailyRouteScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { triggerSync } = useSyncStatus();
  const [date, setDate] = useState(() => schedulerRouteLocalCalendarDate());
  const [originMode, setOriginMode] = useState<OriginMode>('current');
  const [originQuery, setOriginQuery] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState<ClientAddressSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<ClientAddressSuggestion[]>([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [result, setResult] = useState<SchedulerRouteSuggestion | null>(null);
  const [submittedOriginLabel, setSubmittedOriginLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const routeRequestId = useRef(0);
  const routeAbort = useRef<AbortController | null>(null);
  const openingAttempt = useRef<object | null>(null);

  useEffect(() => {
    const actorUserId = user?.id;
    const query = originQuery.trim();
    if (selectedOrigin && query === selectedOrigin.label.trim()) {
      setSuggestions([]);
      setSuggestionsBusy(false);
      return undefined;
    }
    if (originMode !== 'address' || !actorUserId || query.length < 2) {
      setSuggestions([]);
      setSuggestionsBusy(false);
      setProviderAvailable(null);
      setAttribution(null);
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSuggestionsBusy(true);
      void loadAddressSuggestions({
        actorUserId,
        client: null,
        query,
        signal: controller.signal,
      }).then((response) => {
        if (!active) return;
        setSuggestions(response.suggestions);
        setProviderAvailable(response.providerAvailable);
        setAttribution(response.attribution);
      }).finally(() => {
        if (active) setSuggestionsBusy(false);
      });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [originMode, originQuery, selectedOrigin, user?.id]);

  useEffect(() => () => {
    routeRequestId.current += 1;
    routeAbort.current?.abort();
  }, []);

  function resetResult() {
    setResult(null);
    setSubmittedOriginLabel('');
    setError(null);
  }

  function changeDate(nextDate: string) {
    setDate(nextDate);
    resetResult();
  }

  async function planRoute() {
    if (!schedulerRouteCalendarDateIsValid(date)) {
      setError('Enter a real work date in YYYY-MM-DD format.');
      return;
    }
    const requestId = ++routeRequestId.current;
    routeAbort.current?.abort();
    const controller = new AbortController();
    routeAbort.current = controller;
    setRouteBusy(true);
    setError(null);
    setResult(null);
    setSubmittedOriginLabel('');

    try {
      let routeInput: SchedulerRouteSuggestionInput;
      let originLabel: string;
      if (originMode === 'address') {
        const origin = selectedOrigin;
        const selectedCoordinates = origin
          ? schedulerRouteCoordinatesFromAddress(origin.address)
          : null;
        const startingAddress = schedulerRouteStartingAddress(originQuery);
        if (!startingAddress) {
          throw new Error('Enter an Australian starting address before planning the route.');
        }
        if (origin && selectedCoordinates && origin.label.trim() === startingAddress) {
          routeInput = { date, currentLocation: selectedCoordinates };
          originLabel = origin.label;
        } else {
          routeInput = { date, startingAddress };
          originLabel = startingAddress;
        }
      } else {
        const currentLocation: SchedulerRouteCurrentLocation = await captureCurrentRouteLocation();
        if (!schedulerRouteLocationIsAustralian(currentLocation)) {
          if (requestId === routeRequestId.current) setOriginMode('address');
          throw new Error(
            'Your current location is outside Australia. Choose an Australian starting address to preview the route.',
          );
        }
        routeInput = { date, currentLocation };
        originLabel = 'Current device location';
      }

      const nextResult = await apiClient.getMyRouteSuggestion(routeInput, controller.signal);
      if (requestId !== routeRequestId.current || controller.signal.aborted) return;
      setResult(nextResult);
      setSubmittedOriginLabel(originLabel);
    } catch (caught) {
      if (requestId !== routeRequestId.current || controller.signal.aborted) return;
      if (caught instanceof RouteLocationError) setOriginMode('address');
      setError(routeErrorMessage(caught));
    } finally {
      if (requestId === routeRequestId.current) {
        setRouteBusy(false);
        if (routeAbort.current === controller) routeAbort.current = null;
      }
    }
  }

  async function openFieldJob(job: SchedulerRouteJob) {
    if (
      !schedulerRouteJobCanOpenInFieldApp(job)
      || openingEventId
      || openingAttempt.current
    ) return;
    const attempt = {};
    openingAttempt.current = attempt;
    const actionLeasePromise = captureAuthenticatedCloudActionLease();
    let actionLease: AuthenticatedCloudActionLease | null = null;
    try {
      actionLease = await actionLeasePromise;
      applyLeasedCloudActionState(actionLease, () => setOpeningEventId(job.eventId));
      let installation = await runLeasedCloudActionStep(
        actionLease,
        () => installationsRepo.getById(job.sourceId),
      );
      if (!installation) {
        await runLeasedCloudActionStep(actionLease, triggerSync);
        installation = await runLeasedCloudActionStep(
          actionLease,
          () => installationsRepo.getById(job.sourceId),
        );
      }
      if (!installation) {
        applyLeasedCloudActionState(actionLease, () => {
          Alert.alert(
            'Field job unavailable on this device',
            'Refresh assigned work while online. The job may no longer be assigned to this account.',
          );
        });
        return;
      }
      applyLeasedCloudActionState(actionLease, () => {
        navigation.navigate('InstallationDetail', { installationId: installation.id });
      });
    } catch (caught) {
      let canReport = actionLease !== null;
      if (actionLease) {
        try {
          actionLease.assertCurrent();
        } catch {
          canReport = false;
        }
      }
      if (canReport) {
        Alert.alert(
          'Could not open Field job',
          caught instanceof Error ? caught.message : 'Refresh assigned work and try again.',
        );
      }
    } finally {
      if (actionLease) {
        try {
          applyLeasedCloudActionState(actionLease, () => setOpeningEventId(null));
        } catch {
          // A replacement session owns subsequent screen state.
        }
      }
      if (openingAttempt.current === attempt) openingAttempt.current = null;
    }
  }

  const busy = routeBusy;
  const dateIsValid = schedulerRouteCalendarDateIsValid(date);
  const startingAddress = schedulerRouteStartingAddress(originQuery);
  const addressOriginReady = originMode === 'current'
    || startingAddress !== null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={[typography.title, { color: colors.foreground }]}>Plan my route</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Order the signed-in technician’s scheduled jobs for one work day. This planner shows
          stop order and travel estimates only—no maps or navigation.
        </Text>
      </View>

      <Card style={styles.card}>
        <Text style={[typography.subheading, { color: colors.foreground }]}>Work date</Text>
        <TextField
          accessibilityLabel="Work date in year month day format"
          value={date}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          placeholder="YYYY-MM-DD"
          error={date && !dateIsValid ? 'Use a real date in YYYY-MM-DD format.' : undefined}
          onChangeText={changeDate}
        />
        <View style={styles.threeButtonRow}>
          <Button
            title="Previous"
            variant="secondary"
            disabled={busy || !dateIsValid}
            style={styles.flexButton}
            onPress={() => changeDate(schedulerRouteAddCalendarDays(date, -1))}
          />
          <Button
            title="Today"
            variant="secondary"
            disabled={busy}
            style={styles.flexButton}
            onPress={() => changeDate(schedulerRouteLocalCalendarDate())}
          />
          <Button
            title="Next"
            variant="secondary"
            disabled={busy || !dateIsValid}
            style={styles.flexButton}
            onPress={() => changeDate(schedulerRouteAddCalendarDays(date, 1))}
          />
        </View>

        <Text style={[typography.subheading, styles.sectionTitle, { color: colors.foreground }]}>Starting point</Text>
        <View style={styles.twoButtonRow}>
          <Button
            title="Current location"
            variant={originMode === 'current' ? 'primary' : 'secondary'}
            disabled={busy}
            accessibilityRole="radio"
            accessibilityHint="Uses one foreground location reading for this route only."
            accessibilityState={{ selected: originMode === 'current' }}
            style={styles.flexButton}
            onPress={() => {
              setOriginMode('current');
              resetResult();
            }}
          />
          <Button
            title="Australian address"
            variant={originMode === 'address' ? 'primary' : 'secondary'}
            disabled={busy}
            accessibilityRole="radio"
            accessibilityHint="Enter an Australian starting address below. Selecting a suggestion is optional."
            accessibilityState={{ selected: originMode === 'address' }}
            style={styles.flexButton}
            onPress={() => {
              setOriginMode('address');
              resetResult();
            }}
          />
        </View>

        {originMode === 'address' ? (
          <View style={styles.addressSection}>
            <TextField
              label="Australian starting address"
              accessibilityHint="Enter an Australian starting address. Selecting a suggestion is optional."
              value={originQuery}
              editable={!busy}
              autoCorrect={false}
              maxLength={SCHEDULER_ROUTE_STARTING_ADDRESS_MAX_LENGTH}
              placeholder="Start typing an Australian address"
              error={originQuery.length > 0 && !startingAddress
                ? `Enter at least ${SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH} visible characters.`
                : undefined}
              onChangeText={(value) => {
                setOriginQuery(value);
                setSelectedOrigin(null);
                resetResult();
              }}
            />
            {suggestionsBusy ? (
              <Text style={{ color: colors.mutedForeground }}>Searching Australian addresses…</Text>
            ) : null}
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion.id}
                accessibilityRole="button"
                accessibilityLabel={`Use starting address ${suggestion.label}`}
                accessibilityState={{ selected: selectedOrigin?.id === suggestion.id }}
                onPress={() => {
                  setSelectedOrigin(suggestion);
                  setOriginQuery(suggestion.label);
                  setSuggestions([]);
                  resetResult();
                }}
                style={({ pressed }) => [
                  styles.suggestion,
                  {
                    borderColor: selectedOrigin?.id === suggestion.id
                      ? colors.primary
                      : colors.border,
                    backgroundColor: colors.card,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                  {suggestion.label}
                </Text>
              </Pressable>
            ))}
            {providerAvailable === false && originQuery.trim().length >= 2 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Address suggestions are unavailable, but you can still submit the typed address
                for Australian geocoding.
              </Text>
            ) : null}
            {selectedOrigin ? (
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="summary"
                style={[styles.hint, { color: colors.primary }]}
              >
                Starting from {selectedOrigin.label}
              </Text>
            ) : (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                Enter an Australian address. You can choose a suggestion for its exact coordinates
                or submit the typed address for Australian geocoding.
              </Text>
            )}
            {attribution ? (
              <Text style={[styles.attribution, { color: colors.mutedForeground }]}>
                {attribution}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Button
          title={busy ? 'Planning route…' : 'Plan route'}
          disabled={busy || !dateIsValid || !addressOriginReady}
          style={{ marginTop: spacing.lg }}
          onPress={() => { void planRoute(); }}
        />
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          The saved technician timezone defines the work date. The entered starting address or
          one-time starting coordinates are sent to the API for this calculation only. They are
          not saved as attendance, location history or route history. The suggested order does
          not change the schedule.
        </Text>
      </Card>

      {error ? (
        <Card accessibilityRole="alert" style={[styles.card, { borderColor: colors.destructive }]}>
          <Text style={{ color: colors.destructive, fontWeight: '800' }}>Route not available</Text>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>{error}</Text>
        </Card>
      ) : null}

      {!result && !error ? (
        <Card style={styles.card}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>Ready to plan the day</Text>
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
            Choose the work date and where the technician will start.
          </Text>
        </Card>
      ) : null}

      {result ? (
        <>
          <Card style={styles.card}>
            <Text style={[styles.overline, { color: colors.mutedForeground }]}>Suggested route · {result.date}</Text>
            <Text style={[typography.subheading, styles.summaryTitle, { color: colors.foreground }]}>
              {result.jobs.length} routable job{result.jobs.length === 1 ? '' : 's'}
            </Text>
            <Text style={[styles.summaryMetric, { color: colors.foreground }]}>
              {schedulerRouteDistance(result.totalDistanceMeters)} · approximately{' '}
              {schedulerRouteDuration(result.totalDurationSeconds)} driving
            </Text>
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
              Starting from {submittedOriginLabel || 'the selected point'}. Times use {result.timezone}.
            </Text>
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
              {result.optimization === 'road_duration'
                ? 'Ordered using road travel-time estimates.'
                : 'Road routing is unavailable, so this order uses straight-line estimates.'}
            </Text>
            {result.optimization === 'road_duration' ? (
              <Text style={[styles.attribution, { color: colors.mutedForeground }]}>
                Routing data © OpenStreetMap contributors
              </Text>
            ) : null}
          </Card>

          {result.warnings.length ? (
            <Card accessibilityRole="summary" style={styles.card}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>Route checks</Text>
              {result.warnings.map((warning) => (
                <Text key={warning} style={[styles.warning, { color: colors.foreground }]}>
                  • {warning}
                </Text>
              ))}
            </Card>
          ) : null}

          {result.jobs.length ? (
            <View accessibilityLabel="Suggested job order">
              {result.jobs.map((job) => (
                <Card key={job.eventId} style={styles.card}>
                  <View style={styles.stopHeader}>
                    <View style={[styles.sequence, { backgroundColor: colors.primary }]}>
                      <Text style={{ color: colors.primaryForeground, fontWeight: '800' }}>
                        {job.sequence}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.stopTitleRow}>
                        <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>
                          {job.title}
                        </Text>
                        <Badge label={schedulerRouteJobTypeLabel(job.sourceApp)} />
                      </View>
                      <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                        {job.address}
                      </Text>
                      <Text style={[styles.jobMeta, { color: colors.foreground }]}>
                        Scheduled {schedulerRouteScheduledTimeLabel(job, result.timezone)}
                      </Text>
                      <Text style={[styles.jobMeta, { color: colors.mutedForeground }]}>
                        From previous stop: {schedulerRouteDistance(job.travelDistanceMeters)} ·{' '}
                        {schedulerRouteDuration(job.travelDurationSeconds)}
                      </Text>
                    </View>
                  </View>
                  {schedulerRouteJobCanOpenInFieldApp(job) ? (
                    <Button
                      title={openingEventId === job.eventId ? 'Refreshing Field job…' : 'Open Field job'}
                      variant="secondary"
                      disabled={Boolean(openingEventId)}
                      style={{ marginTop: spacing.md }}
                      onPress={() => { void openFieldJob(job); }}
                    />
                  ) : null}
                </Card>
              ))}
            </View>
          ) : (
            <Card style={styles.card}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>No routable jobs</Text>
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                Only active assigned jobs with an Australian destination can be included.
              </Text>
            </Card>
          )}

          {result.unroutableJobs.length ? (
            <Card style={styles.card}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>Jobs needing an address check</Text>
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                These scheduled jobs are not silently omitted.
              </Text>
              {result.unroutableJobs.map((job) => (
                <View key={job.eventId} style={[styles.unroutable, { borderTopColor: colors.border }]}>
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>{job.title}</Text>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    {job.address || 'No destination saved'} · {job.reason}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  intro: {
    marginTop: spacing.xs,
    lineHeight: 21,
  },
  card: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  twoButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  threeButtonRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  flexButton: {
    flex: 1,
  },
  addressSection: {
    marginTop: spacing.md,
  },
  suggestion: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
  },
  attribution: {
    marginTop: spacing.xs,
    fontSize: 11,
  },
  bodyText: {
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  overline: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  summaryTitle: {
    marginTop: spacing.xs,
  },
  summaryMetric: {
    marginTop: spacing.xs,
    fontWeight: '700',
  },
  warning: {
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  stopHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  sequence: {
    width: 38,
    height: 38,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopTitleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  jobMeta: {
    marginTop: spacing.xs,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  unroutable: {
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
});
