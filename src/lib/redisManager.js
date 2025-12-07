const Redis = require('ioredis')
const EventEmitter = require('events')

/**
 * RedisManager handles distributed messaging between Poracle instances
 * Used for broadcasting alert cache refreshes and other coordinated operations
 */
class RedisManager extends EventEmitter {
	constructor(config, log) {
		super()
		this.config = config
		this.log = log
		this.enabled = config.redis && config.redis.enabled
		this.instanceId = config.redis?.instanceId || process.env.PORACLE_INSTANCE_ID || 'default'
		
		if (!this.enabled) {
			this.log.info('Redis is disabled - multi-instance coordination unavailable')
			return
		}

		this.redisConfig = {
			host: config.redis.host || '127.0.0.1',
			port: config.redis.port || 6379,
			password: config.redis.password || undefined,
			db: config.redis.db || 0,
			retryStrategy: (times) => {
				const delay = Math.min(times * 50, 2000)
				return delay
			},
			maxRetriesPerRequest: 3,
		}

		// Separate clients for pub and sub to avoid blocking
		this.publisher = null
		this.subscriber = null
		this.channels = {
			alertRefresh: 'poracle:alert:refresh',
			geofenceReload: 'poracle:geofence:reload',
			dtsReload: 'poracle:dts:reload',
			eventBroadcast: 'poracle:event:broadcast',
			shinyBroadcast: 'poracle:shiny:broadcast',
			weatherBroadcast: 'poracle:weather:broadcast',
			statsBroadcast: 'poracle:stats:broadcast',
			badguys: 'poracle:badguys:update',
		}

		this.connected = false
	}

	/**
	 * Initialize Redis connections
	 */
	async connect() {
		if (!this.enabled) {
			return
		}

		try {
			this.log.info(`[Redis] Connecting to Redis at ${this.redisConfig.host}:${this.redisConfig.port} as instance: ${this.instanceId}`)

			// Create publisher
			this.publisher = new Redis(this.redisConfig)
			
			// Create subscriber
			this.subscriber = new Redis(this.redisConfig)

			// Setup error handlers
			this.publisher.on('error', (err) => {
				this.log.error('[Redis] Publisher error:', err)
			})

			this.subscriber.on('error', (err) => {
				this.log.error('[Redis] Subscriber error:', err)
			})

			// Setup ready handlers
			this.publisher.on('ready', () => {
				this.log.info('[Redis] Publisher connected')
			})

			this.subscriber.on('ready', () => {
				this.log.info('[Redis] Subscriber connected')
				this.connected = true
			})

			// Subscribe to all channels
			await this.subscriber.subscribe(...Object.values(this.channels))
			
			// Handle incoming messages
			this.subscriber.on('message', (channel, message) => {
				this.handleMessage(channel, message)
			})

			this.log.info('[Redis] Successfully connected and subscribed to channels')
		} catch (err) {
			this.log.error('[Redis] Failed to connect:', err)
			this.enabled = false
		}
	}

	/**
	 * Handle incoming Redis messages
	 */
	handleMessage(channel, message) {
		try {
			const data = JSON.parse(message)
			
			// Ignore messages from this instance
			if (data.instanceId === this.instanceId) {
				this.log.debug(`[Redis] Ignoring own message on ${channel}`)
				return
			}

			this.log.debug(`[Redis] Received message on ${channel} from instance ${data.instanceId}`)

			// Emit event based on channel
			switch (channel) {
				case this.channels.alertRefresh:
					this.emit('refreshAlertCache', data)
					break
				case this.channels.geofenceReload:
					this.emit('reloadGeofence', data)
					break
				case this.channels.dtsReload:
					this.emit('reloadDts', data)
					break
				case this.channels.eventBroadcast:
					this.emit('eventBroadcast', data)
					break
				case this.channels.shinyBroadcast:
					this.emit('shinyBroadcast', data)
					break
				case this.channels.weatherBroadcast:
					this.emit('weatherBroadcast', data)
					break
				case this.channels.statsBroadcast:
					this.emit('statsBroadcast', data)
					break
				case this.channels.badguys:
					this.emit('badguysUpdate', data)
					break
				default:
					this.log.warn(`[Redis] Unknown channel: ${channel}`)
			}
		} catch (err) {
			this.log.error(`[Redis] Error handling message on ${channel}:`, err)
		}
	}

	/**
	 * Publish alert refresh command to all instances
	 */
	async publishAlertRefresh() {
		return this.publish(this.channels.alertRefresh, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
		})
	}

	/**
	 * Publish geofence reload command
	 */
	async publishGeofenceReload() {
		return this.publish(this.channels.geofenceReload, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
		})
	}

	/**
	 * Publish DTS reload command
	 */
	async publishDtsReload() {
		return this.publish(this.channels.dtsReload, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
		})
	}

	/**
	 * Publish event broadcast data
	 */
	async publishEventBroadcast(eventData) {
		return this.publish(this.channels.eventBroadcast, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
			data: eventData,
		})
	}

	/**
	 * Publish shiny broadcast data
	 */
	async publishShinyBroadcast(shinyData) {
		return this.publish(this.channels.shinyBroadcast, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
			data: shinyData,
		})
	}

	/**
	 * Publish weather broadcast data
	 */
	async publishWeatherBroadcast(weatherData) {
		return this.publish(this.channels.weatherBroadcast, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
			data: weatherData,
		})
	}

	/**
	 * Publish stats broadcast data
	 */
	async publishStatsBroadcast(statsData) {
		return this.publish(this.channels.statsBroadcast, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
			data: statsData,
		})
	}

	/**
	 * Publish badguys update
	 */
	async publishBadguysUpdate(badguysData) {
		return this.publish(this.channels.badguys, {
			timestamp: Date.now(),
			instanceId: this.instanceId,
			badguys: badguysData,
		})
	}

	/**
	 * Generic publish method
	 */
	async publish(channel, data) {
		if (!this.enabled || !this.connected) {
			this.log.debug(`[Redis] Publish skipped (disabled or not connected): ${channel}`)
			return
		}

		try {
			const message = JSON.stringify(data)
			await this.publisher.publish(channel, message)
			this.log.debug(`[Redis] Published to ${channel}`)
		} catch (err) {
			this.log.error(`[Redis] Failed to publish to ${channel}:`, err)
		}
	}

	/**
	 * Disconnect from Redis
	 */
	async disconnect() {
		if (!this.enabled) {
			return
		}

		try {
			this.log.info('[Redis] Disconnecting...')
			if (this.subscriber) {
				await this.subscriber.quit()
			}
			if (this.publisher) {
				await this.publisher.quit()
			}
			this.connected = false
			this.log.info('[Redis] Disconnected')
		} catch (err) {
			this.log.error('[Redis] Error during disconnect:', err)
		}
	}
}

module.exports = RedisManager
