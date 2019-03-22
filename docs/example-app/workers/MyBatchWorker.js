"use strict";

// const BatchQueueWorker = require('okanjo-app-queue/BatchQueueWorker');
const BatchQueueWorker = require('../../../BatchQueueWorker');

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