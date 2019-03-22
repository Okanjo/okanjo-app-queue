"use strict";

const should = require('should');

describe('BatchQueueWorker', () => {

    const QueueService = require('../QueueService');
    const QueueWorker = require('../QueueWorker');
    const BatchQueueWorker = require('../BatchQueueWorker');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    /** @type {OkanjoApp} */
    let app;

    const purge = async () => {
        try {
            await app.services.queue.broker.purge();
        } catch (e) {
            // ¯\_(ツ)_/¯
        }
    };

    before(async () => {

        // Create the app instance
        app = new OkanjoApp(config);

        // Add the redis service to the app
        app.services = {
            queue: new QueueService(app, app.config.rabbit)
        };

        await app.connectToServices();
    });

    it('should be bound to app', function () {
        should(app.services.queue).be.an.Object();
        app.services.queue.should.be.instanceof(QueueService);
    });

    describe('constructor', () => {

        after(purge);

        it('throws with no options', async () => {
            (() => { new BatchQueueWorker(app); }).should.throw(/options/);
        });

        it('batchSize defaults to 5', async () => {
            const worker = new BatchQueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                skipInit: true
            });

            worker.should.be.instanceOf(BatchQueueWorker);
            worker.should.be.instanceOf(QueueWorker);

            worker.batchSize.should.be.exactly(5);
            worker.queueSubscriptionOptions.prefetch.should.be.exactly(10);
        });

        it('takes custom batch size', async () => {
            const worker = new BatchQueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                skipInit: true,
                batchSize: 50
            });

            worker.batchSize.should.be.exactly(50);
            worker.queueSubscriptionOptions.prefetch.should.be.exactly(100);
        });

        it('ignores given prefetch for batchSize', async () => {
            const worker = new BatchQueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                skipInit: true,
                batchSize: 50,
                queueSubscriptionOptions: {
                    prefetch: 100
                }
            });

            worker.batchSize.should.be.exactly(50);
            worker.queueSubscriptionOptions.prefetch.should.be.exactly(100);
            worker.queueSubscriptionOptions.retry.should.be.ok();
        });
    });

    describe('handleMessageBatch', () => {

        afterEach(purge);

        it('should handle a batch of messages', async function () {
            this.timeout(5000);

            // Publish a batch of messages
            for (let i = 0; i < 10; i++) {
                await app.services.queue.publishMessage("unittests", { num: i });
            }

            const worker = new BatchQueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                batchSize: 5,
                skipInit: true
            });

            let counter = 0;
            let batch = 0;

            await new Promise(async (resolve) => {
                worker.handleMessageBatch = function(messages, defaultAckOrNack) {
                    batch++;
                    counter += messages.length;
                    // console.log({ batch, counter, messagesInBatch: messages.length, messageNums: messages.map((m) => m.content)});

                    // wait for the cargo to fill
                    setTimeout(() => {
                        defaultAckOrNack();

                        if (counter === 10) {
                            setTimeout(() => {
                                resolve();
                            }, 10);
                        }
                    }, 70);

                }.bind(worker);

                await worker.init();
            });

            batch.should.be.greaterThanOrEqual(2);

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

        });

        it('can individually ack messages in a batch', async function () {
            this.timeout(5000);

            // Publish a batch of messages
            for (let i = 0; i < 10; i++) {
                await app.services.queue.publishMessage("unittests", { num: i });
            }

            const worker = new BatchQueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                batchSize: 5,
                skipInit: true
            });

            let counter = 0;
            let batch = 0;

            await new Promise(async (resolve) => {
                worker.handleMessageBatch = function(messages, defaultAckOrNack) {
                    batch++;
                    counter += messages.length;
                    // console.log({ batch, counter, messagesInBatch: messages.length, messageNums: messages.map((m) => m.content)});

                    // Individually nack message #3, ack #8
                    messages.forEach((message) => {
                        if (message.content.num === 3) {
                            message.ackOrNack(true, this.nack.drop);
                        } else if (message.content.num === 8) {
                            message.ackOrNack();
                        }
                    });

                    // wait for the cargo to fill
                    setTimeout(() => {
                        defaultAckOrNack();

                        if (counter === 10) {
                            setTimeout(() => {
                                resolve();
                            }, 10);
                        }
                    }, 70);

                }.bind(worker);

                await worker.init();
            });

            batch.should.be.greaterThanOrEqual(2);

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

        });

        it('should handle a batch of messages as an extended class', async function () {
            this.timeout(5000);

            // Publish a batch of messages
            for (let i = 0; i < 10; i++) {
                await app.services.queue.publishMessage("unittests", { num: i });
            }

            let worker;
            let counter = 0;
            let batch = 0;

            await new Promise(async (resolve) => {

                class MyBatchWorker extends BatchQueueWorker {
                    constructor(app) {
                        super(app, {
                            subscriptionName: 'unittests',
                            service: app.services.queue,
                            batchSize: 5
                        });
                    }

                    handleMessageBatch(messages, defaultAckOrNack) {
                        batch++;
                        counter += messages.length;
                        // console.log({ batch, counter, messagesInBatch: messages.length, messageNums: messages.map((m) => m.content)});

                        // wait for the cargo to fill
                        setTimeout(() => {
                            defaultAckOrNack();

                            if (counter === 10) {
                                setTimeout(() => {
                                    resolve();
                                }, 10);
                            }
                        }, 70);
                    }
                }

                // start it up!
                worker = new MyBatchWorker(app);

                worker.should.be.instanceOf(BatchQueueWorker);
                worker.should.be.instanceOf(QueueWorker);
            });

            batch.should.be.greaterThanOrEqual(2);

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

        });

    });

    describe('handleMessage', () => {

        it('is not used', () => {
            (() => {
                const worker = new BatchQueueWorker(app, {
                    subscriptionName: 'unittests',
                    service: app.services.queue,
                    skipInit: true
                });
                worker.handleMessage();
            }).should.throw(/does not apply/);

        });

    });


});