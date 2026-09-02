import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Plus, Store, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../ui/utils';
import { useAuth } from '../../context/AuthContext';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';
import { useOrganization } from '../../hooks/useOrganization';
import { useOrganizationWorkspaces } from '../../hooks/useOrganizationWorkspaces';
import { openHubExchange } from '../../lib/open-exchange';
import { openMasterAdmin } from '../../lib/open-master-admin';
import { isPlatformOwnerShortId } from '../../lib/platform-owner';
import { getActiveWorkspaceId, setActiveWorkspaceId } from '../../lib/workspace-preference';
import { useUserProfile } from '../../hooks/useUserProfile';

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { mode, switching, switchTo, isBusinessShell, hasBusinessAccess } = useAccountViewMode();
  const { organization } = useOrganization(hasBusinessAccess);
  const { workspaces, loading: wsLoading, create } = useOrganizationWorkspaces(hasBusinessAccess);
  const [open, setOpen] = useState(false);
  const [openingExchange, setOpeningExchange] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => getActiveWorkspaceId(user?.sub));
  const ref = useRef<HTMLDivElement>(null);
  const shortId = profile?.shortId ?? (user as { shortId?: string } | null)?.shortId;
  const showAdmin = isPlatformOwnerShortId(shortId);

  useEffect(() => {
    setWorkspaceId(getActiveWorkspaceId(user?.sub));
  }, [user?.sub, workspaces]);

  useEffect(() => {
    if (!hasBusinessAccess || !workspaces.length || !user?.sub) return;
    const saved = getActiveWorkspaceId(user.sub);
    if (saved && workspaces.some((w) => w.id === saved)) return;
    const fallback = workspaces.find((w) => w.isDefault) ?? workspaces[0];
    if (fallback) setActiveWorkspaceId(user.sub, fallback.id);
    setWorkspaceId(fallback?.id ?? null);
  }, [hasBusinessAccess, workspaces, user?.sub]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? workspaces.find((w) => w.isDefault) ?? workspaces[0],
    [workspaces, workspaceId],
  );

  const label = isBusinessShell
    ? (activeWorkspace?.name || organization?.name || 'Business')
    : 'Personal';
  const sublabel = isBusinessShell ? 'Business workspace' : 'Your protected files';

  const goPersonal = async () => {
    setOpen(false);
    await switchTo('INDIVIDUAL');
  };

  const goBusiness = async (id?: string) => {
    setOpen(false);
    if (user?.sub && id) {
      setActiveWorkspaceId(user.sub, id);
      setWorkspaceId(id);
    }
    await switchTo('BUSINESS');
  };

  const openExchange = async () => {
    if (openingExchange) return;
    setOpeningExchange(true);
    try {
      const { pinitId } = await openHubExchange();
      toast.success(`Opening Exchange as ${pinitId}`);
      setOpen(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err instanceof Error ? err.message : 'Could not open Exchange');
      toast.error(msg);
    } finally {
      setOpeningExchange(false);
    }
  };

  const createWorkspace = async () => {
    if (creating) return;
    if (!hasBusinessAccess) {
      setOpen(false);
      await switchTo('BUSINESS');
      return;
    }
    const name = window.prompt('Name this business workspace');
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const created = await create(name.trim());
      if (created?.id && user?.sub) {
        setActiveWorkspaceId(user.sub, created.id);
        setWorkspaceId(created.id);
      }
      await switchTo('BUSINESS');
      toast.success('Workspace created');
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create workspace');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={ref} className={cn('relative min-w-0', compact ? 'max-w-[11rem] sm:max-w-[14rem]' : 'w-full')}>
      <button
        type="button"
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch workspace. Current: ${label}`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 w-full rounded-xl border border-bg-border bg-bg-card px-2.5 py-1.5 text-left',
          'hover:border-dna-400/50 hover:bg-bg-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
          open && 'border-dna-400 ring-2 ring-dna-500/20',
        )}
      >
        <span className="w-7 h-7 rounded-lg bg-dna-500/10 text-dna-600 flex items-center justify-center shrink-0">
          {isBusinessShell ? <Building2 size={14} /> : <User size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-slate-900 truncate">{label}</span>
          {!compact && (
            <span className="block text-2xs text-slate-500 truncate">{sublabel}</span>
          )}
        </span>
        <ChevronDown size={14} className={cn('text-slate-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1.5 z-[1200] rounded-xl border border-bg-border bg-bg-card shadow-lg p-1.5 min-w-[16rem]"
          role="listbox"
          aria-label="Switch workspace"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-2xs font-bold uppercase tracking-wider text-slate-400">
            Switch workspace
          </p>
          <p className="px-2.5 pt-1 pb-1 text-2xs font-bold uppercase tracking-wider text-slate-400">
            Personal
          </p>
          <SwitcherRow
            icon={<User size={14} />}
            title="Personal"
            subtitle="Your protected files"
            active={mode === 'INDIVIDUAL'}
            onClick={() => void goPersonal()}
          />
          {hasBusinessAccess && (
            <>
              <p className="px-2.5 pt-2 pb-1 text-2xs font-bold uppercase tracking-wider text-slate-400">
                Business
              </p>
              {wsLoading && (
                <p className="px-2.5 py-2 text-xs text-slate-500">Loading workspaces…</p>
              )}
              {workspaces.map((ws) => (
                <SwitcherRow
                  key={ws.id}
                  icon={<Building2 size={14} />}
                  title={ws.name}
                  subtitle="Creative workspace"
                  active={isBusinessShell && activeWorkspace?.id === ws.id}
                  onClick={() => void goBusiness(ws.id)}
                />
              ))}
              {!wsLoading && workspaces.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-slate-500">No business workspace yet</p>
              )}
            </>
          )}

          <div className="my-1.5 border-t border-bg-border" />
          <p className="px-2.5 pt-1 pb-1 text-2xs font-bold uppercase tracking-wider text-slate-400">
            Products
          </p>
          <SwitcherRow
            icon={<Store size={14} />}
            title="Pinit Exchange"
            subtitle={openingExchange ? 'Opening…' : 'Buy & sell creative work'}
            active={false}
            disabled={openingExchange}
            onClick={() => void openExchange()}
          />
          {showAdmin && (
            <SwitcherRow
              icon={<Store size={14} />}
              title="Master Admin"
              subtitle="Platform console"
              active={false}
              onClick={() => { setOpen(false); void openMasterAdmin().catch((e) => toast.error(String(e))); }}
            />
          )}

          <div className="my-1.5 border-t border-bg-border" />
          <button
            type="button"
            disabled={creating || switching}
            onClick={() => void createWorkspace()}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-dna-600 hover:bg-dna-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500"
            aria-busy={creating || switching}
          >
            <Plus size={14} />
            {hasBusinessAccess ? 'Create business workspace' : 'Enable business workspace'}
          </button>
        </div>
      )}
    </div>
  );
}

function SwitcherRow({
  icon, title, subtitle, active, disabled, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        active ? 'bg-dna-50 text-dna-800' : 'hover:bg-bg-elevated text-slate-800',
      )}
    >
      <span className={cn('mt-0.5', active ? 'text-dna-600' : 'text-slate-400')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold truncate">{title}</span>
        <span className="block text-2xs text-slate-500 truncate">{subtitle}</span>
      </span>
      {active && <Check size={14} className="text-dna-600 mt-0.5 shrink-0" />}
    </button>
  );
}
