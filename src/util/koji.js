const fs = require('fs')
const { resolve } = require('path')
const fetch = require('node-fetch-native')
const config = require('config')

const { log } = require('../lib/logger')

const getKojiFences = async () => {
	try {
		if (config?.geofence?.kojiOptions?.bearerToken) {
			const fences = Array.isArray(config.geofence?.path)
				? config.geofence.path
				: [config.geofence.path]

			await Promise.allSettled(
				fences.map((fencePath) => {
					if (fencePath.startsWith('http')) {
						log.info(`[KŌJI] Fetching ${fencePath}...`)
						return fetch(fencePath, {
							headers: {
								Authorization: `Bearer ${config.geofence.kojiOptions.bearerToken}`,
								'Content-Type': 'application/json',
							},
						})
							.then((res) => res.json())
							.then((json) => {
								let data = json.data
								// Merge group data from group_map.json if available
								// (workaround for Koji bulk endpoint not resolving parent names for group field)
								const groupMapPath = resolve(__dirname, '../../config/group_map.json')
								if (Array.isArray(data) && fs.existsSync(groupMapPath)) {
									try {
										const groupMap = JSON.parse(fs.readFileSync(groupMapPath, 'utf8'))
										let merged = 0
										for (const item of data) {
											if (item.name && groupMap[item.name] && !item.group) {
												item.group = groupMap[item.name]
												merged++
											}
										}
										log.info(`[KŌJI] Merged ${merged} group mappings from group_map.json`)
									} catch (e) {
										log.warn(`[KŌJI] Could not merge group_map.json: ${e.message}`)
									}
								}
								fs.writeFileSync(
									resolve(
										__dirname,
										`../../.cache/${fencePath.replace(/\//g, '__')}.json`,
									),
									JSON.stringify(data, null, 2),
									'utf8',
								)
							})
							.catch((e) => log.warn(`[KŌJI] Could not process ${fencePath}`, e))
					}
					return null
				}),
			)
		} else {
			log.info('[KŌJI] Kōji bearer token not found, skipping')
		}
	} catch (e) {
		log.error('[KŌJI] Could not process Kōji settings', e)
	}
}

module.exports.getKojiFences = getKojiFences

if (require.main === module) {
	getKojiFences().then(() => log.info('OK'))
}
