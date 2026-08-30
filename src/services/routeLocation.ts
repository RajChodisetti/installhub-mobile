import * as Location from 'expo-location';

export type CapturedRouteLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt: string;
};

export class RouteLocationError extends Error {
  constructor(
    message: string,
    readonly code: 'permission-denied' | 'unavailable',
  ) {
    super(message);
  }
}

/** Captures one foreground position. It does not subscribe, persist, or run in the background. */
export async function captureCurrentRouteLocation(): Promise<CapturedRouteLocation> {
  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    throw new RouteLocationError(
      'Location permission could not be checked. Choose an Australian starting address instead.',
      'unavailable',
    );
  }
  if (!permission.granted) {
    throw new RouteLocationError(
      'Location permission was denied. Choose an Australian starting address instead.',
      'permission-denied',
    );
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const capturedAt = new Date(position.timestamp);
    if (!Number.isFinite(position.timestamp) || Number.isNaN(capturedAt.getTime())) {
      throw new RouteLocationError(
        'Your current location did not include a valid capture time. Try again or choose an Australian starting address.',
        'unavailable',
      );
    }
    const accuracyMeters = position.coords.accuracy;
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      ...(typeof accuracyMeters === 'number'
        && Number.isFinite(accuracyMeters)
        && accuracyMeters <= 100_000
        ? { accuracyMeters: Math.max(0, accuracyMeters) }
        : {}),
      capturedAt: capturedAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof RouteLocationError) throw error;
    throw new RouteLocationError(
      'Your current location could not be read. Check Location Services or choose an Australian starting address.',
      'unavailable',
    );
  }
}
