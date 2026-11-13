// Play-mode rules for the player bar, kept free of React so they can be unit tested.

/** once: stop after the sound ends (default). one: repeat the current sound. list: continue down the list and wrap. shuffle: random order. */
export type PlayMode = 'once' | 'one' | 'list' | 'shuffle';

export interface ShuffleState {
  /** Sounds still waiting in the current shuffle round, in the order they will play. */
  pending: string[];
  /** Sounds already left behind in shuffle mode, oldest first, for the previous button. */
  history: string[];
}

export interface Navigation { id: string | null; shuffle: ShuffleState; }
/** A navigation plus the play context to keep: the list that playback moves through from then on. */
export interface Move extends Navigation { context: readonly string[]; }
/** A play request from a list row: toggle means only pause or resume the current sound; otherwise the sound starts. */
export interface RowRequest { toggle: boolean; context: readonly string[]; shuffle: ShuffleState; }

type Playable = (id: string) => boolean;

const HISTORY_LIMIT = 500;

export const playModeOptions: { mode: Exclude<PlayMode, 'once'>; label: string; hint: string }[] = [
  { mode: 'list', label: '列表循环', hint: '播完自动播放下一条，到最后一条后从头开始' },
  { mode: 'shuffle', label: '随机播放', hint: '播完随机播放另一条，整个列表播完一轮才会重复' },
  { mode: 'one', label: '单曲循环', hint: '重复播放当前声音' },
];

export const emptyShuffle = (): ShuffleState => ({ pending: [], history: [] });

/** Clicking the active mode turns it off again; clicking another mode switches to it. */
export const nextMode = (current: PlayMode, chosen: PlayMode): PlayMode => current === chosen ? 'once' : chosen;

/** Whether a sound that plays to its end should hand over to another one. */
export const continuesAfterEnd = (mode: PlayMode) => mode === 'list' || mode === 'shuffle';

/**
 * The list that next/previous and auto-advance move through: the play context, the list the current sound was
 * started from, so browsing elsewhere does not change it. While the shown list holds exactly the same sounds, its
 * current sort order wins; once it gains or loses a sound, playback keeps the start-time list and order.
 * When the context has nothing playable, falls back to the visible list, then to the whole library.
 */
export function playbackList(context: readonly string[], visible: readonly string[], library: readonly string[], playable: Playable): readonly string[] {
  if (context.some(playable)) return sameMembers(context, visible) ? visible : context;
  if (visible.some(playable)) return visible;
  return library;
}

/** The neighbouring playable sound in list order, wrapping at both ends; the current sound itself when nothing else can play. */
export function step(list: readonly string[], currentId: string | null, direction: 1 | -1, playable: Playable): string | null {
  const count = list.length;
  const index = currentId === null ? -1 : list.indexOf(currentId);
  const start = index >= 0 ? index : direction > 0 ? -1 : count;
  for (let offset = 1; offset <= count; offset++) {
    const id = list[(((start + direction * offset) % count) + count) % count];
    if (playable(id)) return id;
  }
  return null;
}

/** Fisher-Yates shuffle with an injectable random source. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Next sound in shuffle mode. A round starts from the sound playing now and then plays every other sound in the
 * list once, in random order, so nothing repeats within a round and a new round never opens with the sound that
 * just played. With only the current sound left to play, it plays again.
 */
export function shuffleNext(state: ShuffleState, list: readonly string[], currentId: string | null, playable: Playable, random: () => number = Math.random): Navigation {
  const candidates = list.filter(playable);
  const members = new Set(candidates);
  let pending = state.pending.filter(id => id !== currentId && members.has(id));
  if (!pending.length) {
    const others = candidates.filter(id => id !== currentId);
    pending = others.length ? shuffled(others, random) : candidates;
  }
  if (!pending.length) return { id: null, shuffle: { pending: [], history: [...state.history] } };
  const [id, ...rest] = pending;
  return { id, shuffle: { pending: rest, history: id === currentId ? [...state.history] : remember(state.history, currentId) } };
}

/** Previous sound in shuffle mode: walks back through what shuffle already played; the sound being left comes up next again. */
export function shufflePrevious(state: ShuffleState, list: readonly string[], currentId: string | null, playable: Playable): Navigation {
  const members = new Set(list.filter(playable));
  const history = [...state.history];
  while (history.length) {
    const id = history.pop()!;
    if (id === currentId || !members.has(id)) continue;
    const returning = currentId !== null && members.has(currentId) ? [currentId] : [];
    return { id, shuffle: { pending: [...returning, ...state.pending.filter(other => other !== id && other !== currentId)], history } };
  }
  return { id: null, shuffle: { pending: [...state.pending], history: [] } };
}

/** A sound the listener picked directly: it leaves the current round, and the sound being left joins the history. */
export function shuffleJump(state: ShuffleState, currentId: string | null, nextId: string): ShuffleState {
  return { pending: state.pending.filter(id => id !== nextId), history: nextId === currentId ? [...state.history] : remember(state.history, currentId) };
}

/**
 * Where the next/previous buttons lead, and where list and shuffle modes go when a sound ends. In shuffle mode,
 * previous with no usable history restarts the current sound, or moves on as next does when that cannot play.
 */
export function navigate(mode: PlayMode, direction: 1 | -1, list: readonly string[], currentId: string | null, playable: Playable, shuffle: ShuffleState, random: () => number = Math.random): Navigation {
  if (mode !== 'shuffle') return { id: step(list, currentId, direction, playable), shuffle };
  if (direction > 0) return shuffleNext(shuffle, list, currentId, playable, random);
  const back = shufflePrevious(shuffle, list, currentId, playable);
  if (back.id !== null) return back;
  if (currentId !== null && playable(currentId)) return { id: currentId, shuffle: back.shuffle };
  return shuffleNext(back.shuffle, list, currentId, playable, random);
}

/**
 * The next/previous buttons and auto-advance: navigate through playbackList. When the context has nothing playable
 * and a sound starts from the list used instead, that list becomes the context, so later auto-advance stays in it.
 */
export function advance(mode: PlayMode, direction: 1 | -1, context: readonly string[], visible: readonly string[], library: readonly string[], currentId: string | null, playable: Playable, shuffle: ShuffleState, random: () => number = Math.random): Move {
  const list = playbackList(context, visible, library, playable);
  const target = navigate(mode, direction, list, currentId, playable, shuffle, random);
  return { ...target, context: target.id === null || context.some(playable) ? context : list };
}

/**
 * A play request from a list row. For the current sound it only pauses or resumes; context and shuffle state stay.
 * Another sound starts with the visible list as context when shown there, else the old context when that has it,
 * else none. In shuffle mode a context holding a sound the old one lacked starts a fresh round after the picked
 * sound; a context made only of the old sounds (the same list re-sorted, or with sounds removed) keeps the round
 * without the sounds that left (shuffleJump). Either way the sound being left joins the history.
 */
export function rowRequest(mode: PlayMode, id: string, currentId: string | null, context: readonly string[], visible: readonly string[], shuffle: ShuffleState): RowRequest {
  if (id === currentId) return { toggle: true, context, shuffle };
  const next = visible.includes(id) ? visible : context.includes(id) ? context : [];
  const old = new Set(context), members = new Set(next);
  const keep = next.length > 0 && next.every(other => old.has(other));
  const round = keep ? { pending: shuffle.pending.filter(other => members.has(other)), history: shuffle.history } : { pending: [], history: shuffle.history };
  return { toggle: false, context: next, shuffle: mode === 'shuffle' ? shuffleJump(round, currentId, id) : shuffle };
}

function sameMembers(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const members = new Set(a);
  return b.every(id => members.has(id));
}

function remember(history: readonly string[], id: string | null) {
  return (id === null ? [...history] : [...history, id]).slice(-HISTORY_LIMIT);
}
