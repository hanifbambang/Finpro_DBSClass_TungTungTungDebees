# Pokédex & Battle Arena

## 1. Project Description
This project is a web-based interactive Pokédex and Battle Arena application. It features a Safari zone for catching Pokémon, an interactive battle arena with rank progression, and a real-time leaderboard.

**Motivation:** By combining MongoDB and Redis, we achieve efficient storage for complex document structures (such as Trainer Profiles and Pokémon Data) while maintaining ultra-fast, real-time read/write performance for high-throughput operations like matchmaking, caching, and our competitive global leaderboard.

## 2. Architecture & Data Flow
**Architecture Diagram:**
```text
[ React Frontend ] <--> [ Node/Express API ] <--> [ Redis Cache & Leaderboard ]
                                             <--> [ MongoDB Primary Store ]
```

**Data Flow:**
1. **Primary Database (MongoDB):** Used as a Document Store to persistently hold complex hierarchical data.
   - `Trainers` Collection: Stores player profiles, team compositions, current level, and inventory items.
   - `Pokemon` Collection/Cache: Stores the master dictionary of Pokémon base stats and movesets.
2. **Secondary Database (Redis):** Used as a Key-Value store for transient, high-velocity data.
   - `Leaderboard`: Uses Redis Sorted Sets (`ZADD`, `ZREVRANGE`) to instantly query player global ranks.
   - `Sessions/Caching`: Caching API responses from PokeAPI to reduce external requests.

**Justification for DB Choice:**
- **MongoDB:** Highly suited for varied schemas like player inventories, party line-ups, and varying Pokémon attributes without forcing a rigid relational table structure.
- **Redis:** Relational databases and Document stores are inefficient at calculating real-time ranks for millions of users. Redis sorted sets handle global leaderboards in exponential `O(log(N))` time and serve cached images/metadata at sub-millisecond latencies.

## 3. Setup & How to Run
### Prerequisites
- Docker and Docker Compose
- Node.js (v18+)

### Launching the Databases
Run the following command to spin up MongoDB and Redis securely:
```bash
docker-compose up -d
```

### Running the Application
Install dependencies:
```bash
npm install
```
Start the development server:
```bash
npm run dev
```
The app will be accessible at `http://localhost:3000`.

## 4. Benchmarking
Our benchmarks validate the decision to separate the Leaderboard into Redis.
Run the benchmark script:
```bash
node benchmarks/benchmark.js
```
The raw results, charts, and analysis will be output to the `/benchmarks/results.json` log, illustrating the performance disparity for ranking queries between MongoDB `$sort` operations versus Redis `ZREVRANGE`.

## 5. Team Members
- [Member 1 Name] (Student ID) - Role: [Role]
- [Member 2 Name] (Student ID) - Role: [Role]
- [Member 3 Name] (Student ID) - Role: [Role]

## 6. Academic Integrity
We utilized AI assistance (Gemini/ChatGPT) transparently to guide frontend styling and boilerplate structure. The database design, integration, and core application logic were verified, integrated, and presented by our team manually.
