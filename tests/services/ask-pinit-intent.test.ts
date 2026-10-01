import { describe, expect, test } from '@jest/globals';
import {
  extractSearchTokens,
  parseAskPinitIntent,
  parseAskPinitTimeRange,
  parseLocationQuestionKind,
  questionRefersToCurrentAsset,
  questionUsesFollowUpPronoun,
  startOfLocalDay,
} from '../../src/services/intelligence/ask-pinit-intent';
import { ASK_PINIT_GOLDEN } from '../../src/services/intelligence/ask-pinit-catalog';
import { resolveAsset } from '../../src/services/intelligence/ask-pinit-resolve';

const vaults = [
  { vaultId: 'vault-god', assetId: 'asset-god', dnaRecordId: 'dna-god', filename: 'God.png', sha256: 'abc123deadbeef' },
  { vaultId: 'vault-beach', assetId: 'asset-beach', dnaRecordId: 'dna-beach', filename: 'beach-photo.jpg', sha256: null },
];

describe('Ask PINIT intent', () => {
  test('example questions map to controlled intents', () => {
    expect(parseAskPinitIntent('When did I capture my beach photo?')).toBe('ASSET_CAPTURE_TIME');
    expect(parseAskPinitIntent('Where did I capture my beach photo?')).toBe('ASSET_LOCATION');
    expect(parseAskPinitIntent('What happened to my God asset today?')).toBe('ASSET_ACTIVITY');
    expect(parseAskPinitIntent('Who has my God asset?')).toBe('ASSET_SHARING');
    expect(parseAskPinitIntent('How many times was God.png downloaded?')).toBe('ASSET_DOWNLOADS');
    expect(parseAskPinitIntent('Which assets were shared recently?')).toBe('RECENT_SHARES');
    expect(parseAskPinitIntent('Which assets were downloaded today?')).toBe('RECENT_DOWNLOADS');
    expect(parseAskPinitIntent('What needs my attention?')).toBe('ATTENTION_ITEMS');
    expect(parseAskPinitIntent('Show my recent activity.')).toBe('RECENT_ACTIVITY');
    expect(parseAskPinitIntent('Tell me everything about God.png.')).toBe('ASSET_OVERVIEW');
    expect(parseAskPinitIntent('Is my God asset protected?')).toBe('ASSET_PROTECTION_STATUS');
    expect(parseAskPinitIntent('Show the investigation history for God.png.')).toBe('ASSET_INVESTIGATIONS');
    expect(parseAskPinitIntent('When was this asset protected?')).toBe('ASSET_PROTECTION_STATUS');
    expect(parseAskPinitIntent('What is the DNA identity of this asset?')).toBe('ASSET_DNA');
    expect(parseAskPinitIntent('Which assets have no recent activity?')).toBe('ASSETS_QUIET');
    expect(parseAskPinitIntent('hello')).toBe('GREETING');
    expect(parseAskPinitIntent('hi')).toBe('GREETING');
    expect(parseAskPinitIntent('hello can you tell me that dress asset is a natural one or ai edited picture?')).toBe('ASSET_AUTHENTICITY');
    expect(parseAskPinitIntent('Is Dress.jpeg AI generated?')).toBe('ASSET_AUTHENTICITY');
    expect(parseAskPinitIntent('Currently how many links created for that asset to share?')).toBe('ASSET_SHARING');
    expect(parseAskPinitIntent('How many share links does it have?')).toBe('ASSET_SHARING');
    expect(parseAskPinitIntent('Who has it?')).toBe('ASSET_SHARING');
    expect(parseAskPinitIntent('Was Dress.jpeg uploaded or captured with the PINIT camera?')).toBe('ASSET_CAPTURE_TIME');
    expect(parseAskPinitIntent('i wnat exact palce name')).toBe('ASSET_LOCATION');
    expect(parseAskPinitIntent('name of country village')).toBe('ASSET_LOCATION');
    expect(questionUsesFollowUpPronoun('name of country village')).toBe(true);
  });

  test('current-page wording does not match this week', () => {
    expect(questionRefersToCurrentAsset('What happened to this?')).toBe(true);
    expect(questionRefersToCurrentAsset('What changed this week?')).toBe(false);
    expect(extractSearchTokens('Where is my God.png asset').some((t) => t.includes('god'))).toBe(true);
  });
});

describe('Ask PINIT dates', () => {
  test('today / yesterday / last 7 days become ranges', () => {
    const now = new Date('2026-10-01T12:00:00');
    const today = parseAskPinitTimeRange('what happened today', now);
    expect(today?.label).toBe('today');
    expect(today?.from.getTime()).toBe(startOfLocalDay(now).getTime());

    const y = parseAskPinitTimeRange('downloads yesterday', now);
    expect(y?.label).toBe('yesterday');

    const week = parseAskPinitTimeRange('shared last 7 days', now);
    expect(week?.label).toBe('in the last 7 days');
    expect(parseAskPinitTimeRange('hello', now)).toBeNull();
  });
});

describe('Ask PINIT entity resolution', () => {
  test('filename and follow-up it/where resolve to the same asset', () => {
    const first = resolveAsset(vaults, 'When did I capture God.png?');
    expect(first?.filename).toBe('God.png');

    const follow = resolveAsset(vaults, 'Where?', {
      conversation: [{ vaultId: first!.vaultId, assetId: first!.assetId, filename: first!.filename }],
    });
    expect(follow?.filename).toBe('God.png');
    expect(questionUsesFollowUpPronoun('How many links were created for that asset?')).toBe(true);
    expect(questionUsesFollowUpPronoun('who has it?')).toBe(true);
  });

  test('living-asset route wins for this/it', () => {
    const hit = resolveAsset(vaults, 'What happened to this?', { contextVaultId: 'vault-beach' });
    expect(hit?.filename).toBe('beach-photo.jpg');
  });

  test('does not invent a match for an unknown name', () => {
    expect(resolveAsset(vaults, 'Where is my unicorn.png?')).toBeNull();
  });
});

describe('Ask PINIT no hallucination', () => {
  test('unknown location copy does not name a city', () => {
    const note = 'PINIT doesn’t have a recorded location for this asset.';
    expect(note.toLowerCase()).not.toContain('hyderabad');
  });
});

describe('Ask PINIT golden catalogue', () => {
  test('20 live-asset questions map to retrieval intents', () => {
    for (const row of ASK_PINIT_GOLDEN) {
      expect({ q: row.question, intent: parseAskPinitIntent(row.question) }).toEqual({
        q: row.question,
        intent: row.intent,
      });
    }
  });

  test('inventory and sharing phrasing do not collapse to a generic count', () => {
    expect(parseAskPinitIntent('How many links were created for my God image?')).toBe('ASSET_SHARING');
    expect(parseAskPinitIntent('What are my assets?')).toBe('USER_ASSETS');
    expect(parseAskPinitIntent('Show my assets.')).toBe('USER_ASSETS');
    expect(parseAskPinitIntent('Do I have an asset called God.png?')).toBe('USER_ASSETS');
    expect(parseAskPinitIntent('Tell me about God.png.')).toBe('ASSET_OVERVIEW');
    expect(parseAskPinitIntent('Where was it last accessed?')).toBe('ASSET_LOCATION');
    expect(parseLocationQuestionKind('Where was it last accessed?')).toBe('access');
    expect(parseLocationQuestionKind('Where did I capture God.png?')).toBe('capture');
    expect(parseLocationQuestionKind('Is it in my Vault?')).toBe('storage');
  });
});
