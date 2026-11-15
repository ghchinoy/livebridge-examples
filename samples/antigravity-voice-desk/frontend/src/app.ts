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
import { LitElement, css, html } from 'lit';

interface StepLog {
  jobId: string;
  kind: string;
  detail: string;
  output?: string;
}

export class AntigravityVoiceDesk extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 1260px;
      margin: 0 auto;
      padding: 1.25rem;
    }
    .grid {
      display: grid;
      grid-template-columns: 300px 1fr 400px;
      gap: 1.1rem;
    }
    @media (max-width: 1060px) {
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
      padding: 0.48rem 0.9rem;
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
    button.chip {
      font-size: 0.76rem;
      padding: 0.35rem 0.7rem;
      background: #0f172a;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    video#avatar {
      width: 100%;
      aspect-ratio: 9 / 16;
      max-height: 360px;
      object-fit: cover;
      background: #030712;
      border-radius: 12px;
    }
    .transcript,
    .steps {
      height: 380px;
      overflow-y: auto;
      background: #030712;
      border-radius: 12px;
      padding: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .turn {
      padding: 0.55rem 0.8rem;
      border-radius: 10px;
      max-width: 88%;
      font-size: 0.89rem;
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
      font-size: 0.76rem;
    }
    .step-item {
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      background: #111827;
      border-left: 3px solid #a855f7;
      font-size: 0.8rem;
    }
    img.artifact {
      width: 100%;
      border-radius: 10px;
      background: #fff;
      padding: 0.35rem;
    }
    .meta {
      font-size: 0.78rem;
      color: #94a3b8;
    }
    .pill {
      font-family: ui-monospace, monospace;
      font-size: 0.72rem;
      padding: 0.2rem 0.55rem;
      border-radius: 99px;
      background: #2e1065;
      color: #e9d5ff;
    }
  `;

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

  private handlePrompt(e: SubmitEvent): void {
    e.preventDefault();
    const input = this.renderRoot.querySelector<HTMLInputElement>('#prompt');
    if (input && this.live.sendText(input.value)) {
      input.value = '';
    }
  }

  protected override render() {
    const active = this.live.isConnected && !this.live.isTerminating;
    return html`
      <div class="grid">
        <section class="card">
          <strong>Voice / Avatar Edge</strong>
          <div class="meta">Stateless Go switchboard (0 sandbox secrets)</div>
          <video
            id="avatar"
            playsinline
            autoplay
            style="display:${this.selectedMode === 'avatar' ? 'block' : 'none'}"
          ></video>
          <select
            .value=${this.selectedMode}
            ?disabled=${this.live.isConnected}
            @change=${(e: Event) => {
              this.selectedMode = (e.target as HTMLSelectElement)
                .value as LiveSessionMode;
              this.requestUpdate();
            }}
          >
            <option value="audio">Voice Only (24 kHz PCM)</option>
            <option value="avatar">Talking Avatar (fMP4 Video)</option>
          </select>
          ${this.selectedMode === 'avatar'
            ? html`
                <select
                  .value=${this.selectedAvatar}
                  ?disabled=${this.live.isConnected}
                  @change=${(e: Event) => {
                    this.selectedAvatar = (
                      e.target as HTMLSelectElement
                    ).value;
                    this.requestUpdate();
                  }}
                >
                  ${PRESET_AVATARS.map(
                    (a) => html`<option value=${a}>${a}</option>`,
                  )}
                </select>
              `
            : null}
          <button
            @click=${() => {
              this.live.session.chime.cycleMode();
              this.requestUpdate();
            }}
          >
            Alert Chime: ${this.live.session.chime.mode}
          </button>
          ${this.environmentId
            ? html`<span class="pill">env: ${this.environmentId}</span>`
            : html`<span class="meta">Sandbox provisioned on first task</span>`}
        </section>

        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>Antigravity Voice Desk</strong>
            <span class="meta">${this.live.status}</span>
          </div>
          <div class="row">
            <button
              class="primary"
              ?disabled=${this.live.isConnected || this.live.isTerminating}
              @click=${() => void this.startSession()}
            >
              Connect Copilot
            </button>
            <button
              ?disabled=${!active}
              @click=${() => void this.live.toggleMic()}
            >
              ${this.live.isRecording ? 'Mute Mic' : 'Unmute Mic'}
            </button>
            <button ?disabled=${!active} @click=${() => this.live.terminate()}>
              End
            </button>
          </div>
          <div class="row">
            <button
              class="chip"
              ?disabled=${!active}
              @click=${() =>
                this.sendChip(
                  'Use the sandbox to compute the first 35 prime gaps in Python, save a matplotlib chart to workspace/primes.png, and summarize what you see.',
                )}
            >
              Plot prime gaps in Python -> workspace/primes.png
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
              placeholder="Ask the voice copilot to run code or plot data in Antigravity..."
            />
            <button type="submit" ?disabled=${!active}>Send</button>
          </form>
        </section>

        <aside class="card">
          <strong>Antigravity Sandbox Trace &amp; Artifacts</strong>
          ${this.artifactDataUrl
            ? html`
                <div class="meta">Fetched artifact: ${this.artifactPath}</div>
                <img
                  class="artifact"
                  src=${this.artifactDataUrl}
                  alt="Sandbox generated chart"
                />
              `
            : null}
          <div class="steps">
            ${this.steps.length === 0
              ? html`<div class="meta">
                  SSE steps (code_execution, google_search, completed) stream
                  here while voice stays responsive.
                </div>`
              : this.steps.map(
                  (s) => html`
                    <div class="step-item">
                      <strong>[${s.kind}]</strong> ${s.detail}
                      ${s.output
                        ? html`<pre
                            style="white-space:pre-wrap;margin:0.4rem 0 0;font-size:0.74rem;color:#cbd5e1"
                          >${s.output}</pre>`
                        : null}
                    </div>
                  `,
                )}
          </div>
        </aside>
      </div>
    `;
  }
}

if (!customElements.get('antigravity-voice-desk')) {
  customElements.define('antigravity-voice-desk', AntigravityVoiceDesk);
}
