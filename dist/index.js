function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var socketIO = _interopDefault(require('socket.io-client'));
var nanobus = _interopDefault(require('nanobus'));

/**
 * The error types that cause the {@link SocketEvents} 'error' event to fire.
 * @type {Object} SOCKET_ERROR
 * @property {string} GENERAL A general socket error.
 * @property {string} TIMEOUT The ping to the server timed out.
 * @property {string} NO_ATTEMPTS_LEFT The client ran out of attempts to reconnect to the server.
 * @property {string} AUTH_INVALID_TOKEN The client is not granted access to the server due to the token being invalid.
 * @property {string} AUTH_TIMEOUT The client is not granted access to the server because the client took too long to authenticate.
 * @since 1.0.0
 */

var SOCKET_ERROR = {
  GENERAL: 'GENERAL',
  TIMEOUT: 'TIMEOUT',
  NO_ATTEMPTS_LEFT: 'NO_ATTEMPTS_LEFT',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
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

var DISCONNECT_REASON = {
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

var MissionControlClient = function MissionControlClient(url, authToken) {
  // URL and auth token are required parameters.
  if (!url) { throw new Error('You need to pass an URL.'); }
  if (!authToken) { throw new Error('You need to pass an Auth Token.'); }
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

  this.socket = socketIO(url);
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
  /** @type {Object<eventKey<string>, listenerCount<Number>>} */

  this._subscriptions = {};
  /** @type {Array<eventKey<string>>} */

  this._subscribeTo = [];
  /** @type {Array<eventKey<string>>} */

  this._unsubscribeFrom = [];

  this._setupSocketHandlers();
};
/**
 * This function sets up all the listeners for the socket (connect, disconnect, error, reconnect, etc).
 *
 * Job of this function is to unify all error events into a shape that makes more sense. See {@link SOCKET_ERROR} for the possible errors.
 */


MissionControlClient.prototype._setupSocketHandlers = function _setupSocketHandlers () {
    var this$1 = this;

  // We hijack the on event method to call it again with the '*' event which now gets called on
  // any event.
  var socketOnEvent = this.socket.onevent;

  this.socket.onevent = function (packet) {
    var args = packet.data || [];
    socketOnEvent.call(this, packet);
    packet.data = ['*'].concat(args);
    socketOnEvent.call(this, packet); // additional call for "*" event
  }; // This catches all other events and published them to our event bus


  this.socket.on('*', function (event) {
      var ref;

      var args = [], len = arguments.length - 1;
      while ( len-- > 0 ) args[ len ] = arguments[ len + 1 ];
    // Here we only pass the event to our event bus if the events arent our
    // own SocketEvents. If we wouldnt do this it would cause a collision
    // where listeners would fire twice: once for the actual socket emit and once
    // for our event bus. This bypasses this.
    if (!['connect', 'disconnect', 'reconnecting', 'error'].includes(event)) { (ref = this$1.eventBus).emit.apply(ref, [ event ].concat( args )); }
  }); // On connection we try to authenticate

  this.socket.on('connect', function () {
    this$1.socket.emit('authenticate', {
      token: this$1.authToken
    });
  }); // On successful connection & authentication

  this.socket.on('authenticated', function () {
    // While we still have events to subscribe to, do so on connect
    while (this$1._subscribeTo.length > 0) {
      this$1.socket.emit('subscribe', {
        event: this$1._subscribeTo.shift()
      });
    } // While we still have events to unsubscribe from, do so on connect


    while (this$1._unsubscribeFrom.length > 0) {
      this$1.socket.emit('unsubscribe', {
        event: this$1._unsubscribeFrom.shift()
      });
    } // We simplify the event structure here, by emitting a 'connect' event rather than a 'authenticated' event.
    // This essentially hides the implementation details of the authentication flow from the client user
    // which is what we're aiming for by making the client simple.


    this$1.eventBus.emit('connect');
  }); // On disconnect from server, reason can either be server disconnect, client disconnect or ping timeout.

  this.socket.on('disconnect', function (reason) {
    var disconnectReason;

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

    this$1.eventBus.emit('disconnect', disconnectReason);
  });
  /*
   * RECONNECTION
   */
  // On successful reconnect, attempt is the amount of attempts needed for the reconnect.
  // As of right now, not really needed for anything,
  // as the connect event fires on every successful connect, even reconnects.
  // this.socket.on('reconnect', attempt => {});
  // On reconnect attempt, attempt is the current attempt number

  this.socket.on('reconnect_attempt', function (attempt) {
    this$1.eventBus.emit('reconnecting', attempt);
  });
  /*
   * ERROR HANDLING
   */
  // On a general connection error, the error object is the error thrown

  this.socket.on('connect_error', function (error) {
    // TODO: determine errorType
    this$1.eventBus.emit('error', SOCKET_ERROR.GENERAL, error);
  }); // On a ping/connection timeout error, the timeout object is IDK what
  // TODO: what is the timeout object?

  this.socket.on('connect_timeout', function (timeout) {
    this$1.eventBus.emit('error', SOCKET_ERROR.TIMEOUT, timeout);
  }); // Called when we can't authenticate because of an invalid auth token or because
  // the client took too long to authenticate.

  this.socket.on('unauthorized', function (error) {
    var authErrorType = error.type === 'TIMEOUT' ? SOCKET_ERROR.AUTH_TIMEOUT : SOCKET_ERROR.AUTH_INVALID_TOKEN;
    this$1.eventBus.emit('error', authErrorType, error);
  }); // On reconnect error, dont know if needed for now
  // this.socket.on('reconnect_error', error => {});
  // On reconnection failed, fired becayse we run out of attempts
  // and not because there is an error in the connection

  this.socket.on('reconnect_failed', function () {
    this$1.eventBus.emit('error', SOCKET_ERROR.NO_ATTEMPTS_LEFT);
  });
};
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


MissionControlClient.prototype.on = function on (event, listener) {
    var this$1 = this;

  this.eventBus.on(event, listener);
  return function () { return this$1.eventBus.removeListener(event, listener); };
};
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


MissionControlClient.prototype.once = function once (event, listener) {
    var this$1 = this;

  this.eventBus.once(event, listener);
  return function () { return this$1.eventBus.removeListener(event, listener); };
};
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


MissionControlClient.prototype.subscribe = function subscribe (serverEvent, listener) {
    var this$1 = this;

  this.socket.on(serverEvent, listener);

  if (!(serverEvent in this._subscriptions)) {
    if (this.socket.connected) {
      this.socket.emit('subscribe', {
        event: serverEvent
      });
      this._subscriptions[serverEvent] = 1;
    } else {
      this._subscribeTo.push(serverEvent);
    }
  }

  return function () {
    this$1.socket.removeListener(serverEvent, listener);

    if (this$1.socket.connected) {
      this$1._subscriptions[serverEvent]--;

      if (this$1._subscriptions[serverEvent] === 0) {
        delete this$1._subscriptions[serverEvent];
        this$1.socket.emit('unsubscribe', {
          event: serverEvent
        });
      }
    } else {
      this$1._unsubscribeFrom.push(serverEvent);
    }
  };
};
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


MissionControlClient.prototype.action = function action (action$1, data) {
  this.socket.emit('action', {
    action: action$1,
    data: data
  });
};

exports.SOCKET_ERROR = SOCKET_ERROR;
exports.DISCONNECT_REASON = DISCONNECT_REASON;
exports.MissionControlClient = MissionControlClient;
//# sourceMappingURL=index.js.map
