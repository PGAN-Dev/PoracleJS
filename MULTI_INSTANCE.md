# Multi-Instance Support

PoracleJS now supports running multiple instances simultaneously with coordinated state synchronization via Redis. This enables:

- **Dedicated Discord command instance** - Handle user commands separately from webhook processing
- **Horizontal scaling** - Run multiple webhook processing instances
- **Real-time synchronization** - Alert cache, geofence, and configuration updates sync across all instances
- **Load balancing** - Distribute webhook load across multiple instances

## Quick Start

### 1. Install Redis

```powershell
# Windows (with Chocolatey)
choco install redis-64

# Linux
sudo apt-get install redis-server

# Docker
docker run -d -p 6379:6379 redis
```

### 2. Install Dependencies

```powershell
npm install
```

### 3. Configure Instances

Create two config directories:

**config-discord/local.json** (Command Instance):
```json
{
  "server": { "port": "3030" },
  "redis": { "enabled": true, "instanceId": "discord-commands" },
  "instance": {
    "enableDiscordCommands": true,
    "enableWebhookProcessing": false
  },
  "discord": { "enabled": true, "token": ["YOUR_TOKEN"] }
}
```

**config-webhook/local.json** (Webhook Instance):
```json
{
  "server": { "host": "0.0.0.0", "port": "3031" },
  "redis": { "enabled": true, "instanceId": "webhook-processor-1" },
  "instance": {
    "enableDiscordCommands": false,
    "enableWebhookProcessing": true
  },
  "discord": { "enabled": true, "token": ["YOUR_TOKEN"] }
}
```

### 4. Start Instances

```powershell
# Terminal 1 - Discord Commands
$env:NODE_CONFIG_DIR="./config-discord"
node poracle.js

# Terminal 2 - Webhook Processing
$env:NODE_CONFIG_DIR="./config-webhook"
node poracle.js
```

Or use the helper script:
```powershell
.\multi-instance.ps1 -Start
```

### 5. Configure Scanner

Point your scanner (RDM/Golbat) webhooks to the webhook instance:
```
http://your-server:3031
```

## Documentation

- **[Quick Start Guide](docs/MULTI_INSTANCE_QUICKSTART.md)** - Get up and running quickly
- **[Complete Setup Guide](docs/MULTI_INSTANCE_SETUP.md)** - Detailed configuration, load balancing, PM2, troubleshooting
- **[Implementation Details](docs/MULTI_INSTANCE_IMPLEMENTATION.md)** - Technical details of the implementation

## Example Configurations

- **[Discord Commands Instance](config/local.json.example-discord-commands)** - Handles Discord commands only
- **[Webhook Processor Instance](config/local.json.example-webhook-processor)** - Processes webhooks only

## What Gets Synchronized?

When any instance makes changes, all instances are notified via Redis:

- ✅ Alert cache refreshes (when users add/remove trackings)
- ✅ Geofence file changes
- ✅ DTS template changes  
- ✅ Pogo event updates
- ✅ Shiny data updates
- ✅ Rate limit updates

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Redis                           │
│              (Message Broker)                       │
└─────────────────────────────────────────────────────┘
         ↑              ↑              ↑
         │              │              │
    ┌────┴────┐    ┌────┴────┐   ┌────┴────┐
    │ Discord │    │ Webhook │   │ Webhook │
    │Commands │    │ Process │   │ Process │
    │ :3030   │    │ :3031   │   │ :3032   │
    └─────────┘    └─────────┘   └─────────┘
         │              ↑              ↑
         │              │              │
    Discord        ┌────┴──────────────┴────┐
    Commands       │   Load Balancer        │
                   │   (nginx/HAProxy)      │
                   └────────────────────────┘
                              ↑
                         Scanner Webhooks
```

## Benefits

- **Performance**: Separate command processing from webhook processing
- **Scalability**: Add more webhook instances as your load grows
- **Reliability**: If one webhook instance fails, others continue processing
- **Flexibility**: Different configurations per instance (workers, memory, etc.)

## Backward Compatibility

Fully backward compatible with existing single-instance deployments:
- Redis is **disabled by default**
- All features enabled by default
- No configuration changes required for single instance
- Existing deployments continue working as-is

## Requirements

- **Node.js 20+**
- **Redis** (for multi-instance coordination)
- **MySQL/MariaDB** (shared across all instances)

## Migration from Single Instance

1. Install Redis
2. Run `npm install` to get ioredis
3. Add Redis config to your existing `local.json`
4. Start your instance (now with Redis support)
5. Clone config for additional instances
6. Start additional instances
7. Configure load balancer

See [complete setup guide](docs/MULTI_INSTANCE_SETUP.md) for details.

## Troubleshooting

**Instances not syncing?**
- Check Redis is running: `redis-cli ping`
- Verify all instances have `redis.enabled: true`
- Check logs for `[Redis] Multi-instance coordination enabled`

**Commands not working?**
- Only ONE instance should have `instance.enableDiscordCommands: true`
- Webhook instances should have `instance.enableDiscordCommands: false`

See [troubleshooting guide](docs/MULTI_INSTANCE_SETUP.md#troubleshooting) for more help.

## Helper Scripts

- **Windows**: `.\multi-instance.ps1 -Start` - Start multi-instance setup
- **Status**: `.\multi-instance.ps1 -Status` - Check running instances
- **Stop**: `.\multi-instance.ps1 -Stop` - Stop all instances

---

**Note**: This feature is optional. Single-instance deployments continue to work without any changes.
