"use strict";

// const QueueWorker = require('okanjo-app-queue/QueueWorker');
const QueueWorker = require('../../../QueueWorker');

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