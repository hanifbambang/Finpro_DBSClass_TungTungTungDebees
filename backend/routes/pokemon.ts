import { Router } from "express";
import { PokemonModel, TrainerModel } from "../db.js";

const router = Router();

// GET /api/pokemon — all Pokémon
router.get("/", async (req, res) => {
  const all = await PokemonModel.find({}, { _id: 0, __v: 0 }).lean();
  res.json(all);
});

// GET /api/pokemon/random — random Pokémon, filtered by trainer's caught team
router.get("/random", async (req, res) => {
  const { trainerId } = req.query;

  let all = await PokemonModel.find({}, { _id: 0, __v: 0 }).lean();
  if (all.length === 0)
    return res.status(404).json({ error: "No pokemon found" });

  if (trainerId) {
    const trainer = await TrainerModel.findOne({ userId: trainerId }).lean();
    if (trainer) {
      const caughtIds = (trainer.team || []).map(String);
      if (caughtIds.length > 0) {
        const filtered = all.filter(
          (p: any) => !caughtIds.includes(String(p.id))
        );
        if (filtered.length > 0) all = filtered;
      }
    }
  }

  const random = all[Math.floor(Math.random() * all.length)];
  res.json(random);
});

// GET /api/pokemon/:id
router.get("/:id", async (req, res) => {
  const p = await PokemonModel.findOne({ id: req.params.id }, { _id: 0, __v: 0 }).lean();
  if (!p) return res.status(404).json({ error: "Pokemon not found" });
  res.json(p);
});

// POST /api/pokemon/:id/moves — update moveset
router.post("/:id/moves", async (req, res) => {
  const { moves } = req.body;
  if (!moves || !Array.isArray(moves) || moves.length > 4) {
    return res
      .status(400)
      .json({ error: "Invalid moveset. (max 4 moves)" });
  }
  await PokemonModel.updateOne(
    { id: req.params.id },
    { moves: moves.join(",") }
  );
  res.json({ success: true, moves: moves.join(",") });
});

export default router;
