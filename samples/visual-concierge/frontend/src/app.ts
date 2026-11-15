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
import { LitElement, css, html } from 'lit';

interface ChecklistState {
  title: string;
  items: string[];
  completed: Set<number>;
  summary: string;
}

export class VisualConciergeApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 1220px;
      margin: 0 auto;
      padding: 1.25rem;
    }
    .grid {
      display: grid;
      grid-template-columns: 350px 1fr 340px;
      gap: 1.1rem;
    }
    @media (max-width: 1024px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .stage {
      position: relative;
      aspect-ratio: 9 / 16;
      max-height: 510px;
      background: #030712;
      border-radius: 12px;
      overflow: hidden;
    }
    video#avatar {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    video#pip {
      position: absolute;
      right: 10px;
      bottom: 10px;
      width: 108px;
      border-radius: 8px;
      border: 1px solid #38bdf8;
      background: #000;
    }
    .row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    select,
    input[type='text'] {
      padding: 0.48rem 0.75rem;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #030712;
      color: #f8fafc;
    }
    button {
      padding: 0.5rem 0.9rem;
      border-radius: 999px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      font-weight: 600;
      cursor: pointer;
    }
    button.primary {
      background: #38bdf8;
      color: #082f49;
      border-color: transparent;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .warning {
      padding: 0.55rem 0.75rem;
      border-radius: 8px;
      background: #451a03;
      border: 1px solid #b45309;
      color: #fde68a;
      font-size: 0.82rem;
    }
    .transcript {
      height: 410px;
      overflow-y: auto;
      background: #030712;
      border-radius: 12px;
      padding: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .turn {
      padding: 0.55rem 0.8rem;
      border-radius: 10px;
      max-width: 88%;
      font-size: 0.9rem;
    }
    .turn.user {
      align-self: flex-end;
      background: #1d4ed8;
    }
    .turn.assistant {
      align-self: flex-start;
      background: #1e293b;
    }
    .turn.tool {
      align-self: stretch;
      background: #0f172a;
      border: 1px solid #334155;
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
    }
    .step {
      display: flex;
      gap: 0.55rem;
      align-items: flex-start;
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      background: #030712;
      font-size: 0.88rem;
    }
    .step.done {
      text-decoration: line-through;
      color: #94a3b8;
    }
    .meta {
      font-size: 0.78rem;
      color: #94a3b8;
    }
  `;

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

  private toggleStep(idx: number): void {
    const next = new Set(this.checklist.completed);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    this.checklist = { ...this.checklist, completed: next };
    this.requestUpdate();
  }

  private handlePrompt(e: SubmitEvent): void {
    e.preventDefault();
    const input = this.renderRoot.querySelector<HTMLInputElement>('#prompt');
    if (input && this.live.sendText(input.value)) {
      input.value = '';
    }
  }

  protected override render() {
    const active = this.live.isConnected && !this.live.isTerminating;
    const showPip = this.live.isCameraActive || this.live.isScreenShareActive;
    const warning = this.live.session.lastWarning;

    return html`
      <div class="grid">
        <section class="card">
          <strong>Avatar &amp; Vision Stage</strong>
          <div class="stage">
            <video id="avatar" playsinline autoplay></video>
            <video
              id="pip"
              playsinline
              autoplay
              muted
              style="display:${showPip ? 'block' : 'none'}"
            ></video>
          </div>
          <div class="row">
            <select
              .value=${this.selectedMode}
              ?disabled=${this.live.isConnected}
              @change=${(e: Event) => {
                this.selectedMode = (e.target as HTMLSelectElement)
                  .value as LiveSessionMode;
                this.requestUpdate();
              }}
            >
              <option value="avatar">Avatar Video (fMP4)</option>
              <option value="audio">Voice Only (24 kHz PCM)</option>
            </select>
            <select
              .value=${this.selectedAvatar}
              ?disabled=${this.live.isConnected}
              @change=${(e: Event) => {
                this.selectedAvatar = (e.target as HTMLSelectElement).value;
                this.requestUpdate();
              }}
            >
              ${PRESET_AVATARS.map(
                (name) => html`
                  <option value=${name} ?selected=${name === this.selectedAvatar}>
                    ${name} (${defaultVoiceForAvatar(name)})
                  </option>
                `,
              )}
            </select>
          </div>
          <label class="meta">
            Custom Avatar Image (auto-cropped via prepareAvatarImage):
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              @change=${(e: Event) => void this.handleFileUpload(e)}
            />
          </label>
        </section>

        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>Visual Concierge (Lit 3)</strong>
            <span class="meta">${this.live.status}</span>
          </div>
          ${warning ? html`<div class="warning">${warning}</div>` : null}
          <div class="row">
            <button
              class="primary"
              ?disabled=${this.live.isConnected || this.live.isTerminating}
              @click=${() => void this.startSession()}
            >
              Start Concierge
            </button>
            <button
              ?disabled=${!active}
              @click=${() => void this.live.toggleMic()}
            >
              ${this.live.isRecording ? 'Mute Mic' : 'Unmute Mic'}
            </button>
            <button
              ?disabled=${!active}
              @click=${() =>
                void this.live.toggleCamera(() =>
                  this.renderRoot.querySelector<HTMLVideoElement>('#pip'),
                )}
            >
              ${this.live.isCameraActive ? 'Stop Camera' : '1 FPS Camera'}
            </button>
            <button
              ?disabled=${!active}
              @click=${() =>
                void this.live.toggleScreenShare(() =>
                  this.renderRoot.querySelector<HTMLVideoElement>('#pip'),
                )}
            >
              ${this.live.isScreenShareActive ? 'Stop Screen' : '1 FPS Screen'}
            </button>
            <button ?disabled=${!active} @click=${() => this.live.terminate()}>
              End
            </button>
          </div>
          <div class="transcript" aria-live="polite">
            ${this.live.transcript.map(
              (t) => html`<div class="turn ${t.type}">${t.text}</div>`,
            )}
          </div>
          <form class="row" @submit=${(e: SubmitEvent) => this.handlePrompt(e)}>
            <input
              id="prompt"
              type="text"
              style="flex:1"
              placeholder="Ask about what your camera or screen shows..."
            />
            <button type="submit" ?disabled=${!active}>Send</button>
          </form>
        </section>

        <aside class="card">
          <strong>${this.checklist.title}</strong>
          ${this.checklist.summary
            ? html`<div class="meta">${this.checklist.summary}</div>`
            : null}
          ${this.checklist.items.map(
            (step, idx) => html`
              <label
                class="step ${this.checklist.completed.has(idx) ? 'done' : ''}"
              >
                <input
                  type="checkbox"
                  .checked=${this.checklist.completed.has(idx)}
                  @change=${() => this.toggleStep(idx)}
                />
                <span>${step}</span>
              </label>
            `,
          )}
        </aside>
      </div>
    `;
  }
}

if (!customElements.get('visual-concierge-app')) {
  customElements.define('visual-concierge-app', VisualConciergeApp);
}
