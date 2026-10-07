/**
 * Profile tab: personal details, links and identity proof, with a live
 * profile-strength rail. The score shown here is computed with the same
 * module the server uses (lib/profile-strength.ts), so it matches what is
 * saved and what the avatar dropdown shows.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Globe, Link, Plus, RefreshCw, Save, Trash2, Undo2, User } from 'lucide-react';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { notifyProfileUpdated } from '../../hooks/useUserProfile';
import { GovernmentIdSettings } from '../../components/settings/GovernmentIdSettings';
import { GithubIcon, InstagramIcon, LinkedinIcon } from '../../components/icons/BrandIcons';
import { ProfileCompletionCard } from '../../components/profile/ProfileCompletionCard';
import { ProfilePhotoPicker } from './ProfilePhotoPicker';
import {
  cleanExtraUrl,
  cleanLinkInput,
  computeProfileStrength,
  emptySocialLinks,
  isValidExtraUrl,
  isValidLink,
  LINK_KEYS,
  LINK_RULES,
  MAX_EXTRA_LINKS,
  MIN_BIO_LENGTH,
  STRENGTH_ITEMS,
  type LinkKey,
  type SocialLinks,
  type StrengthItemId,
} from '../../lib/profile-strength';

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  organization: string;
  jobTitle: string;
  bio: string;
};

const FIELD_IDS: Partial<Record<StrengthItemId, string>> = {
  name: 'pf-fullName',
  email: 'pf-email',
  phone: 'pf-phone',
  country: 'pf-country',
  organization: 'pf-organization',
  jobTitle: 'pf-jobTitle',
  bio: 'pf-bio',
  linkedin: 'pf-link-linkedin',
  github: 'pf-link-github',
  instagram: 'pf-link-instagram',
  website: 'pf-link-website',
};

const LINK_ICON: Record<LinkKey, { icon: React.ReactNode; tile: string; hint: string }> = {
  linkedin: { icon: <LinkedinIcon size={17} />, tile: 'bg-[#0a66c2]/10 text-[#0a66c2] dark:bg-[#0a66c2]/20 dark:text-[#70b5f9]', hint: 'Professional profile' },
  github: { icon: <GithubIcon size={17} />, tile: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-gray-200', hint: 'Code and open source' },
  instagram: { icon: <InstagramIcon size={17} />, tile: 'bg-[#e1306c]/10 text-[#c13584] dark:bg-[#e1306c]/20 dark:text-[#f58fb5]', hint: 'Creative work and behind the scenes' },
  website: { icon: <Globe size={17} />, tile: 'bg-dna-50 text-dna-600 dark:bg-dna-500/15 dark:text-dna-400', hint: 'Your own site' },
};

const WEIGHT = Object.fromEntries(STRENGTH_ITEMS.map((i) => [i.id, i.weight])) as Record<StrengthItemId, number>;

function formFrom(profile: any): FormState {
  return {
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    country: profile?.country ?? '',
    organization: profile?.organization ?? '',
    jobTitle: profile?.jobTitle ?? '',
    bio: profile?.bio ?? '',
  };
}

function linksFrom(profile: any): SocialLinks {
  const s = profile?.socialLinks;
  if (!s || typeof s !== 'object') return emptySocialLinks();
  return {
    ...emptySocialLinks(),
    ...s,
    skipped: Array.isArray(s.skipped) ? s.skipped : [],
    extra: Array.isArray(s.extra) ? s.extra : [],
  };
}

const snapshot = (form: FormState, links: SocialLinks) => JSON.stringify({ form, links });

export function ProfileDetailsTab({
  profile,
  onUpdate,
}: {
  profile: any;
  onUpdate: (p: any) => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFrom(profile));
  const [links, setLinks] = useState<SocialLinks>(() => linksFrom(profile));
  const baseline = useRef(snapshot(formFrom(profile), linksFrom(profile)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const dirty = snapshot(form, links) !== baseline.current;

  // A reload (after a photo or identity change) refreshes the form unless the
  // user is in the middle of editing it.
  useEffect(() => {
    if (dirty) return;
    const f = formFrom(profile);
    const l = linksFrom(profile);
    baseline.current = snapshot(f, l);
    setForm(f);
    setLinks(l);
  }, [profile]);

  const strength = useMemo(() => computeProfileStrength({
    ...form,
    hasPhoto: Boolean(profile?.avatarUrl),
    portfolioPublished: Boolean(profile?.portfolioPublished),
    identityOnFile: Boolean(profile?.identityOnFile),
    links,
  }), [form, links, profile?.avatarUrl, profile?.portfolioPublished, profile?.identityOnFile]);

  const done = useMemo(() => new Set(strength.items.filter((i) => i.done).map((i) => i.id)), [strength]);

  const linkError = (key: LinkKey): string => {
    const v = cleanLinkInput(key, links[key]);
    if (!v || links.skipped.includes(key)) return '';
    return isValidLink(key, v) ? '' : LINK_RULES[key].error;
  };
  const extraError = (i: number): string => {
    const row = links.extra[i];
    if (!row) return '';
    const url = cleanExtraUrl(row.url);
    if (!url) return '';
    return isValidExtraUrl(url) ? '' : 'Enter a link like https://example.com';
  };
  const hasErrors = LINK_KEYS.some((k) => linkError(k)) || links.extra.some((_, i) => extraError(i));

  const set = (k: keyof FormState) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); setSaveError(''); };
  const setLink = (k: LinkKey, v: string) => setLinks((l) => ({ ...l, [k]: v }));
  const toggleSkip = (k: LinkKey) => setLinks((l) => ({
    ...l,
    [k]: l.skipped.includes(k) ? l[k] : '',
    skipped: l.skipped.includes(k) ? l.skipped.filter((x) => x !== k) : [...l.skipped, k],
  }));

  const discard = () => {
    const parsed = JSON.parse(baseline.current) as { form: FormState; links: SocialLinks };
    setForm(parsed.form);
    setLinks(parsed.links);
    setSaveError('');
    setTouched({});
  };

  const handleSave = async () => {
    if (hasErrors) {
      setSaveError('Fix the highlighted links before saving.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const cleaned: SocialLinks = {
      ...links,
      linkedin: cleanLinkInput('linkedin', links.linkedin),
      github: cleanLinkInput('github', links.github),
      instagram: cleanLinkInput('instagram', links.instagram),
      website: cleanLinkInput('website', links.website),
      extra: links.extra
        .map((r) => ({ label: r.label.trim(), url: cleanExtraUrl(r.url) }))
        .filter((r) => r.label || r.url),
    };
    try {
      const { data } = await api.put(`${API_BASE_URL}/profile`, { ...form, socialLinks: cleaned });
      const saved = (data as any).profile ?? {};
      baseline.current = snapshot(form, linksFrom(saved));
      setLinks(linksFrom(saved));
      onUpdate({ ...profile, ...saved });
      notifyProfileUpdated();
      setTouched({});
      toast.success('Profile saved');
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <aside className="lg:sticky lg:top-4 lg:order-2">
        <ProfileCompletionCard strength={strength} place="profile" />
      </aside>
      <div className="space-y-4 min-w-0 lg:order-1">
        {/* ── Personal information ───────────────────────────────────── */}
        <section className="card space-y-5" aria-labelledby="pf-personal-h">
          <h2 id="pf-personal-h" className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <User size={15} className="text-dna-600 dark:text-dna-400" /> Personal information
          </h2>

          {/* .pe supplies the picker's colour tokens (light and dark); without it the circle and pencil render invisible. */}
          <div id="pf-photo" className="pe scroll-mt-24">
            <ProfilePhotoPicker
              compact
              photoUrl={profile?.avatarUrl || ''}
              name={form.fullName || profile?.fullName || ''}
              onChange={(url) => { onUpdate({ ...profile, avatarUrl: url || null }); notifyProfileUpdated(); }}
            />
          </div>

          <FieldGroup title="Identity">
            <TextField id="pf-fullName" label="Full name" required missing={!done.has('name')} value={form.fullName} onChange={set('fullName')} placeholder="Your full name" autoComplete="name" />
            <TextField id="pf-shortId" label="PINIT ID" value={profile?.shortId ?? ''} disabled hint="Your permanent account ID. It can't be changed." />
          </FieldGroup>

          <FieldGroup title="Contact">
            <TextField id="pf-email" label="Email" type="email" required missing={!done.has('email')} value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" wide />
            <TextField id="pf-phone" label="Phone" type="tel" required missing={!done.has('phone')} value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" autoComplete="tel" />
            <TextField id="pf-country" label="Country" required missing={!done.has('country')} value={form.country} onChange={set('country')} placeholder="India" autoComplete="country-name" />
          </FieldGroup>

          <FieldGroup title="Work">
            <TextField id="pf-organization" label="Organization" missing={!done.has('organization')} gain={WEIGHT.organization} value={form.organization} onChange={set('organization')} placeholder="Company name" autoComplete="organization" />
            <TextField id="pf-jobTitle" label="Job title" missing={!done.has('jobTitle')} gain={WEIGHT.jobTitle} value={form.jobTitle} onChange={set('jobTitle')} placeholder="Software Engineer" autoComplete="organization-title" />
          </FieldGroup>

          <FieldGroup title="About">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="pf-bio" label="Bio" missing={!done.has('bio')} gain={WEIGHT.bio} />
              <textarea
                id="pf-bio"
                value={form.bio}
                onChange={(e) => set('bio')(e.target.value)}
                maxLength={600}
                className="w-full px-3 py-2 bg-bg-elevated border border-bg-border rounded-lg text-xs text-slate-900 dark:text-white resize-y min-h-[84px] focus:outline-none focus:border-dna-500 scroll-mt-24"
                placeholder="Two or three sentences about what you do."
              />
              <p className={`text-2xs mt-1 tabular-nums ${done.has('bio') ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-gray-400'}`}>
                {done.has('bio')
                  ? 'Counts toward your profile'
                  : `${Math.max(0, MIN_BIO_LENGTH - form.bio.trim().length)} more characters to count toward your profile`}
              </p>
            </div>
          </FieldGroup>
        </section>

        {/* ── Links ──────────────────────────────────────────────────── */}
        <section id="pf-links" className="card space-y-4 scroll-mt-24" aria-labelledby="pf-links-h">
          <div>
            <h2 id="pf-links-h" className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Link size={15} className="text-dna-600 dark:text-dna-400" /> Social and professional links
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
              Paste the full link.
            </p>
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-bg-border">
            {LINK_KEYS.map((key) => {
              const rule = LINK_RULES[key];
              const skipped = links.skipped.includes(key);
              const err = touched[key] ? linkError(key) : '';
              const ok = done.has(key) && !skipped;
              return (
                <li key={key} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${LINK_ICON[key].tile}`}>{LINK_ICON[key].icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label htmlFor={FIELD_IDS[key]} className="text-xs font-semibold text-slate-900 dark:text-white">{rule.name}</label>
                        <span className="text-2xs text-slate-500 dark:text-gray-400">{LINK_ICON[key].hint}</span>
                        <span className="flex-1" />
                        {ok && <span className="text-2xs font-semibold text-emerald-700 dark:text-emerald-300">Added</span>}
                        {skipped && <span className="text-2xs font-semibold text-slate-500 dark:text-gray-400">Not used</span>}
                        {!done.has(key) && <span className="text-2xs font-semibold text-slate-400 dark:text-gray-500 tabular-nums">+{WEIGHT[key]}%</span>}
                      </div>
                      {skipped ? (
                        <p className="text-xs text-slate-500 dark:text-gray-400 mt-1.5">
                          You said you don't use {rule.name}.{' '}
                          <button type="button" onClick={() => toggleSkip(key)} className="inline-flex items-center gap-1 font-medium text-dna-600 dark:text-dna-400">
                            <Undo2 size={12} /> Add it instead
                          </button>
                        </p>
                      ) : (
                        <>
                          <input
                            id={FIELD_IDS[key]}
                            type="url"
                            inputMode="url"
                            value={links[key]}
                            onChange={(e) => setLink(key, e.target.value)}
                            onBlur={() => { setLink(key, cleanLinkInput(key, links[key])); setTouched((t) => ({ ...t, [key]: true })); }}
                            placeholder={rule.placeholder}
                            aria-invalid={Boolean(err)}
                            aria-describedby={err ? `${FIELD_IDS[key]}-err` : undefined}
                            autoCapitalize="off"
                            spellCheck={false}
                            className={`mt-1.5 w-full px-3 py-2 bg-bg-elevated border rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-dna-500 scroll-mt-24 ${err ? 'border-red-400' : 'border-bg-border'}`}
                          />
                          <div className="flex items-center gap-3 mt-1">
                            {err
                              ? <p id={`${FIELD_IDS[key]}-err`} role="alert" className="text-2xs text-red-600 dark:text-red-400">{err}</p>
                              : <span />}
                            {!links[key].trim() && (
                              <button type="button" onClick={() => toggleSkip(key)} className="ml-auto text-2xs font-medium text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-white">
                                I don't have one
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="pt-1 border-t border-slate-100 dark:border-bg-border">
            <p className="text-xs font-semibold text-slate-900 dark:text-white mt-3">Other links</p>
            <div className="space-y-2">
              {links.extra.map((row, i) => {
                const err = touched[`extra-${i}`] ? extraError(i) : '';
                return (
                  <div key={i}>
                    <div className="flex gap-2 items-center">
                      <input
                        aria-label={`Link ${i + 1}`}
                        type="url"
                        inputMode="url"
                        value={row.url}
                        onChange={(e) => setLinks((l) => ({ ...l, extra: l.extra.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)) }))}
                        onBlur={() => {
                          setLinks((l) => ({ ...l, extra: l.extra.map((r, j) => (j === i ? { ...r, url: cleanExtraUrl(r.url) } : r)) }));
                          setTouched((t) => ({ ...t, [`extra-${i}`]: true }));
                        }}
                        placeholder="https://example.com"
                        autoCapitalize="off"
                        spellCheck={false}
                        aria-invalid={Boolean(err)}
                        className={`flex-1 min-w-0 px-3 py-2 bg-bg-elevated border rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-dna-500 ${err ? 'border-red-400' : 'border-bg-border'}`}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${row.label || 'link'}`}
                        onClick={() => setLinks((l) => ({ ...l, extra: l.extra.filter((_, j) => j !== i) }))}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {err && <p role="alert" className="text-2xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
                  </div>
                );
              })}
            </div>
            {links.extra.length < MAX_EXTRA_LINKS && (
              <button
                type="button"
                onClick={() => setLinks((l) => ({ ...l, extra: [...l.extra, { label: '', url: '' }] }))}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-dna-600 dark:text-dna-400"
              >
                <Plus size={13} /> Add another link
              </button>
            )}
          </div>
        </section>

        {/* ── Identity verification ──────────────────────────────────── */}
        <section id="pf-identity" className="card scroll-mt-24">
          <GovernmentIdSettings variant="profile" onSaved={notifyProfileUpdated} />
        </section>

        {/* ── Save bar ───────────────────────────────────────────────── */}
        {(dirty || saveError) && (
          <div className="sticky bottom-3 z-20 card !p-3 flex items-center gap-3 flex-wrap shadow-lg">
            <p className="text-xs text-slate-700 dark:text-gray-300 flex-1 min-w-[10rem]">
              {saveError
                ? <span role="alert" className="text-red-600 dark:text-red-400">{saveError}</span>
                : 'You have unsaved changes'}
            </p>
            <button type="button" onClick={discard} disabled={saving} className="btn btn-secondary btn-sm text-xs">Discard</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="btn btn-primary btn-sm text-xs">
              {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-2">{title}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </fieldset>
  );
}

function FieldLabel({ htmlFor, label, required, missing, gain }: {
  htmlFor: string; label: string; required?: boolean; missing?: boolean; gain?: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <label htmlFor={htmlFor} className="text-2xs text-slate-600 dark:text-gray-400 font-medium">{label}</label>
      {required && missing && <span className="text-2xs font-semibold text-amber-700 dark:text-amber-300">Required</span>}
      {!required && missing && gain ? <span className="ml-auto text-2xs font-semibold text-slate-400 dark:text-gray-500 tabular-nums">+{gain}%</span> : null}
    </div>
  );
}

function TextField({
  id, label, value, onChange, disabled, placeholder, type, required, missing, gain, hint, wide, autoComplete,
}: {
  id: string; label: string; value: string; onChange?: (v: string) => void; disabled?: boolean;
  placeholder?: string; type?: string; required?: boolean; missing?: boolean; gain?: number;
  hint?: string; wide?: boolean; autoComplete?: string;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <FieldLabel htmlFor={id} label={label} required={required} missing={missing} gain={gain} />
      <input
        id={id}
        type={type ?? 'text'}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        className={`w-full px-3 py-2 bg-bg-elevated border rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-dna-500 scroll-mt-24 ${
          required && missing ? 'border-amber-300 dark:border-amber-500/40' : 'border-bg-border'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      />
      {hint && <p className="text-2xs text-slate-500 dark:text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
