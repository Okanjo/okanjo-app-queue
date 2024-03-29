"use strict";

const Rascal = require('rascal');

/**
 * Okanjo Message Queue Service
 * @class
 */
class QueueService {

    /**
     * Queue management service
     * @param {OkanjoApp} app
     * @param {*} [config] service config
     * @constructor
     */
    constructor(app, config) {

        this.app = app;
        this.config = config;

        if (!this.config || !this.config.rascal) {
            throw new Error('okanjo-app-queue: No rascal configuration set for QueueService!');
        }

        this.broker = null; // set on connect

        // Register the connection with the app
        app.registerServiceConnector(async () => {
            await this.connect();
        });
    }

    /**
     * Connects to RabbitMQ and binds the necessary exchanges and queues
     */
    async connect() {
        try {
            this.broker = await Rascal.BrokerAsPromised.create(Rascal.withDefaultConfig(this.config.rascal));
            this.broker.on('error', this._handleBrokerError.bind(this));
        } catch(err) {
            this.app.report('okanjo-app-queue: Failed to create Rascal broker:', err);
            throw err;
        }
    }

    /**
     * Publishes a message to the given queue
     * @param {string} queue - The queue name to publish to
     * @param {*} data - The message data to queue
     * @param [options] - The message data to queue
     * @param [callback] - Fired when done
     * @returns {Promise}
     */
    publishMessage(queue, data, options, callback) {

        // Overload - e.g. publishMessage(queue, data, callback);
        if (arguments.length === 3 && typeof options === "function") {
            callback = options;
            options = {};
        }

        let replied = false;
        let reply = (err, res) => {
            /* istanbul ignore else: in some circumstances, it may be possible for a double callback if rabbit does some wacky connection stuff */
            if (!replied) {
                replied = true;

                if (callback) {
                    callback(err, res);
                    return true;
                }
            }
        };

        return new Promise((resolve, reject) => {

            this.broker
                .publish(queue, data, options)
                .then(pub => {
                    pub.on('error', /* istanbul ignore next: out of scope */ async err => {
                        await this.app.report('okanjo-app-queue: Failed to publish queue message', err, { queue, data, options })
                    });
                    if (reply(null, pub)) return;
                    return resolve(pub);
                }, err => {
                    return this.app.report('okanjo-app-queue: Failed to publish queue message', err, { queue, data, options })
                        .then(() => {
                            if (reply(err)) return;
                            return reject(err);
                        })
                    ;
                })
            ;
        });
    }

    _handleBrokerError(err) {
        this.app.report('okanjo-app-queue: Rascal Broker error', err);
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

/**
 * Helper to generate a vhost config for Rascal based on old queue-name only setup
 * @param queueNames – Array of string queue names
 * @param [config] – Optional vhost config to append to
 * @param {{exchangeDefaults:*, queueDefaults:*, bindingDefaults:*}} [options] – Additional options for exchanges, queues, and bindings
 * @returns {*|{exchanges: Array, queues: {}, bindings: {}, subscriptions: {}, publications: {}}}
 */
QueueService.generateConfigFromQueueNames = (queueNames, config, options={}) => {
    config = config || {};
    config.exchanges = config.exchanges || {};
    config.queues = config.queues || {};
    config.bindings = config.bindings || {};
    config.subscriptions = config.subscriptions || {};
    config.publications = config.publications || {};

    queueNames.forEach((name) => {
        config.exchanges[name] = {
            ...options.exchangeDefaults
        };
        config.queues[name] = {
            ...options.queueDefaults
        };
        config.bindings[name] = {
            bindingKey: "", // typically defaults to #, does this matter?
            destinationType: "queue",
            ...options.bindingDefaults,
            source: name,
            destination: name,
        };
        config.subscriptions[name] = { queue: name };
        config.publications[name] = { exchange: name };
    });

    return config;
};

module.exports = QueueService;