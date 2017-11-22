# Example Application Usage

This is an example for how you can use the QueueService, BatchQueueWorker and QueueWorker in your application.

Run like so, replacing your rabbitmq host for your test server:
```sh
RABBIT_HOST=192.168.99.100 RABBIT_PORT=5672 RABBIT_USER=test RABBIT_PASS=test RABBIT_VHOST=test node docs/example-app/index.js
```

Replace the values for your test environment.

The resulting output should look like this:
```text
 > Subscribed to the my_events queue
 > Subscribed to the my_batches queue
MyQueueWorker consumed message: 10
MyQueueWorker consumed message: 11
MyBatchWorker consumed messages: 0, 1, 2, 3, 4
MyBatchWorker consumed messages: 5, 6, 7, 8, 9
Done!
```