/**
 * PINIT-DNA — Super Admin Console API: Verification requests and support tickets.
 * (Split out of super-admin.controller.ts, which re-exports it; handler code is unchanged.)
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../middleware/error.middleware';
import {} from '../../../lib/health';
import { adminAuditService } from '../../../services/audit/admin-audit.service';
import {} from '../../../lib/platform-owner';



// ─── Verification Requests (manual KYC, reviewed via this console) ────────
// There is no self-serve submission flow in the main app yet, so requests
// are logged here by an admin (e.g. after a phone call or emailed documents)
// and then reviewed/decided here too.

export async function listVerificationRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const [requests, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.verificationRequest.findMany({
        where: { status },
        include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
      prisma.verificationRequest.count({ where: { status: 'APPROVED' } }),
      prisma.verificationRequest.count({ where: { status: 'REJECTED' } }),
    ]);

    const reviewerIds = [...new Set(requests.map((r) => r.reviewedByUserId).filter((v): v is string => !!v))];
    const reviewers = reviewerIds.length
      ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, shortId: true, fullName: true } })
      : [];
    const reviewerById = new Map(reviewers.map((r) => [r.id, r]));

    res.json({
      success: true,
      requests: requests.map((r) => ({
        ...r,
        reviewer: r.reviewedByUserId ? reviewerById.get(r.reviewedByUserId) ?? null : null,
      })),
      total: requests.length,
      pendingCount,
      approvedCount,
      rejectedCount,
    });
  } catch (err) {
    next(err);
  }
}

export async function createVerificationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, shortId, requestType, documentType, submittedNote } = req.body as {
      userId?: string; shortId?: string; requestType?: string; documentType?: string; submittedNote?: string;
    };
    if (!userId && !shortId) {
      next(new AppError(400, 'userId or shortId is required'));
      return;
    }
    const user = await prisma.user.findUnique({
      where: userId ? { id: userId } : { shortId: shortId!.trim().toUpperCase() },
      select: { id: true, shortId: true },
    });
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }

    const created = await prisma.verificationRequest.create({
      data: {
        userId: user.id,
        requestType: requestType || 'IDENTITY',
        documentType: documentType || null,
        submittedNote: submittedNote || null,
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'verification.request_logged',
        targetType: 'VerificationRequest',
        targetId: created.id,
        after: { userId: user.id, requestType: created.requestType },
        req,
      });
    }

    res.status(201).json({ success: true, request: created });
  } catch (err) {
    next(err);
  }
}

export async function reviewVerificationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { decision, reviewNote } = req.body as { decision?: string; reviewNote?: string };
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      next(new AppError(400, 'decision must be APPROVED or REJECTED'));
      return;
    }

    const existing = await prisma.verificationRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      next(new AppError(404, 'Verification request not found'));
      return;
    }
    if (existing.status !== 'PENDING') {
      next(new AppError(409, `Request already decided (${existing.status})`));
      return;
    }

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    const updated = await prisma.verificationRequest.update({
      where: { id: req.params.id },
      data: {
        status: decision,
        reviewedByUserId: actor?.sub ?? null,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: decision === 'APPROVED' ? 'verification.approved' : 'verification.rejected',
        targetType: 'VerificationRequest',
        targetId: updated.id,
        before: { status: existing.status },
        after: { status: updated.status, reviewNote: updated.reviewNote },
        req,
      });
    }

    res.json({ success: true, request: updated });
  } catch (err) {
    next(err);
  }
}

// ─── Support Tickets & Disputes ────────────────────────────────────────────
// No self-serve submission flow in the main app yet — admins log tickets on
// a user's behalf (e.g. after an email/support-channel conversation), then
// respond and resolve here. "Dispute" is just category: 'DISPUTE'.

export async function listSupportTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;

    const [tickets, openCount, disputeCount, resolvedCount] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { status, category },
        include: {
          user: { select: { id: true, shortId: true, fullName: true, email: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      prisma.supportTicket.count({ where: { category: 'DISPUTE', status: { not: 'RESOLVED' } } }),
      prisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
    ]);

    res.json({
      success: true,
      tickets: tickets.map((t) => ({ ...t, messageCount: t._count.messages, _count: undefined })),
      total: tickets.length,
      openCount,
      disputeCount,
      resolvedCount,
    });
  } catch (err) {
    next(err);
  }
}

export async function getSupportTicketDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, shortId: true, fullName: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) {
      next(new AppError(404, 'Ticket not found'));
      return;
    }
    res.json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
}

export async function createSupportTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, shortId, subject, category, priority, description } = req.body as {
      userId?: string; shortId?: string; subject?: string; category?: string; priority?: string; description?: string;
    };
    if (!subject || !description) {
      next(new AppError(400, 'subject and description are required'));
      return;
    }
    if (!userId && !shortId) {
      next(new AppError(400, 'userId or shortId is required'));
      return;
    }
    const user = await prisma.user.findUnique({
      where: userId ? { id: userId } : { shortId: shortId!.trim().toUpperCase() },
      select: { id: true, shortId: true },
    });
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }

    const created = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject,
        description,
        category: category || 'GENERAL',
        priority: priority || 'NORMAL',
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'support.ticket_opened',
        targetType: 'SupportTicket',
        targetId: created.id,
        after: { userId: user.id, subject, category: created.category },
        req,
      });
    }

    res.status(201).json({ success: true, ticket: { ...created, messageCount: 0 } });
  } catch (err) {
    next(err);
  }
}

export async function addSupportTicketMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { body, isInternal } = req.body as { body?: string; isInternal?: boolean };
    if (!body) {
      next(new AppError(400, 'body is required'));
      return;
    }
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      next(new AppError(404, 'Ticket not found'));
      return;
    }

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    const [message] = await prisma.$transaction([
      prisma.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: actor?.sub ?? null,
          authorLabel: actor?.shortId ?? 'Admin',
          body,
          isInternal: !!isInternal,
        },
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status },
      }),
    ]);

    res.status(201).json({ success: true, message });
  } catch (err) {
    next(err);
  }
}

export async function resolveSupportTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { resolutionNote } = req.body as { resolutionNote?: string };
    const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      next(new AppError(404, 'Ticket not found'));
      return;
    }

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        resolvedByUserId: actor?.sub ?? null,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote || null,
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'support.ticket_resolved',
        targetType: 'SupportTicket',
        targetId: updated.id,
        before: { status: existing.status },
        after: { status: updated.status, resolutionNote: updated.resolutionNote },
        req,
      });
    }

    res.json({ success: true, ticket: updated });
  } catch (err) {
    next(err);
  }
}
