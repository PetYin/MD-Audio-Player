import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, continuesAfterEnd, emptyShuffle, navigate, nextMode, playbackList, rowRequest, shuffled, shuffleJump, shuffleNext, shufflePrevious, step, type PlayMode, type ShuffleState } from '../src/playback';

const all = () => true;
const except = (...missing: string[]) => (id: string) => !missing.includes(id);
// Small seeded generator so shuffle tests are repeatable.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function playShuffle(list: string[], start: string, count: number, random: () => number) {
  let state: ShuffleState = emptyShuffle();
  let current = start;
  const played = [start];
  for (let i = 0; i < count; i++) {
    const result = shuffleNext(state, list, current, all, random);
    assert.ok(result.id);
    state = result.shuffle; current = result.id; played.push(current);
  }
  return { played, state };
}
// Applies rowRequest and advance the way Player.tsx does: row requests, and next/previous or auto-advance.
function player(library: string[], random: () => number, mode: PlayMode = 'shuffle') {
  const state = { current: null as string | null, context: [] as readonly string[], shuffle: emptyShuffle(), played: [] as string[] };
  const row = (id: string, visible: readonly string[]) => {
    const result = rowRequest(mode, id, state.current, state.context, visible, state.shuffle);
    state.context = result.context; state.shuffle = result.shuffle;
    if (!result.toggle) { state.current = id; state.played.push(id); }
  };
  const go = (direction: 1 | -1, visible: readonly string[]) => {
    const target = advance(mode, direction, state.context, visible, library, state.current, all, state.shuffle, random);
    state.context = target.context; state.shuffle = target.shuffle;
    if (target.id) { state.current = target.id; state.played.push(target.id); }
  };
  return { state, row, go };
}

test('mode buttons toggle: the active mode turns off, another mode replaces it', () => {
  assert.equal(nextMode('once', 'list'), 'list');
  assert.equal(nextMode('list', 'list'), 'once');
  assert.equal(nextMode('list', 'shuffle'), 'shuffle');
  assert.equal(nextMode('shuffle', 'one'), 'one');
  assert.equal(nextMode('one', 'one'), 'once');
  assert.deepEqual((['once', 'one', 'list', 'shuffle'] as const).map(continuesAfterEnd), [false, false, true, true]);
});

test('list order wraps at both ends and skips sounds that cannot play', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(step(list, 'b', 1, all), 'c');
  assert.equal(step(list, 'd', 1, all), 'a');
  assert.equal(step(list, 'a', -1, all), 'd');
  assert.equal(step(list, 'a', 1, except('b', 'c')), 'd');
  assert.equal(step(list, 'd', 1, except('a')), 'b');
  // A sound that became unavailable while playing still has neighbours.
  assert.equal(step(list, 'b', 1, except('b')), 'c');
  assert.equal(step(list, 'b', -1, except('b')), 'a');
});

test('list order starts at an end when nothing is playing, and repeats the only playable sound', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(step(list, null, 1, all), 'a');
  assert.equal(step(list, null, -1, all), 'c');
  assert.equal(step(list, 'x', 1, except('a')), 'b');
  assert.equal(step(list, 'b', 1, except('a', 'c')), 'b');
  assert.equal(step(list, 'b', 1, () => false), null);
  assert.equal(step([], 'a', 1, all), null);
});

test('playback stays in the list it started from while another list is shown', () => {
  const context = ['a', 'b', 'c'];
  assert.deepEqual(playbackList(context, ['x', 'y'], ['a', 'b', 'c', 'x', 'y'], all), context);
  assert.deepEqual(playbackList(context, ['a', 'b', 'c', 'x'], ['a', 'b', 'c', 'x'], all), context);
  // The same list re-sorted on screen is followed in its new order.
  assert.deepEqual(playbackList(context, ['c', 'a', 'b'], ['a', 'b', 'c'], all), ['c', 'a', 'b']);
  // Once the shown list lost a sound (a search narrowed it), the start-time list and order stay.
  assert.deepEqual(playbackList(context, ['c', 'a'], ['a', 'b', 'c'], all), context);
  assert.equal(advance('list', 1, ['a', 'b', 'c', 'd', 'e'], ['a', 'c'], ['a', 'b', 'c', 'd', 'e'], 'a', all, emptyShuffle()).id, 'b');
});

test('playback falls back to the visible list, then the whole library', () => {
  assert.deepEqual(playbackList([], ['x', 'y'], ['a', 'x', 'y'], all), ['x', 'y']);
  assert.deepEqual(playbackList(['a'], ['x'], ['a', 'x', 'z'], except('a')), ['x']);
  assert.deepEqual(playbackList(['a'], ['x'], ['a', 'x', 'z'], except('a', 'x')), ['a', 'x', 'z']);
});

test('shuffled returns a permutation and is repeatable with the same random source', () => {
  const items = Array.from({ length: 30 }, (_, index) => `s${index}`);
  const first = shuffled(items, seeded(7));
  assert.deepEqual([...first].sort(), [...items].sort());
  assert.deepEqual(shuffled(items, seeded(7)), first);
  assert.notDeepEqual(first, items);
  assert.deepEqual(shuffled(['a', 'b'], () => 0.999999999), ['a', 'b']);
});

test('shuffle plays every other sound once before a new round, and never the same sound twice in a row', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (let seed = 1; seed <= 50; seed++) {
    const { played } = playShuffle(list, 'c', 25, seeded(seed));
    // The first round is the starting sound plus each other sound once.
    assert.deepEqual([...played.slice(0, 6)].sort(), [...list].sort(), `seed ${seed}`);
    for (let index = 1; index < played.length; index++) assert.notEqual(played[index], played[index - 1], `seed ${seed}`);
    // Every later round starts from the last sound of the previous one and again covers the whole list.
    for (let start = 5; start + 6 <= played.length; start += 5) assert.deepEqual([...played.slice(start, start + 6)].sort(), [...list].sort(), `seed ${seed}`);
  }
});

test('shuffle replays the only playable sound and stops when nothing can play', () => {
  assert.equal(shuffleNext(emptyShuffle(), ['a', 'b'], 'a', except('b')).id, 'a');
  assert.equal(shuffleNext(emptyShuffle(), ['a'], 'a', all).id, 'a');
  assert.equal(shuffleNext(emptyShuffle(), ['a', 'b'], 'a', () => false).id, null);
  assert.equal(shuffleNext(emptyShuffle(), [], null, all).id, null);
});

test('shuffle drops sounds that left the list or can no longer play', () => {
  const state: ShuffleState = { pending: ['gone', 'b', 'broken', 'c'], history: [] };
  const first = shuffleNext(state, ['a', 'b', 'c', 'broken'], 'a', except('broken'));
  assert.equal(first.id, 'b');
  assert.deepEqual(first.shuffle.pending, ['c']);
  const second = shuffleNext(first.shuffle, ['a', 'b', 'c', 'broken'], 'b', except('broken'));
  assert.equal(second.id, 'c');
  assert.deepEqual(second.shuffle.history, ['a', 'b']);
});

test('previous in shuffle walks back through history and next returns to where it left', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  const { played, state } = playShuffle(list, 'a', 3, seeded(3));
  const [, second, third, fourth] = played;
  const back = shufflePrevious(state, list, fourth, all);
  assert.equal(back.id, third);
  assert.equal(back.shuffle.pending[0], fourth);
  const backAgain = shufflePrevious(back.shuffle, list, third, all);
  assert.equal(backAgain.id, second);
  assert.deepEqual(backAgain.shuffle.pending.slice(0, 2), [third, fourth]);
  const forward = shuffleNext(backAgain.shuffle, list, second, all);
  assert.equal(forward.id, third);
  assert.equal(shuffleNext(forward.shuffle, list, third, all).id, fourth);
});

test('previous in shuffle skips sounds outside the list and restarts the current sound without history', () => {
  const state: ShuffleState = { pending: [], history: ['a', 'x', 'b'] };
  const back = shufflePrevious(state, ['a', 'b', 'c'], 'c', except('b'));
  assert.equal(back.id, 'a');
  assert.deepEqual(back.shuffle.history, []);
  assert.equal(shufflePrevious(emptyShuffle(), ['a', 'b'], 'a', all).id, null);
  assert.equal(navigate('shuffle', -1, ['a', 'b'], 'a', all, emptyShuffle()).id, 'a');
  // A current sound that can no longer play is not restarted; previous moves on as next would.
  assert.deepEqual(navigate('shuffle', -1, ['a', 'b'], 'a', except('a'), { pending: [], history: ['x'] }), { id: 'b', shuffle: { pending: [], history: ['a'] } });
  assert.equal(navigate('shuffle', -1, ['a', 'b'], 'a', () => false, emptyShuffle()).id, null);
});

test('previous in shuffle with nothing played yet starts a round', () => {
  const list = ['a', 'b', 'c', 'd'];
  for (let seed = 1; seed <= 20; seed++) {
    const first = navigate('shuffle', -1, list, null, all, emptyShuffle(), seeded(seed));
    assert.ok(first.id && list.includes(first.id), `seed ${seed}`);
    assert.deepEqual([first.id, ...first.shuffle.pending].sort(), list, `seed ${seed}`);
    assert.deepEqual(first.shuffle.history, []);
  }
  // From the player bar with no context yet, the shown list is used and kept.
  const p = player(['a', 'b', 'c', 'd', 'x'], seeded(4));
  p.go(-1, list);
  assert.ok(p.state.current && list.includes(p.state.current));
  assert.deepEqual(p.state.context, list);
});

test('picking a sound directly takes it out of the round and remembers the sound being left', () => {
  const state = shuffleJump({ pending: ['b', 'c', 'd'], history: ['x'] }, 'a', 'c');
  assert.deepEqual(state, { pending: ['b', 'd'], history: ['x', 'a'] });
  assert.deepEqual(shuffleJump(state, null, 'b'), { pending: ['d'], history: ['x', 'a'] });
  assert.deepEqual(shuffleJump(state, 'b', 'b').history, ['x', 'a']);
});

test('shuffle history stays bounded', () => {
  let state: ShuffleState = emptyShuffle();
  let current = 'a';
  for (let i = 0; i < 1200; i++) {
    const result = shuffleNext(state, ['a', 'b', 'c'], current, all, seeded(i));
    state = result.shuffle; current = result.id!;
  }
  assert.equal(state.history.length, 500);
});

test('navigate follows list order outside shuffle mode and leaves shuffle state alone', () => {
  const state: ShuffleState = { pending: ['c'], history: ['b'] };
  for (const mode of ['once', 'one', 'list'] as const) {
    assert.deepEqual(navigate(mode, 1, ['a', 'b', 'c'], 'c', all, state), { id: 'a', shuffle: state });
    assert.deepEqual(navigate(mode, -1, ['a', 'b', 'c'], 'a', all, state), { id: 'c', shuffle: state });
  }
  assert.equal(navigate('shuffle', 1, ['a', 'b', 'c'], 'a', all, state).id, 'c');
});

test('a row request starts the sound in the shown list, else in the old context, else without one', () => {
  const state: ShuffleState = { pending: ['c'], history: ['x'] };
  for (const mode of ['once', 'one', 'list'] as const) {
    assert.deepEqual(rowRequest(mode, 'x', 'a', ['a', 'b', 'c'], ['x', 'y'], state), { toggle: false, context: ['x', 'y'], shuffle: state });
    assert.deepEqual(rowRequest(mode, 'b', 'a', ['a', 'b', 'c'], ['x', 'y'], state).context, ['a', 'b', 'c']);
    assert.deepEqual(rowRequest(mode, 'z', 'a', ['a', 'b', 'c'], ['x', 'y'], state).context, []);
  }
  // Shuffle: a sound found only in the old context keeps that context and its round; one found nowhere drops the round.
  const round: ShuffleState = { pending: ['c', 'b'], history: [] };
  assert.deepEqual(rowRequest('shuffle', 'b', 'a', ['a', 'b', 'c'], ['x', 'y'], round), { toggle: false, context: ['a', 'b', 'c'], shuffle: { pending: ['c'], history: ['a'] } });
  assert.deepEqual(rowRequest('shuffle', 'z', 'a', ['a', 'b', 'c'], ['x', 'y'], round), { toggle: false, context: [], shuffle: { pending: [], history: ['a'] } });
});

test('a row request for the current sound only pauses or resumes it', () => {
  const context = ['a', 'b', 'c', 'd'];
  const state: ShuffleState = { pending: ['d', 'c'], history: ['a'] };
  for (const mode of ['once', 'one', 'list', 'shuffle'] as const) {
    const result = rowRequest(mode, 'b', 'b', context, ['x', 'b', 'y'], state);
    assert.equal(result.toggle, true);
    assert.equal(result.context, context);
    assert.equal(result.shuffle, state);
    assert.deepEqual(state, { pending: ['d', 'c'], history: ['a'] });
  }
  // List loop started in one list keeps going there after a pause and resume from another list's row.
  const p = player(['a', 'b', 'c', 'd', 'e'], seeded(1), 'list');
  p.row('a', ['a', 'b']);
  p.row('a', ['a', 'b', 'c', 'd', 'e']); p.row('a', ['a', 'b', 'c', 'd', 'e']);
  for (let i = 0; i < 3; i++) p.go(1, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(p.state.played, ['a', 'b', 'a', 'b']);
});

test('a row pick in a list with sounds the old list lacked starts a fresh shuffle round over that list', () => {
  const groupA = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const superset = [...groupA, 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  const disjoint = ['m1', 'm2', 'm3', 'm4', 'm5'];
  const check = (seed: number, list: string[], choose: (pending: string[]) => string) => {
    const p = player(superset, seeded(seed));
    p.row('a1', groupA); p.go(1, groupA); p.go(1, groupA);
    const { pending, history } = p.state.shuffle; const left = p.state.current!;
    const picked = choose(pending);
    p.row(picked, list);
    assert.deepEqual(p.state.context, list);
    assert.deepEqual(p.state.shuffle, { pending: [], history: [...history, left] });
    const mark = p.state.played.length;
    for (let i = 1; i < list.length; i++) p.go(1, list);
    // Every other sound of the new list once, before anything repeats.
    assert.deepEqual([...p.state.played.slice(mark)].sort(), list.filter(id => id !== picked).sort(), `seed ${seed}, ${picked}`);
  };
  for (let seed = 1; seed <= 50; seed++) {
    check(seed, superset, () => 'm5');
    // A sound the old round had not played yet: the rest of that round is dropped as well.
    check(seed, superset, pending => pending[0]);
    check(seed, disjoint, () => 'm2');
  }
});

test('a row pick among the same sounds in another order keeps the shuffle round', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (let seed = 1; seed <= 20; seed++) {
    const p = player(list, seeded(seed));
    p.row('a', list); p.go(1, list);
    const before = p.state.shuffle; const left = p.state.current!;
    const [first, picked, ...rest] = before.pending;
    p.row(picked, [...list].reverse());
    assert.deepEqual(p.state.shuffle, { pending: [first, ...rest], history: [...before.history, left] });
    assert.deepEqual(p.state.shuffle, shuffleJump(before, left, picked));
    const mark = p.state.played.length;
    for (let i = 0; i <= rest.length; i++) p.go(1, [...list].reverse());
    assert.deepEqual(p.state.played.slice(mark), [first, ...rest], `seed ${seed}`);
  }
});

test('a row pick in the shown list after it lost sounds keeps the rest of the shuffle round', () => {
  // The sound being left is no longer shown: it joins the history, and the round goes on.
  assert.deepEqual(rowRequest('shuffle', 'c', 'b', ['a', 'b', 'c', 'd'], ['a', 'c', 'd'], { pending: ['c', 'd'], history: ['a'] }),
    { toggle: false, context: ['a', 'c', 'd'], shuffle: { pending: ['d'], history: ['a', 'b'] } });
  // A sound of the round that left the shown list leaves the round too.
  assert.deepEqual(rowRequest('shuffle', 'c', 'a', ['a', 'b', 'c', 'd'], ['a', 'c', 'd'], { pending: ['b', 'c', 'd'], history: [] }),
    { toggle: false, context: ['a', 'c', 'd'], shuffle: { pending: ['d'], history: ['a'] } });
});

test('next/previous without a playable context keep the list they fell back to', () => {
  const groupA = ['a', 'b', 'c']; const groupB = ['x', 'y']; const library = [...groupA, ...groupB, 'z'];
  for (const mode of ['once', 'one', 'list'] as const) {
    const first = advance(mode, 1, [], groupA, library, null, all, emptyShuffle());
    assert.deepEqual([first.id, first.context], ['a', groupA]);
    assert.deepEqual(advance(mode, 1, first.context, groupB, library, 'a', all, first.shuffle).context, groupA);
    // With nothing playable shown either, the whole library is used and kept.
    assert.deepEqual(advance(mode, -1, [], ['y'], library, null, except('y'), emptyShuffle()), { id: 'z', context: library, shuffle: emptyShuffle() });
    // A context with playable sounds is kept as it is.
    assert.equal(advance(mode, 1, groupA, ['c', 'b', 'a'], library, 'b', all, emptyShuffle()).context, groupA);
  }
  // When nothing can play at all, nothing starts and the old context stays.
  for (const mode of ['once', 'one', 'list', 'shuffle'] as const) {
    assert.deepEqual(advance(mode, 1, ['a'], ['b'], ['a', 'b'], 'a', () => false, emptyShuffle()), { id: null, context: ['a'], shuffle: emptyShuffle() });
    assert.deepEqual(advance(mode, -1, [], ['b'], ['a', 'b'], null, () => false, emptyShuffle()).context, []);
  }
  // List loop and shuffle started from the bar stay in that list after another list is shown.
  const loop = player(library, seeded(2), 'list');
  loop.go(1, groupA); loop.go(1, groupA);
  for (let i = 0; i < 4; i++) loop.go(1, groupB);
  assert.deepEqual(loop.state.played, ['a', 'b', 'c', 'a', 'b', 'c']);
  for (let seed = 1; seed <= 20; seed++) {
    const shuffling = player(library, seeded(seed));
    shuffling.go(1, groupA);
    for (let i = 0; i < 6; i++) shuffling.go(1, groupB);
    assert.ok(shuffling.state.played.every(id => groupA.includes(id)), shuffling.state.played.join(' '));
    assert.deepEqual([...shuffling.state.played.slice(0, 3)].sort(), groupA, `seed ${seed}`);
  }
});
