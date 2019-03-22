"use strict";

const Async = require('async');
const QueueWorker = require('./QueueWorker');

/**
 * Worker for processing batches of messages at a time, ideal for things that benefit from bulk loading (e.g. elasticsearch!)
 */
class BatchQueueWorker extends QueueWorker {

    constructor(app, options) {

        if (!options) {
            throw new Error('BatchQueueWorker: options are required');
        }

        const batchSize = options.batchSize || 5;
        const skipInit = options.skipInit || false;

        // Set the base QueueWorker options based on the given batch size
        options.queueSubscriptionOptions = options.queueSubscriptionOptions || {};
        options.queueSubscriptionOptions.prefetch = batchSize * 2;
        options.queueSubscriptionOptions.retry = options.queueSubscriptionOptions.retry || { delay: 1000 };

        // Don't initialize until we're all setup
        options.skipInit = true;

        // Initialize underlying QueueWorker
        super(app, options);

        /**
         * Message batch size - How many messages we'll be sent at a time
         * @type {number}
         */
        this.batchSize = batchSize;

        // Get the aggregator setup
        this._setupCargo();

        // Start accepting messages
        if (!skipInit) {
            this.init();
        }
    }

    /* istanbul ignore next: must be implemented or this does nothing */
    //noinspection JSMethodCanBeStatic
    /**
     * This is the batch handler you need to override!
     *
     * @param {[*]} messages – Array of message objects, NOT payloads, that would be messages[0].message
     * @param {function(err:*=null, recovery:*=null)} defaultAckOrNack - Fire when done processing the batch
     */
    handleMessageBatch(messages, defaultAckOrNack) {

        // YOU MUST IMPLEMENT THIS TO BE USEFUL

        // individually ack or nack a message in the batch
        // messages[i].ackOrNack();             // individually ack or nack a message in the batch

        // ack or nack the unhandled messages in the batch
        // defaultAckOrNack();                  // ack all
        // defaultAckOrNack(err);               // err all w/ default strategy
        // defaultAckOrNack(err, recovery);     // err all w/ specific strategy
        defaultAckOrNack(true, this.nack.drop); // err all w/ drop strategy
    }

    /**
     * Initialize the cargo data structure
     * @private
     */
    _setupCargo() {
        this._cargo = Async.cargo(this._processCargoBatch.bind(this), this.batchSize);
    }

    /**
     * Internal handler for shipping a batch of messages to the application
     * @param {[CargoMessage]} messages
     * @param callback
     * @private
     */
    _processCargoBatch(messages, callback) {

        // Pass the batch to the handler
        this.handleMessageBatch(messages, (err, recovery) => {

            // Ack/Nack any unhandled message
            messages.forEach((message) => {
                if (!message._handled) {
                    message.ackOrNack(err, recovery);
                }
            });

            callback();
        });
    }

    /**
     * Override the default message handler system. Routes messages into async cargo.
     *
     * @param message - Message object
     * @param content – Message body
     * @param ackOrNack – Callback to ack or nack the message
     */
    onMessage(message, content, ackOrNack) {

        /**
         * Wrapped Cargo Message
         * @typedef {{message: *, content: *, ackOrNack: function(err:*,recovery:*), _handled: boolean}} CargoMessage
         */
        const payload = {
            message,
            content,
            // wrapper around given ackOrNack, if message individually handled, flag it
            ackOrNack: (...params) => {
                payload._handled = true;
                ackOrNack.apply(null, params);
            },
            _handled: false
        };

        // Queue this into the current batch
        this._cargo.push(payload);
    }

    /**
     * Do not use this method on this QueueWorker
     */
    handleMessage(message, content, ackOrNack) { /* eslint-disable-line no-unused-vars */
        throw new Error('BatchQueueWorker: This method does not apply to this worker. Do not use it.');
    }
}

module.exports = BatchQueueWorker;