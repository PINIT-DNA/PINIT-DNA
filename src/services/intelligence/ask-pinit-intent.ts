/**
 * Controlled Ask PINIT intents + date phrases + pronoun/follow-up cues.
 * Classification is deterministic (no model, no DB).
 */

export type AskPinitIntent =
  | 'ASSET_OVERVIEW'
  | 'ASSET_CAPTURE_TIME'
  | 'ASSET_LOCATION'
  | 'ASSET_STORAGE'
  | 'ASSET_PROTECTION_STATUS'
  | 'ASSET_IDENTITY'
  | 'ASSET_DNA'
  | 'ASSET_ACTIVITY'
  | 'ASSET_SHARING'
  | 'ASSET_DOWNLOADS'
  | 'ASSET_VIEWS'
  | 'ASSET_TIMELINE'
  | 'ASSET_INVESTIGATIONS'
  | 'ASSET_VERIFICATION'
  | 'ASSET_AUTHENTICITY'
  | 'ASSET_REPORTS'
  | 'ASSET_MONITORING'
  | 'ASSET_DUPLICATES'
  | 'USER_ASSETS'
  | 'ACCOUNT_STATUS'
  | 'RECENT_ACTIVITY'
  | 'RECENT_SHARES'
  | 'RECENT_DOWNLOADS'
  | 'ATTENTION_ITEMS'
  | 'ASSETS_QUIET'
  | 'PORTFOLIO_ASSETS'
  | 'PORTFOLIO_OVERVIEW'
  | 'GREETING'
  | 'GENERAL_PINIT_HELP';

export type LocationQuestionKind = 'capture' | 'access' | 'storage' | 'now';

export interface AskPinitTimeRange {
  from: Date;
  to: Date;
  label: string;
}

const STOP = new Set([
  'a', 'an', 'the', 'my', 'me', 'i', 'is', 'are', 'was', 'were', 'did', 'do', 'does',
  'of', 'on', 'to', 'for', 'with', 'about', 'this', 'that', 'it', 'its', 'in', 'at',
  'and', 'or', 'has', 'have', 'been', 'any', 'anyone', 'right', 'now', 'please',
  'show', 'tell', 'give', 'find', 'which', 'what', 'when', 'where', 'who', 'how',
  'asset', 'assets', 'file', 'files', 'photo', 'photos', 'image', 'images', 'video',
  'png', 'jpg', 'jpeg', 'webp', 'mp4', 'protected', 'pinit', 'hub', 'hello', 'hi',
  'can', 'you', 'say', 'tell', 'ask',
]);

export function extractSearchTokens(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9.\-_\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function parseAskPinitTimeRange(question: string, now = new Date()): AskPinitTimeRange | null {
  const q = question.toLowerCase();
  const end = new Date(now);
  if (/\blast 24 hours\b|\bpast day\b/.test(q)) {
    return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: end, label: 'in the last 24 hours' };
  }
  if (/\bearlier today\b|\bjust now\b/.test(q)) {
    return { from: startOfLocalDay(now), to: end, label: 'today' };
  }
  if (/\btoday\b/.test(q)) {
    return { from: startOfLocalDay(now), to: end, label: 'today' };
  }
  if (/\byesterday\b/.test(q)) {
    const from = startOfLocalDay(now);
    from.setDate(from.getDate() - 1);
    const to = startOfLocalDay(now);
    return { from, to, label: 'yesterday' };
  }
  if (/\blast 7 days\b|\bpast week\b/.test(q)) {
    return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: end, label: 'in the last 7 days' };
  }
  if (/\bthis week\b/.test(q)) {
    const from = startOfLocalDay(now);
    from.setDate(from.getDate() - from.getDay());
    return { from, to: end, label: 'this week' };
  }
  if (/\bthis month\b/.test(q)) {
    const from = startOfLocalDay(now);
    from.setDate(1);
    return { from, to: end, label: 'this month' };
  }
  if (/\bsince (i |it was )?protect/.test(q)) {
    return { from: new Date(0), to: end, label: 'since protection' };
  }
  if (/\b(recently|most recent|recent)\b/.test(q) && !/\blast (activity|access|download)\b/.test(q)) {
    return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: end, label: 'recently' };
  }
  return null;
}

/** Living-asset page wording — not “this week”. */
export function questionRefersToCurrentAsset(question: string): boolean {
  const q = question.toLowerCase().trim();
  if (/\bthis (week|month|year|time)\b/.test(q)) return false;
  if (/\b(this asset|this photo|this file|this image|this one|this report|current asset|that asset|that file|that photo|the asset|those links)\b/.test(q)) return true;
  if (/\bwhat happened to (this|me|it)\b/.test(q)) return true;
  if (/\b(explain this|about this)\b/.test(q)) return true;
  if (/^(this|it|me)\??$/.test(q)) return true;
  return false;
}

export function questionUsesFollowUpPronoun(question: string): boolean {
  const q = question.toLowerCase().trim();
  if (/^(where|who|when|why|and that|and)\??$/.test(q)) return true;
  if (/\b(that|this|the) (asset|file|photo|one|image)\b/.test(q)) return true;
  if (/^(where|who|when)\b.{0,40}\b(it|that|this)\b/.test(q)) return true;
  if (/\b(exact )?(palce|place|location) name\b|\b(village|country|mandal|district)\b/.test(q)) return true;
  if (/\b(it|that one|the same)\b/.test(q) && extractSearchTokens(q).length === 0) return true;
  return /\b(it|that)\b/.test(q) && extractSearchTokens(q).length === 0;
}

export function parseLocationQuestionKind(question: string): LocationQuestionKind {
  const q = question.toLowerCase();
  if (/\b(stored|vault|preserved|original preserved|where is .{0,40}stored)\b/.test(q)) return 'storage';
  if (/\b(access|accessed|opened|open location|from another location|last access)\b/.test(q)) return 'access';
  if (/\b(capture|captured|taken|took|shot|photo taken)\b/.test(q)) return 'capture';
  if (/\bright now\b|\bwhere is my .{0,40}(image|photo|asset|file)\b/.test(q)) return 'now';
  return 'capture';
}

export function parseAskPinitIntent(question: string): AskPinitIntent {
  const raw = question.toLowerCase().trim();
  const q = raw
    .replace(/^(hi+|hii|hey|hello|yo|hola|namaste)([,!.\s]+|$)/, '')
    .replace(/^good (morning|afternoon|evening)([,!.\s]+|$)/, '')
    .trim();
  if (!q) return 'GREETING';

  if (/^(where|where is it|where was it|where did i capture)\??$/.test(q)) return 'ASSET_LOCATION';
  if (/^(who|who has it)\??$/.test(q)) return 'ASSET_SHARING';
  if (/^(who accessed it)\??$/.test(q)) return 'ASSET_VIEWS';
  if (/^(when|when was it|when did i capture)\??$/.test(q)) return 'ASSET_CAPTURE_TIME';
  if (/^is it (currently )?protected\??$/.test(q)) return 'ASSET_PROTECTION_STATUS';
  if (/\bwho protected\b/.test(q)) return 'ASSET_PROTECTION_STATUS';
  if (/\btamper/.test(q)) return 'ASSET_PROTECTION_STATUS';
  if (/\b(uploaded|upload to protect|pinit cam|pinit camera|captured with|captured through|protect via capture)\b/.test(q)) {
    return 'ASSET_CAPTURE_TIME';
  }

  if (/\b(ai[- ]?(generated|edited|made)|natural|original (photo|picture|image)|deepfake|synthetic|real (photo|picture|image)|camera (photo|shot)|photoshop|authenticit)\b/.test(q)
    || (/\b(ai|edited)\b/.test(q) && /\b(natural|original|real|generated|edited|picture|photo|image)\b/.test(q))) {
    return 'ASSET_AUTHENTICITY';
  }

  if (/\b(how ?many|number of|count)\b/.test(q) && /\b(links?|share links?|secure links?)\b/.test(q)) return 'ASSET_SHARING';
  if (/\blinks?\b/.test(q) && /\b(created|create|creaded|secure|still active|revoked|expired|active)\b/.test(q)) return 'ASSET_SHARING';
  if (/\b(currently shared|is .{0,40}shared|active (secure )?links?|those links)\b/.test(q)) return 'ASSET_SHARING';
  if (/\bhow many times\b/.test(q) && /\bshar/.test(q)) return 'ASSET_SHARING';
  if (/\bhow many people\b/.test(q) && /\bshar/.test(q)) return 'ASSET_SHARING';

  if (/\b(opend|opened|openend|how many people|how many (views?|opens?))\b/.test(q)
    || (/\b(sahred|shar(e|ed|ing))\b/.test(q) && /\b(people|open|opend|view|where)\b/.test(q) && !/\blink/.test(q))) {
    return 'ASSET_VIEWS';
  }
  if (/\bwho accessed\b/.test(q) || (/\baccessed\b/.test(q) && /\bwho\b/.test(q))) return 'ASSET_VIEWS';
  if (/\b(has anyone opened|did anyone (touch|open|access)|last access)\b/.test(q)) return 'ASSET_VIEWS';

  if (/\b(plan|storage|quota|pinit id|account status|how much storage)\b/.test(q)) return 'ACCOUNT_STATUS';

  if (/\b(duplicate|same asset|another copy|look like this|similar asset|someone else upload|tried to protect)\b/.test(q)) {
    return 'ASSET_DUPLICATES';
  }
  if (/\b(monitor|matches found|match(es)? (found|detected)|appeared elsewhere|crawler|new matches)\b/.test(q)) {
    return 'ASSET_MONITORING';
  }

  if (/\b(attention|need(ing|s)? my attention|alert|suspicious|risk|what should i look)\b/.test(q)) return 'ATTENTION_ITEMS';
  if (/\bno recent activity\b|\bquiet\b|\bhaven'?t been accessed\b/.test(q)) return 'ASSETS_QUIET';
  if (/\b(investigat|evidence report|forensic)/.test(q)) return 'ASSET_INVESTIGATIONS';
  if (/\b(report|intelligence report)\b/.test(q) && !/\bportfolio\b/.test(q)) return 'ASSET_REPORTS';
  if (/\b(portfolio|project uses)\b/.test(q)) return /\bwhich\b|\blist\b|\bassets in\b|\baren't\b/.test(q) ? 'PORTFOLIO_ASSETS' : 'PORTFOLIO_OVERVIEW';
  if (/\bhelp\b/.test(q) && /\b(pinit|hub|assistant)\b/.test(q)) return 'GENERAL_PINIT_HELP';
  if (/\bwho protected\b/.test(q)) return 'ASSET_PROTECTION_STATUS';
  if (/\b(dna identity|dna id|dna\/identity|what is (its |the |my asset )?dna|fingerprint|dna layers)\b/.test(q)
    || /\bwhat is the dna\b/.test(q)) return 'ASSET_DNA';
  if (/\b(origin id|sha-?256|identity of|asset id|registered identity|what makes this asset unique)\b/.test(q)) return 'ASSET_IDENTITY';
  if (/\b(filename|what type of asset)\b/.test(q)) return 'ASSET_IDENTITY';
  if (/\b(safe|tamper|authentic|is the original|protection status|is .{0,40}protected|currently protected)\b/.test(q)) {
    return 'ASSET_PROTECTION_STATUS';
  }
  if (/\bwhen was this asset protected\b/.test(q) || (/\bprotected\b/.test(q) && /\bwhen\b/.test(q) && !/\bcapture\b/.test(q))) {
    return 'ASSET_PROTECTION_STATUS';
  }

  if (/\b(stored|in my vault|where is the original preserved)\b/.test(q)) return 'ASSET_STORAGE';

  if (/\b(how ?many|number of|count)\b/.test(q) && /\b(links?|share|secure link)\b/.test(q)) return 'ASSET_SHARING';
  if (/\blinks?\b/.test(q) && /\b(created|create|creaded|secure|share)\b/.test(q)) return 'ASSET_SHARING';

  if (/\bwhere\b/.test(q) && /\b(access|accessed|opened)\b/.test(q)) return 'ASSET_LOCATION';
  if (/\b(place name|placename|palce name|exact (place|palce|location)|village|country|mandal|district|pincode|pin code)\b/.test(q)
    || /\bwhere .{0,40}(cptur|captur|taken|shot)\b/.test(q)
    || /\bcptur/.test(q)) {
    return 'ASSET_LOCATION';
  }
  if (/\bwhere\b/.test(q) || /\blocations?\b/.test(q) || /\b(gps|coordinates|geo)\b/.test(q)) return 'ASSET_LOCATION';

  if (/\b(when|what time|capture(d)? on|what date)\b/.test(q) && /\b(capture|took|taken|shot|recorded)\b/.test(q)) return 'ASSET_CAPTURE_TIME';
  if (/\bwhen did i capture\b/.test(q) || (/\bcapture(d)?\b/.test(q) && /\b(when|time|date|device|camera|method|uploaded)\b/.test(q))) {
    return 'ASSET_CAPTURE_TIME';
  }
  if (/\b(what device|what camera|capture method|uploaded instead|captured using pinit|original filename|metadata was recorded)\b/.test(q)) {
    return 'ASSET_CAPTURE_TIME';
  }

  if (/\bwhat happened to my assets\b/.test(q) || /\bshow my recent activity\b/.test(q) || /\brecent activity\b/.test(q)) {
    return 'RECENT_ACTIVITY';
  }
  if (/\bwhat happened recently\b/.test(q) || /\bwhat changed\b/.test(q)) return 'RECENT_ACTIVITY';
  if (/\b(complete journey|complete timeline|since i protected|from capture until|what happened first|what happened last)\b/.test(q)) {
    return 'ASSET_TIMELINE';
  }
  if (/\b(last activity|latest activity|what is happening)\b/.test(q)) return 'ASSET_ACTIVITY';

  if (/\bwho (has|have)\b/.test(q) || /\bshared with\b/.test(q)) return 'ASSET_SHARING';
  if (/\bwho (accessed|viewed)\b/.test(q)) return 'ASSET_VIEWS';
  if (/\bwho downloaded\b/.test(q)) return 'ASSET_DOWNLOADS';

  if (/\bhow many times\b/.test(q) && /\bdownload/.test(q)) return 'ASSET_DOWNLOADS';
  if (/\bdownload/.test(q) && (/\btoday\b|\brecent/.test(q) || /\bwhich assets\b/.test(q))) return 'RECENT_DOWNLOADS';
  if (/\bdownload/.test(q)) return 'ASSET_DOWNLOADS';
  if (/\b(view|views|opened|accessed)\b/.test(q) && !/\boverview\b/.test(q) && !/\bprotect/.test(q)) return 'ASSET_VIEWS';
  if (/\bshar(e|ed|ing)\b/.test(q) && /\b(recent|this week|today|which)\b/.test(q)) return 'RECENT_SHARES';
  if (/\bverif/.test(q)) return 'ASSET_VERIFICATION';
  if (/\b(timeline|journey)\b/.test(q)) return 'ASSET_TIMELINE';
  if (/\b(tell me (everything|the story|about)|hear (my )?story|living)\b/.test(q) || /\beverything about\b/.test(q)) {
    return 'ASSET_OVERVIEW';
  }
  if (/\bwhat happened\b/.test(q) || /\bdid anyone touch\b/.test(q) || /\bbeen through\b/.test(q)) return 'ASSET_ACTIVITY';

  if (/\b(how many (protected )?assets|show my assets|what are my assets|what assets did i protect|latest asset|last protected|first asset|find my|do i have an asset|which assets (are|were|did))\b/.test(q)
    || (/\bmy assets\b/.test(q) && /\b(list|show|which|all|how many)\b/.test(q))) {
    return 'USER_ASSETS';
  }
  if (/\bexplain this\b/.test(q)) return 'ASSET_REPORTS';
  return 'GENERAL_PINIT_HELP';
}

export function intentNeedsAsset(intent: AskPinitIntent): boolean {
  return intent.startsWith('ASSET_')
    && intent !== 'ASSETS_QUIET'
    && intent !== 'ASSET_INVESTIGATIONS'
    && intent !== 'ASSET_VIEWS'
    && intent !== 'ASSET_SHARING'
    && intent !== 'ASSET_DOWNLOADS'
    && intent !== 'ASSET_MONITORING'
    && intent !== 'ASSET_DUPLICATES'
    && intent !== 'ASSET_REPORTS';
}
