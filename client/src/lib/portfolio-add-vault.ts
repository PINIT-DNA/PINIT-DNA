export type PortfolioWorkCollection = {
  id: string;
  title: string;
  category: string;
  year: string;
  description: string;
  vault_ids: string[];
};

export function planAddVaultToPortfolio(
  groups: PortfolioWorkCollection[],
  vaultId: string,
  fallbackTitle: string,
  newId: () => string,
): {
  groups: PortfolioWorkCollection[];
  collectionId: string | null;
  already: boolean;
  needsCollectionChoice: boolean;
  added: boolean;
} {
  const id = String(vaultId || '').trim();
  if (!id) {
    return { groups, collectionId: null, already: false, needsCollectionChoice: false, added: false };
  }
  const existing = groups.find((c) => c.vault_ids.includes(id));
  if (existing) {
    return {
      groups,
      collectionId: existing.id,
      already: true,
      needsCollectionChoice: false,
      added: false,
    };
  }
  if (groups.length === 0) {
    const created: PortfolioWorkCollection = {
      id: newId(),
      title: fallbackTitle || 'Work',
      category: '',
      year: '',
      description: '',
      vault_ids: [id],
    };
    return {
      groups: [created],
      collectionId: created.id,
      already: false,
      needsCollectionChoice: false,
      added: true,
    };
  }
  if (groups.length === 1) {
    const only = groups[0];
    const updated = { ...only, vault_ids: [...only.vault_ids, id] };
    return {
      groups: [updated],
      collectionId: updated.id,
      already: false,
      needsCollectionChoice: false,
      added: true,
    };
  }
  return {
    groups,
    collectionId: null,
    already: false,
    needsCollectionChoice: true,
    added: false,
  };
}

export function addVaultToNamedCollection(
  groups: PortfolioWorkCollection[],
  collectionId: string,
  vaultId: string,
): { groups: PortfolioWorkCollection[]; already: boolean } {
  const id = String(vaultId || '').trim();
  const col = groups.find((c) => c.id === collectionId);
  if (!id || !col) return { groups, already: false };
  if (col.vault_ids.includes(id)) return { groups, already: true };
  return {
    groups: groups.map((c) => (c.id === collectionId ? { ...c, vault_ids: [...c.vault_ids, id] } : c)),
    already: false,
  };
}
