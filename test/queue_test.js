"use strict";

const should = require('should');

//process.env.NODE_DEBUG_AMQP = 1;

const disableReportingByDefault = !!process.env.SILENCE_REPORTS;

function toggleReporting(state) {
    process.env.SILENCE_REPORTS = !(state && !disableReportingByDefault);
}


describe('QueueService', () => {

    const QueueService = require('../QueueService');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    /**
     * App
     * @type {OkanjoApp}
     */
    let app;


    // Init
    before(function(done) {

        // Create the app instance
        app = new OkanjoApp(config);

        // Add the redis service to the app
        app.services = {
            queue: new QueueService(app),
            queueAuto: new QueueService(app, null, { unitTestAuto: 'unittests_auto' }) // <-- automatic binding of exchanges
        };

        app.connectToServices(done);
    });

    it('should be bound to app', function () {
        app.services.queue.should.be.an.Object();
        app.services.queue.should.be.instanceof(QueueService);
    });

    it('should throw config errors if not setup', () => {
        const app2 = new OkanjoApp({});
        should(() => {
            new QueueService(app2);
        }).throw(/configuration/);
    });

    it('can bind arbitrary queue, publish, and consume', function(done) {

        const queueName = 'unittests',
            originalMessage = {
                id: Math.round(Math.random() * 10000),
                s: "hello",
                d: new Date()
            };

        // Bind the unit test exchange/queue
        // noinspection JSAccessibilityCheck
        app.services.queue._bindQueueExchange(queueName, function() {

            // Pull the rabbit queue so qe can consume it
            const queue = app.services.queue.activeQueues[queueName],
                state = {
                    subscribed: false,
                    tag: null,
                    messageReceived: false,
                    messageRejected: false,
                    messageReceivedAgain: false
                };
            should(queue).be.ok();

            queue.purge().addCallback(function(res) {

                if (res.messageCount)
                    console.log(`Purged ${res.messageCount} messages from the ${queueName} queue`);

                // Create a consumer
                queue.subscribe({ ack: true, prefetchCount: 1 }, function(message) {

                    state.subscribed.should.be.exactly(true);

                    // Message received!
                    // Check the message
                    message.should.be.an.Object();
                    message.id.should.be.equal(originalMessage.id);
                    message.s.should.be.equal(originalMessage.s);
                    message.d.should.be.equal(originalMessage.d.toJSON());

                    // First, we should receive the message, but we're going to reject it
                    // so we can receive it again
                    if (!state.messageReceived) {
                        state.messageReceived = true;

                        // Reject the message
                        state.messageRejected.should.be.exactly(false);
                        state.messageRejected = true;
                        queue.shift(true, true); // reject, requeue

                    } else if (!state.messageReceivedAgain) {
                        state.messageReceivedAgain = true;

                        // Confirm the message
                        state.messageRejected.should.be.exactly(true);
                        queue.shift(false, false); // no reject, no requeue

                        // Cleanup!
                        queue.unsubscribe(state.tag).addCallback(function(res) {
                            res.should.be.an.Object();
                            res.consumerTag.should.be.ok();

                            done();
                        });

                    } else {
                        throw new Error('Invalid queue state! No idea what\'s going on');
                    }

                }).addCallback(function(res) {
                    // The consumer has subscribed
                    state.subscribed.should.be.exactly(false);
                    state.subscribed = true;

                    should(state.tag).not.be.ok();
                    should(res).be.ok();

                    res.consumerTag.should.be.ok();
                    state.tag = res.consumerTag;

                    // Publish a message
                    app.services.queue.publishMessage(queueName, originalMessage, function(err) {
                        should(err).not.be.ok();
                    });
                });
            });
        });
    });

    it('can publish and consume a message with options', function(done) {

        const queueName = 'unittests',
            originalMessage = {
                id: Math.round(Math.random() * 10000),
                s: "hello",
                d: new Date()
            };

        // Bind the unit test exchange/queue
        // noinspection JSAccessibilityCheck
        app.services.queue._bindQueueExchange(queueName, function() {

            // Pull the rabbit queue so qe can consume it
            const queue = app.services.queue.activeQueues[queueName],
                state = {
                    subscribed: false,
                    tag: null,
                    messageReceived: false,
                    messageRejected: false,
                    messageReceivedAgain: false
                };
            should(queue).be.ok();

            // Create a consumer
            queue.subscribe({ ack: true, prefetchCount: 1 }, function(message, headers, deliveryInfo, messageObject) {

                //console.log('received!', arguments);

                //
                state.subscribed.should.be.exactly(true);
                headers.should.be.an.Object();
                headers['x-okanjo-was-here'].should.be.equal('yes');

                // Check that the headers are in the raw info
                deliveryInfo.should.be.an.Object();
                deliveryInfo.headers['x-okanjo-was-here'].should.be.equal('yes');

                // The raw message
                messageObject.should.be.an.Object();


                // Message received!
                // Check the message
                message.should.be.an.Object();
                message.id.should.be.equal(originalMessage.id);
                message.s.should.be.equal(originalMessage.s);
                message.d.should.be.equal(originalMessage.d.toJSON());

                // First, we should receive the message, but we're going to reject it
                // so we can receive it again
                if (!state.messageReceived) {
                    state.messageReceived = true;

                    // Rabbit should know that this is the first appearance of this message to the app
                    deliveryInfo.redelivered.should.be.exactly(false);

                    // Reject the message
                    state.messageRejected.should.be.exactly(false);
                    state.messageRejected = true;
                    queue.shift(true, true); // reject, requeue

                } else if (!state.messageReceivedAgain) {
                    state.messageReceivedAgain = true;

                    // Rabbit should know that this message was rejected before
                    deliveryInfo.redelivered.should.be.exactly(true);

                    // Confirm the message
                    state.messageRejected.should.be.exactly(true);
                    queue.shift(false, false); // no reject, no requeue

                    // Cleanup!
                    queue.unsubscribe(state.tag).addCallback(function(res) {
                        res.should.be.an.Object();
                        res.consumerTag.should.be.ok();

                        done();
                    });

                } else {
                    throw new Error('Invalid queue state! No idea what\'s going on');
                }

            }).addCallback(function(res) {
                // The consumer has subscribed
                state.subscribed.should.be.exactly(false);
                state.subscribed = true;

                should(state.tag).not.be.ok();
                should(res).be.ok();

                res.consumerTag.should.be.ok();
                state.tag = res.consumerTag;

                // Publish a message
                app.services.queue.publishMessage(queueName, originalMessage, { headers: { "x-okanjo-was-here": 'yes' } }, function(err) {
                    // If res is true, then there was an error (terrible convention)
                    should(err).not.be.ok();
                });
            });
        });
    });

    describe('Queue Worker', function() {
        "use strict";

        const queueName = 'unittests';

        let worker;

        const QueueWorker = require('../QueueWorker');
        //const UnitTestQueueWorker = require('./unittest_queue_worker');
        const OkanjoWorker = require('okanjo-app-broker').OkanjoWorker;

        let currentMessageHandler = null;

        class UnitTestQueueWorker extends QueueWorker {

            constructor(app, queueName) {
                super(app, {
                    queueName: queueName
                });
            }

            handleMessage(message, callback, /* you might not care about the rest of these params */ headers, deliveryInfo, messageObject) {
                if (currentMessageHandler) currentMessageHandler(message, callback, headers, deliveryInfo, messageObject);
            }
        }


        it('cannot be instantiated without a queueName', function() {
            (function() {
                new QueueWorker(app, {})
            }).should.throw('Missing require option: queueName');
        });


        it('can be extended and initialized', function() {

            // Create the instance and start it
            worker = new UnitTestQueueWorker(app, queueName);

            worker.should.be.instanceof(UnitTestQueueWorker);
            worker.should.be.instanceof(QueueWorker);
            worker.should.be.instanceof(OkanjoWorker);

        });

        it('can receive a message', function(done) {

            let sent = false,
                received = false;

            function checkDone() {
                if (sent && received) {
                    currentMessageHandler = null;
                    done();
                }
            }

            // Define the handler for this test
            currentMessageHandler = function(message, doneWithTheMessage, headers, deliveryInfo, messageObject) {
                setTimeout(function() {
                    message.should.be.an.Object();
                    doneWithTheMessage.should.be.a.Function();
                    headers.should.be.an.Object();
                    deliveryInfo.should.be.an.Object();
                    messageObject.should.be.an.Object();

                    message.test.should.be.equal('UnitTestQueueWorker can receive a message');

                    should(received).be.exactly(false);
                    should(sent).be.exactly(true);
                    received = true;


                    // consume the message
                    doneWithTheMessage(false, false);

                    checkDone();
                }, 10);
            };

            // push a message into the queue and wait to consume it
            app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker can receive a message' }, function(err) {
                should(err).not.be.ok();
                should(received).be.exactly(false);

                sent = true;
                checkDone();
            });

        });



        it('can reject and retry a message', function(done) {
            this.timeout(5000);

            let sent = false,
                received = false,
                rejected = false,
                receivedAgain = false;

            function checkDone() {
                if (sent && received && rejected && receivedAgain) {
                    currentMessageHandler = null;
                    done();
                }
            }

            // Define the handler for this test
            currentMessageHandler = function(message, doneWithTheMessage, headers, deliveryInfo, messageObject) {
                // console.log('RECEIVED')
                setTimeout(() => {
                    // console.log('RECEIVE PROCESSING')
                    message.should.be.an.Object();
                    doneWithTheMessage.should.be.a.Function();
                    headers.should.be.an.Object();
                    deliveryInfo.should.be.an.Object();
                    messageObject.should.be.an.Object();

                    message.test.should.be.equal('UnitTestQueueWorker can receive and reject a message');

                    should(sent).be.exactly(true);

                    if (!received) {
                        rejected.should.be.exactly(false);
                        receivedAgain.should.be.exactly(false);
                        received = true;

                        // Reject it so we get it again
                        rejected = true;

                        // consume the message
                        doneWithTheMessage(true, true);
                    } else {
                        // We rejected it already, so accept it
                        receivedAgain.should.be.exactly(false);
                        receivedAgain = true;

                        doneWithTheMessage(false, false);

                        checkDone();
                    }
                }, 50); // setImmediate too fast for rabbit-3.6, ok for rabbit-3.5
            };

            // push a message into the queue and wait to consume it
            // console.log('SENDING')
            app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker can receive and reject a message' }, function(err) {
                // console.log('SENT')
                should(err).not.be.ok();
                should(received).be.exactly(false);

                sent = true;
                checkDone();
            });

        });


        it('should recover from an error gracefully', function(done) {
            this.timeout(5000);

            toggleReporting(false);

            let errorEmitted = false,
                sent = false,
                //resubscribed = false,
                received = false;

            function checkDone() {
                if (errorEmitted && sent /*&& resubscribed*/ && received) {
                    currentMessageHandler = null;
                    toggleReporting(true);
                    done();
                }
            }

            // Setup a message handler for this test
            currentMessageHandler = function(message, doneWithTheMessage, headers, deliveryInfo, messageObject) {
                setTimeout(function() {
                    //console.log('GOT MESSAGE FROM', deliveryInfo)
                    message.should.be.an.Object();
                    doneWithTheMessage.should.be.a.Function();
                    headers.should.be.an.Object();
                    deliveryInfo.should.be.an.Object();
                    messageObject.should.be.an.Object();

                    sent.should.be.exactly(true);
                    received.should.be.exactly(false);
                    errorEmitted.should.be.exactly(true);
                    //resubscribed.should.be.exactly(true); // <-- if this hit, its because the message was consumed even though we unsub'd

                    message.test.should.be.equal('UnitTestQueueWorker can recover');

                    received = true;

                    worker._isProcessing.should.be.exactly(true);
                    doneWithTheMessage(false, false);
                    worker._isProcessing.should.be.exactly(false);

                    // we should be subscribed again
                    worker._isSubscribed.should.be.exactly(true);

                    checkDone();
                }, 10);
            };


            // We should be subscribed
            worker._isSubscribed.should.be.exactly(true);

            // Unsubscribe
            errorEmitted = true;
            worker.service.rabbit.emit('error', { code: 'ETIMEDOUT', errno: 'ETIMEDOUT', syscall: 'read', faked: true });

            worker.service.rabbit.once('ready', () => {

                // Wait a sec for it to recover
                setTimeout(() => {

                    // Push a message in the queue
                    // push a message into the queue and wait to consume it
                    app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker can recover' }, function(err) {
                        should(err).not.be.ok();

                        sent.should.be.exactly(false);
                        received.should.be.exactly(false);

                        sent = true;
                    });

                }, 250);
            });
        });


        it('should unsubscribe and resubscribe gracefully', function(done) {
            this.timeout(12000);

            let unsubscribed = false,
                sent = false,
                resubscribed = false,
                received = false;

            function checkDone() {
                if (unsubscribed && sent && resubscribed && received) {
                    currentMessageHandler = null;
                    done();
                }
            }

            // Setup a message handler for this test
            currentMessageHandler = function(message, doneWithTheMessage, headers, deliveryInfo, messageObject) {
                // console.log('RECEIVED', headers, deliveryInfo)
                setTimeout(function() {
                    // console.log('RECEIVE PROCESSING')
                    message.should.be.an.Object();
                    doneWithTheMessage.should.be.a.Function();
                    headers.should.be.an.Object();
                    deliveryInfo.should.be.an.Object();
                    messageObject.should.be.an.Object();

                    sent.should.be.exactly(true);
                    received.should.be.exactly(false);
                    unsubscribed.should.be.exactly(true);
                    message.test.should.be.equal('UnitTestQueueWorker can resubscribe');
                    resubscribed.should.be.exactly(true); // <-- if this hit, its because the message was consumed even though we unsub'd


                    received = true;

                    worker._isProcessing.should.be.exactly(true);
                    doneWithTheMessage(false, false);
                    worker._isProcessing.should.be.exactly(false);

                    checkDone();
                }, 1000);
            };


            // We should be subscribed
            worker._isSubscribed.should.be.exactly(true);

            //console.log('STILL SUBd')

            // Unsubscribe
            // console.log('UNSUB')
            worker.unsubscribe(function() {
                // console.log('UNSUB DONE')
                unsubscribed = true;
                worker._isSubscribed.should.be.exactly(false);

                //console.log('UNSUBd')

                // Calling unsubscribe again should do nothing
                // console.log('UNSUB AGAIN')
                worker.unsubscribe((/*err*/) => {
                    // console.log('UNSUB AGAIN DONE')
                    worker._isSubscribed.should.be.exactly(false);

                    resubscribed.should.be.exactly(false);

                    //console.log('STILL UNSUBd')

                    setTimeout(() => {

                        // Push a message in the queue
                        // push a message into the queue and wait to consume it
                        // console.log('SENDING...')
                        app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker can resubscribe' }, function(err) {
                            // console.log('SENT!')
                            should(err).not.be.ok();

                            //console.log('sent...')

                            sent.should.be.exactly(false);
                            received.should.be.exactly(false);

                            sent = true;

                            // Delay for a bit, to make sure there were no consumers
                            setTimeout(function() {

                                // - no consumers, hopefully
                                received.should.be.exactly(false);

                                // Do we need a `resubscribing` state check to prevent race conditions?

                                // Subscribe
                                // console.log('RESUBSCRIBING...')
                                worker.subscribe(function() {
                                    // console.log('RESUBSCRIBED!')
                                    resubscribed = true;
                                    worker._isSubscribed.should.be.exactly(true);

                                    // Wait for the handler to finish up
                                    // - consume the message
                                    // Done

                                });

                            }, 250);
                        });
                    }, 1000)

                });
            });
        });

        it('can shutdown gracefully', function(done) {
            this.timeout(10000);

            let sent = false,
                lateSent = false,
                received = false;


            // Inctercept the
            worker.shutdown = function() {

                sent.should.be.exactly(true);
                received.should.be.exactly(true);
                lateSent.should.be.exactly(true);
                worker._isSubscribed.should.be.exactly(false);
                worker._isShuttingDown.should.be.exactly(true);

                currentMessageHandler = null;

                // Cleanup that left over message
                worker.queue.purge().addCallback(function(res) {
                    res.messageCount.should.be.exactly(1);
                    done();
                });
            };

            currentMessageHandler = function(message, doneWithTheMessage, headers, deliveryInfo, messageObject) {
                setTimeout(function() {
                    message.should.be.an.Object();
                    doneWithTheMessage.should.be.a.Function();
                    headers.should.be.an.Object();
                    deliveryInfo.should.be.an.Object();
                    messageObject.should.be.an.Object();

                    sent.should.be.exactly(true);
                    received.should.be.exactly(false);

                    message.test.should.be.equal('UnitTestQueueWorker can shutdown');

                    received = true;

                    // simulate a process shutdown
                    worker._isShuttingDown.should.be.exactly(false);
                    worker.prepareForShutdown(true);
                    worker._isShuttingDown.should.be.exactly(true);

                    // Publish another message to the queue while shutdown started -
                    // it should NOT be handled and remain in the queue
                    app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker message after shutdown' }, function(err) {
                        should(err).not.be.ok();
                        lateSent = true;
                    });

                    // with this delay, the prepare shutdown should fire a retry at least once before we finished processing the message
                    setTimeout(function() {
                        worker._isProcessing.should.be.exactly(true);
                        doneWithTheMessage(false, false);
                        worker._isProcessing.should.be.exactly(false);
                    }, 25);
                }, 10);
            };

            // We should be subscribed
            worker._isSubscribed.should.be.exactly(true);

            // push a message into the queue and wait to consume it
            app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker can shutdown' }, function(err) {
                should(err).not.be.ok();
                should(received).be.exactly(false);

                sent = true;
            });

        });

    });

});