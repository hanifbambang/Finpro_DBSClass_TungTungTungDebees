import { Router } from "express";
import { PokemonModel, TrainerModel, redis } from "../db.js";

const router = Router();

// GET /api/leaderboard
router.get("/leaderboard", async (req, res) => {
  const raw = await redis.zrevrange("leaderboard", 0, 10, "WITHSCORES");
  const result = [];
  for (let i = 0; i < raw.length; i += 2) {
    result.push({ name: raw[i], winRate: raw[i + 1] });
  }
  res.json(result);
});

// GET /api/rival — generate a random rival with a team of 6
router.get("/rival", async (req, res) => {
  const pokemonList = await PokemonModel.find({}, { id: 1, hp: 1, attack: 1, defense: 1, speed: 1, _id: 0 }).lean();
  const shuffled = [...pokemonList].sort(() => 0.5 - Math.random()).slice(0, 6);

  const rivalTeam = await Promise.all(
    shuffled.map(async (p: any) => {
      const full = await PokemonModel.findOne({ id: p.id }, { _id: 0, __v: 0 }).lean();
      const isRare = Math.random() < 0.2;
      const level = isRare
        ? Math.floor(Math.random() * 20) + 81
        : Math.floor(Math.random() * 80) + 1;
      return {
        ...full,
        level,
        hp:      Math.floor((parseInt(full!.hp)      * level) / 50) + 10,
        attack:  Math.floor((parseInt(full!.attack)  * level) / 50) + 5,
        defense: Math.floor((parseInt(full!.defense) * level) / 50) + 5,
        speed:   Math.floor((parseInt(full!.speed)   * level) / 50) + 5,
      };
    })
  );

  const rivalNames = ["Blue", "Silver", "Gary", "Paul", "Gladion", "Bede"];
  res.json({
    name: rivalNames[Math.floor(Math.random() * rivalNames.length)],
    team: rivalTeam,
  });
});

// POST /api/catch
router.post("/catch", async (req, res) => {
  const { trainerId, pokemonId, mood, multiplier = 1, level = 20, guaranteed = false } = req.body;

  console.log(`[CATCH] trainer=${trainerId} pokemon=${pokemonId} level=${level} multiplier=${multiplier} mood=${mood} guaranteed=${guaranteed}`);

  const trainer = await TrainerModel.findOne({ userId: trainerId });
  if (!trainer) return res.status(404).json({ error: "Trainer not found" });

  const teamIds: string[] = trainer.team || [];

  if (teamIds.length >= 6) {
    return res.status(400).json({
      code:  "PARTY_FULL",
      error: "COMMUNICATION ERROR: Trainer party at max capacity (6/6).",
    });
  }

  if (teamIds.map(String).includes(String(pokemonId))) {
    return res.status(400).json({
      code:  "ALREADY_CAUGHT",
      error: "LOGICAL ERROR: Biological signal already detected in active team.",
    });
  }

  // Master Ball: guaranteed catch
  if (guaranteed) {
    await TrainerModel.updateOne(
      { userId: trainerId },
      { $push: { team: pokemonId } }
    );
    return res.json({ success: true, message: `POKEMON_ID ${pokemonId} successfully serialized to active team.` });
  }

  const baseRate = Math.max(0.45, 0.90 - level / 200);
  let successRate = baseRate * multiplier;
  if (mood === "angry")  successRate *= 0.6;
  if (mood === "eating") successRate *= 1.15;
  successRate = Math.min(0.95, successRate);

  console.log(`[CATCH] baseRate=${baseRate.toFixed(2)} successRate=${successRate.toFixed(2)}`);

  if (Math.random() > successRate) {
    const fled = Math.random() < 0.05;
    return res.status(400).json({
      success: false,
      code:    fled ? "FLED" : "ESCAPED",
      fled,
      error:   fled ? "The Pokémon fled the encounter!" : "The wild creature broke free!",
    });
  }

  // Use $push to atomically append to the embedded team array
  await TrainerModel.updateOne(
    { userId: trainerId },
    { $push: { team: pokemonId } }
  );

  res.json({ success: true, message: `POKEMON_ID ${pokemonId} successfully serialized to active team.` });
});

export default router;
