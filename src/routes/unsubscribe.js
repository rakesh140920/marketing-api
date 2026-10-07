import { Router } from 'express';
import { confirmUnsubscribe, showUnsubscribe } from '../controllers/unsubscribe.controller.js';

const router = Router();

router.get('/:token', showUnsubscribe);
router.post('/:token', confirmUnsubscribe);

export default router;
