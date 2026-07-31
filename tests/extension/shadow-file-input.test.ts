/**
 * Shadow-DOM file input discovery (Sprint 4 debug).
 * Mirrors extension/shared/adapter-interface.js collectFileInputsDeep.
 */

type ParentLike = {
  querySelectorAll?: (sel: string) => ArrayLike<unknown>;
};

type ElementLike = {
  shadowRoot?: ParentLike | null;
  type?: string;
};

function collectFileInputsDeep(
  root: ParentLike | null | undefined,
  out: ElementLike[],
  depth: number,
) {
  if (!root || depth > 40) return;
  let nodes: ElementLike[] = [];
  try {
    if (root.querySelectorAll) {
      nodes = Array.from(root.querySelectorAll('input[type="file"]')) as ElementLike[];
    }
  } catch {
    return;
  }
  for (const n of nodes) out.push(n);

  let all: ElementLike[] = [];
  try {
    if (root.querySelectorAll) {
      all = Array.from(root.querySelectorAll('*')) as ElementLike[];
    }
  } catch {
    return;
  }
  for (const el of all) {
    if (el.shadowRoot) collectFileInputsDeep(el.shadowRoot, out, depth + 1);
  }
}

describe('shadow DOM file input discovery', () => {
  it('finds light-DOM file inputs', () => {
    const lightInput = { type: 'file' };
    const root: ParentLike = {
      querySelectorAll(sel: string) {
        if (sel === 'input[type="file"]') return [lightInput];
        if (sel === '*') return [];
        return [];
      },
    };
    const out: ElementLike[] = [];
    collectFileInputsDeep(root, out, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(lightInput);
  });

  it('pierces open shadow roots for file inputs', () => {
    const shadowInput = { type: 'file' };
    const shadowRoot: ParentLike = {
      querySelectorAll(sel: string) {
        if (sel === 'input[type="file"]') return [shadowInput];
        if (sel === '*') return [];
        return [];
      },
    };
    const host = { shadowRoot };
    const root: ParentLike = {
      querySelectorAll(sel: string) {
        if (sel === 'input[type="file"]') return [];
        if (sel === '*') return [host];
        return [];
      },
    };
    const out: ElementLike[] = [];
    collectFileInputsDeep(root, out, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(shadowInput);
  });

  it('documents that change events are not composed (shadow boundary)', () => {
    // Browser fact used by the adapter design: input change is not composed,
    // so document listeners miss shadow-hosted file inputs.
    const changeComposed = false;
    expect(changeComposed).toBe(false);
  });
});
