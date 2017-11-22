"use strict";

const Async = require('async');
const QueueWorker = require('./QueueWorker');

/**
 * Worker for processing batches of messages at a time, ideal for things that benefit from bulk loading (e.g. elasticsearch!)
 */
class BatchQueueWorker extends QueueWorker {

    constructor(app, options) {

        const batchSize = options.batchSize || 5;

        // Set our base queue worker options based on our batch size
        options.queueSubscriptionOptions = { ack: true, prefetchCount: batchSize };

        // Don't initialize until we're all setup
        options.skipInit = true;

        // Start the engines
        super(app, options);

        /**
         * Message batch size - How many messages we'll be sent at a time
         * @type {number}
         */
        this.batchSize = options.batchSize || 5;
        this._isProcessing = null; // Not applicable to this worker

        // Get the aggregator setup
        this._setupCargo();

        // Start accepting messages
        this.init();
    }


    /* istanbul ignore next: must be implemented or this does nothing */
    //noinspection JSMethodCanBeStatic
    /**
     * This is the batch handler you need to override!
     *
     * @param {[*]} messages – Array of message objects, NOT payloads, that would be messages[0].message
     * @param {function(requeueMessages:[], rejectMessages:[])} callback - Fire when done processing the batch
     */
    handleMessageBatch(messages, callback) {

        // YOU MUST IMPLEMENT THIS TO BE USEFUL

        // DO NOT MANIPULATE `messages` !! IF YOU DO, YOU'll PROBABLY BREAK IT HARD
        // e.g. DO NOT messages.pop/push/slice/splice, etc. THIS IS BAD.

        // callback(requeueMessages, rejectMessages)
        callback(messages, []);
    }

    /**
     * Initialize the cargo data structure
     * @private
     */
    _setupCargo() {
        this._cargo = Async.cargo(this._processCargoBatch.bind(this));
    }

    /**
     * Internal handler for shipping a batch of messages to the application
     * @param messages
     * @param callback
     * @private
     */
    _processCargoBatch(messages, callback) {

        // Hold onto the last message in case we get to accept the entire batch
        const lastMessage = messages[messages.length-1];

        // Pass the batch to the handler
        this.handleMessageBatch(messages, (requeue, reject) => {

            // Normalize responses if they're empty
            requeue = Array.isArray(requeue) ? requeue : [];
            reject = Array.isArray(reject) ? reject : [];

            // If there's anything to throw away
            if (requeue.length + reject.length > 0) {

                // Iterate each and accept, or reject/requeue
                messages.forEach((message) => {
                    if (requeue.includes(message)) {
                        message.messageObject.reject(true);
                    } else if (reject.includes(message)) {
                        message.messageObject.reject(false);
                    } else {
                        message.messageObject.acknowledge(false);
                    }
                });

            } else {
                // Ack the entire batch
                lastMessage.messageObject.acknowledge(true);
            }

            callback();
        });
    }

    /**
     * Override the default message handler system
     *
     * @see https://github.com/postwait/node-amqp#queuesubscribeoptions-listener
     *
     * @param message - Message body
     * @param [headers] - Message headers
     * @param [deliveryInfo] - Raw message info
     * @param [messageObject] - Message object wrapper (e.g. messageObject.acknowedge(false) )
     */
    onMessage(message, headers, deliveryInfo, messageObject) {
        /* istanbul ignore else: I really tried to unit test this but i don't think i can (timing) */
        if (!this._isShuttingDown) {

            // Queue this into the current batch
            this._cargo.push({
                message,
                headers,
                deliveryInfo,
                messageObject
            });

        } else {
            // If we're in the process of shutting down, reject+requeue this message so it's handled later
            setImmediate(() => messageObject.reject(true));
        }
    }

    /* istanbul ignore next: not implemented in this class */
    /**
     * Callback provided to the message handler to complete working with the message
     * @param reject
     * @param requeue
     */
    onMessageHandled(reject, requeue) {
        throw new Error('This method does not apply to this worker. Do not use it.');
    }

    /* istanbul ignore next: not implemented in this class */
    /**
     * Hook point for handling messages
     *
     * @see https://github.com/postwait/node-amqp#queuesubscribeoptions-listener
     *
     * @param message - Message body
     * @param {function(reject:boolean, requeue:boolean)} callback - Fire when done processing the message
     * @param [headers] - Message headers
     * @param [deliveryInfo] - Raw message info
     * @param [messageObject] - Message object wrapper (e.g. messageObject.acknowedge(false) )
     */
    handleMessage(message, callback, headers, deliveryInfo, messageObject) {
        throw new Error('This method does not apply to this worker. Do not use it.');
    }

    //noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
    /**
     * Starts the internal shutdown process (hook point)
     */
    prepareForShutdown(canAsync) {

        this.log(` !! Shutting down the ${this.queueName} queue`);

        // Flag that we're shutting down
        this._isShuttingDown = true;

        // Unsub and shutdown
        const done = () => {
            this.unsubscribe(() => {
                this.shutdown();
            });
        };

        // If the cargo is still working, then drain it and end, otherwise just end
        /* istanbul ignore next: it's really hard to test this case of cargo still got junk in it at shutdown */
        if (this._cargo.length() > 0) {
            this._cargo.drain = () => {
                done();
            };
        } else {
            done();
        }
    }
}

module.exports = BatchQueueWorker;