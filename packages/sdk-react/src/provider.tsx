import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DoomwatchBrowserSdk, DoomwatchBrowserConfig } from './sdk.js';

export interface DoomwatchContextValue {
  sdk: DoomwatchBrowserSdk | null;
  startInteraction: (actionName: string) => { traceId: string; end: (error?: Error) => void };
  activeTraceId: string | null;
  flush: () => Promise<void>;
}

const DoomwatchContext = createContext<DoomwatchContextValue>({
  sdk: null,
  startInteraction: () => ({ traceId: '', end: () => {} }),
  activeTraceId: null,
  flush: async () => {}
});

export interface DoomwatchProviderProps extends DoomwatchBrowserConfig {
  children?: React.ReactNode;
}

/**
 * React Context Provider that initializes Doomwatch browser telemetry and
 * automatically injects W3C headers on all outgoing fetch and XHR requests.
 */
export function DoomwatchProvider({
  serviceName,
  collectorUrl,
  propagateToUrls,
  batchIntervalMs,
  batchSize,
  debug,
  children
}: DoomwatchProviderProps) {
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  const sdk = useMemo(() => {
    return DoomwatchBrowserSdk.init({
      serviceName,
      collectorUrl,
      propagateToUrls,
      batchIntervalMs,
      batchSize,
      debug
    });
  }, [serviceName, collectorUrl]);

  const value: DoomwatchContextValue = useMemo(() => {
    return {
      sdk,
      startInteraction: (actionName: string) => {
        const interaction = sdk.startUserInteraction(actionName);
        setActiveTraceId(interaction.traceId);
        return {
          traceId: interaction.traceId,
          end: (err?: Error) => {
            interaction.end(err);
            setActiveTraceId(null);
          }
        };
      },
      activeTraceId,
      flush: () => sdk.flush()
    };
  }, [sdk, activeTraceId]);

  return (
    <DoomwatchContext.Provider value={value}>
      {children}
    </DoomwatchContext.Provider>
  );
}

/**
 * Hook to access the active Doomwatch browser SDK and start user interaction traces.
 */
export function useDoomwatch(): DoomwatchContextValue {
  const ctx = useContext(DoomwatchContext);
  if (!ctx) {
    throw new Error('useDoomwatch must be used within a DoomwatchProvider');
  }
  return ctx;
}
