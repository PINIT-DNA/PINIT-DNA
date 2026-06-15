import type { Request, Response } from 'express';
import * as recipientService from '../../services/forensic/recipient.service';

export async function listRecipients(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const recipients = await recipientService.listRecipients(userId);
    res.json({ recipients });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRecipient(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { label } = req.body;
    if (!label?.trim()) { res.status(400).json({ error: 'label is required' }); return; }
    const recipient = await recipientService.createRecipient(userId, label.trim());
    res.status(201).json({ recipient });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRecipient(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const recipient = await recipientService.getRecipient(userId, req.params['id']!);
    if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }
    res.json({ recipient });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteRecipient(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await recipientService.deleteRecipient(userId, req.params['id']!);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
