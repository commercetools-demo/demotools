// Type-level regression test: every exported route factory must produce a
// handler a demo can re-export straight out of an App Router `route.ts`.
//
// This exists because ordinary assignability does NOT catch the failure. A
// handler declared `(req: RequestLike) => Promise<Response>` is assignable to
// `(req: Request) => Promise<Response>` — TypeScript is bivariant on parameters,
// and `Request` satisfies any structural subset of itself. So `tsc --noEmit`
// here, `tsc --noEmit` in the consumer, and a Turbopack `next build` all passed
// while `next build --webpack` failed on b2c-starter's `/api/gate`:
//
//   Type error: Route "app/api/gate/route.ts" has an invalid "GET" export:
//     Type "RequestLike" is not a valid type for the function's first argument.
//       Expected "NextRequest | Request", got "RequestLike".
//
// The check that produced that lives in Next's `next-types-plugin` (webpack
// only, which is why Turbopack builds stayed green). It does not ask whether the
// handler ACCEPTS a Request — it extracts the DECLARED first-argument type and
// requires it to extend `Request | NextRequest`:
//
//   Diff<ParamCheck<Request | NextRequest>, { __param_type__: FirstArg<GET> }>
//   type Diff<Base, T extends Base, _M> = ...    // ← T must extend Base
//
// So the constraint is one-directional and nominal-ish, and reproducing it is
// the only way to test for it. FirstArg below is copied verbatim from that
// plugin so this test tracks what Next actually does.
//
// Run: npm test  (tsc --noEmit -p tsconfig.test.json)

import { createGateRoute, createTrackerProxyRoute } from '../src/tracker/server/index';
import { makeChatRoute } from '../src/chat/server/route-factories';
import { makeSpeakRoute, makeTranscribeRoute } from '../src/chat/server/audio-routes';
import type { ChatComplete } from '../src/chat/agent';

// Verbatim from next/dist/build/webpack/plugins/next-types-plugin.
type FirstArg<T extends Function> = T extends (...args: [infer A, any]) => any
  ? unknown extends A
    ? any
    : A
  : never;

// `true` only when Next's validator would accept the handler. NextRequest
// extends Request, so testing against Request alone is the strict case — it
// fails for any hand-rolled subset without needing `next` installed here.
type AcceptedByNext<T extends Function> = FirstArg<T> extends Request ? true : false;

// Each line below fails to compile if that factory's handler regresses to a
// structural request type. The error reads
// `Type 'false' is not assignable to type 'true'` against the named const, so
// the failing factory is obvious.
declare function proof<T extends Function>(handler: T): AcceptedByNext<T>;

const gate = createGateRoute({ homePath: '/en-us' });
export const createGateRoute_GET: true = proof(gate.GET);
export const createGateRoute_POST: true = proof(gate.POST);
export const createTrackerProxyRoute_handler: true = proof(createTrackerProxyRoute());

declare const chatComplete: ChatComplete;
export const makeChatRoute_POST: true = proof(
  makeChatRoute({
    getSession: async () => ({}),
    buildSystemPrompt: () => '',
    tools: [],
    toolRegistry: {},
    chatComplete,
    NextResponse: { json: () => new Response() },
  }),
);

declare const openai: Parameters<typeof makeSpeakRoute>[0]['openai'];
declare const NextResponse: Parameters<typeof makeSpeakRoute>[0]['NextResponse'];
export const makeSpeakRoute_POST: true = proof(makeSpeakRoute({ openai, NextResponse }));
export const makeTranscribeRoute_POST: true = proof(
  makeTranscribeRoute({ openai, NextResponse, toFile: async () => ({}) }),
);

// Companion check on the other half of the signature: the handler must also be
// assignable to the shape Next calls it with, so a consumer can write
// `export const GET = handler` with no cast. This is the bivariant check that
// passed all along — it is here to catch a return-type or arity regression,
// NOT the first-argument one above. Losing one of these two silently is how
// this bug shipped, so they are deliberately both present and labelled.
type NextRouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

export const callable_gate_GET: NextRouteHandler = gate.GET;
export const callable_gate_POST: NextRouteHandler = gate.POST;
export const callable_trackerProxy: NextRouteHandler = createTrackerProxyRoute();
