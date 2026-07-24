'use client';

import { useEffect } from 'react';
import { track } from './track.js';
import type { TrackProps } from './types.js';

// Fires a single analytics event on mount. Use from Server Components by
// rendering: <TrackEvent event="view_product" props={{ ... }} />
export default function TrackEvent({
  event,
  props,
}: {
  event: string;
  props?: TrackProps;
}) {
  useEffect(() => {
    track(event, props);
    // Fire once per render-key change; re-fires when the serialized props change
    // because that signals a different page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, JSON.stringify(props ?? null)]);
  return null;
}
