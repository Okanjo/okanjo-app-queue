"use strict";

const should = require('should');
const Async = require('async');

describe('BatchQueueWorker', () => {

    "use strict";

    const BatchQueueWorker = require('../BatchQueueWorker');
    const QueueService = require('../QueueService');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    const queueName = 'unittest_batch';

    let worker;
    let currentMessageHandler = null;

    let app, go = false;

    class UnitTestQueueWorker extends BatchQueueWorker {

        constructor(app, queueName) {
            super(app, {
                queueName: queueName
                //, batchSize: 5 // default size is 5
            });
        }

        handleMessageBatch(messages, callback) {
            if (currentMessageHandler) currentMessageHandler(messages, callback);
            else callback(messages); // requeue
        }
    }

    it('can be extended and initialized', function(done) {

        app = new OkanjoApp(config);
        app.services = {
            queue: new QueueService(app, app.config.rabbit, { unittest_batch: queueName })
        };


        app.connectToServices(() => {
            app.services.queue.activeQueues[queueName].purge().addCallback((/*res*/) => {
                //console.log('CLEANUP: ', res);

                worker = new UnitTestQueueWorker(app, queueName);
                should(worker).be.ok();

                done();
            });
        });
    });

    it('can receive a message', function(done) {

        let sent = false;
        // const batches = 0;
        let rejectedNumber7 = false,
            rereceivedNumber7 = false,
            droppedNumber8 = false,
            received = 0;

        function checkDone() {
            if (sent && received >= 10 && rereceivedNumber7) {
                currentMessageHandler = null;
                done();
            }
        }

        // Define the handler for this test
        currentMessageHandler = function(messages, doneWithBatch) {

            // don't process the message until go() is called
            if (go === false) {
                go = () => {
                    currentMessageHandler(messages, doneWithBatch);
                };
                return;
            }

            // Expected: first batch: 1 message (the one that game in)
            // Next batch: 5 messages
            // Last batch: 4 messages

            //console.log(`GOT BATCH: ${++batches}`, messages.map((m) => { return {m:m.message, tag: m.messageObject.deliveryTag}}), messages.length);

            received += messages.length;

            messages.forEach((message) => {
                message.message.test.should.match(/Batch message/);
            });

            const lucky7 = messages.find((m) => m.message.number === 7); // reject #7 and accept it on the second try
            const lucky8 = messages.find((m) => m.message.number === 8); // reject and drop #8, should never see it again

            const requeue = [];
            const drop = [];

            if (lucky7) {
                if (rejectedNumber7) {
                    // we got it again!
                    //console.log('GOT IT A AGAIN!');
                    rereceivedNumber7 = true;
                } else {
                    //console.log('REJECTING');
                    rejectedNumber7 = true;
                    requeue.push(lucky7);
                }
            }

            if (lucky8) {
                should(droppedNumber8).be.exactly(false); // should not have received this a second time
                droppedNumber8 = true;
                drop.push(lucky8);
            }

            doneWithBatch(requeue, drop);

            // See if we're done yet
            checkDone();

            //setTimeout(function() {
            //    message.should.be.an.Object();
            //    doneWithTheMessage.should.be.a.Function();
            //    headers.should.be.an.Object();
            //    deliveryInfo.should.be.an.Object();
            //    messageObject.should.be.an.Object();
            //
            //    message.test.should.be.equal('UnitTestQueueWorker can receive a message');
            //
            //    should(received).be.exactly(false);
            //    should(sent).be.exactly(true);
            //    received = true;
            //
            //
            //    // consume the message
            //    doneWithTheMessage(false, false);
            //
            //    checkDone();
            //}, 10);
        };

        // Push 10 messages in the queue
        Async.times(10, (i, next) => {
            app.services.queue.publishMessage(queueName, { test: 'Batch message', number: i }, (err) => {
                should(err).not.be.ok();

                sent = true;

                next();
            });
        }, () => {
            // Now that we pushed them all, let the worker roll
            go();
        });
    });

    it('can shutdown gracefully', function(done) {
        this.timeout(10000);

        let sent = false;
        // const lateSent = false;
        let received = false;


        // Intercept the shutdown
        worker.shutdown = function() {

            sent.should.be.exactly(true);
            received.should.be.exactly(true);
            //lateSent.should.be.exactly(true);
            worker._isSubscribed.should.be.exactly(false);
            worker._isShuttingDown.should.be.exactly(true);

            currentMessageHandler = null;

            //// Cleanup that left over message
            //worker.queue.purge().addCallback(function(res) {
            //    res.messageCount.should.be.exactly(1);
                done();
            //});
        };

        currentMessageHandler = function(messages, doneWithTheBatch) {
            setTimeout(function() {
                messages.should.be.ok();
                doneWithTheBatch.should.be.a.Function();

                sent.should.be.exactly(true);
                received.should.be.exactly(false);

                messages[0].message.test.should.be.equal('UnitTestQueueWorker can shutdown');

                received = true;

                // simulate a process shutdown
                worker._isShuttingDown.should.be.exactly(false);
                worker.prepareForShutdown(true);
                worker._isShuttingDown.should.be.exactly(true);

                // Publish another message to the queue while shutdown started -
                // it should NOT be handled and remain in the queue
                //app.services.queue.publishMessage(queueName, { test: 'UnitTestQueueWorker message after shutdown' }, function(err) {
                //    app.inspect(err);
                //    should(err).not.be.ok();
                //    lateSent = true;
                //});

                // with this delay, the prepare shutdown should fire a retry at least once before we finished processing the message
                setTimeout(function() {
                    doneWithTheBatch();
                    worker._cargo.length().should.be.exactly(0);
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