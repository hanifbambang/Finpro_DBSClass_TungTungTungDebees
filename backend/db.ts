import mongoose, { Schema, Document, Model } from "mongoose";
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

// ─── MongoDB Connection ─────────────────────────────────────────────────────

export const initMongo = async () => {
  const MONGO_URI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/pokedex";
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB.");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};

// ─── Default Inventory ──────────────────────────────────────────────────────

export const DEFAULT_INVENTORY = {
  pokeballs: 20,
  greatballs: 10,
  ultraballs: 5,
  razzberries: 10,
  goldenrazz: 2,
  masterballs: 0,
};

// ─── Mongoose Schemas & Models ──────────────────────────────────────────────

// Pokemon
export interface IPokemon extends Document {
  id: string;
  name: string;
  hp: string;
  attack: string;
  defense: string;
  spAtk: string;
  spDef: string;
  speed: string;
  types: string;
  abilities: string;
  moves: string;
  description: string;
  sprite: string;
}

const PokemonSchema = new Schema<IPokemon>({
  id:          { type: String, required: true, unique: true },
  name:        { type: String },
  hp:          { type: String },
  attack:      { type: String },
  defense:     { type: String },
  spAtk:       { type: String },
  spDef:       { type: String },
  speed:       { type: String },
  types:       { type: String },
  abilities:   { type: String },
  moves:       { type: String },
  description: { type: String },
  sprite:      { type: String },
});

export const PokemonModel: Model<IPokemon> =
  mongoose.models.Pokemon || mongoose.model<IPokemon>("Pokemon", PokemonSchema);

// Move
export interface IMove extends Document {
  id: string;
  name: string;
  type: string;
  pwr: number;
  acc: number;
  effect: string;
}

const MoveSchema = new Schema<IMove>({
  id:     { type: String, required: true, unique: true },
  name:   { type: String },
  type:   { type: String },
  pwr:    { type: Number },
  acc:    { type: Number },
  effect: { type: String },
});

export const MoveModel: Model<IMove> =
  mongoose.models.Move || mongoose.model<IMove>("Move", MoveSchema);

// User
export interface IUser extends Document {
  id: string;
  username: string;
  password: string;
}

const UserSchema = new Schema<IUser>({
  id:       { type: String, required: true, unique: true },
  username: { type: String, unique: true },
  password: { type: String },
});

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

// Trainer  (team & inventory embedded as flexible objects — no JOINs needed)
export interface ITrainer extends Document {
  userId: string;
  name: string;
  wins: string;
  losses: string;
  team: string[];
  inventory: Record<string, number>;
  coins: number;
}

const TrainerSchema = new Schema<ITrainer>({
  userId:    { type: String, required: true, unique: true },
  name:      { type: String },
  wins:      { type: String, default: "0" },
  losses:    { type: String, default: "0" },
  team:      { type: [String], default: [] },
  inventory: { type: Schema.Types.Mixed, default: {} },
  coins:     { type: Number, default: 500 },
});

export const TrainerModel: Model<ITrainer> =
  mongoose.models.Trainer ||
  mongoose.model<ITrainer>("Trainer", TrainerSchema);

// ─── Redis Setup (unchanged) ────────────────────────────────────────────────

export let redis: any;

export const initRedis = async () => {
  if (process.env.REDIS_URL) {
    console.log("Connecting to Redis...");
    const redisOptions: any = { maxRetriesPerRequest: 1 };
    if (process.env.REDIS_PASSWORD) {
      redisOptions.password = process.env.REDIS_PASSWORD;
    }
    redis = new Redis(process.env.REDIS_URL, redisOptions);
    redis.on("error", (err: any) =>
      console.warn("Redis error", err.message)
    );

    try {
      await redis.ping();
      console.log("Connected to Redis.");
    } catch (error: any) {
      console.warn(
        "Redis connection/auth failed:",
        error.message,
        "- Falling back to Mock Redis"
      );
      redis.disconnect();
      redis = null;
    }
  }

  if (!redis) {
    if (!process.env.REDIS_URL)
      console.log("No REDIS_URL found. Using in-memory mock Redis.");
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
      set: async (key: string, value: string) =>
        redis.data.set(key, value),
      get: async (key: string) => redis.data.get(key) || null,
      exists: async (key: string) =>
        redis.data.has(key) ? 1 : 0,
      zadd: async (set: string, score: number, member: string) => {
        if (!redis.data.has(set)) redis.data.set(set, []);
        const items = redis.data.get(set);
        const existingIdx = items.findIndex(
          (i: any) => i.member === member
        );
        if (existingIdx !== -1) items[existingIdx].score = score;
        else items.push({ score, member });
        items.sort((a: any, b: any) => b.score - a.score);
      },
      zrevrange: async (
        set: string,
        start: number,
        end: number,
        withScores?: string
      ) => {
        const items = redis.data.get(set) || [];
        const result = items.slice(start, end + 1);
        if (withScores)
          return result.flatMap((i: any) => [
            i.member,
            i.score.toString(),
          ]);
        return result.map((i: any) => i.member);
      },
    };
  }
};
