# Multi-Instance Quick Start

This is a quick reference for setting up PoracleJS in multi-instance mode.

## Prerequisites

```powershell
# Install Redis (Windows with Chocolatey)
choco install redis-64

# Or on Linux
sudo apt-get install redis-server
```

## Install

```powershell
npm install
```

## Minimal Setup (2 instances)

### Instance 1: Discord Commands (Port 3030)

`config-discord/local.json`:
```json
{
  "server": { "port": "3030" },
  "redis": {
    "enabled": true,
    "instanceId": "discord-commands"
  },
  "instance": {
    "enableDiscordCommands": true,
    "enableWebhookProcessing": false
  },
  "discord": {
    "enabled": true,
    "token": ["YOUR_TOKEN"],
    "checkRole": true
  }
}
```

### Instance 2: Webhook Processing (Port 3031)

`config-webhook/local.json`:
```json
{
  "server": { "host": "0.0.0.0", "port": "3031" },
  "redis": {
    "enabled": true,
    "instanceId": "webhook-processor-1"
  },
  "instance": {
    "enableDiscordCommands": false,
    "enableWebhookProcessing": true
  },
  "discord": {
    "enabled": true,
    "token": ["YOUR_TOKEN"],
    "checkRole": false
  }
}
```

## Run

```powershell
# Terminal 1 - Discord Commands
$env:NODE_CONFIG_DIR="./config-discord"
node poracle.js

# Terminal 2 - Webhook Processing
$env:NODE_CONFIG_DIR="./config-webhook"
node poracle.js
```

## Verify

Check logs for:
```
[Redis] Successfully connected and subscribed to channels
[Redis] Multi-instance coordination enabled
```

## Scanner Configuration

Point your scanner (RDM/Golbat) webhooks to:
```
http://your-server:3031
```

## What This Achieves

- ✅ Discord commands handled by dedicated instance
- ✅ Webhook processing scales independently
- ✅ Alert refreshes synchronized across all instances via Redis
- ✅ Can add more webhook instances by duplicating config

## Full Documentation

See [MULTI_INSTANCE_SETUP.md](./MULTI_INSTANCE_SETUP.md) for complete setup guide with load balancing, PM2, and advanced configurations.
