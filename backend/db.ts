import mongoose, { Schema, Model, Document } from "mongoose";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

// ─── Mongoose Schemas ──────────────────────────────────────────────────────────

const pokemonSchema = new Schema({
  id:          { type: String, required: true, unique: true },
  name:        String,
  hp:          String,
  attack:      String,
  defense:     String,
  spAtk:       String,
  spDef:       String,
  speed:       String,
  types:       String,
  abilities:   String,
  moves:       String,
  description: String,
  sprite:      String,
});

const movesSchema = new Schema({
  id:     { type: String, required: true, unique: true },
  name:   String,
  type:   String,
  pwr:    Number,
  acc:    Number,
  effect: String,
});

const usersSchema = new Schema({
  id:       { type: String, required: true, unique: true },
  username: { type: String, unique: true },
  password: String,
});

const trainersSchema = new Schema({
  userId:    { type: String, required: true, unique: true },
  name:      String,
  wins:      String,
  losses:    String,
  team:      { type: Schema.Types.Mixed, default: [] },
  inventory: { type: Schema.Types.Mixed, default: {} },
  coins:     { type: Number, default: 500 },
});

// ─── Models ────────────────────────────────────────────────────────────────────

let PokemonModel:  Model<any>;
let MovesModel:    Model<any>;
let UsersModel:    Model<any>;
let TrainersModel: Model<any>;

// Map table name → Mongoose model (mirrors the old Postgres table names)
function getModel(table: string): Model<any> {
  const map: Record<string, Model<any>> = {
    pokemon:  PokemonModel,
    moves:    MovesModel,
    users:    UsersModel,
    trainers: TrainersModel,
  };
  const model = map[table];
  if (!model) throw new Error(`Unknown collection: ${table}`);
  return model;
}

// ─── Connection state ──────────────────────────────────────────────────────────

let useMockDb = false;

// Mock DB (unchanged from original — used when MongoDB is unreachable)
const mockDb: any = {
  pokemon:  [],
  moves:    [],
  users:    [],
  trainers: [],
};

// ─── MongoDB Initialization (replaces initPostgres) ────────────────────────────

export const initMongo = async () => {
  try {
    const MONGODB_URL =
      process.env.MONGODB_URL ||
      "mongodb://localhost:27017/pokedex";

    await mongoose.connect(MONGODB_URL, {
      serverSelectionTimeoutMS: 3000,
    });

    // Register models (use existing model if already registered)
    PokemonModel  = mongoose.models.pokemon  || mongoose.model("pokemon",  pokemonSchema,  "pokemon");
    MovesModel    = mongoose.models.moves    || mongoose.model("moves",    movesSchema,    "moves");
    UsersModel    = mongoose.models.users    || mongoose.model("users",    usersSchema,    "users");
    TrainersModel = mongoose.models.trainers || mongoose.model("trainers", trainersSchema, "trainers");

    console.log("Connected to MongoDB.");
  } catch (error) {
    console.warn("MongoDB connection failed. Using in-memory fallback for Dev Preview.");
    useMockDb = true;
  }
};

// ─── Default inventory ─────────────────────────────────────────────────────────

export const DEFAULT_INVENTORY = {
  pokeballs:   20,
  greatballs:  10,
  ultraballs:  5,
  razzberries: 10,
  goldenrazz:  2,
  masterballs: 0,
};

// ─── Generic CRUD Helpers ──────────────────────────────────────────────────────

export async function dbQueryOne(table: string, conditions: any) {
  if (useMockDb) {
    return mockDb[table].find((row: any) =>
      Object.keys(conditions).every(k => row[k] === conditions[k])
    );
  }
  return getModel(table).findOne(conditions).lean();
}

export async function dbQueryMany(table: string, conditions: any = {}) {
  if (useMockDb) {
    if (Object.keys(conditions).length === 0) return [...mockDb[table]];
    return mockDb[table].filter((row: any) =>
      Object.keys(conditions).every(k => row[k] === conditions[k])
    );
  }
  return getModel(table).find(conditions).lean();
}

export async function dbInsert(table: string, data: any) {
  if (useMockDb) {
    mockDb[table].push(data);
    return;
  }
  try {
    await getModel(table).create(data);
  } catch (err: any) {
    // 11000 = duplicate key — silently skip (mirrors ON CONFLICT DO NOTHING)
    if (err.code !== 11000) throw err;
  }
}

export async function dbUpdate(table: string, conditions: any, updateData: any) {
  if (useMockDb) {
    const item = mockDb[table].find((row: any) =>
      Object.keys(conditions).every(k => row[k] === conditions[k])
    );
    if (item) Object.assign(item, updateData);
    return;
  }
  await getModel(table).updateOne(conditions, { $set: updateData });
}

// ─── Redis Setup (unchanged) ───────────────────────────────────────────────────

export let redis: any;

export const initRedis = async () => {
  if (process.env.REDIS_URL) {
    console.log("Connecting to Redis...");
    const redisOptions: any = { maxRetriesPerRequest: 1 };
    if (process.env.REDIS_PASSWORD) {
      redisOptions.password = process.env.REDIS_PASSWORD;
    }
    redis = new Redis(process.env.REDIS_URL, redisOptions);
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
    if (!process.env.REDIS_URL) console.log("No REDIS_URL found. Using in-memory mock Redis.");
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
      },
    };
  }
};
