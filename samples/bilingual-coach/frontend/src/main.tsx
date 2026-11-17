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

import { PRESET_AVATARS, type LiveSessionMode } from '@ghchinoy/livebridge';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLiveSession } from './useLiveSession';
import '@ghchinoy/lustrous-lit/fonts.css';
import '@ghchinoy/lustrous-lit/theme.css';
import '@ghchinoy/lustrous-lit/components/lustrous-badge';
import '@ghchinoy/lustrous-lit/components/lustrous-banner';
import '@ghchinoy/lustrous-lit/components/lustrous-box';
import '@ghchinoy/lustrous-lit/components/lustrous-button';
import '@ghchinoy/lustrous-lit/components/lustrous-flex';
import '@ghchinoy/lustrous-lit/components/lustrous-progress-bar';
import '@ghchinoy/lustrous-lit/components/lustrous-prose-text';
import '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import type { LustrousScrollableBox } from '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import type { LustrousSegmentOption } from '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import '@ghchinoy/lustrous-lit/components/lustrous-select';
import type { LustrousSelectOption } from '@ghchinoy/lustrous-lit/components/lustrous-select';
import '@ghchinoy/lustrous-lit/components/lustrous-text';
import '@ghchinoy/lustrous-lit/components/lustrous-text-input';
import type { LustrousTextInput } from '@ghchinoy/lustrous-lit/components/lustrous-text-input';
import '@ghchinoy/lustrous-lit/components/lustrous-togglable-button';
import {
  readLustrousThemePreference,
  setLustrousTheme,
  type LustrousThemePreference,
} from '@ghchinoy/lustrous-lit/theme';
import './styles.css';

// ── 1. Livebridge Session, Scenario & Rubric Wiring ─────────────────────────

interface Scenario {
  id: string;
  title: string;
  languageCode: string;
  voice: string;
  phrases: string[];
  welcome: string;
  instruction: string;
}

interface RubricEntry {
  fluency: number;
  clarity: number;
  betterPhrasing: string;
  vocabTip: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'es-hotel',
    title: 'Spanish · Boutique Hotel Check-In (es-US)',
    languageCode: 'es-US',
    voice: 'Aoede',
    phrases: ['habitación', 'equipaje', 'desayuno incluido', 'salida tardía'],
    welcome:
      '¡Buenas tardes! Bienvenido al Hotel Sol. ¿Tiene una reservación?',
    instruction:
      'Roleplay in Spanish as a friendly Madrid hotel receptionist. Keep turns to 1-2 sentences and call score_turn after each user reply with constructive Spanish phrasing tips.',
  },
  {
    id: 'ja-cafe',
    title: 'Japanese · Tokyo Espresso Bar (ja-JP)',
    languageCode: 'ja-JP',
    voice: 'Kore',
    phrases: ['ホットラテ', 'オーツミルク', '店内', '持ち帰り'],
    welcome: 'いらっしゃいませ！ご注文はお決まりですか？',
    instruction:
      'Roleplay in polite conversational Japanese as a Tokyo barista. Keep turns short and call score_turn after each user turn with natural Japanese phrasing tips.',
  },
  {
    id: 'en-sysdesign',
    title: 'English · Staff Systems Design Interview (en-US)',
    languageCode: 'en-US',
    voice: 'Charon',
    phrases: ['backpressure', 'idempotency', 'fan-out', 'quorum'],
    welcome:
      'Welcome! Today let us design a global real-time notification bus. Where would you start?',
    instruction:
      'Act as a supportive Staff Engineer interviewer probing trade-offs concisely. After every user answer, call score_turn evaluating clarity and suggesting sharper architectural phrasing.',
  },
];

// ── 2. Lustrous UI Presentation ─────────────────────────────────────────────

const THEME_STORAGE_KEY = 'livebridge.bilingual-coach.theme';

const SCENARIO_OPTIONS: readonly LustrousSelectOption[] = SCENARIOS.map(
  (s) => ({ value: s.id, label: s.title }),
);

const MODE_OPTIONS: readonly LustrousSelectOption[] = [
  { value: 'audio', label: 'Voice Only (24 kHz PCM)' },
  { value: 'avatar', label: 'Talking Avatar (fMP4)' },
];

const AVATAR_OPTIONS: readonly LustrousSelectOption[] = PRESET_AVATARS.map(
  (a) => ({ value: a, label: `Avatar: ${a}` }),
);

const THEME_OPTIONS: readonly LustrousSegmentOption[] = [
  { value: 'system', label: 'System', icon: 'modeAuto' },
  { value: 'light', label: 'Light', icon: 'lightMode' },
  { value: 'dark', label: 'Dark', icon: 'darkMode' },
];

function CoachApp() {
  const {
    session,
    status,
    isConnected,
    isTerminating,
    isRecording,
    micRms,
    lastWarning,
    transcript,
  } = useLiveSession({ mode: 'audio' });

  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [mode, setMode] = useState<LiveSessionMode>('audio');
  const [avatarPreset, setAvatarPreset] = useState('Kira');
  const [silenceMs, setSilenceMs] = useState(1100);
  const [prompt, setPrompt] = useState('');
  const [rubrics, setRubrics] = useState<RubricEntry[]>([]);
  const [themePref, setThemePref] = useState<LustrousThemePreference>(() =>
    readLustrousThemePreference(THEME_STORAGE_KEY, 'system'),
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transcriptBoxRef = useRef<LustrousScrollableBox | null>(null);

  useEffect(() => {
    setLustrousTheme(themePref, { storageKey: THEME_STORAGE_KEY });
  }, [themePref]);

  useEffect(() => {
    const scroller = transcriptBoxRef.current?.scrollElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [transcript]);

  const scenario =
    SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const active = isConnected && !isTerminating;
  const statusTone = active ? 'positive' : isTerminating ? 'warning' : 'default';

  const handleStart = async () => {
    session.lastWarning = '';
    setRubrics([]);
    await session.connect({
      mode,
      endpoint: '/ws',
      videoElement: mode === 'avatar' ? videoRef.current : null,
      initialPayload: {
        mode,
        avatarData: avatarPreset,
        voiceName: scenario.voice,
        languageCode: scenario.languageCode,
        welcomeMessage: scenario.welcome,
        systemInstruction: scenario.instruction,
        adaptationPhrases: scenario.phrases,
        silenceDurationMs: silenceMs,
      },
      onToolCall: (msg) => {
        if (msg.name === 'score_turn' && msg.result) {
          const r = msg.result as Record<string, unknown>;
          setRubrics((prev) => [
            {
              fluency: Number(r.fluency ?? 0),
              clarity: Number(r.clarity ?? 0),
              betterPhrasing: String(r.better_phrasing ?? ''),
              vocabTip: String(r.vocab_tip ?? ''),
            },
            ...prev,
          ]);
        }
      },
    });
  };

  const sendPrompt = () => {
    if (session.sendText(prompt)) setPrompt('');
  };

  return (
    <lustrous-flex
      direction="column"
      gap="l"
      padding="l"
      mobile-padding="m"
      max-width="1240"
      margin-inline="auto"
    >
      <lustrous-flex align="center" justify="space-between" gap="m" wrap="wrap">
        <lustrous-flex align="center" gap="s" wrap="wrap">
          <lustrous-text variant="headline-medium" heading="1">
            Bilingual &amp; Interview Coach
          </lustrous-text>
          <lustrous-badge tone="cobalt">React 19</lustrous-badge>
          <lustrous-badge tone={statusTone}>{status}</lustrous-badge>
        </lustrous-flex>

        <lustrous-segmented-control
          size="s"
          label="Color theme"
          value={themePref}
          options={THEME_OPTIONS}
          onlustrous-change={(e) =>
            setThemePref(
              (e.detail.value ?? 'system') as LustrousThemePreference,
            )
          }
        />
      </lustrous-flex>

      <div className="coach-grid">
        <lustrous-flex
          direction="column"
          gap="m"
          padding="l"
          background="surface-bright"
          border
          border-radius="xl"
          shadow="1"
        >
          <lustrous-flex wrap="wrap" gap="s">
            <lustrous-flex-item grow="1" min-width="240px">
              <lustrous-select
                label="Practice scenario"
                size="s"
                value={scenarioId}
                options={SCENARIO_OPTIONS}
                disabled={isConnected}
                onlustrous-change={(e) =>
                  setScenarioId(e.detail.value ?? SCENARIOS[0].id)
                }
              />
            </lustrous-flex-item>

            <lustrous-select
              label="Session mode"
              size="s"
              value={mode}
              options={MODE_OPTIONS}
              disabled={isConnected}
              onlustrous-change={(e) =>
                setMode((e.detail.value ?? 'audio') as LiveSessionMode)
              }
            />

            {mode === 'avatar' && (
              <lustrous-select
                label="Preset avatar"
                size="s"
                value={avatarPreset}
                options={AVATAR_OPTIONS}
                disabled={isConnected}
                onlustrous-change={(e) =>
                  setAvatarPreset(e.detail.value ?? 'Kira')
                }
              />
            )}
          </lustrous-flex>

          {lastWarning && (
            <lustrous-banner
              variant="warning"
              icon="warning"
              layout="row"
              description={lastWarning}
            />
          )}

          <lustrous-flex direction="column" gap="xs">
            <lustrous-flex align="center" justify="space-between" gap="s">
              <lustrous-text variant="body-small" muted>
                VAD Learner Pause Patience (<code>SilenceDurationMs</code>)
              </lustrous-text>
              <lustrous-badge tone="accent">{silenceMs} ms</lustrous-badge>
            </lustrous-flex>
            <input
              className="vad-slider"
              type="range"
              aria-label="VAD learner pause patience in milliseconds"
              min={400}
              max={1800}
              step={100}
              value={silenceMs}
              disabled={isConnected}
              onChange={(e) => setSilenceMs(Number(e.target.value))}
            />
          </lustrous-flex>

          <lustrous-flex wrap="wrap" gap="s" align="center">
            <lustrous-button
              variant="accent"
              size="s"
              icon="play"
              disabled={isConnected || isTerminating}
              onClick={() => void handleStart()}
            >
              Start Practice
            </lustrous-button>
            <lustrous-togglable-button
              size="s"
              icon={isRecording ? 'mic' : 'micOff'}
              selected={isRecording}
              disabled={!active}
              onlustrous-change={(e) => {
                e.preventDefault();
                void session.toggleMic();
              }}
            >
              {isRecording ? 'Mute Mic' : 'Unmute Mic'}
            </lustrous-togglable-button>
            <lustrous-button
              variant="outline"
              size="s"
              icon="stop"
              disabled={!active}
              onClick={() => session.terminate()}
            >
              End Session
            </lustrous-button>
            <lustrous-flex-item grow="1" min-width="120px">
              <lustrous-progress-bar
                value={Math.min(100, Math.round(micRms * 260))}
                tone="accent"
                label="Microphone input level"
                decorative
              />
            </lustrous-flex-item>
          </lustrous-flex>

          {mode === 'avatar' && (
            <lustrous-box
              width="220"
              data-theme="dark"
              background="surface-dim"
              border
              border-radius="l"
              overflow="hidden"
            >
              <video
                ref={videoRef}
                className="avatar-video"
                playsInline
                autoPlay
              />
            </lustrous-box>
          )}

          <lustrous-scrollable-box
            ref={transcriptBoxRef}
            className="transcript"
            scrim="both"
            label="Conversation transcript"
            background="surface-dim"
            border
            border-radius="l"
            padding="m"
            aria-live="polite"
          >
            <lustrous-flex direction="column" gap="s">
              {transcript.length === 0 ? (
                <lustrous-text variant="body-small" muted>
                  Click <strong>Start Practice</strong> to begin the{' '}
                  <code>{scenario.languageCode}</code> session.
                </lustrous-text>
              ) : (
                transcript.map((item, idx) => (
                  <lustrous-box
                    key={idx}
                    className={`turn ${item.type}`}
                    padding="s"
                    padding-inline="m"
                    border-radius="m"
                    background={
                      item.type === 'user'
                        ? 'primary-container'
                        : item.type === 'tool'
                          ? 'code'
                          : 'surface-container'
                    }
                    border={item.type === 'tool'}
                  >
                    <lustrous-prose-text
                      variant={item.type === 'tool' ? 'code' : 'body-medium'}
                      language={scenario.languageCode}
                    >
                      {item.text}
                    </lustrous-prose-text>
                  </lustrous-box>
                ))
              )}
            </lustrous-flex>
          </lustrous-scrollable-box>

          <lustrous-flex gap="s" align="center">
            <lustrous-flex-item grow="1" min-width="0">
              <lustrous-text-input
                size="s"
                aria-label="Reply in target language"
                value={prompt}
                placeholder="Or type a response in the target language..."
                disabled={!active}
                onInput={(e) =>
                  setPrompt((e.currentTarget as LustrousTextInput).value)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    sendPrompt();
                  }
                }}
              />
            </lustrous-flex-item>
            <lustrous-button
              size="s"
              icon="send"
              disabled={!active}
              onClick={sendPrompt}
            >
              Send
            </lustrous-button>
          </lustrous-flex>
        </lustrous-flex>

        <lustrous-flex
          direction="column"
          gap="m"
          padding="l"
          background="surface-bright"
          border
          border-radius="xl"
          shadow="1"
        >
          <lustrous-text variant="headline-small" heading="2">
            Adaptation Phrases &amp; Rubric
          </lustrous-text>

          <lustrous-flex wrap="wrap" gap="xs">
            {scenario.phrases.map((p) => (
              <lustrous-badge key={p} tone="teal">
                {p}
              </lustrous-badge>
            ))}
          </lustrous-flex>

          {rubrics.length === 0 ? (
            <lustrous-text variant="body-small" muted>
              Speak a turn—your coach will log fluency &amp; phrasing cards here
              via <code>score_turn</code>.
            </lustrous-text>
          ) : (
            <lustrous-flex direction="column" gap="s">
              {rubrics.map((r, i) => (
                <lustrous-box
                  key={i}
                  padding="m"
                  background="surface-container"
                  border
                  border-radius="l"
                >
                  <lustrous-flex direction="column" gap="xs">
                    <lustrous-flex gap="xs" wrap="wrap">
                      <lustrous-badge tone="emerald">
                        Fluency {r.fluency}/5
                      </lustrous-badge>
                      <lustrous-badge tone="cobalt">
                        Clarity {r.clarity}/5
                      </lustrous-badge>
                    </lustrous-flex>
                    <lustrous-prose-text
                      variant="body-medium"
                      language={scenario.languageCode}
                    >
                      {r.betterPhrasing}
                    </lustrous-prose-text>
                    {r.vocabTip && (
                      <lustrous-text variant="body-small" muted>
                        Tip: {r.vocabTip}
                      </lustrous-text>
                    )}
                  </lustrous-flex>
                </lustrous-box>
              ))}
            </lustrous-flex>
          )}
        </lustrous-flex>
      </div>
    </lustrous-flex>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CoachApp />
  </StrictMode>,
);
