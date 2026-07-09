import type { ICrawlerConnector } from '../types';
import { websiteConnector } from './website.connector';
import { githubConnector } from './github.connector';
import { youtubeConnector } from './youtube.connector';
import { redditConnector } from './reddit.connector';
import { telegramConnector } from './telegram.connector';

export const allConnectors: ICrawlerConnector[] = [
  websiteConnector,
  githubConnector,
  youtubeConnector,
  redditConnector,
  telegramConnector,
];

export function getActiveConnectors(): ICrawlerConnector[] {
  return allConnectors.filter(c => c.isConfigured());
}

export {
  websiteConnector,
  githubConnector,
  youtubeConnector,
  redditConnector,
  telegramConnector,
};
