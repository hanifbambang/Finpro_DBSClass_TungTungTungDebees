import { Router } from "express";
import { TrainerModel, DEFAULT_INVENTORY, redis } from "../db.js";

const router = Router();

const SHOP_ITEMS: Record<string, { price: number; field: string }> = {
  pokeball:   { price: 50,   field: "pokeballs" },
  greatball:  { price: 150,  field: "greatballs" },
  ultraball:  { price: 400,  field: "ultraballs" },
  razzberry:  { price: 80,   field: "razzberries" },
  goldenrazz: { price: 500,  field: "goldenrazz" },
  masterball: { price: 5000, field: "masterballs" },
};

router.get("/:id", async (req, res) => {
  const t = await TrainerModel.findOne({ userId: req.params.id }, { _id: 0, __v: 0 }).lean();
  if (!t) return res.status(404).json({ error: "Trainer not found" });
  t.inventory = { ...DEFAULT_INVENTORY, ...(t.inventory || {}) };
  t.coins = t.coins ?? 500;
  res.json(t);
});

router.post("/:id/inventory", async (req, res) => {
  const { inventory } = req.body;
  if (!inventory) return res.status(400).json({ error: "No inventory provided" });
  const trainer = await TrainerModel.findOne({ userId: req.params.id });
  if (!trainer) return res.status(404).json({ error: "Trainer not found" });
  await TrainerModel.updateOne({ userId: req.params.id }, { $set: { inventory } });
  res.json({ success: true });
});

router.post("/:id/buy", async (req, res) => {
  const { item, qty = 1 } = req.body;
  const shopItem = SHOP_ITEMS[item];
  if (!shopItem) return res.status(400).json({ error: "Unknown item" });

  const trainer = await TrainerModel.findOne({ userId: req.params.id }).lean();
  if (!trainer) return res.status(404).json({ error: "Trainer not found" });

  const totalCost = shopItem.price * qty;
  const currentCoins = trainer.coins ?? 500;
  if (currentCoins < totalCost) {
    return res.status(400).json({
      code: "INSUFFICIENT_FUNDS",
      error: `Not enough coins. Need ${totalCost}, have ${currentCoins}.`,
    });
  }

  const inventory: Record<string, number> = { ...DEFAULT_INVENTORY, ...(trainer.inventory || {}) };
  inventory[shopItem.field] = (inventory[shopItem.field] || 0) + qty;
  const newCoins = currentCoins - totalCost;

  await TrainerModel.updateOne({ userId: req.params.id }, { $set: { inventory, coins: newCoins } });
  res.json({ success: true, coins: newCoins, inventory });
});

router.post("/:id/earn", async (req, res) => {
  const { amount } = req.body;
  if (!amount || typeof amount !== "number" || amount <= 0)
    return res.status(400).json({ error: "Invalid amount" });

  const trainer = await TrainerModel.findOne({ userId: req.params.id }).lean();
  if (!trainer) return res.status(404).json({ error: "Trainer not found" });

  const newCoins = (trainer.coins ?? 500) + Math.floor(amount);
  await TrainerModel.updateOne({ userId: req.params.id }, { $set: { coins: newCoins } });
  res.json({ success: true, coins: newCoins, earned: Math.floor(amount) });
});

router.post("/:id/win", async (req, res) => {
  const trainer = await TrainerModel.findOne({ userId: req.params.id }).lean();
  if (!trainer) return res.status(404).json({ error: "Trainer not found" });

  const newWins = (parseInt(trainer.wins) || 0) + 1;
  await TrainerModel.updateOne({ userId: req.params.id }, { $set: { wins: newWins.toString() } });

  const losses = parseInt(trainer.losses) || 0;
  const total = newWins + losses;
  const winRate = total > 0 ? (newWins / total) * 100 : 0;

  await redis.zadd("leaderboard", winRate, trainer.name);
  res.json({ success: true, wins: newWins, winRate });
});

router.post("/:id/loss", async (req, res) => {
  const trainer = await TrainerModel.findOne({ userId: req.params.id }).lean();
  if (!trainer) return res.status(404).json({ error: "Trainer not found" });

  const newLosses = (parseInt(trainer.losses) || 0) + 1;
  await TrainerModel.updateOne({ userId: req.params.id }, { $set: { losses: newLosses.toString() } });

  const wins = parseInt(trainer.wins) || 0;
  const total = wins + newLosses;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  await redis.zadd("leaderboard", winRate, trainer.name);
  res.json({ success: true, losses: newLosses, winRate });
});

export default router;
