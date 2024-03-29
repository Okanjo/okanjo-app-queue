"use strict";

// const log = require('why-is-node-running'); // should be your first require
const should = require('should');
const { describe, it, before, after, afterEach } = require('mocha');

// process.env.DEBUG='rascal:Subscription,rascal:SubscriberError,rascal:SubscriberSession';

describe('QueueWorker', () => {

    const QueueService = require('../QueueService');
    const QueueWorker = require('../QueueWorker');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    /** @type {OkanjoApp} */
    let app;

    const purge = async () => {
        try {
            await app.services.queue.broker.unsubscribeAll();
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

    after((done) => {
        // app.services.queue.broker.shutdown(() => {
        //     log(); // logs out active handles that are keeping node running
            done();
        // });
    });

    it('should be bound to app', function () {
        should(app.services.queue).be.an.Object();
        app.services.queue.should.be.instanceof(QueueService);
    });

    describe('constructor', () => {

        after(purge);

        it('throws when subscriptionName is missing', () => {
            (() => { new QueueWorker(app, {}); }).should.throw(/subscriptionName/);
        });

        it('throws when service is missing', () => {
            (() => { new QueueWorker(app, {subscriptionName: 'unittests'}); }).should.throw(/service/);
        });

        it('can construct', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue
            });

            should(worker).be.ok();

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });
        });

        it('can construct with subscriber options', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                queueSubscriptionOptions: {
                    prefetch: 2,
                    retry: { delay: 1000 }
                }
            });

            should(worker).be.ok();
            worker.queueSubscriptionOptions.prefetch.should.be.exactly(2);

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });
        });

        it('can construct without verbosity', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                verbose: false
            });

            should(worker).be.ok();
            worker.verbose.should.be.exactly(false);

            worker.log('stealth as the night');

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });
        });

        it('can construct without starting', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                skipInit: true
            });

            should(worker).be.ok();

            await new Promise((resolve) => {
                setTimeout(async () => {
                    should(worker.subscription).not.be.ok();
                    resolve();
                }, 50);
            });

        });

    });

    describe('subscribe', () => {

        afterEach(purge);

        it('refuses to subscribe a second time', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
            });

            should(worker).be.ok();

            await new Promise((resolve) => {
                setTimeout(async () => {
                    resolve();
                }, 50);
            });

            try {
                await worker.subscribe();
                should(false).exactly(true);
            } catch(err) {
                err.message.should.match(/Already subscribed/);
            }

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });
        });

        it('throws when subscribing to a bogus queue', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'bogus',
                service: app.services.queue,
                skipInit: true
            });

            should(worker).be.ok();

            try {
                await worker.subscribe();
                should(false).should.be.exactly(true);
            } catch (err) {
                err.should.match(/bogus/)
            }
        });

    });

    describe('onRedeliveriesExceeded', () => {

        before(purge);

        afterEach(purge);

        it('should exceed deliveries', async function() {
            this.timeout(5000);
            let messageId;

            // Fire the message, let it sit in the queue
            const pub = await app.services.queue.publishMessage("unittests", { onRedeliveriesExceeded: 1 });
            pub.on('success', (id) => {
                messageId = id;
            });

            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
                skipInit: true
            });

            should(worker).be.ok();

            // change default redelivery from republish to drop
            worker.nack._redeliveriesExceeded = worker.nack.drop;

            // Wait a sec for the connection to go through
            await new Promise((resolve) => {
                worker.onSubscribed = function() {
                    resolve();
                };
                worker.subscribe();
            });

            let counter = 0;
            const max = app.config.rabbit.rascal.vhosts['/'].subscriptions["unittests"].redeliveries.limit+1;

            // Wait for the message to hit 11 times (1 real + 10 retries)
            await new Promise((resolve) => {

                // Ensure the message is valid and count the retries
                worker.handleMessage = function(message, content, ackOrNack) {
                    // nack + requeue
                    counter++;
                    counter.should.be.lessThanOrEqual(max);
                    messageId.should.be.exactly(message.properties.messageId);
                    // console.log(counter, message.properties.rascal);
                    ackOrNack(true, { strategy: 'nack', requeue: true, defer: 10 });

                    if (counter === max) {
                        resolve();
                    }
                }.bind(worker);

            });

            // Disconnect
            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

        });

    });

    describe('onInvalidContent', () => {

        before(purge);

        afterEach(purge);

        it('should toss messages with bad content', async function() {
            this.timeout(5000);

            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
            });

            should(worker).be.ok();

            // change default redelivery from republish to drop
            worker.nack._invalidContent = worker.nack.drop;

            // Wait a sec for the connection to go through
            await new Promise((resolve) => {
                setTimeout(async () => {
                    resolve();
                }, 50);
            });

            // Wait for the message to hit 11 times (1 real + 10 retries)
            await new Promise((resolve) => {

                // Ensure the message is valid and count the retries
                worker.handleMessage = function(/*message, content, ackOrNack*/) {
                    throw('Should not have gotten here');
                }.bind(worker);

                // Fire the message
                app.services.queue.publishMessage("unittests", "{invalid:content}", { options: { contentType: "application/json" }})
                    .then(() => {
                        setTimeout(() => {
                            resolve();
                        }, 50);
                    })
                ;

            });

            // Disconnect
            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

        });

    });

    describe('onSubscriptionError', () => {

        before(purge);

        afterEach(purge);

        it('should report subscription errors', async function() {
            this.timeout(10000);

            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue,
            });

            should(worker).be.ok();

            // Wait a sec for the connection to go through
            await new Promise((resolve) => {
                setTimeout(async () => {
                    resolve();
                }, 50);
            });

            let counter = 0;

            // Wait for the message to hit 11 times (1 real + 10 retries)
            await new Promise((resolve, reject) => {

                // Ensure the message is valid and count the retries
                worker.handleMessage = function(message, content, ackOrNack) {
                    counter++;

                    if (counter === 1) {
                        const err = new Error('boop');
                        ackOrNack(err, {strategy: 'unknown'});
                        // Rascal 14.0.0:
                        // Messages which cannot be recovered by the republish or forward strategies are nacked
                        // resulting in message loss unless a dead letter is configured.

                        setTimeout(() => resolve(), 50);

                        // setTimeout(async () => {
                        //     await worker.unsubscribe();
                        //     await worker.subscribe();
                        // }, 50);

                    // } else if (counter === 2) {
                    //     ackOrNack();
                    //     setTimeout(() => resolve(), 50);
                    } else {
                        reject('should not have gotten here');
                    }

                }.bind(worker);

                // Fire the message
                app.services.queue.publishMessage("unittests", "explode", { options: { expiration: 1000 }});
            });

            // Disconnect
            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

        });

    });

    describe('unsubscribe', () => {

        before(purge);

        after(purge);

        it('should ignore a double unsubscribe', async () => {
            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue
            });

            should(worker).be.ok();

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });

            await new Promise((resolve) => {
                setTimeout(async () => {
                    await worker.unsubscribe();
                    resolve();
                }, 50);
            });
        });

    });

    describe('prepareForShutdown', () => {

        it('should prepareForShutdown', async () => {

            const worker = new QueueWorker(app, {
                subscriptionName: 'unittests',
                service: app.services.queue
            });

            await new Promise((resolve) => {
                setTimeout(async () => {
                    worker.prepareForShutdown();
                    resolve();
                }, 100);
            });

        });

    });

});