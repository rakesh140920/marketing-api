import { Router } from 'express';
import { streamEvents } from '../controllers/events.controller.js';

const router = Router();

router.get('/', streamEvents);

export default router;
