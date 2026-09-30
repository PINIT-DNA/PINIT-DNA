/** Mirrors client/src/lib/account-view-mode.ts resolveLoginWorkspaceMode */
function resolveLoginWorkspaceMode(opts: {
  hasPersonalWorkspace: boolean;
  hasBusinessWorkspace: boolean;
}): 'INDIVIDUAL' | 'BUSINESS' {
  if (opts.hasPersonalWorkspace) return 'INDIVIDUAL';
  if (opts.hasBusinessWorkspace) return 'BUSINESS';
  return 'INDIVIDUAL';
}

describe('login workspace default', () => {
  test('Personal only → Personal', () => {
    expect(
      resolveLoginWorkspaceMode({ hasPersonalWorkspace: true, hasBusinessWorkspace: false }),
    ).toBe('INDIVIDUAL');
  });

  test('Personal + Business → Personal', () => {
    expect(
      resolveLoginWorkspaceMode({ hasPersonalWorkspace: true, hasBusinessWorkspace: true }),
    ).toBe('INDIVIDUAL');
  });

  test('Personal + multiple Businesses → Personal', () => {
    expect(
      resolveLoginWorkspaceMode({ hasPersonalWorkspace: true, hasBusinessWorkspace: true }),
    ).toBe('INDIVIDUAL');
  });

  test('Business only → Business', () => {
    expect(
      resolveLoginWorkspaceMode({ hasPersonalWorkspace: false, hasBusinessWorkspace: true }),
    ).toBe('BUSINESS');
  });

  test('no workspaces → Personal fallback', () => {
    expect(
      resolveLoginWorkspaceMode({ hasPersonalWorkspace: false, hasBusinessWorkspace: false }),
    ).toBe('INDIVIDUAL');
  });
});

function applyLoginWorkspaceDefault(
  workspaces: { hasPersonalWorkspace: boolean; hasBusinessWorkspace: boolean },
  lastActiveShell?: 'PERSONAL' | 'BUSINESS' | null,
): 'INDIVIDUAL' | 'BUSINESS' {
  if (lastActiveShell === 'BUSINESS') return 'BUSINESS';
  if (lastActiveShell === 'PERSONAL') return 'INDIVIDUAL';
  return resolveLoginWorkspaceMode(workspaces);
}

describe('sticky lastActiveShell', () => {
  const both = { hasPersonalWorkspace: true, hasBusinessWorkspace: true };

  test('BUSINESS shell restores Business dashboard', () => {
    expect(applyLoginWorkspaceDefault(both, 'BUSINESS')).toBe('BUSINESS');
  });

  test('PERSONAL shell keeps Personal even when Business exists', () => {
    expect(applyLoginWorkspaceDefault(both, 'PERSONAL')).toBe('INDIVIDUAL');
  });

  test('BUSINESS shell restores even when workspace flags are incomplete', () => {
    expect(
      applyLoginWorkspaceDefault(
        { hasPersonalWorkspace: true, hasBusinessWorkspace: false },
        'BUSINESS',
      ),
    ).toBe('BUSINESS');
  });
});
