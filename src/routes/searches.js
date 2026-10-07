import { Router } from 'express';
import { createSearch, getSearch, listSearches } from '../controllers/searches.controller.js';

const router = Router();

router.post('/', createSearch);
router.get('/', listSearches);
router.get('/:id', getSearch);

export default router;
