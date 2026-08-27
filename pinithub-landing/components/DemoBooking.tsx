'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Mail,
  MapPin,
  Timer,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import {
  DEMO_COUNTRIES as COUNTRIES,
  DEMO_INDUSTRIES as INDUSTRIES,
  DEMO_SIZES as SIZES,
  DEMO_TIMES as TIMES,
} from '@/lib/defaults';
import { MagneticButton } from './ui/MagneticButton';
import { Reveal } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

type Fields = {
  name: string; email: string; company: string; phone: string; title: string;
  country: string; size: string; industry: string;
  date: string; time: string; message: string; consent: boolean;
};

const EMPTY: Fields = {
  name: '', email: '', company: '', phone: '', title: '',
  country: '', size: '', industry: '',
  date: '', time: '', message: '', consent: false,
};

const STEPS = [
  { label: 'About you', keys: ['name', 'email', 'company', 'phone', 'title'] },
  { label: 'Organization', keys: ['country', 'size', 'industry'] },
  { label: 'Schedule', keys: ['date', 'time', 'consent'] },
] as const;

/* ------------------------------ section ------------------------------ */

export function DemoBooking({
  section,
  settings,
  enabled,
}: {
  section: SectionChrome;
  settings: SiteContent['settings'];
  enabled: boolean;
}) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const validate = (keys: readonly string[]) => {
    const next: Partial<Record<keyof Fields, string>> = {};
    for (const k of keys as (keyof Fields)[]) {
      const v = values[k];
      if (k === 'consent') {
        if (!v) next.consent = 'Please accept the Privacy Policy to continue.';
      } else if (k === 'phone') {
        if (String(v).trim() && !/^[+\d][\d\s()-]{6,}$/.test(String(v).trim()))
          next.phone = 'Enter a valid phone number.';
      } else if (!String(v).trim()) {
        next[k] = 'This field is required.';
      } else if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v))) {
        next.email = 'Enter a valid business email.';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const next = () => {
    if (validate(STEPS[step].keys)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate(STEPS[2].keys) || pending) return;

    setPending(true);
    setFormError('');

    try {
      const response = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        // The server validates the same fields; surface them on the step that owns them.
        if (result?.fields) {
          setErrors(result.fields);
          const firstBadStep = STEPS.findIndex((s) =>
            (s.keys as readonly string[]).some((k) => k in result.fields),
          );
          if (firstBadStep >= 0) setStep(firstBadStep);
        }
        setFormError(result?.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setSubmitted(true);
    } catch {
      setFormError('We could not reach the server. Please check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  // The admin can close bookings without removing the section from the page.
  if (!enabled) {
    return (
      <section id="demo" className="relative scroll-mt-24 overflow-hidden section-pad">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-ink-2" />
          <div className="lattice absolute inset-0 opacity-35" />
        </div>
        <div className="shell">
          <SectionHeading
            index={section.index}
            label={section.label}
            title={section.title}
            lede={section.lede}
            align="center"
          />
          <Reveal delay={0.1}>
            <div className="panel mx-auto mt-14 max-w-xl p-10 text-center">
              <p className="text-[0.9375rem] leading-relaxed text-mute">
                Online booking is paused at the moment. Email us at{' '}
                <a
                  href={`mailto:${settings.supportEmail}`}
                  className="text-cyan underline-offset-4 hover:underline"
                >
                  {settings.supportEmail}
                </a>{' '}
                and we will arrange a session directly.
              </p>
            </div>
          </Reveal>
        </div>
      </section>
    );
  }

  return (
    <section id="demo" className="relative scroll-mt-24 overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="lattice absolute inset-0 opacity-35" />
        <div className="aura top-[10%] right-[-6%] h-[32rem] w-[32rem] bg-violet/14" />
        <div className="aura bottom-[4%] left-[-8%] h-[28rem] w-[28rem] bg-cyan/10" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
        />

        <div className="mt-14 grid gap-6 lg:mt-20 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)] lg:gap-8">
          {/* ------------------------- Form ------------------------- */}
          <Reveal>
            <div className="panel grain relative overflow-hidden p-5 sm:p-10">
              <span aria-hidden className="pin-cross top-5 left-5" />

              <AnimatePresence mode="wait">
                {submitted ? (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="flex min-h-[30rem] flex-col items-center justify-center text-center"
                    role="status"
                  >
                    <span className="relative grid h-20 w-20 place-items-center rounded-full border border-signal/40 bg-signal/10">
                      <span className="anim-breathe absolute -inset-3 rounded-full bg-signal/20 blur-xl" />
                      <Check className="relative h-8 w-8 text-signal" strokeWidth={2.2} />
                    </span>
                    <h3 className="mt-8 font-display text-2xl font-semibold text-paper">
                      Your demo is reserved
                    </h3>
                    <p className="mt-4 max-w-md text-[0.9375rem] leading-relaxed text-mute-2">
                      Thank you, {values.name.split(' ')[0] || 'there'}. A PINITHUB specialist will
                      confirm{' '}
                      <span className="text-paper">
                        {formatDate(values.date)} at {values.time}
                      </span>{' '}
                      by email. Typical response time: {settings.responseTime.toLowerCase()}.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSubmitted(false);
                        setStep(0);
                        setValues(EMPTY);
                        setErrors({});
                        setFormError('');
                      }}
                      className="mt-8 text-[0.9375rem] text-cyan underline-offset-4 hover:underline"
                    >
                      Book another session
                    </button>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    onSubmit={onSubmit}
                    noValidate
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="relative"
                  >
                    {/* Progress rail */}
                    <ol className="flex items-center gap-3" aria-label="Booking progress">
                      {STEPS.map((s, i) => (
                        <li key={s.label} className="flex flex-1 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => i < step && setStep(i)}
                            disabled={i > step}
                            aria-current={i === step ? 'step' : undefined}
                            className="flex items-center gap-2.5 text-left disabled:cursor-default"
                          >
                            <span
                              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-[0.6875rem] transition-all duration-500 ${
                                i < step
                                  ? 'border-signal/50 bg-signal/15 text-signal'
                                  : i === step
                                    ? 'border-cyan/50 bg-cyan/15 text-cyan shadow-[0_0_20px_-4px_rgba(85,230,255,0.9)]'
                                    : 'border-line text-mute-2'
                              }`}
                            >
                              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                            </span>
                            <span
                              className={`hidden text-[0.8125rem] transition-colors duration-500 sm:block ${
                                i === step ? 'text-paper' : 'text-mute-2'
                              }`}
                            >
                              {s.label}
                            </span>
                          </button>
                          {i < STEPS.length - 1 && (
                            <span aria-hidden className="relative h-px flex-1 bg-line">
                              <motion.span
                                className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,#E879F9,#6D5EF0)]"
                                animate={{ width: i < step ? '100%' : '0%' }}
                                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                              />
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>

                    <div className="mt-8 min-h-[18rem] sm:min-h-[26rem]">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={step}
                          initial={{ opacity: 0, x: 26 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -26 }}
                          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                          className="grid gap-5 sm:grid-cols-2"
                        >
                          {step === 0 && (
                            <>
                              <Field label="Full name" required error={errors.name} className="sm:col-span-2">
                                <input
                                  type="text"
                                  autoComplete="name"
                                  value={values.name}
                                  onChange={(e) => set('name', e.target.value)}
                                  className={inputCls(!!errors.name)}
                                  placeholder="Ada Okonkwo"
                                />
                              </Field>
                              <Field label="Business email" required error={errors.email}>
                                <input
                                  type="email"
                                  autoComplete="email"
                                  value={values.email}
                                  onChange={(e) => set('email', e.target.value)}
                                  className={inputCls(!!errors.email)}
                                  placeholder="you@company.com"
                                />
                              </Field>
                              <Field label="Company name" required error={errors.company}>
                                <input
                                  type="text"
                                  autoComplete="organization"
                                  value={values.company}
                                  onChange={(e) => set('company', e.target.value)}
                                  className={inputCls(!!errors.company)}
                                  placeholder="Northwind Group"
                                />
                              </Field>
                              <Field label="Phone number" error={errors.phone} hint="Optional">
                                <input
                                  type="tel"
                                  autoComplete="tel"
                                  value={values.phone}
                                  onChange={(e) => set('phone', e.target.value)}
                                  className={inputCls(!!errors.phone)}
                                  placeholder="+1 555 000 1234"
                                />
                              </Field>
                              <Field label="Job title" required error={errors.title}>
                                <input
                                  type="text"
                                  autoComplete="organization-title"
                                  value={values.title}
                                  onChange={(e) => set('title', e.target.value)}
                                  className={inputCls(!!errors.title)}
                                  placeholder="Head of Digital"
                                />
                              </Field>
                            </>
                          )}

                          {step === 1 && (
                            <>
                              <Field label="Country" required error={errors.country} className="sm:col-span-2">
                                <Select
                                  value={values.country}
                                  onChange={(v) => set('country', v)}
                                  options={COUNTRIES}
                                  placeholder="Select your country"
                                  invalid={!!errors.country}
                                />
                              </Field>
                              <Field label="Organization size" required error={errors.size}>
                                <Select
                                  value={values.size}
                                  onChange={(v) => set('size', v)}
                                  options={SIZES}
                                  placeholder="Number of employees"
                                  invalid={!!errors.size}
                                />
                              </Field>
                              <Field label="Industry" required error={errors.industry}>
                                <Select
                                  value={values.industry}
                                  onChange={(v) => set('industry', v)}
                                  options={INDUSTRIES}
                                  placeholder="Select your industry"
                                  invalid={!!errors.industry}
                                />
                              </Field>
                            </>
                          )}

                          {step === 2 && (
                            <>
                              <Field label="Preferred demo date" required error={errors.date}>
                                <input
                                  type="date"
                                  min={today}
                                  value={values.date}
                                  onChange={(e) => set('date', e.target.value)}
                                  className={`${inputCls(!!errors.date)} [color-scheme:dark]`}
                                />
                              </Field>

                              {/* A group of buttons, so this is a fieldset rather than a label */}
                              <fieldset className="min-w-0">
                                <legend className="mb-2.5 text-[0.8125rem] font-medium text-mute">
                                  Preferred time
                                  <span className="ml-1 text-cyan/70">*</span>
                                </legend>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {TIMES.map((t) => (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => set('time', t)}
                                      aria-pressed={values.time === t}
                                      className={`rounded-lg border px-2 py-2.5 font-mono text-[0.75rem] transition-all duration-300 ${
                                        values.time === t
                                          ? 'border-cyan/50 bg-cyan/15 text-cyan'
                                          : 'border-line text-mute-2 hover:border-white/20 hover:text-paper'
                                      }`}
                                    >
                                      {t}
                                    </button>
                                  ))}
                                </div>
                                {errors.time && (
                                  <p className="mt-2 text-[0.8125rem] text-red-400">{errors.time}</p>
                                )}
                              </fieldset>

                              <Field label="Message" hint="Optional" className="sm:col-span-2">
                                <textarea
                                  rows={4}
                                  value={values.message}
                                  onChange={(e) => set('message', e.target.value)}
                                  className={`${inputCls(false)} resize-none`}
                                  placeholder="Tell us what you are trying to solve, and which teams will be in the room."
                                />
                              </Field>

                              <div className="sm:col-span-2">
                                <label className="flex cursor-pointer items-start gap-3">
                                  <span className="relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
                                    <input
                                      type="checkbox"
                                      checked={values.consent}
                                      onChange={(e) => set('consent', e.target.checked)}
                                      className="peer sr-only"
                                    />
                                    <span
                                      className={`grid h-5 w-5 place-items-center rounded-[0.4rem] border transition-all duration-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cyan ${
                                        values.consent
                                          ? 'border-cyan/60 bg-[linear-gradient(140deg,#E879F9,#6D5EF0)]'
                                          : errors.consent
                                            ? 'border-red-400/60'
                                            : 'border-line'
                                      }`}
                                    >
                                      {values.consent && (
                                        <Check className="h-3.5 w-3.5 text-ink" strokeWidth={3} />
                                      )}
                                    </span>
                                  </span>
                                  <span className="text-[0.875rem] leading-relaxed text-mute-2">
                                    I agree to the{' '}
                                    <a href="#privacy" className="text-cyan underline-offset-4 hover:underline">
                                      Privacy Policy
                                    </a>{' '}
                                    and consent to being contacted about this demo.
                                  </span>
                                </label>
                                {errors.consent && (
                                  <p className="mt-2 text-[0.8125rem] text-red-400">{errors.consent}</p>
                                )}
                              </div>
                            </>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    {formError && (
                      <p role="alert" className="mt-6 text-[0.875rem] text-red-400">
                        {formError}
                      </p>
                    )}

                    {/* Navigation */}
                    <div className="mt-8 flex flex-col-reverse items-stretch gap-4 border-t border-line pt-6 sm:mt-8 sm:flex-row sm:items-center sm:justify-between sm:pt-7">
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.max(0, s - 1))}
                        disabled={step === 0 || pending}
                        className="inline-flex items-center justify-center gap-2 text-[0.9375rem] text-mute-2 transition-colors hover:text-paper disabled:pointer-events-none disabled:opacity-0 sm:justify-start"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                      </button>

                      {step < STEPS.length - 1 ? (
                        <MagneticButton onClick={next} size="lg" className="w-full sm:w-auto">
                          Continue
                          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                        </MagneticButton>
                      ) : (
                        <MagneticButton type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
                          {pending ? 'Scheduling…' : 'Schedule My Live Demo'}
                          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                        </MagneticButton>
                      )}
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </Reveal>

          {/* --------------------- Aside --------------------- */}
          <Reveal direction="left" delay={0.1}>
            <div className="flex h-full flex-col gap-6">
              <div className="panel grain relative flex-1 overflow-hidden p-7 sm:p-8">
                <CalendarVisual date={values.date} time={values.time} />
              </div>

              <div className="panel p-7 sm:p-8">
                <p className="eyebrow">Support</p>
                <ul className="mt-6 space-y-6">
                  <SupportRow icon={Timer} label="Average response time" value={settings.responseTime} />
                  <SupportRow
                    icon={Mail}
                    label="Business email"
                    value={settings.supportEmail}
                    href={`mailto:${settings.supportEmail}`}
                  />
                  <SupportRow icon={MapPin} label="Office" value={settings.officeAddress} />
                  <SupportRow icon={Clock3} label="Demo length" value={settings.demoLength} />
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ pieces ------------------------------ */

const inputCls = (invalid: boolean) =>
  `w-full rounded-xl border bg-ink/60 px-4 py-3 text-[0.9375rem] text-paper placeholder:text-mute-2/55 outline-none transition-all duration-300 focus:bg-ink/80 ${
    invalid
      ? 'border-red-400/60 focus:border-red-400'
      : 'border-line focus:border-cyan/45 focus:shadow-[0_0_0_4px_rgba(85,230,255,0.09)]'
  }`;

function Field({
  label,
  children,
  required,
  error,
  hint,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2.5 flex items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-medium text-mute">
          {label}
          {required && <span className="ml-1 text-cyan/70">*</span>}
        </span>
        {hint && <span className="font-mono text-[0.6875rem] text-mute-2/70">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-2 block text-[0.8125rem] text-red-400">{error}</span>}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  invalid: boolean;
}) {
  return (
    <span className="relative block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls(invalid)} appearance-none pr-10 ${value ? '' : 'text-mute-2/55'}`}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 8"
        className="pointer-events-none absolute top-1/2 right-4 h-2 w-3 -translate-y-1/2 text-mute-2"
      >
        <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SupportRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <li className="group flex gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.03] transition-all duration-500 group-hover:border-cyan/30 group-hover:bg-cyan/10">
        <Icon className="h-4 w-4 text-mute transition-colors duration-500 group-hover:text-cyan" strokeWidth={1.6} />
      </span>
      <span className="min-w-0">
        <span className="eyebrow block text-[0.625rem]">{label}</span>
        {href ? (
          <a href={href} className="mt-1.5 block text-[0.9375rem] break-words text-paper hover:text-cyan">
            {value}
          </a>
        ) : (
          <span className="mt-1.5 block text-[0.9375rem] text-paper">{value}</span>
        )}
      </span>
    </li>
  );
}

function formatDate(iso: string) {
  if (!iso) return 'your selected date';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Floating calendar plate that reflects the current selection. */
function CalendarVisual({ date, time }: { date: string; time: string }) {
  const selected = date ? new Date(`${date}T00:00:00`) : null;
  const day = selected ? selected.getDate() : null;
  const month = selected
    ? selected.toLocaleDateString('en-US', { month: 'long' })
    : 'Pick a date';
  const weekday = selected ? selected.toLocaleDateString('en-US', { weekday: 'long' }) : '';

  return (
    <div className="relative flex h-full min-h-[16rem] flex-col justify-between">
      <div className="lattice-fine absolute inset-0 -m-8 opacity-40" aria-hidden />
      <div
        aria-hidden
        className="absolute inset-0 -m-8 bg-[radial-gradient(80%_70%_at_70%_0%,rgba(111,92,255,0.18),transparent_65%)]"
      />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="eyebrow">Your session</p>
          <p className="mt-3 font-display text-lg font-medium text-paper">Live platform walkthrough</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-violet/35 bg-violet/10">
          <CalendarDays className="h-5 w-5 text-violet" strokeWidth={1.6} />
        </span>
      </div>

      {/* The date plate, floating */}
      <motion.div
        animate={{ y: [0, -8, 0], rotateX: [0, 4, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', perspective: 800 }}
        className="relative mx-auto my-8 w-full max-w-[13rem]"
      >
        <span
          aria-hidden
          className="absolute -inset-4 rounded-[1.75rem] bg-[linear-gradient(140deg,rgba(232,121,249,0.28),rgba(168,85,247,0.24))] opacity-60 blur-2xl"
        />
        <div className="relative overflow-hidden rounded-2xl border border-white/14 bg-[linear-gradient(160deg,rgba(23,39,68,0.96),rgba(6,11,26,0.94))] shadow-[0_30px_60px_-25px_rgba(0,0,0,0.95)]">
          <div className="border-b border-line bg-[linear-gradient(100deg,#E879F9,#6D5EF0,#A855F7)] px-4 py-2">
            <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-ink uppercase">{month}</p>
          </div>
          <div className="px-4 py-6 text-center">
            <AnimatePresence mode="wait">
              <motion.p
                key={day ?? 'empty'}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="font-display text-6xl leading-none font-semibold text-glow"
              >
                {day ?? '––'}
              </motion.p>
            </AnimatePresence>
            <p className="mt-3 text-[0.8125rem] text-mute-2">{weekday || 'Awaiting selection'}</p>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="font-mono text-[0.6875rem] text-mute-2">TIME</span>
            <span className="font-mono text-[0.6875rem] text-cyan">{time || '--:--'}</span>
          </div>
        </div>
      </motion.div>

      <p className="relative text-[0.875rem] leading-relaxed text-mute-2">
        Sessions are run by a product specialist, not a sales script. Bring the messiest corner of
        your asset library — that is the part worth showing.
      </p>
    </div>
  );
}
