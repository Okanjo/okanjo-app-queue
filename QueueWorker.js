"use strict";

const OkanjoWorker = require('okanjo-app-broker/OkanjoWorker');
const Async = require('async');

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
        if (!options.queueName) {
            throw new Error('Missing require option: queueName');
        }

        // Init the base worker here
        super(app, { skipInit: true });

        /**
         * The queue service to use to talk to rabbit
         * @type {QueueService}
         */
        this.service = options.service || app.services.queue; // Default to app.services.queue if none was given

        /**
         * The name of the queue to consume
         * @type {string}
         */
        this.queueName = options.queueName; // <-- Override this before starting up!

        /**
         * Queue consumer settings - Require confirmation and process one at a time
         * @type {{ack: boolean, prefetchCount: number}}
         */
        this.queueSubscriptionOptions = options.queueSubscriptionOptions || { ack: true, prefetchCount: 1 };

        /**
         * Status var to keep track of whether the worker is currently able to consume messages from the queue
         * @type {boolean}
         */
        this._isSubscribed = false;

        /**
         * Flag that prevents processing messages while transitioning
         * @type {boolean}
         * @private
         */
        this._isShuttingDown = false;

        /**
         * Flag that indicates whether a message or batch is being handled
         * @type {boolean}
         * @private
         */
        this._isProcessing = false;

        /**
         * When subscribed, hold a reference to the consumer tag id so we can gracefully un-subscribe on shutdown
         * @type {null}
         * @private
         */
        this._consumerTag = null;

        /**
         * Whether an error was emitted and a subscribe attempt is in progress
         * @type {boolean}
         * @private
         */
        this._recovering = false;

        /**
         * If dup errors are thrown, fire these callbacks when an attempt finishes
         * @type {Array}
         * @private
         */
        this._recoverHooks = [];

        /* istanbul ignore next: Not interested in verbosity tests */
        /**
         * Whether to make noise to the console
         * @type {boolean}
         */
        this.verbose = options.verbose === undefined ? true : options.verbose;

        // Bind copies of the handlers so we can scrap the event listener later
        this.onServiceError = this.onServiceError.bind(this);
        this._handleTagChangeEvent = this._handleTagChangeEvent.bind(this);

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
        /* istanbul ignore else: Not interested in verbosity tests */
        if (this.verbose) this.app.log(message);
    }

    //noinspection JSUnusedGlobalSymbols
    /**
     * Subscribe and consume queue messages
     */
    init(callback) {

        // Set the reporting context
        this.app.setReportingContext({ worker: this.queueName });

        // Connect to the basic app services
        this.app.connectToServices(this.onReady.bind(this, callback));
    }

    /**
     * Fired when the app is ready for use - Starts the queue subscription process
     * @param callback
     */
    onReady(callback) {
        // Keep a reference to the queue object for use locally
        this.queue = this.service.activeQueues[this.queueName];

        // Bind our own error handler
        this.service.rabbit.on('error', this.onServiceError);

        // When a reconnection occurs, and our consumer is replaced, we should probably find out about that, right?
        this.service.rabbit.on('tag.change', this._handleTagChangeEvent);

        // Do it
        this.subscribe(callback);
    }

    /**
     * Handles the event when a reconnection occurs, and our consumer is replaced,
     * we should probably find out about that, right?
     * @param event
     * @private
     */
    _handleTagChangeEvent(event) {
        /* istanbul ignore else: not my consumer, not my problem, that's what i say */
        if (this._consumerTag === event.oldConsumerTag) {
            // noinspection JSUnusedGlobalSymbols
            this._consumerTag = event.consumerTag;
            this._unsubscribe(event.oldConsumerTag, () => {
                this.log(`!! Consumer tag for queue ${this.queueName} changed`);
            }); // eat the error if any, that tag is dead to us anyway
        }
    }

    /**
     * Fired when the queue has been subscribed to - Stores reference info about the subscription
     * @param callback
     * @param res - The queue subscription result
     */
    onSubscribed(callback, res) {
        this.log(` > Subscribed to the ${this.queueName} queue`);
        this._isSubscribed = true;
        // noinspection JSUnusedGlobalSymbols
        this._consumerTag = res.consumerTag;

        // Notify anyone who's waiting for the subscriber to finish
        if (callback) callback();
    }

    /**
     * Fired when the consumer has unsubscribed from the queue
     * @param [callback] - Fired when done handling the event
     * //@param {{consumerTag:string}} res
     */
    onUnsubscribed(callback/*, res*/) {
        // Flag that we are no longer subscribed
        this._isSubscribed = false;

        // Console audit
        this.log(` > Unsubscribed from the ${this.queueName} queue`);

        // Notify that we're done
        /* istanbul ignore else: this works, ok? */
        if (callback) callback();
    }

    /**
     * First line of handling a message received from the queue - deals with connection states
     *
     * @see https://github.com/postwait/node-amqp#queuesubscribeoptions-listener
     *
     * @param message - Message body
     * @param [headers] - Message headers
     * @param [deliveryInfo] - Raw message info
     * @param [messageObject] - Message object wrapper (e.g. messageObject.acknowedge(false) )
     */
    onMessage(message, /* you might not care about the rest of these params */ headers, deliveryInfo, messageObject) {
        /* istanbul ignore else: I really tried to unit test this but i don't think i can (timing) */
        if (!this._isShuttingDown) {

            // Pass the message to the handler
            this._isProcessing = true;
            this.handleMessage(message, this.onMessageHandled.bind(this), headers, deliveryInfo, messageObject);

        } else {
            // If we're in the process of shutting down, reject this message so it's handled later
            setImmediate(this.queue.shift.bind(this.queue, true, true));
        }
    }

    /**
     * Callback provided to the message handler to complete working with the message
     * @param reject
     * @param requeue
     */
    onMessageHandled(reject, requeue) {
        if (reject) {
            // Delay a reject so we don't lock the app up with constantly retrying failures
            setTimeout(() => {
                this.queue.shift(reject, requeue);
                this._isProcessing = false;
            }, 1000);
        } else {
            this.queue.shift(reject, requeue);
            this._isProcessing = false;
        }

    }

    /**
     * Handle connection errors, hopefully recover message consumption
     * @param connectionErr
     */
    onServiceError(connectionErr) {
        if (this._recovering) {
            // Wait until the attempt is done
            /* istanbul ignore next: out of scope */
            this._recoverHooks.push((err) => {
                if (err) {
                    // Failed to reconnect, try again
                    setImmediate(() => this.onServiceError(connectionErr));
                }
            });
        } else {
            // noinspection JSUnusedGlobalSymbols
            this._recovering = true;

            // Our connection was probably lost (ETIMEDOUT) but we're not going to resubscribe automatically, so let's do that.
            const originalTag = this._consumerTag;
            this.unsubscribe((unsubscribeErr) => {


                // There's a chance that auto-recovery will replace our channel, so we don't need to dup another consumer here
                /* istanbul ignore if: reconnection *should* restablish the link and update the tag, so this shouldn't need to happen, but if it does, then this should take care of it */
                if (this._consumerTag === originalTag) {
                    this.subscribe((subscribeErr) => {

                        /* istanbul ignore if: out of scope */
                        if (subscribeErr) {
                            this.app.report('Failed to recover consumer subscription when rabbit connection error occurred', {
                                subscribeErr,
                                unsubscribeErr,
                                connectionErr
                            });
                        }

                        // Handle duplicate errors while recovery was in progress
                        // noinspection JSUnusedGlobalSymbols
                        this._recovering = false;
                        this._recoverHooks.forEach((hook) => hook(subscribeErr));
                    });
                } else {
                    // Our consumer was replaced, so we're all done
                    this._isSubscribed = true;
                    // noinspection JSUnusedGlobalSymbols
                    this._recovering = false;
                    this._recoverHooks.forEach((hook) => hook());
                }

            });
        }
    }

    /* istanbul ignore next: This function must be overridden to be useful */
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

        // TODO - this is the hook point where you handle the message

        // When reject is true, the message will be put back on the queue IF requeue is true, otherwise it'll be discarded
        const reject = true;
        const requeue = true; // only matters if reject is true

        this.app.inspect('Received queue message', this.queueName, message, headers, deliveryInfo, messageObject);

        // When finished handling the message, accept it or reject it
        callback(reject, requeue);
    }

    /**
     * Subscribe to the queue
     * @param callback
     */
    subscribe(callback) {

        // Subscribe to the queue
        this.queue
            .subscribe(this.queueSubscriptionOptions, this.onMessage.bind(this))
            .addCallback(this.onSubscribed.bind(this, callback));

    }

    /**
     * Unsubscribes from the queue if able to do so
     * @param callback
     */
    unsubscribe(callback) {
        // Only unsubscribe if actively connected
        if (this._consumerTag && this._isSubscribed) {
            this._unsubscribe(this._consumerTag, this.onUnsubscribed.bind(this, callback));
        } else {
            /* istanbul ignore else: you really need to send a callback */
            if (callback) callback();
        }
    }

    /**
     * Unsubscribes from the given consumer
     * @param tag
     * @param callback
     * @private
     */
    _unsubscribe(tag, callback) {
        this.queue
            .unsubscribe(tag)
            .addCallback(callback);
    }

    /**
     * Removes hooks on the rabbit service
     * @private
     */
    _dropListeners() {
        this.service.rabbit.removeListener('error', this.onServiceError);
        this.service.rabbit.removeListener('tag.change', this._handleTagChangeEvent);
    }

    //noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
    /**
     * Starts the internal shutdown process (hook point)
     */
    prepareForShutdown(canAsync) { /* eslint-disable-line no-unused-vars */

        this.log(` !! Shutting down the ${this.queueName} queue`);

        // Flag that we're shutting down
        this._isShuttingDown = true;

        // If there's a message in the works, wait for it to end
        Async.retry(
            { times: 10, interval: 200 },
            (cb) => {
                if (this._isProcessing) {
                    cb('not ready');
                } else {
                    cb(null, 'ready');
                }
            },
            () => {
                // Un-subscribe if able to do so
                this.unsubscribe(() => {
                    this.shutdown();
                });
            }
        );

        this._dropListeners();

        // The train is leaving the station, with or without us.
        /* istanbul ignore if: won't test the process abort scenario */
        //if (!canAsync) {
        //    this.shutdown();
        //}
    }
}

module.exports = QueueWorker;