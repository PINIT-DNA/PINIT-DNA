/**
 * Public client-report access.
 *
 * No authentication: the token in the URL is the entire credential, so every
 * access decision (issued, not revoked, not expired) is made in the service.
 * These handlers deliberately do nothing clever — they must not add a branch
 * that could return more than the frozen snapshot.
 *
 * The response is the redacted snapshot exactly as it was sealed at issue time.
 * No organization context, no ids, no live queries against campaign data.
 */
import { Request, Response, NextFunction } from 'express';

export const clientReportController = {
  /** The client's web view of the report. */
  async getClientReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { campaignClientReportService } = await import(
        '../../services/organization/campaign-client-report.service');
      const report = await campaignClientReportService.getForClient(
        req.params.token as string);
      res.json({ success: true, report });
    } catch (err) { next(err); }
  },

  /** The same content as a PDF, rendered from the same snapshot. */
  async downloadClientReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { campaignClientReportService } = await import(
        '../../services/organization/campaign-client-report.service');
      const { pdf, filename } = await campaignClientReportService.renderForClient(
        req.params.token as string);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(pdf);
    } catch (err) { next(err); }
  },
};
