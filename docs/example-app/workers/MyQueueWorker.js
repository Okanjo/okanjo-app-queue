"use strict";


// const QueueWorker = require('okanjo-app-queue/QueueWorker');
const QueueWorker = require('../../../QueueWorker');

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