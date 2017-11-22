# Okanjo RabbitMQ Service

[![Build Status](https://travis-ci.org/Okanjo/okanjo-app-queue.svg?branch=master)](https://travis-ci.org/Okanjo/okanjo-app-queue) [![Coverage Status](https://coveralls.io/repos/github/Okanjo/okanjo-app-queue/badge.svg?branch=master)](https://coveralls.io/github/Okanjo/okanjo-app-queue?branch=master)

Service for interfacing with RabbitMQ for the Okanjo App ecosystem.

This package:

* Manages connectivity and reconnection edge cases
* Provides message publishing and consumer functionality
* Provides a worker class for one-at-a-time message consumption
* Provides a worker class for batch message consumption
* Bundles a custom [node-amqp](https://github.com/kfitzgerald/node-amqp/tree/nack) dependency, since the main package is neglected.

## Installing

Add to your project like so: 

```sh
npm install okanjo-app-queue
```

Note: requires the [`okanjo-app`](https://github.com/okanjo/okanjo-app) module.

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
            queueName: app.services.queue.queues.batch,
            batchSize: 5
        });
    }

    handleMessageBatch(messages, callback) {

        // FYI: messages will be an array of message objects, not message payloads

        // This worker will simply report the values of the messages it is processing
        const values = messages.map((message) => message.message.my_message);
        console.log(`MyBatchWorker consumed messages: ${values.join(', ')}`);

        // ack all of the processed messages
        callback([], []);

        // or you could reject/requeue them too:
        // callback(requeueMessages, rejectMessages)
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
            queueName: app.services.queue.queues.events,
        });
    }

    handleMessage(message, callback, headers, deliveryInfo, messageObject) {

        // This worker will simply report the values of the messages it is processing
        console.log(`MyQueueWorker consumed message: ${message.my_message}`);

        // Ack the message
        callback(false, false);

        // or you could reject, requeue it
        // callback(reject, requeue);
    }
}

module.exports = MyQueueWorker;
```

### `example-app/config.js`
Typical OkanjoApp configuration file, containing the queue service config
```js
"use strict";

// Ordinarily, you would set normally and not use environment variables,
// but this is for ease of running the example across platforms
const host = process.env.RABBIT_HOST || '192.168.99.100';
const port = process.env.RABBIT_PORT || 5672;
const login = process.env.RABBIT_USER || 'test';
const password = process.env.RABBIT_PASS || 'test';
const vhost = process.env.RABBIT_VHOST || 'test';

module.exports = {
    rabbit: {
        host,
        port,

        login,
        password,

        vhost,

        // What exchanges/queues to setup (they'll be configured to use the same name)
        queues: {
            events: "my_events",
            batch: "my_batches"
        },

        // Handle connection drop scenarios
        reconnect: true,
        reconnectBackoffStrategy: 'linear',
        reconnectBackoffTime: 1000,
        reconnectExponentialLimit: 5000 // don't increase over 5s to reconnect
    }
};
```

The configuration extends the [node-amqp](https://github.com/kfitzgerald/node-amqp/tree/nack#connection-options-and-url) configuration. See there for additional options.

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
    app.connectToServices(() => {

        // Everything connected, now we can send out some messages to our workers

        // You can use service.queues.key as an enumeration when working with queues
        const batchQueueName = app.services.queue.queues.batch;
        const regularQueueName = app.services.queue.queues.events;

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
* `service.queues` – (read-only) The queues enumeration provided when constructed
* `service.reconnect` – Whether to reconnect when the connection terminates
* `service.rabbit` – (read-only) The underlying node-amqp connection
* `service.activeExchanges` – Map of active [exchanges](https://github.com/kfitzgerald/node-amqp/tree/nack#exchange), keyed on queue name
* `service.activeQueues` – Map of active [queues](https://github.com/kfitzgerald/node-amqp/tree/nack#queue)

## Methods

### `new QueueService(app, [config, [queues]])`
Creates a new queue service instance.
* `app` – The OkanjoApp instance to bind to
* `config` – (Optional) The queue service configuration object. Defaults to app.config.rabbit if not provided.
  * The configuration extends the [node-amqp](https://github.com/kfitzgerald/node-amqp/tree/nack#connection-options-and-url) configuration. See there for additional options.
  * `config.queues` – Enumeration of queue names. For example: `{ events: "my_event_queue_name" }`
* `queues` – (Optional) Enumeration of queue names. Overrides config.queues if both are set. Use this separately if you intend on using multiple service instances. For example: `{ events: "my_event_queue_name" }`

### `service.publishMessage(queue, data, [options], [callback])`
Publishes a message to a queue.
* `queue` – The name of the exchange/queue to publish to.
* `data` – The object message to publish.
* `options` – (Optional) Additional [exchange options](https://github.com/kfitzgerald/node-amqp/tree/nack#exchangepublishroutingkey-message-options-callback), if needed.
* `callback(err)` – (Optional) Function to fire when message has been sent or failed to send. 

## Events

This class does not emit events.


# QueueWorker

Base class for basic queue consumer applications. Must be extended to be useful.

## Properties
* `worker.service` – (read-only) The QueueService instance provided when constructed
* `worker.queueName` – (read-only) The name of the queue the worker consumes
* `worker.queueSubscriptionOptions` – (read-only) The queue [subscribe options](https://github.com/kfitzgerald/node-amqp/tree/nack#queuesubscribeoptions-listener) to use when subscribing
* `worker.verbose` – Whether to report various state changes

## Methods

### `new QueueWorker(app, options)`
Creates a new instance of the worker. Use `super(app, options)` when extending.
* `app` – The OkanjoApp instance to bind to
* `options` – Queue worker configuration options
  * `options.queueName` – (required) The name of the queue to consume
  * `options.service` – (required) The QueueService instance to use for communciation
  * `options.queueSubscriptionOptions` – (optional) The queue [subscribe options](https://github.com/kfitzgerald/node-amqp/tree/nack#queuesubscribeoptions-listener) to use when subscribing
  * `options.verbose` (optional) Whether to log various state changes. Defaults to `true`.
  * `options.skipInit` (optional) Whether to skip initialization/connecting at construction time. Use this for customizations or class extensions if needed. Defaults to `false`. 

### `worker.handleMessage(message, callback, headers, deliveryInfo, messageObject)`
Message handler. Override this function to let your application handle messages.
* `message` – The payload contained by the message 
* `callback(reject, requeue)` – Function to fire when finished consuming the message.
  * `reject` – Set to true to reject the message instead of acknowledging.
  * `requeue` – Set to true to requeue the message if `reject` is true too. Useful if your consumer experienced a temporary error and cannot handle the message at this time, so the message goes back on top of the queue. 
* `headers` – Headers included in the message
* `deliveryInfo` – Message delivery information
* `messageObject` – node-amqp message object.

At the very least, you just need message can callback, however headers, deliveryInfo and messageObject are available if needed by your application.
See [node-amqp](https://github.com/kfitzgerald/node-amqp/tree/nack#queuesubscribeoptions-listener) for more information on headers, deliveryInfo and the messageObject parameters.

## Events

This class does not emit events.

# BatchQueueWorker

Base class for batch message consumption applications. Must be extended to be useful. It extends QueueWorker.

## Properties
* `worker.service` – (read-only) The QueueService instance provided when constructed
* `worker.queueName` – (read-only) The name of the queue the worker consumes
* `worker.queueSubscriptionOptions` – (read-only) The queue [subscribe options](https://github.com/kfitzgerald/node-amqp/tree/nack#queuesubscribeoptions-listener) to use when subscribing
* `worker.verbose` – Whether to report various state changes
* `worker.batchSize` – (read-only) Up to how many messages to process at one time. 

## Methods

### `new BatchQueueWorker(app, options)`
Creates a new instance of the worker. Use `super(app, options)` when extending.
* `app` – The OkanjoApp instance to bind to
* `options` – Queue worker configuration options
  * `options.queueName` – (required) The name of the queue to consume
  * `options.service` – (required) The QueueService instance to use for communciation
  * `options.batchSize` – (optional) Up to how many messages to consume at a time. Defaults to `5`.
  * `options.queueSubscriptionOptions` – (optional) The queue [subscribe options](https://github.com/kfitzgerald/node-amqp/tree/nack#queuesubscribeoptions-listener) to use when subscribing
  * `options.verbose` (optional) Whether to log various state changes. Defaults to `true`.
  * `options.skipInit` (optional) Whether to skip initialization/connecting at construction time. Use this for customizations or class extensions if needed. Defaults to `false`.
  
### `worker.handleMessageBatch(messages, callback)`
Batch message handler. Override this function to let your app handle messages.
* `messages` – Array of message objects (NOT PAYLOADS). Access the a message payload like so: messages[0].message.
* `callback(requeueMessages, rejectMessages)` – Function to fire when done processing the batch.
 * `requeueMessages` – Optional array of message objects to requeue. You can requeue a partial amount of messages if necessary.
 * `rejectMessages` – Optional array of message objects to reject and not requeue. You can reject a partial amount of messages if necessary.
 
For example:
* To ack all messages, simply do `callback();`
* To requeue all messages, do `callback(messages);`
* To reject all messages, do `callback([], messages);` 

Note: **Do not manipulate `messages`**. For example, do not use array functions such as pop, push, splice, slice, etc. Doing so may result in stability issues.
 
## Events

This class does not emit events.


## Extending and Contributing 

Our goal is quality-driven development. Please ensure that 100% of the code is covered with testing.

Before contributing pull requests, please ensure that changes are covered with unit tests, and that all are passing. 

### Testing

Before you can run the tests, you'll need a working RabbitMQ server. We suggest using docker.

For example:

```bash
docker pull rabbitmq:3.6-management
docker run -d -p 5672:5672 -p 15672:15672 -e RABBITMQ_DEFAULT_VHOST=test -e RABBITMQ_DEFAULT_USER=test -e RABBITMQ_DEFAULT_PASS=test rabbitmq:3.6-management
```

To run unit tests and code coverage:
```sh
RABBIT_HOST=192.168.99.100 RABBIT_PORT=5672 RABBIT_USER=test RABBIT_PASS=test RABBIT_VHOST=test npm run report
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
