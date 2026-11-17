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
  PRESET_AVATARS,
  defaultVoiceForAvatar,
  type LiveSessionMode,
} from '@ghchinoy/livebridge';
import { LiveSessionController } from '@ghchinoy/livebridge/lit';
import { css, html, nothing } from 'lit';
import '@ghchinoy/lustrous-lit/fonts.css';
import '@ghchinoy/lustrous-lit/theme.css';
import '@ghchinoy/lustrous-lit/components/lustrous-badge';
import type { LustrousBadgeTone } from '@ghchinoy/lustrous-lit/components/lustrous-badge';
import '@ghchinoy/lustrous-lit/components/lustrous-banner';
import '@ghchinoy/lustrous-lit/components/lustrous-box';
import '@ghchinoy/lustrous-lit/components/lustrous-button';
import '@ghchinoy/lustrous-lit/components/lustrous-code-block';
import '@ghchinoy/lustrous-lit/components/lustrous-flex';
import '@ghchinoy/lustrous-lit/components/lustrous-image';
import '@ghchinoy/lustrous-lit/components/lustrous-photo-lightbox';
import '@ghchinoy/lustrous-lit/components/lustrous-pressable';
import '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import type { LustrousScrollableBox } from '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import type { LustrousSegmentOption } from '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import '@ghchinoy/lustrous-lit/components/lustrous-select';
import type { LustrousSelectOption } from '@ghchinoy/lustrous-lit/components/lustrous-select';
import '@ghchinoy/lustrous-lit/components/lustrous-text';
import '@ghchinoy/lustrous-lit/components/lustrous-text-input';
import '@ghchinoy/lustrous-lit/components/lustrous-timeline';
import '@ghchinoy/lustrous-lit/components/lustrous-togglable-button';
import {
  LustrousElement,
  lustrousBase,
  readLustrousThemePreference,
  setLustrousTheme,
  type LustrousChangeEvent,
  type LustrousThemePreference,
} from '@ghchinoy/lustrous-lit/theme';

interface StepLog {
  jobId: string;
  kind: string;
  detail: string;
  output?: string;
}

const THEME_STORAGE_KEY = 'livebridge.antigravity-voice-desk.theme';

const MODE_OPTIONS: readonly LustrousSelectOption[] = [
  { value: 'audio', label: 'Voice Only (24 kHz PCM)' },
  { value: 'avatar', label: 'Talking Avatar (fMP4 Video)' },
];

const AVATAR_OPTIONS: readonly LustrousSelectOption[] = PRESET_AVATARS.map(
  (name) => ({
    value: name,
    label: `${name} (${defaultVoiceForAvatar(name)})`,
  }),
);

const THEME_OPTIONS: readonly LustrousSegmentOption[] = [
  { value: 'system', label: 'System', icon: 'modeAuto' },
  { value: 'light', label: 'Light', icon: 'lightMode' },
  { value: 'dark', label: 'Dark', icon: 'darkMode' },
];

export class AntigravityVoiceDesk extends LustrousElement {
  // ── 1. Livebridge Session, Media & Sandbox Wiring ─────────────────────────

  private readonly live = new LiveSessionController(this, {
    mode: 'audio',
    chimePreset: 'soft',
  });

  private selectedMode: LiveSessionMode = 'audio';
  private selectedAvatar = 'Kira';
  private environmentId = '';
  private artifactDataUrl = '';
  private artifactPath = '';
  private steps: StepLog[] = [];

  private async startSession(): Promise<void> {
    this.live.session.lastWarning = '';
    this.steps = [];
    this.artifactDataUrl = '';
    const videoEl = this.renderRoot.querySelector<HTMLVideoElement>('#avatar');

    await this.live.connect({
      mode: this.selectedMode,
      endpoint: '/ws',
      videoElement: this.selectedMode === 'avatar' ? videoEl : null,
      initialPayload: {
        mode: this.selectedMode,
        avatarData: this.selectedAvatar,
        voiceName: defaultVoiceForAvatar(this.selectedAvatar) || 'Aoede',
      },
      onCustomMessage: (msg) => {
        if (msg.type === 'sandbox_step') {
          if (typeof msg.environmentId === 'string' && msg.environmentId) {
            this.environmentId = msg.environmentId;
          }
          this.steps = [
            {
              jobId: String(msg.jobId ?? ''),
              kind: String(msg.kind ?? 'step'),
              detail: String(msg.detail ?? ''),
              output:
                typeof msg.output === 'string' ? msg.output : undefined,
            },
            ...this.steps,
          ];
          this.requestUpdate();
        } else if (
          msg.type === 'sandbox_artifact' &&
          typeof msg.dataUrl === 'string'
        ) {
          this.artifactDataUrl = msg.dataUrl;
          this.artifactPath = String(msg.path ?? '');
          if (typeof msg.environmentId === 'string' && msg.environmentId) {
            this.environmentId = msg.environmentId;
          }
          this.requestUpdate();
        }
      },
    });
  }

  private sendChip(text: string): void {
    this.live.sendText(text);
  }

  private sendPrompt(): void {
    if (this.live.sendText(this.promptDraft)) {
      this.promptDraft = '';
      this.requestUpdate();
    }
  }

  // ── 2. Lustrous UI Presentation ───────────────────────────────────────────

  private promptDraft = '';
  private themePreference: LustrousThemePreference = 'system';
  private lastTranscriptKey = '';

  override connectedCallback(): void {
    super.connectedCallback();
    this.themePreference = readLustrousThemePreference(
      THEME_STORAGE_KEY,
      'system',
    );
    setLustrousTheme(this.themePreference, { storageKey: THEME_STORAGE_KEY });
  }

  protected override updated(): void {
    const turns = this.live.transcript;
    const key = `${turns.length}:${turns.at(-1)?.text.length ?? 0}`;
    if (key !== this.lastTranscriptKey) {
      this.lastTranscriptKey = key;
      const scroller = this.renderRoot.querySelector<LustrousScrollableBox>(
        '.transcript',
      )?.scrollElement;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
  }

  private statusTone(): LustrousBadgeTone {
    if (this.live.isConnected && !this.live.isTerminating) return 'positive';
    if (this.live.isTerminating) return 'warning';
    return 'default';
  }

  protected override render() {
    const active = this.live.isConnected && !this.live.isTerminating;
    const warning = this.live.session.lastWarning;

    return html`
      <lustrous-flex
        direction="column"
        gap="l"
        padding="l"
        mobile-padding="m"
        max-width="1320"
        margin-inline="auto"
      >
        <lustrous-flex
          align="center"
          justify="space-between"
          gap="m"
          wrap="wrap"
        >
          <lustrous-flex align="center" gap="s" wrap="wrap">
            <lustrous-text variant="headline-medium" heading="1">
              Antigravity Voice Desk
            </lustrous-text>
            <lustrous-badge tone="cobalt">Lit 3</lustrous-badge>
            <lustrous-badge tone="violet">Managed Agents</lustrous-badge>
            <lustrous-badge tone=${this.statusTone()}>
              ${this.live.status}
            </lustrous-badge>
          </lustrous-flex>

          <lustrous-segmented-control
            size="s"
            label="Color theme"
            .value=${this.themePreference}
            .options=${THEME_OPTIONS}
            @lustrous-change=${(e: LustrousChangeEvent) => {
              const pref = (e.detail.value ?? 'system') as LustrousThemePreference;
              this.themePreference = pref;
              setLustrousTheme(pref, { storageKey: THEME_STORAGE_KEY });
              this.requestUpdate();
            }}
          ></lustrous-segmented-control>
        </lustrous-flex>

        <div class="desk-grid">
          <lustrous-flex
            direction="column"
            gap="m"
            padding="l"
            background="surface-bright"
            border
            border-radius="xl"
            shadow="1"
          >
            <lustrous-flex direction="column" gap="xs">
              <lustrous-text variant="headline-small" heading="2">
                Voice / Avatar Edge
              </lustrous-text>
              <lustrous-text variant="body-small" muted>
                Stateless Go switchboard (0 sandbox secrets)
              </lustrous-text>
            </lustrous-flex>

            <lustrous-box
              class="stage"
              data-theme="dark"
              background="surface-dim"
              border
              border-radius="l"
              overflow="hidden"
              ?hidden=${this.selectedMode !== 'avatar'}
            >
              <video id="avatar" playsinline autoplay></video>
            </lustrous-box>

            <lustrous-select
              label="Session mode"
              size="s"
              .value=${this.selectedMode}
              .options=${MODE_OPTIONS}
              ?disabled=${this.live.isConnected}
              @lustrous-change=${(e: LustrousChangeEvent) => {
                this.selectedMode = (e.detail.value ??
                  'audio') as LiveSessionMode;
                this.requestUpdate();
              }}
            ></lustrous-select>

            ${this.selectedMode === 'avatar'
              ? html`
                  <lustrous-select
                    label="Preset avatar & voice"
                    size="s"
                    .value=${this.selectedAvatar}
                    .options=${AVATAR_OPTIONS}
                    ?disabled=${this.live.isConnected}
                    @lustrous-change=${(e: LustrousChangeEvent) => {
                      this.selectedAvatar = e.detail.value ?? 'Kira';
                      this.requestUpdate();
                    }}
                  ></lustrous-select>
                `
              : nothing}

            <lustrous-button
              variant="tonal"
              size="s"
              icon="bell"
              @click=${() => {
                this.live.session.chime.cycleMode();
                this.requestUpdate();
              }}
            >
              Alert Chime: ${this.live.session.chime.mode}
            </lustrous-button>

            ${this.environmentId
              ? html`<lustrous-badge tone="teal" icon="terminal">
                  env: ${this.environmentId}
                </lustrous-badge>`
              : html`<lustrous-text variant="body-small" muted>
                  Sandbox provisioned on first task
                </lustrous-text>`}
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
              Voice Copilot &amp; Transcript
            </lustrous-text>

            ${warning
              ? html`<lustrous-banner
                  variant="warning"
                  icon="warning"
                  layout="row"
                  description=${warning}
                ></lustrous-banner>`
              : nothing}

            <lustrous-flex wrap="wrap" gap="s" align="center">
              <lustrous-button
                variant="accent"
                size="s"
                icon="play"
                ?disabled=${this.live.isConnected || this.live.isTerminating}
                @click=${() => void this.startSession()}
              >
                Connect Copilot
              </lustrous-button>
              <lustrous-togglable-button
                size="s"
                icon=${this.live.isRecording ? 'mic' : 'micOff'}
                .selected=${this.live.isRecording}
                ?disabled=${!active}
                @lustrous-change=${(e: Event) => {
                  e.preventDefault();
                  void this.live.toggleMic();
                }}
              >
                ${this.live.isRecording ? 'Mute Mic' : 'Unmute Mic'}
              </lustrous-togglable-button>
              <lustrous-button
                variant="outline"
                size="s"
                icon="stop"
                ?disabled=${!active}
                @click=${() => this.live.terminate()}
              >
                End
              </lustrous-button>
            </lustrous-flex>

            <lustrous-flex wrap="wrap" gap="xs">
              <lustrous-button
                variant="outline"
                size="xs"
                shape="pill"
                icon="terminal"
                ?disabled=${!active}
                @click=${() =>
                  this.sendChip(
                    'Use the sandbox to compute the first 35 prime gaps in Python, save a matplotlib chart to workspace/primes.png, and summarize what you see.',
                  )}
              >
                Plot prime gaps in Python &rarr; workspace/primes.png
              </lustrous-button>
            </lustrous-flex>

            <lustrous-scrollable-box
              class="transcript"
              scrim="both"
              label="Conversation transcript"
              background="surface-dim"
              border
              border-radius="l"
              padding="m"
              aria-live="polite"
            >
              <lustrous-flex direction="column" gap="s">
                ${this.live.transcript.length === 0
                  ? html`<lustrous-text variant="body-small" muted>
                      Connect the voice copilot and ask it to run Python, search
                      docs, or render a chart inside the isolated sandbox.
                    </lustrous-text>`
                  : this.live.transcript.map(
                      (t) => html`
                        <lustrous-box
                          class="turn ${t.type}"
                          padding="s"
                          padding-inline="m"
                          border-radius="m"
                          background=${t.type === 'user'
                            ? 'primary-container'
                            : t.type === 'tool'
                              ? 'code'
                              : 'surface-container'}
                          ?border=${t.type === 'tool'}
                        >
                          <lustrous-text
                            variant=${t.type === 'tool' ? 'code' : 'body-medium'}
                          >
                            ${t.text}
                          </lustrous-text>
                        </lustrous-box>
                      `,
                    )}
              </lustrous-flex>
            </lustrous-scrollable-box>

            <lustrous-flex gap="s" align="center">
              <lustrous-flex-item grow="1" min-width="0">
                <lustrous-text-input
                  id="prompt"
                  size="s"
                  aria-label="Prompt message"
                  placeholder="Ask the voice copilot to run code or plot data in Antigravity..."
                  .value=${this.promptDraft}
                  ?disabled=${!active}
                  @input=${(e: Event) => {
                    this.promptDraft = (
                      e.currentTarget as HTMLInputElement
                    ).value;
                    this.requestUpdate();
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      this.sendPrompt();
                    }
                  }}
                ></lustrous-text-input>
              </lustrous-flex-item>
              <lustrous-button
                size="s"
                icon="send"
                ?disabled=${!active}
                @click=${() => this.sendPrompt()}
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
              Sandbox Trace &amp; Artifacts
            </lustrous-text>

            ${this.artifactDataUrl
              ? html`
                  <lustrous-flex direction="column" gap="xs">
                    <lustrous-text variant="caption" muted>
                      Artifact: <code>${this.artifactPath}</code> (click to
                      inspect)
                    </lustrous-text>
                    <lustrous-photo-lightbox
                      src=${this.artifactDataUrl}
                      heading=${this.artifactPath || 'Sandbox chart'}
                    >
                      <lustrous-pressable
                        slot="trigger"
                        padding="xs"
                        background="surface"
                        border
                        border-radius="m"
                      >
                        <lustrous-image
                          src=${this.artifactDataUrl}
                          alt="Sandbox generated chart"
                          object-fit="contain"
                          border-radius="s"
                        ></lustrous-image>
                      </lustrous-pressable>
                    </lustrous-photo-lightbox>
                  </lustrous-flex>
                `
              : nothing}

            <lustrous-scrollable-box
              class="steps"
              scrim="both"
              label="Managed Agents SSE trace"
              background="surface-dim"
              border
              border-radius="l"
              padding="m"
            >
              ${this.steps.length === 0
                ? html`<lustrous-text variant="body-small" muted>
                    SSE steps (<code>code_execution</code>,
                    <code>google_search</code>, <code>completed</code>) stream
                    here while voice stays responsive.
                  </lustrous-text>`
                : html`
                    <lustrous-timeline label="Sandbox execution steps">
                      ${this.steps.map(
                        (s) => html`
                          <lustrous-timeline-item
                            status=${s.kind === 'completed' ? 'past' : 'active'}
                            icon=${s.kind === 'error' ? 'error' : nothing}
                            heading=${s.kind}
                            time-label=${s.jobId}
                          >
                            <lustrous-flex direction="column" gap="xs">
                              <lustrous-text
                                variant="body-small"
                                tone=${s.kind === 'error' ? 'error' : 'default'}
                              >
                                ${s.detail}
                              </lustrous-text>
                              ${s.output
                                ? html`<lustrous-code-block
                                    wrap
                                    label="stdout"
                                    .code=${s.output}
                                  ></lustrous-code-block>`
                                : nothing}
                            </lustrous-flex>
                          </lustrous-timeline-item>
                        `,
                      )}
                    </lustrous-timeline>
                  `}
            </lustrous-scrollable-box>
          </lustrous-flex>
        </div>
      </lustrous-flex>
    `;
  }

  static override styles = [
    lustrousBase,
    css`
      .desk-grid {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr) 390px;
        gap: var(--lustrous-space-l);
        align-items: start;
      }
      @media (max-width: 1080px) {
        .desk-grid {
          grid-template-columns: 1fr;
        }
      }
      .stage {
        aspect-ratio: 9 / 16;
        max-height: 360px;
      }
      video#avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .transcript,
      .steps {
        height: 400px;
      }
      .turn {
        max-width: 88%;
        align-self: flex-start;
      }
      .turn.user {
        align-self: flex-end;
      }
      .turn.tool {
        max-width: 100%;
        align-self: stretch;
      }
    `,
  ];
}

if (!customElements.get('antigravity-voice-desk')) {
  customElements.define('antigravity-voice-desk', AntigravityVoiceDesk);
}
