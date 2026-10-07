import { Router } from 'express';
import {
  enrichLead,
  enrichPendingLeads,
  getLead,
  listLeads,
  updateLead,
} from '../controllers/leads.controller.js';

const router = Router();

router.get('/', listLeads);
router.post('/enrich-pending', enrichPendingLeads);
router.get('/:id', getLead);
router.patch('/:id', updateLead);
router.post('/:id/enrich', enrichLead);

export default router;
