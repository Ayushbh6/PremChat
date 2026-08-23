"use client";

import {
  SOCRATES_SCHEMA_VERSION,
  socratesClientCommandSchema,
  socratesServerEventSchema,
  type SocratesClientCommand,
  type SocratesServerEvent,
} from "@socrates/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { socratesApiBaseUrl } from "@/lib/api";

export type SocratesSocketStatus = "connecting" | "subscribing" | "connected" | "reconnecting" | "disconnected";

type CommandScope = Readonly<{ goalId?: string; turnId?: string }>;

export const createSocratesClientId = (prefix: string): string => {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${suffix}`;
};

export const makeSocratesCommand = (
  type: SocratesClientCommand["type"],
  payload: unknown,
  scope: CommandScope = {},
): SocratesClientCommand => socratesClientCommandSchema.parse({
  id: createSocratesClientId("socrates_command"),
  schemaVersion: SOCRATES_SCHEMA_VERSION,
  timestamp: new Date().toISOString(),
  ...(scope.goalId ? { goalId: scope.goalId } : {}),
  ...(scope.turnId ? { turnId: scope.turnId } : {}),
  actor: { type: "user" },
  type,
  payload,
});

const socketUrl = (): string => {
  const url = new URL(socratesApiBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/socrates/ws";
  url.search = "";
  return url.toString();
};

type UseSocratesSocketInput = Readonly<{
  enabled: boolean;
  afterSequence: number;
  onEvent: (event: SocratesServerEvent) => void;
  onError: (message: string | null) => void;
}>;

export function useSocratesSocket({ enabled, afterSequence, onEvent, onError }: UseSocratesSocketInput) {
  const socketRef = useRef<WebSocket | null>(null);
  const eventHandlerRef = useRef(onEvent);
  const errorHandlerRef = useRef(onError);
  const sequenceRef = useRef(afterSequence);
  const [status, setStatus] = useState<SocratesSocketStatus>("disconnected");

  useEffect(() => {
    eventHandlerRef.current = onEvent;
    errorHandlerRef.current = onError;
    sequenceRef.current = afterSequence;
  }, [afterSequence, onError, onEvent]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");
      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl());
      } catch (reason) {
        setStatus("disconnected");
        errorHandlerRef.current(reason instanceof Error ? reason.message : "Could not connect to Socrates.");
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attempts = 0;
        setStatus("subscribing");
        errorHandlerRef.current(null);
        socket.send(JSON.stringify(makeSocratesCommand("socrates.subscribe", {
          afterSequence: sequenceRef.current,
          replayActiveTurn: true,
        })));
      };

      socket.onmessage = (message) => {
        if (disposed) return;
        let decoded: unknown;
        try {
          decoded = JSON.parse(String(message.data)) as unknown;
        } catch {
          errorHandlerRef.current("Socrates received a malformed live event.");
          return;
        }
        const parsed = socratesServerEventSchema.safeParse(decoded);
        if (!parsed.success) {
          errorHandlerRef.current("Socrates received an invalid live event.");
          return;
        }
        if (parsed.data.type === "socrates.connection.ready") setStatus("connected");
        if (parsed.data.type === "socrates.state.snapshot") {
          sequenceRef.current = Math.max(sequenceRef.current, parsed.data.payload.snapshot.lastEventSequence);
        }
        eventHandlerRef.current(parsed.data);
      };

      socket.onerror = () => {
        if (!disposed) errorHandlerRef.current("The live connection was interrupted. Reconnecting…");
      };

      socket.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        setStatus("reconnecting");
        const delay = Math.min(500 * 2 ** attempts, 8_000);
        attempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    queueMicrotask(connect);
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(makeSocratesCommand("socrates.unsubscribe", {})));
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [enabled]);

  const send = useCallback((command: SocratesClientCommand) => {
    const parsed = socratesClientCommandSchema.parse(command);
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || status !== "connected") {
      throw new Error("Socrates is reconnecting. Your draft is still here.");
    }
    socket.send(JSON.stringify(parsed));
  }, [status]);

  return { status, isConnected: status === "connected", send };
}
