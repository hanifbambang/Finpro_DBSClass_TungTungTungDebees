import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { UserModel, TrainerModel, DEFAULT_INVENTORY } from "../db.js";

const router = Router();
const JWT_SECRET =
  process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });

  // Check for existing user
  const existing = await UserModel.findOne({ username });
  if (existing) return res.status(400).json({ error: "User exists" });

  const userId = crypto.randomUUID();
  const hashed = await bcrypt.hash(password, 10);

  // Create user document
  await UserModel.create({ id: userId, username, password: hashed });

  // Create linked trainer profile (embedded team & inventory — no JOIN needed)
  await TrainerModel.create({
    userId,
    name:      username,
    wins:      "0",
    losses:    "0",
    team:      [],
    coins:     500,
    inventory: { ...DEFAULT_INVENTORY },
  });

  const token = jwt.sign({ id: userId, username }, JWT_SECRET, {
    expiresIn: "24h",
  });
  res.json({ token, user: { id: userId, username } });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const userData = await UserModel.findOne({ username });
  if (!userData || !userData.password)
    return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, userData.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: userData.id, username },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
  res.json({ token, user: { id: userData.id, username } });
});

export default router;
