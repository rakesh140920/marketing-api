import { Router } from 'express';
import {
  approveEmail,
  draftEmails,
  listEmails,
  rejectEmail,
  updateEmail,
} from '../controllers/emails.controller.js';

const router = Router();

router.post('/draft', draftEmails);
router.get('/', listEmails);
router.patch('/:id', updateEmail);
router.post('/:id/approve', approveEmail);
router.post('/:id/reject', rejectEmail);

export default router;
