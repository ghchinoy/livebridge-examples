// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  LiveSession,
  type LiveSessionInit,
  type TranscriptItem,
} from '@ghchinoy/livebridge';
import { useEffect, useRef, useState } from 'react';

export interface LiveSessionSnapshot {
  status: string;
  isConnected: boolean;
  isTerminating: boolean;
  isRecording: boolean;
  isMuted: boolean;
  micRms: number;
  lastWarning: string;
  transcript: TranscriptItem[];
  sessionModel: string;
}

/**
 * Idiomatic React 19 hook binding a headless `@ghchinoy/livebridge` `LiveSession`
 * instance to component state and cleaning up automatically on unmount.
 */
export function useLiveSession(init?: LiveSessionInit) {
  const sessionRef = useRef<LiveSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new LiveSession(init);
  }
  const session = sessionRef.current;

  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(() =>
    readSnapshot(session),
  );

  useEffect(() => {
    const sync = () => setSnapshot(readSnapshot(session));
    session.addEventListener('change', sync);
    session.addEventListener('rms', sync);
    return () => {
      session.removeEventListener('change', sync);
      session.removeEventListener('rms', sync);
      session.disconnect();
    };
  }, [session]);

  return { session, ...snapshot };
}

function readSnapshot(s: LiveSession): LiveSessionSnapshot {
  return {
    status: s.status,
    isConnected: s.isConnected,
    isTerminating: s.isTerminating,
    isRecording: s.isRecording,
    isMuted: s.isMuted,
    micRms: s.micRms,
    lastWarning: s.lastWarning,
    transcript: s.transcript,
    sessionModel: s.sessionModel,
  };
}
