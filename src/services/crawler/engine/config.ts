/**
 * Crawler engine configuration — all env vars centralized here.
 */

function optional(key: string, fallback: string): string {
  return (process.env[key] ?? fallback).trim();
}

function optionalInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function optionalFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function productionDefaultEnabled(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

export const crawlerEngineConfig = {
  enabled: optionalBool('CRAWLER_ENGINE_ENABLED', productionDefaultEnabled()),

  /** Cron expression — default every hour */
  scheduleCron: optional('CRAWLER_SCHEDULE_CRON', '0 * * * *'),

  /** Fallback interval in minutes when not using custom cron */
  scheduleIntervalMinutes: optionalInt('CRAWLER_SCHEDULE_INTERVAL_MINUTES', 60),

  workerCount: optionalInt('CRAWLER_WORKER_COUNT', 3),
  maxJobsPerTick: optionalInt('CRAWLER_MAX_JOBS_PER_TICK', 20),
  jobTimeoutMs: optionalInt('CRAWLER_JOB_TIMEOUT_MS', 120_000),
  retryDelayMs: optionalInt('CRAWLER_RETRY_DELAY_MS', 30_000),
  maxAttempts: optionalInt('CRAWLER_MAX_ATTEMPTS', 3),

  similarityThreshold: optionalFloat('CRAWLER_SIMILARITY_THRESHOLD', 0.85),
  possibleThreshold: optionalFloat('CRAWLER_POSSIBLE_THRESHOLD', 0.70),

  downloadTimeoutMs: optionalInt('CRAWLER_DOWNLOAD_TIMEOUT_MS', 15_000),
  maxAssetBytes: optionalInt('CRAWLER_MAX_ASSET_BYTES', 15 * 1024 * 1024),

  platforms: {
    website: optionalBool('CRAWLER_PLATFORM_WEBSITE', true),
    github: optionalBool('CRAWLER_PLATFORM_GITHUB', true),
    youtube: optionalBool('CRAWLER_PLATFORM_YOUTUBE', true),
    reddit: optionalBool('CRAWLER_PLATFORM_REDDIT', true),
    telegram: optionalBool('CRAWLER_PLATFORM_TELEGRAM', true),
  },

  github: {
    token: optional('GITHUB_TOKEN', ''),
    apiBase: optional('GITHUB_API_BASE', 'https://api.github.com'),
  },

  youtube: {
    apiKey: optional('YOUTUBE_API_KEY', ''),
    apiBase: optional('YOUTUBE_API_BASE', 'https://www.googleapis.com/youtube/v3'),
  },

  reddit: {
    clientId: optional('REDDIT_CLIENT_ID', ''),
    clientSecret: optional('REDDIT_CLIENT_SECRET', ''),
    userAgent: optional('REDDIT_USER_AGENT', 'PINIT-DNA-Crawler/1.0'),
  },

  telegram: {
    botToken: optional('TELEGRAM_BOT_TOKEN', ''),
    /** Comma-separated public channel usernames (without @) */
    channels: optional('TELEGRAM_PUBLIC_CHANNELS', '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  },

  website: {
    playwrightEnabled: optionalBool('PLAYWRIGHT_CRAWLER_ENABLED', false),
    crawl4aiUrl: optional('CRAWL4AI_SERVICE_URL', ''),
    maxPagesPerScan: optionalInt('CRAWLER_WEBSITE_MAX_PAGES', 5),
    maxAssetsPerPage: optionalInt('CRAWLER_WEBSITE_MAX_ASSETS', 20),
  },

  pythonAiBase: optional('PYTHON_AI_URL', 'http://127.0.0.1:8001'),
} as const;

export function isCrawlerEngineEnabled(): boolean {
  return crawlerEngineConfig.enabled;
}
