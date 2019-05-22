# Mission Control Client – mission-control-client

> A client for Node.js and the browser to easily connect and interact with the Mission Control system.

[![NPM Version][npm-image]][npm-url]
[![Downloads Stats][npm-downloads]][npm-url]

This mission-control-client is used to simplify my custom applications that I write for the Mission Control home automation system.
This library makes it very easy to add features to every little thing I built for it.

<!-- ![](header.png) -->

## Installation

```sh
npm install mission-control-client --save
```

## Usage Examples

The library can then be used like this:

```js
import { MissionControlClient } from 'mission-control-client';

const client = new MissionControlClient('http://localhost', '<API-KEY>');

// Listen to socket events
client.on('connect', () => {
	console.log('We have a connection');
});

client.on('disconnect', reason => {
	console.log('Disconnected again for reason:', reason);
});

// Listen to mission control events.
client.subscribe('action:VIDEO-QUEUE:PUSH', data => { /* ... */ });
client.subscribe('update:videoQueue', data => { /* ... */ });

// Run an action
client.action('NOTIFICATION:CREATE', { /* data *? });
```

_For more examples and usage, please refer to the [Docs][docs]._

## Development Setup

Describe how to install all development dependencies and how to run an automated test-suite of some kind. Potentially do this for multiple platforms.

```sh
# To build the docs
npm run docs

# To build
npm build
```

## Release History

-   1.0.0
    -   The first proper release

## Authors

Lukas Mateffy – [@Capevace](https://twitter.com/capevace) – [mateffy.me](https://mateffy.me)

Distributed under the MIT license. See `LICENSE` for more information.

## Contributing

1. Fork it (<https://github.com/capevace/mission-control-client/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

## Acknowledgments

Some acknowledgements.

<!-- Markdown link & img dfn's -->

[npm-image]: https://img.shields.io/npm/v/mission-control-client.svg?style=flat-square
[npm-url]: https://npmjs.org/package/mission-control-client
[npm-downloads]: https://img.shields.io/npm/dm/mission-control-client.svg?style=flat-square
[wiki]: https://github.com/capevace/mission-control-client/wiki
[docs]: https://capevace.github.io/mission-control-client
