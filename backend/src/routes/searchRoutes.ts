import { Router } from "express";
import { symptomSearch } from "../controllers/searchController";

const router = Router();

router.get("/symptom", symptomSearch);

export default router;
