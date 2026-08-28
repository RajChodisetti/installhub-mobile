import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ClientAddressSuggestion } from '../api/apiClient';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  manualAustralianAddressEdit,
  normalizeAustralianAddress,
  normalizeClientNameKey,
} from '../domain/australianAddress';
import {
  loadAddressSuggestions,
  loadClientSuggestions,
  savedAddressSuggestions,
  type ClientSuggestionOption,
} from '../services/clientAddressSuggestions';
import { radii, spacing } from '../theme';
import type { AustralianAddress } from '../types';
import { TextArea, TextField } from './ui';

type Props = {
  children?: React.ReactNode;
  clientName: string;
  clientId: string | null;
  clientError?: string;
  siteName: string;
  address: AustralianAddress;
  addressError?: string;
  onClientChange: (name: string, clientId: string | null) => void;
  onAddressChange: (
    address: AustralianAddress,
    clientSiteId: string | null,
    suggestedSiteName?: string | null,
  ) => void;
};

function addressFromSuggestion(suggestion: ClientAddressSuggestion): AustralianAddress {
  return normalizeAustralianAddress({
    display_address: suggestion.address.displayAddress,
    locality: suggestion.address.locality,
    state: suggestion.address.state,
    postcode: suggestion.address.postcode,
    country_code: 'AU',
    latitude: suggestion.address.latitude,
    longitude: suggestion.address.longitude,
    provider: suggestion.address.provider,
    place_id: suggestion.address.placeId,
    source: suggestion.kind === 'client_saved'
      ? 'client_saved'
      : suggestion.address.source,
    geocoding_status: suggestion.address.geocodingStatus,
    fingerprint: suggestion.address.fingerprint,
  });
}

export function ClientAddressPicker({
  children,
  clientName,
  clientId,
  clientError,
  siteName,
  address,
  addressError,
  onClientChange,
  onAddressChange,
}: Props) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [clientOpen, setClientOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [clientBusy, setClientBusy] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [remoteClientsAvailable, setRemoteClientsAvailable] = useState(true);
  const [providerAvailable, setProviderAvailable] = useState(true);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientSuggestionOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientSuggestionOption | null>(null);
  const [storedSuggestions, setStoredSuggestions] = useState<ClientAddressSuggestion[]>([]);
  const [providerSuggestions, setProviderSuggestions] = useState<ClientAddressSuggestion[]>([]);
  const clientRequest = useRef(0);
  const addressRequest = useRef(0);

  useEffect(() => {
    if (!clientId) {
      if (
        selectedClient
        && normalizeClientNameKey(selectedClient.name) !== normalizeClientNameKey(clientName)
      ) setSelectedClient(null);
      return;
    }
    const current = clients.find((client) => client.canonicalId === clientId);
    if (current) setSelectedClient(current);
  }, [clientId, clientName, clients, selectedClient]);

  useEffect(() => {
    const actorUserId = user?.id;
    if (!actorUserId || (!clientOpen && !(clientId && !selectedClient))) return undefined;
    const requestId = ++clientRequest.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setClientBusy(true);
      void loadClientSuggestions({
        actorUserId,
        query: clientName,
        signal: controller.signal,
      }).then((result) => {
        if (requestId !== clientRequest.current) return;
        setClients(result.clients);
        setRemoteClientsAvailable(result.remoteAvailable);
        if (clientId) {
          setSelectedClient(
            result.clients.find((client) => client.canonicalId === clientId) ?? null,
          );
        }
      }).finally(() => {
        if (requestId === clientRequest.current) setClientBusy(false);
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [clientId, clientName, clientOpen, selectedClient, user?.id]);

  useEffect(() => {
    const actorUserId = user?.id;
    if (!actorUserId || !addressOpen) return undefined;
    const requestId = ++addressRequest.current;
    const controller = new AbortController();
    setStoredSuggestions(savedAddressSuggestions(selectedClient, address.display_address));
    if (address.display_address.trim().length < 2) {
      setProviderSuggestions([]);
      setAttribution(null);
      return () => controller.abort();
    }
    const timer = setTimeout(() => {
      setAddressBusy(true);
      void loadAddressSuggestions({
        actorUserId,
        client: selectedClient,
        query: address.display_address,
        postcode: address.postcode ?? undefined,
        signal: controller.signal,
      }).then((result) => {
        if (requestId !== addressRequest.current) return;
        setStoredSuggestions(result.storedSuggestions);
        setProviderSuggestions(result.providerSuggestions);
        setProviderAvailable(result.providerAvailable);
        setAttribution(result.attribution);
      }).finally(() => {
        if (requestId === addressRequest.current) setAddressBusy(false);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address.display_address, address.postcode, addressOpen, selectedClient, user?.id]);

  const applySuggestion = (suggestion: ClientAddressSuggestion) => {
    const next = addressFromSuggestion(suggestion);
    if (suggestion.clientId && suggestion.clientId !== clientId) {
      const matchingClient = clients.find((client) => client.canonicalId === suggestion.clientId);
      if (matchingClient) {
        setSelectedClient(matchingClient);
        onClientChange(matchingClient.name, matchingClient.canonicalId);
      }
    }
    onAddressChange(next, suggestion.clientSiteId, suggestion.siteName);
    setAddressOpen(false);
  };

  const suggestionRow = (suggestion: ClientAddressSuggestion) => (
    <Pressable
      key={suggestion.id}
      accessibilityRole="button"
      accessibilityLabel={`${suggestion.kind === 'client_saved' ? 'Saved address' : 'Suggested address'}: ${suggestion.label}`}
      onPress={() => applySuggestion(suggestion)}
      style={({ pressed }) => [
        styles.suggestion,
        { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={{ color: colors.foreground, fontWeight: '600' }}>{suggestion.label}</Text>
      {suggestion.siteName ? (
        <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>{suggestion.siteName}</Text>
      ) : null}
    </Pressable>
  );

  return (
    <View>
      <TextField
        label="Client name"
        value={clientName}
        error={clientError}
        autoCorrect={false}
        onFocus={() => setClientOpen(true)}
        onBlur={() => setTimeout(() => setClientOpen(false), 180)}
        onChangeText={(value) => {
          setSelectedClient(null);
          onClientChange(value, null);
          setClientOpen(true);
        }}
      />
      {clientOpen ? (
        <View
          accessibilityLabel="Known client suggestions"
          style={[styles.dropdown, { borderColor: colors.border, backgroundColor: colors.background }]}
        >
          <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Known clients</Text>
          {clientBusy ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
          {clients.map((client) => (
            <Pressable
              key={`${client.canonicalId ?? 'local'}:${client.normalizedKey}`}
              accessibilityRole="button"
              accessibilityLabel={`Select client ${client.name}`}
              onPress={() => {
                setSelectedClient(client);
                onClientChange(client.name, client.canonicalId);
                setClientOpen(false);
                setAddressOpen(true);
              }}
              style={({ pressed }) => [
                styles.suggestion,
                { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>{client.name}</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                {client.sites.length} saved address{client.sites.length === 1 ? '' : 'es'}
              </Text>
            </Pressable>
          ))}
          {!clientBusy && !clients.length ? (
            <Text style={{ color: colors.mutedForeground, padding: spacing.sm }}>
              No matching known client. The entered name can still be saved.
            </Text>
          ) : null}
          {!remoteClientsAvailable ? (
            <Text style={{ color: colors.mutedForeground, padding: spacing.sm, fontSize: 12 }}>
              Offline or directory unavailable — showing saved on-device clients.
            </Text>
          ) : null}
        </View>
      ) : null}

      {children}

      <TextArea
        label="Site address"
        value={address.display_address}
        error={addressError}
        autoCorrect={false}
        onFocus={() => setAddressOpen(true)}
        onBlur={() => setTimeout(() => setAddressOpen(false), 180)}
        onChangeText={(value) => {
          onAddressChange(
            manualAustralianAddressEdit(address, { display_address: value }),
            null,
          );
          setAddressOpen(true);
        }}
      />
      {addressOpen ? (
        <View
          accessibilityLabel="Saved and suggested Australian addresses"
          style={[styles.dropdown, { borderColor: colors.border, backgroundColor: colors.background }]}
        >
          {selectedClient ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add a new address for ${selectedClient.name}`}
              onPress={() => {
                onAddressChange(manualAustralianAddressEdit(address, {
                  display_address: '', locality: null, state: null, postcode: null,
                }), null);
                setStoredSuggestions([]);
                setProviderSuggestions([]);
              }}
              style={({ pressed }) => [
                styles.newAddress,
                { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={{ color: colors.primary, fontWeight: '700' }}>+ Add a new address</Text>
            </Pressable>
          ) : null}
          {storedSuggestions.length ? (
            <>
              <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Saved for this client</Text>
              {storedSuggestions.map(suggestionRow)}
            </>
          ) : null}
          {providerSuggestions.length ? (
            <>
              <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Suggested Australian addresses</Text>
              {providerSuggestions.map(suggestionRow)}
            </>
          ) : null}
          {addressBusy ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
          {address.display_address.trim() ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use address as entered: ${address.display_address.trim()}`}
              onPress={() => setAddressOpen(false)}
              style={({ pressed }) => [
                styles.manual,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={{ color: colors.foreground, fontWeight: '600' }}>Use address as entered</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 3, fontSize: 12 }}>
                It will be saved and marked for later geocoding.
              </Text>
            </Pressable>
          ) : null}
          {!providerAvailable && address.display_address.trim().length >= 2 ? (
            <Text style={{ color: colors.mutedForeground, padding: spacing.sm, fontSize: 12 }}>
              Address provider unavailable — manual entry remains available.
            </Text>
          ) : null}
          {attribution ? (
            <Text style={{ color: colors.mutedForeground, padding: spacing.sm, fontSize: 11 }}>
              {attribution}
            </Text>
          ) : null}
        </View>
      ) : null}
      {clientId ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: -spacing.xs, marginBottom: spacing.sm }}>
          Using saved client {siteName ? `for ${siteName}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.xs,
    gap: spacing.xs,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    textTransform: 'uppercase',
  },
  suggestion: {
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  newAddress: {
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  manual: {
    borderTopWidth: 1,
    padding: spacing.sm,
    minHeight: 48,
  },
  loader: { padding: spacing.sm },
});
