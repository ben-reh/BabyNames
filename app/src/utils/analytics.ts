// Lightweight structured event logger.
// In dev: prints JSON to Metro console.
// Replace `emit` with a real analytics sink (Segment, Amplitude, etc.) when ready.

const SESSION_START = Date.now();

function emit(event: string, props: Record<string, unknown>) {
  const entry = {
    event,
    ts: new Date().toISOString(),
    session_ms: Date.now() - SESSION_START,
    ...props,
  };
  console.log('[analytics]', JSON.stringify(entry));
}

// API call timing — used by Axios interceptors
export function logApiRequest(url: string, method: string) {
  const start = Date.now();
  return {
    done(status: number, extra?: Record<string, unknown>) {
      emit('api_call', { url, method: method.toUpperCase(), status, duration_ms: Date.now() - start, ...extra });
    },
    error(status: number | undefined, message: string) {
      emit('api_error', { url, method: method.toUpperCase(), status, duration_ms: Date.now() - start, message });
    },
  };
}

// Swipe events
export function logSwipe(direction: 'right' | 'left', name: string, queueRemaining: number, msSinceLastSwipe: number | null) {
  emit('swipe', { direction, name, queue_remaining: queueRemaining, ms_since_last_swipe: msSinceLastSwipe });
}

// Time from screen mount → first card visible
export function logTimeToFirstCard(ms: number, queueSize: number) {
  emit('time_to_first_card', { duration_ms: ms, queue_size: queueSize });
}

// Queue fetch (pagination)
export function logQueueFetch(trigger: 'low_buffer' | 'filter_change', cardIndex: number, queueSize: number) {
  const start = Date.now();
  emit('queue_fetch_start', { trigger, card_index: cardIndex, queue_size: queueSize });
  return {
    done(newCount: number) {
      emit('queue_fetch_done', { trigger, duration_ms: Date.now() - start, new_names_added: newCount });
    },
  };
}

// Queue rebuild on filter change
export function logQueueRebuild(filterKey: string, newSize: number) {
  emit('queue_rebuild', { filter_key: filterKey, new_size: newSize });
}
