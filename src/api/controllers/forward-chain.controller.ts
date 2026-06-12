import { Request, Response, NextFunction } from 'express';
import { buildForwardChain } from '../../services/chain/forward-chain.service';

export async function getForwardChain(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { dnaRecordId } = req.params;
    if (!dnaRecordId) { res.status(400).json({ success: false, error: 'dnaRecordId required' }); return; }
    const graph = await buildForwardChain(dnaRecordId);
    res.json({ success: true, graph });
  } catch (err) { next(err); }
}
