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
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLiveSession } from './useLiveSession';

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
    welcome: '¡Buenas tardes! Bienvenido al Hotel Sol. ¿Tiene una reservación?',
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const scenario =
    SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const active = isConnected && !isTerminating;

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

  return (
    <div
      style={{
        maxWidth: 1180,
        margin: '0 auto',
        padding: '1.25rem',
        display: 'grid',
        gridTemplateColumns: '1fr 370px',
        gap: '1.1rem',
      }}
    >
      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>Bilingual &amp; Interview Coach (React 19)</strong>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{status}</span>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <select
            value={scenarioId}
            disabled={isConnected}
            onChange={(e) => setScenarioId(e.target.value)}
            style={inputStyle}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>

          <select
            value={mode}
            disabled={isConnected}
            onChange={(e) => setMode(e.target.value as LiveSessionMode)}
            style={inputStyle}
          >
            <option value="audio">Voice Only (24 kHz PCM)</option>
            <option value="avatar">Talking Avatar (fMP4)</option>
          </select>

          {mode === 'avatar' && (
            <select
              value={avatarPreset}
              disabled={isConnected}
              onChange={(e) => setAvatarPreset(e.target.value)}
              style={inputStyle}
            >
              {PRESET_AVATARS.map((a) => (
                <option key={a} value={a}>
                  Avatar: {a}
                </option>
              ))}
            </select>
          )}
        </div>

        {lastWarning && (
          <div
            style={{
              padding: '0.55rem 0.75rem',
              borderRadius: 8,
              background: '#451a03',
              border: '1px solid #b45309',
              color: '#fde68a',
              fontSize: '0.82rem',
            }}
          >
            {lastWarning}
          </div>
        )}

        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
          VAD Learner Pause Patience (SilenceDurationMs: {silenceMs} ms)
          <input
            type="range"
            min={400}
            max={1800}
            step={100}
            value={silenceMs}
            disabled={isConnected}
            onChange={(e) => setSilenceMs(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={() => void handleStart()}
            disabled={isConnected || isTerminating}
            style={primaryBtnStyle}
          >
            Start Practice
          </button>
          <button
            onClick={() => void session.toggleMic()}
            disabled={!active}
            style={btnStyle}
          >
            {isRecording ? 'Mute Mic' : 'Unmute Mic'}
          </button>
          <button
            onClick={() => session.terminate()}
            disabled={!active}
            style={btnStyle}
          >
            End Session
          </button>
          <div
            style={{
              flex: 1,
              height: 8,
              background: '#030712',
              borderRadius: 99,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.round(micRms * 260))}%`,
                background: '#38bdf8',
              }}
            />
          </div>
        </div>

        <video
          ref={videoRef}
          playsInline
          autoPlay
          style={{
            display: mode === 'avatar' ? 'block' : 'none',
            width: 220,
            borderRadius: 12,
            background: '#000',
          }}
        />

        <div
          style={{
            height: 330,
            overflowY: 'auto',
            background: '#030712',
            borderRadius: 12,
            padding: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {transcript.map((item, idx) => (
            <div
              key={idx}
              style={{
                alignSelf: item.type === 'user' ? 'flex-end' : 'flex-start',
                background:
                  item.type === 'user'
                    ? '#1d4ed8'
                    : item.type === 'tool'
                      ? '#0f172a'
                      : '#1e293b',
                padding: '0.5rem 0.75rem',
                borderRadius: 10,
                fontSize: '0.88rem',
                maxWidth: '88%',
              }}
            >
              {item.text}
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (session.sendText(prompt)) setPrompt('');
          }}
          style={{ display: 'flex', gap: '0.5rem' }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Or type a response in the target language..."
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" disabled={!active} style={btnStyle}>
            Send
          </button>
        </form>
      </section>

      <aside style={cardStyle}>
        <strong>Adaptation Phrases &amp; Live Rubric</strong>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {scenario.phrases.map((p) => (
            <span
              key={p}
              style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.55rem',
                borderRadius: 99,
                background: '#1e293b',
                color: '#bae6fd',
              }}
            >
              {p}
            </span>
          ))}
        </div>
        {rubrics.length === 0 ? (
          <p style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
            Speak a turn—your coach will log fluency &amp; phrasing cards here via{' '}
            <code>score_turn</code>.
          </p>
        ) : (
          rubrics.map((r, i) => (
            <div
              key={i}
              style={{
                padding: '0.7rem',
                borderRadius: 10,
                background: '#030712',
                border: '1px solid #1e2937',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ color: '#38bdf8', fontWeight: 600 }}>
                Fluency {r.fluency}/5 · Clarity {r.clarity}/5
              </div>
              <div style={{ marginTop: 4 }}>{r.betterPhrasing}</div>
              {r.vocabTip && (
                <div style={{ marginTop: 4, color: '#94a3b8' }}>
                  Tip: {r.vocabTip}
                </div>
              )}
            </div>
          ))
        )}
      </aside>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1f2937',
  borderRadius: 16,
  padding: '1.1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.48rem 0.75rem',
  borderRadius: 8,
  border: '1px solid #334155',
  background: '#030712',
  color: '#f8fafc',
};

const btnStyle: React.CSSProperties = {
  padding: '0.48rem 0.9rem',
  borderRadius: 999,
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#f8fafc',
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#38bdf8',
  color: '#082f49',
  borderColor: 'transparent',
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CoachApp />
  </StrictMode>,
);
