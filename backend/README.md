# Kick Leaderboard Backend

A Node.js backend for tracking Kick chat messages and displaying leaderboards.

## Features

- Fetches live chat messages from Kick channels
- Tracks message counts per user
- Provides leaderboard API endpoint
- Spam detection and filtering
- Real-time updates

## Environment Variables

- `PORT`: Server port (set automatically by Render)
- `CHANNEL_NAME`: Kick channel username (e.g., "enjayy")
- `CHANNEL_ID`: Kick channel numeric ID (e.g., 1485854)

## API Endpoints

- `GET /leaderboard` - Returns leaderboard data
- `GET /` - Serves the frontend

## Deployment on Render

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Set the following:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Root Directory**: `backend` (if deploying from root repo)

## Local Development

```bash
npm install
npm start
```

Server will run on http://localhost:3000 