import socketIO from 'socket.io-client';
import nanobus from 'nanobus';
import autoBind from 'auto-bind';

/**
 * The error types that cause the {@link SocketEvents} 'error' event to fire.
 * @typedef {SOCKET_ERROR}
 * @enum {string}
 * @property {string} GENERAL A general socket error.
 * @property {string} TIMEOUT The ping to the server timed out.
 * @property {string} NO_ATTEMPTS_LEFT The client ran out of attempts to reconnect to the server.
 * @property {string} AUTH_FAILED The client is not granted access to the server due to the token being invalid.
 * @property {string} AUTH_TIMEOUT The client is not granted access to the server because the client took too long to authenticate.
 * @since 1.0.0
 */
export const SOCKET_ERROR = {
	GENERAL: 'GENERAL',
	TIMEOUT: 'TIMEOUT',
	NO_ATTEMPTS_LEFT: 'NO_ATTEMPTS_LEFT',
	AUTH_FAILED: 'AUTH_FAILED',
	AUTH_TIMEOUT: 'AUTH_TIMEOUT'
};

/**
 * The disconnect reason that gets passed along with the {@link SocketEvents} 'disconnect' event.
 * @type {Object} DISCONNECT_REASON
 * @property {string} UNKNOWN An unknown disconnect reason.
 * @property {string} SERVER_DISCONNECT The server disconnected the client. A manual reconnect would be required.
 * @property {string} CLIENT_DISCONNECT The client disconnected from the server. A manual reconnect would be required.
 * @property {string} PING_TIMEOUT The ping to the server timed-out. The client will automatically try to reconnect.
 * @since 1.0.0
 */
export const DISCONNECT_REASON = {
	UNKNOWN: 'UNKNOWN',
	SERVER_DISCONNECT: 'SERVER_DISCONNECT',
	CLIENT_DISCONNECT: 'CLIENT_DISCONNECT',
	PING_TIMEOUT: 'PING_TIMEOUT'
};

/**
 * As ESDoc lacks a way to properly document events, this typedef shows all the different events the client might emit.
 * The "type" below is the callback argument for the listener.
 * @typedef SocketEvents
 * @property {void} connect Emitted on a successful connect to the server. Called after authentication.
 * @property {DISCONNECT_REASON} disconnect Emitted when the client disconnected from the server. The disconnect reason indicates why.
 * @property {SOCKET_ERROR, object} error Emitted when the encounters an error. The first argument is the {@link SOCKET_ERROR} object, indicating what the error object might be.
 * @property {Number} reconnecting Emitted once the clients starts trying to reconnect to the server. Attempt number passed to the listener.
 *
 * @example
 * client.on('error', (errorType, errorData) => {});
 * client.on('disconnect', reason => {});
 * client.on('reconnecting', attempt => {});
 */

/**
 * The mission control client class.
 *
 * You can easily build your own client implementation, this one is just easy to use and has everything you might need.
 *
 * The client hides the authentication implementation details from the user, by hijacking the `connect` event.
 * The connect event only gets called after the authentication scheme is successful.
 *
 * @since 1.0.0
 * @emits {connect} emit event when bar.
 */
export class MissionControlClient {
	/**
	 * The MissionControlClient constructor.
	 *
	 * @param {string} url - The mission control url the client should connect to.
	 * @param {string} authToken - The JWT authentication token that should be used to authenticate.
	 */
	constructor(url, authToken, { logger } = {}) {
		// URL and auth token are required parameters.
		if (!url) throw new Error('You need to pass an URL.');
		if (!authToken) throw new Error('You need to pass an Auth Token.');

		/**
		 * The JWT authentication token that is used to authenticate.
		 * @type {string}
		 */
		this.authToken = authToken;

		/**
		 * The socket.io socket used for the communication.
		 *
		 * While it is possible it is recommended not to use this variable directly and to use the exposed {@link MissionControlClient#action} and {@link MissionControlClient#subscribe} methods instead.
		 *
		 * @type socket.io-client~Socket
		 * @since 1.0.0
		 */
		this.socket = socketIO(url, {
			path: '/api/socket.io'
		});

		/**
		 * The event bus used to communicate events within the client.
		 *
		 * While it is possible it is recommended not to use this variable directly and to use the exposed {@link MissionControlClient#on} and {@link MissionControlClient#subscribe} methods instead.
		 *
		 * @type socket.io-client~Nanobus
		 * @emits {SocketEvent}
		 * @since 1.0.0
		 */
		this.eventBus = nanobus();

		this.ready = false;

		this._services = {};

		/** @type {Record<string, { listeners: number }>} */
		this._services = {};

		/** @type {Record<string, object>} */
		this._stateCache = {};

		const title = ['%cmission-control-client -', 'color:#a78bfa; font-weight: bold; cursor: default; pointer-events: none;user-select: none;'];
		this.logger = logger || {
			debug: (...args) => console.log(...title, ...args),
			warn: (...args) => console.warn(...title, ...args),
			error: (...args) => console.error(...title, ...args)
		};

		this._setupSocketHandlers();

		autoBind(this);
	}

	/**
	 * This function sets up all the listeners for the socket (connect, disconnect, error, reconnect, etc).
	 *
	 * Job of this function is to unify all error events into a shape that makes more sense. See {@link SOCKET_ERROR} for the possible errors.
	 */
	_setupSocketHandlers() {
		// We hijack the on event method to call it again with the '*' event which now gets called on
		// any event.
		const socketOnEvent = this.socket.onevent;
		this.socket.onevent = function(packet) {
			const args = packet.data || [];
			socketOnEvent.call(this, packet);

			packet.data = ['*'].concat(args);
			socketOnEvent.call(this, packet); // additional call for "*" event
		};

		// This catches all other events and published them to our event bus
		this.socket.on('*', (event, ...args) => {
			// Here we only pass the event to our event bus if the events arent our
			// own SocketEvents. If we wouldnt do this it would cause a collision
			// where listeners would fire twice: once for the actual socket emit and once
			// for our event bus. This bypasses this.
			if (
				!['connect', 'disconnect', 'reconnecting', 'error'].includes(
					event
				)
			)
				this.eventBus.emit(`internal:${event}`, ...args);
		});

		// On connection we try to authenticate
		this.socket.on('connect', async () => {
			try {
				this.ready = false;

				this.logger.debug('auth:start');
				
				const response = await this._socketEmit('authenticate', {
					token: this.authToken
				});

				this.ready = true;
				
				this.logger.debug('auth:complete', response);
				this.logger.debug('ready');

				// Re-Subscribe to all services after reconnect
				for (const service in this._services) {
					this.logger.debug('subscribe to service:', service);

					this._socketEmit('subscribe', { service })
						.catch(this.reportError);
				}

				// // While we still have events to unsubscribe from, do so on connect
				// while (this._unsubscribeFrom.length > 0) {
				// 	this._socketEmit('unsubscribe', {
				// 		service: this._unsubscribeFrom.shift()
				// 	}).then(console.info).catch(console.error);
				// }

				// We simplify the event structure here, by emitting a 'connect' event rather than a 'ready' event.
				// This essentially hides the implementation details of the authentication flow from the client user
				// which is what we're aiming for by making the client simple.

				this.eventBus.emit('connect');
			} catch (e) {
				this.ready = false;

				this.eventBus.emit('error', SOCKET_ERROR.AUTH_FAILED, e);
			}
		});

		// On disconnect from server, reason can either be server disconnect, client disconnect or ping timeout.
		this.socket.on('disconnect', reason => {
			let disconnectReason;

			switch (reason) {
				case 'io server disconnect':
					disconnectReason = DISCONNECT_REASON.SERVER_DISCONNECT;
					break;
				case 'io client disconnect':
					disconnectReason = DISCONNECT_REASON.CLIENT_DISCONNECT;
					break;
				case 'ping timeout':
					disconnectReason = DISCONNECT_REASON.CLIENT_DISCONNECT;
					break;
				default:
					disconnectReason = DISCONNECT_REASON.UNKNOWN;
			}

			this.ready = false;

			this.eventBus.emit('disconnect', disconnectReason);
		});

		/*
		 * RECONNECTION
		 *
		 * On successful reconnect, attempt is the amount of attempts needed for the reconnect.
		 * As of right now, not really needed for anything,
		 * as the connect event fires on every successful connect, even reconnects.
		 * this.socket.on('reconnect', attempt => {});
		 */

		// On reconnect attempt, attempt is the current attempt number
		this.socket.on('reconnect_attempt', attempt => {
			this.ready = false;
			this.eventBus.emit('reconnecting', attempt);
		});

		/*
		 * SYNC
		 */
		this.socket.on('sync', ({ service: serviceName, state }) => {
			try {
				this.logger.debug('sync – service:', serviceName, 'state:', state);

				if (!this._services[serviceName]) {
					return this.logger.warn('received sync update for unsubscribed service', serviceName, state);
				}

				this._stateCache[serviceName] = state;
				this.eventBus.emit(`sync:${serviceName}`, state);
			} catch (e) {
				this.reportError(e);
			}
		});

		/*
		 * ERROR HANDLING
		 */
		this._setupErrorHandlers();
	}

	_setupErrorHandlers() {
		// On a general connection error, the error object is the error thrown
		this.socket.on('connect_error', error => {
			this.ready = false;

			// TODO: determine errorType
			this.eventBus.emit('error', SOCKET_ERROR.GENERAL, error);
		});

		// On a ping/connection timeout error, the timeout object is IDK what
		// TODO: what is the timeout object?
		this.socket.on('connect_timeout', timeout => {
			this.ready = false;

			this.eventBus.emit('error', SOCKET_ERROR.TIMEOUT, timeout);
		});

		// Called when we can't authenticate because of an invalid auth token or because
		// the client took too long to authenticate.
		this.socket.on('authentication_timeout', ({ error }) => {
			this.ready = false;

			this.eventBus.emit('error', SOCKET_ERROR.AUTH_TIMEOUT, error);
		});

		// On reconnect error, dont know if needed for now
		// this.socket.on('reconnect_error', error => {});

		// On reconnection failed, fired becayse we run out of attempts
		// and not because there is an error in the connection
		this.socket.on('reconnect_failed', () => {
			this.ready = false;

			this.eventBus.emit('error', SOCKET_ERROR.NO_ATTEMPTS_LEFT);
		});
	}

	/**
	 * Internal socket emit helper
	 * @async
	 * @protected
	 * @param  {string} event Event to emit
	 * @param  {[type]} data  Data to send
	 * @return {object}       Response data
	 * @throws Error
	 */
	_socketEmit(event, data) {
		return new Promise((resolve, reject) => {
			this.socket.emit(event, data, (response) => {
				if (response.error) {
					return reject(response.error);
				}

				resolve(response);
			});
		});

	}

	/**
	 * Listen to a socket event.
	 *
	 * Please note, if you want to subscribe to action or state events, please use the {@link subscribe} method.
	 * The returned function can be used to unsubscribe from the event listener again.
	 * This makes it possible to for example remove inline listeners.
	 *
	 * @param {string} event - The socket event you want to listen to.
	 * @param {function(data: object)} listener - The listener function that will be called on event.
	 * @return {function} Returns a function which you can use to remove the event listener.
	 *
	 * @since 1.0.0
	 * @example
	 * on('connect', () => {})
	 * on('error', (errorType, errorObject) => {})
	 */
	on(event, listener) {
		this.eventBus.on(event, listener);

		return () => this.eventBus.removeListener(event, listener);
	}

	/**
	 * Listen to a socket event, and clear it after it's been called once.
	 *
	 * Please note, if you want to subscribe to action or state events, please use the {@link subscribe} method.
	 * The returned function can be used to unsubscribe from the event listener again.
	 * This makes it possible to for example remove inline listeners.
	 *
	 * @param {string} event - The socket event you want to listen to.
	 * @param {function(data: object)} listener - The listener function that will be called on event once.
	 * @return {function} Returns a function which you can use to remove the event listener.
	 *
	 * @since 1.0.0
	 * @example
	 * once('connect', (data) => {})
	 */
	once(event, listener) {
		this.eventBus.once(event, listener);

		return () => this.eventBus.removeListener(event, listener);
	}

	/**
	 * Subscribe to a server event (actions, state updates).
	 *
	 * To subscribe to a server event, we need to emit a 'subscribe' event to the server so it knows
	 * to broadcast the right events to us. This function automatically handles these 'subscribe' and
	 * 'unsubscribe' events so you can simply use this method to do it. When we disconnect from
	 * the server, this function also handles resubscribing to the events.
	 * It returns a function that can you can use to remove the event listener again and unsubscribe from the server.
	 *
	 * @param {string} serverEvent - This is the server event you want to subscribe to. Keep in mind these are not general socket events, but rather state / action Mission Control events.
	 * @param {function(data: object)} listener - The listener function that will be called on event.
	 * @return {function} Returns a function which you can use to remove the event listener.
	 *
	 * @since 1.0.0
	 * @example
	 * client.subscribe('action:EXAMPLE:DO', (data) => {})
	 * client.subscribe('update:stateObject', (data) => {});
	 */
	service(name, listener) {
		const errorHandledListener = async (state) => {
			try {
				await listener(state);
			} catch (e) {
				this.logger.error('error in service state handler ' + name, e);

				this.reportError(e);
			}
		};

		this.eventBus.on(`sync:${name}`, errorHandledListener);

		// If we find "older" state in the cache, we send that for first paint
		const staleState = this._stateCache[name];
		if (staleState) {
			this.logger.debug('found stale state for service', name);
			errorHandledListener(staleState);
		}

		if (name in this._services) {
			this.logger.debug('already subscribed to sync from', name);

			this._services[name].listeners++;
		} else {
			this._services[name] = { 
				listeners: 1
			};

			// If the client is ready, that means
			// it has already started subscriptions for things in this._services.
			// We have to connect manually here.
			// However this listener is registered in this._services now
			// so on next automatic resubscribe (after disconnect) it will be included.
			if (this.ready) {
				this.logger.debug('subscribe to service:', name);

				this._socketEmit('subscribe', {
					service: name
				}).catch(this.reportError);
			}
		}

		const unsubscribe = () => {
			this.logger.debug('listener unsubscribed from service', name);

			this.eventBus.removeListener(`sync:${name}`, listener);
			this._services[name].listeners--;

			if (this._services[name].listeners <= 0) {
				this.logger.debug('removing service from sync', name);

				delete this._services[name];

				if (this.socket.ready) {
					this._socketEmit('unsubscribe', {
						service: name
					}).catch(this.reportError);
				}
			}
		};

		// Getters (ready, state) don't allow arrow functions
		// so we have the good old JS 'this' problem again.
		const _this = this;

		return {
			get ready() {
				return _this._stateCache[name] !== null;
			},
			async action(actionName, data) {
				await _this.action(name, actionName, data);
			},
			get state() {
				return _this._stateCache[name] || null;
			},
			unsubscribe
		}
	}

	/**
	 * Execute an action on the mission control server.
	 *
	 * This method sends an 'action' event, which the server will use to execute the action and modify
	 * the state accordingly.
	 *
	 * @param {string} action - The action that you want to execute.
	 * @param {object} data - The data you want to pass to the action function.
	 *
	 * @since 1.0.0
	 * @async
	 * @example
	 * client.action('EXAMPLE:DO', { parameter: 'example' })
	 * client.action('VIDEO-QUEUE:PUSH', { video: { url: '...', format: 'mp4' }})
	 */
	action(service, action, data) {
		return new Promise((resolve, reject) => {
			this.socket.emit('action', { service, action, data }, (res) => {
				if (res.error) {
					reject(new Error(res.error.message));
				} else {
					resolve(res);
				}
			});
		});
	}

	/**
	 * Report a general error to the user of the library
	 * @param {Error} error The error object
	 */
	reportError(error) {
		this.logger.error('error reported', error);

		this.eventBus.emit('error', SOCKET_ERROR.GENERAL, error);
	}
}
