"use strict";

const OkanjoWorker = require('okanjo-app-broker/OkanjoWorker');

/**
 * Base worker for dealing with message queue processing
 */
class QueueWorker extends OkanjoWorker {

    /**
     * Base worker for dealing with message queue processing
     * @param {OkanjoApp} app
     * @param options
     * @constructor
     */
    constructor(app, options) {

        // We cannot start unless we have a queue name
        if (!options.subscriptionName) {
            throw new Error('Missing required option: subscriptionName');
        }

        if (!options.service) {
            throw new Error('Missing required option: service');
        }

        // Init the base worker here
        super(app, { skipInit: true });

        /**
         * The queue service to use to talk to rabbit
         * @type {QueueService}
         */
        this.service = options.service;

        /**
         * The name of the queue to consume
         * @type {string}
         */
        this.subscriptionName = options.subscriptionName; // <-- Override this before starting up!


        const defaultSubscriberOptions = {
            prefetch: 1,
            retry: { delay: 1000 } // Retries after a one second interval.
        };

        /**
         * Queue consumer settings - Require confirmation and process one at a time
         * @type {*|{prefetch: number, retry: {delay: number}}|queueSubscriptionOptions|{prefetch, retry}}
         */
        this.queueSubscriptionOptions = options.queueSubscriptionOptions || defaultSubscriberOptions;

        /**
         * Status var to keep track of whether the worker is currently able to consume messages from the queue
         * @type {boolean}
         */
        this._isSubscribed = false;

        /**
         * Whether to make noise to the console
         * @type {boolean}
         */
        this.verbose = options.verbose === undefined ? true : options.verbose;

        // ackOrNack(err, { strategy: 'nack' })                                 // DISCARD MESSAGE or DEAD LETTER IT
        // ackOrNack(err, { strategy: 'nack', defer: 1000, requeue: true })     // REJECT and REQUEUE (top of queue)
        // ackOrNack(err, { strategy: 'republish', defer: 1000 })               // REJECT and REQUEUE (bottom of queue)

        /**
         * Message rejection strategies
         * @type {{drop: {strategy: string}, requeue: {strategy: string, defer: number, requeue: boolean}, republish: {strategy: string, defer: number}}}
         */
        this.nack = {
            drop: { strategy: 'nack' },                                 // discard message or dead-letter it
            requeue: { strategy: 'nack', defer: 1000, requeue: true },  // reject + requeue (old functionality)
            republish: { strategy: 'republish', defer: 1000 }           // reject + republish to queue
        };

        /**
         * Default error nack strategy
         * @type {{strategy: string, defer: number}|QueueWorker.nack.republish|{strategy, defer}}
         */
        this.nack.default = this.nack.republish;

        // Changeable defaults for error handlers
        this.nack._redeliveriesExceeded = this.nack.default;
        this.nack._invalidContent = this.nack.default;

        // Initialize now
        if (!options.skipInit) {
            this.init();
        }

    }

    /**
     * Logs a message to the console
     * @param message
     */
    log(message) {
        if (this.verbose) this.app.log(message);
    }

    //noinspection JSUnusedGlobalSymbols
    /**
     * Subscribe and consume queue messages
     */
    async init() {

        // Set the reporting context
        this.app.setReportingContext({ worker: this.subscriptionName });

        // Connect to the basic app services
        await this.app.connectToServices(async () => {
            await this.subscribe();
        });
    }

    /**
     * Subscribe to the queue
     */
    async subscribe() {

        // Don't sub over an existing subscription
        if (this.subscription) {
            const err = new Error('QueueWorker: Already subscribed!');
            await this.app.report(err.message, err, { subscription: this.subscriptionName, options: this.queueSubscriptionOptions });
            throw err;
        }

        try {
            this.subscription = await this.service.broker.subscribe(this.subscriptionName, this.queueSubscriptionOptions);
            this.subscription.on('error', this.onSubscriptionError.bind(this));
            this.subscription.on('invalid_content', this.onInvalidContent.bind(this));
            this.subscription.on('redeliveries_exceeded', this.onRedeliveriesExceeded.bind(this));
            this.subscription.on('message', this.onMessage.bind(this));
            this.onSubscribed();
        } catch (err) {
            await this.app.report('QueueWorker: Failed to subscribe to queue', err, { subscription: this.subscriptionName, options: this.queueSubscriptionOptions });
            throw err;
        }
    }

    // ackOrNack(err, { strategy: 'nack' })                                 // DISCARD MESSAGE or DEAD LETTER IT
    // ackOrNack(err, { strategy: 'nack', defer: 1000, requeue: true })     // REJECT and REQUEUE (top of queue)
    // ackOrNack(err, { strategy: 'republish', defer: 1000 })               // REJECT and REQUEUE (bottom of queue)

    /**
     * Occurs when the message was redelivered too many times or there was a message error
     * @param err
     * @param message
     * @param ackOrNack
     */
    onRedeliveriesExceeded(err, message, ackOrNack) {
        this.app.report('QueueWorker: Re-deliveries exceeded on message', err, { subscription: this.subscriptionName, message }).then(() => {
            ackOrNack(err, this.nack._redeliveriesExceeded);
        });
    }

    /**
     * Occurs when the message content could not be parsed or there was a message error
     * @param err
     * @param message
     * @param ackOrNack
     */
    onInvalidContent(err, message, ackOrNack) {
        this.app.report('QueueWorker: Invalid content received', err, { subscription: this.subscriptionName, message }).then(() => {
            ackOrNack(err, this.nack._invalidContent);
        });
    }

    /**
     * Occurs when the subscriber has an error
     * @param err
     */
    onSubscriptionError(err) {
        // noinspection JSIgnoredPromiseFromCall
        this.app.report('QueueWorker: Subscription error', err, { subscription: this.subscriptionName });
    }

    /**
     * Unsubscribes from the queue if able to do so
     */
    async unsubscribe() {
       if (this._isSubscribed && this.subscription) {
           try{
               await this.subscription.cancel();
           } catch(err) /* istanbul ignore next: out of scope */ {
               await this.app.report('QueueWorker: Failed to unsubscribe', err, { subscription: this.subscriptionName });
           }
           this.onUnsubscribed();
       }
    }

    /**
     * Fired when the queue has been subscribed to - Stores reference info about the subscription
     */
    onSubscribed() {
        this.log(` > Subscribed to the ${this.subscriptionName} queue`);
        // noinspection JSUnusedGlobalSymbols
        this._isSubscribed = true;
    }

    /**
     * Fired when the consumer has unsubscribed from the queue
     */
    onUnsubscribed() {
        // Flag that we are no longer subscribed
        // noinspection JSUnusedGlobalSymbols
        this._isSubscribed = false;
        this.subscription = null;

        // Console audit
        this.log(` > Unsubscribed from the ${this.subscriptionName} queue`);
    }

    /**
     * First line of handling a message received from the queue - deals with connection states
     *
     * @param message - Message object
     * @param content – Message body
     * @param ackOrNack – Callback to ack or nack the message
     */
    onMessage(message, content, ackOrNack) {
        // Pass the message to the handler
        this.handleMessage(message, content, ackOrNack);
    }

    /* istanbul ignore next: This function must be overridden to be useful */
    /**
     * Hook point for handling messages
     * @param message
     * @param content
     * @param ackOrNack
     */
    handleMessage(message, content, ackOrNack) {

        // TODO - this is the hook point where you handle the message

        this.app.dump('Received queue message', { subscription: this.subscriptionName, message, content });

        // When finished handling the message, accept it or reject it
        // ackOrNack()  // accept
        // ackOrNack(err, recovery); // reject, with recovery method
        ackOrNack(true, this.nack.republish);
    }

    //noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
    /**
     * Starts the internal shutdown process (hook point)
     */
    prepareForShutdown(canAsync) { /* eslint-disable-line no-unused-vars */

        this.log(` !! Shutting down the ${this.subscriptionName} queue`);
        (async () => {
            // If there's a message in the works, wait for it to end
            try {
                await this.service.broker.shutdown();
            } catch (err) /* istanbul ignore next: faking this is unreliable */ {
                await this.app.report('QueueWorker: Failed to shutdown broker', err, {
                    subscription: this.subscriptionName
                });
            }
        })();
    }
}

module.exports = QueueWorker;