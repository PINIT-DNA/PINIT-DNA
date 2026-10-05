/**
 * Ask PINIT intelligence specification.
 *
 * This is the “training”: question taxonomy → retrieval path.
 * We do not train an LLM on Q/A pairs. The classifier maps wording to an
 * intent; the service searches only those owner-scoped Hub records.
 */
import type { AskPinitIntent } from './ask-pinit-intent';

export const ASK_PINIT_SEARCH: Record<AskPinitIntent, string[]> = {
  GREETING: [],
  GENERAL_PINIT_HELP: ['VaultRecord'],
  USER_ASSETS: ['VaultRecord', 'DnaRecord', 'metadata'],
  ACCOUNT_STATUS: ['User', 'VaultRecord', 'ShareLink', 'Portfolio'],
  ASSET_OVERVIEW: ['VaultRecord', 'DnaRecord', 'ShareLink', 'ShareAccessLog', 'Incident', 'activity'],
  ASSET_CAPTURE_TIME: ['MetadataLayer', 'exif/iptc/xmp', 'VaultRecord.createdAt'],
  ASSET_LOCATION: ['MetadataLayer GPS', 'ShareAccessLog geo', 'VaultRecord storage'],
  ASSET_STORAGE: ['VaultRecord'],
  ASSET_PROTECTION_STATUS: ['VaultRecord', 'DnaRecord', 'Verification'],
  ASSET_IDENTITY: ['DnaRecord.id', 'sha256', 'VaultRecord.originalFileName'],
  ASSET_DNA: ['DnaRecord', 'layers', 'sha256'],
  ASSET_AUTHENTICITY: ['contentAnalysis', 'fileAnalysis', 'Verification'],
  ASSET_VERIFICATION: ['Verification'],
  ASSET_ACTIVITY: ['AssetTimelineEvent', 'ShareLink', 'ShareAccessLog', 'Verification', 'Incident'],
  ASSET_TIMELINE: ['capture', 'protection', 'share', 'access', 'download', 'investigation', 'monitoring'],
  ASSET_SHARING: ['ShareLink', 'secure links', 'recipients'],
  ASSET_VIEWS: ['ShareLink.viewCount', 'ShareAccessLog VIEW/OPEN'],
  ASSET_DOWNLOADS: ['ShareLink.downloadCount', 'ShareAccessLog DOWNLOADED', 'TrackedExport'],
  ASSET_INVESTIGATIONS: ['Incident', 'investigation reports', 'matches'],
  ASSET_REPORTS: ['Incident', 'intelligence report', 'Verification'],
  ASSET_MONITORING: ['MonitorRecord', 'crawlResults', 'matches'],
  ASSET_DUPLICATES: ['duplicate/perceptual match', 'Incident', 'MonitorRecord'],
  RECENT_ACTIVITY: ['activity across VaultRecords'],
  RECENT_SHARES: ['ShareLink by createdAt'],
  RECENT_DOWNLOADS: ['ShareAccessLog DOWNLOADED'],
  ATTENTION_ITEMS: ['Incident', 'tamper/risk events', 'quiet assets'],
  ASSETS_QUIET: ['activity lastActivityAt'],
  PORTFOLIO_ASSETS: ['PortfolioCollectionItem'],
  PORTFOLIO_OVERVIEW: ['Portfolio', 'PortfolioCollectionItem'],
};

/** First 20 live-asset questions — classifier regression set. */
export const ASK_PINIT_GOLDEN: Array<{ question: string; intent: AskPinitIntent }> = [
  { question: 'Tell me everything about this asset.', intent: 'ASSET_OVERVIEW' },
  { question: 'When did I capture it?', intent: 'ASSET_CAPTURE_TIME' },
  { question: 'Where did I capture it?', intent: 'ASSET_LOCATION' },
  { question: 'Who protected it?', intent: 'ASSET_PROTECTION_STATUS' },
  { question: 'Is it currently protected?', intent: 'ASSET_PROTECTION_STATUS' },
  { question: 'How many share links were created for it?', intent: 'ASSET_SHARING' },
  { question: 'Are those links still active?', intent: 'ASSET_SHARING' },
  { question: 'Who accessed it?', intent: 'ASSET_VIEWS' },
  { question: 'How many times was it downloaded?', intent: 'ASSET_DOWNLOADS' },
  { question: 'What happened to it today?', intent: 'ASSET_ACTIVITY' },
  { question: 'What happened recently?', intent: 'RECENT_ACTIVITY' },
  { question: 'When was the last activity?', intent: 'ASSET_ACTIVITY' },
  { question: 'Has it been investigated?', intent: 'ASSET_INVESTIGATIONS' },
  { question: 'Were any matches found?', intent: 'ASSET_MONITORING' },
  { question: 'Was any tampering detected?', intent: 'ASSET_PROTECTION_STATUS' },
  { question: 'What is its DNA/identity?', intent: 'ASSET_DNA' },
  { question: 'Show me its complete journey.', intent: 'ASSET_TIMELINE' },
  { question: 'Is anything about this asset suspicious or needs attention?', intent: 'ATTENTION_ITEMS' },
  { question: 'Where was it last accessed?', intent: 'ASSET_LOCATION' },
  { question: 'What has happened to this asset since I protected it?', intent: 'ASSET_TIMELINE' },
];
