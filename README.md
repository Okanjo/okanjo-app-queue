# Okanjo RabbitMQ Service

[![Build Status](https://travis-ci.org/Okanjo/okanjo-app-queue.svg?branch=master)](https://travis-ci.org/Okanjo/okanjo-app-queue) [![Coverage Status](https://coveralls.io/repos/github/Okanjo/okanjo-app-queue/badge.svg?branch=master)](https://coveralls.io/github/Okanjo/okanjo-app-queue?branch=master)

Service for interfacing with RabbitMQ for the Okanjo App ecosystem.

This package:

* Manages connectivity and reconnection edge cases
* Provides message publishing and consumer functionality
* Provides a worker class for one-at-a-time message consumption
* Provides a worker class for batch message consumption
* Uses [Rascal](https://github.com/guidesmiths/rascal) for the underlying queue configuration and interface.

## Installing

Add to your project like so: 

```sh
npm install okanjo-app-queue
```

Note: requires the [`okanjo-app`](https://github.com/okanjo/okanjo-app) module.

## Breaking Changes

### v6.0.0
 * Node 10 no longer supported
 * Updated to Rascal v4
 * Updated to OkanjoApp v3

### v2.0.0

 * Underlying driver has changed from forked-version of postwait's `amqp` to rascal/amqplib
 * Queue configuration has changed, see Rascal's configuration scheme
 * QueueService
   * constructor no longer takes `queues` param, this is setup in the Rascal config
   * `queues` property has been removed
   * `connect` is now an async function (no more callback)
   * many internal member functions have been removed
 * QueueWorker
   * constructor option `queueName` is now `subscriptionName`
   * constructor requires option `service` (instance of QueueService)
   * many internal members have been removed
   * `init` is now an async function (no more callback)
   * `subscribe` is now an async function (no more callback)
   * `onReady` has been removed
   * `onSubscribed` no longer has arguments
   * `onUnsubscribed` no longer has arguments
   * `onMessage` signature has changed to `(message, content, ackOrNack)`
   * `onMessageHandled` has been removed
   * `handleMessage` signature has changed to `(message, content, ackOrNack)`
   * `onServiceError` has been removed
 * BatchQueueWorker
   * option `batchSize` now translates to a prefetch of (batchSize * 2), so Async.Cargo can optimally deliver the desired batch size to the app.
   * `handleMessageBatch` has changed signature to (messages, defaultAckOrNack)
     * Messages are wrapped, and can be individually acknowledged via `messages[i].ackOrNack(...)`. Likewise, `defaultAckOrNAck(...)` will handle the remaining messages in the batch.
   * `onMessage` signature has changed to `(message, content, ackOrNack)`
   * `onMessageHandled` has been removed
   * `prepareForShutdown` override has been removed

## Example Usage

Here's an example app:

* `example-app`
  * `workers/`
    * `MyBatchWorker.js`
    * `MyQueueWorker.js`
  * `config.js`
  * `index.js`

### `example-app/workers/MyBatchWorker.js`
This is an example of a consumer that processes a batch of messages at a time. This is useful for bulk tasks, such as indexing in elasticsearch or other similar operations.
```js
"use strict";

const BatchQueueWorker = require('okanjo-app-queue/BatchQueueWorker');

class MyBatchWorker extends BatchQueueWorker {

    constructor(app) {
        super(app, {
            service: app.services.queue,
            subscriptionName: app.config.rabbit.queues.batch,
            batchSize: 5
        });
    }

    handleMessageBatch(messages, defaultAckOrNack) {

        // FYI: messages will be an array of message objects, not message payloads

        // This worker will simply report the values of the messages it is processing
        const values = messages.map((message) => message.content.my_message);
        console.log(`MyBatchWorker consumed messages: ${values.join(', ')}`);

        // ack all of the processed messages
        defaultAckOrNack();

        // or you could reject/requeue them too:
        // defaultAckOrNack(err, recovery);
    }
}

module.exports = MyBatchWorker;
```

### `example-app/workers/MyQueueWorker.js`
This is an example of a typical consumer that takes handles one message at a time. This is generally the worker you'll want to use.
```js
"use strict";

const QueueWorker = require('okanjo-app-queue/QueueWorker');

class MyQueueWorker extends QueueWorker {

    constructor(app) {
        super(app, {
            service: app.services.queue,
            subscriptionName: app.config.rabbit.queues.events
        });
    }

    handleMessage(message, content, ackOrNack) {

        // This worker will simply report the values of the messages it is processing
        console.log(`MyQueueWorker consumed message: ${content.my_message}`);

        // Ack the message
        ackOrNack();

        // or you could reject, requeue it
        // ackOrNack(err, recovery);
    }
}

module.exports = MyQueueWorker;
```

### `example-app/config.js`
Typical OkanjoApp configuration file, containing the queue service config. Generates exchanges, queues, bindings, publications and subscriptions based only on the queue names.
```js
"use strict";

// Ordinarily, you would set normally and not use environment variables,
// but this is for ease of running the example across platforms
const hostname = process.env.RABBIT_HOST || 'localhost';
const port = process.env.RABBIT_PORT || 5672;
const user = process.env.RABBIT_USER || 'guest';
const password = process.env.RABBIT_PASS || 'guest';
const vhost = process.env.RABBIT_VHOST || '/';

const queues = {
    events: "my_events",
    batch: "my_batches"
};

const generateConfigFromQueueNames = require('../../QueueService').generateConfigFromQueueNames;


module.exports = {
    rabbit: {
        rascal: {
            vhosts: {
                [vhost]: generateConfigFromQueueNames(Object.values(queues), {
                    connections: [
                        {
                            hostname,
                            user,
                            password,
                            port,
                            options: {
                                heartbeat: 1
                            },
                            socketOptions: {
                                timeout: 1000
                            }
                        }
                    ]
                })
            }
        },

        // What exchanges/queues to setup (they'll be configured to use the same name)
        queues,
    }
};
```

### `index.js`
Example application that will connect, enqueue, and consume messages. Cluster is used to consume messages on forked processes, to keep the main process clean.
```js
"use strict";

const Cluster = require('cluster');
const Async = require('async');
const OkanjoApp = require('okanjo-app');
const OkanjoBroker = require('okanjo-app-broker');
const QueueService = require('okanjo-app-queue');

const config = require('./config');
const app = new OkanjoApp(config);

app.services = {
    queue: new QueueService(app, config.rabbit)
};

if (Cluster.isMaster) {

    // Start queue worker brokers (consumer workers run as a separate process)
    const myBatchBroker = new OkanjoBroker(app, 'my_batch_worker');
    const myQueueBroker = new OkanjoBroker(app, 'my_queue_worker');

    // Start the main application
    app.connectToServices().then(() => {

        // Everything connected, now we can send out some messages to our workers

        // You can use service.queues.key as an enumeration when working with queues
        const batchQueueName = app.config.rabbit.queues.batch;
        const regularQueueName = app.config.rabbit.queues.events;

        // Send out a batch of messages to the batch queue
        Async.eachSeries(
            [0,1,2,3,4,5,6,7,8,9],
            (i, next) => {
                app.services.queue.publishMessage(batchQueueName, { my_message: i }, (err) => {
                    next(err);
                });
            },
            (err) => {
                if (err) console.error('Failed to send batch messages', err);

                // Now send out a couple regular queue messages
                Async.eachSeries(
                    [10, 11],
                    (i, next) => {
                        app.services.queue.publishMessage(regularQueueName, { my_message: i }, (err) => {
                            next(err);
                        });
                    },
                    (err) => {
                        if (err) console.error('Failed to send messages', err);

                        // Wait a second for the consumers to gobble up the messages
                        setTimeout(() => {
                            console.log('Done!');
                            process.exit(0);
                        }, 1000);
                    }
                );
            }
        );

    });

} else {

    // Which worker should this process start?
    let Worker;
    if (process.env.worker_type === "my_batch_worker") {
        Worker = require('./workers/MyBatchWorker');
    } else if (process.env.worker_type === "my_queue_worker") {
        Worker = require('./workers/MyQueueWorker');
    } else {
        throw new Error('Unknown worker type: ' + process.env.worker_type);
    }

    // Start the worker
    new Worker(app);
}
```

When run, the output you would expect to see looks something like this:
```text
 > Subscribed to the my_events queue
 > Subscribed to the my_batches queue
MyQueueWorker consumed message: 10
MyQueueWorker consumed message: 11
MyBatchWorker consumed messages: 0, 1, 2, 3, 4
MyBatchWorker consumed messages: 5, 6, 7, 8, 9
Done!
```

A runnable version of this application can be found in [docs/example-app](https://github.com/okanjo/okanjo-app-queue/tree/master/docs/example-app).

# QueueService

RabbitMQ management class. Must be instantiated to be used.

## Properties
* `service.app` – (read-only) The OkanjoApp instance provided when constructed
* `service.config` – (read-only) The queue service configuration provided when constructed
* `service.broker` – (read-only) The underlying Rascal broker (promised)

## Methods

### `new QueueService(app, config)`
Creates a new queue service instance.
* `app` – The OkanjoApp instance to bind to
* `config` – The Rascal configuration object. See [Rascal](https://github.com/guidesmiths/rascal)

### `service.publishMessage(queue, data, [options], [callback])`
Publishes a message to a Rascal publication.
* `queue` – The name of the Rascal publication to send to
* `data` – The object message to publish.
* `options` – (Optional) Additional [publication options](https://github.com/guidesmiths/rascal#publications), if needed.
* `callback(err)` – (Optional) Function to fire when message has been sent or failed to send.
* Returns a promise. 


## Static Methods

### `QueueService.generateConfigFromQueueNames(queueNames, [config, [options]])`
Generates a QueueService config based on an array of queue names.
* `queueNames` – Array of string queue names
* `config` - Optional base configuration. Will be generated not given.
  * `config.exchanges` – Exchanges container object
  * `config.queues` – Queues container object
  * `config.bindings` – Bindings container object
  * `config.subscriptions` – Subscriptions container object
  * `config.publications` – Publications container object
* `options` – Additional options when configuring exchanges, queues, and bindings
  * `options.exchangeDefaults` - Options to set on the Rascal exchange configuration
  * `options.queueDefaults` – Options to set on the Rascal queue configuration
  * `options.bindingDefaults` – Options to set on the Rascal bindings configuration 
Returns a usable configuration object for QueueService/Rascal

For example:

```js
const queueNames = ['queue1','queue2','queue3'];
const baseConfig = {
    connections: [ 
        {
            hostname: '127.0.0.1',
            port: 1234,
            user: 'username',
            password: 'password',
            options: { heartbeat: 1 },
            socketOptions: { timeout: 10000 },
            management: { url: 'http://username:password@127.0.0.1:1234' }
        }
    ]
};
const configOptions = {
    exchangeDefaults: {
        assert: true,
        type: 'direct'
    }
};
const config = {
    rascal: {
        vhosts: {
            my_vhost: QueueService.generateConfigFromQueueNames(queueNames, baseConfig, configOptions)
        }
    }
};
```

Is the same as:

```js
config = {
    rascal: {
        vhosts: {
            my_vhost: {
                connections: [
                    {
                        hostname: '127.0.0.1',
                        port: 1234,
                        user: 'username',
                        password: 'password',
                        options: { heartbeat: 1 },
                        socketOptions: { timeout: 10000 },
                        management: { url: 'http://username:password@127.0.0.1:1234' }
                    }
                ],
                exchanges: {
                    queue1: {assert: true, type: 'direct'},
                    queue2: {assert: true, type: 'direct'},
                    queue3: {assert: true, type: 'direct'}
                },
                queues: {queue1: {}, queue2: {}, queue3: {}},
                bindings: {
                    queue1: {
                        bindingKey: '',
                        destinationType: 'queue',
                        source: 'queue1',
                        destination: 'queue1'
                    },
                    queue2: {
                        bindingKey: '',
                        destinationType: 'queue',
                        source: 'queue2',
                        destination: 'queue2'
                    },
                    queue3: {
                        bindingKey: '',
                        destinationType: 'queue',
                        source: 'queue3',
                        destination: 'queue3'
                    }
                },
                subscriptions: {
                    queue1: {queue: 'queue1'},
                    queue2: {queue: 'queue2'},
                    queue3: {queue: 'queue3'}
                },
                publications: {
                    queue1: {exchange: 'queue1'},
                    queue2: {exchange: 'queue2'},
                    queue3: {exchange: 'queue3'}
                }
            }
        }
    }
};
```


## Events

This class does not emit events.


# QueueWorker

Base class for basic queue consumer applications. Must be extended to be useful.

## Properties
* `worker.service` – (read-only) The QueueService instance provided when constructed
* `worker.subscriptionName` – (read-only) The name of the Rascal subscriber the worker consumes
* `worker.queueSubscriptionOptions` – (read-only) The Rascal subscription [subscribe options](https://github.com/guidesmiths/rascal#subscriptions) to use when subscribing
* `worker.verbose` – Whether to report various state changes
* `worker.nack` – Basic strategies that can be used for message handling
  * `worker.nack.drop` – Discards or dead-letters the message
  * `worker.nack.requeue` – Replaces the message back on top of the queue after a 1 second delay
  * `worker.nack.republish` – Requeues the message on to the bottom of the queue after a 1 second delay
  * `worker.nack.default` – Pointer to `worker.nack.republish`.
  * `worker.nack._redeliveriesExceeded` – Used when a message fails redelivery attempts. Defaults to `worker.nack.default`
  * `worker.nack._invalidContent` – Used when a message fails to parse. Defaults to `worker.nack.default`
  
> Note: You can change `worker.nack._redeliveriesExceeded` and `worker.nack._invalidContent` to suit the needs of your application
  
## Methods

### `new QueueWorker(app, options)`
Creates a new instance of the worker. Use `super(app, options)` when extending.
* `app` – The OkanjoApp instance to bind to
* `options` – Queue worker configuration options
  * `options.subscriptionName` – (required) The name of the Rascal subscription to consume
  * `options.service` – (required) The QueueService instance to use for communication
  * `options.queueSubscriptionOptions` – (optional) The Rascal subscription [subscribe options](https://github.com/guidesmiths/rascal#subscriptions) to use when subscribing
  * `options.verbose` (optional) Whether to log various state changes. Defaults to `true`.
  * `options.skipInit` (optional) Whether to skip initialization/connecting at construction time. Use this for customizations or class extensions if needed. Defaults to `false`. 

### `worker.handleMessage(message, content, ackOrNack)`
Message handler. Override this function to let your application handle messages.
* `message` – The Rascal message object
* `content` – The parsed content of the message
* `ackOrNack(err, recovery, callback)` – Acknowledge or reject the message. See [recovery strategies](https://github.com/guidesmiths/rascal#message-acknowledgement-and-recovery-strategies). 


## Events

This class does not emit events.

# BatchQueueWorker

Base class for batch message consumption applications. Must be extended to be useful. It extends QueueWorker.

## Properties
* `worker.service` – (read-only) The QueueService instance provided when constructed
* `worker.subscriptionName` – (read-only) The name of the Rascal subscriber the worker consumes
* `worker.queueSubscriptionOptions` – (read-only) The Rascal subscription [subscribe options](https://github.com/guidesmiths/rascal#subscriptions) to use when subscribing
* `worker.verbose` – Whether to report various state changes
* `worker.nack` – Basic strategies that can be used for message handling
  * `worker.nack.drop` – Discards or dead-letters the message
  * `worker.nack.requeue` – Replaces the message back on top of the queue after a 1 second delay
  * `worker.nack.republish` – Requeues the message on to the bottom of the queue after a 1 second delay
  * `worker.nack.default` – Pointer to `worker.nack.republish`.
  * `worker.nack._redeliveriesExceeded` – Used when a message fails redelivery attempts. Defaults to `worker.nack.default`
  * `worker.nack._invalidContent` – Used when a message fails to parse. Defaults to `worker.nack.default`
* `worker.batchSize` – (read-only) Up to how many messages to process at one time.
  
> Note: You can change `worker.nack._redeliveriesExceeded` and `worker.nack._invalidContent` to suit the needs of your application

> Note: Internally, the consumer prefetch count will be exactly twice the given `batchSize`. This is so the application 
> can try to process the given batchSize at any given time. Async.Cargo is the primary driver for batches, so you may not 
> always receive a full batch. 
 
## Methods

### `new BatchQueueWorker(app, options)`
Creates a new instance of the worker. Use `super(app, options)` when extending.
* `app` – The OkanjoApp instance to bind to
* `options` – Queue worker configuration options
  * `options.subscriptionName` – (required) The name of the Rascal subscription to consume
  * `options.service` – (required) The QueueService instance to use for communication
  * `options.queueSubscriptionOptions` – (optional) The Rascal subscription [subscribe options](https://github.com/guidesmiths/rascal#subscriptions) to use when subscribing
  * `options.verbose` (optional) Whether to log various state changes. Defaults to `true`.
  * `options.skipInit` (optional) Whether to skip initialization/connecting at construction time. Use this for customizations or class extensions if needed. Defaults to `false`. 
  * `options.batchSize` – (optional) Up to how many messages to consume at a time. Defaults to `5`.
  
### `worker.handleMessageBatch(messages, defaultAckOrNack)`
Batch message handler. Override this function to let your app handle messages.
* `messages` – Array of wrapped Rascal messages.
  * `message[i].message` – Message object 
  * `message[i].content` – Parsed message content
  * `message[i].ackOrNack(err, recovery, callback)` – Individual message handler. See [recovery strategies](https://github.com/guidesmiths/rascal#message-acknowledgement-and-recovery-strategies).  
* `defaultAckOrNack(err, recovery, callback)` – Default message handler to apply to all messages in the batch, that have not been handled individually. See [recovery strategies](https://github.com/guidesmiths/rascal#message-acknowledgement-and-recovery-strategies).
 
For example:
* To ack an individual message: `message[i].ackOrNack();`
* To ack all messages: `defaultAckOrNack();`
* To requeue all messages: `defaultAckOrNack(true, this.nack.requeue);`
* To reject all messages, do `defaultAckOrNack(true, this.nack.drop);` 
 
## Events

This class does not emit events.


## Extending and Contributing 

Our goal is quality-driven development. Please ensure that 100% of the code is covered with testing.

Before contributing pull requests, please ensure that changes are covered with unit tests, and that all are passing. 

### Testing

Before you can run the tests, you'll need a working RabbitMQ server. We suggest using docker.

For example:

```bash
docker pull rabbitmq:3.8.27-management
docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3.8.27-management
```

To run unit tests and code coverage:
```sh
RABBIT_HOST=localhost RABBIT_PORT=5672 RABBIT_USER=guest RABBIT_PASS=guest RABBIT_VHOST="/" npm run report
```

Update the `RABBIT_*` environment vars to match your docker host (e.g. host, port, user, pass, vhost, etc)

This will perform:
* Unit tests
* Code coverage report
* Code linting

Sometimes, that's overkill to quickly test a quick change. To run just the unit tests:
 
```sh
npm test
```

or if you have mocha installed globally, you may run `mocha test` instead.
