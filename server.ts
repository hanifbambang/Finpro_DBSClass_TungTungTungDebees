import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- MongoDB Setup ---
  let db: any = null;
  let mongoClient: MongoClient | null = null;
  try {
    const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
    mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await mongoClient.connect();
    db = mongoClient.db("pokedex");
    console.log("Connected to MongoDB.");
  } catch (error) {
    console.warn("MongoDB connection failed. Using in-memory fallback for Dev Preview.");
    // In-memory fallback for AI Studio preview environment
    const collections: any = {};
    db = {
      collection: (name: string) => {
        if (!collections[name]) {
          collections[name] = {
            data: [],
            findOne: async (query: any) => collections[name].data.find((d: any) => Object.keys(query).every(k => d[k] === query[k])),
            find: (query?: any) => ({
              toArray: async () => query ? collections[name].data.filter((d: any) => Object.keys(query).every(k => d[k] === query[k])) : collections[name].data
            }),
            insertOne: async (doc: any) => collections[name].data.push(doc),
            updateOne: async (query: any, update: any) => {
              const item = collections[name].data.find((d: any) => Object.keys(query).every(k => d[k] === query[k]));
              if (item && update.$set) { Object.assign(item, update.$set); }
            },
            deleteMany: async () => { collections[name].data = []; }
          };
        }
        return collections[name];
      }
    };
  }

  // --- Redis Setup ---
  let redis: any;
  const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6380";
  if (REDIS_URL) {
    console.log("Connecting to Redis...");
    const redisOptions: any = { maxRetriesPerRequest: 1 };
    if (process.env.REDIS_PASSWORD) {
      redisOptions.password = process.env.REDIS_PASSWORD;
    }
    redis = new Redis(REDIS_URL, redisOptions);
    redis.on('error', (err: any) => console.warn('Redis error', err.message));
    
    try {
      await redis.ping();
      console.log("Connected to Redis.");
    } catch (error: any) {
      console.warn("Redis connection/auth failed:", error.message, "- Falling back to Mock Redis");
      redis.disconnect();
      redis = null;
    }
  }

  if (!redis) {
    console.log("Redis connection failed or REDIS_URL not set. Using in-memory mock Redis.");
    // Enhanced Mock Redis
    redis = {
      data: new Map(),
      hset: async (key: string, field: string, value: string) => {
        if (!redis.data.has(key)) redis.data.set(key, {});
        redis.data.get(key)[field] = value;
      },
      hget: async (key: string, field: string) => {
        const val = redis.data.get(key);
        return val ? val[field] : null;
      },
      hgetall: async (key: string) => redis.data.get(key) || {},
      set: async (key: string, value: string) => redis.data.set(key, value),
      get: async (key: string) => redis.data.get(key) || null,
      exists: async (key: string) => redis.data.has(key) ? 1 : 0,
      zadd: async (set: string, score: number, member: string) => {
        if (!redis.data.has(set)) redis.data.set(set, []);
        const items = redis.data.get(set);
        const existingIdx = items.findIndex((i: any) => i.member === member);
        if (existingIdx !== -1) items[existingIdx].score = score;
        else items.push({ score, member });
        items.sort((a: any, b: any) => b.score - a.score);
      },
      zrevrange: async (set: string, start: number, end: number, withScores?: string) => {
        const items = redis.data.get(set) || [];
        const result = items.slice(start, end + 1);
        if (withScores) return result.flatMap((i: any) => [i.member, i.score.toString()]);
        return result.map((i: any) => i.member);
      }
    };
  }

  // --- Seed Data (Initial Pokemon & Moves) ---
  const seedData = async () => {
    console.log("Initializing Retro Archive Seeding...");
    
    // Check if seeded
    const existing = await db.collection("pokemon").find().toArray();
    if (existing.length > 0) {
      console.log("Database already seeded.");
      return;
    }
    
    // Gen 1 Moves
    const moves = [
      { id: "1", name: "Thunderbolt", type: "Electric", pwr: 90, acc: 100, effect: "A strong electric blast crashes down on the target." },
      { id: "2", name: "Quick Attack", type: "Normal", pwr: 40, acc: 100, effect: "An extremely fast attack that always strikes first." },
      { id: "3", name: "Razor Leaf", type: "Grass", pwr: 55, acc: 95, effect: "Sharp-edged leaves are launched to slash at the foe." },
      { id: "4", name: "Flamethrower", type: "Fire", pwr: 90, acc: 100, effect: "The target is scorched with an intense blast of fire." },
      { id: "5", name: "Hydro Pump", type: "Water", pwr: 110, acc: 80, effect: "The target is blasted by a huge volume of water." },
      { id: "6", name: "Psychic", type: "Psychic", pwr: 90, acc: 100, effect: "The foe is hit by a strong telekinetic force." },
      { id: "7", name: "Earthquake", type: "Ground", pwr: 100, acc: 100, effect: "A powerful earthquake that strikes all Pokemon." },
      { id: "8", name: "Slash", type: "Normal", pwr: 70, acc: 100, effect: "The target is slashed with claws or scythes." }
    ];

    for (const m of moves) {
      await db.collection("moves").insertOne(m);
    }

    try {
      console.log("Fetching National Pokedex (Gen 1) from PokeAPI...");
      const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=151");
      const { results } = await response.json();
      
      const CHUNK_SIZE = 20;
      for (let i = 0; i < results.length; i += CHUNK_SIZE) {
        const chunk = results.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (p: any) => {
          const id = p.url.split("/").filter(Boolean).pop();

          const detRes = await fetch(p.url);
          const details = await detRes.json();

          let flavorText = "No description available.";
          try {
            const speciesRes = await fetch(details.species.url);
            const speciesData = await speciesRes.json();
            flavorText = speciesData.flavor_text_entries.find((entry: any) => entry.language.name === "en")?.flavor_text.replace(/\f/g, " ") || "No description available.";
          } catch (e) {
            console.warn(`Could not fetch flavor text for ${details.name}`);
          }

          const stats: any = {};
          details.stats.forEach((s: any) => {
            const name = s.stat.name === "special-attack" ? "spAtk" : 
                         s.stat.name === "special-defense" ? "spDef" : s.stat.name;
            stats[name] = s.base_stat;
          });

          const pData = {
            id,
            name: details.name.charAt(0).toUpperCase() + details.name.slice(1),
            hp: stats.hp.toString(),
            attack: stats.attack.toString(),
            defense: stats.defense.toString(),
            spAtk: (stats.spAtk || stats.special || 50).toString(),
            spDef: (stats.spDef || stats.special || 50).toString(),
            speed: stats.speed.toString(),
            types: details.types.map((t: any) => t.type.name.charAt(0).toUpperCase() + t.type.name.slice(1)).join(","),
            abilities: details.abilities.map((a: any) => a.ability.name).join(","),
            moves: details.moves.slice(0, 4).map((m: any) => m.move.name.split("-").map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")).join(","),
            description: flavorText,
            sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`
          };

          await db.collection("pokemon").insertOne(pData);
        }));
        console.log(`Seeded ${Math.min(i + CHUNK_SIZE, 151)} / 151 Pokemon...`);
      }

      console.log("Pokedex Seeding Complete.");
    } catch (error) {
      console.error("Failed to seed from PokeAPI, using robust fallback:", error);
      const fallbackPokemon = [
        { id: "25", name: "Pikachu", hp: "35", attack: "55", defense: "40", spAtk: "50", spDef: "50", speed: "90", types: "Electric", sprite: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png", moves: "Thunderbolt,Quick Attack" },
        { id: "1", name: "Bulbasaur", hp: "45", attack: "49", defense: "49", spAtk: "65", spDef: "65", speed: "45", types: "Grass,Poison", sprite: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png", moves: "Razor Leaf,Tackle" },
        { id: "4", name: "Charmander", hp: "39", attack: "52", defense: "43", spAtk: "60", spDef: "50", speed: "65", types: "Fire", sprite: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/4.png", moves: "Flamethrower,Scratch" },
        { id: "7", name: "Squirtle", hp: "44", attack: "48", defense: "65", spAtk: "50", spDef: "64", speed: "43", types: "Water", sprite: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/7.png", moves: "Hydro Pump,Tackle" },
        { id: "129", name: "Magikarp", hp: "20", attack: "10", defense: "55", spAtk: "15", spDef: "20", speed: "80", types: "Water", sprite: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/129.png", moves: "Splash,Tackle" }
      ];
      
      for (const p of fallbackPokemon) {
        await db.collection("pokemon").insertOne(p);
      }
    }

    // Sample Trainer
    await db.collection("trainers").insertOne({
      userId: "1",
      name: "Red",
      wins: "10",
      losses: "2",
      team: ["25"]
    });
    
    // Leaderboard
    await redis.zadd("leaderboard", 83.3, "Red");
  };

  await seedData();

  // Create MongoDB Indexes (if using actual DB)
  if (mongoClient) {
    try {
      await db.collection("users").createIndex({ username: 1 }, { unique: true });
      await db.collection("pokemon").createIndex({ id: 1 }, { unique: true });
      await db.collection("trainers").createIndex({ userId: 1 }, { unique: true });
      console.log("MongoDB indexes created.");
    } catch (e) {
      console.warn("Failed to create indexes (might be in mock mode or lacking permissions):", e);
    }
  }

  // --- Middleware ---
  const verifyToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      (req as any).user = decoded;
      next();
    } catch (error) {
      res.status(401).json({ error: "Invalid token." });
    }
  };

  // --- API Routes ---

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });

    const exists = await db.collection("users").findOne({ username });
    if (exists) return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    await db.collection("users").insertOne({ id: userId, username, password: hashedPassword });

    const pokemonList = await db.collection("pokemon").find().toArray();
    const starterId = pokemonList.length > 0 ? pokemonList[Math.floor(Math.random() * pokemonList.length)].id : "25";

    // Initialize trainer data for new user
    await db.collection("trainers").insertOne({ 
      userId, 
      name: username, 
      wins: "0", 
      losses: "0", 
      team: [starterId]
    });

    // Initialize leaderboard rank
    await redis.zadd("leaderboard", 0, username);

    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: userId, username } });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    const userData = await db.collection("users").findOne({ username });
    
    if (!userData || !userData.password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, userData.password);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ userId: userData.id, username: userData.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: userData.id, username: userData.username } });
  });

  app.get("/api/pokemon", async (req, res) => {
    const pokemon = await db.collection("pokemon").find().toArray();
    res.json(pokemon);
  });

  app.get("/api/pokemon/random", async (req, res) => {
    const pokemon = await db.collection("pokemon").find().toArray();
    if (pokemon.length === 0) return res.status(404).json({ error: "No pokemon found" });
    const randomId = pokemon[Math.floor(Math.random() * pokemon.length)].id;
    const p = await db.collection("pokemon").findOne({ id: randomId });
    res.json(p);
  });

  app.get("/api/pokemon/:id", async (req, res) => {
    const p = await db.collection("pokemon").findOne({ id: req.params.id });
    if (!p) return res.status(404).json({ error: "Pokemon not found" });
    res.json(p);
  });

  app.get("/api/moves", async (req, res) => {
    const moves = await db.collection("moves").find().toArray();
    res.json(moves);
  });

  app.get("/api/trainer/:id", async (req, res) => {
    const t = await db.collection("trainers").findOne({ userId: req.params.id });
    if (!t) return res.status(404).json({ error: "Trainer not found" });
    res.json(t);
  });

  app.get("/api/leaderboard", async (req, res) => {
    const raw = await redis.zrevrange("leaderboard", 0, 10, "WITHSCORES");
    const result = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ name: raw[i], winRate: raw[i+1] });
    }
    res.json(result);
  });

  app.post("/api/catch", verifyToken, async (req, res) => {
    const { trainerId, pokemonId, mood, multiplier = 1 } = req.body;
    
    // Security check: ensure trainerId matches the logged-in user (unless admin)
    if ((req as any).user.userId !== trainerId) {
      return res.status(403).json({ error: "Unauthorized: Cannot catch for another trainer." });
    }

    const trainer = await db.collection("trainers").findOne({ userId: trainerId });
    if (!trainer) return res.status(404).json({ error: "Trainer not found" });
    
    const teamIds = trainer.team || [];

    // 1. Validation: Capacity
    if (teamIds.length >= 6) {
      return res.status(400).json({ 
        code: "PARTY_FULL",
        error: "COMMUNICATION ERROR: Trainer party at max capacity (6/6)." 
      });
    }

    // 2. Validation: Duplicates
    if (teamIds.includes(pokemonId)) {
      return res.status(400).json({ 
        code: "ALREADY_CAUGHT",
        error: "LOGICAL ERROR: Biological signal already detected in active team." 
      });
    }

    // 3. Game Logic: Catch Chance
    const level = req.body.level || 20;
    const levelPenalty = (100 - level) / 100; 
    let successRate = 0.5 * multiplier * (levelPenalty + 0.1); 
    
    if (mood === "angry") successRate *= 0.5;
    if (mood === "eating") successRate *= 1.2;

    const catchRoll = Math.random();
    if (catchRoll > successRate) {
      const fleeRate = 0.15;
      const fled = Math.random() < fleeRate;

      return res.status(400).json({ 
        success: false, 
        code: fled ? "FLED" : "ESCAPED",
        fled: fled,
        error: fled 
          ? "The Pokémon fled the encounter!" 
          : (mood === "eating" ? "The Pokémon was too distracted by eating and missed the ball!" : "The wild creature broke free!")
      });
    }

    teamIds.push(pokemonId);
    await db.collection("trainers").updateOne({ userId: trainerId }, {
      $set: { team: teamIds }
    });
    
    res.json({ success: true, message: `POKEMON_ID ${pokemonId} successfully serialized to active team.` });
  });

  app.post("/api/pokemon/:id/moves", verifyToken, async (req, res) => {
    const { moves } = req.body;
    if (!Array.isArray(moves) || moves.length > 4) {
      return res.status(400).json({ error: "Invalid moveset." });
    }
    await db.collection("pokemon").updateOne({ id: req.params.id }, {
      $set: { moves: moves.join(",") }
    });
    res.json({ success: true, moves: moves.join(",") });
  });

  app.get("/api/rival", async (req, res) => {
    const pokemonList = await db.collection("pokemon").find().toArray();
    const ids = pokemonList.map((p: any) => p.id);
    
    const rivalTeam = [];
    const shuffled = [...ids].sort(() => 0.5 - Math.random());
    const teamIds = shuffled.slice(0, 6);

    for (const id of teamIds) {
      const p = await db.collection("pokemon").findOne({ id });
      const isRare = Math.random() < 0.2;
      const level = isRare 
        ? Math.floor(Math.random() * 20) + 81 
        : Math.floor(Math.random() * 80) + 1;

      rivalTeam.push({
        ...p,
        level
      });
    }

    res.json({
      name: ["Blue", "Silver", "Wally", "Gladion", "Hau"][Math.floor(Math.random() * 5)],
      team: rivalTeam
    });
  });

  app.post("/api/battle", verifyToken, async (req, res) => {
    const { player1Id, player2Id } = req.body;
    // Simple simulated battle log
    const log = [
      "> Battle started!",
      `> Red sends out Pikachu!`,
      `> Opponent sends out Magikarp!`,
      `> Pikachu used Thunderbolt!`,
      `> It's super effective!`,
      `> Wild Magikarp fainted!`,
      `> Red won the battle!`
    ];
    res.json({ log, winner: "Red" });
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
