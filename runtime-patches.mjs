const RUNTIME_SELECTOR_HINTS = ['.ha-business-role'];

export function isRuntimeOnlySelector(selector = '') {
  return RUNTIME_SELECTOR_HINTS.some(hint => String(selector).includes(hint));
}

export function removeRuntimeOnlyPatches(state = {}) {
  const patches = state.patches || {};
  const kept = Object.fromEntries(Object.entries(patches).filter(([, patch]) => !isRuntimeOnlySelector(patch?.selector)));
  return { ...state, patches: kept };
}
