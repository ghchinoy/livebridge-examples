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
  prepareAvatarImage,
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
import '@ghchinoy/lustrous-lit/components/lustrous-checkbox';
import '@ghchinoy/lustrous-lit/components/lustrous-flex';
import '@ghchinoy/lustrous-lit/components/lustrous-icon';
import '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import type { LustrousScrollableBox } from '@ghchinoy/lustrous-lit/components/lustrous-scrollable-box';
import '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import type { LustrousSegmentOption } from '@ghchinoy/lustrous-lit/components/lustrous-segmented-control';
import '@ghchinoy/lustrous-lit/components/lustrous-select';
import type { LustrousSelectOption } from '@ghchinoy/lustrous-lit/components/lustrous-select';
import '@ghchinoy/lustrous-lit/components/lustrous-text';
import '@ghchinoy/lustrous-lit/components/lustrous-text-input';
import '@ghchinoy/lustrous-lit/components/lustrous-togglable-button';
import {
  LustrousElement,
  lustrousBase,
  readLustrousThemePreference,
  setLustrousTheme,
  type LustrousChangeEvent,
  type LustrousThemePreference,
} from '@ghchinoy/lustrous-lit/theme';

interface ChecklistState {
  title: string;
  items: string[];
  completed: Set<number>;
  summary: string;
}

const THEME_STORAGE_KEY = 'livebridge.visual-concierge.theme';

const MODE_OPTIONS: readonly LustrousSelectOption[] = [
  { value: 'avatar', label: 'Avatar Video (fMP4)' },
  { value: 'audio', label: 'Voice Only (24 kHz PCM)' },
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

export class VisualConciergeApp extends LustrousElement {
  // ── 1. Livebridge Session, Media & Tool Wiring ────────────────────────────

  private readonly live = new LiveSessionController(this, { mode: 'avatar' });
  private selectedMode: LiveSessionMode = 'avatar';
  private selectedAvatar = 'Kira';
  private customAvatarUrl: string | null = null;
  private checklist: ChecklistState = {
    title: 'Inspection Checklist',
    items: ['Share your camera or screen to generate live inspection steps.'],
    completed: new Set(),
    summary: '',
  };

  private async handleFileUpload(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      this.customAvatarUrl = null;
      this.requestUpdate();
      return;
    }
    const raw = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    this.customAvatarUrl = await prepareAvatarImage(raw);
    this.requestUpdate();
  }

  private async startSession(): Promise<void> {
    this.live.session.lastWarning = '';
    const avatarEl = this.renderRoot.querySelector<HTMLVideoElement>('#avatar');
    const pairedVoice = defaultVoiceForAvatar(this.selectedAvatar) || 'Aoede';

    await this.live.connect({
      mode: this.selectedMode,
      endpoint: '/ws',
      videoElement: this.selectedMode === 'avatar' ? avatarEl : null,
      initialPayload: {
        mode: this.selectedMode,
        avatarData: this.customAvatarUrl ?? this.selectedAvatar,
        voiceName: pairedVoice,
      },
      onToolCall: (msg) => {
        if (msg.name === 'upsert_checklist' && msg.result) {
          const r = msg.result as Record<string, unknown>;
          const items = Array.isArray(r.items)
            ? r.items.map((x) => String(x))
            : [];
          const done = Array.isArray(r.completed)
            ? new Set(r.completed.map((n) => Number(n)))
            : new Set<number>();
          this.checklist = {
            title: String(r.title ?? 'Inspection Checklist'),
            items,
            completed: done,
            summary: String(r.summary ?? ''),
          };
          this.requestUpdate();
        }
      },
    });
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

  private toggleStep(idx: number): void {
    const next = new Set(this.checklist.completed);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    this.checklist = { ...this.checklist, completed: next };
    this.requestUpdate();
  }

  private statusTone(): LustrousBadgeTone {
    if (this.live.isConnected && !this.live.isTerminating) return 'positive';
    if (this.live.isTerminating) return 'warning';
    return 'default';
  }

  protected override render() {
    const active = this.live.isConnected && !this.live.isTerminating;
    const showPip = this.live.isCameraActive || this.live.isScreenShareActive;
    const warning = this.live.session.lastWarning;
    const doneCount = this.checklist.completed.size;
    const totalCount = this.checklist.items.length;

    return html`
      <lustrous-flex
        direction="column"
        gap="l"
        padding="l"
        mobile-padding="m"
        max-width="1260"
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
              Visual Concierge
            </lustrous-text>
            <lustrous-badge tone="cobalt">Lit 3</lustrous-badge>
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

        <div class="stage-grid">
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
              Avatar &amp; Vision Stage
            </lustrous-text>

            <lustrous-box
              class="stage"
              data-theme="dark"
              background="surface-dim"
              border
              border-radius="l"
              overflow="hidden"
            >
              <video id="avatar" playsinline autoplay></video>
              <video id="pip" playsinline autoplay muted ?hidden=${!showPip}></video>
            </lustrous-box>

            <lustrous-select
              label="Session mode"
              size="s"
              .value=${this.selectedMode}
              .options=${MODE_OPTIONS}
              ?disabled=${this.live.isConnected}
              @lustrous-change=${(e: LustrousChangeEvent) => {
                this.selectedMode = (e.detail.value ??
                  'avatar') as LiveSessionMode;
                this.requestUpdate();
              }}
            ></lustrous-select>

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

            <lustrous-flex direction="column" gap="xs">
              <lustrous-text variant="body-small" muted>
                Custom portrait (auto-cropped via <code>prepareAvatarImage</code>)
              </lustrous-text>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                ?disabled=${this.live.isConnected}
                @change=${(e: Event) => void this.handleFileUpload(e)}
              />
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
              Live Session &amp; Transcript
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
                Start Concierge
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
              <lustrous-togglable-button
                size="s"
                icon="photoCamera"
                .selected=${this.live.isCameraActive}
                ?disabled=${!active}
                @lustrous-change=${(e: Event) => {
                  e.preventDefault();
                  void this.live.toggleCamera(() =>
                    this.renderRoot.querySelector<HTMLVideoElement>('#pip'),
                  );
                }}
              >
                ${this.live.isCameraActive ? 'Stop Camera' : '1 FPS Camera'}
              </lustrous-togglable-button>
              <lustrous-togglable-button
                size="s"
                icon="devices"
                .selected=${this.live.isScreenShareActive}
                ?disabled=${!active}
                @lustrous-change=${(e: Event) => {
                  e.preventDefault();
                  void this.live.toggleScreenShare(() =>
                    this.renderRoot.querySelector<HTMLVideoElement>('#pip'),
                  );
                }}
              >
                ${this.live.isScreenShareActive
                  ? 'Stop Screen'
                  : '1 FPS Screen'}
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
                      Click <strong>Start Concierge</strong> to stream fMP4
                      avatar video, 24 kHz audio, and 1 FPS camera/screen
                      frames.
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
                  placeholder="Ask about what your camera or screen shows..."
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
            <lustrous-flex align="center" justify="space-between" gap="s">
              <lustrous-text variant="headline-small" heading="2">
                ${this.checklist.title}
              </lustrous-text>
              <lustrous-badge tone="emerald">
                ${doneCount}/${totalCount}
              </lustrous-badge>
            </lustrous-flex>

            ${this.checklist.summary
              ? html`<lustrous-text variant="body-small" muted>
                  ${this.checklist.summary}
                </lustrous-text>`
              : nothing}

            <lustrous-flex direction="column" gap="xs">
              ${this.checklist.items.map((step, idx) => {
                const done = this.checklist.completed.has(idx);
                return html`
                  <lustrous-checkbox
                    .checked=${done}
                    @lustrous-change=${() => this.toggleStep(idx)}
                  >
                    <span class=${done ? 'step-done' : ''}>${step}</span>
                  </lustrous-checkbox>
                `;
              })}
            </lustrous-flex>
          </lustrous-flex>
        </div>
      </lustrous-flex>
    `;
  }

  static override styles = [
    lustrousBase,
    css`
      .stage-grid {
        display: grid;
        grid-template-columns: 330px minmax(0, 1fr) 310px;
        gap: var(--lustrous-space-l);
        align-items: start;
      }
      @media (max-width: 1060px) {
        .stage-grid {
          grid-template-columns: 1fr;
        }
      }
      .stage {
        position: relative;
        aspect-ratio: 9 / 16;
        max-height: 460px;
      }
      video#avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      video#pip {
        position: absolute;
        inset-inline-end: var(--lustrous-space-s);
        inset-block-end: var(--lustrous-space-s);
        width: 108px;
        border-radius: var(--lustrous-radius-s);
        border: 2px solid var(--lustrous-color-accent);
      }
      .transcript {
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
      .step-done {
        text-decoration: line-through;
        color: var(--lustrous-text-muted);
      }
    `,
  ];
}

if (!customElements.get('visual-concierge-app')) {
  customElements.define('visual-concierge-app', VisualConciergeApp);
}
