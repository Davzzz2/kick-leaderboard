// backend/server.js
import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { CHANNEL_NAME, CHANNEL_ID } from "./config.js";

const execAsync = promisify(exec);
const PORT = process.env.PORT || 3000;
// const CHANNEL_ID = 1485854; // Remove hardcoded value
// const CHANNEL_NAME = "enjayy"; // Remove hardcoded value
const IGNORED_USERS = ["BotRix", "KickBot"];

// Spam detection configuration
const SPAM_CONFIG = {
  minMessageLength: 2, // Minimum message length to be considered valid
  maxMessagesPerMinute: 20, // Maximum messages per minute per user
  repeatedMessageThreshold: 3, // Number of times a message can be repeated
  cooldownPeriod: 60000, // 1 minute cooldown for spam detection
};

// Store user message history for spam detection
const userMessageHistory = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files from /public
app.use(express.static(path.join(__dirname, "../public")));

let db;

// Initialize DB and create table if not exists
async function initDB() {
  db = await open({
    filename: "./messages.db",
    driver: sqlite3.Database,
  });
  await db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      username TEXT,
      created_at INTEGER
    )
  `);
}

// Check if the channel is live using the channel name API
async function isChannelLive() {
  try {
    console.log(`[LIVE CHECK] Checking live status for ${CHANNEL_NAME}...`);
    const curlCommand = `curl --compressed -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept: application/json, text/plain, */*" -H "Accept-Language: en-US,en;q=0.9" -H "Accept-Encoding: gzip, deflate, br" -H "Connection: keep-alive" -H "Upgrade-Insecure-Requests: 1" -H "Sec-Fetch-Dest: empty" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Site: same-origin" -H "Cache-Control: no-cache" -H "Pragma: no-cache" "https://kick.com/api/v1/channels/${CHANNEL_NAME}"`;
    
    const { stdout, stderr } = await execAsync(curlCommand);
    if (stderr) {
      console.error(`[LIVE CHECK] cURL stderr:`, stderr);
    }
    
    const json = JSON.parse(stdout);
    
    // Debug: Check the top-level keys
    console.log(`[LIVE CHECK] Top-level keys:`, Object.keys(json));
    
    // Check if there's an error response
    if (json.error) {
      console.log(`[LIVE CHECK] API Error:`, json.error);
      console.log(`[LIVE CHECK] Reference:`, json.reference);
      return false;
    }
    
    // First check if there's a current livestream
    if (json.livestream) {
      console.log(`[LIVE CHECK] Current livestream found:`, json.livestream);
      const liveStatus = json.livestream.is_live === true;
      console.log(`[LIVE CHECK] Current livestream is_live = ${liveStatus}`);
      return liveStatus;
    }
    
    // If no current livestream, check previous livestreams
    const previousLivestreams = json.previous_livestreams || [];
    console.log(`[LIVE CHECK] Previous livestreams array length:`, previousLivestreams.length);
    
    if (previousLivestreams.length > 0) {
      console.log(`[LIVE CHECK] First previous livestream keys:`, Object.keys(previousLivestreams[0]));
      const mostRecentStream = previousLivestreams[0]; // First stream is most recent
      const liveStatus = mostRecentStream.is_live === true;
      console.log(`[LIVE CHECK] Most recent previous livestream is_live = ${liveStatus}`);
      console.log(`[LIVE CHECK] Stream title: ${mostRecentStream.session_title}`);
      console.log(`[LIVE CHECK] Stream created: ${mostRecentStream.created_at}`);
      return liveStatus;
    } else {
      console.log(`[LIVE CHECK] No livestreams found`);
      return false;
    }
  } catch (e) {
    console.error("[LIVE CHECK] Error checking live status:", e);
    return false;
  }
}

async function fetchMessagesAndStore() {
  console.log("[FETCH] Starting fetchMessagesAndStore");

  const live = await isChannelLive();
  if (!live) {
    console.log("[FETCH] Channel is not live, skipping message fetch.");
    return;
  }

  try {
    const curlCommand = `curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept: application/json" -H "Accept-Language: en-US,en;q=0.9" "https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${Date.now()}"`;
    
    const { stdout, stderr } = await execAsync(curlCommand);
    if (stderr) {
      console.error(`[FETCH] cURL stderr:`, stderr);
    }
    
    const json = JSON.parse(stdout);
    const messages = json.data?.messages || [];

    // Filter messages from last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Filter messages with spam detection
    const filtered = messages.filter((msg) => {
      const created = Date.parse(msg.created_at);
      if (created < sevenDaysAgo) return false;
      if (IGNORED_USERS.includes(msg.sender.username)) return false;

      const content = msg.content.trim();
      if (content.length === 0) return false;
      if (content.length < SPAM_CONFIG.minMessageLength) return false;

      // exclude if content is only one emoji code like [emote:1234:something]
      if (/^\[emote:\d+:[^\]]+\]$/.test(content)) return false;

      // Spam detection
      const username = msg.sender.username;
      const now = Date.now();

      // Initialize user history if not exists
      if (!userMessageHistory.has(username)) {
        userMessageHistory.set(username, {
          messages: [],
          lastMessage: null,
          repeatedCount: new Map()
        });
      }

      const userHistory = userMessageHistory.get(username);

      // Clean old messages (older than cooldown period)
      userHistory.messages = userHistory.messages.filter(
        m => now - m.timestamp < SPAM_CONFIG.cooldownPeriod
      );

      // Check message frequency
      if (userHistory.messages.length >= SPAM_CONFIG.maxMessagesPerMinute) {
        console.log(`[SPAM] User ${username} exceeded message rate limit`);
        return false;
      }

      // Check for repeated messages
      const repeatedCount = userHistory.repeatedCount.get(content) || 0;
      if (repeatedCount >= SPAM_CONFIG.repeatedMessageThreshold) {
        console.log(`[SPAM] User ${username} repeated message too many times`);
        return false;
      }

      // Update user history
      userHistory.messages.push({ timestamp: now, content });
      userHistory.repeatedCount.set(content, repeatedCount + 1);
      userHistory.lastMessage = now;

      return true;
    });

    let insertedCount = 0;
    for (const msg of filtered) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO messages (id, username, created_at) VALUES (?, ?, ?)`,
          [msg.id, msg.sender.username, Date.parse(msg.created_at)]
        );
        insertedCount++;
      } catch {
        // Ignore duplicates or errors
      }
    }
    console.log(`[FETCH] Fetched ${messages.length} messages from Kick`);
    console.log(`[STORE] Inserted ${insertedCount} new messages into DB`);
  } catch (e) {
    console.error("[FETCH] Error fetching/storing messages:", e);
  }
}

// Endpoint to get leaderboard for last 7 days
app.get("/leaderboard", async (req, res) => {
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const rows = await db.all(
      `SELECT username, COUNT(*) as message_count
       FROM messages
       WHERE created_at > ?
         AND username NOT IN (?, ?)
       GROUP BY username
       ORDER BY message_count DESC
       LIMIT 100`,
      [sevenDaysAgo, ...IGNORED_USERS]
    );

    // Map DB column message_count to messageCount for frontend consistency
    const formatted = rows.map(r => ({
      username: r.username,
      messageCount: r.message_count,
    }));

    res.json(formatted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

(async () => {
  await initDB();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  console.log("[APP] Starting fetch interval every 1 second");
  await fetchMessagesAndStore();
  setInterval(fetchMessagesAndStore, 1000);
})();
