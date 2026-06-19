import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export type NotifType = 'LINK_VIEWED' | 'RISK_ALERT' | 'FORWARD_DETECTED' | 'CERT_GENERATED' | 'MONITORING_MATCH' | 'DNA_GENERATED' | 'VAULT_STORED';

interface CreateNotif {
  userId: string;
  type: NotifType;
  title: string;
  body: string;
  severity?: 'info' | 'warning' | 'critical';
  linkToken?: string;
  fileName?: string;
  ip?: string;
  country?: string;
  device?: string;
  riskLevel?: string;
}

class NotificationService {
  async create(input: CreateNotif) {
    try {
      // Check user notification preferences
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { notifyShareAccess: true, notifyRiskAlerts: true, notifyCertificates: true, notifyMonitoring: true },
      });
      if (!user) return;

      // Filter by preferences
      if (input.type === 'LINK_VIEWED' && !user.notifyShareAccess) return;
      if (input.type === 'FORWARD_DETECTED' && !user.notifyShareAccess) return;
      if (input.type === 'RISK_ALERT' && !user.notifyRiskAlerts) return;
      if (input.type === 'CERT_GENERATED' && !user.notifyCertificates) return;
      if (input.type === 'MONITORING_MATCH' && !user.notifyMonitoring) return;

      await prisma.notification.create({
        data: {
          userId:    input.userId,
          type:      input.type,
          title:     input.title,
          body:      input.body,
          severity:  input.severity ?? 'info',
          linkToken: input.linkToken,
          fileName:  input.fileName,
          ip:        input.ip,
          country:   input.country,
          device:    input.device,
          riskLevel: input.riskLevel,
        },
      });
    } catch (err) {
      logger.warn('[Notification] Failed to create', { error: String(err) });
    }
  }

  async linkViewed(userId: string, fileName: string, ip: string, country: string, device: string, linkToken: string) {
    await this.create({
      userId, type: 'LINK_VIEWED',
      title: 'Link Accessed',
      body: `${fileName} was viewed from ${country} · ${device}`,
      severity: 'info', linkToken, fileName, ip, country, device,
    });
  }

  async riskAlert(userId: string, fileName: string, riskLevel: string, ip: string, country: string, device: string, linkToken: string) {
    await this.create({
      userId, type: 'RISK_ALERT',
      title: `${riskLevel} Risk Detected`,
      body: `Suspicious access to ${fileName} from ${ip} · ${country}`,
      severity: riskLevel === 'CRITICAL' ? 'critical' : 'warning',
      linkToken, fileName, ip, country, device, riskLevel,
    });
  }

  async forwardDetected(userId: string, fileName: string, hopNumber: number, ip: string, country: string, linkToken: string) {
    await this.create({
      userId, type: 'FORWARD_DETECTED',
      title: `Link Forwarded — Hop ${hopNumber}`,
      body: `${fileName} was forwarded to a new person (${country} · ${ip})`,
      severity: 'warning', linkToken, fileName, ip, country,
    });
  }
}

export const notificationService = new NotificationService();
