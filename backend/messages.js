import fetch from 'node-fetch';
import { initDB } from './db.js';

const CHANNEL_ID = '1485854'; // Replace with your Kick channel ID

export async function fetchAndStoreMessages() {
  const db = await initDB();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      username TEXT,
      content TEXT,
      timestamp INTEGER
    )
  `);

  const res = await fetch(`https://kick.com/api/v2/channels/${CHANNEL_ID}/messages?t=${Date.now()}`);
  const data = await res.json();

  const messages = data.data?.messages || [];
  console.log(`[FETCH] Fetched ${messages.length} messages from Kick`);

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  let inserted = 0;

  for (const msg of messages) {
    const ts = new Date(msg.created_at).getTime();
    const text = msg.content;
    const isOnlyEmojis = /^[\p{Emoji}\s]+$/u.test(text);

    if (ts > weekAgo && !isOnlyEmojis) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO messages (id, username, content, timestamp) VALUES (?, ?, ?, ?)`,
          msg.id,
          msg.sender.username,
          text,
          ts
        );
        inserted++;
      } catch (e) {
        // Ignore duplicates
      }
    }
  }

  console.log(`[STORE] Inserted ${inserted} new messages into DB`);
}
