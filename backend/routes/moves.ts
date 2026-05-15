import { Router } from "express";
import { MoveModel } from "../db.js";

const router = Router();

// GET /api/moves — all battle moves
router.get("/", async (req, res) => {
  const moves = await MoveModel.find({}, { _id: 0, __v: 0 }).lean();
  res.json(moves);
});

export default router;
