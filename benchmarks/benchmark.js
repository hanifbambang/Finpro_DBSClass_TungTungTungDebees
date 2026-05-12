const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const MONGO_URL = 'mongodb://localhost:27017';
const REDIS_URL = 'redis://localhost:6380';
const ITERATIONS = 10000;

async function runBenchmark() {
    console.log(`Starting Database Benchmark with ${ITERATIONS} records...`);
    console.log(`------------------------------------------------------`);

    // --- SETUP MONGODB --- //
    const mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    const db = mongoClient.db('benchmarkDB');
    const collection = db.collection('leaderboard');
    await collection.deleteMany({}); // Clear previous tests

    // --- SETUP REDIS --- //
    const redis = new Redis(REDIS_URL);
    await redis.flushall();

    // 1. MONGODB WRITE TEST
    let startMongoWrite = Date.now();
    const mongoDocs = Array.from({ length: ITERATIONS }, (_, i) => ({
        userId: `user${i}`,
        score: Math.floor(Math.random() * 5000),
        username: `Player_${i}`
    }));
    await collection.insertMany(mongoDocs);
    let endMongoWrite = Date.now();
    let mongoWriteTime = endMongoWrite - startMongoWrite;
    console.log(`[MongoDB] Write ${ITERATIONS} documents: ${mongoWriteTime} ms`);

    // 2. REDIS WRITE TEST (Sorted Set)
    let startRedisWrite = Date.now();
    const pipeline = redis.pipeline();
    mongoDocs.forEach(doc => {
        pipeline.zadd('global_leaderboard', doc.score, doc.userId);
    });
    await pipeline.exec();
    let endRedisWrite = Date.now();
    let redisWriteTime = endRedisWrite - startRedisWrite;
    console.log(`[Redis] Write ${ITERATIONS} sorted set entries: ${redisWriteTime} ms`);

    // 3. MONGODB READ TEST (Calculate Top 100 Leaderboard)
    let startMongoRead = Date.now();
    await collection.find().sort({ score: -1 }).limit(100).toArray();
    let endMongoRead = Date.now();
    let mongoReadTime = endMongoRead - startMongoRead;
    console.log(`[MongoDB] Query Top 100 (Sort + Limit): ${mongoReadTime} ms`);

    // 4. REDIS READ TEST (Calculate Top 100 Leaderboard)
    let startRedisRead = Date.now();
    await redis.zrevrange('global_leaderboard', 0, 99, 'WITHSCORES');
    let endRedisRead = Date.now();
    let redisReadTime = endRedisRead - startRedisRead;
    console.log(`[Redis] Query Top 100 (ZREVRANGE): ${redisReadTime} ms`);

    console.log(`------------------------------------------------------`);
    console.log(`Analysis:`);
    console.log(`Redis was ${(mongoReadTime / Math.max(1, redisReadTime)).toFixed(2)}x faster at reading the leaderboard.`);

    // --- SAVE TO FILE --- //
    const results = {
        timestamp: new Date().toISOString(),
        environment: "Localhost Development",
        iterations: ITERATIONS,
        mongodb: {
            write_ms: mongoWriteTime,
            read_top100_ms: mongoReadTime
        },
        redis: {
            write_ms: redisWriteTime,
            read_top100_ms: redisReadTime
        }
    };

    const dir = path.join(__dirname, '');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));

    console.log('\n✅ Results saved to benchmarks/results.json');

    // Cleanup
    await mongoClient.close();
    redis.disconnect();
}

runBenchmark().catch(err => {
    console.error("Benchmark failed (Make sure your Docker containers are running!):", err.message);
    process.exit(1);
});
