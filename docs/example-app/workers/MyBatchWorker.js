"use strict";

// const BatchQueueWorker = require('okanjo-app-queue/BatchQueueWorker');
const BatchQueueWorker = require('../../../BatchQueueWorker');

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