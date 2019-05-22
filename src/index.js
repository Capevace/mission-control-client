const socketIO = require('socket.io-client');
const nanobus = require('nanobus')();

/**
 * The error types that cause the {@link SocketEvents} 'error' event to fire.
 * @type {Object} SOCKET_ERROR
 * @property {string} GENERAL A general socket error.
 * @property {string} TIMEOUT The ping to the server timed out.
 * @property {string} NO_ATTEMPTS_LEFT The client ran out of attempts to reconnect to the server.
 * @property {string} AUTH_FAILED The client is not granted access to the server.
 * @since 1.0.0
 */
export const SOCKET_ERROR = {
	GENERAL: 'GENERAL',
	TIMEOUT: 'TIMEOUT',
	NO_ATTEMPTS_LEFT: 'NO_ATTEMPTS_LEFT',
	AUTH_FAILED: 'AUTH_FAILED'
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
 * @property {void} connect Emitted on a successful connect to the server.
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
 * @since 1.0.0
 * @emits {connect} emit event when bar.
 */
export class MissionControlClient {
	/**
	 * The MissionControlClient constructor.
	 *
	 * You can easily build your own client implementation, this one is just easy to use and has everything you might need.
	 * @param {string} url - The mission control url the client should connect to.
	 * @param {string} authToken - The JWT authentication token that should be used to authenticate.
	 */
	constructor(url, authToken) {
		/**
		 * @type socket.io-client~Socket
		 * @since 1.0.0
		 */
		this.socket = socketIO(url, {
			query: { token: authToken }
		});

		/**
		 * @type socket.io-client~Nanobus
		 * @emits {SocketEvent}
		 * @since 1.0.0
		 */
		this.eventBus = nanobus();

		/** @type {Object<eventKey<string>, listenerCount<Number>>} */
		this._subscriptions = {};
		/** @type {Array<eventKey<string>>} */
		this._subscribeTo = [];
		/** @type {Array<eventKey<string>>} */
		this._unsubscribeFrom = [];

		this._setupSocketHandlers();
	}

	/**
	 * This function sets up all the listeners for the socket (connect, disconnect, error, reconnect, etc).
	 *
	 * Job of this function is to unify all error events into a shape that makes more sense. See {@link SOCKET_ERROR} for the possible errors.
	 */
	_setupSocketHandlers() {
		// On successful connection
		this.socket.on('connect', () => {
			cleanSubscriptions();

			this.eventBus.emit('connect');
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

			this.eventBus.emit('disconnect', disconnectReason);
		});

		/*
		 * RECONNECTION
		 */
		// On successful reconnect, attempt is the amount of attempts needed for the reconnect.
		// As of right now, not really needed for anything,
		// as the connect event fires on every successful connect, even reconnects.
		// this.socket.on('reconnect', attempt => {});

		// On reconnect attempt, attempt is the current attempt number
		this.socket.on('reconnect_attempt', attempt => {
			this.eventBus.emit('reconnecting', attempt);
		});

		/*
		 * ERROR HANDLING
		 */
		// On a general connection error, the error object is the error thrown
		this.socket.on('connect_error', error => {
			// TODO: determine errorType
			this.eventBus.emit('error', SOCKET_ERROR.GENERAL, error);
		});

		// On a ping/connection timeout error, the timeout object is IDK what
		// TODO: what is the timeout object?
		this.socket.on('connect_timeout', timeout => {
			this.eventBus.emit('error', SOCKET_ERROR.TIMEOUT, timeout);
		});

		// On reconnect error, dont know if needed for now
		// this.socket.on('reconnect_error', error => {});

		// On reconnection failed, fired becayse we run out of attempts
		// and not because there is an error in the connection
		this.socket.on('reconnect_failed', () => {
			this.eventBus.emit('error', SOCKET_ERROR.NO_ATTEMPTS_LEFT);
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
	subscribe(serverEvent, listener) {
		this.socket.on(serverEvent, listener);

		if (!(serverEvent in this.subscriptions)) {
			if (this.socket.connected) {
				this.socket.emit('subscribe', {
					event: serverEvent
				});
				this.subscriptions[serverEvent] = 1;
			} else {
				this.subscribeTo.push(serverEvent);
			}
		}

		return () => {
			this.socket.removeListener(serverEvent, listener);

			if (this.socket.connected) {
				this.subscriptions[serverEvent]--;

				if (this.subscriptions[serverEvent] === 0) {
					delete this.subscriptions[serverEvent];

					this.socket.emit('unsubscribe', {
						event: serverEvent
					});
				}
			} else {
				this.unsubscribeFrom.push(serverEvent);
			}
		};
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
	 * @example
	 * client.action('EXAMPLE:DO', { parameter: 'example' })
	 * client.action('VIDEO-QUEUE:PUSH', { video: { url: '...', format: 'mp4' }})
	 */
	action(action, data) {
		this.socket.emit('action', { action, data });
	}
}
