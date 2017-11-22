"use strict";

const AMQP = require('amqp');
const Async = require('async');

/**
 * Okanjo Message Queue Service
 * @class
 */
class QueueService {

    /**
     * Queue management service
     * @param {OkanjoApp} app
     * @param {*} [config] service config
     * @param {*} [queues] - Queue enumeration
     * @constructor
     */
    constructor(app, config, queues) {

        this.app = app;
        this.config = config || app.config.rabbit;

        if (!this.config) {
            throw new Error('okanjo-app-queue: No configuration set for QueueService!');
        }

        this.queues = queues || this.config.queues || {};
        this.reconnect = true;

        this.rabbit = null;
        this.activeExchanges = {};
        this.activeQueues = {};

        // Register the connection with the app
        app._serviceConnectors.push((cb) => {

            this.connect(() => {
                /* istanbul ignore else: too hard to edge case this with unit tests and docker */
                if (cb) {
                    cb();
                }
                cb = null; // don't do this twice
            });

        });
    }

    /**
     * Connects to RabbitMQ and binds the necessary exchanges and queues
     * @param callback - Fired when connected and ready to publish messages
     */
    connect(callback) {

        // Create the rabbit connection
        this.rabbit = AMQP.createConnection(this.config);

        // Internally, amqp uses it's own error listener, so the default of 10 is not sufficient
        this.rabbit.setMaxListeners(50);

        // Bind events
        this.rabbit
            .on('error', this._handleConnectionError.bind(this))
            .on('end', this._handleConnectionEnd.bind(this))
            .on('ready', this._handleConnectionReady.bind(this, callback));
    }

    /**
     * Publishes a message to the given queue
     * @param queue - The queue name to publish to
     * @param data - The message data to queue
     * @param [options] - The message data to queue
     * @param [callback] - Fired when done
     */
    publishMessage(queue, data, options, callback) {

        // Overload - e.g. publishMessage(queue, data, callback);
        if (arguments.length === 3 && typeof options === "function") {
            callback = options;
            options = {};
        }

        // If options was given but has no value, default it to an empty object
        // options = options || {};

        this.activeExchanges[queue].publish('', data, options, (hasError, err) => {
            /* istanbul ignore if: edge case testing with rabbit isn't necessary yet */
            if (hasError) {
                this.app.report('Failed to publish queue message', err, data, queue);
            }

            /* istanbul ignore else: i'm confident that this is solid, unit tests need the ack so good enough for now */
            if (callback) {
                // Use next tick to clear i/o on the event loop if someone's planning on batch queuing
                setImmediate(() => callback(err));
            }
        });
    }

    /* istanbul ignore next: would require edge casing docker connection states */
    /**
     * Handles a connection error event from RabbitMQ
     * @param err - Error received
     * @private
     */
    _handleConnectionError(err) {
        if (err !== 'RECONNECT PLZ') {
            this.app.report('RabbitMQ connection error!', err);
        }
    }

    /* istanbul ignore next: would require edge casing docker connection states */
    /**
     * Handles a connection closed event from RabbitMQ
     * @private
     */
    _handleConnectionEnd() {
        if (this.reconnect) {
            // Manually trigger an error to use the built in reconnection functionality
            process.nextTick(this.rabbit.emit.bind(this.rabbit, 'error', 'RECONNECT PLZ'));
        }
    }

    /**
     * Handles a connection ready event from RabbitMQ
     * @param callback - Fired when done
     * @private
     */
    _handleConnectionReady(callback) {

        // Bind the exchanges and queues!
        Async.each(
            Object.keys(this.queues),
            (key, next) => {
                this._bindQueueExchange(this.queues[key], next);
            },
            (err) => {
                process.nextTick(callback.bind(null, err));
                callback = null; // Don't fire again on reconnects
            }
        );
    }

    /**
     * Binds an exchange and a queue with the given name
     * @param name - The name to use
     * @param callback - Fired when done
     * @private
     */
    _bindQueueExchange(name, callback) {
        // Note: exchange and queue share the same name
        // Connect to the exchange
        this.rabbit.exchange(name, {
            type: 'direct',
            durable: true,
            autoDelete: false,
            confirm: true
        }, (exchange) => {

            // Save this for later because we'll need it to send of messages to report
            this.activeExchanges[name] = exchange;

            // Connect to the queue
            this.rabbit.queue(name,  {
                exclusive: false,
                durable: true,
                autoDelete: false
            }, (queue) => {

                // Save the queue so we can gracefully unsubscribe later
                this.activeQueues[name] = queue;

                // Bind and subscribe to the queue
                queue.bind(name, '');

                //console.error(' >> Message queue connected:', name);

                /* istanbul ignore else: would require edge casing docker connection states */
                // Queue bound and ready to rock and roll
                if (callback) {
                    process.nextTick(callback.bind());
                    callback = null;
                }

            }); // </queue>
        }); // </exchange>
    }
}

/**
 * Expose the QueueWorker helper
 * @type {QueueWorker}
 */
QueueService.QueueWorker = require('./QueueWorker');

/**
 * Expose the BatchQueueWorker helper
 * @type {BatchQueueWorker}
 */
QueueService.BatchQueueWorker = require('./BatchQueueWorker');

module.exports = QueueService;