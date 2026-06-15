import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { listRecipients, createRecipient, getRecipient, deleteRecipient } from '../controllers/recipients.controller';

export const recipientsRouter = Router();

recipientsRouter.get('/', requireAuth, listRecipients);
recipientsRouter.post('/', requireAuth, createRecipient);
recipientsRouter.get('/:id', requireAuth, getRecipient);
recipientsRouter.delete('/:id', requireAuth, deleteRecipient);
