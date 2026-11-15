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
  WebmcpToolError,
  WebmcpToolHost,
} from '@ghchinoy/livebridge';

interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  highlighted: boolean;
}

interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

type Point = { x: number; y: number };

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const board = $<HTMLCanvasElement>('board');
const boardCtx = board.getContext('2d')!;
const spectrum = $<HTMLCanvasElement>('spectrum');
const specCtx = spectrum.getContext('2d')!;

const nodes = new Map<string, DiagramNode>();
const edges: DiagramEdge[] = [];
const strokes: Point[][] = [];
let activeStroke: Point[] | null = null;

function renderBoardAndSnapshot(): string {
  boardCtx.fillStyle = '#030712';
  boardCtx.fillRect(0, 0, board.width, board.height);

  // Subtle grid
  boardCtx.strokeStyle = '#0f172a';
  boardCtx.lineWidth = 1;
  for (let x = 32; x < board.width; x += 32) {
    boardCtx.beginPath();
    boardCtx.moveTo(x, 0);
    boardCtx.lineTo(x, board.height);
    boardCtx.stroke();
  }
  for (let y = 32; y < board.height; y += 32) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, y);
    boardCtx.lineTo(board.width, y);
    boardCtx.stroke();
  }

  // Edges
  for (const edge of edges) {
    const a = nodes.get(edge.from);
    const b = nodes.get(edge.to);
    if (!a || !b) continue;
    boardCtx.strokeStyle = '#64748b';
    boardCtx.lineWidth = 2;
    boardCtx.beginPath();
    boardCtx.moveTo(a.x, a.y);
    boardCtx.lineTo(b.x, b.y);
    boardCtx.stroke();
    if (edge.label) {
      boardCtx.fillStyle = '#94a3b8';
      boardCtx.font = '11px ui-monospace, monospace';
      boardCtx.textAlign = 'center';
      boardCtx.fillText(edge.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6);
    }
  }

  // Nodes
  for (const node of nodes.values()) {
    boardCtx.fillStyle = '#111827';
    boardCtx.strokeStyle = node.highlighted ? '#f59e0b' : '#38bdf8';
    boardCtx.lineWidth = node.highlighted ? 3 : 2;
    boardCtx.beginPath();
    boardCtx.roundRect(node.x - 68, node.y - 26, 136, 52, 10);
    boardCtx.fill();
    boardCtx.stroke();

    boardCtx.fillStyle = '#f8fafc';
    boardCtx.font = 'bold 13px ui-sans-serif, system-ui, sans-serif';
    boardCtx.textAlign = 'center';
    boardCtx.fillText(node.label, node.x, node.y + 4);
  }

  // User freehand ink strokes
  boardCtx.strokeStyle = '#a78bfa';
  boardCtx.lineWidth = 2.5;
  boardCtx.lineCap = 'round';
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    boardCtx.beginPath();
    boardCtx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      boardCtx.lineTo(stroke[i].x, stroke[i].y);
    }
    boardCtx.stroke();
  }

  return board.toDataURL('image/jpeg', 0.82);
}

const toolHost = new WebmcpToolHost();
await toolHost.register([
  {
    name: 'add_node',
    description:
      'Places or updates a labeled architecture node on the 640x400 canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Short identifier (e.g. api_gw)' },
        label: { type: 'string', description: 'Display title' },
        x: { type: 'number', description: 'X coordinate in 80..560' },
        y: { type: 'number', description: 'Y coordinate in 50..350' },
      },
      required: ['id', 'label', 'x', 'y'],
    },
    execute: async (args) => {
      const id = String(args.id ?? '').trim();
      const label = String(args.label ?? '').trim();
      if (!id || !label) throw new WebmcpToolError('id and label are required');
      const x = Math.max(75, Math.min(565, Number(args.x ?? 320)));
      const y = Math.max(40, Math.min(360, Number(args.y ?? 200)));
      nodes.set(id, { id, label, x, y, highlighted: false });
      return {
        result: { status: 'added', id, x, y, totalNodes: nodes.size },
        imageDataUrl: renderBoardAndSnapshot(),
      };
    },
  },
  {
    name: 'connect_nodes',
    description: 'Draws a labeled connector between two existing node IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        label: { type: 'string' },
      },
      required: ['from', 'to'],
    },
    execute: async (args) => {
      const from = String(args.from ?? '');
      const to = String(args.to ?? '');
      if (!nodes.has(from) || !nodes.has(to)) {
        throw new WebmcpToolError(`Unknown endpoint (${from} -> ${to})`);
      }
      edges.push({ from, to, label: String(args.label ?? '') });
      return {
        result: { status: 'connected', from, to },
        imageDataUrl: renderBoardAndSnapshot(),
      };
    },
  },
  {
    name: 'highlight_node',
    description: 'Highlights a specific node ID in amber while discussing it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: async (args) => {
      const id = String(args.id ?? '');
      for (const n of nodes.values()) {
        n.highlighted = n.id === id;
      }
      return {
        result: { highlighted: id },
        imageDataUrl: renderBoardAndSnapshot(),
      };
    },
  },
  {
    name: 'clear_board',
    description: 'Clears all nodes, edges, and freehand strokes from the board.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      nodes.clear();
      edges.length = 0;
      strokes.length = 0;
      return {
        result: { cleared: true },
        imageDataUrl: renderBoardAndSnapshot(),
      };
    },
  },
]);

const session = new LiveSession({ mode: 'audio', toolHost });

// Freehand pointer drawing -> sends live JPEG frame on pointerup!
function canvasCoords(e: PointerEvent): Point {
  const rect = board.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * board.width,
    y: ((e.clientY - rect.top) / rect.height) * board.height,
  };
}

board.addEventListener('pointerdown', (e) => {
  board.setPointerCapture(e.pointerId);
  activeStroke = [canvasCoords(e)];
  strokes.push(activeStroke);
  renderBoardAndSnapshot();
});

board.addEventListener('pointermove', (e) => {
  if (!activeStroke) return;
  activeStroke.push(canvasCoords(e));
  renderBoardAndSnapshot();
});

board.addEventListener('pointerup', () => {
  if (!activeStroke) return;
  activeStroke = null;
  const dataUrl = renderBoardAndSnapshot();
  if (session.isConnected) {
    const b64 = dataUrl.split(',')[1];
    if (b64) session.socket.sendVideoFrame(b64);
  }
});

// 60 FPS Audio-Reactive AnalyserNode spectrum loop (keeps animating even when muted!)
const freqBins = new Uint8Array(64);
function drawSpectrum(): void {
  specCtx.fillStyle = '#030712';
  specCtx.fillRect(0, 0, spectrum.width, spectrum.height);
  const analyser = session.pcmPlayer.analyser;
  if (analyser) {
    analyser.getByteFrequencyData(freqBins);
    const barW = spectrum.width / 32;
    for (let i = 0; i < 32; i++) {
      const h = (freqBins[i] / 255) * (spectrum.height - 6);
      specCtx.fillStyle = session.isMuted ? '#64748b' : '#38bdf8';
      specCtx.fillRect(i * barW + 2, spectrum.height - h - 2, barW - 4, h);
    }
  }
  requestAnimationFrame(drawSpectrum);
}
renderBoardAndSnapshot();
drawSpectrum();

session.addEventListener('change', () => {
  const active = session.isConnected && !session.isTerminating;
  $('status').textContent = session.status;
  $<HTMLButtonElement>('start-btn').disabled =
    session.isConnected || session.isTerminating;
  $<HTMLButtonElement>('mic-btn').disabled = !active;
  $<HTMLButtonElement>('mic-btn').textContent = session.isRecording
    ? 'Mute Mic'
    : 'Unmute Mic';
  $<HTMLButtonElement>('mute-btn').disabled = !active;
  $<HTMLButtonElement>('mute-btn').textContent = session.isMuted
    ? 'Unmute Speaker'
    : 'Mute Speaker';
  $<HTMLButtonElement>('end-btn').disabled = !active;
  $<HTMLButtonElement>('send-btn').disabled = !active;

  const pane = $('transcript');
  pane.replaceChildren(
    ...session.transcript.map((t) => {
      const div = document.createElement('div');
      div.className = `turn ${t.type}`;
      div.textContent = t.text;
      return div;
    }),
  );
  pane.scrollTop = pane.scrollHeight;
});

$('start-btn').onclick = () =>
  void session.connect({
    endpoint: '/ws/live',
    advertisePageTools: true,
    onCustomMessage: (msg) => {
      if (msg.type === 'tool_timing') {
        $('timing').textContent =
          `Last WebMCP tool: ${String(msg.name)} (${String(msg.execMs)}ms canvas / ${String(msg.roundTripMs)}ms RTT)`;
      }
    },
  });

$('mic-btn').onclick = () => void session.toggleMic();
$('mute-btn').onclick = () => session.toggleMute();
$('end-btn').onclick = () => session.terminate();
$('clear-btn').onclick = () => {
  nodes.clear();
  edges.length = 0;
  strokes.length = 0;
  renderBoardAndSnapshot();
};

$<HTMLFormElement>('prompt-form').onsubmit = (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('prompt-input');
  if (session.sendText(input.value)) input.value = '';
};
