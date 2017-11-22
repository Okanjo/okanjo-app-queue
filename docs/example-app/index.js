"use strict";

const Cluster = require('cluster');
const Async = require('async');
const OkanjoApp = require('okanjo-app');
const OkanjoBroker = require('okanjo-app-broker');
// const QueueService = require('okanjo-app-queue');
const QueueService = require('../../QueueService');

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