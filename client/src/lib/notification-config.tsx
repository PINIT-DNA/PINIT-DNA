import {
  Bell, Eye, GitBranch, Award, Radio, AlertTriangle, Dna, Archive, Download,
  Copy, Camera, Ban, Shield, FileSearch, Trash2, Link2, Lock, KeyRound,
  MapPin, Globe, Fingerprint, CheckCircle, XCircle, Play, Pause, Square,
  Bot, FileWarning, UserPlus, RefreshCw, Clock, Zap, Server,
} from 'lucide-react';

export interface NotificationItem {
  id: string;
  createdAt: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  category?: string;
  read: boolean;
  archived?: boolean;
  linkToken?: string;
  fileName?: string;
  riskLevel?: string;
  country?: string;
  device?: string;
  ip?: string;
  deepLink?: string;
  aggregateCount?: number;
}

export const NOTIFICATION_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  // Share
  LINK_VIEWED:              { icon: <Eye size={13} />,           color: 'text-blue-400 bg-blue-500/20' },
  LINK_DOWNLOADED:          { icon: <Download size={13} />,      color: 'text-cyan-400 bg-cyan-500/20' },
  LINK_CREATED:             { icon: <Link2 size={13} />,         color: 'text-indigo-400 bg-indigo-500/20' },
  FORWARD_DETECTED:         { icon: <GitBranch size={13} />,     color: 'text-orange-400 bg-orange-500/20' },
  LINK_REVOKED:             { icon: <Ban size={13} />,           color: 'text-gray-400 bg-gray-500/20' },
  LINK_EXPIRED:             { icon: <Clock size={13} />,         color: 'text-gray-400 bg-gray-500/20' },
  LINK_EXPIRY_WARNING:      { icon: <Clock size={13} />,         color: 'text-yellow-400 bg-yellow-500/20' },
  LINK_ONE_TIME_CONSUMED:   { icon: <Link2 size={13} />,         color: 'text-indigo-300 bg-indigo-500/20' },
  MAX_DOWNLOADS_REACHED:    { icon: <Download size={13} />,      color: 'text-orange-400 bg-orange-500/20' },
  RISK_ALERT:               { icon: <AlertTriangle size={13} />, color: 'text-red-400 bg-red-500/20' },
  POLICY_BLOCKED:           { icon: <Shield size={13} />,        color: 'text-orange-400 bg-orange-500/20' },
  VPN_BLOCKED:              { icon: <Shield size={13} />,        color: 'text-orange-400 bg-orange-500/20' },
  TOR_BLOCKED:              { icon: <Shield size={13} />,        color: 'text-red-400 bg-red-500/20' },
  GEO_BLOCKED:              { icon: <MapPin size={13} />,        color: 'text-orange-400 bg-orange-500/20' },
  UNAUTHORIZED_ACCESS:      { icon: <Ban size={13} />,           color: 'text-red-400 bg-red-500/20' },
  COPY_ATTEMPT:             { icon: <Copy size={13} />,          color: 'text-yellow-400 bg-yellow-500/20' },
  SCREENSHOT_ATTEMPT:       { icon: <Camera size={13} />,        color: 'text-pink-400 bg-pink-500/20' },
  PRINT_ATTEMPT:            { icon: <AlertTriangle size={13} />, color: 'text-orange-400 bg-orange-500/20' },
  SCREEN_RECORDING_ATTEMPT: { icon: <Camera size={13} />,        color: 'text-pink-400 bg-pink-500/20' },
  DUPLICATE_UPLOAD_ATTEMPT: { icon: <Shield size={13} />,        color: 'text-orange-400 bg-orange-500/20' },

  // Vault / DNA
  VAULT_STORED:             { icon: <Archive size={13} />,       color: 'text-green-400 bg-green-500/20' },
  VAULT_DELETED:            { icon: <Trash2 size={13} />,        color: 'text-red-400 bg-red-500/20' },
  VAULT_ENCRYPTION_FAILED:  { icon: <FileWarning size={13} />,   color: 'text-red-400 bg-red-500/20' },
  DNA_GENERATED:            { icon: <Dna size={13} />,           color: 'text-dna-400 bg-dna-500/20' },
  DNA_VERIFY_SUCCESS:       { icon: <CheckCircle size={13} />,   color: 'text-green-400 bg-green-500/20' },
  DNA_VERIFY_FAILED:        { icon: <XCircle size={13} />,       color: 'text-red-400 bg-red-500/20' },
  DNA_MISMATCH:             { icon: <Fingerprint size={13} />,   color: 'text-red-400 bg-red-500/20' },
  PROTECTED_DOWNLOAD_READY: { icon: <Lock size={13} />,          color: 'text-green-400 bg-green-500/20' },
  TEP_CREATED:              { icon: <Lock size={13} />,          color: 'text-green-400 bg-green-500/20' },
  TEP_REVOKED:              { icon: <Ban size={13} />,           color: 'text-gray-400 bg-gray-500/20' },
  DOWNLOAD_COMPLETED:       { icon: <Download size={13} />,      color: 'text-cyan-400 bg-cyan-500/20' },
  DOWNLOAD_FAILED:          { icon: <XCircle size={13} />,       color: 'text-red-400 bg-red-500/20' },

  // Certificates
  CERT_GENERATED:           { icon: <Award size={13} />,         color: 'text-purple-400 bg-purple-500/20' },
  CERT_REVOKED:             { icon: <Award size={13} />,         color: 'text-red-400 bg-red-500/20' },
  CERT_EXPIRED:             { icon: <Clock size={13} />,         color: 'text-yellow-400 bg-yellow-500/20' },
  CERT_VALIDATION_FAILED:   { icon: <XCircle size={13} />,       color: 'text-red-400 bg-red-500/20' },

  // Monitoring
  MONITORING_MATCH:         { icon: <Radio size={13} />,         color: 'text-yellow-400 bg-yellow-500/20' },
  MONITORING_STARTED:       { icon: <Play size={13} />,          color: 'text-green-400 bg-green-500/20' },
  MONITORING_PAUSED:        { icon: <Pause size={13} />,         color: 'text-yellow-400 bg-yellow-500/20' },
  MONITORING_RESUMED:       { icon: <Play size={13} />,          color: 'text-blue-400 bg-blue-500/20' },
  MONITORING_STOPPED:       { icon: <Square size={13} />,        color: 'text-gray-400 bg-gray-500/20' },
  CRAWLER_SCAN_COMPLETED:   { icon: <Globe size={13} />,         color: 'text-blue-400 bg-blue-500/20' },
  CRAWLER_ERROR:            { icon: <AlertTriangle size={13} />, color: 'text-orange-400 bg-orange-500/20' },
  DUPLICATE_INTERNET_COPY:  { icon: <Globe size={13} />,         color: 'text-red-400 bg-red-500/20' },
  RISK_INCREASED:           { icon: <AlertTriangle size={13} />, color: 'text-red-400 bg-red-500/20' },

  // Investigation / AI
  INVESTIGATION_STARTED:    { icon: <FileSearch size={13} />,     color: 'text-blue-400 bg-blue-500/20' },
  INVESTIGATION_COMPLETED:  { icon: <FileSearch size={13} />,     color: 'text-dna-400 bg-dna-500/20' },
  INVESTIGATION_FAILED:     { icon: <XCircle size={13} />,       color: 'text-red-400 bg-red-500/20' },
  AI_TAMPERING_DETECTED:    { icon: <Bot size={13} />,           color: 'text-red-400 bg-red-500/20' },
  DEEPFAKE_DETECTED:        { icon: <Bot size={13} />,           color: 'text-red-400 bg-red-500/20' },
  METADATA_MODIFIED:        { icon: <FileWarning size={13} />,   color: 'text-orange-400 bg-orange-500/20' },
  IMAGE_EDITED:             { icon: <Camera size={13} />,        color: 'text-orange-400 bg-orange-500/20' },

  // Account / security
  LOGIN_SUCCESS:            { icon: <CheckCircle size={13} />,   color: 'text-green-400 bg-green-500/20' },
  LOGIN_NEW_DEVICE:         { icon: <Shield size={13} />,        color: 'text-yellow-400 bg-yellow-500/20' },
  LOGIN_NEW_LOCATION:       { icon: <MapPin size={13} />,        color: 'text-yellow-400 bg-yellow-500/20' },
  LOGIN_FAILED:             { icon: <XCircle size={13} />,       color: 'text-orange-400 bg-orange-500/20' },
  LOGIN_FAILED_MULTIPLE:    { icon: <AlertTriangle size={13} />, color: 'text-red-400 bg-red-500/20' },
  PASSWORD_CHANGED:         { icon: <KeyRound size={13} />,      color: 'text-green-400 bg-green-500/20' },
  SESSION_REVOKED:          { icon: <Ban size={13} />,           color: 'text-gray-400 bg-gray-500/20' },
  PHONE_CHANGED:            { icon: <RefreshCw size={13} />,     color: 'text-blue-400 bg-blue-500/20' },
  EMAIL_CHANGED:            { icon: <RefreshCw size={13} />,     color: 'text-blue-400 bg-blue-500/20' },
  USER_REGISTERED:          { icon: <UserPlus size={13} />,      color: 'text-dna-400 bg-dna-500/20' },

  // Automation / system
  AUTOMATION_COMPLETED:     { icon: <Zap size={13} />,           color: 'text-blue-400 bg-blue-500/20' },
  AUTOMATION_FAILED:        { icon: <Zap size={13} />,           color: 'text-red-400 bg-red-500/20' },
  SCHEDULED_SCAN_FINISHED:  { icon: <Globe size={13} />,         color: 'text-blue-400 bg-blue-500/20' },
  STORAGE_WARNING:          { icon: <Server size={13} />,        color: 'text-yellow-400 bg-yellow-500/20' },
  SYSTEM_MAINTENANCE:       { icon: <Server size={13} />,        color: 'text-gray-400 bg-gray-500/20' },
  HIGH_RISK_INCIDENT:       { icon: <AlertTriangle size={13} />, color: 'text-red-400 bg-red-500/20' },
};

export const NOTIFICATION_SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-red-500',
  warning:  'border-l-orange-400',
  info:     'border-l-transparent',
  success:  'border-l-green-500',
};

export const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  sharing: 'Secure Share',
  security: 'Security',
  vault: 'Vault',
  monitoring: 'Monitoring',
  certificates: 'Certificates',
  investigation: 'Investigation',
  account: 'Account',
  automation: 'Automation',
};

export function resolveNotificationDeepLink(n: NotificationItem): string {
  if (n.deepLink) return n.deepLink;
  if (n.linkToken) return '/access-intelligence';
  if (n.category === 'monitoring') return '/monitoring';
  if (n.category === 'account') return '/profile?tab=security';
  if (n.type === 'DUPLICATE_UPLOAD_ATTEMPT') return '/duplicate-attempts';
  if (n.type.startsWith('INVESTIGATION_') || n.type === 'AI_TAMPERING_DETECTED') return '/investigation';
  if (n.type.startsWith('CERT_')) return '/certificates';
  if (n.type.startsWith('DNA_')) return '/dna';
  return '/profile?tab=notifications';
}

export function notificationTypeConfig(type: string) {
  return NOTIFICATION_TYPE_CONFIG[type] ?? { icon: <Bell size={13} />, color: 'text-gray-400 bg-gray-500/20' };
}
