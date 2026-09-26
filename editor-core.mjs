const clone = value => JSON.parse(JSON.stringify(value));

export function createEditorState(saved = {}) {
  const patches = clone(saved.patches || {});
  Object.values(patches).forEach(patch => {
    // Earlier cross-container moves accidentally copied the editor selection halo.
    // Match only that exact shadow, leaving user-created shadows untouched.
    if (/^(?:rgba\(45,\s*121,\s*230,\s*0\.133333\)|#2d79e622) 0px 0px 0px 5px$/.test(patch.styles?.boxShadow || '')) {
      delete patch.styles.boxShadow;
    }
    if (patch.hidden === true) patch.deleted = true;
    delete patch.hidden;
  });
  return {
    version: 1,
    patches,
    past: [],
    future: [],
  };
}

export function upsertElementPatch(state, elementId, change) {
  if (!elementId) return state;

  const current = state.patches[elementId] || {};
  const nextPatch = {
    ...current,
    ...change,
    styles: {
      ...(current.styles || {}),
      ...(change.styles || {}),
    },
  };

  if (change.textNodes) nextPatch.textNodes = { ...(current.textNodes || {}), ...change.textNodes };
  if (change.attributes) nextPatch.attributes = { ...(current.attributes || {}), ...change.attributes };
  if (!Object.keys(nextPatch.styles).length) delete nextPatch.styles;
  if (JSON.stringify(current) === JSON.stringify(nextPatch)) return state;

  return {
    ...state,
    patches: { ...state.patches, [elementId]: nextPatch },
    past: [...state.past, clone(state.patches)],
    future: [],
  };
}

export function deleteElement(state, elementId, selector) {
  if (!elementId || !selector) return state;
  return {
    ...state,
    patches: {
      ...state.patches,
      [elementId]: { ...(state.patches[elementId]?.insert ? { insert:state.patches[elementId].insert } : {}), selector, deleted: true },
    },
    past: [...state.past, clone(state.patches)],
    future: [],
  };
}

export function moveElementPatch(state, elementId, selector, parentSelector, index) {
  if (!elementId || !selector || !parentSelector || !Number.isInteger(index) || index < 0) return state;
  return upsertElementPatch(state, elementId, {
    selector,
    position: { parent: parentSelector, index },
  });
}

export function undoState(state) {
  if (!state.past.length) return state;
  const previous = state.past[state.past.length - 1];
  return {
    ...state,
    patches: clone(previous),
    past: state.past.slice(0, -1),
    future: [clone(state.patches), ...state.future],
  };
}

export function redoState(state) {
  if (!state.future.length) return state;
  const [next, ...remaining] = state.future;
  return {
    ...state,
    patches: clone(next),
    past: [...state.past, clone(state.patches)],
    future: remaining,
  };
}

export function serializeEditorState(state) {
  return JSON.stringify({ version: 1, patches: state.patches }, null, 2);
}

// One user action (card form, batch styles or format paste) = one undo step.
export function batchElementChanges(state, changes) {
  let next = state;
  for (const [key, change] of changes) next = upsertElementPatch(next, key, change);
  return next === state ? state : { ...next, past:[...state.past, clone(state.patches)], future:[] };
}
