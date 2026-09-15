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
