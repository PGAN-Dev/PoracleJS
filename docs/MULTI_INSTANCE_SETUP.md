# Multi-Instance PoracleJS Setup Guide

This guide explains how to run multiple PoracleJS instances simultaneously for better scalability and separation of concerns.

## Architecture Overview

In a multi-instance setup, you can run separate PoracleJS instances for different purposes:

1. **Discord Command Instance** - Handles Discord commands and user interactions
2. **Webhook Processing Instances** - Process incoming Pokemon/Raid/Quest webhooks and send alerts
3. **Telegram Command Instance** (optional) - Handles Telegram commands separately

All instances share the same database and coordinate via Redis pub/sub for real-time synchronization.

## Prerequisites

- **Redis** - Required for inter-instance communication
- **MySQL/MariaDB** - Shared database for all instances
- **Node.js 20+** - For running PoracleJS

### Installing Redis

#### Windows
```powershell
# Using Chocolatey
choco install redis-64

# Or download from: https://github.com/tporadowski/redis/releases
```

#### Linux
```bash
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

#### Docker
```bash
docker run -d --name redis -p 6379:6379 redis:latest
```

## Installation Steps

### 1. Install Dependencies

```powershell
npm install
```

This will install the `ioredis` package added to support multi-instance coordination.

### 2. Configure Redis Connection

In your `config/local.json`, add the Redis configuration:

```json
{
  "redis": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 6379,
    "password": "",
    "db": 0,
    "instanceId": "unique-instance-name"
  }
}
```

**Note:** `instanceId` can also be set via the `PORACLE_INSTANCE_ID` environment variable.

### 3. Configure Instance-Specific Settings

For each instance, configure which features it should handle:

```json
{
  "instance": {
    "enableDiscordCommands": true,      // Enable Discord command processing
    "enableTelegramCommands": true,     // Enable Telegram command processing
    "enableWebhookProcessing": true,    // Enable webhook processing
    "enableWeatherProcessing": true,    // Enable weather processing
    "enableStatsProcessing": true       // Enable stats processing
  }
}
```

## Example Configurations

### Discord Command Instance

Use `config/local.json.example-discord-commands` as a template:

- Handles Discord commands ONLY
- Does not process webhooks
- Port: 3030
- Instance ID: `discord-commands`

```json
{
  "server": {
    "port": "3030"
  },
  "redis": {
    "enabled": true,
    "instanceId": "discord-commands"
  },
  "instance": {
    "enableDiscordCommands": true,
    "enableTelegramCommands": false,
    "enableWebhookProcessing": false,
    "enableWeatherProcessing": false,
    "enableStatsProcessing": false
  },
  "discord": {
    "enabled": true,
    "checkRole": true
  }
}
```

### Webhook Processing Instance

Use `config/local.json.example-webhook-processor` as a template:

- Processes webhooks ONLY
- Does not handle commands
- Port: 3031, 3032, etc. (different for each instance)
- Instance ID: `webhook-processor-1`, `webhook-processor-2`, etc.

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": "3031"
  },
  "redis": {
    "enabled": true,
    "instanceId": "webhook-processor-1"
  },
  "instance": {
    "enableDiscordCommands": false,
    "enableTelegramCommands": false,
    "enableWebhookProcessing": true,
    "enableWeatherProcessing": true,
    "enableStatsProcessing": true
  },
  "discord": {
    "enabled": true,
    "checkRole": false
  }
}
```

## Running Multiple Instances

### Option 1: Multiple Config Files

Create separate config directories for each instance:

```powershell
# Discord Commands Instance
$env:NODE_CONFIG_DIR="./config-discord"
node poracle.js

# Webhook Processor Instance 1
$env:NODE_CONFIG_DIR="./config-webhook-1"
node poracle.js

# Webhook Processor Instance 2
$env:NODE_CONFIG_DIR="./config-webhook-2"
node poracle.js
```

### Option 2: Environment Variables

Override settings via environment variables:

```powershell
# Discord Commands Instance
$env:PORACLE_INSTANCE_ID="discord-commands"
$env:instance__enableWebhookProcessing="false"
node poracle.js

# Webhook Processor Instance
$env:PORACLE_INSTANCE_ID="webhook-processor-1"
$env:instance__enableDiscordCommands="false"
$env:server__port="3031"
node poracle.js
```

### Option 3: PM2 Process Manager

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'poracle-discord-commands',
      script: 'poracle.js',
      env: {
        NODE_CONFIG_DIR: './config-discord',
        PORACLE_INSTANCE_ID: 'discord-commands'
      }
    },
    {
      name: 'poracle-webhook-1',
      script: 'poracle.js',
      env: {
        NODE_CONFIG_DIR: './config-webhook-1',
        PORACLE_INSTANCE_ID: 'webhook-processor-1'
      }
    },
    {
      name: 'poracle-webhook-2',
      script: 'poracle.js',
      env: {
        NODE_CONFIG_DIR: './config-webhook-2',
        PORACLE_INSTANCE_ID: 'webhook-processor-2'
      }
    }
  ]
}
```

Run with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Load Balancing Webhooks

Use a reverse proxy (nginx/HAProxy) to distribute webhooks across processing instances:

### Nginx Example

```nginx
upstream poracle_webhooks {
    least_conn;
    server 127.0.0.1:3031;
    server 127.0.0.1:3032;
    server 127.0.0.1:3033;
}

server {
    listen 9001;
    location / {
        proxy_pass http://poracle_webhooks;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Point your scanner (RDM/Golbat) to `http://your-server:9001` instead of individual instances.

## How It Works

### Redis Pub/Sub Channels

The following events are broadcast across all instances via Redis:

1. **Alert Refresh** (`poracle:alert:refresh`) - When alert cache needs reloading
2. **Geofence Reload** (`poracle:geofence:reload`) - When geofence files change
3. **DTS Reload** (`poracle:dts:reload`) - When DTS templates change
4. **Event Broadcast** (`poracle:event:broadcast`) - When Pogo events update
5. **Shiny Broadcast** (`poracle:shiny:broadcast`) - When shiny data updates
6. **Weather Broadcast** (`poracle:weather:broadcast`) - When weather changes
7. **Stats Broadcast** (`poracle:stats:broadcast`) - When stats update
8. **Rate Limit Updates** (`poracle:badguys:update`) - When users hit rate limits

### Synchronization Flow

When a Discord command triggers an alert refresh:

1. Command instance receives `!poracle track` command
2. Command instance updates database
3. Command instance broadcasts `refreshAlertCache` locally to its workers
4. Command instance publishes `refreshAlertCache` to Redis
5. All webhook instances receive the Redis message
6. All webhook instances refresh their in-memory alert caches
7. All instances now have synchronized alert data

## Monitoring

Check instance logs for Redis messages:

```
[Redis] Connecting to Redis at 127.0.0.1:6379 as instance: discord-commands
[Redis] Publisher connected
[Redis] Subscriber connected
[Redis] Successfully connected and subscribed to channels
[Redis] Multi-instance coordination enabled
```

When commands are executed:
```
[Redis] Received alert refresh request from instance discord-commands
Worker 1: Received reload alert broadcast
Worker 2: Received reload alert broadcast
```

## Troubleshooting

### Redis Connection Issues

**Problem:** `[Redis] Failed to connect`

**Solution:**
- Verify Redis is running: `redis-cli ping` (should return `PONG`)
- Check Redis host/port in config
- Check firewall rules

### Instances Not Syncing

**Problem:** Alert changes not appearing on webhook instances

**Solution:**
- Check all instances have `redis.enabled: true`
- Verify all instances use the same Redis server
- Check instance logs for Redis connection messages
- Ensure each instance has a unique `instanceId`

### Commands Not Working

**Problem:** Discord commands not responding

**Solution:**
- Verify command instance has `instance.enableDiscordCommands: true`
- Check webhook instances have `instance.enableDiscordCommands: false`
- Only ONE instance should handle commands

## Performance Tuning

### Scaling Webhook Processing

Add more webhook instances as needed:
- Run 1 webhook instance per 500-1000 active users
- Monitor CPU/memory usage
- Scale horizontally by adding instances rather than increasing workers

### Database Connections

Each instance needs database connections:
- Command instance: Low connection count (5-10)
- Webhook instances: Higher connection count (20-50)
- Total connections = sum of all instances

Update `tuning.maxDatabaseConnections` per instance based on load.

### Redis Performance

Redis is very lightweight:
- Can handle 100k+ messages/second
- Minimal memory usage
- Single Redis instance sufficient for most deployments

## Best Practices

1. **Separate Concerns** - Use dedicated instances for commands vs webhooks
2. **Unique Instance IDs** - Always set unique `instanceId` for each instance
3. **Shared Database** - All instances must use the same database
4. **Single Redis** - Use one Redis instance for all Poracle instances
5. **Monitor Logs** - Watch for Redis connection and sync messages
6. **Gradual Scaling** - Start with 1 command + 2 webhook instances, scale as needed
7. **Load Balancing** - Use nginx/HAProxy for webhook distribution

## Migration from Single Instance

1. Install Redis
2. Update `package.json` dependencies
3. Add Redis config to existing `local.json`
4. Start existing instance (now with Redis enabled)
5. Clone config for additional instances
6. Update ports and instance IDs
7. Start additional instances
8. Configure load balancer
9. Update scanner webhook URL

## Support

For issues or questions:
- Check logs for Redis connection status
- Verify all instances see Redis messages
- Ensure database is shared across instances
- Join Discord for help: [PoracleJS Discord](https://discord.gg/your-invite)
