/**
 * /api/chat/speak and /api/chat/transcribe route factories.
 *
 * The library doesn't take a hard dependency on `openai` — the caller
 * passes their pre-configured client.
 */

// First argument is the global `Request`, not a structural subset — see the note
// in tracker/server/routes.ts for why the subset breaks Next's route validator
// for any consumer that re-exports the handler. Fixed 2026-08-10.

interface NextResponseFactory {
  json(body: unknown, init?: { status?: number }): Response;
  // For audio/mpeg streams the route returns `new NextResponse(...)` directly.
  new (body: BodyInit | null, init?: ResponseInit): Response;
}

interface OpenAILike {
  audio: {
    speech: {
      create: (input: {
        model: string;
        voice: string;
        input: string;
        response_format: 'mp3';
      }) => Promise<{ body: ReadableStream | null }>;
    };
    transcriptions: {
      create: (input: {
        file: unknown;
        model: string;
        language?: string;
      }) => Promise<{ text: string }>;
    };
  };
}

/**
 * Build a POST handler for `/api/chat/speak`.
 * Body: `{ text: string, voice?: string }`. Response: audio/mpeg.
 *
 * Voices: alloy | echo | fable | onyx | nova | shimmer (default: nova).
 */
export interface MakeSpeakRouteOptions {
  /** Pre-configured OpenAI client (or compatible). */
  openai: OpenAILike;
  NextResponse: NextResponseFactory;
  /** TTS model name. Default 'tts-1'. */
  model?: string;
  /** Default voice when caller omits one. Default 'nova'. */
  defaultVoice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  /** Cap input length to protect TTS quota. Default 2000. */
  maxChars?: number;
}

export function makeSpeakRoute(opts: MakeSpeakRouteOptions) {
  const model = opts.model ?? 'tts-1';
  const defaultVoice = opts.defaultVoice ?? 'nova';
  const maxChars = opts.maxChars ?? 2000;
  return async function POST(request: Request) {
    try {
      const { text, voice } = (await request.json()) as { text?: string; voice?: string };
      if (!text || typeof text !== 'string') {
        return opts.NextResponse.json({ error: 'text required' }, { status: 400 });
      }
      const trimmed = text.slice(0, maxChars);
      const speech = await opts.openai.audio.speech.create({
        model,
        voice: voice ?? defaultVoice,
        input: trimmed,
        response_format: 'mp3',
      });
      return new opts.NextResponse(speech.body as unknown as BodyInit, {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'TTS failed';
      console.error('[speak] error:', msg);
      return opts.NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}

/**
 * Build a POST handler for `/api/chat/transcribe`.
 * Body: multipart/form-data with `audio` (Blob) + optional `language`.
 * Response: `{ text: string }`.
 */
export interface MakeTranscribeRouteOptions {
  openai: OpenAILike;
  NextResponse: NextResponseFactory;
  /** STT model name. Default 'whisper-1'. */
  model?: string;
  /**
   * Function to convert a Blob into the file shape OpenAI's SDK expects.
   * Pass `(blob) => toFile(blob, 'recording.webm', { type: blob.type || 'audio/webm' })`
   * importing `toFile` from `'openai/uploads'` in your route.
   */
  toFile: (blob: Blob) => Promise<unknown>;
}

export function makeTranscribeRoute(opts: MakeTranscribeRouteOptions) {
  const model = opts.model ?? 'whisper-1';
  return async function POST(request: Request) {
    try {
      const form = await request.formData();
      const audio = form.get('audio');
      if (!(audio instanceof Blob)) {
        return opts.NextResponse.json({ error: 'audio field required' }, { status: 400 });
      }
      const language = (form.get('language') as string | null) ?? undefined;
      const file = await opts.toFile(audio);
      const transcription = await opts.openai.audio.transcriptions.create({
        file,
        model,
        language: language ? language.split('-')[0] : undefined,
      });
      return opts.NextResponse.json({ text: transcription.text });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transcription failed';
      console.error('[transcribe] error:', msg);
      return opts.NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}
