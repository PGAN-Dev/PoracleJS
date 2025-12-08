# Multi-Instance Quick Start

This is a quick reference for setting up PoracleJS in multi-instance mode.

## Prerequisites

- **Working PoracleJS installation** with `config/local.json` already configured
- **Redis** installed and running

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

**Add to your existing `config/local.json`:**

```json
{
  // Your existing config (discord, database, etc.)
  // ...
  
  // Add these new sections:
  "redis": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 6379
  },
  "instance": {
    "enableDiscordCommands": true,
    "enableWebhookProcessing": true
  }
}
```

### Using PM2 with Environment Variable Overrides

Create `ecosystem.config.js` in your PoracleJS directory:

```javascript
module.exports = {
  apps: [
    {
      name: 'poracle-discord-commands',
      script: 'poracle.js',
      cwd: '/your/path/to/PoracleJS',  // UPDATE THIS PATH
      env: {
        PORACLE_INSTANCE_ID: 'discord-commands',
        NODE_APP_INSTANCE: '',
        server__port: '3030',
        redis__enabled: 'true',
        redis__instanceId: 'discord-commands',
        instance__enableDiscordCommands: 'true',
        instance__enableWebhookProcessing: 'false'
      }
    },
    {
      name: 'poracle-webhook-1',
      script: 'poracle.js',
      cwd: '/your/path/to/PoracleJS',  // UPDATE THIS PATH
      env: {
        PORACLE_INSTANCE_ID: 'webhook-processor-1',
        NODE_APP_INSTANCE: '',
        server__host: '0.0.0.0',
        server__port: '3031',
        redis__enabled: 'true',
        redis__instanceId: 'webhook-processor-1',
        instance__enableDiscordCommands: 'false',
        instance__enableWebhookProcessing: 'true',
        discord__checkRole: 'false'
      }
    }
  ]
}
```

### Run

```powershell
pm2 start ecosystem.config.js
pm2 save
pm2 logs
```

**Alternative: Manual Start (Without PM2)**

If you don't use PM2, start instances manually in separate terminals:
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
